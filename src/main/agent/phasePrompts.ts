import type { PhaseId } from '../../shared/contracts'

export interface PhasePromptEntry {
  goal: string
  toAdvance: string[]
  artifacts: string[]
  waitStates: string[]
  deepDive: string
  skillPage: string
}

export const PHASE_PROMPTS: Record<PhaseId, PhasePromptEntry> = {
  intake: {
    goal: 'Collect the plaintiff narrative and core facts in conversation — no forms in the UI.',
    toAdvance: [
      'Plaintiff can describe who owes them money, what happened, rough amount, and when.',
      'intake.md reflects confirmed facts (parties, amount, incident date, narrative).',
      'CaseRecord intake fields are updated via update_case_state when facts are confirmed.'
    ],
    artifacts: ['intake.md'],
    waitStates: [],
    deepDive: 'ca/small_claims_workflow/00_workflow_index.txt',
    skillPage: 'skills/sc-100-small-claims/sc-100-intake.md'
  },
  eligibility: {
    goal: 'Confirm the dispute belongs in California small claims (limits, remedy, SOL, government claims).',
    toAdvance: [
      'Plaintiff type and amount are within applicable limit ($12,500 individual / $6,250 entity).',
      'Remedy is money-only; no eviction, family, probate, or injunction routing needed.',
      'Statute-of-limitations risk assessed; government-claim prerequisite checked if applicable.',
      'Filing frequency (2 claims >$2,500/year) addressed if relevant.'
    ],
    artifacts: ['intake.md', 'draft/eligibility-notes.md?'],
    waitStates: ['Government agency response to written claim (if required)'],
    deepDive: 'ca/small_claims_workflow/01_eligibility_and_limits.txt',
    skillPage: 'skills/sc-100-small-claims/phase-01-eligibility.md'
  },
  parties_venue: {
    goal: 'Lock correct filing county and exact legal party names for all plaintiffs and defendants.',
    toAdvance: [
      'Venue basis documented (defendant residence/business, transaction, injury location).',
      'Full legal names for plaintiff(s) and defendant(s); business entities verified if needed.',
      'SC-100A planned if more than two defendants; SC-103 if fictitious business name.'
    ],
    artifacts: ['intake.md', 'draft/venue-parties.md?'],
    waitStates: [],
    deepDive: 'ca/small_claims_workflow/02_venue_parties_and_frequency.txt',
    skillPage: 'skills/sc-100-small-claims/phase-02-parties-venue.md'
  },
  evidence_damages: {
    goal: 'Build itemized damages, evidence index, and claim narrative tied to proof elements.',
    toAdvance: [
      'draft/damages.md lists each line item with supporting document reference.',
      'Total matches amount to claim on SC-100; offsets (insurance, refunds) applied.',
      'Evidence mapped to elements (promise, breach, causation, amount).',
      'Collectability noted if relevant.'
    ],
    artifacts: ['draft/damages.md', 'draft/evidence-index.md?'],
    waitStates: [],
    deepDive: 'ca/small_claims_workflow/03_evidence_and_damages.txt',
    skillPage: 'skills/sc-100-small-claims/damages-worksheet.md'
  },
  forms: {
    goal: 'Create filled copies of the official SC-100 and companion Judicial Council PDF forms using verified facts.',
    toAdvance: [
      'Official blank SC-100 PDF exists at ca/court_forms/sc100.pdf and was copied into the workspace before filling.',
      'Filled official SC-100 PDF exists (for example, draft/forms/sc100-filled.pdf) and was verified after writing.',
      'draft/sc100-field-map.md maps verified facts to form fields with no placeholders, but does not substitute for the official PDF.',
      'draft/damages.md totals match SC-100 Item 4 amount.',
      'Required companion official PDFs are copied, filled, and verified when applicable (SC-100A for 3+ defendants; SC-103 for DBA; FW-001 for fee waiver).',
      'County local forms identified if required.'
    ],
    artifacts: [
      'draft/forms/sc100-filled.pdf',
      'draft/sc100-field-map.md?',
      'draft/damages.md',
      'draft/forms/sc100a-filled.pdf?',
      'draft/forms/sc103-filled.pdf?',
      'draft/forms/fw001-filled.pdf?'
    ],
    waitStates: [],
    deepDive: 'ca/small_claims_workflow/04_forms_packet.txt',
    skillPage: 'skills/sc-100-small-claims/phase-04-forms.md'
  },
  filing: {
    goal: 'File the claim, obtain file-stamped SC-100, case number, and hearing date.',
    toAdvance: [
      'Filing method and county confirmed; fee or FW-001 submitted.',
      'File-stamped/conformed SC-100 obtained with case number.',
      'Hearing date, time, department, and courthouse/remote info recorded.',
      'Service deadline calculated from hearing date and defendant location.'
    ],
    artifacts: ['draft/filing-checklist.md?', 'draft/hearing-notice.md?'],
    waitStates: [
      'Court filing acceptance or rejection',
      'Fee waiver decision',
      'Conformed/file-stamped copy',
      'Hearing date assignment (typically 30–70 days after filing)'
    ],
    deepDive: 'ca/small_claims_workflow/05_filing_and_hearing_date.txt',
    skillPage: 'skills/sc-100-small-claims/phase-05-filing.md'
  },
  service: {
    goal: 'Properly serve every defendant and file proof of service before the deadline.',
    toAdvance: [
      'File-stamped SC-100 (+ related docs) served on each defendant by qualified server.',
      'draft/sc104.md completed with date, time, place, method per defendant.',
      'Proof of service filed with court before deadline (15 days in-county / 20 out-of-county before hearing).'
    ],
    artifacts: ['draft/sc104.md', 'draft/service-plan.md?'],
    waitStates: [
      'Server completion report',
      'Court processing proof of service',
      'Defendant response, payment, settlement, or SC-120 counterclaim'
    ],
    deepDive: 'ca/small_claims_workflow/06_service_of_process.txt',
    skillPage: 'skills/sc-100-small-claims/phase-06-service.md'
  },
  hearing_prep: {
    goal: 'Prepare exhibits, witnesses, counterclaim responses, and hearing presentation.',
    toAdvance: [
      'draft/exhibit-index.md with 3–5 key facts and one exhibit each.',
      'Witness plan confirmed; subpoena if needed.',
      'draft/hearing-script.md with opening, key points, and settlement position.',
      'SC-120 counterclaim addressed if defendant filed one.'
    ],
    artifacts: ['draft/exhibit-index.md', 'draft/hearing-script.md'],
    waitStates: ['Remote hearing instructions or exhibit upload deadline from court'],
    deepDive: 'ca/small_claims_workflow/07_hearing_preparation.txt',
    skillPage: 'skills/sc-100-small-claims/phase-07-hearing-prep.md'
  },
  hearing: {
    goal: 'Attend hearing, record outcome, and capture judgment details.',
    toAdvance: [
      'Hearing attended (in person or remote) with required documents.',
      'Outcome recorded: judgment, continuance, dismissal, default, or settlement.',
      'Judgment amount, costs, and payment terms noted if applicable.',
      'SC-130 Notice of Entry of Judgment obtained or expected.'
    ],
    artifacts: ['draft/hearing-outcome.md?'],
    waitStates: [
      'Judge decision if case taken under submission',
      'SC-130 mailing',
      'Voluntary payment',
      'Defendant appeal window (30 days)'
    ],
    deepDive: 'ca/small_claims_workflow/08_attend_hearing_and_judgment.txt',
    skillPage: 'skills/sc-100-small-claims/phase-08-hearing.md'
  },
  enforcement: {
    goal: 'Collect on a money judgment if the defendant does not pay voluntarily.',
    toAdvance: [
      '30-day appeal/waiting period observed before involuntary collection.',
      'Collection tool chosen (SC-133, wage garnishment, bank levy, lien).',
      'Payment ledger maintained; satisfaction filed when paid in full.'
    ],
    artifacts: ['draft/post-judgment-plan.md'],
    waitStates: [
      '30-day appeal period',
      'Voluntary or installment payments',
      'SC-133 response',
      'Sheriff/levying officer processing'
    ],
    deepDive: 'ca/small_claims_workflow/09_enforcement_if_you_win.txt',
    skillPage: 'skills/sc-100-small-claims/phase-09-enforcement.md'
  },
  closure: {
    goal: 'Track appeals, preserve records, renew judgment if needed, and close the case.',
    toAdvance: [
      'SC-130 mailing date recorded; appeal rights assessed.',
      'SC-140 filed if appealing; full case file preserved.',
      'Judgment renewal reminder set if applicable.',
      'Acknowledgment of Satisfaction filed when fully paid; case closed.'
    ],
    artifacts: ['draft/case-closure.md?'],
    waitStates: ['Appeal deadline', 'Other party appeal', 'Payment under judgment'],
    deepDive: 'ca/small_claims_workflow/10_appeals_records_and_follow_up.txt',
    skillPage: 'skills/sc-100-small-claims/phase-10-closure.md'
  }
}

export function formatPhasePromptBlock(phaseId: PhaseId): string {
  const entry = PHASE_PROMPTS[phaseId]
  const lines = [
    `Goal: ${entry.goal}`,
    '',
    'Required to advance:',
    ...entry.toAdvance.map((item) => `- ${item}`),
    '',
    'Files/artifacts to produce (verify with the appropriate tool before marking complete):',
    ...entry.artifacts.map((item) => `- ${item}`),
    '',
    entry.waitStates.length > 0
      ? `Possible wait states: ${entry.waitStates.join('; ')}`
      : 'No typical wait states in this phase.',
    '',
    `Deep dive: \`${entry.deepDive}\``,
    `Skill checklist: \`${entry.skillPage}\``
  ]
  return lines.join('\n')
}
