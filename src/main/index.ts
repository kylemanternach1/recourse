import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import type {
  ApprovalDecision,
  CreateCaseRequest,
  SendMessageRequest
} from '../shared/contracts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.join(app.getAppPath(), '.env') })
dotenv.config({ path: path.join(process.cwd(), '.env') })
import { AgentCore } from './agent/agentCore'
import { CaseStore } from './cases/caseStore'
import { CASE_TYPES } from './cases/caseTypes'
import { UploadManager } from './cases/uploadManager'
import { OpenAICompatibleProvider } from './llm/openaiCompatibleProvider'
import { POLICY_PRESETS } from './sandbox/policies'
import { SandboxRunner } from './sandbox/sandboxRunner'
import { SkillCatalog } from './skills/skillCatalog'
import { SkillSeeder } from './skills/skillSeeder'
import { WorkspaceManager } from './workspaces/workspaceManager'

let mainWindow: BrowserWindow | undefined
let agentCore: AgentCore | undefined
let caseStore: CaseStore | undefined
let uploadManager: UploadManager | undefined

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Recourse',
    backgroundColor: '#0d1118',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function resolveResourcesRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'skills')
  }

  return path.join(app.getAppPath(), 'resources', 'skills')
}

function bootstrap(): void {
  const resourcesRoot = resolveResourcesRoot()
  const workspaceManager = new WorkspaceManager(path.join(app.getPath('userData'), 'workspaces'))
  const skillCatalog = new SkillCatalog(resourcesRoot)
  const skillSeeder = new SkillSeeder(skillCatalog)
  caseStore = new CaseStore(
    path.join(app.getPath('userData'), 'cases.json'),
    workspaceManager,
    skillSeeder
  )
  uploadManager = new UploadManager(caseStore)
  const llmProvider = new OpenAICompatibleProvider()
  if (!llmProvider.isConfigured()) {
    console.warn(
      '[recourse] No LLM credentials found. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in .env to enable the agent.'
    )
  } else {
    console.log('[recourse] LLM provider configured.')
  }
  agentCore = new AgentCore(
    caseStore,
    new SandboxRunner(),
    llmProvider,
    (event) => mainWindow?.webContents.send('agent:event', event)
  )
}

app.whenReady().then(() => {
  bootstrap()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('policy:list', () => POLICY_PRESETS)
ipcMain.handle('case-type:list', () => CASE_TYPES)

ipcMain.handle('case:list', async () => {
  if (!caseStore) {
    throw new Error('Case store not ready.')
  }
  return caseStore.list()
})

ipcMain.handle('case:get', async (_, caseId: string) => {
  if (!caseStore) {
    throw new Error('Case store not ready.')
  }
  return caseStore.get(caseId)
})

ipcMain.handle('case:create', async (_, request: CreateCaseRequest) => {
  if (!caseStore) {
    throw new Error('Case store not ready.')
  }
  return caseStore.create(request)
})

ipcMain.handle('case:open-workspace', async (_, caseId: string) => {
  if (!caseStore) {
    throw new Error('Case store not ready.')
  }
  const record = await caseStore.get(caseId)
  if (!record) {
    return false
  }
  await shell.openPath(record.workspace.path)
  return true
})

ipcMain.handle('case:select-uploads', async (_, caseId: string) => {
  if (!uploadManager) {
    throw new Error('Upload manager not ready.')
  }
  if (!mainWindow) {
    throw new Error('Main window not ready.')
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Attach files',
    properties: ['openFile', 'multiSelections'],
    buttonLabel: 'Attach'
  })
  if (result.canceled || result.filePaths.length === 0) {
    return []
  }
  return uploadManager.addUploads(caseId, result.filePaths)
})

ipcMain.handle(
  'case:add-uploads',
  async (_, caseId: string, sourcePaths: string[]) => {
    if (!uploadManager) {
      throw new Error('Upload manager not ready.')
    }
    return uploadManager.addUploads(caseId, sourcePaths)
  }
)

ipcMain.handle('agent:send-message', async (_, request: SendMessageRequest) => {
  if (!agentCore) {
    throw new Error('Agent core is not ready.')
  }
  await agentCore.sendMessage(request)
})

ipcMain.handle('agent:decide-proposal', async (_, decision: ApprovalDecision) => {
  if (!agentCore) {
    throw new Error('Agent core is not ready.')
  }
  await agentCore.decideProposal(decision)
})
