import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AgentEvent,
  ApprovalDecision,
  CaseRecord,
  CaseTypeOption,
  CreateCaseRequest,
  PolicyPreset,
  SendMessageRequest,
  UploadedFile
} from '../shared/contracts'

const api = {
  getPolicyPresets: (): Promise<PolicyPreset[]> => ipcRenderer.invoke('policy:list'),
  getCaseTypes: (): Promise<CaseTypeOption[]> => ipcRenderer.invoke('case-type:list'),
  listCases: (): Promise<CaseRecord[]> => ipcRenderer.invoke('case:list'),
  getCase: (caseId: string): Promise<CaseRecord | undefined> =>
    ipcRenderer.invoke('case:get', caseId),
  createCase: (request: CreateCaseRequest): Promise<CaseRecord> =>
    ipcRenderer.invoke('case:create', request),
  openCaseWorkspace: (caseId: string): Promise<boolean> =>
    ipcRenderer.invoke('case:open-workspace', caseId),
  selectUploads: (caseId: string): Promise<UploadedFile[]> =>
    ipcRenderer.invoke('case:select-uploads', caseId),
  addUploadsFromPaths: (caseId: string, sourcePaths: string[]): Promise<UploadedFile[]> =>
    ipcRenderer.invoke('case:add-uploads', caseId, sourcePaths),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  sendMessage: (request: SendMessageRequest): Promise<void> =>
    ipcRenderer.invoke('agent:send-message', request),
  decideProposal: (decision: ApprovalDecision): Promise<void> =>
    ipcRenderer.invoke('agent:decide-proposal', decision),
  onAgentEvent: (listener: (event: AgentEvent) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: AgentEvent): void => listener(event)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  }
}

contextBridge.exposeInMainWorld('recourse', api)

export type RecourseApi = typeof api
