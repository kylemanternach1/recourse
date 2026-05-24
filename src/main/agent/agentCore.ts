import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ArtifactKind,
  CaseRecord,
  CommandRun,
  FileEditRecord,
  FileOffer,
  FileReadRecord,
  LlmMessage,
  LlmToolCall,
  PhaseId,
  PhaseStatus,
  SandboxPolicy,
  SandboxRunResult,
  SendMessageRequest,
  SmallClaimsIntake,
  UploadedFile
} from '../../shared/contracts'
import { truncateLinesPreview, truncateTextPreview } from '../../shared/filePreview'
import {
  activeWaitStates,
  lifecycleSnapshotLine,
  PHASE_ORDER,
  type LifecyclePatch,
  type PhaseStatePatch
} from '../../shared/lifecycle'
import { formatPhasePromptBlock } from './phasePrompts'
import type { CaseStore } from '../cases/caseStore'
import {
  EDIT_FILE_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  READ_ONLY_TOOL_NAMES,
  RUN_COMMAND_TOOL_NAME,
  OFFER_FILE_DOWNLOAD_TOOL_NAME,
  UPDATE_CASE_STATE_TOOL_NAME,
  type LlmProvider
} from '../llm/openaiCompatibleProvider'
import { resolveWorkspaceFilePath } from '../workspaces/workspacePaths'
import { editFile } from '../workspaces/workspaceFileEditor'
import { buildSandboxPolicy } from '../sandbox/policies'
import { SandboxRunner } from '../sandbox/sandboxRunner'
import { mountCaResourcesInWorkspace } from '../resources/caResources'
import { loadAgentConversation, saveAgentConversation } from '../chat/chatPersistence'
import { readFileRange } from '../workspaces/workspaceFileReader'

const AUTO_EXEC_TOOL_NAMES = new Set([
  READ_FILE_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  UPDATE_CASE_STATE_TOOL_NAME,
  OFFER_FILE_DOWNLOAD_TOOL_NAME,
  RUN_COMMAND_TOOL_NAME
])

interface CaseAgentState {
  caseRecord: CaseRecord
  policy: SandboxPolicy
  conversation: LlmMessage[]
}

export class AgentCore {
  private readonly states = new Map<string, CaseAgentState>()

  constructor(
    private readonly caseStore: CaseStore,
    private readonly sandboxRunner: SandboxRunner,
    private readonly llmProvider: LlmProvider,
    private readonly caResourcesDir: string,
    private readonly emit: (event: AgentEvent) => void
  ) {}

  /** Clear in-memory agent state for all cases (dev reset). */
  resetSession(): void {
    this.states.clear()
  }

  async sendMessage(request: SendMessageRequest): Promise<void> {
    const caseRecord = await this.caseStore.get(request.caseId)
    if (!caseRecord) {
      throw new Error(`Unknown case: ${request.caseId}`)
    }

    const state = await this.loadState(caseRecord)
    const userContent = buildUserMessageContent(request.message, request.uploads)
    state.conversation.push({ role: 'user', content: userContent })
    await this.persistConversation(state)
    await this.caseStore.touch(caseRecord.id)

    this.emit({
      type: 'status',
      caseId: caseRecord.id,
      status: 'running',
      message: 'Thinking...'
    })

    await this.runLoop(state)
  }

  private async runLoop(state: CaseAgentState): Promise<void> {
    if (!this.llmProvider.isConfigured()) {
      const messageId = randomUUID()
      const note =
        'No LLM is configured yet. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in your .env, then restart the app.'
      this.emit({ type: 'message-start', caseId: state.caseRecord.id, messageId })
      this.emit({ type: 'message-delta', caseId: state.caseRecord.id, messageId, delta: note })
      this.emit({ type: 'message-end', caseId: state.caseRecord.id, messageId })
      this.emit({
        type: 'status',
        caseId: state.caseRecord.id,
        status: 'idle',
        message: 'No LLM configured.'
      })
      return
    }

    for (;;) {
      const turnResult = await this.streamTurn(state)
      if (turnResult.status === 'error') {
        return
      }

      if (turnResult.status === 'continue') {
        continue
      }

      if (turnResult.status === 'reply') {
        this.emit({
          type: 'status',
          caseId: state.caseRecord.id,
          status: 'idle',
          message: 'Ready when you are.'
        })
        return
      }
    }
  }

