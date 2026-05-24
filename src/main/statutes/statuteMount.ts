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

const CORPUS_CANARY = 'CA Code - Code of Civil Procedure.txt'

export function resolveStatutesCorpusDir(
  appPath: string,
  isPackaged: boolean,
  userData: string
): string {
  if (!isPackaged) {
    return path.join(appPath, 'resources', 'statutes', 'ca')
  }
  return path.join(userData, 'statutes', 'ca')
}

export async function isCorpusReady(corpusDir: string): Promise<boolean> {
  try {
    await fs.access(path.join(corpusDir, CORPUS_CANARY))
    return true
  } catch {
    return false
  }
}

export function urlFor(code: string, section: string): string {
  const normalizedCode = code.toUpperCase()
  const normalizedSection = section.replace(/\.$/, '')
  return `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=${normalizedSection}.&lawCode=${normalizedCode}`
}

/** Symlink the shared CA statute corpus into <workspace>/statutes/ca. */
export async function mountStatutesInWorkspace(
  workspacePath: string,
  corpusDir: string
): Promise<boolean> {
  const statutesRoot = path.join(workspacePath, 'statutes')
  const mountPoint = path.join(statutesRoot, 'ca')

  if (await isCorpusReady(corpusDir)) {
    await fs.mkdir(statutesRoot, { recursive: true })
    try {
      await fs.rm(mountPoint, { recursive: true, force: true })
    } catch {
      // ignore
    }
    await fs.symlink(corpusDir, mountPoint, 'dir')
    await fs.writeFile(
      path.join(statutesRoot, 'README.md'),
      buildStatutesReadme(true),
      'utf8'
    )
    return true
  }

  await fs.mkdir(statutesRoot, { recursive: true })
  await fs.writeFile(path.join(statutesRoot, 'README.md'), buildStatutesReadme(false), 'utf8')
  return false
}

function buildStatutesReadme(mounted: boolean): string {
  const codeList = Object.entries(CODE_NAMES)
    .map(([abbr, name]) => `- **${abbr}** — \`statutes/ca/CA Code - ${name}.txt\``)
    .join('\n')

  return [
    '# California statutes',
    '',
    mounted
      ? 'The full CA code corpus is mounted at `statutes/ca/` (read-only symlink).'
      : 'Statute corpus is **not installed** on this machine. Run `./scripts/sync-skills.sh --statutes` from the Recourse repo, then create a new case.',
    '',
    '## Search with ripgrep (`rg`)',
    '',
    'Use `run_workspace_command` from the workspace root. Examples:',
    '',
    '```bash',
    'rg -n "small claims" statutes/ca/',
    'rg -n "jurisdictional limit" "statutes/ca/CA Code - Code of Civil Procedure.txt"',
    'rg -n "^116\\.220\\." "statutes/ca/CA Code - Code of Civil Procedure.txt"',
    '```',
    '',
    'Section numbers appear on their own line (e.g. `116.220.`). After `rg` gives you a line number, use `read_file` with a tight line range — do not `cat` entire code files.',
    '',
    '## Codes available',
    '',
    codeList,
    '',
    '## Official citations (leginfo)',
    '',
    'When citing a section, use the form **CCP §116.220** and link:',
    '`https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=116.220.&lawCode=CCP`',
    '',
    'For small claims, start with **CCP** (Chapter 5.5) and related **CIV** damages sections.',
    ''
  ].join('\n')
}
