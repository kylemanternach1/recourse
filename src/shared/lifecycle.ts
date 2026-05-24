import type {
  ArtifactKind,
  CaseLifecycle,
  PhaseArtifact,
  PhaseId,
  PhaseState,
  PhaseStatus
} from './contracts'

export const PHASE_ORDER: PhaseId[] = [
  'intake',
  'eligibility',
  'parties_venue',
  'evidence_damages',
  'forms',
  'filing',
  'service',
  'hearing_prep',
  'hearing',
  'enforcement',
  'closure'
]

export interface PhaseLabel {
  short: string
  long: string
  number?: string
}

export const PHASE_LABELS: Record<PhaseId, PhaseLabel> = {
  intake: { short: 'Intake', long: 'Intake', number: '00' },
  eligibility: { short: 'Eligibility', long: 'Eligibility & limits', number: '01' },
  parties_venue: { short: 'Parties', long: 'Venue & parties', number: '02' },
  evidence_damages: { short: 'Evidence', long: 'Evidence & damages', number: '03' },
  forms: { short: 'Forms', long: 'Forms packet', number: '04' },
  filing: { short: 'Filing', long: 'Filing & hearing date', number: '05' },
  service: { short: 'Service', long: 'Service of process', number: '06' },
  hearing_prep: { short: 'Prep', long: 'Hearing preparation', number: '07' },
  hearing: { short: 'Hearing', long: 'Hearing & judgment', number: '08' },
  enforcement: { short: 'Enforcement', long: 'Enforcement', number: '09' },
  closure: { short: 'Closure', long: 'Appeals & closure', number: '10' }
}

export const PHASE_GROUPS: Array<{ label: string; phaseIds: PhaseId[] }> = [
  {
    label: 'Pre-filing',
    phaseIds: ['intake', 'eligibility', 'parties_venue', 'evidence_damages', 'forms']
  },
  {
    label: 'Filing & service',
    phaseIds: ['filing', 'service']
  },
  {
    label: 'Hearing',
    phaseIds: ['hearing_prep', 'hearing']
  },
  {
    label: 'Post-judgment',
    phaseIds: ['enforcement', 'closure']
  }
]

export function emptyPhaseState(phaseId: PhaseId, now = new Date().toISOString()): PhaseState {
  return {
    phaseId,
    status: phaseId === 'intake' ? 'in_progress' : 'not_started',
    artifacts: [],
    updatedAt: now
  }
}

export function emptyLifecycle(now = new Date().toISOString()): CaseLifecycle {
  return {
    currentPhase: 'intake',
    phases: PHASE_ORDER.map((phaseId) => emptyPhaseState(phaseId, now)),
    updatedAt: now
  }
}

export function getPhaseState(lifecycle: CaseLifecycle, phaseId: PhaseId): PhaseState | undefined {
  return lifecycle.phases.find((phase) => phase.phaseId === phaseId)
}

export function currentPhaseState(lifecycle: CaseLifecycle): PhaseState {
  const phase = getPhaseState(lifecycle, lifecycle.currentPhase)
  if (!phase) {
    throw new Error(`Missing phase state for ${lifecycle.currentPhase}`)
  }
  return phase
}

export function phaseIndex(phaseId: PhaseId): number {
  return PHASE_ORDER.indexOf(phaseId)
}

export function phaseBefore(phaseId: PhaseId): PhaseId | undefined {
  const index = phaseIndex(phaseId)
  return index > 0 ? PHASE_ORDER[index - 1] : undefined
}

export function phaseAfter(phaseId: PhaseId): PhaseId | undefined {
  const index = phaseIndex(phaseId)
  return index >= 0 && index < PHASE_ORDER.length - 1 ? PHASE_ORDER[index + 1] : undefined
}

export interface PhaseStatePatch {
  phaseId: PhaseId
  status?: PhaseStatus
  nextAction?: string | null
  waitingOn?: string | null
  waitingSince?: string | null
  expectedBy?: string | null
  artifacts?: PhaseArtifact[]
  appendArtifacts?: PhaseArtifact[]
}

export interface LifecyclePatch {
  currentPhase?: PhaseId
  phases?: PhaseStatePatch[]
}

function mergeArtifacts(
  existing: PhaseArtifact[],
  replace?: PhaseArtifact[],
  append?: PhaseArtifact[]
): PhaseArtifact[] {
  if (replace) {
    return [...replace]
  }
  if (!append || append.length === 0) {
    return existing
  }
  const byPath = new Map(existing.map((artifact) => [artifact.path, artifact]))
  for (const artifact of append) {
    byPath.set(artifact.path, artifact)
  }
  return [...byPath.values()]
}