  private async streamTurn(state: CaseAgentState): Promise<
    | { status: 'reply' }
    | { status: 'continue' }
    | { status: 'error' }
  > {
    const messageId = randomUUID()
    let hasStartedMessage = false
    let hasStartedReasoning = false
    let textBuffer = ''
    const toolCalls: LlmToolCall[] = []

    const ensureReasoningClosed = (): void => {
      if (hasStartedReasoning) {
        this.emit({ type: 'reasoning-end', caseId: state.caseRecord.id, messageId })
        hasStartedReasoning = false
      }
    }

    try {
      const messages: LlmMessage[] = [
        { role: 'system', content: buildSystemPrompt(state) },
        ...state.conversation
      ]
      const iterator = this.llmProvider.stream(messages)
      for await (const event of iterator) {
        if (event.type === 'reasoning') {
          if (!hasStartedReasoning) {
            this.emit({ type: 'reasoning-start', caseId: state.caseRecord.id, messageId })
            hasStartedReasoning = true
          }
          this.emit({
            type: 'reasoning-delta',
            caseId: state.caseRecord.id,
            messageId,
            delta: event.delta
          })
        } else if (event.type === 'content') {
          ensureReasoningClosed()
          if (!hasStartedMessage) {
            this.emit({ type: 'message-start', caseId: state.caseRecord.id, messageId })
            hasStartedMessage = true
          }
          textBuffer += event.delta
          this.emit({
            type: 'message-delta',
            caseId: state.caseRecord.id,
            messageId,
            delta: event.delta
          })
        } else if (event.type === 'tool-call') {
          toolCalls.push(event.toolCall)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ensureReasoningClosed()
      if (hasStartedMessage) {
        this.emit({ type: 'message-end', caseId: state.caseRecord.id, messageId })
      }
      this.emit({ type: 'error', caseId: state.caseRecord.id, message })
      this.emit({
        type: 'status',
        caseId: state.caseRecord.id,
        status: 'error',
        message
      })
      return { status: 'error' }
    }

    ensureReasoningClosed()
    if (hasStartedMessage) {
      this.emit({ type: 'message-end', caseId: state.caseRecord.id, messageId })
    }

    if (toolCalls.length === 0) {
      state.conversation.push({ role: 'assistant', content: textBuffer })
      await this.persistConversation(state)
      return { status: 'reply' }
    }

    const autoExecCalls = toolCalls.filter((tc) => AUTO_EXEC_TOOL_NAMES.has(tc.name))
    const unknownCalls = toolCalls.filter((tc) => !AUTO_EXEC_TOOL_NAMES.has(tc.name))

    if (unknownCalls.length > 0) {
      const unsupported = `Unsupported tool call(s): ${unknownCalls.map((tc) => tc.name).join(', ')}`
      state.conversation.push({
        role: 'assistant',
        content: textBuffer.length > 0 ? textBuffer : null,
        toolCalls
      })
      for (const toolCall of toolCalls) {
        state.conversation.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: 'Tool is not available in this app.'
        })
      }
      this.emit({ type: 'error', caseId: state.caseRecord.id, message: unsupported })
      this.emit({
        type: 'status',
        caseId: state.caseRecord.id,
        status: 'error',
        message: unsupported
      })
      return { status: 'error' }
    }

    const assistantMessage: LlmMessage = {
      role: 'assistant',
      content: textBuffer.length > 0 ? textBuffer : null,
      toolCalls
    }

    if (autoExecCalls.length > 0) {
      state.conversation.push(assistantMessage)
      for (const toolCall of autoExecCalls) {
        const result =
          toolCall.name === RUN_COMMAND_TOOL_NAME
            ? await this.executeRunCommand(state, toolCall)
            : await this.executeReadOnlyTool(state, toolCall)
        state.conversation.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: result
        })
      }
      await this.persistConversation(state)
      return { status: 'continue' }
    }

    return { status: 'continue' }
  }

  private async executeRunCommand(
    state: CaseAgentState,
    toolCall: LlmToolCall
  ): Promise<string> {
    let parsedArgs: { command?: string; reason?: string } = {}
    try {
      parsedArgs = JSON.parse(toolCall.arguments) as {
        command?: string
        reason?: string
      }
    } catch {
      parsedArgs = {}
    }

    if (!parsedArgs.command?.trim()) {
      return 'Error: run_workspace_command requires command.'
    }

    const command = parsedArgs.command.trim()
    this.emit({
      type: 'status',
      caseId: state.caseRecord.id,
      status: 'running',
      message: `Running: ${command}`
    })

    const result = await this.sandboxRunner.runCommand({
      command,
      cwd: state.caseRecord.workspace.path,
      policy: state.policy,
      onOutput: (stream, message) => {
        if (stream === 'sandbox' && message.toLowerCase().includes('blocked')) {
          this.emit({ type: 'blocked', caseId: state.caseRecord.id, message })
        }
      }
    })

    const run: CommandRun = {
      id: randomUUID(),
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      blockedEvents: result.blockedEvents
    }

    this.emit({
      type: 'command-run',
      caseId: state.caseRecord.id,
      run
    })

    return buildToolResultMessage(command, result)
  }

  private async executeReadOnlyTool(
    state: CaseAgentState,
    toolCall: LlmToolCall
  ): Promise<string> {
    try {
      if (toolCall.name === READ_FILE_TOOL_NAME) {
        const args = JSON.parse(toolCall.arguments) as {
          path?: string
          start_line?: number
          end_line?: number
        }
        if (!args.path?.trim()) {
          return 'Error: read_file requires path, start_line, and end_line.'
        }
        if (args.start_line == null || args.end_line == null) {
          return 'Error: read_file requires start_line and end_line (1-based, inclusive).'
        }
        const result = await readFileRange(
          state.caseRecord.workspace.path,
          args.path.trim(),
          args.start_line,
          args.end_line
        )
        const preview = truncateLinesPreview(result.lines)
        const readRecord: FileReadRecord = {
          id: randomUUID(),
          path: result.path,
          startLine: result.startLine,
          endLine: result.endLine,
          totalLines: result.totalLines,
          lines: preview.lines,
          truncated: result.truncated || preview.truncated
        }
        this.emit({
          type: 'file-read',
          caseId: state.caseRecord.id,
          read: readRecord
        })
        const header = [
          `Path: ${result.path}`,
          `Lines: ${result.startLine}–${result.endLine} of ${result.totalLines}`,
          result.truncated ? '(end_line was capped to 250 lines per read)' : ''
        ]
          .filter((line) => line.length > 0)
          .join('\n')
        return `${header}\n\n${result.content}`
      }

      if (toolCall.name === EDIT_FILE_TOOL_NAME) {
        const args = JSON.parse(toolCall.arguments) as {
          path?: string
          old_string?: string
          new_string?: string
          replace_all?: boolean
          content?: string
        }
        if (!args.path?.trim()) {
          return 'Error: edit_file requires path.'
        }
        const result = await editFile(state.caseRecord.workspace.path, args.path.trim(), {
          old_string: args.old_string,
          new_string: args.new_string,
          replace_all: args.replace_all,
          content: args.content
        })
        const oldPreview = truncateTextPreview(result.oldText)
        const newPreview = truncateTextPreview(result.newText)
        const kind: FileEditRecord['kind'] =
          result.mode === 'search_replace'
            ? 'patch'
            : result.isNewFile
              ? 'create'
              : 'overwrite'
        const editRecord: FileEditRecord = {
          id: randomUUID(),
          path: result.path,
          kind,
          replacements: result.replacements,
          oldText: oldPreview.text,
          newText: newPreview.text,
          truncated: oldPreview.truncated || newPreview.truncated
        }
        this.emit({
          type: 'file-edit',
          caseId: state.caseRecord.id,
          edit: editRecord
        })
        const action =
          result.mode === 'write'
            ? result.isNewFile
              ? `Created ${result.path}`
              : `Wrote ${result.path}`
            : `Edited ${result.path} (${result.replacements ?? 1} replacement(s))`
        return `${action} (${result.bytesWritten} bytes)`
      }

      if (toolCall.name === UPDATE_CASE_STATE_TOOL_NAME) {
        return await this.executeUpdateCaseState(state, toolCall)
      }

      if (toolCall.name === OFFER_FILE_DOWNLOAD_TOOL_NAME) {
        return await this.executeOfferFileDownload(state, toolCall)
      }

      return `Unknown read-only tool: ${toolCall.name}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Error: ${message}`
    }
  }

  private async loadState(caseRecord: CaseRecord): Promise<CaseAgentState> {
    await mountCaResourcesInWorkspace(caseRecord.workspace.path, this.caResourcesDir)

    const existing = this.states.get(caseRecord.id)
    if (existing) {
      existing.caseRecord = caseRecord
      return existing
    }

    const policy = buildSandboxPolicy(
      caseRecord.workspace.path,
      caseRecord.policyPresetId,
      caseRecord.customDomains
    )
    const savedConversation = await loadAgentConversation(caseRecord.workspace.path)
    const state: CaseAgentState = {
      caseRecord,
      policy,
      conversation: savedConversation ?? []
    }
    this.states.set(caseRecord.id, state)
    return state
  }

  private async persistConversation(state: CaseAgentState): Promise<void> {
    await saveAgentConversation(state.caseRecord.workspace.path, state.conversation)
  }

  private async executeOfferFileDownload(
    state: CaseAgentState,
    toolCall: LlmToolCall
  ): Promise<string> {
    const args = JSON.parse(toolCall.arguments) as {
      path?: string
      label?: string
      description?: string
    }
    if (!args.path?.trim()) {
      return 'Error: offer_file_download requires path and label.'
    }
    if (!args.label?.trim()) {
      return 'Error: offer_file_download requires label.'
    }

    const relativePath = args.path.trim()
    const absolutePath = resolveWorkspaceFilePath(
      state.caseRecord.workspace.path,
      relativePath
    )
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile()) {
      return `Error: ${relativePath} is not a file.`
    }

    const offer: FileOffer = {
      id: randomUUID(),
      relativePath,
      name: path.basename(relativePath),
      size: stat.size,
      mimeType: mimeTypeForPath(relativePath),
      label: args.label.trim(),
      description: args.description?.trim() || undefined
    }

    this.emit({
      type: 'file-offer',
      caseId: state.caseRecord.id,
      file: offer
    })

    this.emit({
      type: 'log',
      caseId: state.caseRecord.id,
      stream: 'agent',
      message: `Offered download: ${offer.label} (${offer.relativePath})`
    })

    return `Download card shown in chat for ${offer.relativePath} (${formatBytes(offer.size)}).`
  }

  private async executeUpdateCaseState(
    state: CaseAgentState,
    toolCall: LlmToolCall
  ): Promise<string> {
    const args = JSON.parse(toolCall.arguments) as UpdateCaseStateArgs
    const lifecyclePatch = parseLifecyclePatch(args)
    const intakePatch = parseIntakePatch(args.intake)

    let updated: CaseRecord | undefined
    if (intakePatch && Object.keys(intakePatch).length > 0) {
      updated = await this.caseStore.patchIntake(
        state.caseRecord.id,
        intakePatch,
        lifecyclePatch
      )
    } else if (lifecyclePatch.phases?.length || lifecyclePatch.currentPhase) {
      updated = await this.caseStore.patchLifecycle(state.caseRecord.id, lifecyclePatch)
    } else {
      return 'Error: update_case_state requires phases and/or intake updates.'
    }

    if (!updated) {
      return 'Error: case not found.'
    }

    state.caseRecord = updated
    this.emit({
      type: 'case-updated',
      caseId: updated.id,
      caseRecord: updated
    })

    const patchedPhaseIds = new Set<PhaseId>()
    for (const entry of lifecyclePatch.phases ?? []) {
      patchedPhaseIds.add(entry.phaseId)
    }
    if (lifecyclePatch.currentPhase) {
      patchedPhaseIds.add(lifecyclePatch.currentPhase)
    }
    patchedPhaseIds.add(updated.lifecycle.currentPhase)

    for (const phaseId of patchedPhaseIds) {
      const phase = updated.lifecycle.phases.find((entry) => entry.phaseId === phaseId)
      if (!phase || phase.status === 'not_started') {
        continue
      }
      this.emit({
        type: 'phase-update',
        caseId: updated.id,
        update: {
          id: randomUUID(),
          phaseId: phase.phaseId,
          status: phase.status,
          nextAction: phase.nextAction,
          at: phase.updatedAt,
          isCurrent: phase.phaseId === updated.lifecycle.currentPhase
        }
      })
    }

    const current = updated.lifecycle.phases.find(
      (phase) => phase.phaseId === updated.lifecycle.currentPhase
    )
    const status = current?.status ?? 'unknown'
    const next = current?.nextAction ? ` Next: ${current.nextAction}` : ''

    return `Updated case state. Current phase: ${updated.lifecycle.currentPhase} (${status}).${next}`
  }
}

