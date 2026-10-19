---
id: INT-001
phase: 1
epic: E07
confidence: Assumed
surface: security
origin: scopezilla
source: ptsf-scoping-2026#INT-001
title: Grant a practitioner medical-history access only while their assessment is open
---

# INT-001 — Grant a practitioner medical-history access only while their assessment is open

## Outcome

A practitioner can read a patient's medical history for exactly as long as they hold an open, accepted assessment on that patient's application, and loses it the moment the assessment closes, is declined or times out.

## Build target

- Medical History stored on its own record, separate from the subsidy application and from the assessor-visible assessment outcome
- Access to the application's Medical History version is granted to the practitioner when they accept the assessment
- Access is revoked when the assessment is submitted, closed, declined or times out
- Each grant and revoke is logged with practitioner, application, timestamp and reason
- A specialist added to the application receives their own access window on the same rules

## Guardrails

- Medical History records are never owned by the patient; they are owned by a system owner pool (decision 0002).
- Org-wide access to Medical History is Private for internal and external users.
- A practitioner never sees medical history for an application they have not accepted.
- Revocation must be immediate on close, decline or timeout, not batched overnight.

## Out of scope

- Must not build the accept/decline user experience (handled by INT-018).
- Must not build the assessment form itself (handled by INT-019).
- Must not grant any internal user access to Medical History (enforced by INT-002).

## Acceptance

Dr. Lena Okafor accepts the assessment for Aiko Tan's application and opens the Medical History tab: she sees Aiko's confirmed history for this application. She submits the assessment; on refresh the history is no longer visible to her. Dr. Marcus Reid, allocated to the same application earlier but who declined, cannot open the history at any point. The access log shows one grant and one revoke for Dr. Okafor.

## Success criteria

_none_

## Dependencies

### Internal
- INT-003

### External
_none_

## Open questions

- Q-001: Does access start at acceptance or at allocation, and end at assessment submission or at the application decision? (Resolver: PTSF privacy officer + Solution Architect) — UNANSWERED
- Q-002: Is medical history one living record per patient or a version per application? (Resolver: PTSF clinical lead) — UNANSWERED

## Grounding

- Requirement: Brief: Visibility & Accessibility — medical history only during an open assigned assessment
- decision: 0002 — Medical history control set (ptsf-scoping-2026:decisions/0002-medical-history-control-set.md@8eb2432b0381)
- Requirement: PTSF Lab Scenario Brief (ptsf-scoping-2026:discovery-notes/ptsf-brief.md@8eb2432b0381)
- Source: ptsf-scoping-2026#INT-001