export function applyLifecyclePatch(
  lifecycle: CaseLifecycle,
  patch: LifecyclePatch,
  now = new Date().toISOString()
): CaseLifecycle {
  const phases = lifecycle.phases.map((phase) => {
    const phasePatch = patch.phases?.find((entry) => entry.phaseId === phase.phaseId)
    if (!phasePatch) {
      return phase
    }

    const next: PhaseState = {
      ...phase,
      status: phasePatch.status ?? phase.status,
      nextAction:
        phasePatch.nextAction === null
          ? undefined
          : phasePatch.nextAction !== undefined
            ? phasePatch.nextAction
            : phase.nextAction,
      waitingOn:
        phasePatch.waitingOn === null
          ? undefined
          : phasePatch.waitingOn !== undefined
            ? phasePatch.waitingOn
            : phase.waitingOn,
      waitingSince:
        phasePatch.waitingSince === null
          ? undefined
          : phasePatch.waitingSince !== undefined
            ? phasePatch.waitingSince
            : phase.waitingSince,
      expectedBy:
        phasePatch.expectedBy === null
          ? undefined
          : phasePatch.expectedBy !== undefined
            ? phasePatch.expectedBy
            : phase.expectedBy,
      artifacts: mergeArtifacts(
        phase.artifacts,
        phasePatch.artifacts,
        phasePatch.appendArtifacts
      ),
      updatedAt: now
    }

    if (phasePatch.status === 'waiting' && !next.waitingSince) {
      next.waitingSince = now
    }
    if (
      phasePatch.status &&
      phasePatch.status !== 'waiting' &&
      phasePatch.waitingOn === undefined &&
      (phase.status === 'waiting' || phasePatch.status === 'complete' || phasePatch.status === 'in_progress')
    ) {
      next.waitingOn = undefined
      next.waitingSince = undefined
      next.expectedBy = undefined
    }

    return next
  })

  let currentPhase = patch.currentPhase ?? lifecycle.currentPhase
  const currentPatch = patch.phases?.find((entry) => entry.phaseId === currentPhase)
  if (currentPatch?.status === 'complete') {
    const nextPhase = phaseAfter(currentPhase)
    if (nextPhase) {
      currentPhase = nextPhase
      const nextState = phases.find((phase) => phase.phaseId === nextPhase)
      if (nextState && nextState.status === 'not_started') {
        nextState.status = 'in_progress'
        nextState.updatedAt = now
      }
    }
  }

  return {
    currentPhase,
    phases,
    updatedAt: now
  }
}

export function lifecycleSnapshotLine(phase: PhaseState, isCurrent: boolean): string {
  const label = PHASE_LABELS[phase.phaseId].short
  if (isCurrent) {
    return `${label}: current (${phase.status})`
  }
  if (phase.status === 'complete' || phase.status === 'skipped') {
    return `${label}: done`
  }
  if (phase.status === 'waiting') {
    return `${label}: waiting`
  }
  if (phase.status === 'blocked') {
    return `${label}: blocked`
  }
  if (phase.status === 'in_progress') {
    return `${label}: in progress`
  }
  return `${label}: not started`
}

export function activeWaitStates(lifecycle: CaseLifecycle): PhaseState[] {
  return lifecycle.phases.filter(
    (phase) => phase.status === 'waiting' && (phase.waitingOn?.trim().length ?? 0) > 0
  )
}

export function phaseStatusDisplay(status: PhaseStatus): string {
  switch (status) {
    case 'not_started':
      return 'Not started'
    case 'in_progress':
      return 'In progress'
    case 'waiting':
      return 'Waiting'
    case 'blocked':
      return 'Blocked'
    case 'complete':
      return 'Complete'
    case 'skipped':
      return 'Skipped'
    default:
      return status
  }
}

export function formatPhaseUpdatedAt(iso: string): string | null {
  const date = Date.parse(iso)
  if (Number.isNaN(date)) {
    return null
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

export function formatWaitElapsed(waitingSince?: string): string | null {
  if (!waitingSince) {
    return null
  }
  const start = Date.parse(waitingSince)
  if (Number.isNaN(start)) {
    return null
  }
  const days = Math.max(0, Math.floor((Date.now() - start) / (1000 * 60 * 60 * 24)))
  if (days === 0) {
    return 'today'
  }
  if (days === 1) {
    return '1d ago'
  }
  return `${days}d ago`
}

export function isValidArtifactKind(value: string): value is ArtifactKind {
  return value === 'draft' || value === 'evidence' || value === 'filed' || value === 'note'
}
