---
id: INT-009
phase: 1
epic: E01
confidence: Assumed
surface: experience-cloud
origin: scopezilla
source: ptsf-scoping-2026#INT-009
title: Existing TAMS patients claim their migrated account
---

# INT-009 — Existing TAMS patients claim their migrated account

## Outcome

A patient who already exists from TAMS proves who they are and gets portal access to their existing record and history, instead of creating a duplicate.

## Build target

- A 'claim your account' path on the patient site for existing patients
- Identity verification against migrated details before access is granted
- The portal user is created against the patient's existing record
- Failed or ambiguous matches route to an assisted-support queue

## Guardrails

- Never attach a portal user to a patient record without a successful verification.
- Verification evidence is never shown back to the person attempting to claim.

## Out of scope

- Must not migrate TAMS data (Phase 4, E11); build and test against synthetic migrated records.

## Acceptance

Chen Wei, a TAMS patient since 2023, chooses 'I've used PTSF before', enters his details and a one-time code sent to the email on file, and lands in his existing account showing his two prior applications. A second attempt with a wrong date of birth is refused and routed to assisted support.

## Success criteria

_none_

## Dependencies

### Internal
- INT-008

### External
_none_

## Open questions

- Q-010: Which migrated details are reliable enough to verify against (email, phone, date of birth, insurance number)? (Resolver: PTSF data owner) — UNANSWERED

## Grounding

- Source: ptsf-scoping-2026#INT-009
