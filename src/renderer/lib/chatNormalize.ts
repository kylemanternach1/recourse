import type { ChatMessage } from './chatUi'
import { normalizeFileToolMessages } from './fileToolChat'
import { normalizePhaseMessages } from './phaseChat'

/** Upgrade legacy tool-use log lines to structured transcript cards. */
export function normalizeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return normalizeFileToolMessages(normalizePhaseMessages(messages))
}