interface UpdateCaseStateArgs {
  current_phase?: string
  phases?: Array<{
    phase_id?: string
    status?: string
    next_action?: string
    waiting_on?: string
    waiting_since?: string
    expected_by?: string
    artifacts?: Array<{
      path?: string
      label?: string
      kind?: string
      created_at?: string
    }>
    append_artifacts?: Array<{
      path?: string
      label?: string
      kind?: string
      created_at?: string
    }>
  }>
  intake?: Partial<Record<string, unknown>>
}

function parseLifecyclePatch(args: UpdateCaseStateArgs): LifecyclePatch {
  const patch: LifecyclePatch = {}
  if (args.current_phase && isPhaseId(args.current_phase)) {
    patch.currentPhase = args.current_phase
  }
  if (args.phases?.length) {
    patch.phases = args.phases
      .filter((entry) => entry.phase_id && isPhaseId(entry.phase_id))
      .map((entry): PhaseStatePatch => ({
        phaseId: entry.phase_id as PhaseId,
        status: entry.status && isPhaseStatus(entry.status) ? entry.status : undefined,
        nextAction:
          entry.next_action === '' ? null : entry.next_action,
        waitingOn: entry.waiting_on === '' ? null : entry.waiting_on,
        waitingSince: entry.waiting_since === '' ? null : entry.waiting_since,
        expectedBy: entry.expected_by === '' ? null : entry.expected_by,
        artifacts: entry.artifacts?.map(parseArtifact),
        appendArtifacts: entry.append_artifacts?.map(parseArtifact)
      }))
  }
  return patch
}

