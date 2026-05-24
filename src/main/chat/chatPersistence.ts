import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AgentStatus, LlmMessage, PersistedChatUi } from '../../shared/contracts'

const CHAT_DIR = '.recourse'
const CHAT_UI_FILE = 'chat-ui.json'
const AGENT_FILE = 'agent-conversation.json'

function chatDir(workspacePath: string): string {
  return path.join(workspacePath, CHAT_DIR)
}

function chatUiPath(workspacePath: string): string {
  return path.join(chatDir(workspacePath), CHAT_UI_FILE)
}

function agentPath(workspacePath: string): string {
  return path.join(chatDir(workspacePath), AGENT_FILE)
}

export async function loadChatUi(workspacePath: string): Promise<PersistedChatUi | undefined> {
  try {
    const raw = await fs.readFile(chatUiPath(workspacePath), 'utf8')
    const parsed = JSON.parse(raw) as PersistedChatUi
    if (!Array.isArray(parsed.messages)) {
      return undefined
    }
    return parsed
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function saveChatUi(workspacePath: string, ui: PersistedChatUi): Promise<void> {
  await fs.mkdir(chatDir(workspacePath), { recursive: true })
  await fs.writeFile(chatUiPath(workspacePath), JSON.stringify(ui, null, 2), 'utf8')
}

export async function loadAgentConversation(workspacePath: string): Promise<LlmMessage[] | undefined> {
  try {
    const raw = await fs.readFile(agentPath(workspacePath), 'utf8')
    const parsed = JSON.parse(raw) as { messages?: LlmMessage[] }
    return Array.isArray(parsed.messages) ? parsed.messages : undefined
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

export async function saveAgentConversation(
  workspacePath: string,
  messages: LlmMessage[]
): Promise<void> {
  await fs.mkdir(chatDir(workspacePath), { recursive: true })
  await fs.writeFile(agentPath(workspacePath), JSON.stringify({ messages }, null, 2), 'utf8')
}

export function lastMessagePreview(messages: PersistedChatUi['messages']): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'tool-use') {
      continue
    }
    const text = message.content.trim()
    if (text.length > 0) {
      return text.length > 80 ? `${text.slice(0, 80)}…` : text
    }
  }
  return undefined
}

export function defaultChatUiStatus(): { status: AgentStatus; statusMessage: string } {
  return { status: 'idle', statusMessage: 'Ready when you are.' }
}
