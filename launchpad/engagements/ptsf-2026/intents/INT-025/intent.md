---
id: INT-025
phase: 3
epic: E09
confidence: Assumed
surface: experience-cloud
origin: scopezilla
source: ptsf-scoping-2026#INT-025
title: Patients and practitioners chat with an assessor
---

# INT-025 — Patients and practitioners chat with an assessor

## Outcome

Signed-in patients and practitioners can start a chat from either site at any stage and reach an available assessor in the right office, with the application in context.

## Build target

- A chat entry point on the patient and practitioner sites for signed-in users
- Chats routed to available assessors in the user's office, with a regional fallback
- The assessor sees the chatter's identity and related application (non-clinical) beside the chat
- Outside chat hours, the user can leave a message that becomes a support request
- A notice reminding users not to share medical details in chat

## Guardrails

- Chat transcripts are treated as potentially containing medical content until PTSF decides handling (Q-027).

## Out of scope

- Must not build the AI agent (handled by INT-026).

## Acceptance

Aiko Tan opens chat from her application page and asks when she'll hear back. Ravi Menon receives the chat with Aiko's application status beside it and answers. At 11 pm Singapore time, Chen Wei opens chat, sees that chat is closed, and leaves a message that appears as a support request in the morning.

## Success criteria

_none_

## Dependencies

### Internal
- INT-003

### External
_none_

## Open questions

- Q-027: Must medical content be masked or blocked in chat, and who may read stored transcripts? (Resolver: PTSF privacy officer) — UNANSWERED
- Q-028: What are chat hours per region? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Requesting Travel Assistance 6 — chat with a PTSF assessor
- Source: ptsf-scoping-2026#INT-025
