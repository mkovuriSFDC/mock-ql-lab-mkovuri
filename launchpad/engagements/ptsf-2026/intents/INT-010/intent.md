---
id: INT-010
phase: 2
epic: E10
confidence: Unknown
surface: integration
origin: scopezilla
source: ptsf-scoping-2026#INT-010
title: Look up a patient's insurance entitlements from the Health Insurance Checker
---

# INT-010 — Look up a patient's insurance entitlements from the Health Insurance Checker

## Outcome

Salesforce can ask the Health Insurance Checker about a patient's entitlements, both interactively during onboarding and in the background at submission, and handles its up-to-15-second peak latency and failures without losing work.

## Build target

- A reusable entitlement lookup against the Health Insurance Checker with stored credentials
- An interactive mode that never blocks the patient's screen while waiting
- A background mode with retry and backoff for submission checks
- An exception queue for lookups that fail after retries
- Logging of every request outcome for monitoring

## Guardrails

- Retries must not create duplicate coverage results for the same application.
- Patient data sent is the minimum the API needs.

## Out of scope

- Must not decide auto-rejection logic (handled by INT-015).
- Must not build the onboarding screens (handled by INT-012).

## Acceptance

Using the Health Insurance Checker test endpoint, the integration lead triggers a lookup for a test patient: the response returns in the log. With the endpoint forced to time out, three retries are logged and the request lands in the exception queue for an assessor to pick up.

## Success criteria

_none_

## Dependencies

### Internal
- INT-003

### External
- Health Insurance Checker | API specification, credentials, rate limits and a test endpoint | owner: Health Insurance Checker provider / PTSF IT

## Open questions

- Q-011: Does the API return a travel-coverage indicator, and what identifier does a lookup need? (Resolver: Health Insurance Checker provider) — UNANSWERED

## Grounding

- Requirement: Brief: Current Systems 4 — Health Insurance Checker, up to 15 seconds at peak
- Source: ptsf-scoping-2026#INT-010
