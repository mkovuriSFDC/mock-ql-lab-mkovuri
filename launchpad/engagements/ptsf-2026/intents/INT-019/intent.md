---
id: INT-019
phase: 3
epic: E05
confidence: Assumed
surface: screen-flow
origin: scopezilla
source: ptsf-scoping-2026#INT-019
title: Practitioners complete the medical assessment online
---

# INT-019 — Practitioners complete the medical assessment online

## Outcome

Practitioners complete and submit the medical assessment on the practitioner site, replacing the download-print-scan-email PDF process and the manual re-keying it causes.

## Build target

- A digital assessment form on the practitioner site based on PTSF's current PDF form
- Conditional sections by treatment category
- Clinical findings stored as medical history; the eligibility outcome stored on the assessment for assessors
- Supporting document upload stored with the clinical content
- Save as draft and submit

## Guardrails

- Clinical content never lands on a record or field internal users can see (decision 0002).
- Required fields are validated before submission so assessors never receive an incomplete form.

## Out of scope

- Must not handle specialist requests (handled by INT-020).
- Must not decide the subsidy (handled by INT-022, INT-024).

## Acceptance

Dr. Lena Okafor opens Aiko Tan's assessment, sees Aiko's medical history alongside the form, completes the dialysis section, uploads a referral letter and submits. Ravi Menon then sees the assessment outcome ('Eligible: treatment confirmed, mobility assistance needed') but none of the clinical findings or the referral letter.

## Success criteria

_none_

## Dependencies

### Internal
- INT-018
- INT-001

### External
_none_

## Open questions

- Q-020: Which fields of the assessment are clinical (medical history) and which form the eligibility outcome assessors see? (Resolver: PTSF clinical lead + privacy officer) — UNANSWERED
- Q-021: Is there one form for all treatments or variants per treatment type? Please supply the current PDF form(s). (Resolver: PTSF clinical lead) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Assessment 1 — replace the error-prone PDF process
- decision: 0002 — Medical history control set (ptsf-scoping-2026:decisions/0002-medical-history-control-set.md@8eb2432b0381)
- Source: ptsf-scoping-2026#INT-019
