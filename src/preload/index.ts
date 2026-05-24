import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AgentEvent,
  CaseRecord,
  CaseTypeOption,
  CreateCaseRequest,
  ConversationListItem,
  PersistedChatUi,
  PolicyPreset,
  SendMessageRequest,
  ToolCheckResult,
  UploadDraft,
  UploadedFile
} from '../shared/contracts'

const api = {
  getPolicyPresets: (): Promise<PolicyPreset[]> => ipcRenderer.invoke('policy:list'),
  getCaseTypes: (): Promise<CaseTypeOption[]> => ipcRenderer.invoke('case-type:list'),
  checkTools: (): Promise<ToolCheckResult> => ipcRenderer.invoke('tools:check'),
  listCases: (): Promise<CaseRecord[]> => ipcRenderer.invoke('case:list'),
  listConversations: (): Promise<ConversationListItem[]> =>
    ipcRenderer.invoke('chat:list-conversations'),
  loadChatUi: (caseId: string): Promise<PersistedChatUi | undefined> =>
    ipcRenderer.invoke('chat:load-ui', caseId),
  saveChatUi: (caseId: string, ui: PersistedChatUi): Promise<void> =>
    ipcRenderer.invoke('chat:save-ui', caseId, ui),
  getCase: (caseId: string): Promise<CaseRecord | undefined> =>
    ipcRenderer.invoke('case:get', caseId),
  createCase: (request: CreateCaseRequest): Promise<CaseRecord> =>
    ipcRenderer.invoke('case:create', request),
  resetDevData: (): Promise<void> => ipcRenderer.invoke('dev:reset'),
  openCaseWorkspace: (caseId: string): Promise<boolean> =>
    ipcRenderer.invoke('case:open-workspace', caseId),
  openWorkspaceFile: (caseId: string, relativePath: string): Promise<string> =>
    ipcRenderer.invoke('workspace:open-file', caseId, relativePath),
  saveWorkspaceDownload: (
    caseId: string,
    relativePath: string,
    suggestedName?: string
  ): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke('workspace:save-download', caseId, relativePath, suggestedName),
  selectUploads: (): Promise<UploadDraft[]> => ipcRenderer.invoke('case:select-uploads'),
  probeUploads: (sourcePaths: string[]): Promise<UploadDraft[]> =>
    ipcRenderer.invoke('case:probe-uploads', sourcePaths),
  commitUploads: (caseId: string, sourcePaths: string[]): Promise<UploadedFile[]> =>
    ipcRenderer.invoke('case:add-uploads', caseId, sourcePaths),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  sendMessage: (request: SendMessageRequest): Promise<void> =>
    ipcRenderer.invoke('agent:send-message', request),
  onAgentEvent: (listener: (event: AgentEvent) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: AgentEvent): void => listener(event)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  }
}

contextBridge.exposeInMainWorld('recourse', api)

export type RecourseApi = typeof api
