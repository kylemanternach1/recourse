import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillSummary } from '../../shared/contracts'

export interface SkillDefinition extends SkillSummary {
  sourcePath: string
}

const skillIndex: Record<string, Omit<SkillDefinition, 'sourcePath'>> = {
  'sc-100-small-claims': {
    id: 'sc-100-small-claims',
    name: 'California Small Claims (SC-100)',
    description: 'Intake, damages worksheet, and filing guide for SC-100 small claims cases.'
  },
  general: {
    id: 'general',
    name: 'General Case Assistant',
    description: 'Baseline skill for cases without a specific filing template yet.'
  }
}

export class SkillCatalog {
  constructor(private readonly resourcesRoot: string) {}

  list(): SkillDefinition[] {
    return Object.values(skillIndex).map((entry) => ({
      ...entry,
      sourcePath: path.join(this.resourcesRoot, entry.id)
    }))
  }

  get(skillId: string): SkillDefinition | undefined {
    const entry = skillIndex[skillId]
    if (!entry) {
      return undefined
    }

    return {
      ...entry,
      sourcePath: path.join(this.resourcesRoot, entry.id)
    }
  }

  async exists(skillId: string): Promise<boolean> {
    const entry = this.get(skillId)
    if (!entry) {
      return false
    }

    try {
      const stat = await fs.stat(entry.sourcePath)
      return stat.isDirectory()
    } catch {
      return false
    }
  }
}
