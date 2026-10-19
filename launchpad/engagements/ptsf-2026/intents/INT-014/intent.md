---
id: INT-014
phase: 2
epic: E03
confidence: Assumed
surface: screen-flow
origin: scopezilla
source: ptsf-scoping-2026#INT-014
title: Patients apply for travel support with re-confirmed medical history
---

# INT-014 — Patients apply for travel support with re-confirmed medical history

## Outcome

An onboarded patient submits a subsidy application with treatment type, reason and medical history, reviewing and confirming any history they gave before.

## Build target

- A guided application on the patient site: treatment type, reason for request, medical history
- Searchable treatment-type selection across 500+ types with plain-language, translated labels
- Previously provided history shown for the patient to confirm or edit
- A medical history version saved and linked to the new application
- Submitted applications enter a 'Pending Insurance Check' status

## Guardrails

- Only onboarded patients can create an application (INT-012 marker).
- Medical history entered here is never visible to internal users (INT-002).

## Out of scope

- Must not run the insurance coverage decision (handled by INT-015).
- Must not allocate a practitioner (handled by INT-016).

## Acceptance

Aiko Tan chooses 'Apply for travel support', searches 'dialysis' and picks the matching treatment type, enters her reason, and sees the history she gave last year. She adds a new medication and submits. Her application shows 'Pending Insurance Check'; Ravi Menon sees the new application in Singapore with no medical history visible.

## Success criteria

_none_

## Dependencies

### Internal
- INT-012
- INT-001
- INT-002

### External
_none_

## Open questions

- Q-014: Who owns the treatment-type list and its translations? (Resolver: PTSF clinical lead + data steward) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 1, 2
- Source: ptsf-scoping-2026#INT-014
