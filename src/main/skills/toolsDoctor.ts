import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { ToolCheck, ToolCheckResult } from '../../shared/contracts'
import { prependRuntimePath, resolveRuntimePaths } from './runtimePaths'

/** Binaries the document skills shell out to. */
const SYSTEM_BINARIES: Array<Omit<ToolCheck, 'available' | 'path'>> = [
  {
    name: 'rg',
    purpose: 'Ripgrep — fast search over ca/statutes/ and workspace text (used by the agent via shell).',
    installHint: 'brew install ripgrep'
  },
  {
    name: 'qpdf',
    purpose: 'Command-line PDF merge/split/rotate/encrypt.',
    installHint: 'brew install qpdf'
  },
  {
    name: 'pdftoppm',
    purpose: 'Render PDF pages to images (provided by Poppler).',
    installHint: 'brew install poppler'
  },
  {
    name: 'tesseract',
    purpose: 'OCR for scanned PDFs.',
    installHint: 'brew install tesseract'
  },
  {
    name: 'soffice',
    purpose: 'Headless LibreOffice for docx/pptx/xlsx ↔ PDF conversion.',
    installHint: 'brew install --cask libreoffice'
  },
  {
    name: 'pandoc',
    purpose: 'docx/markdown conversion.',
    installHint: 'brew install pandoc'
  }
]

/** Project-local runtime markers we can detect by file existence. */
const RUNTIME_TOOLS: Array<{ id: string; purpose: string; installHint: string; relativeBin: 'venvBin' | 'nodeBin'; file: string }> = [
  {
    id: 'python-venv',
    purpose: 'Project Python venv with pypdf/pdfplumber/openpyxl/etc.',
    installHint: 'Run ./scripts/sync-skills.sh',
    relativeBin: 'venvBin',
    file: 'python'
  },
  {
    id: 'node-skills',
    purpose: 'Local Node packages (docx, pptxgenjs).',
    installHint: 'Run ./scripts/sync-skills.sh',
    relativeBin: 'nodeBin',
    file: 'docx'
  }
]

const SKILLS_TO_DETECT = ['pdf', 'docx', 'pptx', 'xlsx']

export class ToolsDoctor {
  constructor(
    private readonly resourcesRoot: string,
    private readonly caResourcesDir: string
  ) {}

  async check(): Promise<ToolCheckResult> {
    const tools = await this.checkBinaries()
    const skills = await this.checkSkills()
    const statutesReady = await pathExists(
      path.join(this.caResourcesDir, 'statutes', 'CA Code - Code of Civil Procedure.txt')
    )
    const runtimeReady =
      statutesReady &&
      tools.some((tool) => tool.name === 'rg' && tool.available) &&
      tools.every((tool) =>
        tool.name === 'soffice' || tool.name === 'pandoc' ? true : tool.available
      )
    return { tools, skills, statutesReady, runtimeReady }
  }

  private async checkBinaries(): Promise<ToolCheck[]> {
    const augmentedPath = prependRuntimePath(process.env.PATH)
    const pathEntries = augmentedPath.split(path.delimiter).filter(Boolean)
    const results: ToolCheck[] = []

    for (const tool of SYSTEM_BINARIES) {
      const located = await findOnPath(tool.name, pathEntries)
      results.push({
        name: tool.name,
        purpose: tool.purpose,
        installHint: tool.installHint,
        available: Boolean(located),
        path: located
      })
    }

    const runtime = resolveRuntimePaths()
    for (const tool of RUNTIME_TOOLS) {
      const targetDir = tool.relativeBin === 'venvBin' ? runtime.venvBin : runtime.nodeBin
      const candidate = path.join(targetDir, tool.file)
      const exists = await pathExists(candidate)
      results.push({
        name: tool.id,
        purpose: tool.purpose,
        installHint: tool.installHint,
        available: exists,
        path: exists ? candidate : undefined
      })
    }

    return results
  }

  private async checkSkills(): Promise<Array<{ id: string; available: boolean }>> {
    const results: Array<{ id: string; available: boolean }> = []
    for (const skillId of SKILLS_TO_DETECT) {
      const candidate = path.join(this.resourcesRoot, skillId, 'SKILL.md')
      results.push({ id: skillId, available: await pathExists(candidate) })
    }
    return results
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function findOnPath(binary: string, pathEntries: string[]): Promise<string | undefined> {
  for (const entry of pathEntries) {
    const candidate = path.join(entry, binary)
    if (await pathExists(candidate)) {
      return candidate
    }
  }
  return undefined
}
