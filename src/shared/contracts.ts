export type PolicyPresetId = 'open' | 'no-internet' | 'github-allowed' | 'custom-domains'

export type AgentStatus = 'idle' | 'waiting-for-approval' | 'running' | 'complete' | 'error'

export type CaseTypeId = 'sc-100-small-claims'

export type DefendantType = 'individual' | 'business' | 'sole-proprietor'

export type PhaseId =
  | 'intake'
  | 'eligibility'
  | 'parties_venue'
  | 'evidence_damages'
  | 'forms'
  | 'filing'
  | 'service'
  | 'hearing_prep'
  | 'hearing'
  | 'enforcement'
  | 'closure'

export type PhaseStatus =
  | 'not_started'
  | 'in_progress'
  | 'waiting'
  | 'blocked'
  | 'complete'
  | 'skipped'

export type ArtifactKind = 'draft' | 'evidence' | 'filed' | 'note'

export interface PhaseArtifact {
  path: string
  label: string
  kind: ArtifactKind
  createdAt: string
}

export interface PhaseState {
  phaseId: PhaseId
  status: PhaseStatus
  nextAction?: string
  waitingOn?: string
  waitingSince?: string
  expectedBy?: string
  artifacts: PhaseArtifact[]
  updatedAt: string
}

export interface CaseLifecycle {
  currentPhase: PhaseId
  phases: PhaseState[]
  updatedAt: string
}

/** Snapshot shown in chat when the agent updates case phase state. */
export interface PhaseUpdate {
  id: string
  phaseId: PhaseId
  status: PhaseStatus
  nextAction?: string
  at: string
  isCurrent?: boolean
}

export interface PolicyPreset {
  id: PolicyPresetId
  name: string
  description: string
  defaultDomains: string[]
}

export interface CaseTypeOption {
  id: CaseTypeId
  name: string
  description: string
  defaultPolicyPresetId: PolicyPresetId
  skillIds: string[]
}

export interface SkillSummary {
  id: string
  name: string
  description: string
}

export interface WorkspaceInfo {
  id: string
  name: string
  path: string
  createdAt: string
}

export interface FilesystemPolicy {
  allowRead: string[]
  denyRead: string[]
  allowWrite: string[]
  denyWrite: string[]
}

export interface NetworkPolicy {
  allowedDomains: string[]
  deniedDomains: string[]
}

export interface SandboxPolicy {
  presetId: PolicyPresetId
  workspacePath: string
  filesystem: FilesystemPolicy
  network: NetworkPolicy
}

export interface SmallClaimsIntake {
  plaintiffName: string
  plaintiffCity: string
  defendantName: string
  defendantType: DefendantType
  amountClaimed: number
  incidentDate: string
  whatHappened: string
  contactedDefendant: boolean
  contactNotes?: string
}

export interface CaseRecord {
  id: string
  title: string
  caseTypeId: CaseTypeId
  policyPresetId: PolicyPresetId
  customDomains: string[]
  workspace: WorkspaceInfo
  skills: SkillSummary[]
  intake: SmallClaimsIntake
  lifecycle: CaseLifecycle
  createdAt: string
  updatedAt: string
}

export interface CreateCaseRequest {
  /** Defaults to "New case" when omitted. */
  title?: string
  /** Defaults to an empty intake for chat-first onboarding. */
  intake?: SmallClaimsIntake
}

export interface CommandProposal {
  id: string
  caseId: string
  command: string
  cwd: string
  reason: string
  createdAt: string
}

/** A shell command the agent ran, shown in the chat transcript. */
export interface CommandRun {
  id: string
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  blockedEvents: string[]
}

/** File slice shown in chat when the agent reads a workspace file. */
export interface FileReadRecord {
  id: string
  path: string
  startLine: number
  endLine: number
  totalLines: number
  lines: string[]
  truncated: boolean
}

/** File change shown in chat when the agent edits a workspace file. */
export interface FileEditRecord {
  id: string
  path: string
  kind: 'create' | 'overwrite' | 'patch'
  replacements?: number
  oldText?: string
  newText?: string
  truncated?: boolean
}

/** A workspace file the agent offers for the user to download. */
export interface FileOffer {
  id: string
  relativePath: string
  name: string
  size: number
  mimeType?: string
  label: string
  description?: string
}

