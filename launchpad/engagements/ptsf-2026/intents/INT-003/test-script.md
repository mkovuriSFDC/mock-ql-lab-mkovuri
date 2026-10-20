---
intent: INT-003
phase: 1
proof_hash: ad2a9933fbc2
authored: 2026-10-20
---

# INT-003 — Test script

**Intent:** Let patients and practitioners see only their own slice of the data
**Phase:** 1 · **Source intent:** `intents/INT-003/intent.md` · **Design:** `intents/INT-003/design.md`

## Criteria

> `Type`: ✅ automated · 👁 manual · 🔁 awaiting retest · ⚠️ partial · ⛔ blocked · 📋 accepted gap.
> The ID is the join key for the PR §2 matrix, the ledger and any tracker export.

| ID | Criterion (source) | How proven | Type | Sign-off |
|----|--------------------|------------|------|----------|
| INT-003-C1 | Core records exist: patient and practice record types, practitioner contact, treatment type, practitioner registration, subsidy application, assessment, medical history, allocation attempt (build target 1) | org-probe | ✅ | (verify — green, 2026-10-20) |
| INT-003-C2 | A patient reads exactly their own applications, and none belonging to another patient (build target 2; acceptance: Aiko sees her two applications) | `PatientVisibilityTest.patientSeesOnlyOwnApplications` | ✅ | (CI) |
| INT-003-C3 | A patient reads their own medical history through their patient record, and no other patient's (build target 2) | `PatientVisibilityTest.patientSeesOnlyOwnMedicalHistory` | ✅ | (CI) |
| INT-003-C4 | A patient reads their own profile and no other patient's account (outcome) | `PatientVisibilityTest.patientSeesOnlyOwnProfile` | ✅ | (CI) |
| INT-003-C5 | A patient reads no assessments, allocation attempts or practitioner registrations (acceptance: "nothing belonging to any other patient"; design Q-design-2) | `PatientVisibilityTest.patientCannotReadAssessmentsOrAllocations` | ✅ | (CI) |
| INT-003-C6 | An assigned practitioner reads the patient's name, phone and email and the service description on the application (build target 3; acceptance: Dr. Okafor) | `PractitionerVisibilityTest.assignedPractitionerReadsContactDetails` | ✅ | (CI) |
| INT-003-C7 | The practitioner permission set grants field read on the application's four allowed fields only (build target 3) | org-probe | ✅ | (verify — green, 2026-10-20) |
| INT-003-C8 | An assigned practitioner can't read the patient's account, so not their date of birth, address or insurance details, and can't read the application's patient lookup (guardrail 3; acceptance) | `PractitionerVisibilityTest.practitionerCannotReadPatientAccount` | ✅ | (CI) |
| INT-003-C9 | An assigned practitioner reads every assessment on the application, including another practitioner's specialist assessment (build target 4; acceptance) | `PractitionerVisibilityTest.practitionerReadsAllAssessmentsOnAssignedApplication` | ✅ | (CI) |
| INT-003-C10 | A practitioner with no assigned-status assessment on an application reads neither it nor its assessments (build target 3) | `PractitionerVisibilityTest.unassignedPractitionerReadsNothing` | ✅ | (CI) |
| INT-003-C11 | Access follows the assignment: Declined, Timed Out, Closed, a changed practitioner or a deleted assessment removes the share, and a remaining assigned assessment keeps it (build target 3; design Q-design-1) | `ApplicationAccessServiceTest.shareFollowsAssignmentStatus` | ✅ | (CI) |
| INT-003-C12 | Share recompute is bulk-safe for 200 assessments in one transaction (design) | `ApplicationAccessServiceTest.bulkRecomputeTwoHundred` | ✅ | (CI) |
| INT-003-C13 | The recalculation batch restores missing practitioner shares (design) | `ApplicationAccessServiceTest.recalcBatchRestoresShares` | ✅ | (CI) |
| INT-003-C14 | Practitioners have no write access to applications or assessments in this increment (design) | `PractitionerVisibilityTest.practitionerCannotEditApplicationOrAssessment` | ✅ | (CI) |
| INT-003-C15 | External org-wide defaults are never more open than internal ones on every INT-003 object (guardrail 1) | `PtsfSharingModelTest.externalNeverMoreOpenThanInternal` | ✅ | (CI) |
| INT-003-C16 | The patient profile uses the Customer Community licence and the practitioner profile uses Customer Community Plus (guardrail 2) | `PtsfSharingModelTest.profilesUseDecidedLicences` | ✅ | (CI) |
| INT-003-C17 | Role-hierarchy users above the record owner don't gain medical history access (design; decision 0002) | `PtsfSharingModelTest.hierarchyDoesNotGrantMedicalHistory` | ✅ | (CI) |
| INT-003-C18 | No INT-003 permission set grants access to medical history to practitioners or internal staff; time-bound access is left to INT-001 (out of scope 1) | `PtsfSharingModelTest.noInt003PermsetGrantsMedicalHistory` | ✅ | (CI) |
| INT-003-C19 | Relationship shapes: assessment is master-detail to the application; medical history and allocation attempt are lookups (design; decision 2026-10-20-int-003-sharing-model) | org-probe | ✅ | (verify — green, 2026-10-20) |
| INT-003-C20 | Each custom object has a tab and appears in the PTSF Operations app (cascading work) | org-probe | ✅ | ⚠ org not verified |
| INT-003-C21 | Assessors see applications in their office scope only (build target 5; acceptance: Ravi sees Singapore-office applications only) | Blocked on Q-004 | ⛔ | _blocked: Q-004_ |
| INT-003-C22 | Managers see applications in their office and region scope (build target 5) | Blocked on Q-004 | ⛔ | _blocked: Q-004_ |
| INT-003-C23 | Aiko signs in to the patient site and sees her two applications on screen (acceptance, signed-in experience) | Manual scene A, once INT-012 delivers patient pages | ⛔ | _blocked: INT-012_ |
| INT-003-C24 | Dr. Okafor signs in to the practitioner site and sees the allowed details and the assessment, without address or insurance (acceptance, signed-in experience) | Manual scene B, once INT-018 delivers practitioner pages | ⛔ | _blocked: INT-018_ |

