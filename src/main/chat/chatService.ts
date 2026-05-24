import type {
  CaseRecord,
  ConversationListItem,
  PersistedChatUi
} from '../../shared/contracts'
import { conversationTitle } from '../../shared/intake'
import type { CaseStore } from '../cases/caseStore'
import { lastMessagePreview, loadChatUi, saveChatUi } from './chatPersistence'

export class ChatService {
  constructor(private readonly caseStore: CaseStore) {}

  async listConversations(): Promise<ConversationListItem[]> {
    const cases = await this.caseStore.list()
    const items: ConversationListItem[] = []
    for (const record of cases) {
      const ui = await loadChatUi(record.workspace.path)
      items.push({
        caseId: record.id,
        title: conversationTitle(record),
        preview:
          ui?.lastPreview ??
          (ui?.messages.length ? lastMessagePreview(ui.messages) : undefined),
        updatedAt: record.updatedAt
      })
    }
    return items
  }

  async loadUi(caseId: string): Promise<PersistedChatUi | undefined> {
    const record = await this.caseStore.get(caseId)
    if (!record) {
      return undefined
    }
    return loadChatUi(record.workspace.path)
  }

  async saveUi(caseId: string, ui: PersistedChatUi): Promise<void> {
    const record = await this.caseStore.get(caseId)
    if (!record) {
      throw new Error(`Unknown case: ${caseId}`)
    }
    const payload: PersistedChatUi = {
      ...ui,
      lastPreview: lastMessagePreview(ui.messages) ?? ui.lastPreview
    }
    await saveChatUi(record.workspace.path, payload)
    await this.caseStore.touch(caseId)
  }

  async getCase(caseId: string): Promise<CaseRecord | undefined> {
    return this.caseStore.get(caseId)
  }
}
