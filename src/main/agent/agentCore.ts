import { randomUUID } from 'node:crypto'
import type {
  AgentEvent,
  ApprovalDecision,
  CaseRecord,
  CommandProposal,
  LlmMessage,
  LlmToolCall,
  SandboxPolicy,
  SandboxRunResult,
  SendMessageRequest,
  UploadedFile
} from '../../shared/contracts'
import type { CaseStore } from '../cases/caseStore'
import {
  EDIT_FILE_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  READ_ONLY_TOOL_NAMES,
  RUN_COMMAND_TOOL_NAME,
  type LlmProvider
} from '../llm/openaiCompatibleProvider'
import { editFile } from '../workspaces/workspaceFileEditor'
import { buildSandboxPolicy } from '../sandbox/policies'
import { SandboxRunner } from '../sandbox/sandboxRunner'
import { mountStatutesInWorkspace } from '../statutes/statuteMount'
import { loadAgentConversation, saveAgentConversation } from '../chat/chatPersistence'
import { readFileRange } from '../workspaces/workspaceFileReader'

const MAX_TOOL_ITERATIONS = 5

interface PendingTool {
  proposal: CommandProposal
  toolCall: LlmToolCall
  assistantTurn: LlmMessage
  /** True when streamTurn already appended the assistant message (e.g. mixed read-only + command). */
  assistantAlreadyPushed: boolean
}

interface CaseAgentState {
  caseRecord: CaseRecord
  policy: SandboxPolicy
  conversation: LlmMessage[]
  pendingTool?: PendingTool
  iterationsSinceUserMessage: number
}

export class AgentCore {
  private readonly states = new Map<string, CaseAgentState>()

  constructor(
    private readonly caseStore: CaseStore,
    private readonly sandboxRunner: SandboxRunner,
    private readonly llmProvider: LlmProvider,
    private readonly statutesCorpusDir: string,
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
    state.iterationsSinceUserMessage = 0
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

  async decideProposal(decision: ApprovalDecision): Promise<void> {
    const state = this.states.get(decision.caseId)
    if (!state?.pendingTool || state.pendingTool.proposal.id !== decision.proposalId) {
      throw new Error('No matching command proposal is pending.')
    }

    const { proposal, toolCall, assistantTurn, assistantAlreadyPushed } = state.pendingTool
    state.pendingTool = undefined
    if (!assistantAlreadyPushed) {
      state.conversation.push(assistantTurn)
    }

    if (!decision.approved) {
      state.conversation.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: 'The user rejected this command. No changes were made.'
      })

      this.emit({
        type: 'status',
        caseId: decision.caseId,
        status: 'running',
        message: 'Acknowledging your rejection...'
      })

      await this.runLoop(state)
      return
    }

    this.emit({
      type: 'status',
      caseId: decision.caseId,
      status: 'running',
      message: 'Running approved command...'
    })

    const result = await this.sandboxRunner.runCommand({
      command: proposal.command,
      cwd: proposal.cwd,
      policy: state.policy,
      onOutput: (stream, message) => {
        this.emit({ type: 'log', caseId: decision.caseId, stream, message })
        if (stream === 'sandbox' && message.toLowerCase().includes('blocked')) {
          this.emit({ type: 'blocked', caseId: decision.caseId, message })
        }
      }
    })

    state.conversation.push({
      role: 'tool',
      toolCallId: toolCall.id,
      content: buildToolResultMessage(proposal.command, result)
    })
    await this.persistConversation(state)