## Automated proofs to write

Shared test setup (`PtsfTestData`): an owner user with a role (outside `runAs`, to avoid mixed DML). Two Patient person accounts with Customer Community users on `PTSF Patient` plus `PTSF_Patient_Access`. One Practice account with three practitioner contacts and Customer Community Plus users on `PTSF Practitioner` plus `PTSF_Practitioner_Access`. Patient A has two applications and Patient B has one, each with a medical history record. Record DML runs inside `System.runAs` where record types require it (build trap: API 67.0 record-type enforcement).

- **`PatientVisibilityTest.patientSeesOnlyOwnApplications`**: as Patient A, `SELECT Id FROM Subsidy_Application__c` returns exactly A's two IDs. `UserRecordAccess.HasReadAccess` is false for B's application.
- **`PatientVisibilityTest.patientSeesOnlyOwnMedicalHistory`**: as Patient A, the query returns only A's medical history rows. Read access to B's row is false.
- **`PatientVisibilityTest.patientSeesOnlyOwnProfile`**: as Patient A, `SELECT Id FROM Account` returns only A's account.
- **`PatientVisibilityTest.patientCannotReadAssessmentsOrAllocations`**: as Patient A, with an assessment and an allocation attempt on A's own application, both queries return 0 rows. `isAccessible()` is false on `Assessment__c`, `Allocation_Attempt__c` and `Practitioner_Registration__c`.
- **`PractitionerVisibilityTest.assignedPractitionerReadsContactDetails`**: Practitioner 1 holds an Accepted assessment on A's application. As Practitioner 1, the application query returns `Patient_Name__c`, `Patient_Phone__c`, `Patient_Email__c` and `Service_Description__c` equal to the seeded values. Each field's describe `isAccessible()` is true.
- **`PractitionerVisibilityTest.practitionerCannotReadPatientAccount`**: as Practitioner 1, `UserRecordAccess.HasReadAccess` on A's account is false, and `SELECT … FROM Account WHERE Id = :patientA` returns 0 rows. `Subsidy_Application__c.Patient__c` and `Treatment_Type__c` describe `isAccessible()` are false. `Security.stripInaccessible(READABLE, …)` removes `Patient__c`.
- **`PractitionerVisibilityTest.practitionerReadsAllAssessmentsOnAssignedApplication`**: Practitioner 1 (Accepted) and Practitioner 2 (Allocated, specialist) are on A's application. As Practitioner 1, both assessments are returned.
- **`PractitionerVisibilityTest.unassignedPractitionerReadsNothing`**: as Practitioner 3, who has a Declined assessment on A's application, the application and assessment queries return 0 rows.
- **`PractitionerVisibilityTest.practitionerCannotEditApplicationOrAssessment`**: as Practitioner 1, updating the application and the assessment each throw a `DmlException`. Assert the exception is raised.
- **`ApplicationAccessServiceTest.shareFollowsAssignmentStatus`**: count the `Subsidy_Application__Share` rows with `RowCause = Practitioner_Assignment__c` for the practitioner user after each step:
  - Allocated → 1
  - Accepted → 1
  - Submitted → 1
  - Closed → 0
  - New Allocated → 1, then Declined → 0
  - Timed Out → 0
  - Practitioner changed → old user 0, new user 1
  - Deleted → 0, undeleted → 1
  - With two assigned assessments, ending one leaves 1
