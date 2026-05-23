import type { CaseTypeOption } from '../../shared/contracts'

export const CASE_TYPES: CaseTypeOption[] = [
  {
    id: 'sc-100-small-claims',
    name: 'Small Claims (SC-100)',
    description:
      'California small claims case. Use this if you want to recover up to $12,500 from a person or business.',
    defaultPolicyPresetId: 'open',
    skillIds: ['sc-100-small-claims']
  }
]

export function getCaseType(id: string): CaseTypeOption | undefined {
  return CASE_TYPES.find((caseType) => caseType.id === id)
}