function parseArtifact(entry: {
  path?: string
  label?: string
  kind?: string
  created_at?: string
}): {
  path: string
  label: string
  kind: ArtifactKind
  createdAt: string
} {
  if (!entry.path?.trim() || !entry.label?.trim() || !entry.kind) {
    throw new Error('artifact path, label, and kind are required')
  }
  const kind = entry.kind as ArtifactKind
  return {
    path: entry.path.trim(),
    label: entry.label.trim(),
    kind,
    createdAt: entry.created_at ?? new Date().toISOString()
  }
}

function parseIntakePatch(
  raw?: Partial<Record<string, unknown>>
): Partial<SmallClaimsIntake> | undefined {
  if (!raw) {
    return undefined
  }
  const patch: Partial<SmallClaimsIntake> = {}
  if (typeof raw.plaintiff_name === 'string') {
    patch.plaintiffName = raw.plaintiff_name
  }
  if (typeof raw.plaintiff_city === 'string') {
    patch.plaintiffCity = raw.plaintiff_city
  }
  if (typeof raw.defendant_name === 'string') {
    patch.defendantName = raw.defendant_name
  }
  if (
    raw.defendant_type === 'individual' ||
    raw.defendant_type === 'business' ||
    raw.defendant_type === 'sole-proprietor'
  ) {
    patch.defendantType = raw.defendant_type
  }
  if (typeof raw.amount_claimed === 'number') {
    patch.amountClaimed = raw.amount_claimed
  }
  if (typeof raw.incident_date === 'string') {
    patch.incidentDate = raw.incident_date
  }
  if (typeof raw.what_happened === 'string') {
    patch.whatHappened = raw.what_happened
  }
  if (typeof raw.contacted_defendant === 'boolean') {
    patch.contactedDefendant = raw.contacted_defendant
  }
  if (typeof raw.contact_notes === 'string') {
    patch.contactNotes = raw.contact_notes
  }
  return patch
}

