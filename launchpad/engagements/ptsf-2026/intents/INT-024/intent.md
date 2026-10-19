---
id: INT-024
phase: 3
epic: E06
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-024
title: Managers approve higher-value subsidies and the grant is recorded
---

# INT-024 — Managers approve higher-value subsidies and the grant is recorded

## Outcome

Subsidies above the region's threshold go to a Manager for approval before they are granted, and every grant is recorded with its approver and a booking reference for the office to book travel.

## Build target

- A configurable approval threshold per region
- Grants above the threshold routed to the office's Manager for approval
- Manager approve, reject or adjust, with the result returned to the assessor
- Approved grants recorded with approver, date and a booking reference field
- Patient notified of the decision in their language

## Guardrails

- An assessor cannot approve their own above-threshold grant.
- Thresholds are configuration owned by PTSF, not hard-coded.

## Out of scope

- Must not book travel or pay the patient (G0002).

## Acceptance

Ravi Menon grants Aiko Tan an amount above the Singapore threshold; it goes to Sofia Alvarez, who approves it. Aiko receives an approval email, and office staff enter the booking reference on the application. Ravi's below-threshold grant for Chen Wei completes without Manager approval.

## Success criteria

_none_

## Dependencies

### Internal
- INT-023

### External
_none_

## Open questions

- Q-026: What threshold applies per region, and how deep is the approval hierarchy? (Resolver: PTSF operations + finance leads) — UNANSWERED

## Grounding

- Requirement: Brief: Users of the System — Managers approve more expensive applications
- Source: ptsf-scoping-2026#INT-024
