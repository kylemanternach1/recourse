import type { CaseRecord, SmallClaimsIntake } from './contracts'

export const WELCOME_MESSAGE = [
  "Hi — I'm Recourse, your California small claims copilot.",
  '',
  'As the plaintiff, describe your case in your own words: **who owes you money**, **what happened**, roughly **how much**, and **when**.',
  '',
  "Don't worry about getting every detail right — I'll ask follow-ups for anything I need to file."
].join('\n')

export function emptyIntake(): SmallClaimsIntake {
  return {
    plaintiffName: '',
    plaintiffCity: '',
    defendantName: '',
    defendantType: 'individual',
    amountClaimed: 0,
    incidentDate: '',
    whatHappened: '',
    contactedDefendant: false
  }
}

export function isIntakeStarted(intake: SmallClaimsIntake): boolean {
  return (
    intake.plaintiffName.trim().length > 0 ||
    intake.defendantName.trim().length > 0 ||
    intake.whatHappened.trim().length > 0 ||
    intake.amountClaimed > 0
  )
}

/** One-line summary for the contextual header when enough intake is known. */
export function intakeSummaryLine(record: CaseRecord): string | null {
  const { intake, title } = record
  const parts: string[] = []

  if (intake.plaintiffName.trim() && intake.defendantName.trim()) {
    parts.push(`${intake.plaintiffName.trim()} v. ${intake.defendantName.trim()}`)
  } else if (title.trim() && title.trim() !== 'New case') {
    parts.push(title.trim())
  }

  if (intake.amountClaimed > 0) {
    parts.push(
      intake.amountClaimed.toLocaleString('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
      })
    )
  }

  return parts.length > 0 ? parts.join(' · ') : null
}

/** Sidebar label for a case / conversation. */
export function conversationTitle(record: CaseRecord): string {
  const summary = intakeSummaryLine(record)
  if (summary) {
    return summary
  }
  const title = record.title.trim()
  if (title.length > 0 && title !== 'New case') {
    return title
  }
  return 'New case'
}
