---
id: INT-008
phase: 1
epic: E01
confidence: Assumed
surface: experience-cloud
origin: scopezilla
source: ptsf-scoping-2026#INT-008
title: Patients register with email and password or Facebook
---

# INT-008 — Patients register with email and password or Facebook

## Outcome

A new patient creates one account on the patient site with either email and password or Facebook, and signing in either way later reaches the same account.

## Build target

- Self-registration on the patient site with email and password
- Sign-in and registration with Facebook
- A matching rule that links a Facebook identity to an existing email-registered patient
- A recovery path when Facebook returns no email or the patient loses Facebook access
- Language selector on public pages before registration

## Guardrails

- One patient, one account: never create a second patient record when an identity matches.
- Registration never collects medical history.

## Out of scope

- Must not build the onboarding wizard (handled by INT-012).
- Must not build account claiming for migrated patients (handled by INT-009).

## Acceptance

Aiko Tan registers on the patient site with her email, chooses English, and signs out. A week later she taps 'Continue with Facebook' with the same email: she lands in her existing account, not a new one. Omar Haddad registers with Facebook alone and receives an account tied to his Facebook email.

## Success criteria

_none_

## Dependencies

### Internal
_none_

### External
_none_

## Open questions

- Q-009: Which languages must the patient site offer at launch? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Onboarding 1 — create an account with email/password or Facebook
- Source: ptsf-scoping-2026#INT-008
