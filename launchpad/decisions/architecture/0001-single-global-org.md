# 0001 — PTSF runs on one global Salesforce production org

**Adopted-from:** ptsf-scoping-2026@8eb2432b0381:decisions/0001-single-global-org.md

**Date:** 2026-10-19 · **Status:** accepted · **Source:** scopezilla-inherited

## Context

PTSF operates 30 satellite offices across APAC, EMEA and AMER on separately customized local systems that "will not scale any further". The brief asks to move "appropriate data and processes to the Salesforce platform" with one set of business rules (allocation, escalation, approval), one global Health Insurance Checker, and practitioners who may be allocated by distance regardless of office. No data-residency or regulatory-isolation requirement is stated.

## Decision

Build one global production org serving all three regions, with region and office modeled as data (owner pools, queues, business hours, approval routing) rather than as separate orgs.

## Consequences

- One data model, one sharing model and one release pipeline for all offices; process standardization across offices becomes a design input, not an org boundary.
- Region-specific behavior (business calendars, approval thresholds, languages, currency) is configuration and must be governed centrally.
- Large-data-volume design (ownership distribution, skew, archiving) carries the full ~38M-patient projection in one org.
- **Reopen trigger:** if PTSF confirms that patient or medical data must stay in-region (gap G0004), this decision is superseded and the architecture moves to regional hosting or multi-org.

## Grounds

- `discovery-notes/ptsf-brief.md` — Project Overview (HQ Singapore, three regions, 10 offices each; "move appropriate data and processes to the Salesforce platform"); Current Systems (one global Health Insurance Checker); Business Process Requirements (single allocation, escalation and approval rules).
- Residency is unstated in the brief; carried as gap G0004 with this ADR's reopen trigger.
