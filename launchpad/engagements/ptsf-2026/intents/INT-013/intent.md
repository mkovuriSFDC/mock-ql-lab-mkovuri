---
id: INT-013
phase: 2
epic: E02
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-013
title: Send a welcome email in the patient's language when onboarding completes
---

# INT-013 — Send a welcome email in the patient's language when onboarding completes

## Outcome

Every patient who completes onboarding receives a welcome email in their preferred language explaining how the subsidy application process works.

## Build target

- Welcome email sent once on onboarding completion
- One email version per supported language, chosen from the patient's language preference
- Fallback to English when a language version is missing

## Guardrails

- Never sent to migrated patients during data loads (automation suppressed for migration).

## Out of scope

- Must not author the translated copy (PTSF content owners supply it).

## Acceptance

Aiko Tan completes onboarding with English selected and receives the English welcome email within minutes. Lucía Fernández completes it with Spanish selected and receives the Spanish version.

## Success criteria

_none_

## Dependencies

### Internal
- INT-012

### External
_none_

## Open questions

_none_

## Grounding

- Requirement: Brief: Patient Onboarding 2d — welcome email in language of preference
- Source: ptsf-scoping-2026#INT-013
