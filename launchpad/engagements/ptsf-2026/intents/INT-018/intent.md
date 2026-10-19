---
id: INT-018
phase: 3
epic: E05
confidence: Assumed
surface: experience-cloud
origin: scopezilla
source: ptsf-scoping-2026#INT-018
title: Practitioners accept or decline allocations on the practitioner site
---

# INT-018 — Practitioners accept or decline allocations on the practitioner site

## Outcome

A practitioner sees the applications allocated to them, accepts or declines each with a reason, and accepting opens their access to the work.

## Build target

- A practitioner site home showing allocated, accepted and completed applications
- Accept and decline actions, with a decline reason list
- Acceptance triggers the medical history access grant (INT-001)
- Decline triggers reassignment (INT-017)
- Patient contact details and service description visible per INT-003

## Guardrails

- Practitioners sign in with their own credentials; shared logins are not supported.

## Out of scope

- Must not build the assessment form (handled by INT-019).

## Acceptance

Dr. Lena Okafor follows the email link, signs in to the practitioner site and sees Aiko Tan's application under 'Awaiting your response' with Aiko's name, phone, email and service description. She accepts it; the application moves to 'In assessment' and she can now open the assessment. Dr. Marcus Reid declines Omar Haddad's application choosing 'Outside my specialty', and it is reassigned.

## Success criteria

_none_

## Dependencies

### Internal
- INT-001
- INT-003
- INT-017

### External
_none_

## Open questions

- Q-019: How do practitioners authenticate, and what multi-factor policy applies to them? (Resolver: PTSF IT security lead) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 5 — practitioner must accept
- Source: ptsf-scoping-2026#INT-018
