---
id: INT-015
phase: 2
epic: E03
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-015
title: Auto-reject applications whose travel is covered by insurance
---

# INT-015 — Auto-reject applications whose travel is covered by insurance

## Outcome

Each submitted application is checked against the patient's insurance in the background; covered applications are rejected with a notice to the patient, and the rest move to Eligible.

## Build target

- Coverage check runs in the background when an application enters 'Pending Insurance Check'
- Covered applications move to 'Rejected — Covered by Insurance'
- Not-covered applications move to 'Eligible'
- The patient is notified of a rejection in their language with a way to request review
- Failed checks after retries go to the assessor exception queue

## Guardrails

- No practitioner is allocated before an application is Eligible.
- Only full travel coverage auto-rejects unless PTSF decides otherwise (Q-015).

## Out of scope

- Must not build the insurer connection (handled by INT-010).

## Acceptance

Aiko Tan's application is checked within a minute of submission; her insurer does not cover travel, so it moves to Eligible. Omar Haddad's insurer covers travel: his application moves to Rejected — Covered by Insurance and he receives an email explaining why and how to request a review.

## Success criteria

_none_

## Dependencies

### Internal
- INT-010
- INT-014

### External
_none_

## Open questions

- Q-015: Does partial coverage reject the application or reduce the subsidy? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 3 — auto-reject if insurance covers travel
- Source: ptsf-scoping-2026#INT-015
