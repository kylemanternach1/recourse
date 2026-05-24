# Skill: California Small Claims (SC-100)

Orchestrates the full small-claims lifecycle. Read this index, then open the **phase checklist** for the case's current phase.

## Phase checklists

| Phase | File |
|-------|------|
| 00 Intake | [sc-100-intake.md](sc-100-intake.md) |
| 01 Eligibility | [phase-01-eligibility.md](phase-01-eligibility.md) |
| 02 Venue & parties | [phase-02-parties-venue.md](phase-02-parties-venue.md) |
| 03 Evidence & damages | [damages-worksheet.md](damages-worksheet.md) |
| 04 Forms packet | [phase-04-forms.md](phase-04-forms.md) |
| 05 Filing | [phase-05-filing.md](phase-05-filing.md) + [filing-guide.md](filing-guide.md) |
| 06 Service | [phase-06-service.md](phase-06-service.md) |
| 07 Hearing prep | [phase-07-hearing-prep.md](phase-07-hearing-prep.md) |
| 08 Hearing & judgment | [phase-08-hearing.md](phase-08-hearing.md) |
| 09 Enforcement | [phase-09-enforcement.md](phase-09-enforcement.md) |
| 10 Closure | [phase-10-closure.md](phase-10-closure.md) |

## Deep reference

- Workflow playbooks: `ca/small_claims_workflow/` (one file per phase)
- Official PDFs: `ca/court_forms/` (sc100.pdf, sc104.pdf, etc.)
- Statutes: `ca/statutes/` (search with `rg -n`)

## Standard draft files

| File | Purpose |
|------|---------|
| `draft/damages.md` | Itemized damages |
| `draft/forms/sc100-filled.pdf` | Filled official SC-100 PDF |
| `draft/sc100-field-map.md` | SC-100 field worksheet / verification map |
| `draft/forms/sc100a-filled.pdf` | Additional plaintiffs/defendants, if needed |
| `draft/forms/sc103-filled.pdf` | Fictitious business name, if needed |
| `draft/forms/fw001-filled.pdf` | Fee waiver request, if needed |
| `draft/sc104.md` | Proof of service worksheet |
| `draft/exhibit-index.md` | Hearing exhibits |
| `draft/hearing-script.md` | What to say at hearing |
| `draft/post-judgment-plan.md` | Collection plan |

## Guardrails

- Do not invent facts. Use `update_case_state` when facts or phase status change.
- Do not edit files under `ca/`. Write drafts under `draft/`.
- For Judicial Council forms, copy and fill official PDFs under `draft/forms/`; markdown worksheets do not substitute for the filed form.
- This is procedural guidance, not legal advice.
