---
id: INT-004
phase: 1
epic: E08
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-004
title: Spread record ownership so no owner carries more than the platform comfortably handles
---

# INT-004 — Spread record ownership so no owner carries more than the platform comfortably handles

## Outcome

As the patient base grows toward ~38 million and applications toward ~7.6 million a year, records are owned across office owner pools so no single owner, queue or parent record becomes a performance hotspot.

## Build target

- An owner pool per satellite office for patient, application and medical history records
- Owner assigned on record creation by office, rotating within the pool
- Treatment type carried on the application as a stored code as well as a reference link
- A monitoring report showing record counts per owner against the 10,000-record guideline
- Indexed filters for the fields the timers and queues select on (status, date, office)

## Guardrails

- Never park records on a single integration or system user.
- No owner exceeds 10,000 records per object; the pool grows before that threshold.

## Out of scope

- Must not build archiving (handled by INT-005).
- Must not load migrated data (Phase 4, E11).

## Acceptance

The data steward runs the owner-distribution report after a 200,000-record synthetic load for the Singapore office: records are spread across the office's owner pool, no owner exceeds the guideline, and a new application created by Aiko Tan is owned by the next owner in rotation.

## Success criteria

_none_

## Dependencies

### Internal
_none_

### External
_none_

## Open questions

- Q-005: How many owner users per office pool, and who administers adding owners as volume grows? (Resolver: Technical Architect + PTSF platform owner) — UNANSWERED

## Grounding

- Source: ptsf-scoping-2026#INT-004
