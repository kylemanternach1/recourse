import type { CaseRecord } from '../../shared/contracts'
import { formatWaitElapsed, PHASE_LABELS, currentPhaseState } from '../../shared/lifecycle'
import { intakeSummaryLine } from '../../shared/intake'

export function PhaseBanner({
  caseRecord,
  onOpenTimeline
}: {
  caseRecord: CaseRecord
  onOpenTimeline: () => void
}): JSX.Element {
  const summary =
    intakeSummaryLine(caseRecord) ??
    (caseRecord.title.trim() !== 'New case' ? caseRecord.title.trim() : null)
  const lifecycle = caseRecord.lifecycle
  const phase = currentPhaseState(lifecycle)
  const label = PHASE_LABELS[phase.phaseId]
  const pillLabel = label.number ? `${label.number} ${label.short}` : label.short

  const isEarlyIntake =
    phase.phaseId === 'intake' &&
    !caseRecord.intake.whatHappened.trim() &&
    !caseRecord.intake.plaintiffName.trim()

  const waitElapsed =
    phase.status === 'waiting' ? formatWaitElapsed(phase.waitingSince) : null

  const detailLine = (() => {
    if (phase.status === 'waiting' && phase.waitingOn) {
      const elapsed = waitElapsed ? ` · ${waitElapsed}` : ''
      return `Waiting for ${phase.waitingOn}${elapsed}`
    }
    if (phase.nextAction) {
      return phase.nextAction
    }
    if (isEarlyIntake) {
      return 'Describe your case to get started'
    }
    return null
  })()

  const timelineButton = (
    <button type="button" className="timeline-trigger" onClick={onOpenTimeline}>
      Timeline
      <span className="timeline-trigger-arrow" aria-hidden>
        →
      </span>
    </button>
  )

  return (
    <div className={`case-context-banner${summary ? '' : ' case-context-banner--compact'}`}>
      {summary ? (
        <div className="phase-banner-top">
          <h2 className="case-context-line">{summary}</h2>
          {timelineButton}
        </div>
      ) : null}
      <div className="phase-banner-main">
        <div className="phase-banner-main-info">
          <span className="phase-pill">{isEarlyIntake ? 'Getting started' : pillLabel}</span>
          {detailLine ? (
            <span className={`phase-banner-detail${phase.status === 'waiting' ? ' phase-banner-detail--wait' : ''}`}>
              {phase.status === 'waiting' ? <span className="phase-wait-icon" aria-hidden>⏳</span> : null}
              {detailLine}
            </span>
          ) : null}
        </div>
        {summary ? null : timelineButton}
      </div>
    </div>
  )
}
