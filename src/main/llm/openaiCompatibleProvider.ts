import OpenAI from 'openai'
import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import type { LlmMessage, LlmToolCall } from '../../shared/contracts'

export const RUN_COMMAND_TOOL_NAME = 'run_workspace_command'

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
      'Run a single shell command inside the active case workspace and stream stdout/stderr back to the agent.',
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
      tools: [RUN_COMMAND_TOOL],
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
