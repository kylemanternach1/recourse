import { useEffect, useRef } from 'react'
import type { CaseRecord, PhaseState } from '../../shared/contracts'
import {
  PHASE_GROUPS,
  PHASE_LABELS,
  formatPhaseUpdatedAt,
  formatWaitElapsed,
  phaseStatusDisplay
} from '../../shared/lifecycle'
import { conversationTitle } from '../../shared/intake'
import type { ChatMessage } from '../lib/chatUi'
import { canJumpToPhaseInChat } from '../lib/phaseChat'

function PhaseCard({
  phase,
  isCurrent,
  jumpable,
  onJumpToPhase
}: {
  phase: PhaseState
  isCurrent: boolean
  jumpable: boolean
  onJumpToPhase: (phaseId: PhaseState['phaseId']) => void
}): JSX.Element {
  const label = PHASE_LABELS[phase.phaseId]
  const waitElapsed =
    phase.status === 'waiting' ? formatWaitElapsed(phase.waitingSince) : null
  const reachedAt = formatPhaseUpdatedAt(phase.updatedAt)

  return (
    <article
      className={`phase-card phase-card--${phase.status}${isCurrent ? ' phase-card--current' : ''}${jumpable ? ' phase-card--jumpable' : ''}`}
      data-phase-id={phase.phaseId}
    >
      {jumpable ? (
        <button
          type="button"
          className="phase-card-hit"
          onClick={() => onJumpToPhase(phase.phaseId)}
        >
          <span className="sr-only">Jump to {label.long} in chat</span>
        </button>
      ) : null}
      <div className="phase-card-header">
        <div className="phase-card-title">
          {label.number ? <span className="phase-card-num">{label.number}</span> : null}
          <span className="phase-card-name">{label.long}</span>
        </div>
        <span className={`phase-card-pill phase-card-pill--${phase.status}`}>
          {phaseStatusDisplay(phase.status)}
        </span>
      </div>

      {phase.status === 'waiting' && phase.waitingOn ? (
        <p className="phase-card-wait">
          Waiting for {phase.waitingOn}
          {waitElapsed ? ` · ${waitElapsed}` : ''}
        </p>
      ) : null}

      {isCurrent && phase.nextAction ? (
        <p className="phase-card-next">Next: {phase.nextAction}</p>
      ) : null}

      {jumpable ? (
        <p className="phase-card-reached">View in chat{reachedAt ? ` · ${reachedAt}` : ''}</p>
      ) : reachedAt && phase.status !== 'not_started' ? (
        <p className="phase-card-reached phase-card-reached--muted">Updated · {reachedAt}</p>
      ) : null}
    </article>
  )
}

export function TimelineDrawer({
  open,
  caseRecord,
  messages,
  onClose,
  onJumpToPhase
}: {
  open: boolean
  caseRecord: CaseRecord | undefined
  messages: ChatMessage[]
  onClose: () => void
  onJumpToPhase: (phaseId: PhaseState['phaseId']) => void
}): JSX.Element | null {
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !caseRecord) {
      return
    }
    const currentId = caseRecord.lifecycle.currentPhase
    const el = bodyRef.current?.querySelector(`[data-phase-id="${currentId}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [open, caseRecord])

  if (!caseRecord) {
    return null
  }

  const title = conversationTitle(caseRecord)
  const currentId = caseRecord.lifecycle.currentPhase
  const phaseById = new Map(caseRecord.lifecycle.phases.map((phase) => [phase.phaseId, phase]))

  return (
    <>
      <div
        className={`timeline-backdrop${open ? ' timeline-backdrop--open' : ''}`}
        onClick={onClose}
        aria-hidden={!open}
      />
      <aside
        className={`timeline-drawer${open ? ' timeline-drawer--open' : ''}`}
        aria-hidden={!open}
        aria-label="Case timeline"
      >
        <header className="timeline-drawer-header">
          <div>
            <p className="timeline-drawer-eyebrow">Case timeline</p>
            <h2 className="timeline-drawer-title">{title}</h2>
          </div>
          <button type="button" className="timeline-drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <div className="timeline-drawer-body" ref={bodyRef}>
          {PHASE_GROUPS.map((group) => (
            <section key={group.label} className="timeline-group">
              <h3 className="phase-group-label">{group.label}</h3>
              <div className="timeline-group-cards">
                {group.phaseIds.map((phaseId) => {
                  const phase = phaseById.get(phaseId)
                  if (!phase) {
                    return null
                  }
                  return (
                    <PhaseCard
                      key={phaseId}
                      phase={phase}
                      isCurrent={phaseId === currentId}
                      jumpable={canJumpToPhaseInChat(messages, phaseId)}
                      onJumpToPhase={onJumpToPhase}
                    />
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </aside>
    </>
  )
}
