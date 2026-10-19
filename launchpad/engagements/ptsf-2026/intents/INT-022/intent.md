---
id: INT-022
phase: 3
epic: E06
confidence: Assumed
surface: console
origin: scopezilla
source: ptsf-scoping-2026#INT-022
title: Route assessed applications to assessors by office
---

# INT-022 — Route assessed applications to assessors by office

## Outcome

Applications whose assessments are complete reach an available assessor in the right office automatically, and assessors work them from one workspace.

## Build target

- Applications with all assessments submitted are routed to the owning office's assessor queue
- Work pushed to available assessors in that office
- An assessor workspace showing the application, the patient's non-clinical details, assessment outcomes and allocation history
- Decision actions: approve, reject with reason, return for more information

## Guardrails

- The workspace shows no medical history (INT-002).

## Out of scope

- Must not calculate the subsidy amount (handled by INT-023).
- Must not run Manager approval (handled by INT-024).

## Acceptance

Dr. Lena Okafor submits Aiko Tan's assessment. Within minutes the application appears in Ravi Menon's Singapore workspace with the assessment outcome and allocation history. He returns it for more information; Aiko receives a request in her language.

## Success criteria

_none_

## Dependencies

### Internal
- INT-019
- INT-003

### External
_none_

## Open questions

- Q-024: What decision outcomes exist besides approve, and how is the patient told of each? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Users of the System — Assessors review applications and assessments
- Source: ptsf-scoping-2026#INT-022