- **`ApplicationAccessServiceTest.bulkRecomputeTwoHundred`**: insert 200 assessments across 200 applications in one DML, then flip all to Declined. Share counts are 200 then 0. The test stays within the SOQL and DML limits (`Limits.getQueries()` asserted under a fixed ceiling).
- **`ApplicationAccessServiceTest.recalcBatchRestoresShares`**: delete the shares directly, run `ApplicationShareRecalc` inside `Test.startTest`/`stopTest`, and assert the shares are restored.
- **`PtsfSharingModelTest.externalNeverMoreOpenThanInternal`**: query `EntityDefinition.InternalSharingModel` and `ExternalSharingModel` for Account and each INT-003 custom object. Assert the external access rank is ≤ the internal rank, and both are Private (or ControlledByParent) where the design says so.
- **`PtsfSharingModelTest.profilesUseDecidedLicences`**: `Profile.UserLicense.Name` is `Customer Community` for `PTSF Patient` and `Customer Community Plus` for `PTSF Practitioner`.
- **`PtsfSharingModelTest.hierarchyDoesNotGrantMedicalHistory`**: create a user in a role above the owner's role. That user, holding object Read through a test-only permission set assignment, has no read access to a medical history record the owner holds.
- **`PtsfSharingModelTest.noInt003PermsetGrantsMedicalHistory`**: `ObjectPermissions` on `Medical_History__c` for the `PTSF_Practitioner_Access` and `PTSF_Staff_Core` permission sets returns no rows with `PermissionsRead = true`.

## Org assertions

- **INT-003-C1** (core records exist):
  - `record-type-exists(Account.Patient)`
  - `record-type-exists(Account.Practice)`
  - `object-exists(Treatment_Type__c)`
  - `object-exists(Practitioner_Registration__c)`
  - `object-exists(Subsidy_Application__c)`
  - `object-exists(Assessment__c)`
  - `object-exists(Medical_History__c)`
  - `object-exists(Allocation_Attempt__c)`
  - `field-exists(Practitioner_Registration__c.Practitioner__c)`
  - `field-exists(Practitioner_Registration__c.Treatment_Type__c)`
  - `field-exists(Subsidy_Application__c.Service_Description__c)`
  - `field-exists(Assessment__c.Practitioner__c)`
  - `field-exists(Assessment__c.Status__c)`
  - `field-exists(Allocation_Attempt__c.Practitioner__c)`
- **INT-003-C7** (practitioner field read on the four allowed fields):
  - `field-type(Subsidy_Application__c.Patient_Name__c, Formula)`
  - `field-type(Subsidy_Application__c.Patient_Phone__c, Formula)`
  - `field-type(Subsidy_Application__c.Patient_Email__c, Formula)`
  - `fls(read, Subsidy_Application__c.Patient_Name__c, permset=PTSF_Practitioner_Access)`
  - `fls(read, Subsidy_Application__c.Patient_Phone__c, permset=PTSF_Practitioner_Access)`
  - `fls(read, Subsidy_Application__c.Patient_Email__c, permset=PTSF_Practitioner_Access)`
  - `fls(read, Subsidy_Application__c.Service_Description__c, permset=PTSF_Practitioner_Access)`
  - (Absence of field read on `Patient__c` and `Treatment_Type__c` is proven behaviourally in C8.)
- **INT-003-C19** (relationship shapes; master-detail takes no field-level security, so these are type checks only):
  - `field-type(Assessment__c.Subsidy_Application__c, MasterDetail)`
  - `field-type(Medical_History__c.Subsidy_Application__c, Lookup)`
  - `field-type(Medical_History__c.Patient__c, Lookup)`
  - `field-type(Subsidy_Application__c.Patient__c, Lookup)`
  - `field-type(Allocation_Attempt__c.Subsidy_Application__c, Lookup)`
- **INT-003-C20** (tabs and app):
  - `tab-exists(Treatment_Type__c)`
  - `tab-exists(Practitioner_Registration__c)`
  - `tab-exists(Subsidy_Application__c)`
  - `tab-exists(Assessment__c)`
  - `tab-exists(Allocation_Attempt__c)`
  - `object-in-app(PTSF_Operations, Subsidy_Application__c)`
  - `object-in-app(PTSF_Operations, Treatment_Type__c)`
  - (No `Medical_History__c` tab is exposed to internal users; INT-002 owns that denial.)

## Manual validation scenes

### Scene A — Patient signed-in view (criterion C23; ⛔ until INT-012)
1. As Aiko Tan's synthetic test user, sign in to the patient site.
2. Open the applications list.
3. **Expected:** exactly her two applications. No other patient's application, medical history or any assessment appears.
**Sign-off:** _name / date / pass·fail / report_.

### Scene B — Practitioner signed-in view (criterion C24; ⛔ until INT-018)
1. As Dr. Lena Okafor's synthetic test user, sign in to the practitioner site.
2. Open Aiko's application.
3. **Expected:** name, phone, email and service description are shown, along with the specialist's assessment. No address, date of birth or insurance detail appears anywhere, including the related records and the search results for Aiko's name.
**Sign-off:** _name / date / pass·fail / report_.

## Deliberately not tested (out of scope)

- Time-bound medical history access (INT-001). C18 proves only that INT-003 grants none.
- Portal pages (INT-012, INT-018). C23 and C24 wait on them.
