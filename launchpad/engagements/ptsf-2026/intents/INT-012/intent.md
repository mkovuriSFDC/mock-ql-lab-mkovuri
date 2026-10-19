---
id: INT-012
phase: 2
epic: E02
confidence: Assumed
surface: screen-flow
origin: scopezilla
source: ptsf-scoping-2026#INT-012
title: Patients complete onboarding with insurer prefill before they can apply
---

# INT-012 — Patients complete onboarding with insurer prefill before they can apply

## Outcome

On first sign-in, a patient completes a guided profile (name, email, date of birth, address, language, insurance) with details prefilled from their insurer, and cannot start a subsidy application until it's done.

## Build target

- A multi-step onboarding wizard shown at first sign-in on the patient site
- Insurance details captured early so the prefill lookup can run in the background
- Prefilled values shown for the patient to confirm or edit
- Address step using validation from INT-011
- Save-and-resume for a partly finished wizard
- An onboarding-complete marker that the application step checks
- Manual entry fallback when the insurer lookup is unavailable

## Guardrails

- The wizard never freezes while the insurer lookup runs.
- Applying is blocked server-side until onboarding is complete, not only hidden in the interface.

## Out of scope

- Must not send the welcome email (handled by INT-013).
- Must not collect medical history (handled by INT-014).

## Acceptance

Aiko Tan signs in for the first time and is taken to onboarding. She enters her insurer and policy number; while she fills in her date of birth, her name and address arrive prefilled and she confirms them. She closes the browser at step 4 and resumes at step 4 the next day. Until she finishes, the 'Apply for travel support' button stays unavailable.

## Success criteria

_none_

## Dependencies

### Internal
- INT-008
- INT-010
- INT-011

### External
_none_

## Open questions

- Q-013: Which value wins when insurer data conflicts with what the patient typed, and must the patient consent before the lookup? (Resolver: PTSF privacy officer + operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Onboarding 2, 2a, 2b, 2c
- Source: ptsf-scoping-2026#INT-012
