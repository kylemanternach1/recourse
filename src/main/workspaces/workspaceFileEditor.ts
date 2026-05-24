import { promises as fs } from 'node:fs'
import path from 'node:path'
import { normalizeWorkspaceRelativePath, resolveWorkspaceFilePath } from './workspacePaths'

const MAX_WRITE_BYTES = 512_000
const MAX_OLD_STRING_BYTES = 64_000

export interface EditFileResult {
  path: string
  mode: 'search_replace' | 'write'
  replacements?: number
  bytesWritten: number
  isNewFile?: boolean
  /** Previous file body before a write (for UI diff). */
  previousContent?: string
  /** Text removed or replaced (patch or full previous file). */
  oldText?: string
  /** Text added or the new file body. */
  newText?: string
}

export async function editFile(
  workspacePath: string,
  relativePath: string,
  options: {
    old_string?: string
    new_string?: string
    replace_all?: boolean
    content?: string
  }
): Promise<EditFileResult> {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  const absolutePath = resolveWorkspaceFilePath(workspacePath, normalized)

  if (options.content != null) {
    if (options.old_string != null || options.new_string != null) {
      throw new Error('Use either content (full write) or old_string/new_string (search_replace), not both')
    }
    const bytes = Buffer.byteLength(options.content, 'utf8')
    if (bytes > MAX_WRITE_BYTES) {
      throw new Error(`content exceeds max write size (${MAX_WRITE_BYTES} bytes)`)
    }
    let isNewFile = false
    let previousContent: string | undefined
    try {
      previousContent = await fs.readFile(absolutePath, 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        isNewFile = true
      } else {
        throw error
      }
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, options.content, 'utf8')
    return {
      path: normalized,
      mode: 'write',
      bytesWritten: bytes,
      isNewFile,
      previousContent,
      oldText: previousContent,
      newText: options.content
    }
  }

  if (options.old_string == null || options.new_string == null) {
    throw new Error('edit_file requires old_string and new_string, or content for a full write')
  }

  const oldBytes = Buffer.byteLength(options.old_string, 'utf8')
  if (oldBytes > MAX_OLD_STRING_BYTES) {
    throw new Error(`old_string exceeds max size (${MAX_OLD_STRING_BYTES} bytes)`)
  }

  let existing: string
  try {
    existing = await fs.readFile(absolutePath, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error(`file not found: ${normalized}`)
    }
    throw error
  }

  const occurrences = countOccurrences(existing, options.old_string)
  if (occurrences === 0) {
    throw new Error('old_string not found in file — read the file first and match exact text')
  }
  if (occurrences > 1 && !options.replace_all) {
    throw new Error(
      `old_string matched ${occurrences} times — make old_string more specific or set replace_all to true`
    )
  }

  const updated = options.replace_all
    ? existing.split(options.old_string).join(options.new_string)
    : existing.replace(options.old_string, options.new_string)

  const bytes = Buffer.byteLength(updated, 'utf8')
  if (bytes > MAX_WRITE_BYTES) {
    throw new Error(`resulting file exceeds max size (${MAX_WRITE_BYTES} bytes)`)
  }

  await fs.writeFile(absolutePath, updated, 'utf8')
  return {
    path: normalized,
    mode: 'search_replace',
    replacements: options.replace_all ? occurrences : 1,
    bytesWritten: bytes,
    oldText: options.old_string,
    newText: options.new_string
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0
  }
  let count = 0
  let index = 0
  while (true) {
    const found = haystack.indexOf(needle, index)
    if (found === -1) {
      break
    }
    count += 1
    index = found + needle.length
  }
  return count
}
