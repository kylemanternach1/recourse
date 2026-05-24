import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillSummary } from '../../shared/contracts'

export interface SkillDefinition extends SkillSummary {
  sourcePath: string
}

/**
 * Static metadata for skills that ship in this repo. Anything discovered on disk
 * that isn't listed here will still surface, using its `name` frontmatter field.
 */
const STATIC_DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  'sc-100-small-claims': {
    name: 'California Small Claims (SC-100)',
    description: 'Intake, damages worksheet, and filing guide for SC-100 small claims cases.'
  },
  pdf: {
    name: 'PDF tooling',
    description:
      'Read, extract, fill, merge, split, rotate, watermark, encrypt, OCR, and create PDFs.'
  },
  docx: {
    name: 'Word document tooling',
    description: 'Create, read, edit, and convert .docx files (Word documents).'
  },
  pptx: {
    name: 'PowerPoint tooling',
    description: 'Create, read, edit, and convert .pptx files (PowerPoint presentations).'
  },
  xlsx: {
    name: 'Excel tooling',
    description: 'Read, edit, and convert .xlsx files (Excel spreadsheets).'
  }
}

/**
 * Walks the resources/skills directory, treating each subdirectory that contains
 * a SKILL.md as an installed skill. Results are cached for the lifetime of the
 * catalog instance.
 */
export class SkillCatalog {
  private cache?: Promise<SkillDefinition[]>

  constructor(private readonly resourcesRoot: string) {}

  private async load(): Promise<SkillDefinition[]> {
    if (!this.cache) {
      this.cache = (async () => {
        let entries: import('node:fs').Dirent[]
        try {
          entries = await fs.readdir(this.resourcesRoot, { withFileTypes: true })
        } catch {
          return []
        }

        const skills: SkillDefinition[] = []
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const sourcePath = path.join(this.resourcesRoot, entry.name)
          const skillFile = path.join(sourcePath, 'SKILL.md')
          let frontmatter: { name?: string; description?: string } = {}
          try {
            const raw = await fs.readFile(skillFile, 'utf8')
            frontmatter = parseFrontmatter(raw)
          } catch {
            continue
          }

          const fallback = STATIC_DESCRIPTIONS[entry.name]
          skills.push({
            id: entry.name,
            name: frontmatter.name ?? fallback?.name ?? entry.name,
            description: frontmatter.description ?? fallback?.description ?? '',
            sourcePath
          })
        }
        skills.sort((a, b) => a.id.localeCompare(b.id))
        return skills
      })()
    }
    return this.cache
  }

  async list(): Promise<SkillDefinition[]> {
    return this.load()
  }

  /** Synchronous best-effort lookup using only static metadata; used by code paths
   *  that can't await. Prefer `getAsync` when possible. */
  get(skillId: string): SkillDefinition | undefined {
    const meta = STATIC_DESCRIPTIONS[skillId]
    if (!meta) {
      return undefined
    }
    return {
      id: skillId,
      name: meta.name,
      description: meta.description,
      sourcePath: path.join(this.resourcesRoot, skillId)
    }
  }

  async getAsync(skillId: string): Promise<SkillDefinition | undefined> {
    const all = await this.load()
    return all.find((skill) => skill.id === skillId)
  }

  async exists(skillId: string): Promise<boolean> {
    const skill = await this.getAsync(skillId)
    if (!skill) {
      return false
    }
    try {
      const stat = await fs.stat(skill.sourcePath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }

  /** Clear the in-memory cache so the next call re-scans the disk. Use after running
   *  the sync script while the app is open. */
  invalidate(): void {
    this.cache = undefined
  }
}

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n/

function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const match = raw.match(FRONTMATTER_PATTERN)
  if (!match) {
    return {}
  }

  const body = match[1]
  const result: { name?: string; description?: string } = {}
  // Single-line `key: value` pairs only. Values may be quoted; the description
  // can be a long quoted string that wraps several lines via a quoted block.
  const lines = body.split('\n')
  let current: 'name' | 'description' | undefined
  let buffer = ''
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, '')
    const keyMatch = line.match(/^(name|description|license):\s*(.*)$/)
    if (keyMatch) {
      if (current) {
        result[current] = stripQuotes(buffer.trim())
      }
      const [, key, value] = keyMatch
      if (key === 'name' || key === 'description') {
        current = key
        buffer = value
      } else {
        current = undefined
        buffer = ''
      }
    } else if (current) {
      buffer += ` ${line.trim()}`
    }
  }
  if (current) {
    result[current] = stripQuotes(buffer.trim())
  }
  return result
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1)
    }
  }
  return value
}
