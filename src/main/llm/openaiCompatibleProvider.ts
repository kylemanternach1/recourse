import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import type { LlmMessage, LlmToolCall } from '../../shared/contracts'

export const RUN_COMMAND_TOOL_NAME = 'run_workspace_command'
export const READ_FILE_TOOL_NAME = 'read_file'
export const EDIT_FILE_TOOL_NAME = 'edit_file'
export const UPDATE_CASE_STATE_TOOL_NAME = 'update_case_state'
export const OFFER_FILE_DOWNLOAD_TOOL_NAME = 'offer_file_download'

export const READ_ONLY_TOOL_NAMES = new Set([
  READ_FILE_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  UPDATE_CASE_STATE_TOOL_NAME,
  OFFER_FILE_DOWNLOAD_TOOL_NAME
])

export type LlmStreamEvent =
  | { type: 'content'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool-call'; toolCall: LlmToolCall }

export interface LlmStreamOptions {
  signal?: AbortSignal
}

export interface LlmProvider {
  isConfigured(): boolean
  stream(messages: LlmMessage[], options?: LlmStreamOptions): AsyncIterable<LlmStreamEvent>
}

const RUN_COMMAND_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: RUN_COMMAND_TOOL_NAME,
    description:
      'Run a single shell command inside the active case workspace (cwd is the workspace root). Executes immediately; output is shown in chat. Use for rg/grep, ls, and skill scripts. Prefer `rg -n` over grep for searching ca/statutes/ and other text.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to run. It will execute with cwd at the workspace path.'
        },
        reason: {
          type: 'string',
          description: 'A short user-facing explanation of what this command will do.'
        }
      },
      required: ['command', 'reason']
    }
  }
}

const READ_FILE_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: READ_FILE_TOOL_NAME,
    description:
      'Read a slice of a text file inside the case workspace by line number (1-based, inclusive). Use after rg finds line numbers. Never read whole large files — always pass a tight start_line/end_line window (max 250 lines per call).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path (e.g. ca/statutes/CA Code - Code of Civil Procedure.txt, ca/court_forms/sc100.pdf, skills/pdf/SKILL.md, uploads/foo.txt).'
        },
        start_line: {
          type: 'number',
          description: 'First line to read (1-based, inclusive).'
        },
        end_line: {
          type: 'number',
          description: 'Last line to read (1-based, inclusive).'
        }
      },
      required: ['path', 'start_line', 'end_line']
    }
  }
}

const EDIT_FILE_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: EDIT_FILE_TOOL_NAME,
    description:
      'Create or edit a text file in the case workspace. Prefer search_replace for small edits; use content for new files or full rewrites. Anything under ca/ is read-only. Read the target file first so old_string matches exactly.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path (e.g. intake.md, draft/demand-letter.md, draft/notes.txt).'
        },
        old_string: {
          type: 'string',
          description:
            'Exact text to replace (required with new_string). Must appear once unless replace_all is true.'
        },
        new_string: {
          type: 'string',
          description: 'Replacement text (use with old_string).'
        },
        replace_all: {
          type: 'boolean',
          description: 'Replace every occurrence of old_string (default false).'
        },
        content: {
          type: 'string',
          description:
            'Full file contents for create/overwrite. Do not combine with old_string/new_string.'
        }
      },
      required: ['path']
    }
  }
}

