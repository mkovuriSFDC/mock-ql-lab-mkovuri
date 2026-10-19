# Core sharing model: Private everywhere, sharing set for patients, Apex shares and formula fields for practitioners

**Date:** 2026-10-20 · **Deciders:** madhuri (Trusted Guide) · **Intents:** INT-003, INT-001, INT-019, INT-022

## Context

INT-003 creates the core objects and decides how patients and practitioners reach them (`intents/INT-003/design.md`). Practitioners may see a patient's name, phone and email on assigned applications, but never date of birth, address or insurance. Several practitioners can hold assessments on one application (INT-020), and INT-004 rotates record owners.

## Options

- **Practitioner access to patient details:** share the patient Account and restrict fields with field-level security; copy the values onto the application with a Flow; or use cross-object formula fields on the application.
- **Practitioner access to the application:** a sharing set, sharing rules, manual shares, or Apex managed shares.
- **Assessment relationship:** master-detail to the application, or a lookup with its own Apex shares.

## Choice

- All core objects are Private internally and externally (Assessment is controlled by its parent). Hierarchy access is off on `Medical_History__c`.
- Patients (high-volume licence) reach their applications and medical history through one sharing set keyed on `Patient__c`.
- Practitioners (Customer Community Plus) get Read on `Subsidy_Application__c` through an Apex managed share (`Practitioner_Assignment__c`). It's recomputed from their assessments in a trigger, which INT-001 shares.
- Practitioners see patient name, phone and email only through formula fields on the application. They never hold access to the patient Account. Formulas show values without parent access, and custom lookups give no implicit parent access.
- `Assessment__c` is master-detail to the application, with `writeRequiresMasterRead` false. `Medical_History__c` and `Allocation_Attempt__c` are lookups.
- "Assigned" means the practitioner holds an assessment in Allocated, Accepted or Submitted (Q-design-1, ratified as proposed).

## Consequences

- No Account field-level security is needed to enforce the patient-field limit. It holds wherever insurance fields are later stored.
- Manual shares and sharing rules are rejected: manual shares drop when INT-004 rotates owners, and neither can target the practitioner on a child record.
- INT-019 must add a validation rule (and flip `writeRequiresMasterRead`) so a practitioner edits only their own assessment.
- INT-022 can use a roll-up summary over assessments.
- Patient-created records (INT-014) are owned by a high-volume user, so they must be reassigned to the owner pool before they can be shared.
- Changing which statuses count as "assigned" is a one-constant change plus a sharing recalculation.
