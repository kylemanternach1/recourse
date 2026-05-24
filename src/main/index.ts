import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import type {
  ApprovalDecision,
  CreateCaseRequest,
  SendMessageRequest,
  SmallClaimsIntake
} from '../shared/contracts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.join(app.getAppPath(), '.env') })
dotenv.config({ path: path.join(process.cwd(), '.env') })
import { AgentCore } from './agent/agentCore'
import { ChatService } from './chat/chatService'
import { CaseStore } from './cases/caseStore'
import { CASE_TYPES } from './cases/caseTypes'
import { UploadManager } from './cases/uploadManager'
import { OpenAICompatibleProvider } from './llm/openaiCompatibleProvider'
import { POLICY_PRESETS } from './sandbox/policies'
import { SandboxRunner } from './sandbox/sandboxRunner'
import { SkillCatalog } from './skills/skillCatalog'
import { SkillSeeder } from './skills/skillSeeder'
import { ToolsDoctor } from './skills/toolsDoctor'
import { isCorpusReady, resolveStatutesCorpusDir } from './statutes/statuteMount'
import { WorkspaceManager } from './workspaces/workspaceManager'

let mainWindow: BrowserWindow | undefined
let agentCore: AgentCore | undefined
let caseStore: CaseStore | undefined
let uploadManager: UploadManager | undefined
let toolsDoctor: ToolsDoctor | undefined
let chatService: ChatService | undefined

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
  const statutesCorpusDir = resolveStatutesCorpusDir(
    app.getAppPath(),
    app.isPackaged,
    app.getPath('userData')
  )
  caseStore = new CaseStore(
    path.join(app.getPath('userData'), 'cases.json'),
    workspaceManager,
    skillSeeder,
    statutesCorpusDir
  )
  uploadManager = new UploadManager(caseStore)
  chatService = new ChatService(caseStore)
  toolsDoctor = new ToolsDoctor(resourcesRoot, statutesCorpusDir)
  const llmProvider = new OpenAICompatibleProvider()
  if (!llmProvider.isConfigured()) {
    console.warn(
      '[recourse] No LLM credentials found. Set OPENROUTER_API_KEY (or OPENAI_API_KEY) in .env to enable the agent.'
    )
  } else {
    console.log('[recourse] LLM provider configured.')
  }
  void isCorpusReady(statutesCorpusDir).then((ready) => {
    if (!ready) {
      console.warn(
        '[recourse] CA statute corpus not installed. Run ./scripts/sync-skills.sh --statutes'
      )
    }
  })
  agentCore = new AgentCore(
    caseStore,
    new SandboxRunner(),
    llmProvider,
    statutesCorpusDir,
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
ipcMain.handle('tools:check', async () => {
  if (!toolsDoctor) {
    throw new Error('Tools doctor not ready.')
  }
  return toolsDoctor.check()
})

ipcMain.handle('case:list', async () => {
  if (!caseStore) {
    throw new Error('Case store not ready.')
  }
  return caseStore.list()
})

ipcMain.handle('chat:list-conversations', async () => {
  if (!chatService) {
    throw new Error('Chat service not ready.')
  }
  return chatService.listConversations()
})

ipcMain.handle('chat:load-ui', async (_, caseId: string) => {
  if (!chatService) {
    throw new Error('Chat service not ready.')
  }
  return chatService.loadUi(caseId)
})

ipcMain.handle('chat:save-ui', async (_, caseId: string, ui: import('../shared/contracts').PersistedChatUi) => {
  if (!chatService) {
    throw new Error('Chat service not ready.')
  }
  await chatService.saveUi(caseId, ui)
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

ipcMain.handle('dev:reset', async () => {
  if (!caseStore || !agentCore) {
    throw new Error('App is not ready.')
  }
  agentCore.resetSession()
  await caseStore.resetAll()
  const remaining = await caseStore.list()
  if (remaining.length > 0) {
    throw new Error('Reset incomplete — case data is still on disk.')
  }
})

ipcMain.handle(
  'case:patch-intake',
  async (_, caseId: string, patch: Partial<SmallClaimsIntake>) => {
    if (!caseStore) {
      throw new Error('Case store not ready.')
    }
    return caseStore.patchIntake(caseId, patch)
  }
)

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

ipcMain.handle('case:select-uploads', async () => {
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
  return uploadManager.probe(result.filePaths)
})

ipcMain.handle('case:probe-uploads', async (_, sourcePaths: string[]) => {
  if (!uploadManager) {
    throw new Error('Upload manager not ready.')
  }
  return uploadManager.probe(sourcePaths)
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