const UPDATE_CASE_STATE_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: UPDATE_CASE_STATE_TOOL_NAME,
    description:
      'Update case lifecycle phase status, wait states, artifacts, and optionally structured intake fields. Call when advance criteria for the current phase are met — do not only announce progress in chat. Auto-executes without user approval.',
    parameters: {
      type: 'object',
      properties: {
        current_phase: {
          type: 'string',
          description:
            'Set the active phase id (intake, eligibility, parties_venue, evidence_damages, forms, filing, service, hearing_prep, hearing, enforcement, closure). Usually inferred when marking a phase complete.'
        },
        phases: {
          type: 'array',
          description: 'Per-phase updates to merge into case lifecycle.',
          items: {
            type: 'object',
            properties: {
              phase_id: {
                type: 'string',
                description: 'Phase id to update.'
              },
              status: {
                type: 'string',
                enum: ['not_started', 'in_progress', 'waiting', 'blocked', 'complete', 'skipped']
              },
              next_action: {
                type: 'string',
                description: 'One-line next action for the plaintiff (current phase only). Pass empty string to clear.'
              },
              waiting_on: {
                type: 'string',
                description: 'What external event we are waiting for. Pass empty string to clear.'
              },
              waiting_since: {
                type: 'string',
                description: 'ISO timestamp when wait started. Omit to auto-set when entering waiting.'
              },
              expected_by: {
                type: 'string',
                description: 'ISO date or human deadline hint for the wait.'
              },
              artifacts: {
                type: 'array',
                description: 'Replace artifact list for this phase.',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    label: { type: 'string' },
                    kind: { type: 'string', enum: ['draft', 'evidence', 'filed', 'note'] },
                    created_at: { type: 'string' }
                  },
                  required: ['path', 'label', 'kind']
                }
              },
              append_artifacts: {
                type: 'array',
                description: 'Artifacts to add or update by path.',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    label: { type: 'string' },
                    kind: { type: 'string', enum: ['draft', 'evidence', 'filed', 'note'] },
                    created_at: { type: 'string' }
                  },
                  required: ['path', 'label', 'kind']
                }
              }
            },
            required: ['phase_id']
          }
        },
        intake: {
          type: 'object',
          description: 'Optional structured intake fields to merge when plaintiff confirms facts.',
          properties: {
            plaintiff_name: { type: 'string' },
            plaintiff_city: { type: 'string' },
            defendant_name: { type: 'string' },
            defendant_type: {
              type: 'string',
              enum: ['individual', 'business', 'sole-proprietor']
            },
            amount_claimed: { type: 'number' },
            incident_date: { type: 'string' },
            what_happened: { type: 'string' },
            contacted_defendant: { type: 'boolean' },
            contact_notes: { type: 'string' }
          }
        }
      }
    }
  }
}

const OFFER_FILE_DOWNLOAD_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: OFFER_FILE_DOWNLOAD_TOOL_NAME,
    description:
      'Surface a workspace file in the chat with a Download button for the plaintiff. Use after creating or filling a draft (e.g. draft/forms/sc100-filled.pdf, draft/demand-letter.md) or when sharing a generated PDF path. The file must already exist in the case workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description:
            'Workspace-relative path to the file (e.g. draft/forms/sc100-filled.pdf, draft/demand-letter.md, uploads/contract.pdf).'
        },
        label: {
          type: 'string',
          description: 'Short title shown on the download card (e.g. "Filled SC-100 PDF", "Demand letter").'
        },
        description: {
          type: 'string',
          description: 'Optional one-line note shown under the title.'
        }
      },
      required: ['path', 'label']
    }
  }
}

const AGENT_TOOLS: ChatCompletionTool[] = [
  RUN_COMMAND_TOOL,
  READ_FILE_TOOL,
  EDIT_FILE_TOOL,
  UPDATE_CASE_STATE_TOOL,
  OFFER_FILE_DOWNLOAD_TOOL
]

export class OpenAICompatibleProvider implements LlmProvider {
  private readonly client?: OpenAI
  private readonly model: string
  private readonly isOpenRouter: boolean
  private readonly reasoningEffort: 'low' | 'medium' | 'high' | 'off'

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const isOpenRouter = Boolean(env.OPENROUTER_API_KEY)
    const apiKey = env.OPENROUTER_API_KEY || env.OPENAI_API_KEY || env.LLM_API_KEY
    const baseURL =
      env.OPENROUTER_BASE_URL ||
      env.OPENAI_BASE_URL ||
      env.LLM_BASE_URL ||
      (isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined)
    const defaultHeaders = isOpenRouter
      ? {
          'HTTP-Referer': env.OPENROUTER_SITE_URL || 'https://recourse.local',
          'X-Title': env.OPENROUTER_APP_NAME || 'Recourse'
        }
      : undefined

