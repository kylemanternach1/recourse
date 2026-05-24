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
import { emptyIntake } from '../../shared/intake'
import { getCaseType } from './caseTypes'
import { WorkspaceManager } from '../workspaces/workspaceManager'
import { SkillSeeder } from '../skills/skillSeeder'
import { mountStatutesInWorkspace } from '../statutes/statuteMount'

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
    private readonly skillSeeder: SkillSeeder,
    private readonly statutesCorpusDir: string
  ) {}

  async initialize(): Promise<void> {
    if (this.loaded) {
      return
    }

    await fs.mkdir(path.dirname(this.storeFilePath), { recursive: true })

    try {
      const raw = await fs.readFile(this.storeFilePath, 'utf8')
      const parsed = JSON.parse(raw) as CaseStoreFile
      this.cases = Array.isArray(parsed.cases) ? parsed.cases.filter(isValidCaseRecord) : []
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

  async patchIntake(caseId: string, patch: Partial<SmallClaimsIntake>): Promise<CaseRecord | undefined> {
    await this.initialize()
    const target = this.cases.find((record) => record.id === caseId)
    if (!target) {
      return undefined
    }

    target.intake = { ...target.intake, ...patch }
    if (patch.whatHappened?.trim() && target.title === 'New case') {
      const snippet = patch.whatHappened.trim().slice(0, 48)
      target.title = snippet.length < patch.whatHappened.trim().length ? `${snippet}…` : snippet
    }
    target.updatedAt = new Date().toISOString()
    await fs.writeFile(
      path.join(target.workspace.path, 'intake.md'),
      buildIntakeMarkdown(target.title, target.intake),
      'utf8'
    )
    await this.persist()
    return target
  }

  async create(request: CreateCaseRequest = {}): Promise<CaseRecord> {
    await this.initialize()

    const caseType = getCaseType(SC_100_CASE_TYPE_ID)
    if (!caseType) {
      throw new Error(`Missing case type: ${SC_100_CASE_TYPE_ID}`)
    }

    const intake = request.intake ?? emptyIntake()
    const title = (request.title ?? 'New case').trim() || 'New case'

    const id = randomUUID()
    const now = new Date().toISOString()
    const workspace: WorkspaceInfo = await this.workspaceManager.createWorkspace(
      title,
      buildWorkspaceReadme(title, intake, caseType.name)
    )
    const skills: SkillSummary[] = await this.skillSeeder.seedIntoWorkspace(
      workspace.path,
      caseType.skillIds
    )
    await mountStatutesInWorkspace(workspace.path, this.statutesCorpusDir)

    await fs.writeFile(
      path.join(workspace.path, 'intake.md'),
      buildIntakeMarkdown(title, intake),
      'utf8'
    )

    const record: CaseRecord = {
      id,
      title,
      caseTypeId: caseType.id,
      policyPresetId: caseType.defaultPolicyPresetId,
      customDomains: [],
      workspace,
      skills,
      intake,
      createdAt: now,
      updatedAt: now
    }

    this.cases.push(record)
    await this.persist()
    return record
  }

  /** Delete every case, workspace folder, and persisted store (dev reset). */
  async resetAll(): Promise<void> {
    await this.initialize()
    const workspacePaths = this.cases.map((record) => record.workspace.path)
    this.cases = []
    await this.persist()

    for (const workspacePath of workspacePaths) {
      try {
        await fs.rm(workspacePath, { recursive: true, force: true })
      } catch (error) {
        console.warn(`[recourse] Could not remove workspace ${workspacePath}:`, error)
      }
    }
    await this.workspaceManager.resetAll()
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

function isValidCaseRecord(record: CaseRecord): boolean {
  return Boolean(record?.id && record.workspace?.path && record.intake)
}

function buildWorkspaceReadme(
  title: string,
  intake: SmallClaimsIntake,
  caseTypeName: string
): string {
  const intakeStarted = isIntakeStarted(intake)
  return [
    `# ${title}`,
    '',
    `**Case type:** ${caseTypeName}`,
    intakeStarted
      ? [
          `**Plaintiff:** ${intake.plaintiffName || '—'} (${intake.plaintiffCity || '—'})`,
          `**Defendant:** ${intake.defendantName || '—'} (${formatDefendantType(intake.defendantType)})`,
          `**Amount claimed:** ${formatCurrency(intake.amountClaimed)}`,
          `**Incident date:** ${intake.incidentDate || '—'}`
        ].join('\n')
      : '_Intake in progress — details are collected in chat and saved to `intake.md`._',
    '',
    '## What happened',
    '',
    intake.whatHappened.trim() || '_No description yet._',
    '',
    '## Files',
    '',
    '- `intake.md` — structured intake (updated as the conversation progresses).',
    '- `skills/` — installed skill folders (e.g. `sc-100-small-claims/`).',
    '- `statutes/ca/` — California code corpus (search with `rg`, read slices with `read_file`).',
    '- `draft/` — drafts of forms and documents (created by the agent).',
    ''
  ].join('\n')
}

function isIntakeStarted(intake: SmallClaimsIntake): boolean {
  return (
    intake.plaintiffName.trim().length > 0 ||
    intake.defendantName.trim().length > 0 ||
    intake.whatHappened.trim().length > 0 ||
    intake.amountClaimed > 0
  )
}

function buildIntakeMarkdown(title: string, intake: SmallClaimsIntake): string {
  if (!isIntakeStarted(intake)) {
    return [
      `# Intake — ${title}`,
      '',
      '_In progress. The agent collects details in conversation and updates this file as facts are confirmed._',
      ''
    ].join('\n')
  }

  return [
    `# Intake — ${title}`,
    '',
    '## Plaintiff',
    `- Name: ${intake.plaintiffName || '—'}`,
    `- City: ${intake.plaintiffCity || '—'}`,
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
