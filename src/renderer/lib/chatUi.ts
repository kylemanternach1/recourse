import type { PersistedChatUi } from '../../shared/contracts'
import { normalizeChatMessages } from './chatNormalize'

export const WELCOME_MESSAGE_ID = 'welcome'

export interface ChatMessage {
  id: string
  role:
    | 'user'
    | 'assistant'
    | 'system'
    | 'tool-use'
    | 'file-download'
    | 'command-run'
    | 'phase-update'
    | 'file-read'
    | 'file-edit'
  content: string
  proposal?: import('../../shared/contracts').CommandProposal
  fileOffer?: import('../../shared/contracts').FileOffer
  commandRun?: import('../../shared/contracts').CommandRun
  phaseUpdate?: import('../../shared/contracts').PhaseUpdate
  fileRead?: import('../../shared/contracts').FileReadRecord
  fileEdit?: import('../../shared/contracts').FileEditRecord
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
        fileOffer: message.fileOffer,
        commandRun: message.commandRun,
        phaseUpdate: message.phaseUpdate,
        fileRead: message.fileRead,
        fileEdit: message.fileEdit,
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
    messages: normalizeChatMessages(ui.messages.map((message) => ({ ...message }))),
    pendingProposal: undefined,
    status: ui.status,
    statusMessage: ui.statusMessage
  }
}
