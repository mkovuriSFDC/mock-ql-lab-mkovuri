---
id: INT-020
phase: 3
epic: E05
confidence: Assumed
surface: automation
origin: scopezilla
source: ptsf-scoping-2026#INT-020
title: Practitioners request an additional specialist assessment
---

# INT-020 — Practitioners request an additional specialist assessment

## Outcome

A practitioner who needs another specialist's view can request one from the assessment, and the specialist is allocated and assesses under the same rules.

## Build target

- A 'request specialist assessment' action on an open assessment, naming the specialty and reason
- The specialist assessment allocated through the same nearest-registered logic (INT-016)
- The specialist gets their own acceptance window and medical history access window
- The application decision waits until all requested assessments are submitted

## Guardrails

- Each specialist's medical history access follows INT-001 independently.

## Out of scope

- Must not allow specialists to request further specialists unless PTSF confirms (Q-022).

## Acceptance

Dr. Lena Okafor requests a cardiology assessment for Aiko Tan. Dr. Priya Nair, the nearest cardiologist, accepts, sees Aiko's history, and submits her assessment. Ravi Menon sees both assessment outcomes and can now decide; before Dr. Nair submitted, the decision action was unavailable.

## Success criteria

_none_

## Dependencies

### Internal
- INT-019
- INT-016

### External
_none_

## Open questions

- Q-022: Does the requesting practitioner name the specialist or does the system allocate? Can a specialist request further specialists? (Resolver: PTSF clinical lead) — UNANSWERED

## Grounding

- Requirement: Brief: Patient Assessment 3 — request additional assessments
- Source: ptsf-scoping-2026#INT-020
