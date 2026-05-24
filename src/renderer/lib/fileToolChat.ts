import type { FileEditRecord, FileReadRecord } from '../../shared/contracts'
import type { ChatMessage } from './chatUi'

/** Legacy: `Read draft/foo.md lines 1–5 (49 total)` */
export const LEGACY_READ_LOG =
  /^Read (.+?) lines (\d+)[–-](\d+) \((\d+) total\)$/

/** Legacy: `Wrote path (123 bytes)` or `Wrote path` */
export const LEGACY_WROTE_LOG = /^Wrote (.+?)(?: \((\d+) bytes\))?$/

/** Legacy: `Created path` */
export const LEGACY_CREATED_LOG = /^Created (.+?)(?: \((\d+) bytes\))?$/

/** Legacy: `Edited path (2 replacement(s))` */
export const LEGACY_EDITED_LOG = /^Edited (.+?) \((\d+) replacement\(s\)\)(?: \((\d+) bytes\))?$/

export function isLegacyFileToolLog(content: string): boolean {
  return (
    LEGACY_READ_LOG.test(content) ||
    LEGACY_WROTE_LOG.test(content) ||
    LEGACY_CREATED_LOG.test(content) ||
    LEGACY_EDITED_LOG.test(content)
  )
}

export function parseLegacyFileRead(content: string, messageId: string): FileReadRecord | null {
  const match = content.match(LEGACY_READ_LOG)
  if (!match) {
    return null
  }
  return {
    id: messageId,
    path: match[1].trim(),
    startLine: Number.parseInt(match[2], 10),
    endLine: Number.parseInt(match[3], 10),
    totalLines: Number.parseInt(match[4], 10),
    lines: [],
    truncated: false
  }
}

export function parseLegacyFileEdit(content: string, messageId: string): FileEditRecord | null {
  let path: string | undefined
  let kind: FileEditRecord['kind'] | undefined
  let replacements: number | undefined

  const created = content.match(LEGACY_CREATED_LOG)
  if (created) {
    path = created[1].trim()
    kind = 'create'
  }

  const wrote = content.match(LEGACY_WROTE_LOG)
  if (wrote) {
    path = wrote[1].trim()
    kind = 'overwrite'
  }

  const edited = content.match(LEGACY_EDITED_LOG)
  if (edited) {
    path = edited[1].trim()
    kind = 'patch'
    replacements = Number.parseInt(edited[2], 10)
  }

  if (!path || !kind) {
    return null
  }

  return {
    id: messageId,
    path,
    kind,
    replacements,
    truncated: false
  }
}

export function toolUseToFileRead(message: ChatMessage): FileReadRecord | null {
  if (message.role !== 'tool-use') {
    return null
  }
  return parseLegacyFileRead(message.content, message.id)
}

export function toolUseToFileEdit(message: ChatMessage): FileEditRecord | null {
  if (message.role !== 'tool-use') {
    return null
  }
  return parseLegacyFileEdit(message.content, message.id)
}

export function normalizeFileToolMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const read = toolUseToFileRead(message)
    if (read) {
      return { id: message.id, role: 'file-read', content: read.path, fileRead: read }
    }
    const edit = toolUseToFileEdit(message)
    if (edit) {
      return { id: message.id, role: 'file-edit', content: edit.path, fileEdit: edit }
    }
    return message
  })
}
