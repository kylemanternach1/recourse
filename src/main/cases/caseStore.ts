import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type {
  CaseRecord,
  CreateCaseRequest,
  SkillSummary,
  SmallClaimsIntake,
  WorkspaceInfo
} from '../../shared/contracts'
import { getCaseType } from './caseTypes'
import { WorkspaceManager } from '../workspaces/workspaceManager'
import { SkillSeeder } from '../skills/skillSeeder'

interface CaseStoreFile {
  version: 1
  cases: CaseRecord[]
}

const SC_100_CASE_TYPE_ID = 'sc-100-small-claims'

export class CaseStore {
  private cases: CaseRecord[] = []
  private loaded = false

  constructor(
    private readonly storeFilePath: string,
    private readonly workspaceManager: WorkspaceManager,
    private readonly skillSeeder: SkillSeeder
  ) {}

  async initialize(): Promise<void> {
    if (this.loaded) {
      return
    }

    await fs.mkdir(path.dirname(this.storeFilePath), { recursive: true })

    try {
      const raw = await fs.readFile(this.storeFilePath, 'utf8')
      const parsed = JSON.parse(raw) as CaseStoreFile
      this.cases = Array.isArray(parsed.cases) ? parsed.cases.filter(hasIntake) : []
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code && code !== 'ENOENT') {
        throw error
      }
      this.cases = []
    }

    this.loaded = true
  }

  async list(): Promise<CaseRecord[]> {
    await this.initialize()
    return [...this.cases].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  }

  async get(caseId: string): Promise<CaseRecord | undefined> {
    await this.initialize()
    return this.cases.find((record) => record.id === caseId)
  }

  async create(request: CreateCaseRequest): Promise<CaseRecord> {
    await this.initialize()

    const caseType = getCaseType(SC_100_CASE_TYPE_ID)
    if (!caseType) {
      throw new Error(`Missing case type: ${SC_100_CASE_TYPE_ID}`)
    }

    const id = randomUUID()
    const now = new Date().toISOString()
    const workspace: WorkspaceInfo = await this.workspaceManager.createWorkspace(
      request.title,
      buildWorkspaceReadme(request, caseType.name)
    )
    const skills: SkillSummary[] = await this.skillSeeder.seedIntoWorkspace(
      workspace.path,
      caseType.skillIds
    )

    await fs.writeFile(
      path.join(workspace.path, 'intake.md'),
      buildIntakeMarkdown(request.title, request.intake),
      'utf8'
    )

    const record: CaseRecord = {
      id,
      title: request.title.trim(),
      caseTypeId: caseType.id,
      policyPresetId: caseType.defaultPolicyPresetId,
      customDomains: [],
      workspace,
      skills,
      intake: request.intake,
      createdAt: now,
      updatedAt: now
    }

    this.cases.push(record)
    await this.persist()
    return record
  }

  async touch(caseId: string): Promise<void> {
    await this.initialize()
    const target = this.cases.find((record) => record.id === caseId)
    if (!target) {
      return
    }
    target.updatedAt = new Date().toISOString()
    await this.persist()
  }

  private async persist(): Promise<void> {
    const payload: CaseStoreFile = { version: 1, cases: this.cases }
    await fs.writeFile(this.storeFilePath, JSON.stringify(payload, null, 2), 'utf8')
  }
}

function hasIntake(record: CaseRecord): boolean {
  return Boolean(record.intake && typeof record.intake.plaintiffName === 'string')
}

function buildWorkspaceReadme(request: CreateCaseRequest, caseTypeName: string): string {
  const { intake } = request
  return [
    `# ${request.title}`,
    '',
    `**Case type:** ${caseTypeName}`,
    `**Plaintiff:** ${intake.plaintiffName} (${intake.plaintiffCity})`,
    `**Defendant:** ${intake.defendantName} (${formatDefendantType(intake.defendantType)})`,
    `**Amount claimed:** ${formatCurrency(intake.amountClaimed)}`,
    `**Incident date:** ${intake.incidentDate}`,
    '',
    '## What happened',
    '',
    intake.whatHappened.trim() || '_No description provided._',
    '',
    '## Files',
    '',
    '- `intake.md` — structured intake provided when the case was created.',
    '- `skills/` — installed skill folders (e.g. `sc-100-small-claims/`).',
    '- `draft/` — drafts of forms and documents (created by the agent).',
    ''
  ].join('\n')
}

function buildIntakeMarkdown(title: string, intake: SmallClaimsIntake): string {
  return [
    `# Intake — ${title}`,
    '',
    '## Plaintiff',
    `- Name: ${intake.plaintiffName}`,
    `- City: ${intake.plaintiffCity}`,
    '',
    '## Defendant',
    `- Name: ${intake.defendantName}`,
    `- Type: ${formatDefendantType(intake.defendantType)}`,
    '',
    '## Claim',
    `- Amount claimed: ${formatCurrency(intake.amountClaimed)}`,
    `- Incident date: ${intake.incidentDate}`,
    '',
    '## What happened',
    '',
    intake.whatHappened.trim() || '_No description provided._',
    '',
    '## Contact with defendant',
    `- Contacted defendant? ${intake.contactedDefendant ? 'Yes' : 'No'}`,
    intake.contactNotes && intake.contactNotes.trim().length > 0
      ? `- Notes: ${intake.contactNotes.trim()}`
      : '',
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function formatDefendantType(type: SmallClaimsIntake['defendantType']): string {
  switch (type) {
    case 'individual':
      return 'Individual'
    case 'business':
      return 'Business'
    case 'sole-proprietor':
      return 'Sole proprietor'
    default:
      return type
  }
}

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) {
    return '$0'
  }
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
