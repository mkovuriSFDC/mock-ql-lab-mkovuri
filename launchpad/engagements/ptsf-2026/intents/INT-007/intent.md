---
id: INT-007
phase: 1
epic: E01
confidence: Assumed
surface: security
origin: scopezilla
source: ptsf-scoping-2026#INT-007
title: Remove access promptly when staff leave or move office
---

# INT-007 — Remove access promptly when staff leave or move office

## Outcome

When a staff member leaves PTSF or changes office, their Salesforce access is deactivated or adjusted without relying on someone remembering to do it.

## Build target

- A deactivation path driven by the regional directories (leaver feed or periodic reconciliation)
- Office or role changes update the user's access on next sign-in or reconciliation
- A report of active users with no recent directory match, for access review

## Guardrails

- Deactivation reassigns open work items to the office queue before the user is frozen.

## Out of scope

- Must not build the access-review governance process itself (PTSF-owned, G0106).

## Acceptance

Hannah Weber is removed from the EMEA directory on Friday. By Monday's reconciliation her Salesforce user is deactivated, her three open applications sit in the Frankfurt office queue, and she appears in the deactivation log.

## Success criteria

_none_

## Dependencies

### Internal
- INT-006

### External
- Regional Active Directory (APAC, EMEA, AMER) | leaver signal or exportable user list for reconciliation | owner: PTSF regional IT leads

## Open questions

- Q-008: Can the regional directories push lifecycle changes, or must reconciliation run on a schedule? (Resolver: PTSF regional IT leads) — UNANSWERED

## Grounding

- Source: ptsf-scoping-2026#INT-007
