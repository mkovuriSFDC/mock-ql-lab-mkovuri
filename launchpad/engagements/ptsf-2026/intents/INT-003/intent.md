---
id: INT-003
phase: 1
epic: E07
confidence: Assumed
surface: security
origin: scopezilla
source: ptsf-scoping-2026#INT-003
title: Let patients and practitioners see only their own slice of the data
ratified: 2026-10-19 by madhuri @ ec4093237f07
---

# INT-003 — Let patients and practitioners see only their own slice of the data

## Outcome

Each patient sees only their own profile, applications and medical history; each practitioner sees only the patient contact details and service description for applications they are assigned to, plus those applications' assessments.

## Build target

- Core records in place: patient, practice and practitioner, treatment type, practitioner registration, subsidy application, assessment, medical history, allocation attempt
- Patients reach their own applications and medical history through their patient record
- Practitioners see only patient name, phone, email and the service description on assigned applications
- Practitioners see all assessments on applications they are assigned to
- Assessors and managers see applications within their office and region scope

## Guardrails

- External access settings are never more open than internal ones.
- Patients use the high-volume community license; practitioners use the role-based community license (design decision).
- No practitioner sees a patient's date of birth, address or insurance details.

## Out of scope

- Must not implement time-bound medical history access (handled by INT-001).
- Must not build portal pages (handled by INT-012, INT-018).

## Acceptance

Aiko Tan signs in to the patient site and sees her two applications and nothing belonging to any other patient. Dr. Lena Okafor, assigned to one of them, sees Aiko's name, phone, email and the service description, plus the specialist's assessment on that application, but not Aiko's address or insurance details. Ravi Menon in Singapore sees Singapore-office applications only.

## Success criteria

_none_

## Dependencies

### Internal
_none_

### External
_none_

## Open questions

- Q-004: Can assessors work applications from other offices in their region, or only their own office? (Resolver: PTSF operations lead) — UNANSWERED

## Grounding

- Requirement: Brief: Visibility & Accessibility — practitioner field limits and assessment visibility
- decision: 0001 — Single global org (ptsf-scoping-2026:decisions/0001-single-global-org.md@8eb2432b0381)
- decision: 0002 — Medical history control set (ptsf-scoping-2026:decisions/0002-medical-history-control-set.md@8eb2432b0381)
- Source: ptsf-scoping-2026#INT-003
