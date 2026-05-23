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
import { RUN_COMMAND_TOOL_NAME, type LlmProvider } from '../llm/openaiCompatibleProvider'
import { buildSandboxPolicy } from '../sandbox/policies'
import { SandboxRunner } from '../sandbox/sandboxRunner'

const MAX_TOOL_ITERATIONS = 5

interface PendingTool {
  proposal: CommandProposal
  toolCall: LlmToolCall
  assistantTurn: LlmMessage
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
    private readonly emit: (event: AgentEvent) => void
  ) {}

  async sendMessage(request: SendMessageRequest): Promise<void> {
    const caseRecord = await this.caseStore.get(request.caseId)
    if (!caseRecord) {
      throw new Error(`Unknown case: ${request.caseId}`)
    }

    const state = await this.loadState(caseRecord)
    const userContent = buildUserMessageContent(request.message, request.uploads)
    state.conversation.push({ role: 'user', content: userContent })
    state.iterationsSinceUserMessage = 0
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

    const { proposal, toolCall, assistantTurn } = state.pendingTool
    state.pendingTool = undefined
    state.conversation.push(assistantTurn)

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
      return { status: 'reply' }
    }

    const runCommandCall = toolCalls.find((tc) => tc.name === RUN_COMMAND_TOOL_NAME)
    if (!runCommandCall) {
      const unsupported = `Unsupported tool call(s): ${toolCalls.map((tc) => tc.name).join(', ')}`
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
      assistantTurn: {
        role: 'assistant',
        content: textBuffer.length > 0 ? textBuffer : null,
        toolCalls
      }
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

  private async loadState(caseRecord: CaseRecord): Promise<CaseAgentState> {
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
    const state: CaseAgentState = {
      caseRecord,
      policy,
      conversation: [],
      iterationsSinceUserMessage: 0
    }
    this.states.set(caseRecord.id, state)
    return state
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

  const intakeBlock = [
    `- Plaintiff: ${intake.plaintiffName} (${intake.plaintiffCity})`,
    `- Defendant: ${intake.defendantName} (${intake.defendantType})`,
    `- Amount claimed: $${intake.amountClaimed}`,
    `- Incident date: ${intake.incidentDate}`,
    `- What happened: ${intake.whatHappened}`,
    `- Contacted defendant: ${intake.contactedDefendant ? 'yes' : 'no'}${
      intake.contactNotes ? ` (${intake.contactNotes})` : ''
    }`
  ].join('\n')

  return [
    'You are Recourse, a friendly desktop assistant helping a self-represented plaintiff prepare a California small claims (SC-100) case.',
    '',
    'Case context:',
    `- Title: ${state.caseRecord.title}`,
    `- Workspace path: ${state.caseRecord.workspace.path}`,
    '',
    'Intake provided by the plaintiff:',
    intakeBlock,
    '',
    'Installed skills (skill docs live in <workspace>/skills/<id>/SKILL.md):',
    skillsBlock,
    '',
    `You can call the \`${RUN_COMMAND_TOOL_NAME}\` function to run a single shell command in the case workspace whenever you need to read or write files. Otherwise just reply directly in natural language.`,
    '',
    'Rules:',
    '- Only call the tool when you actually need to touch files. Default to plain replies.',
    '- The shell command runs with cwd at the workspace path. Use relative paths.',
    '- User-attached files live in `uploads/`. When the user attaches a file, briefly acknowledge it and consider inspecting it (e.g. `ls uploads/`, `cat uploads/<name>`, `file uploads/<name>`) before drafting next steps.',
    '- Do not give legal advice. Do not invent facts the plaintiff did not provide.',
    '- Keep replies short and friendly. Use line breaks for readability.'
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
