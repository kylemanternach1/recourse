import type { PhaseId, PhaseStatus, PhaseUpdate } from '../../shared/contracts'
import { PHASE_ORDER } from '../../shared/lifecycle'
import type { ChatMessage } from './chatUi'

/** Legacy agent log before structured phase-update events. */
export const LEGACY_PHASE_LOG =
  /^Case phase → ([\w_]+) \((\w+)\)(?:\s+Next:\s*(.+))?$/

const PHASE_STATUSES: PhaseStatus[] = [
  'not_started',
  'in_progress',
  'waiting',
  'blocked',
  'complete',
  'skipped'
]

function isPhaseId(value: string): value is PhaseId {
  return (PHASE_ORDER as string[]).includes(value)
}

function isPhaseStatus(value: string): value is PhaseStatus {
  return PHASE_STATUSES.includes(value as PhaseStatus)
}

export function isLegacyPhaseLog(content: string): boolean {
  return LEGACY_PHASE_LOG.test(content)
}

export function parseLegacyPhaseLog(content: string, messageId: string): PhaseUpdate | null {
  const match = content.match(LEGACY_PHASE_LOG)
  if (!match) {
    return null
  }
  const phaseId = match[1]
  const status = match[2]
  if (!isPhaseId(phaseId) || !isPhaseStatus(status)) {
    return null
  }
  const nextAction = match[3]?.trim()
  return {
    id: messageId,
    phaseId,
    status,
    nextAction: nextAction && nextAction.length > 0 ? nextAction : undefined,
    at: new Date().toISOString()
  }
}

export function toolUseToPhaseUpdate(message: ChatMessage): PhaseUpdate | null {
  if (message.role !== 'tool-use') {
    return null
  }
  return parseLegacyPhaseLog(message.content, message.id)
}

/** Convert persisted legacy phase log lines into phase-update cards. */
export function normalizePhaseMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const update = toolUseToPhaseUpdate(message)
    if (!update) {
      return message
    }
    return {
      id: message.id,
      role: 'phase-update',
      content: update.phaseId,
      phaseUpdate: update
    }
  })
}

/** Find the chat message that last recorded a change to this phase. */
export function findPhaseAnchorMessageId(
  messages: ChatMessage[],
  phaseId: PhaseId
): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'phase-update' && message.phaseUpdate?.phaseId === phaseId) {
      return message.id
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'tool-use') {
      continue
    }
    const match = message.content.match(LEGACY_PHASE_LOG)
    if (match && match[1] === phaseId) {
      return message.id
    }
  }

  return undefined
}

export function canJumpToPhaseInChat(messages: ChatMessage[], phaseId: PhaseId): boolean {
  return findPhaseAnchorMessageId(messages, phaseId) !== undefined
}
