import { promises as fs } from 'node:fs'
import { resolveWorkspaceFilePath } from './workspacePaths'

const MAX_LINES_PER_READ = 250

export interface ReadFileRangeResult {
  path: string
  startLine: number
  endLine: number
  totalLines: number
  content: string
  truncated: boolean
}

export async function readFileRange(
  workspacePath: string,
  relativePath: string,
  startLine: number,
  endLine: number
): Promise<ReadFileRangeResult> {
  const absolutePath = resolveWorkspaceFilePath(workspacePath, relativePath)
  const normalized = relativePath.replace(/^\/+/, '').trim()

  const start = Math.max(1, Math.floor(startLine))
  let end = Math.max(start, Math.floor(endLine))
  if (end - start + 1 > MAX_LINES_PER_READ) {
    end = start + MAX_LINES_PER_READ - 1
  }

  const raw = await fs.readFile(absolutePath, 'utf8')
  const lines = raw.split('\n')
  const totalLines = lines.length
  const slice = lines.slice(start - 1, end)
  const truncated = end < Math.min(totalLines, Math.floor(endLine))

  const numbered = slice.map((line, index) => `${start + index}|${line}`).join('\n')

  return {
    path: normalized,
    startLine: start,
    endLine: Math.min(end, totalLines),
    totalLines,
    content: numbered,
    truncated
  }
}