function isPhaseId(value: string): value is PhaseId {
  return (PHASE_ORDER as string[]).includes(value)
}

function isPhaseStatus(value: string): value is PhaseStatus {
  return (
    value === 'not_started' ||
    value === 'in_progress' ||
    value === 'waiting' ||
    value === 'blocked' ||
    value === 'complete' ||
    value === 'skipped'
  )
}

function buildSystemPrompt(state: CaseAgentState): string {
  const intake = state.caseRecord.intake
  const lifecycle = state.caseRecord.lifecycle
  const currentPhaseId = lifecycle.currentPhase
  const currentPhase = lifecycle.phases.find((phase) => phase.phaseId === currentPhaseId)

  const skillsBlock =
    state.caseRecord.skills.length === 0
      ? 'No skills are installed yet.'
      : state.caseRecord.skills
          .map((skill) => `- ${skill.id}: ${skill.description}`)
          .join('\n')

  const snapshotLines = PHASE_ORDER.map((phaseId) => {
    const phase = lifecycle.phases.find((entry) => entry.phaseId === phaseId)
    if (!phase) {
      return `${phaseId}: unknown`
    }
    return lifecycleSnapshotLine(phase, phaseId === currentPhaseId)
  })

  const waits = activeWaitStates(lifecycle)
  const waitBlock =
    waits.length === 0
      ? 'No active wait states.'
      : waits
          .map((phase) => {
            const since = phase.waitingSince ? ` (since ${phase.waitingSince})` : ''
            return `- ${phase.phaseId}: waiting on ${phase.waitingOn}${since}`
          })
          .join('\n')

  const showIntakeBlock =
    currentPhaseId === 'intake' || currentPhaseId === 'eligibility'

  const intakeStarted =
    intake.plaintiffName.trim().length > 0 ||
    intake.defendantName.trim().length > 0 ||
    intake.whatHappened.trim().length > 0 ||
    intake.amountClaimed > 0

  const intakeBlock = showIntakeBlock
    ? intakeStarted
      ? [
          'Known so far (sync via update_case_state + intake.md when facts are confirmed):',
          `- Plaintiff: ${intake.plaintiffName || '—'} (${intake.plaintiffCity || '—'})`,
          `- Defendant: ${intake.defendantName || '—'} (${intake.defendantType})`,
          `- Amount claimed: ${intake.amountClaimed > 0 ? `$${intake.amountClaimed}` : '—'}`,
          `- Incident date: ${intake.incidentDate || '—'}`,
          `- What happened: ${intake.whatHappened || '—'}`,
          `- Contacted defendant: ${intake.contactedDefendant ? 'yes' : 'no'}${
            intake.contactNotes ? ` (${intake.contactNotes})` : ''
          }`
        ].join('\n')
      : [
          'Intake status: not started — conduct a conversational interview (one or two questions at a time).',
          'Extract facts from natural language; do not dump a questionnaire.'
        ].join('\n')
    : ''

  const intakeInterviewBlock =
    currentPhaseId === 'intake'
      ? [
          'Intake interview:',
          '- Collect: plaintiff name & city, defendant name & type, amount, incident date, narrative, prior contact.',
          '- When the plaintiff confirms a fact, call update_case_state with intake fields AND update intake.md via edit_file.',
          '- When intake criteria are met, mark intake complete and move to eligibility via update_case_state.'
        ].join('\n')
      : ''

  const sections = [
    'You are Recourse, a friendly California small claims copilot helping a self-represented plaintiff through the full case lifecycle (intake → judgment → enforcement).',
    '',
    'Case context:',
    `- Title: ${state.caseRecord.title}`,
    `- Workspace path: ${state.caseRecord.workspace.path}`,
  ]

  sections.push(
    '',
    `Current phase: ${currentPhaseId}${currentPhase?.status ? ` (${currentPhase.status})` : ''}`,
    currentPhase?.nextAction ? `Next action for plaintiff: ${currentPhase.nextAction}` : '',
    '',
    formatPhasePromptBlock(currentPhaseId),
    '',
    'Lifecycle snapshot:',
    ...snapshotLines.map((line) => `- ${line}`),
    '',
    'Active wait states (surface these in chat when relevant):',
    waitBlock
  )

  if (intakeBlock) {
    sections.push('', intakeBlock)
  }
  if (intakeInterviewBlock) {
    sections.push('', intakeInterviewBlock)
  }

  sections.push(
    '',
    'Installed skills (read SKILL.md before using):',
    skillsBlock,
    '',
    'Tools:',
    `- \`${UPDATE_CASE_STATE_TOOL_NAME}\` — update phase status, wait states, artifacts, and intake (auto). Call when advance criteria are met — do not only announce in chat.`,
    `- \`${OFFER_FILE_DOWNLOAD_TOOL_NAME}\` — show a Download button in chat for a workspace file (auto). Use after writing files the plaintiff should save (draft/forms/sc100-filled.pdf, demand letter, etc.).`,
    `- \`${READ_FILE_TOOL_NAME}\` — read a line range (auto). Always pass start_line and end_line; max 250 lines.`,
    `- \`${EDIT_FILE_TOOL_NAME}\` — create or edit text files (auto). Do not edit \`ca/\`.`,
    `- \`${RUN_COMMAND_TOOL_NAME}\` — shell command (auto). Output appears in chat. Use for rg, ls, skill scripts.`,
    '',
    'Official court form workflow:',
    '- For Judicial Council forms, markdown is only a field map or working draft; it is not filing-ready.',
    '- Before marking `forms` complete, copy the official PDF from `ca/court_forms/` into the workspace, fill the workspace copy using `skills/pdf/SKILL.md`, verify the filled PDF, then offer the filled PDF for download.',
    '- Never mutate files under `ca/`. If the official PDF or PDF skill/tooling is unavailable, mark the phase blocked or waiting and explain what is missing.',
    '',
    'update_case_state examples:',
    '- Mark phase in progress: `{ "phases": [{ "phase_id": "forms", "status": "in_progress", "next_action": "Confirm defendant mailing address for SC-100 Item 5" }] }`',
    '- Mark complete (auto-advances current phase): `{ "phases": [{ "phase_id": "forms", "status": "complete" }], "append_artifacts": [{ "path": "draft/forms/sc100-filled.pdf", "label": "Filled SC-100 PDF", "kind": "draft" }, { "path": "draft/sc100-field-map.md", "label": "SC-100 field map", "kind": "note" }] }`',
    '- Enter wait state: `{ "phases": [{ "phase_id": "filing", "status": "waiting", "waiting_on": "Hearing date from court", "next_action": "Check court portal for hearing notice" }] }`',
    '',
    'California reference material (read-only at `ca/`):',
    '- `ca/statutes/` — search with `rg -n` via run_workspace_command; read slices with read_file.',
    '- `ca/court_forms/` — official PDFs (sc100.pdf, sc104.pdf, etc.).',
    '- `ca/small_claims_workflow/` — phase playbooks; read the file for the current phase when stuck.',
  )

  sections.push(
    '',
    'Rules:',
    '- Stay focused on the current phase. Do not skip ahead without meeting "Required to advance".',
    '- Verify required artifacts exist before marking a phase complete; use read_file for text and the PDF skill or shell checks for PDFs.',
    '- For the forms phase, verify the filled official PDF exists; do not mark forms complete based only on markdown drafts.',
    '- When advance criteria are met, call update_case_state — then tell the plaintiff what changed.',
    '- After creating a document the plaintiff needs, call offer_file_download so they can download it from chat.',
    '- Prefer read_file + edit_file for text; run_workspace_command for rg and binaries only.',
    '- Write artifacts under `draft/` using standard names (forms/sc100-filled.pdf, sc100-field-map.md, damages.md, sc104.md, hearing-script.md, etc.).',
    '- Do not give legal advice. Do not invent facts.',
    '- Keep replies short. Skip greetings. One or two questions at a time.'
  )

  return sections.filter((line) => line !== undefined).join('\n')
}

