import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type {
  AgentEvent,
  CaseRecord,
  CommandProposal,
  ConversationListItem,
  UploadDraft,
  UploadedFile
} from '../shared/contracts'
import { intakeSummaryLine } from '../shared/intake'
import { ChatSidebar } from './components/ChatSidebar'
import { useSidebarCollapse } from './hooks/useSidebarCollapse'
import {
  type CaseUiState,
  type ChatMessage,
  defaultUiState,
  fromPersisted,
  toPersisted
} from './lib/chatUi'

export function App(): JSX.Element {
  const recourse = window.recourse
  const transcriptRef = useRef<HTMLDivElement>(null)
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [conversations, setConversations] = useState<ConversationListItem[]>([])
  const [activeCase, setActiveCase] = useState<CaseRecord | undefined>()
  const [caseState, setCaseState] = useState<Record<string, CaseUiState>>({})
  const activeCaseId = activeCase?.id
  const [prompt, setPrompt] = useState('')
  const [draftsByCaseId, setDraftsByCaseId] = useState<Record<string, string>>({})
  const [pendingUploads, setPendingUploads] = useState<Record<string, UploadDraft[]>>({})
  const sidebar = useSidebarCollapse()
  const [isSending, setIsSending] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadError, setUploadError] = useState<string | undefined>()
  const activeUploads = activeCaseId ? pendingUploads[activeCaseId] ?? [] : []

  const activeUi = useMemo<CaseUiState>(
    () => (activeCaseId ? caseState[activeCaseId] ?? defaultUiState : defaultUiState),
    [caseState, activeCaseId]
  )

  const updateCaseState = useCallback(
    (caseId: string, updater: (current: CaseUiState) => CaseUiState) => {
      setCaseState((current) => {
        const previous = current[caseId] ?? defaultUiState
        return { ...current, [caseId]: updater(previous) }
      })
    },
    []
  )

  const handleAgentEvent = useCallback(
    (event: AgentEvent) => {
      updateCaseState(event.caseId, (current) => {
        if (event.type === 'status') {
          return { ...current, status: event.status, statusMessage: event.message }
        }
        if (event.type === 'proposal') {
          return {
            ...current,
            pendingProposal: event.proposal,
            messages: [
              ...current.messages,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: event.proposal.reason,
                proposal: event.proposal
              }
            ]
          }
        }
        if (event.type === 'log' && event.stream === 'agent') {
          return {
            ...current,
            messages: [
              ...current.messages,
              { id: crypto.randomUUID(), role: 'tool-use', content: event.message }
            ]
          }
        }
        if (event.type === 'blocked') {
          return {
            ...current,
            messages: [
              ...current.messages,
              { id: crypto.randomUUID(), role: 'system', content: event.message }
            ]
          }
        }
        if (event.type === 'message-start') {
          const existing = current.messages.find((message) => message.id === event.messageId)
          if (existing) {
            return {
              ...current,
              pendingProposal: undefined,
              messages: current.messages.map((message) =>
                message.id === event.messageId
                  ? { ...message, streaming: true }
                  : message
              )
            }
          }
          return {
            ...current,
            pendingProposal: undefined,
            messages: [
              ...current.messages,
              { id: event.messageId, role: 'assistant', content: '', streaming: true }
            ]
          }
        }
        if (event.type === 'message-delta') {
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.id === event.messageId
                ? { ...message, content: message.content + event.delta }
                : message
            )
          }
        }
        if (event.type === 'message-end') {
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.id === event.messageId ? { ...message, streaming: false } : message
            )
          }
        }
        if (event.type === 'reasoning-start') {
          const existing = current.messages.find((message) => message.id === event.messageId)
          if (existing) {
            return {
              ...current,
              pendingProposal: undefined,
              messages: current.messages.map((message) =>
                message.id === event.messageId
                  ? {
                      ...message,
                      reasoning: message.reasoning ?? '',
                      reasoningStreaming: true,
                      reasoningExpanded: true
                    }
                  : message
              )
            }
          }
          return {
            ...current,
            pendingProposal: undefined,
            messages: [
              ...current.messages,
              {
                id: event.messageId,
                role: 'assistant',
                content: '',
                reasoning: '',
                reasoningStreaming: true,
                reasoningExpanded: true
              }
            ]
          }
        }
        if (event.type === 'reasoning-delta') {
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.id === event.messageId
                ? { ...message, reasoning: (message.reasoning ?? '') + event.delta }
                : message
            )
          }
        }
        if (event.type === 'reasoning-end') {
          return {
            ...current,
            messages: current.messages.map((message) =>
              message.id === event.messageId
                ? { ...message, reasoningStreaming: false, reasoningExpanded: false }
                : message
            )
          }
        }
        if (event.type === 'error') {
          return {
            ...current,
            status: 'error',
            statusMessage: event.message,
            messages: [
              ...current.messages,
              { id: crypto.randomUUID(), role: 'system', content: event.message }
            ]
          }
        }
        return current
      })
    },
    [updateCaseState]
  )

  const refreshConversations = useCallback(async () => {
    if (!recourse) {
      return
    }
    const [list, records] = await Promise.all([
      recourse.listConversations(),
      recourse.listCases()
    ])
    setConversations(list)
    setCases(records)
    setActiveCase((current) => {
      if (!current) {
        return current
      }
      return records.find((record) => record.id === current.id) ?? current
    })
  }, [recourse])

  const flushChatUi = useCallback(
    async (caseId: string) => {
      if (!recourse) {
        return
      }
      const ui = caseState[caseId]
      if (!ui) {
        return
      }
      if (ui.messages.some((message) => message.streaming || message.reasoningStreaming)) {
        return
      }
      await recourse.saveChatUi(caseId, toPersisted(ui))
    },
    [recourse, caseState]
  )

  const hydrateCaseUi = useCallback(
    async (caseId: string) => {
      if (!recourse || caseState[caseId]) {
        return
      }
      const persisted = await recourse.loadChatUi(caseId)
      if (persisted && persisted.messages.length > 0) {
        setCaseState((current) => ({
          ...current,
          [caseId]: fromPersisted(persisted)
        }))
      }
    },
    [recourse, caseState]
  )

  const selectCase = useCallback(
    async (caseId: string) => {
      if (!recourse) {
        return
      }
      if (activeCaseId && activeCaseId !== caseId) {
        setDraftsByCaseId((current) => ({ ...current, [activeCaseId]: prompt }))
        await flushChatUi(activeCaseId)
      }
      const record = cases.find((item) => item.id === caseId) ?? (await recourse.getCase(caseId))
      if (!record) {
        return
      }
      setActiveCase(record)
      setPrompt(draftsByCaseId[caseId] ?? '')
      await hydrateCaseUi(caseId)
      if (sidebar.isNarrow) {
        sidebar.setMobileOpen(false)
      }
    },
    [
      recourse,
      activeCaseId,
      prompt,
      cases,
      draftsByCaseId,
      flushChatUi,
      hydrateCaseUi,
      sidebar
    ]
  )

  const startNewChat = useCallback(async () => {
    if (!recourse) {
      return
    }
    if (activeCaseId) {
      setDraftsByCaseId((current) => ({ ...current, [activeCaseId]: prompt }))
      await flushChatUi(activeCaseId)
    }
    const record = await recourse.createCase({})
    setCases((current) => [record, ...current.filter((item) => item.id !== record.id)])
    setActiveCase(record)
    setCaseState((current) => ({ ...current, [record.id]: defaultUiState }))
    setPrompt('')
    await refreshConversations()
    if (sidebar.isNarrow) {
      sidebar.setMobileOpen(false)
    }
  }, [recourse, activeCaseId, prompt, flushChatUi, refreshConversations, sidebar])

  useEffect(() => {
    if (!recourse) {
      return undefined
    }

    void (async () => {
      await refreshConversations()
      const records = await recourse.listCases()
      if (records.length > 0) {
        const latest = records[0]
        setActiveCase((current) => current ?? latest)
        const persisted = await recourse.loadChatUi(latest.id)
        if (persisted && persisted.messages.length > 0) {
          setCaseState((current) =>
            current[latest.id] ? current : { ...current, [latest.id]: fromPersisted(persisted) }
          )
        }
      }
    })()

    return recourse.onAgentEvent(handleAgentEvent)
  }, [recourse, handleAgentEvent, refreshConversations])

  useEffect(() => {
    if (!recourse || !activeCaseId) {
      return undefined
    }
    const ui = caseState[activeCaseId]
    if (!ui || ui.messages.some((message) => message.streaming || message.reasoningStreaming)) {
      return undefined
    }
    const timer = window.setTimeout(() => {
      void recourse.saveChatUi(activeCaseId, toPersisted(ui)).then(() => refreshConversations())
    }, 450)
    return () => window.clearTimeout(timer)
  }, [caseState, activeCaseId, recourse, refreshConversations])

  useEffect(() => {
    void refreshConversations()
  }, [activeCase?.updatedAt, activeCase?.title, refreshConversations])

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth'
    })
  }, [activeUi.messages, activeCaseId])

  const transcriptMessages = activeUi.messages

  const contextSummary = activeCase ? intakeSummaryLine(activeCase) : null
  const isDev = import.meta.env.DEV

  async function resetDevData(): Promise<void> {
    if (!recourse) {
      return
    }
    const confirmed = window.confirm(
      'Delete this case and all workspace files? You will start fresh on the next message.'
    )
    if (!confirmed) {
      return
    }
    try {
      await recourse.resetDevData()
      const remaining = await recourse.listCases()
      if (remaining.length > 0) {
        throw new Error('Case data is still on disk. Quit the app and run: npm run reset')
      }
      setActiveCase(undefined)
      setCases([])
      setConversations([])
      setCaseState({})
      setPendingUploads({})
      setDraftsByCaseId({})
      setPrompt('')
      setUploadError(undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      window.alert(`Reset failed: ${message}`)
    }
  }

  if (!recourse) {
    return <MissingBridge />
  }

  async function ensureCase(): Promise<CaseRecord> {
    if (!recourse) {
      throw new Error('Recourse API unavailable')
    }
    if (activeCase) {
      return activeCase
    }
    const record = await recourse.createCase({})
    setCases((current) => [record, ...current.filter((item) => item.id !== record.id)])
    setActiveCase(record)
    setCaseState((current) => ({
      ...current,
      [record.id]: current[record.id] ?? defaultUiState
    }))
    void refreshConversations()
    return record
  }

  function appendDrafts(caseId: string, drafts: UploadDraft[]): void {
    if (drafts.length === 0) {
      return
    }
    setPendingUploads((current) => {
      const existing = current[caseId] ?? []
      const seen = new Set(existing.map((draft) => draft.absolutePath))
      const merged = [...existing]
      for (const draft of drafts) {
        if (!seen.has(draft.absolutePath)) {
          merged.push(draft)
          seen.add(draft.absolutePath)
        }
      }
      return { ...current, [caseId]: merged }
    })
  }

  async function sendMessage(): Promise<void> {
    if (!recourse || isSending) {
      return
    }
    const caseRecord = await ensureCase()
    const caseId = caseRecord.id
    const drafts = pendingUploads[caseId] ?? []
    const submitted = prompt.trim()
    if (submitted.length === 0 && drafts.length === 0) {
      return
    }

    setIsSending(true)
    setUploadError(undefined)

    let uploads: UploadedFile[] = []
    if (drafts.length > 0) {
      try {
        uploads = await recourse.commitUploads(
          caseId,
          drafts.map((draft) => draft.absolutePath)
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setUploadError(`Couldn't attach: ${message}`)
        setIsSending(false)
        return
      }
    }

    setPrompt('')
    setPendingUploads((current) => {
      const next = { ...current }
      delete next[caseId]
      return next
    })

    updateCaseState(caseId, (current) => {
      return {
        ...current,
        status: 'running',
        statusMessage: 'Sending to the agent…',
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: submitted,
            uploads: uploads.length > 0 ? uploads : undefined
          }
        ]
      }
    })

    try {
      await recourse.sendMessage({
        caseId,
        message: submitted,
        uploads: uploads.length > 0 ? uploads : undefined
      })
    } finally {
      setIsSending(false)
    }
  }

  async function attachFiles(): Promise<void> {
    if (!recourse) {
      return
    }
    const caseRecord = await ensureCase()
    setUploadError(undefined)
    try {
      const drafts = await recourse.selectUploads()
      appendDrafts(caseRecord.id, drafts)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUploadError(message)
    }
  }

  async function attachDroppedFiles(files: File[]): Promise<void> {
    if (!recourse || files.length === 0) {
      return
    }
    const caseRecord = await ensureCase()
    setUploadError(undefined)
    try {
      const paths = files
        .map((file) => recourse.getPathForFile(file))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      if (paths.length === 0) {
        setUploadError('Could not resolve a filesystem path for those files.')
        return
      }
      const drafts = await recourse.probeUploads(paths)
      if (drafts.length === 0) {
        setUploadError('None of the dropped items were readable files.')
        return
      }
      appendDrafts(caseRecord.id, drafts)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUploadError(message)
    }
  }

  function removePendingUpload(absolutePath: string): void {
    if (!activeCaseId) {
      return
    }
    setPendingUploads((current) => {
      const list = current[activeCaseId] ?? []
      const next = list.filter((upload) => upload.absolutePath !== absolutePath)
      if (next.length === 0) {
        const updated = { ...current }
        delete updated[activeCaseId]
        return updated
      }
      return { ...current, [activeCaseId]: next }
    })
  }

  const toggleReasoning = useCallback(
    (messageId: string) => {
      if (!activeCaseId) {
        return
      }
      updateCaseState(activeCaseId, (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId
            ? { ...message, reasoningExpanded: !message.reasoningExpanded }
            : message
        )
      }))
    },
    [activeCaseId, updateCaseState]
  )

  async function decideProposal(approved: boolean): Promise<void> {
    if (!recourse || !activeCaseId || !activeUi.pendingProposal) {
      return
    }
    const proposalId = activeUi.pendingProposal.id
    updateCaseState(activeCaseId, (current) => ({
      ...current,
      pendingProposal: undefined,
      messages: current.messages.map((message) =>
        message.proposal?.id === proposalId
          ? {
              ...message,
              content: `${message.content}\n\n${approved ? 'Approved' : 'Rejected'} by you.`,
              proposal: undefined
            }
          : message
      )
    }))

    await recourse.decideProposal({ caseId: activeCaseId, proposalId, approved })
  }

  const dragLeaveTimer = useRef<number | undefined>(undefined)
  const onDragEnter = (event: React.DragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types?.includes('Files')) return
    event.preventDefault()
    if (dragLeaveTimer.current) {
      window.clearTimeout(dragLeaveTimer.current)
      dragLeaveTimer.current = undefined
    }
    setIsDraggingFiles(true)
  }
  const onDragOver = (event: React.DragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types?.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    dragLeaveTimer.current = window.setTimeout(() => {
      setIsDraggingFiles(false)
    }, 50)
  }
  const onDrop = (event: React.DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setIsDraggingFiles(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) {
      void attachDroppedFiles(files)
    }
  }

  const shellClass = [
    'app-shell',
    isDraggingFiles ? 'dragging-files' : '',
    sidebar.collapsed ? 'sidebar-collapsed' : 'sidebar-expanded',
    sidebar.isNarrow ? 'is-narrow' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main
      className={shellClass}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <ChatSidebar
        conversations={conversations}
        activeCaseId={activeCaseId}
        collapsed={sidebar.collapsed}
        isNarrow={sidebar.isNarrow}
        mobileOpen={sidebar.mobileOpen}
        onNewChat={() => void startNewChat()}
        onSelect={(caseId) => void selectCase(caseId)}
        onToggleCollapse={sidebar.toggle}
        onCloseMobile={() => sidebar.setMobileOpen(false)}
      />

      <div className="main-pane">
        <div className="chat-layout">
          <header className="top-bar">
            <div className="top-bar-spacer" />
            {isDev ? (
              <button
                type="button"
                className="dev-reset"
                onClick={() => void resetDevData()}
                title="Delete all cases (dev only)"
              >
                Reset
              </button>
            ) : null}
          </header>

        {contextSummary ? (
          <div className="case-context-banner">
            <span className="eyebrow">SC-100 · Small claims</span>
            <p className="case-context-line">{contextSummary}</p>
          </div>
        ) : null}

        <div className="transcript" ref={transcriptRef}>
          {transcriptMessages.map((message) => (
            <TranscriptItem
              key={message.id}
              message={message}
              onApprove={() => void decideProposal(true)}
              onReject={() => void decideProposal(false)}
              onToggleReasoning={() => toggleReasoning(message.id)}
            />
          ))}
          {activeCaseId &&
          activeUi.status === 'running' &&
          !activeUi.messages.some(
            (message) => message.streaming || message.reasoningStreaming
          ) ? (
            <TypingIndicator label={activeUi.statusMessage} />
          ) : null}
        </div>

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            void sendMessage()
          }}
        >
          {activeUploads.length > 0 || uploadError ? (
            <div className="upload-tray">
              {uploadError ? (
                <button
                  type="button"
                  className="upload-error"
                  onClick={() => setUploadError(undefined)}
                  aria-label="Dismiss upload error"
                >
                  <span>{uploadError}</span>
                  <span aria-hidden>×</span>
                </button>
              ) : null}
              {activeUploads.map((upload) => (
                <UploadChip
                  key={upload.absolutePath}
                  upload={upload}
                  onRemove={() => removePendingUpload(upload.absolutePath)}
                />
              ))}
            </div>
          ) : null}
          <div className="composer-input">
            <button
              type="button"
              className="attach-btn"
              onClick={() => void attachFiles()}
              aria-label="Attach files"
              title="Attach files"
            >
              <PaperclipIcon />
            </button>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage()
                }
              }}
              rows={1}
              placeholder="Message Recourse..."
            />
            <button
              type="submit"
              className="send"
              aria-label="Send message"
              disabled={isSending}
            >
              <SendIcon />
            </button>
          </div>
        </form>

        {isDraggingFiles ? (
          <div className="drop-overlay" aria-hidden>
            <div className="drop-overlay-card">
              <PaperclipIcon />
              <p>Drop files to attach to this case</p>
            </div>
          </div>
        ) : null}
        </div>
      </div>
    </main>
  )
}

