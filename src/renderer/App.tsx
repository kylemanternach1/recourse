import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'
import type {
  AgentEvent,
  AgentStatus,
  CaseRecord,
  CommandProposal,
  DefendantType,
  SmallClaimsIntake,
  UploadedFile
} from '../shared/contracts'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  proposal?: CommandProposal
  streaming?: boolean
  reasoning?: string
  reasoningStreaming?: boolean
  reasoningExpanded?: boolean
  uploads?: UploadedFile[]
}

interface CaseUiState {
  messages: ChatMessage[]
  pendingProposal?: CommandProposal
  status: AgentStatus
  statusMessage: string
}

const defaultUiState: CaseUiState = {
  messages: [],
  status: 'idle',
  statusMessage: 'Ready when you are.'
}

const DEFENDANT_TYPE_LABEL: Record<DefendantType, string> = {
  individual: 'Individual',
  business: 'Business',
  'sole-proprietor': 'Sole proprietor'
}

export function App(): JSX.Element {
  const recourse = window.recourse
  const transcriptRef = useRef<HTMLDivElement>(null)
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [activeCaseId, setActiveCaseId] = useState<string>()
  const [caseState, setCaseState] = useState<Record<string, CaseUiState>>({})
  const [showNewCase, setShowNewCase] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [pendingUploads, setPendingUploads] = useState<Record<string, UploadedFile[]>>({})
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [uploadError, setUploadError] = useState<string | undefined>()
  const activeUploads = activeCaseId ? pendingUploads[activeCaseId] ?? [] : []

  const activeCase = useMemo(
    () => cases.find((record) => record.id === activeCaseId),
    [cases, activeCaseId]
  )
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

  useEffect(() => {
    if (!recourse) {
      return undefined
    }

    void recourse.listCases().then((records) => {
      setCases(records)
      if (records.length > 0) {
        setActiveCaseId((current) => current ?? records[0].id)
      } else {
        setShowNewCase(true)
      }
    })

    return recourse.onAgentEvent(handleAgentEvent)
  }, [recourse, handleAgentEvent])

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: 'smooth'
    })
  }, [activeUi.messages])

  if (!recourse) {
    return <MissingBridge />
  }

  async function createCase(values: NewCaseValues): Promise<void> {
    if (!recourse) {
      return
    }
    const record = await recourse.createCase({
      title: values.title,
      intake: values.intake
    })
    setCases((current) => [record, ...current.filter((existing) => existing.id !== record.id)])
    setActiveCaseId(record.id)
    setShowNewCase(false)
    updateCaseState(record.id, (current) => ({
      ...current,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: greetingForCase(record)
        }
      ]
    }))
  }

  async function sendMessage(): Promise<void> {
    if (!recourse || !activeCaseId) {
      return
    }
    const uploads = pendingUploads[activeCaseId] ?? []
    const submitted = prompt.trim()
    if (submitted.length === 0 && uploads.length === 0) {
      return
    }

    setPrompt('')
    setPendingUploads((current) => {
      const next = { ...current }
      delete next[activeCaseId]
      return next
    })
    updateCaseState(activeCaseId, (current) => ({
      ...current,
      status: 'running',
      statusMessage: 'Sending to the agent...',
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: submitted,
          uploads: uploads.length > 0 ? uploads : undefined
        }
      ]
    }))
    await recourse.sendMessage({
      caseId: activeCaseId,
      message: submitted,
      uploads: uploads.length > 0 ? uploads : undefined
    })
  }

  async function attachFiles(): Promise<void> {
    if (!recourse || !activeCaseId) {
      return
    }
    setUploadError(undefined)
    try {
      const added = await recourse.selectUploads(activeCaseId)
      if (added.length === 0) {
        return
      }
      setPendingUploads((current) => ({
        ...current,
        [activeCaseId]: [...(current[activeCaseId] ?? []), ...added]
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUploadError(message)
    }
  }

  async function attachDroppedFiles(files: File[]): Promise<void> {
    if (!recourse || !activeCaseId || files.length === 0) {
      return
    }
    setUploadError(undefined)
    try {
      const paths = files
        .map((file) => recourse.getPathForFile(file))
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      if (paths.length === 0) {
        setUploadError('Could not resolve a filesystem path for those files.')
        return
      }
      const added = await recourse.addUploadsFromPaths(activeCaseId, paths)
      if (added.length === 0) {
        return
      }
      setPendingUploads((current) => ({
        ...current,
        [activeCaseId]: [...(current[activeCaseId] ?? []), ...added]
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setUploadError(message)
    }
  }

  function removePendingUpload(relativePath: string): void {
    if (!activeCaseId) {
      return
    }
    setPendingUploads((current) => {
      const list = current[activeCaseId] ?? []
      const next = list.filter((upload) => upload.relativePath !== relativePath)
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
    if (!activeCaseId) return
    if (!event.dataTransfer.types?.includes('Files')) return
    event.preventDefault()
    if (dragLeaveTimer.current) {
      window.clearTimeout(dragLeaveTimer.current)
      dragLeaveTimer.current = undefined
    }
    setIsDraggingFiles(true)
  }
  const onDragOver = (event: React.DragEvent<HTMLElement>): void => {
    if (!activeCaseId) return
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
    if (!activeCaseId) return
    event.preventDefault()
    setIsDraggingFiles(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) {
      void attachDroppedFiles(files)
    }
  }

  return (
    <main
      className={`app-shell ${isDraggingFiles ? 'dragging-files' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">R</span>
          <span className="brand-name">Recourse</span>
        </div>
        <button type="button" className="new-case" onClick={() => setShowNewCase(true)}>
          <span className="plus">+</span>
          New case
        </button>
        <nav className="case-list">
          {cases.length === 0 ? (
            <p className="muted">No cases yet.</p>
          ) : (
            cases.map((record) => (
              <button
                key={record.id}
                type="button"
                className={record.id === activeCaseId ? 'case-item active' : 'case-item'}
                onClick={() => setActiveCaseId(record.id)}
              >
                <span className="case-title">{record.title}</span>
                <span className="case-sub">{caseSubtitle(record)}</span>
              </button>
            ))
          )}
        </nav>
        <footer className="sidebar-footer">
          <p>California small claims · SC-100</p>
        </footer>
      </aside>

      <section className="case-pane">
        {activeCase ? (
          <CaseView
            record={activeCase}
            ui={activeUi}
            transcriptRef={transcriptRef}
            prompt={prompt}
            onPromptChange={setPrompt}
            onSend={sendMessage}
            onApprove={() => void decideProposal(true)}
            onReject={() => void decideProposal(false)}
            onToggleReasoning={toggleReasoning}
            onOpenWorkspace={() => void recourse.openCaseWorkspace(activeCase.id)}
            pendingUploads={activeUploads}
            uploadError={uploadError}
            onAttachFiles={() => void attachFiles()}
            onRemoveUpload={removePendingUpload}
            onDismissUploadError={() => setUploadError(undefined)}
            isDraggingFiles={isDraggingFiles}
          />
        ) : (
          <EmptyHero onCreate={() => setShowNewCase(true)} />
        )}
      </section>

      {showNewCase ? (
        <NewCaseModal
          onClose={() => setShowNewCase(false)}
          onSubmit={(values) => void createCase(values)}
        />
      ) : null}
    </main>
  )
}

interface CaseViewProps {
  record: CaseRecord
  ui: CaseUiState
  transcriptRef: React.RefObject<HTMLDivElement>
  prompt: string
  onPromptChange: (value: string) => void
  onSend: () => Promise<void>
  onApprove: () => void
  onReject: () => void
  onToggleReasoning: (messageId: string) => void
  onOpenWorkspace: () => void
  pendingUploads: UploadedFile[]
  uploadError?: string
  onAttachFiles: () => void
  onRemoveUpload: (relativePath: string) => void
  onDismissUploadError: () => void
  isDraggingFiles: boolean
}

function CaseView({
  record,
  ui,
  transcriptRef,
  prompt,
  onPromptChange,
  onSend,
  onApprove,
  onReject,
  onToggleReasoning,
  onOpenWorkspace,
  pendingUploads,
  uploadError,
  onAttachFiles,
  onRemoveUpload,
  onDismissUploadError,
  isDraggingFiles
}: CaseViewProps): JSX.Element {
  return (
    <>
      <header className="case-header">
        <div className="case-heading">
          <p className="eyebrow">SC-100 · Small claims</p>
          <h1>{record.title}</h1>
          <p className="case-sub">
            {record.intake.plaintiffName} v. {record.intake.defendantName} ·{' '}
            {formatCurrency(record.intake.amountClaimed)} ·{' '}
            {DEFENDANT_TYPE_LABEL[record.intake.defendantType]}
          </p>
        </div>
        <div className="case-actions">
          <button type="button" className="ghost" onClick={onOpenWorkspace}>
            Open workspace
          </button>
        </div>
      </header>

      <div className="transcript" ref={transcriptRef}>
        {ui.messages.length === 0 ? (
          <p className="muted center">
            Start the conversation. The agent will propose actions before changing files.
          </p>
        ) : (
          ui.messages.map((message) => (
            <TranscriptItem
              key={message.id}
              message={message}
              onApprove={onApprove}
              onReject={onReject}
              onToggleReasoning={() => onToggleReasoning(message.id)}
            />
          ))
        )}
        {ui.status === 'running' &&
        !ui.messages.some(
          (message) => message.streaming || message.reasoningStreaming
        ) ? (
          <TypingIndicator label={ui.statusMessage} />
        ) : null}
      </div>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          void onSend()
        }}
      >
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void onSend()
            }
          }}
          rows={1}
          placeholder="Message Recourse..."
        />
        <button type="submit" className="send" aria-label="Send message">
          <SendIcon />
        </button>
      </form>
    </>
  )
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
        <div className="msg-content">{message.content}</div>
      </article>
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

function EmptyHero({ onCreate }: { onCreate: () => void }): JSX.Element {
  return (
    <div className="hero">
      <p className="eyebrow">Recourse</p>
      <h1>Help with your small claims case.</h1>
      <p className="lede">
        Recourse helps Californians prepare a small claims (SC-100) case. Tell us about your
        situation and we&apos;ll walk you through the filing, step by step.
      </p>
      <button type="button" className="filled" onClick={onCreate}>
        Start a new case
      </button>
    </div>
  )
}

interface NewCaseValues {
  title: string
  intake: SmallClaimsIntake
}

function NewCaseModal({
  onClose,
  onSubmit
}: {
  onClose: () => void
  onSubmit: (values: NewCaseValues) => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  const [plaintiffName, setPlaintiffName] = useState('')
  const [plaintiffCity, setPlaintiffCity] = useState('')
  const [defendantName, setDefendantName] = useState('')
  const [defendantType, setDefendantType] = useState<DefendantType>('individual')
  const [amount, setAmount] = useState('')
  const [incidentDate, setIncidentDate] = useState('')
  const [whatHappened, setWhatHappened] = useState('')
  const [contacted, setContacted] = useState<'yes' | 'no'>('no')
  const [contactNotes, setContactNotes] = useState('')

  const titleValue = title.trim()
  const amountValue = Number.parseFloat(amount)
  const isValid =
    titleValue.length > 0 &&
    plaintiffName.trim().length > 0 &&
    defendantName.trim().length > 0 &&
    whatHappened.trim().length > 0 &&
    Number.isFinite(amountValue) &&
    amountValue > 0

  function handleSubmit(): void {
    if (!isValid) {
      return
    }
    onSubmit({
      title: titleValue,
      intake: {
        plaintiffName: plaintiffName.trim(),
        plaintiffCity: plaintiffCity.trim(),
        defendantName: defendantName.trim(),
        defendantType,
        amountClaimed: amountValue,
        incidentDate: incidentDate.trim(),
        whatHappened: whatHappened.trim(),
        contactedDefendant: contacted === 'yes',
        contactNotes: contacted === 'yes' ? contactNotes.trim() : undefined
      }
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault()
          handleSubmit()
        }}
      >
        <header className="modal-header">
          <p className="eyebrow">New case</p>
          <h2>Tell us about your small claims case</h2>
          <p className="muted">
            We&apos;ll use this to start the filing. You can refine everything with the agent
            afterward.
          </p>
        </header>

        <FormField label="Case title" hint="A short label so you can find this case again.">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Neighbor owes me $1,400 for damaged fence"
            autoFocus
          />
        </FormField>

        <FieldGroup title="You (the plaintiff)">
          <div className="row two">
            <FormField label="Full name">
              <input
                value={plaintiffName}
                onChange={(event) => setPlaintiffName(event.target.value)}
                placeholder="Jane Doe"
              />
            </FormField>
            <FormField label="City">
              <input
                value={plaintiffCity}
                onChange={(event) => setPlaintiffCity(event.target.value)}
                placeholder="Oakland"
              />
            </FormField>
          </div>
        </FieldGroup>

        <FieldGroup title="The defendant">
          <FormField label="Name of person or business">
            <input
              value={defendantName}
              onChange={(event) => setDefendantName(event.target.value)}
              placeholder="Acme Property Management LLC"
            />
          </FormField>
          <FormField label="Type">
            <div className="chip-group">
              {(Object.keys(DEFENDANT_TYPE_LABEL) as DefendantType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={type === defendantType ? 'chip selected' : 'chip'}
                  onClick={() => setDefendantType(type)}
                >
                  {DEFENDANT_TYPE_LABEL[type]}
                </button>
              ))}
            </div>
          </FormField>
        </FieldGroup>

        <FieldGroup title="The claim">
          <div className="row two">
            <FormField label="Amount claimed (USD)">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="1400"
              />
            </FormField>
            <FormField label="Date of incident">
              <input
                type="date"
                value={incidentDate}
                onChange={(event) => setIncidentDate(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="What happened?">
            <textarea
              value={whatHappened}
              onChange={(event) => setWhatHappened(event.target.value)}
              rows={4}
              placeholder="A few sentences about what happened, when, and why the defendant owes you."
            />
          </FormField>
        </FieldGroup>

        <FieldGroup title="Have you contacted the defendant?">
          <div className="chip-group">
            <button
              type="button"
              className={contacted === 'no' ? 'chip selected' : 'chip'}
              onClick={() => setContacted('no')}
            >
              Not yet
            </button>
            <button
              type="button"
              className={contacted === 'yes' ? 'chip selected' : 'chip'}
              onClick={() => setContacted('yes')}
            >
              Yes
            </button>
          </div>
          {contacted === 'yes' ? (
            <FormField label="Notes (optional)">
              <textarea
                value={contactNotes}
                onChange={(event) => setContactNotes(event.target.value)}
                rows={2}
                placeholder="When you reached out, what they said, etc."
              />
            </FormField>
          ) : null}
        </FieldGroup>

        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="filled" disabled={!isValid}>
            Create case
          </button>
        </div>
      </form>
    </div>
  )
}

function FormField({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

function FieldGroup({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="field-group">
      <h3>{title}</h3>
      {children}
    </section>
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

function greetingForCase(record: CaseRecord): string {
  const { intake } = record
  return [
    `Got it — opened the case "${record.title}".`,
    `I have ${intake.plaintiffName} v. ${intake.defendantName}, claiming ${formatCurrency(
      intake.amountClaimed
    )}.`,
    'When you’re ready, I can draft your SC-100 from the intake or pull more facts. What would you like to do first?'
  ].join(' ')
}

function caseSubtitle(record: CaseRecord): string {
  return `${record.intake.defendantName} · ${formatCurrency(record.intake.amountClaimed)}`
}

function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) {
    return '$0'
  }
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  })
}
