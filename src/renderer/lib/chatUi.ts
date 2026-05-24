import type { PersistedChatUi } from '../../shared/contracts'

export const WELCOME_MESSAGE_ID = 'welcome'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool-use'
  content: string
  proposal?: import('../../shared/contracts').CommandProposal
  streaming?: boolean
  reasoning?: string
  reasoningStreaming?: boolean
  reasoningExpanded?: boolean
  uploads?: import('../../shared/contracts').UploadedFile[]
}

export interface CaseUiState {
  messages: ChatMessage[]
  pendingProposal?: import('../../shared/contracts').CommandProposal
  status: import('../../shared/contracts').AgentStatus
  statusMessage: string
}

export const defaultUiState: CaseUiState = {
  messages: [],
  status: 'idle',
  statusMessage: 'Ready when you are.'
}

export function toPersisted(ui: CaseUiState): PersistedChatUi {
  return {
    messages: ui.messages
      .filter((message) => message.id !== WELCOME_MESSAGE_ID)
      .filter((message) => !message.streaming && !message.reasoningStreaming)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        proposal: message.proposal,
        reasoning: message.reasoning,
        reasoningExpanded: message.reasoningExpanded,
        uploads: message.uploads
      })),
    status: ui.status,
    statusMessage: ui.statusMessage
  }
}

export function fromPersisted(ui: PersistedChatUi): CaseUiState {
  return {
    messages: ui.messages.map((message) => ({ ...message })),
    pendingProposal: undefined,
    status: ui.status,
    statusMessage: ui.statusMessage
  }
}
