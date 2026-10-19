---
id: INT-011
phase: 2
epic: E10
confidence: Unknown
surface: integration
origin: scopezilla
source: ptsf-scoping-2026#INT-011
title: Validate and geocode addresses
---

# INT-011 — Validate and geocode addresses

## Outcome

Patient and practice addresses are validated and carry reliable coordinates, so allocation by distance works for every patient.

## Build target

- Real-time address validation with suggestions during patient onboarding
- Coordinates stored on validated patient and practice addresses
- A batch geocoding run for practice locations and bulk-loaded addresses
- A report of addresses missing coordinates

## Guardrails

- An address without coordinates is flagged, never silently skipped by allocation.

## Out of scope

- Must not select the address provider (PTSF decision, G0003).

## Acceptance

Aiko Tan types a partial Singapore address; the site suggests the validated address and she selects it. The patient record shows coordinates. The data steward runs batch geocoding over 4,000 practice addresses and the missing-coordinates report lists the 12 that failed.

## Success criteria

_none_

## Dependencies

### Internal
_none_

### External
- Address validation and geocoding provider (to be named) | API, licence terms for storing coordinates, batch capacity | owner: PTSF IT

## Open questions

- Q-012: Which provider, and does its licence allow storing coordinates? (Resolver: PTSF IT + procurement) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Onboarding 2b — validate the physical address
- Source: ptsf-scoping-2026#INT-011