export interface SandboxRunResult {
  exitCode: number | null
  stdout: string
  stderr: string
  blockedEvents: string[]
}

export type AgentEvent =
  | { type: 'status'; caseId: string; status: AgentStatus; message: string }
  | { type: 'log'; caseId: string; stream: 'agent' | 'stdout' | 'stderr' | 'sandbox'; message: string }
  | { type: 'proposal'; caseId: string; proposal: CommandProposal }
  | { type: 'blocked'; caseId: string; message: string }
  | { type: 'message-start'; caseId: string; messageId: string }
  | { type: 'message-delta'; caseId: string; messageId: string; delta: string }
  | { type: 'message-end'; caseId: string; messageId: string }
  | { type: 'reasoning-start'; caseId: string; messageId: string }
  | { type: 'reasoning-delta'; caseId: string; messageId: string; delta: string }
  | { type: 'reasoning-end'; caseId: string; messageId: string }
  | { type: 'error'; caseId: string; message: string }
  | { type: 'case-updated'; caseId: string; caseRecord: CaseRecord }
  | { type: 'file-offer'; caseId: string; file: FileOffer }
  | { type: 'command-run'; caseId: string; run: CommandRun }
  | { type: 'phase-update'; caseId: string; update: PhaseUpdate }
  | { type: 'file-read'; caseId: string; read: FileReadRecord }
  | { type: 'file-edit'; caseId: string; edit: FileEditRecord }

/** A user-selected file that has been stat'd but not yet copied into the case workspace. */
export interface UploadDraft {
  /** Filename for display. */
  name: string
  /** Absolute path on the user's disk. */
  absolutePath: string
  /** Size in bytes. */
  size: number
  /** Best-effort MIME type, or undefined. */
  mimeType?: string
}

export interface ToolCheck {
  /** Identifier (binary name or runtime id). */
  name: string
  /** What this tool is used for, surfaced as helper text. */
  purpose: string
  /** Suggested install command for macOS. */
  installHint: string
  available: boolean
  /** Absolute path the tool was discovered at, if any. */
  path?: string
}

export interface ToolCheckResult {
  /** Per-tool details. */
  tools: ToolCheck[]
  /** Which of the document skills are present on disk. */
  skills: Array<{ id: string; available: boolean }>
  /** Whether the CA statute corpus is installed. */
  statutesReady: boolean
  /** Quick summary: are the critical tools (qpdf/pdftoppm/tesseract + runtimes) available? */
  runtimeReady: boolean
}

export interface UploadedFile {
  /** Filename inside <workspace>/uploads/. Unique per case (collisions get a numeric suffix). */
  name: string
  /** Workspace-relative path (e.g. "uploads/foo.pdf"). */
  relativePath: string
  /** Absolute path on the user's disk. */
  absolutePath: string
  /** Size in bytes. */
  size: number
  /** Best-effort MIME type, or undefined. */
  mimeType?: string
}

export interface SendMessageRequest {
  caseId: string
  message: string
  uploads?: UploadedFile[]
}

export interface ApprovalDecision {
  caseId: string
  proposalId: string
  approved: boolean
}

export interface LlmToolCall {
  id: string
  name: string
  arguments: string
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  toolCalls?: LlmToolCall[]
  toolCallId?: string
}

/** Serializable chat transcript for UI restore (per case workspace). */
export interface PersistedChatMessage {
  id: string
  role:
    | 'user'
    | 'assistant'
    | 'system'
    | 'tool-use'
    | 'file-download'
    | 'command-run'
    | 'phase-update'
    | 'file-read'
    | 'file-edit'
  content: string
  proposal?: CommandProposal
  fileOffer?: FileOffer
  commandRun?: CommandRun
  phaseUpdate?: PhaseUpdate
  fileRead?: FileReadRecord
  fileEdit?: FileEditRecord
  reasoning?: string
  reasoningExpanded?: boolean
  uploads?: UploadedFile[]
}

export interface PersistedChatUi {
  messages: PersistedChatMessage[]
  status: AgentStatus
  statusMessage: string
  lastPreview?: string
}

export interface ConversationListItem {
  caseId: string
  title: string
  subtitle?: string
  preview?: string
  updatedAt: string
}
