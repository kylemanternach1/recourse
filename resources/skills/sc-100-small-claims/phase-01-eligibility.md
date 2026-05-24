# Phase 01 — Eligibility & limits

Confirm the dispute belongs in California small claims before drafting forms.

## Checklist

- [ ] Plaintiff type: individual ($12,500 max) vs business/entity/other ($6,250 max)
- [ ] Remedy is **money only** (not eviction, family, probate, injunction)
- [ ] Amount does not exceed limit (or plaintiff will waive excess)
- [ ] Statute of limitations — flag if incident is very old
- [ ] Filing frequency: max 2 claims over $2,500 per calendar year
- [ ] Government defendant? Written government claim required first — block filing until resolved

## Outputs

- Update `intake.md` with eligibility notes
- Optional: `draft/eligibility-notes.md` if issues need tracking

## When done

Call `update_case_state` to mark `eligibility` complete and set `parties_venue` to `in_progress`.
