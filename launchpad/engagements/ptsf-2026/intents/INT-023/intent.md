---
id: INT-023
phase: 3
epic: E06
confidence: Assumed
surface: lwc
origin: scopezilla
source: ptsf-scoping-2026#INT-023
title: Recommend a subsidy amount from distance and transport type
---

# INT-023 — Recommend a subsidy amount from distance and transport type

## Outcome

When approving, the assessor sees a recommended subsidy amount calculated from the patient's travel distance and expected transport types, and can override it with a reason.

## Build target

- A rate table by transport type (air, train, bus, taxi, and so on) and distance band, maintained by PTSF
- The recommended amount calculated from patient-to-treatment distance and selected transport types
- Assessor override with a mandatory reason
- The recommended amount, granted amount, override reason and rate-table version stored on the application

## Guardrails

- Rate changes never alter amounts already granted (snapshot on grant).

## Out of scope

- Must not book travel or pay the patient (out of scope, G0002).

## Acceptance

Ravi Menon approves Aiko Tan's application, selects 'train' and 'taxi', and sees a recommended amount based on her 180 km journey. He overrides it upward for a carer's fare, enters the reason, and saves. The application shows recommended and granted amounts with the rate version used.

## Success criteria

_none_

## Dependencies

### Internal
- INT-022
- INT-011

### External
_none_

## Open questions

- Q-025: What currency are amounts held in, and who owns the rate table? (Resolver: PTSF finance lead) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Assessment 4 — help determine amount from distance and transport type
- Source: ptsf-scoping-2026#INT-023
