---
id: INT-016
phase: 2
epic: E04
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-016
title: Allocate each eligible application to the nearest registered practitioner
---

# INT-016 — Allocate each eligible application to the nearest registered practitioner

## Outcome

Every eligible application is allocated automatically to the closest practitioner registered for its treatment type and under their caseload cap, and the practitioner is notified.

## Build target

- Practitioner registrations per treatment type with availability and a caseload cap
- Allocation on 'Eligible': nearest registered, available practitioner by distance from the patient's address
- Practitioners who declined or timed out on this application are excluded
- Each allocation recorded as an allocation attempt
- Practitioner notified with a link to the practitioner site
- An assessor queue for applications with no remaining candidate

## Guardrails

- Never re-allocate to a practitioner who already declined or timed out on the same application.
- Applications without patient coordinates go to the assessor queue, never skipped.

## Out of scope

- Must not build the timeout and reassignment clock (handled by INT-017).
- Must not build the accept/decline screens (handled by INT-018).

## Acceptance

Aiko Tan's application becomes Eligible. Three practitioners are registered for dialysis near her: the closest is at her caseload cap, so the application goes to Dr. Lena Okafor, the next closest. Dr. Okafor receives an email with a link. The allocation log shows one attempt with the distance.

## Success criteria

_none_

## Dependencies

### Internal
- INT-011
- INT-015

### External
_none_

## Open questions

- Q-016: Straight-line or travel distance, and can allocation cross office or regional boundaries? (Resolver: PTSF operations lead) — UNANSWERED
- Q-017: What caseload cap applies, and do practitioners manage their own availability? (Resolver: PTSF operations lead + practitioner representative) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 4 — allocate by closest distance per treatment type
- Source: ptsf-scoping-2026#INT-016
