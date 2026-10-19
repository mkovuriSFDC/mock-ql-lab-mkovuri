---
id: INT-026
phase: 3
epic: E09
confidence: Assumed
surface: agentforce
origin: scopezilla
source: ptsf-scoping-2026#INT-026
title: An AI assistant answers common questions and hands off to an assessor
---

# INT-026 — An AI assistant answers common questions and hands off to an assessor

## Outcome

Patients and practitioners get instant answers to common questions and their own application status from an AI assistant on both sites, and reach an assessor when the assistant can't help.

## Build target

- A knowledge base seeded from the static website's FAQs, in the supported languages
- An AI assistant on both sites that answers from the knowledge base
- An application-status answer scoped to the signed-in user's own applications
- Hand-off to an assessor chat (INT-025) with the conversation carried over
- A topic boundary: no medical advice and no access to medical history

## Guardrails

- The assistant never reads or reveals medical history, including the user's own.
- The assistant only answers about the signed-in user's own applications.
- The assistant says when it doesn't know and offers an assessor.

## Out of scope

- Must not offer the assistant to signed-out visitors unless PTSF decides so (Q-029).

## Acceptance

Aiko Tan asks the assistant 'What documents do I need for a dialysis application?' and gets an answer drawn from the knowledge base. She asks 'Where is my application?' and hears it is with an assessor. She asks 'Can you remind me what medication I listed?' and the assistant declines and offers an assessor; she accepts and Ravi Menon receives the chat with the conversation history.

## Success criteria

_none_

## Dependencies

### Internal
- INT-025

### External
_none_

## Open questions

- Q-029: Should signed-out visitors get the assistant, and what deflection result counts as success? (Resolver: PTSF operations lead) — UNANSWERED
- Q-030: Who writes and maintains knowledge articles and their translations? (Resolver: PTSF content owner) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 6 — deflect support requests for common questions
- Source: ptsf-scoping-2026#INT-026