function UploadChip({
  upload,
  onRemove
}: {
  upload: UploadDraft
  onRemove: () => void
}): JSX.Element {
  return (
    <span className="upload-chip" title={upload.absolutePath}>
      <FileIcon />
      <span className="upload-chip-name">{upload.name}</span>
      <span className="upload-chip-size">{formatBytes(upload.size)}</span>
      <button
        type="button"
        className="upload-chip-remove"
        onClick={onRemove}
        aria-label={`Remove ${upload.name}`}
      >
        ×
      </button>
    </span>
  )
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function TranscriptItem({
  message,
  onApprove,
  onReject,
  onToggleReasoning
}: {
  message: ChatMessage
  onApprove: () => void
  onReject: () => void
  onToggleReasoning: () => void
}): JSX.Element {
  if (message.role === 'user') {
    return (
      <article className="msg user">
        {message.content.length > 0 ? (
          <div className="msg-content">{message.content}</div>
        ) : null}
        {message.uploads && message.uploads.length > 0 ? (
          <div className="msg-uploads">
            {message.uploads.map((upload) => (
              <span
                key={upload.relativePath}
                className="msg-upload"
                title={upload.relativePath}
              >
                <FileIcon />
                <span className="msg-upload-name">{upload.name}</span>
                <span className="msg-upload-size">{formatBytes(upload.size)}</span>
              </span>
            ))}
          </div>
        ) : null}
      </article>
    )
  }

  if (message.role === 'tool-use') {
    return (
      <p className="tool-use-line" aria-live="polite">
        {message.content}
      </p>
    )
  }

  if (message.role === 'system') {
    return (
      <article className="msg system">
        <div className="msg-content">{message.content}</div>
      </article>
    )
  }

  const hasReasoning = (message.reasoning ?? '').length > 0 || message.reasoningStreaming
  const hasContent = message.content.length > 0 || message.streaming

  return (
    <article className="msg assistant">
      <div className="msg-avatar">R</div>
      <div className="msg-body">
        {hasReasoning ? (
          <ReasoningBlock
            text={message.reasoning ?? ''}
            streaming={Boolean(message.reasoningStreaming)}
            expanded={Boolean(message.reasoningExpanded)}
            onToggle={onToggleReasoning}
          />
        ) : null}
        {hasContent ? (
          <div className="msg-content markdown">
            <Markdown text={message.content} />
            {message.streaming ? <span className="caret" aria-hidden /> : null}
          </div>
        ) : null}
        {message.proposal ? (
          <div className="proposal">
            <div className="proposal-label">Proposed command</div>
            <pre>{message.proposal.command}</pre>
            <div className="proposal-actions">
              <button type="button" className="ghost small" onClick={onReject}>
                Reject
              </button>
              <button type="button" className="filled small" onClick={onApprove}>
                Approve & run
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  )
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  code({ className, children, ...rest }) {
    const text = Array.isArray(children) ? children.join('') : String(children ?? '')
    const isBlock = (className?.startsWith('language-') ?? false) || text.includes('\n')
    if (isBlock) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }
    return (
      <code className="md-inline-code" {...rest}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => <pre className="md-pre">{children}</pre>,
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table className="md-table">{children}</table>
    </div>
  )
}

function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {text}
    </ReactMarkdown>
  )
}

function ReasoningBlock({
  text,
  streaming,
  expanded,
  onToggle
}: {
  text: string
  streaming: boolean
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  const label = streaming ? 'Thinking…' : 'Thought process'
  return (
    <details className={`reasoning ${streaming ? 'streaming' : ''}`} open={expanded}>
      <summary
        onClick={(event) => {
          event.preventDefault()
          onToggle()
        }}
      >
        <span className="reasoning-icon" aria-hidden>
          <ThinkingIcon />
        </span>
        <span className="reasoning-label">{label}</span>
        <span className="reasoning-chevron" aria-hidden>
          {expanded ? '−' : '+'}
        </span>
      </summary>
      <div className="reasoning-body">
        {text.length === 0 ? (
          <p className="muted">Working it out…</p>
        ) : (
          <p>
            {text}
            {streaming ? <span className="caret" aria-hidden /> : null}
          </p>
        )}
      </div>
    </details>
  )
}

function ThinkingIcon(): JSX.Element {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5a4.5 4.5 0 0 0-2.5 8.243V12a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1V9.743A4.5 4.5 0 0 0 8 1.5Zm-1.5 12.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function TypingIndicator({ label }: { label: string }): JSX.Element {
  return (
    <div className="typing" aria-live="polite">
      <span className="dot" />
      <span className="dot" />
      <span className="dot" />
      <span className="typing-label">{label}</span>
    </div>
  )
}

function MissingBridge(): JSX.Element {
  return (
    <main className="app-shell missing-bridge">
      <div className="hero">
        <p className="eyebrow">Recourse</p>
        <h1>Open Recourse through Electron</h1>
        <p className="lede">
          The renderer loaded without the secure preload bridge. Run <code>npm run dev</code> and
          use the Electron window, not the Vite URL.
        </p>
      </div>
    </main>
  )
}

function PaperclipIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M10.2 2.3a2.7 2.7 0 0 1 3.8 3.8L7 13.1a4.4 4.4 0 1 1-6.2-6.2L7.6 0.1l1 1L1.8 7.9a3 3 0 1 0 4.2 4.2l6.7-6.7a1.4 1.4 0 1 0-1.9-1.9L4.4 10a0.3 0.3 0 0 0 0 0.4 0.3 0.3 0 0 0 0.4 0l6.3-6.3 1 1-6.3 6.3a1.7 1.7 0 0 1-2.4-2.4l6.8-6.8z"
        fill="currentColor"
      />
    </svg>
  )
}

function FileIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3 1h6l4 4v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm6 0v4h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SendIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M2.5 13.5L13.5 8L2.5 2.5L2.5 6.5L10 8L2.5 9.5z"
        fill="currentColor"
      />
    </svg>
  )
}

