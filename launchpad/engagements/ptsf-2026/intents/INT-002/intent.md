---
id: INT-002
phase: 1
epic: E07
confidence: Assumed
surface: security
origin: scopezilla
source: ptsf-scoping-2026#INT-002
title: Keep medical history out of reach of every PTSF internal user
---

# INT-002 — Keep medical history out of reach of every PTSF internal user

## Outcome

No assessor, manager or other PTSF staff user can view medical history through any screen, report, search, list view or export, and the few identities that technically could are named and monitored.

## Build target

- No internal profile or permission set grants object or field access to Medical History
- Medical History is excluded from search, reports, list views and exports available to internal users
- A named break-glass list of override identities (administrators, integration, migration, sharing automation)
- Monitoring and a periodic review record of any access by break-glass identities
- An automated negative-access test that runs on every deployment and fails if any internal user can reach Medical History

## Guardrails

- Never add Medical History to an internal permission set, even read-only, to fix a build problem.
- Override identities are kept to the minimum and documented by name.
- The negative-access test is a release gate, not an optional check.

## Out of scope

- Must not configure Shield encryption or Event Monitoring licensing until G0004/G0706 are answered.
- Must not handle medical content in chat transcripts (handled by INT-025 open questions).

## Acceptance

Ravi Menon, an assessor in the Singapore office, opens Aiko Tan's subsidy application: he sees treatment type, reason and the practitioner's eligibility outcome, but no medical history tab, field or related list. A global search for a condition named in Aiko's history returns nothing for him. Sofia Alvarez, his manager, sees the same. The deployment pipeline shows the negative-access test passing for every internal profile.

## Success criteria

_none_

## Dependencies

### Internal
- INT-003

### External
_none_

## Open questions

- Q-003: Does PTSF accept the named break-glass control set, or does it require a stronger technical guarantee against administrators? (Resolver: PTSF privacy officer + executive sponsor) — UNANSWERED

## Grounding

- Requirement: Brief: Visibility & Accessibility — PTSF internal users cannot see medical history at all
- decision: 0002 — Medical history control set (ptsf-scoping-2026:decisions/0002-medical-history-control-set.md@8eb2432b0381)
- Source: ptsf-scoping-2026#INT-002