    this.emit({
      type: 'status',
      caseId: decision.caseId,
      status: 'running',
      message: 'Reading the command output...'
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

    while (state.iterationsSinceUserMessage < MAX_TOOL_ITERATIONS) {
      state.iterationsSinceUserMessage += 1

      const turnResult = await this.streamTurn(state)
      if (turnResult.status === 'error') {
        return
      }

      if (turnResult.status === 'tool-call') {
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

    const note = 'Paused after the maximum number of consecutive tool steps. Send another message to continue.'
    const messageId = randomUUID()
    this.emit({ type: 'message-start', caseId: state.caseRecord.id, messageId })
    this.emit({ type: 'message-delta', caseId: state.caseRecord.id, messageId, delta: note })
    this.emit({ type: 'message-end', caseId: state.caseRecord.id, messageId })
    this.emit({
      type: 'status',
      caseId: state.caseRecord.id,
      status: 'idle',
      message: 'Paused.'
    })
  }

  private async streamTurn(state: CaseAgentState): Promise<
    | { status: 'reply' }
    | { status: 'tool-call' }
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

    const readOnlyCalls = toolCalls.filter((tc) => READ_ONLY_TOOL_NAMES.has(tc.name))
    const runCommandCalls = toolCalls.filter((tc) => tc.name === RUN_COMMAND_TOOL_NAME)
    const unknownCalls = toolCalls.filter(
      (tc) => !READ_ONLY_TOOL_NAMES.has(tc.name) && tc.name !== RUN_COMMAND_TOOL_NAME
    )

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

    if (readOnlyCalls.length > 0) {
      state.conversation.push(assistantMessage)
      for (const toolCall of readOnlyCalls) {
        const result = await this.executeReadOnlyTool(state, toolCall)
        state.conversation.push({
          role: 'tool',
          toolCallId: toolCall.id,
          content: result
        })
      }
      await this.persistConversation(state)
    }

    if (readOnlyCalls.length > 0 && runCommandCalls.length === 0) {
      return { status: 'continue' }
    }

    const runCommandCall = runCommandCalls[0]
    if (!runCommandCall) {
      return { status: 'continue' }
    }

    let parsedArgs: { command?: string; reason?: string } = {}
    try {
      parsedArgs = JSON.parse(runCommandCall.arguments) as {
        command?: string
        reason?: string
      }
    } catch {
      parsedArgs = {}
    }

    if (!parsedArgs.command) {
      const note = 'The agent requested a tool call without a command.'
      this.emit({ type: 'error', caseId: state.caseRecord.id, message: note })
      this.emit({
        type: 'status',
        caseId: state.caseRecord.id,
        status: 'error',
        message: note
      })
      return { status: 'error' }
    }

    const proposal: CommandProposal = {
      id: randomUUID(),
      caseId: state.caseRecord.id,
      command: parsedArgs.command,
      cwd: state.caseRecord.workspace.path,
      reason: parsedArgs.reason ?? 'Run the proposed command.',
      createdAt: new Date().toISOString()
    }

    state.pendingTool = {
      proposal,
      toolCall: runCommandCall,
      assistantTurn: assistantMessage,
      assistantAlreadyPushed: readOnlyCalls.length > 0
    }

    this.emit({ type: 'proposal', caseId: state.caseRecord.id, proposal })
    this.emit({
      type: 'status',
      caseId: state.caseRecord.id,
      status: 'waiting-for-approval',
      message: 'Waiting for your approval to run the command.'
    })
    return { status: 'tool-call' }
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
        this.emit({
          type: 'log',
          caseId: state.caseRecord.id,
          stream: 'agent',
          message: `Read ${result.path} lines ${result.startLine}–${result.endLine} (${result.totalLines} total)`
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
        const action =
          result.mode === 'write'
            ? `Wrote ${result.path}`
            : `Edited ${result.path} (${result.replacements ?? 1} replacement(s))`
        this.emit({
          type: 'log',
          caseId: state.caseRecord.id,
          stream: 'agent',
          message: action
        })
        return `${action} (${result.bytesWritten} bytes)`
      }

      return `Unknown read-only tool: ${toolCall.name}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return `Error: ${message}`
    }
  }

  private async loadState(caseRecord: CaseRecord): Promise<CaseAgentState> {
    await mountStatutesInWorkspace(caseRecord.workspace.path, this.statutesCorpusDir)

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
      conversation: savedConversation ?? [],
      iterationsSinceUserMessage: 0
    }
    this.states.set(caseRecord.id, state)
    return state
  }

  private async persistConversation(state: CaseAgentState): Promise<void> {
    await saveAgentConversation(state.caseRecord.workspace.path, state.conversation)
  }
}

function buildSystemPrompt(state: CaseAgentState): string {
  const intake = state.caseRecord.intake
  const skillsBlock =
    state.caseRecord.skills.length === 0
      ? 'No skills are installed yet.'
      : state.caseRecord.skills
          .map((skill) => `- ${skill.id}: ${skill.description}`)
          .join('\n')

  const intakeStarted =
    intake.plaintiffName.trim().length > 0 ||
    intake.defendantName.trim().length > 0 ||
    intake.whatHappened.trim().length > 0 ||
    intake.amountClaimed > 0

  const intakeBlock = intakeStarted
    ? [
        'Known so far (update `intake.md` in the workspace when the plaintiff confirms new facts):',
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
        'Intake status: not started — the plaintiff has not submitted structured data yet.',
        'Conduct a conversational interview (see Intake interview below).'
      ].join('\n')

  return [
    'You are Recourse, a friendly California small claims copilot helping a self-represented plaintiff prepare an SC-100 case.',
    '',
    'Case context:',
    `- Title: ${state.caseRecord.title}`,
    `- Workspace path: ${state.caseRecord.workspace.path}`,
    '',
    intakeBlock,
    '',
    'Intake interview (your job — no forms in the UI):',
    '- The plaintiff describes their case in natural language. Extract facts from each message.',
    '- Collect over multiple turns (one or two questions at a time): case label/title, plaintiff full name & city, defendant name & type (individual / business / sole proprietor), amount claimed, incident date, narrative of what happened, whether they contacted the defendant, evidence notes.',
    '- Acknowledge what you understood before asking the next gap. Be typo-tolerant; clarify gently when unclear.',
    '- Do not dump a long questionnaire. Do not ask for information already provided.',
    '- When the plaintiff confirms a fact, update `intake.md` with edit_file so the record stays current.',
    '- When intake is sufficient, transition naturally to viability (cause of action, limits, statute of limitations), court routing, then artifacts (demand letter, SC-100, service plan).',
    '',
    'Installed skills (skill docs live in <workspace>/skills/<id>/SKILL.md):',
    skillsBlock,
    '',
    'Tools:',
    `- \`${RUN_COMMAND_TOOL_NAME}\` — run one shell command in the workspace (requires user approval). Use for rg, ls, and skill scripts.`,
    `- \`${READ_FILE_TOOL_NAME}\` — read a line range from a workspace file (auto). Always pass start_line and end_line; max 250 lines per call.`,
    `- \`${EDIT_FILE_TOOL_NAME}\` — create or edit workspace text files (auto). Use search_replace for targeted edits; use content for new files. Read first so old_string matches exactly. Do not edit statutes/ca/.`,
    '',
    'California statutes (mounted at `statutes/ca/`):',
    '- Search with ripgrep via run_workspace_command, e.g. `rg -n "small claims" statutes/ca/` or `rg -n "jurisdictional limit" "statutes/ca/CA Code - Code of Civil Procedure.txt"`.',
    '- Section numbers appear on their own line (e.g. `116.220.`). After rg returns line numbers, use read_file with a tight window (e.g. ±30 lines) — never cat entire code files.',
    '- See `statutes/README.md` for file names per code (CCP → `CA Code - Code of Civil Procedure.txt`).',
    '- Cite as "CCP §116.220" with leginfo URL: `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=116.220.&lawCode=CCP`. Never invent section numbers.',
    '- For small claims, start with CCP Chapter 5.5 and related CIV damages sections.',
    '',
    'Rules:',
    '- Prefer read_file + edit_file for text files. Use run_workspace_command for rg, binaries, and skill scripts only.',
    '- Default to plain replies when no file access is needed.',
    '- The shell command runs with cwd at the workspace path. Use relative paths.',
    "- Before using a skill, cat its SKILL.md (e.g. `cat skills/pdf/SKILL.md`) to learn the exact tooling and scripts it expects. Each skill's `scripts/` directory contains helpers you can invoke (e.g. `python skills/pdf/scripts/extract_form_field_info.py uploads/foo.pdf`).",
    '- For PDF work, prefer the `pdf` skill (pypdf, pdfplumber, qpdf, pdftoppm, tesseract).',
    '- For .docx work, prefer the `docx` skill (pandoc, docx-js, LibreOffice).',
    '- For .pptx work, prefer the `pptx` skill (markitdown, pptxgenjs, LibreOffice).',
    '- For .xlsx work, prefer the `xlsx` skill (openpyxl, LibreOffice).',
    '- User-attached files live in `uploads/`. When the user attaches a file, briefly acknowledge it and consider inspecting it (e.g. `ls uploads/`, `cat uploads/<name>`, `file uploads/<name>`) before drafting next steps.',
    '- Do not give legal advice. Do not invent facts the plaintiff did not provide.',
    '- Keep replies short and friendly. Use line breaks for readability.',
    '- Skip greetings and self-introductions. Respond directly to what the user just said — extract facts, then ask the next gap.'
  ].join('\n')
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