    this.model =
      env.OPENROUTER_MODEL ||
      env.OPENAI_MODEL ||
      env.LLM_MODEL ||
      (isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini')
    this.client = apiKey ? new OpenAI({ apiKey, baseURL, defaultHeaders }) : undefined
    this.isOpenRouter = isOpenRouter
    this.reasoningEffort = parseReasoningEffort(env.OPENROUTER_REASONING || env.LLM_REASONING)
  }

  isConfigured(): boolean {
    return Boolean(this.client)
  }

  private buildReasoningParam(): { effort: 'low' | 'medium' | 'high' } | undefined {
    if (!this.isOpenRouter || this.reasoningEffort === 'off') {
      return undefined
    }
    return { effort: this.reasoningEffort }
  }

  async *stream(
    messages: LlmMessage[],
    options?: LlmStreamOptions
  ): AsyncIterable<LlmStreamEvent> {
    if (!this.client) {
      throw new Error('No OpenAI-compatible API key is configured.')
    }

    const reasoningParam = this.buildReasoningParam()
    const baseParams: ChatCompletionCreateParamsStreaming = {
      model: this.model,
      messages: messages.map(toOpenAIMessage),
      tools: AGENT_TOOLS,
      tool_choice: 'auto',
      stream: true
    }
    const params = reasoningParam
      ? ({ ...baseParams, reasoning: reasoningParam } as ChatCompletionCreateParamsStreaming)
      : baseParams
    const stream = await this.client.chat.completions.create(params, { signal: options?.signal })

    interface PartialToolCall {
      id?: string
      name?: string
      arguments: string
    }
    const partials: Record<number, PartialToolCall> = {}
    const yieldedToolCallIds = new Set<string>()

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta as
        | (typeof chunk.choices[0]['delta'] & {
            reasoning?: string | null
            reasoning_content?: string | null
          })
        | undefined
      if (!delta) {
        continue
      }

      const reasoningDelta =
        (typeof delta.reasoning === 'string' && delta.reasoning) ||
        (typeof delta.reasoning_content === 'string' && delta.reasoning_content) ||
        ''
      if (reasoningDelta.length > 0) {
        yield { type: 'reasoning', delta: reasoningDelta }
      }

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        yield { type: 'content', delta: delta.content }
      }

      if (delta.tool_calls && delta.tool_calls.length > 0) {
        for (const toolCallDelta of delta.tool_calls) {
          const index = toolCallDelta.index
          const current = (partials[index] ??= { arguments: '' })
          if (toolCallDelta.id) {
            current.id = toolCallDelta.id
          }
          if (toolCallDelta.function?.name) {
            current.name = toolCallDelta.function.name
          }
          if (toolCallDelta.function?.arguments) {
            current.arguments += toolCallDelta.function.arguments
          }
        }
      }

      const finishReason = chunk.choices[0]?.finish_reason
      if (finishReason) {
        for (const partial of Object.values(partials)) {
          if (!partial.id || !partial.name) {
            continue
          }
          if (yieldedToolCallIds.has(partial.id)) {
            continue
          }
          yieldedToolCallIds.add(partial.id)
          yield {
            type: 'tool-call',
            toolCall: {
              id: partial.id,
              name: partial.name,
              arguments: partial.arguments
            }
          }
        }
      }
    }
  }
}

function parseReasoningEffort(raw: string | undefined): 'low' | 'medium' | 'high' | 'off' {
  const normalized = (raw ?? '').trim().toLowerCase()
  if (normalized === 'off' || normalized === 'none' || normalized === 'false' || normalized === '0') {
    return 'off'
  }
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized
  }
  return 'medium'
}

function toOpenAIMessage(message: LlmMessage): ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId ?? '',
      content: message.content ?? ''
    }
  }

  if (message.role === 'assistant') {
    if (message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments
          }
        }))
      }
    }
    return {
      role: 'assistant',
      content: message.content ?? ''
    }
  }

  if (message.role === 'system') {
    return {
      role: 'system',
      content: message.content ?? ''
    }
  }

  return {
    role: 'user',
    content: message.content ?? ''
  }
}
