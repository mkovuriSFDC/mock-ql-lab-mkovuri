---
id: INT-006
phase: 1
epic: E01
confidence: Assumed
surface: security
origin: scopezilla
source: ptsf-scoping-2026#INT-006
title: Staff sign in with their regional directory credentials and land with the right access
---

# INT-006 — Staff sign in with their regional directory credentials and land with the right access

## Outcome

Assessors and managers in all three regions sign in with their existing regional directory credentials and arrive with the role, office and permissions their directory attributes describe.

## Build target

- Three single sign-on options on the internal login page, one per region (APAC, EMEA, AMER)
- Federation identifiers qualified by region so the same username in two directories can't collide
- User created or updated at first sign-in from directory attributes (region, office, manager, job role)
- Assessor and Manager access assigned from the job-role attribute
- Direct login with multi-factor authentication kept for named administrators

## Guardrails

- No internal user signs in with a Salesforce password except named break-glass administrators.
- A missing or unknown office attribute blocks provisioning rather than defaulting to broad access.

## Out of scope

- Must not configure the regional directories or their federation layer (PTSF IT owns them).
- Must not handle deprovisioning (handled by INT-007).

## Acceptance

Ravi Menon chooses 'APAC sign-in', authenticates against the APAC directory and lands in the assessor workspace with Singapore-office access. Sofia Alvarez signs in through the same option and receives Manager access. Hannah Weber signs in through 'EMEA sign-in' and lands with Frankfurt-office access.

## Success criteria

_none_

## Dependencies

### Internal
_none_

### External
- Regional Active Directory (APAC, EMEA, AMER) | SAML-capable federation per region with stable attributes (office, manager, job role) | owner: PTSF regional IT leads

## Open questions

- Q-007: What federation product fronts each regional directory, and which attributes can it send? (Resolver: PTSF regional IT leads) — UNANSWERED

## Grounding

- Requirement: Brief: Current Systems 3 — authenticate internal users against their regional AD instance
- Source: ptsf-scoping-2026#INT-006
