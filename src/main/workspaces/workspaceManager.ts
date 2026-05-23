import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WorkspaceInfo } from '../../shared/contracts'

export class WorkspaceManager {
  constructor(private readonly basePath: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true })
  }

  async createWorkspace(displayName?: string, readme?: string): Promise<WorkspaceInfo> {
    await this.initialize()

    const id = randomUUID()
    const safeName = sanitizeName(displayName ?? 'case')
    const workspacePath = path.join(this.basePath, `${safeName}-${id.slice(0, 8)}`)
    const createdAt = new Date().toISOString()

    await fs.mkdir(workspacePath, { recursive: true })
    await fs.writeFile(
      path.join(workspacePath, 'README.md'),
      readme ?? `# ${safeName}\n\nCreated by Recourse at ${createdAt}.\n`,
      'utf8'
    )

    return {
      id,
      name: safeName,
      path: workspacePath,
      createdAt
    }
  }
}

function sanitizeName(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized.length > 0 ? sanitized : 'case'
}
