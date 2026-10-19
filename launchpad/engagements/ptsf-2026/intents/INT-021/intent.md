---
id: INT-021
phase: 3
epic: E05
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-021
title: Escalate assessments still pending 15 days after assignment
---

# INT-021 — Escalate assessments still pending 15 days after assignment

## Outcome

Team Managers are alerted to any assessment still pending 15 days after it was assigned, so no application stalls unseen.

## Build target

- A 15-day clock from assignment on each assessment
- At day 15, the owning office's Team Manager is notified with a task to follow up
- A list view of escalated assessments per office
- The clock stops when the assessment is submitted or closed

## Guardrails

- Escalation notices to managers never include medical history.

## Out of scope

- Must not reassign the practitioner automatically on escalation unless PTSF decides so (Q-023).

## Acceptance

Dr. Marcus Reid accepted an assessment for Chen Wei 15 days ago and hasn't submitted. This morning Sofia Alvarez, Team Manager for Singapore, receives a follow-up task and sees the assessment in 'Escalated assessments'. When Dr. Reid submits that afternoon, the item leaves the list.

## Success criteria

_none_

## Dependencies

### Internal
- INT-018

### External
_none_

## Open questions

- Q-023: Is the 15-day window calendar or business days, and does escalation only notify or also reassign? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Assessment 2 — escalate if pending 15 days
- Source: ptsf-scoping-2026#INT-021
