import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type {
  AgentEvent,
  CaseRecord,
  ConversationListItem,
  PhaseId,
  UploadDraft,
  UploadedFile
} from '../shared/contracts'
import { ChatSidebar } from './components/ChatSidebar'
import { PhaseBanner } from './components/PhaseBanner'
import { FileEditCard } from './components/FileEditCard'
import { FileReadCard } from './components/FileReadCard'
import { PhaseUpdateCard } from './components/PhaseUpdateCard'
import { TimelineDrawer } from './components/TimelineDrawer'
import { useSidebarCollapse } from './hooks/useSidebarCollapse'
import { useTimelineDrawer } from './hooks/useTimelineDrawer'
import {
  type CaseUiState,
  type ChatMessage,
  defaultUiState,
  fromPersisted,
  toPersisted
} from './lib/chatUi'
import { normalizeChatMessages } from './lib/chatNormalize'
import { isLegacyFileToolLog, toolUseToFileEdit, toolUseToFileRead } from './lib/fileToolChat'
import {
  findPhaseAnchorMessageId,
  isLegacyPhaseLog,
  toolUseToPhaseUpdate
} from './lib/phaseChat'

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
  const timeline = useTimelineDrawer()
  const [isSending, setIsSending] = useState(false)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadError, setUploadError] = useState<string | undefined>()
  const [highlightMessageId, setHighlightMessageId] = useState<string | undefined>()
  const activeUploads = activeCaseId ? pendingUploads[activeCaseId] ?? [] : []

  const activeUi = useMemo<CaseUiState>(() => {
    const raw = activeCaseId ? caseState[activeCaseId] ?? defaultUiState : defaultUiState
    return { ...raw, messages: normalizeChatMessages(raw.messages) }
  }, [caseState, activeCaseId])

  const jumpToPhaseInChat = useCallback(
    (phaseId: PhaseId) => {
      const phase = activeCase?.lifecycle.phases.find((entry) => entry.phaseId === phaseId)
      if (!phase || phase.status === 'not_started') {
        return
      }
      const messageId = findPhaseAnchorMessageId(activeUi.messages, phaseId)
      if (!messageId) {
        return
      }
      timeline.closeDrawer()
      requestAnimationFrame(() => {
        const element = transcriptRef.current?.querySelector(`[data-message-id="${messageId}"]`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightMessageId(messageId)
        window.setTimeout(() => setHighlightMessageId(undefined), 2200)
      })
    },
    [activeCase, activeUi.messages, timeline]
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
      if (event.type === 'case-updated') {
        setCases((current) =>
          current.map((record) => (record.id === event.caseId ? event.caseRecord : record))
        )
        setActiveCase((current) =>
          current?.id === event.caseId ? event.caseRecord : current
        )
        return
      }

      if (event.type === 'file-offer') {
        updateCaseState(event.caseId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: event.file.id,
              role: 'file-download',
              content: event.file.label,
              fileOffer: event.file
            }
          ]
        }))
        return
      }

      if (event.type === 'command-run') {
        updateCaseState(event.caseId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: event.run.id,
              role: 'command-run',
              content: event.run.command,
              commandRun: event.run
            }
          ]
        }))
        return
      }

      if (event.type === 'phase-update') {
        updateCaseState(event.caseId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: event.update.id,
              role: 'phase-update',
              content: event.update.phaseId,
              phaseUpdate: event.update
            }
          ]
        }))
        return
      }

      if (event.type === 'file-read') {
        updateCaseState(event.caseId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: event.read.id,
              role: 'file-read',
              content: event.read.path,
              fileRead: event.read
            }
          ]
        }))
        return
      }

      if (event.type === 'file-edit') {
        updateCaseState(event.caseId, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            {
              id: event.edit.id,
              role: 'file-edit',
              content: event.edit.path,
              fileEdit: event.edit
            }
          ]
        }))
        return
      }

      updateCaseState(event.caseId, (current) => {
        if (event.type === 'status') {
          return { ...current, status: event.status, statusMessage: event.message }
        }
        if (event.type === 'log' && event.stream === 'agent') {
          if (isLegacyPhaseLog(event.message) || isLegacyFileToolLog(event.message)) {
            return current
          }
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

  const downloadWorkspaceFile = useCallback(
    async (file: import('../shared/contracts').FileOffer) => {
      if (!recourse || !activeCaseId) {
        return
      }
      try {
        const result = await recourse.saveWorkspaceDownload(
          activeCaseId,
          file.relativePath,
          file.name
        )
        if (!result.saved) {
          return
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.alert(`Could not save file: ${message}`)
      }
    },
    [recourse, activeCaseId]
  )

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
        {activeCase ? (
          <PhaseBanner
            caseRecord={activeCase}
            onOpenTimeline={timeline.openDrawer}
          />
        ) : null}

        <div className="transcript" ref={transcriptRef}>
          {transcriptMessages.map((message) => (
            <TranscriptItem
              key={message.id}
              message={message}
              caseId={activeCaseId}
              highlighted={message.id === highlightMessageId}
              onToggleReasoning={() => toggleReasoning(message.id)}
              onDownloadFile={(file) => void downloadWorkspaceFile(file)}
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

      <TimelineDrawer
        open={timeline.open}
        caseRecord={activeCase}
        messages={activeUi.messages}
        onClose={timeline.closeDrawer}
        onJumpToPhase={jumpToPhaseInChat}
      />
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
  caseId,
  highlighted,
  onToggleReasoning,
  onDownloadFile
}: {
  message: ChatMessage
  caseId?: string
  highlighted?: boolean
  onToggleReasoning: () => void
  onDownloadFile: (file: import('../shared/contracts').FileOffer) => void
}): JSX.Element {
  const wrap = (className: string, children: JSX.Element | JSX.Element[]): JSX.Element => (
    <div
      className={`transcript-anchor${highlighted ? ' transcript-anchor--highlight' : ''}`}
      data-message-id={message.id}
    >
      <div className={className}>{children}</div>
    </div>
  )

  if (message.role === 'user') {
    return (
      <article className="msg user" data-message-id={message.id}>
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
    const legacyPhase = toolUseToPhaseUpdate(message)
    if (legacyPhase) {
      return wrap('msg phase-update', <PhaseUpdateCard update={legacyPhase} />)
    }
    const legacyRead = toolUseToFileRead(message)
    if (legacyRead) {
      return wrap('msg file-read', <FileReadCard read={legacyRead} />)
    }
    const legacyEdit = toolUseToFileEdit(message)
    if (legacyEdit) {
      return wrap('msg file-edit', <FileEditCard edit={legacyEdit} />)
    }
    return wrap(
      'tool-use-wrap',
      <p className="tool-use-line" aria-live="polite">
        {message.content}
      </p>
    )
  }

  if (message.role === 'phase-update' && message.phaseUpdate) {
    return wrap('msg phase-update', <PhaseUpdateCard update={message.phaseUpdate} />)
  }

  if (message.role === 'file-read' && message.fileRead) {
    return wrap('msg file-read', <FileReadCard read={message.fileRead} />)
  }

  if (message.role === 'file-edit' && message.fileEdit) {
    return wrap('msg file-edit', <FileEditCard edit={message.fileEdit} />)
  }

  if (message.role === 'command-run' && message.commandRun) {
    const run = message.commandRun
    const output = formatCommandOutput(run)
    return wrap(
      'msg command-run',
      <>
        <div className="msg-avatar">R</div>
        <div className="command-run-card">
          <p className="command-run-label">Ran command</p>
          <pre className="command-run-cmd">{run.command}</pre>
          {output.length > 0 ? (
            <pre className="command-run-output">{output}</pre>
          ) : (
            <p className="command-run-empty">No output.</p>
          )}
          {run.blockedEvents.length > 0 ? (
            <p className="command-run-meta">
              {run.blockedEvents.length} sandbox block(s)
            </p>
          ) : null}
        </div>
      </>
    )
  }

  if (message.role === 'file-download' && message.fileOffer) {
    const file = message.fileOffer
    return wrap(
      'msg file-download',
      <>
        <div className="msg-avatar">R</div>
        <div className="download-card">
          <div className="download-card-icon" aria-hidden>
            <FileIcon />
          </div>
          <div className="download-card-body">
            <p className="download-card-label">{file.label}</p>
            {file.description ? (
              <p className="download-card-desc">{file.description}</p>
            ) : null}
            <p className="download-card-meta">
              {file.name} · {formatBytes(file.size)}
            </p>
          </div>
          <button
            type="button"
            className="filled small download-card-btn"
            disabled={!caseId}
            onClick={() => onDownloadFile(file)}
          >
            Download
          </button>
        </div>
      </>
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
      </div>
    </article>
  )
}

function formatCommandOutput(run: import('../shared/contracts').CommandRun): string {
  const parts: string[] = []
  const stdout = run.stdout.trim()
  const stderr = run.stderr.trim()
  const blocked = run.blockedEvents.join('\n').trim()
  if (stdout.length > 0) {
    parts.push(stdout)
  }
  if (stderr.length > 0) {
    parts.push(stderr)
  }
  if (blocked.length > 0) {
    parts.push(`[sandbox]\n${blocked}`)
  }
  return parts.join('\n\n')
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
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.99 8.84L9.41 17.41a2 2 0 1 1-2.83-2.83l8.49-8.48" />
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
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}

