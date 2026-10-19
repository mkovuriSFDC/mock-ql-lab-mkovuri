---
id: INT-005
phase: 1
epic: E08
confidence: Unknown
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-005
title: Archive closed applications on PTSF's retention schedule
---

# INT-005 — Archive closed applications on PTSF's retention schedule

## Outcome

Closed applications, assessments and medical history leave the active data set on a defined schedule so performance holds as volume grows, while staying retrievable under the same visibility rules.

## Build target

- A scheduled job selects closed records past the retention threshold
- Selected records move to the agreed archive target and are removed from active storage
- Archived medical history keeps practitioner-only, internal-blind visibility
- A reconciliation log per archive run

## Guardrails

- Do not build until the retention policy and archive target are decided (G0801, G0802).
- Archiving never exposes medical history to internal users.

## Out of scope

- Must not purge any record without a PTSF-approved retention rule.

## Acceptance

With a retention rule of 'closed for more than N months', the data steward runs the archive job: closed applications past the threshold disappear from active lists, the run log shows counts archived, and Dr. Lena Okafor cannot see archived medical history for applications she no longer holds.

## Success criteria

_none_

## Dependencies

### Internal
- INT-001
- INT-004

### External
- PTSF data governance | approved retention policy and archive target | owner: PTSF data owner / privacy officer

## Open questions

- Q-006: Where do archived records go (in-platform big storage, off-platform archive, or purge), and must users see them in the interface? (Resolver: PTSF data owner + Technical Architect) — UNANSWERED

## Grounding

- Source: ptsf-scoping-2026#INT-005
