import { promises as fs } from 'node:fs'
import path from 'node:path'

export const CODE_NAMES: Record<string, string> = {
  CONS: 'California Constitution',
  BPC: 'Business and Professions Code',
  CIV: 'Civil Code',
  CCP: 'Code of Civil Procedure',
  COM: 'Commercial Code',
  CORP: 'Corporations Code',
  EDC: 'Education Code',
  ELEC: 'Elections Code',
  EVID: 'Evidence Code',
  FAM: 'Family Code',
  FIN: 'Financial Code',
  FGC: 'Fish and Game Code',
  FAC: 'Food and Agricultural Code',
  GOV: 'Government Code',
  HNC: 'Harbors and Navigation Code',
  HSC: 'Health and Safety Code',
  INS: 'Insurance Code',
  LAB: 'Labor Code',
  MVC: 'Military and Veterans Code',
  PEN: 'Penal Code',
  PROB: 'Probate Code',
  PCC: 'Public Contract Code',
  PRC: 'Public Resources Code',
  PUC: 'Public Utilities Code',
  RTC: 'Revenue and Taxation Code',
  SHC: 'Streets and Highways Code',
  UIC: 'Unemployment Insurance Code',
  VEH: 'Vehicle Code',
  WAT: 'Water Code',
  WIC: 'Welfare and Institutions Code'
}

const STATUTES_CANARY = path.join('statutes', 'CA Code - Code of Civil Procedure.txt')
const COURT_FORMS_DIR = 'court_forms'
const WORKFLOW_DIR = 'small_claims_workflow'
const STATUTES_SUBDIR = 'statutes'

export const CA_MOUNT_DIR = 'ca'

/**
 * Where the shipped/bundled `resources/ca/` directory lives on disk.
 * In dev that's the repo's `resources/ca/`. In packaged builds we copy it
 * under userData so it stays writable from the installer.
 */
export function resolveCaResourcesDir(
  appPath: string,
  isPackaged: boolean,
  userData: string
): string {
  if (!isPackaged) {
    return path.join(appPath, 'resources', 'ca')
  }
  return path.join(userData, 'ca')
}

export async function isStatutesReady(caResourcesDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(caResourcesDir, STATUTES_CANARY))
    return true
  } catch {
    return false
  }
}

export async function isCourtFormsReady(caResourcesDir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(caResourcesDir, COURT_FORMS_DIR))
    return stat.isDirectory()
  } catch {
    return false
  }
}

export function urlFor(code: string, section: string): string {
  const normalizedCode = code.toUpperCase()
  const normalizedSection = section.replace(/\.$/, '')
  return `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=${normalizedSection}.&lawCode=${normalizedCode}`
}

/**
 * Mount the shared CA resources into `<workspace>/ca/`.
 *
 * Each subfolder (`statutes/`, `court_forms/`, `small_claims_workflow/`)
 * is symlinked individually so missing pieces degrade gracefully and the
 * README/canary we drop alongside them lives on real disk.
 */
export async function mountCaResourcesInWorkspace(
  workspacePath: string,
  caResourcesDir: string
): Promise<{
  statutes: boolean
  courtForms: boolean
  workflow: boolean
}> {
  const caRoot = path.join(workspacePath, CA_MOUNT_DIR)
  await fs.rm(caRoot, { recursive: true, force: true })
  await fs.mkdir(caRoot, { recursive: true })

  const [statutesReady, courtFormsReady] = await Promise.all([
    isStatutesReady(caResourcesDir),
    isCourtFormsReady(caResourcesDir)
  ])

  const targets: Array<{ subdir: string; mounted: boolean }> = [
    { subdir: STATUTES_SUBDIR, mounted: statutesReady },
    { subdir: COURT_FORMS_DIR, mounted: courtFormsReady },
    { subdir: WORKFLOW_DIR, mounted: await dirExists(path.join(caResourcesDir, WORKFLOW_DIR)) }
  ]

  for (const target of targets) {
    if (!target.mounted) continue
    await fs.symlink(
      path.join(caResourcesDir, target.subdir),
      path.join(caRoot, target.subdir),
      'dir'
    )
  }

  await fs.writeFile(path.join(caRoot, 'README.md'), buildCaReadme(statutesReady, courtFormsReady), 'utf8')

  return {
    statutes: statutesReady,
    courtForms: courtFormsReady,
    workflow: targets[2].mounted
  }
}

async function dirExists(target: string): Promise<boolean> {
  try {
    const stat = await fs.stat(target)
    return stat.isDirectory()
  } catch {
    return false
  }
}

function buildCaReadme(statutesMounted: boolean, courtFormsMounted: boolean): string {
  const codeList = Object.entries(CODE_NAMES)
    .map(([abbr, name]) => `- **${abbr}** — \`ca/statutes/CA Code - ${name}.txt\``)
    .join('\n')

  return [
    '# California reference material',
    '',
    'Read-only resources mounted by Recourse. Do not edit files under `ca/`.',
    '',
    '## Layout',
    '',
    statutesMounted
      ? '- `ca/statutes/` — full CA code corpus (one `.txt` per code).'
      : '- `ca/statutes/` — **not installed**. Run `./scripts/sync-skills.sh --statutes` from the repo.',
    courtFormsMounted
      ? '- `ca/court_forms/` — official Judicial Council PDF forms (SC-100, SC-104, SC-105, etc.).'
      : '- `ca/court_forms/` — missing from the bundle.',
    '- `ca/small_claims_workflow/` — plain-text walkthrough split by phase (eligibility → enforcement).',
    '',
    '## Searching statutes',
    '',
    '```bash',
    'rg -n "small claims" ca/statutes/',
    'rg -n "jurisdictional limit" "ca/statutes/CA Code - Code of Civil Procedure.txt"',
    'rg -n "^116\\.220\\." "ca/statutes/CA Code - Code of Civil Procedure.txt"',
    '```',
    '',
    'Section numbers appear on their own line (e.g. `116.220.`). After `rg` returns a line number, use `read_file` with a tight range — never `cat` whole code files.',
    '',
    '## Codes available',
    '',
    codeList,
    '',
    '## Citations',
    '',
    'Cite as **CCP §116.220** and link `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=116.220.&lawCode=CCP`.',
    ''
  ].join('\n')
}
