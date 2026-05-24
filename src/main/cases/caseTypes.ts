import type { CaseTypeOption } from '../../shared/contracts'

/** Default skills mounted into every new case workspace, in addition to any
 *  case-type-specific ones. Auto-discovered at startup; missing ones are skipped. */
export const DEFAULT_SKILL_IDS = ['pdf', 'docx', 'pptx', 'xlsx']

export const CASE_TYPES: CaseTypeOption[] = [
  {
    id: 'sc-100-small-claims',
    name: 'Small Claims (SC-100)',
    description:
      'California small claims case. Use this if you want to recover up to $12,500 from a person or business.',
    defaultPolicyPresetId: 'open',
    skillIds: ['sc-100-small-claims', ...DEFAULT_SKILL_IDS]
  }
]

export function getCaseType(id: string): CaseTypeOption | undefined {
  return CASE_TYPES.find((caseType) => caseType.id === id)
}
