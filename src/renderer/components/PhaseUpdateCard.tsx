import type { PhaseUpdate } from '../../shared/contracts'
import {
  PHASE_LABELS,
  formatPhaseUpdatedAt,
  phaseStatusDisplay
} from '../../shared/lifecycle'

export function PhaseUpdateCard({ update }: { update: PhaseUpdate }): JSX.Element {
  const label = PHASE_LABELS[update.phaseId]
  const when = formatPhaseUpdatedAt(update.at)

  return (
    <>
      <div className="msg-avatar phase-update-avatar" aria-hidden>
        ◆
      </div>
      <div className="phase-update-card">
        <p className="phase-update-label">Phase change</p>
        <div className="phase-update-main">
          <div className="phase-update-title">
            {label.number ? <span className="phase-update-num">{label.number}</span> : null}
            <span className="phase-update-name">{label.long}</span>
          </div>
          <span className={`phase-update-pill phase-update-pill--${update.status}`}>
            {phaseStatusDisplay(update.status)}
          </span>
        </div>
        {update.nextAction ? (
          <p className="phase-update-next">
            <span className="phase-update-next-kicker">Next</span>
            {update.nextAction}
          </p>
        ) : null}
        {when ? <p className="phase-update-time">{when}</p> : null}
      </div>
    </>
  )
}
