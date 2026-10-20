---
intent: INT-003
scope_hash: ec4093237f07
authored: 2026-10-19
ratified: 2026-10-19 by madhuri @ 93499bca2e33
---

# INT-003 — Design

**Intent:** Let patients and practitioners see only their own slice of the data
**Source intent:** `intents/INT-003/intent.md`
**Status:** proposed, awaiting Trusted Guide ratification. The assessor/manager scope is ⛔ blocked on Q-004 (`decisions/2026-10-19-int-003-narrow-q-004-gate.md`).

## Approach in one line

Everything internal and external is Private. Patients reach their own records through a sharing set. Practitioners get Read on an application through an Apex managed share driven by their assessment. They see the patient's name, phone and email only through formula fields on the application, so they never hold access to the patient's account.

## Data model

All objects are new except Account and Contact. Names below are final; INT-001's design defers to them.

| Object | Kind | Key fields and relationships |
|---|---|---|
| **Account, record type `Patient`** | Person Account (standard) | Standard person fields (name, `PersonEmail`, `Phone`, `PersonBirthdate`, `PersonMailingAddress`). Insurance fields come with INT-012; INT-003 adds none. |
| **Account, record type `Practice`** | Business account (standard) | Parent of practitioner contacts. |
| **Contact (practitioner)** | Standard | Under a Practice account; enabled as a Customer Community Plus user. |
| **`Treatment_Type__c`** | Custom, reference data | Name only. INT-014 adds its search and translated labels. |
| **`Practitioner_Registration__c`** | Custom | Lookup `Practitioner__c` (Contact), lookup `Treatment_Type__c`. Availability and caseload fields come with INT-016. |
| **`Subsidy_Application__c`** | Custom | Lookup `Patient__c` (Account, required), lookup `Treatment_Type__c`, `Service_Description__c` (long text). Text formulas: `Patient_Name__c` = `Patient__r.FirstName & " " & Patient__r.LastName`, `Patient_Phone__c` = `Patient__r.Phone`, `Patient_Email__c` = `Patient__r.PersonEmail`. Status values come with INT-014 and INT-015. |
| **`Assessment__c`** | Custom | **Master-detail** to `Subsidy_Application__c` (`writeRequiresMasterRead` = false). Lookup `Practitioner__c` (Contact). `Status__c` picklist: Allocated, Accepted, Submitted, Declined, Timed Out, Closed. |
| **`Medical_History__c`** | Custom | **Lookup** `Subsidy_Application__c` (not master-detail; INT-001's Q-design-1, confirmed here). Lookup `Patient__c` (Account, required), which the patient sharing set needs. Clinical fields come with INT-014 and INT-019. |
| **`Allocation_Attempt__c`** | Custom | Lookup `Subsidy_Application__c`, lookup `Practitioner__c` (Contact). Fields for distance, outcome and due date come with INT-016 and INT-017. |

**Why Assessment is master-detail.** The build target says practitioners see all assessments on applications they're assigned to. With master-detail, the assessment inherits access from the application, so no sharing code is needed. It also gives INT-022 a roll-up summary ("all assessments submitted") for free. `writeRequiresMasterRead = false` means a user needs Read/Write on the application to create, edit or delete assessments [docs:https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm]. Practitioners hold Read only, so INT-003 gives them no write path. INT-019 owns how a practitioner edits their own assessment (see Neighboring scope).

**Why Medical History and Allocation Attempt are lookups.** A master-detail child of the application would inherit practitioner access to the application. That would break INT-001's time-bound grant and show each candidate practitioner every other candidate's allocation attempt.

## Sharing & security

**Org-wide defaults (internal / external).** External is never more open than internal (guardrail).

| Object | Internal | External | Notes |
|---|---|---|---|
| Account | Private | Private | |
| Contact | Controlled by parent | Controlled by parent | |
| `Subsidy_Application__c` | Private | Private | |
| `Assessment__c` | Controlled by parent | Controlled by parent | Master-detail |
| `Medical_History__c` | Private | Private | Grant Access Using Hierarchies **off** (decision 0002; also serves INT-001 and INT-002) |
| `Allocation_Attempt__c` | Private | Private | |
| `Practitioner_Registration__c` | Public Read Only | Private | |
| `Treatment_Type__c` | Public Read Only | Public Read Only | |

**Patients: Customer Community licence (high-volume).**
- Profile `PTSF Patient`, cloned from Customer Community User. The platform blocks standard profiles for site users [docs:https://help.salesforce.com/s/articleView?id=platform.networks_create_ext_users_considerations.htm&release=264.0.0&type=5].
- **Sharing set `PTSF_Patient_Records`** on that profile, Read Only. It maps `Subsidy_Application__c.Patient__c` → user's Account and `Medical_History__c.Patient__c` → user's Account. Sharing sets support custom objects that have an Account or Contact lookup, and they allow one sharing set per profile [docs:https://help.salesforce.com/s/articleView?id=platform.networks_setting_light_users.htm&release=264.0.0&type=5]. They deploy as `SharingSet` metadata [docs:https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_sharingset.htm]. The patient sees their own profile through the standard site-user access to their own account.
- Permission set `PTSF_Patient_Access`: Read on `Subsidy_Application__c`, `Medical_History__c` and `Treatment_Type__c`. **No** access to `Assessment__c`, `Allocation_Attempt__c` or `Practitioner_Registration__c` (see Q-design-2).

**Practitioners: Customer Community Plus licence.**
- Profile `PTSF Practitioner`, cloned from Customer Community Plus User.
- **Apex managed share** `Subsidy_Application__Share`, `AccessLevel = Read`, row cause `Practitioner_Assignment__c`. Granted while the practitioner holds an assessment on the application in an *assigned* status (Q-design-1), and revoked otherwise.
- Permission set `PTSF_Practitioner_Access`:
  - Read on `Subsidy_Application__c`, with field-level Read **only** on `Patient_Name__c`, `Patient_Phone__c`, `Patient_Email__c` and `Service_Description__c`. No field-level access to `Patient__c` or `Treatment_Type__c` (Q-design-3).
  - Read on `Assessment__c`, all fields.
  - No access to `Medical_History__c`; INT-001 adds that in its own permission set.
- **How the patient-field limit is enforced.** Practitioners never hold access to a patient's Account. It's Private and owned by an internal user, and custom lookups give no implicit parent access, because implicit sharing applies only to standard relationships [docs:https://help.salesforce.com/s/articleView?id=platform.sharing_across_objects.htm&release=264.0.0&type=5]. The three formula fields show values even without access to the referenced record [docs:https://help.salesforce.com/s/articleView?id=platform.customize_cross_object.htm&release=264.0.0&type=5]. So date of birth, address and insurance are unreachable however they're stored. Address-level field-level security on Account isn't needed, which also keeps the practice's own address visible to practitioners.

**Internal staff: ⛔ blocked on Q-004.** The office/region model is added once Q-004 is answered: `Office__c` and `Region__c` on the application, public groups per office and per region, and criteria-based sharing rules to those groups. Both answers fit the same shape (an office group vs. a region group as the rule target), so nothing built now locks one in. The office and region value lists are also unknown (Q-design-4). The internal permission set `PTSF_Staff_Core` grants object access to the core objects except `Medical_History__c` (INT-002).

**Cascading work in scope.** Tabs for each custom object, plus a `PTSF Operations` Lightning app listing them. Page layouts and an "All" list view per object for internal admins. Tab visibility in `PTSF_Staff_Core`. No portal pages (out of scope; INT-012, INT-018).

## Automation approach

**Apex trigger `AssessmentTrigger`** on `Assessment__c` (after insert, update, delete, undelete). It runs through `AssessmentTriggerHandler`, which calls **`ApplicationAccessService`** (`without sharing`, system mode):

1. Collect the applications whose assessments changed practitioner, status or application.
2. **Desired state:** for each application, the set of portal users (`User.ContactId` = `Assessment__c.Practitioner__c`) holding at least one assessment in an assigned status.
3. **Current state:** the existing `Practitioner_Assignment__c` share rows on those applications.
4. Insert the missing rows and delete the extra ones. That's one query each and one DML each, so it's bulk-safe.

**`ApplicationShareRecalc`** (`Database.Batchable`) is registered as the object's Apex sharing recalculation class. It's the safety net after data loads, and it covers a practitioner user who's created after their assessment.

One trigger per object: INT-001 adds `MedicalHistoryAccessService` to the same handler rather than a second trigger.

**Why not something simpler:**
- *Sharing set for practitioners.* It needs a lookup on the application itself, which allows only one practitioner. Specialists (INT-020) put several on one application, and revoking access means clearing a field.
- *Criteria-based or owner-based sharing rules.* They can't target "the practitioner named on a child record".
- *Manual shares from a Flow.* They're dropped when the owner changes, and INT-004 rotates owners. Apex managed shares survive owner changes.
- *A Flow instead of the trigger.* The recompute needs set logic across sibling assessments, so it would be brittle in Flow. Decision 0002 already places access grants in Apex managed sharing.

## Integration

None.

## Alternatives considered

- **Share the patient Account with practitioners and hide fields with field-level security.** Rejected. Shares on Account can only be manual, and manual shares drop on owner change. Account field-level security would also hide the practice's own address.
- **Copy name, phone and email onto the application with a Flow.** Rejected: the copy goes stale when the patient updates their profile. Formulas read the live values.
- **Assessment as a lookup with its own Apex shares.** Rejected for now. It adds a second sharing service only to give each practitioner Edit on their own assessment, which is INT-019's need. INT-019 can add a validation rule instead (see Neighboring scope).

## Architecture conformance

- **ADR 0001 (single global org):** conforms. One sharing model for every office. The office/region split is data, not separate orgs.
- **Source decision 0002 (medical history control set):** conforms to points 1, 2 and 4. Medical History has its own object, Private/Private with hierarchy access off, and the patient sharing set. Point 3 holds because no internal permission set includes it. Points 4 (practitioner) and 5 belong to INT-001 and INT-002.
- **Kickoff commitments:** patients are Person Accounts on the high-volume licence and practitioners are contacts on Customer Community Plus (also the intent's guardrail). The application is a custom object, not a Case.
- **Grounding:** Brief, Visibility & Accessibility. The practitioner field limits and assessment visibility are met by the formula fields and the master-detail assessment.

No deviation, so no `BLD-` ADR.

## Neighboring & future scope

- **INT-001:** gets the lookup it needs. Medical History has `Patient__c`, `Subsidy_Application__c`, Private/Private and hierarchy off. Assessment has `Practitioner__c` and the status values its design uses. It shares `AssessmentTriggerHandler`.
- **INT-002:** `PTSF_Staff_Core` excludes Medical History; INT-002 proves it.
- **INT-004 (owner pools):** owner-pool users own patient Accounts, applications and Medical History. The Apex shares survive its rotation. Until INT-004 lands, one interim owner user stands in (runbook).
- **INT-014 / INT-015:** add the application status, clinical fields and patient creation. Patient-created records are owned by a high-volume user, whose records can't be shared, so INT-014 must reassign them to the owner pool.
- **INT-016 / INT-017:** extend `Allocation_Attempt__c` and `Practitioner_Registration__c`. If an allocated practitioner should see the application before accepting, INT-016 creates the assessment at allocation (Q-design-1).
- **INT-018:** its "allocated, accepted, completed" home relies on the assigned-status set in Q-design-1.
- **INT-019:** practitioners need Edit on their own assessment. Recommended: grant Edit on `Assessment__c`, flip `writeRequiresMasterRead` to true, and add a validation rule so only the assigned practitioner can edit. Without the rule, a practitioner could edit a co-assigned specialist's assessment. Flagged; not built here.
- **INT-020:** extra assessments for specialists are handled by the recompute.
- **INT-022:** can use a roll-up count of submitted assessments, which master-detail allows.
- **INT-025 / INT-026:** chat and AI answers must respect the same sharing. Nothing here blocks them.

**Existing org:** consulted on 2026-10-19, against the repo and the `ql-lab` org.
- Repo: `force-app/` is empty.
- Org: the only custom object is Knowledge. No roles. Person Accounts not enabled. No Experience sites.
- Licences: Customer Community 20, Customer Community Plus 20, plus Login variants (210 each).
- Greenfield. No collisions and nothing untracked.

**Org preconditions** (to add to `launchpad/deploy-runbook.md`, in order):
1. Create the Account `Practice` business record type, then **enable Person Accounts**. This is permanent and can't be disabled [docs:https://help.salesforce.com/s/articleView?id=commerce.commerce_enable_person_accounts.htm&release=264.0.0&type=5]. The kickoff record already locks the decision; the Trusted Guide performs the step.
2. Enable Digital Experiences. Sharing sets are configured under its settings.
3. Create the interim record-owner user with a role. Any account with external users needs an owner who has a role [docs:https://help.salesforce.com/s/articleView?id=platform.networks_create_ext_users_considerations.htm&release=264.0.0&type=5].
4. Deploy the metadata (below).

## Build sequence

1. The runbook steps 1–3 above are manual and come before any deploy.
2. Deploy 1: objects, fields, record types, OWDs, the sharing reason, profiles, permission sets, the sharing set, tabs, the app and layouts.
3. Deploy 2: the trigger, service, recalculation batch and tests. These are separate so a test failure can't roll back the schema.

## Proof approach (input to `/ql-test-script`)

Apex tests create a portal account owner with a role, then high-volume patient users and Customer Community Plus practitioner users, and run as them with `System.runAs`:
- **Patient A** sees exactly their two applications and their own medical history. Checked with SOQL row counts and `UserRecordAccess`, against a second patient's records.
- **The assigned practitioner** reads the application, sees the three formula fields and the service description, and reads every assessment on it. They can't read `Patient__c` or the patient Account. Checked with `UserRecordAccess`, and field access via `Schema` describe in `runAs`.
- **An unassigned practitioner** reads nothing.
- **Revocation:** reassigning or declining removes the share.
- **Bulk:** 200 assessments.
- **Org-probe:** the OWDs (including external ≤ internal), hierarchy off on Medical History, and the sharing set's mappings.
- **Signing in to the sites** (acceptance wording) needs portal pages from INT-012 and INT-018. It stays 👁 or ⛔ until then; the access is proven ✅ by the tests.
- **The assessor sentence:** ⛔ blocked on Q-004.

## Open design questions

- **Q-design-1 (Trusted Guide; needs customer input before INT-016):** which assessment statuses count as "assigned"? Proposed: Allocated, Accepted and Submitted grant access; Declined, Timed Out and Closed don't. That means an allocated practitioner sees patient contact details before accepting, and a practitioner keeps access to completed work (INT-018 shows "completed"). This choice is about what a practitioner can see, so it's yours, not mine. Building can start with the proposed set; it lives in one constant.
- **Q-design-2:** should patients see assessments, for example the outcome? The intent doesn't say. The design grants nothing; adding access later is only a permission-set change.
- **Q-design-3:** may practitioners see the treatment type? The build target lists only name, phone, email and service description. The design follows it strictly.
- **Q-design-4:** what are the office and region lists? Needed with Q-004, not now.
- **Q-design-5 (non-blocking):** which patient phone field is the contact number? The design uses `Phone`; INT-008/012 may decide differently. Changing it is a one-formula change.
- **Q-design-6:** is creating the interim owner user and its top-level role acceptable until INT-004 defines the owner pools and INT-006 the staff roles? The role gets re-parented later.
