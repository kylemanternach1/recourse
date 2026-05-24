import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CaseRecord, UploadDraft, UploadedFile } from '../../shared/contracts'
import type { CaseStore } from './caseStore'

const UPLOADS_DIR = 'uploads'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel'
}

export class UploadManager {
  constructor(private readonly caseStore: CaseStore) {}

  async probe(sourcePaths: string[]): Promise<UploadDraft[]> {
    const drafts: UploadDraft[] = []
    for (const sourcePath of sourcePaths) {
      const stat = await fs.stat(sourcePath).catch(() => undefined)
      if (!stat || !stat.isFile()) {
        continue
      }
      const baseName = path.basename(sourcePath)
      drafts.push({
        name: baseName,
        absolutePath: sourcePath,
        size: stat.size,
        mimeType: MIME_BY_EXTENSION[path.extname(baseName).toLowerCase()]
      })
    }
    return drafts
  }

  async addUploads(caseId: string, sourcePaths: string[]): Promise<UploadedFile[]> {
    const record = await this.caseStore.get(caseId)
    if (!record) {
      throw new Error(`Unknown case: ${caseId}`)
    }

    const targetDir = path.join(record.workspace.path, UPLOADS_DIR)
    await fs.mkdir(targetDir, { recursive: true })

    const saved: UploadedFile[] = []
    for (const sourcePath of sourcePaths) {
      const file = await this.copyOne(record, sourcePath, targetDir)
      if (file) {
        saved.push(file)
      }
    }
    if (saved.length > 0) {
      await this.caseStore.touch(record.id)
    }
    return saved
  }

  private async copyOne(
    record: CaseRecord,
    sourcePath: string,
    targetDir: string
  ): Promise<UploadedFile | undefined> {
    const stat = await fs.stat(sourcePath).catch(() => undefined)
    if (!stat || !stat.isFile()) {
      return undefined
    }

    const sanitized = sanitizeFilename(path.basename(sourcePath))
    const finalName = await this.uniqueFilename(targetDir, sanitized)
    const targetPath = path.join(targetDir, finalName)
    await fs.copyFile(sourcePath, targetPath)

    const extension = path.extname(finalName).toLowerCase()
    return {
      name: finalName,
      relativePath: `${UPLOADS_DIR}/${finalName}`,
      absolutePath: targetPath,
      size: stat.size,
      mimeType: MIME_BY_EXTENSION[extension]
    }
  }

  private async uniqueFilename(dir: string, desired: string): Promise<string> {
    const ext = path.extname(desired)
    const stem = desired.slice(0, desired.length - ext.length)
    let candidate = desired
    let attempt = 1
    while (await pathExists(path.join(dir, candidate))) {
      candidate = `${stem}-${attempt}${ext}`
      attempt += 1
    }
    return candidate
  }
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\\/]/g, '_').replace(/\s+/g, ' ')
  const cleaned = trimmed.replace(/[^\w.\- ()]/g, '_')
  if (cleaned.length === 0) {
    return `file-${Date.now()}`
  }
  return cleaned.slice(0, 180)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
