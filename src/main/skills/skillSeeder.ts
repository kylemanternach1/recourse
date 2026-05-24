import fs from 'node:fs/promises'
import path from 'node:path'
import type { SkillSummary } from '../../shared/contracts'
import { SkillCatalog } from './skillCatalog'

export class SkillSeeder {
  constructor(private readonly catalog: SkillCatalog) {}

  async seedIntoWorkspace(workspacePath: string, skillIds: string[]): Promise<SkillSummary[]> {
    const skillsRoot = path.join(workspacePath, 'skills')
    await fs.mkdir(skillsRoot, { recursive: true })

    const seeded: SkillSummary[] = []
    for (const skillId of skillIds) {
      const skill = await this.catalog.getAsync(skillId)
      if (!skill) {
        continue
      }

      if (!(await this.catalog.exists(skillId))) {
        continue
      }

      const destination = path.join(skillsRoot, skillId)
      await copyDir(skill.sourcePath, destination)
      seeded.push({ id: skill.id, name: skill.name, description: skill.description })
    }

    await fs.writeFile(
      path.join(skillsRoot, 'README.md'),
      buildSkillsReadme(seeded),
      'utf8'
    )

    return seeded
  }
}

async function copyDir(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true })
  const entries = await fs.readdir(source, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)

    if (entry.isDirectory()) {
      await copyDir(sourcePath, destinationPath)
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath)
    }
  }
}

function buildSkillsReadme(skills: SkillSummary[]): string {
  if (skills.length === 0) {
    return '# Skills\n\nNo skills are installed for this case yet.\n'
  }

  const entries = skills
    .map((skill) => `- **${skill.name}** (\`${skill.id}\`): ${skill.description}`)
    .join('\n')

  return `# Skills available in this case\n\n${entries}\n\nThe agent reads each \`SKILL.md\` to learn how to use that skill.\n`
}
