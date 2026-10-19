---
id: INT-017
phase: 2
epic: E04
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-017
title: Reassign when a practitioner declines or doesn't accept within 3 business days
---

# INT-017 — Reassign when a practitioner declines or doesn't accept within 3 business days

## Outcome

An allocation that is declined, or not accepted within 3 business days on the practitioner's local calendar, is reassigned to the next nearest practitioner, and applications that run out of candidates reach an assessor.

## Build target

- A 3-business-day acceptance due date per allocation, using regional business hours and holidays
- On decline or due-date expiry, the allocation closes and INT-016 allocates the next candidate
- A configurable maximum number of attempts
- After the maximum, or when no candidate remains, the application goes to the assessor queue and the patient is told about the delay

## Guardrails

- The clock pauses outside the practitioner's business days and holidays.
- Allocation rule parameters (attempt limit, distance ceiling) are configuration, not code.

## Out of scope

- Must not build the 15-day assessment escalation (handled by INT-021).

## Acceptance

Dr. Marcus Reid is allocated Omar Haddad's application on a Thursday in Frankfurt and does nothing. On the following Tuesday, after the weekend and three business days, the allocation expires and Dr. Hannah Klein receives it. Lucía Fernández's application exhausts all three candidates and appears in the Madrid assessor queue; Lucía receives a delay notice.

## Success criteria

_none_

## Dependencies

### Internal
- INT-016

### External
_none_

## Open questions

- Q-018: Whose calendar governs the 3 days: the practitioner's location, the patient's region, or the owning office? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 5 — accept within 3 business days or reassign
- Source: ptsf-scoping-2026#INT-017