function buildUserMessageContent(message: string, uploads?: UploadedFile[]): string {
  const trimmed = message.trim()
  if (!uploads || uploads.length === 0) {
    return trimmed
  }
  const lines = uploads.map((upload) => {
    const size = formatBytes(upload.size)
    const mime = upload.mimeType ? `, ${upload.mimeType}` : ''
    return `- ${upload.relativePath} (${size}${mime})`
  })
  const attachmentBlock = [
    '[System note: the user just attached these files to the case workspace. They are saved on disk and you can inspect them with the run_workspace_command tool.]',
    ...lines
  ].join('\n')
  if (trimmed.length === 0) {
    return attachmentBlock
  }
  return `${trimmed}\n\n${attachmentBlock}`
}

function mimeTypeForPath(relativePath: string): string | undefined {
  const ext = path.extname(relativePath).toLowerCase()
  switch (ext) {
    case '.pdf':
      return 'application/pdf'
    case '.md':
      return 'text/markdown'
    case '.txt':
      return 'text/plain'
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return undefined
  }
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) {
    return '0 B'
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function buildToolResultMessage(command: string, result: SandboxRunResult): string {
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  const blocked = result.blockedEvents.join('\n').trim()

  const sections: string[] = [
    `Command: ${command}`,
    `Exit code: ${result.exitCode ?? 'unknown'}`
  ]
  if (stdout.length > 0) {
    sections.push(`stdout:\n${truncate(stdout, 2000)}`)
  }
  if (stderr.length > 0) {
    sections.push(`stderr:\n${truncate(stderr, 1000)}`)
  }
  if (blocked.length > 0) {
    sections.push(`sandbox blocked events:\n${blocked}`)
  }
  return sections.join('\n\n')
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit)}\n…[truncated ${value.length - limit} chars]`
}
