import path from 'node:path'

const READ_ONLY_PREFIXES = ['statutes/ca/']

export function normalizeWorkspaceRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/^\/+/, '').trim()
  if (normalized.length === 0) {
    throw new Error('path is required')
  }
  if (normalized.includes('..')) {
    throw new Error('path must stay inside the workspace (no .. segments)')
  }
  for (const prefix of READ_ONLY_PREFIXES) {
    if (normalized === prefix.slice(0, -1) || normalized.startsWith(prefix)) {
      throw new Error(`${prefix} is read-only`)
    }
  }
  return normalized
}

export function resolveWorkspaceFilePath(workspacePath: string, relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  const absolutePath = path.resolve(workspacePath, normalized)
  const resolvedWorkspace = path.resolve(workspacePath)
  if (
    absolutePath !== resolvedWorkspace &&
    !absolutePath.startsWith(resolvedWorkspace + path.sep)
  ) {
    throw new Error('path must be inside the case workspace')
  }
  return absolutePath
}
