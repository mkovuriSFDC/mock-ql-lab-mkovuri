---
intent: INT-003
verified_by: ql-verify-build
verified_at: 2026-10-20
target_org: ql-lab (epic.out.e796bcd0ad5d@orgfarm.salesforce.com)
branch: feature/ptsf-2026/INT-003-patient-practitioner-visibility
commit: 5cdcc02-dirty
type: org-probe
---

# INT-003 — Org-probe verification

**Target org:** ql-lab (epic.out.e796bcd0ad5d@orgfarm.salesforce.com) · **Commit:** 5cdcc02-dirty · **Branch:** feature/ptsf-2026/INT-003-patient-practitioner-visibility

**Summary:** 3 confirmed · 0 refuted · 1 unresolved (of 4 criteria)

## Results

### INT-003-C1 — ✅ pass

| Predicate | Expected | Org actual | Verdict |
|-----------|----------|-----------|---------|
| record-type-exists(Account.Patient) | row | 1 row(s) | ✅ |
| record-type-exists(Account.Practice) | row | 1 row(s) | ✅ |
| object-exists(Treatment_Type__c) | exists | exists | ✅ |
| object-exists(Practitioner_Registration__c) | exists | exists | ✅ |
| object-exists(Subsidy_Application__c) | exists | exists | ✅ |
| object-exists(Assessment__c) | exists | exists | ✅ |
| object-exists(Medical_History__c) | exists | exists | ✅ |
| object-exists(Allocation_Attempt__c) | exists | exists | ✅ |
| field-exists(Practitioner_Registration__c.Practitioner__c) | exists | exists | ✅ |
| field-exists(Practitioner_Registration__c.Treatment_Type__c) | exists | exists | ✅ |
| field-exists(Subsidy_Application__c.Service_Description__c) | exists | exists | ✅ |
| field-exists(Assessment__c.Practitioner__c) | exists | exists | ✅ |
| field-exists(Assessment__c.Status__c) | exists | exists | ✅ |
| field-exists(Allocation_Attempt__c.Practitioner__c) | exists | exists | ✅ |

### INT-003-C7 — ✅ pass

| Predicate | Expected | Org actual | Verdict |
|-----------|----------|-----------|---------|
| field-type(Subsidy_Application__c.Patient_Name__c, Formula) | Formula | Formula (Text) | ✅ |
| field-type(Subsidy_Application__c.Patient_Phone__c, Formula) | Formula | Formula (Text) | ✅ |
| field-type(Subsidy_Application__c.Patient_Email__c, Formula) | Formula | Formula (Text) | ✅ |
| fls(read, Subsidy_Application__c.Patient_Name__c, permset=PTSF_Practitioner_Access) | true | true | ✅ |
| fls(read, Subsidy_Application__c.Patient_Phone__c, permset=PTSF_Practitioner_Access) | true | true | ✅ |
| fls(read, Subsidy_Application__c.Patient_Email__c, permset=PTSF_Practitioner_Access) | true | true | ✅ |
| fls(read, Subsidy_Application__c.Service_Description__c, permset=PTSF_Practitioner_Access) | true | true | ✅ |

### INT-003-C19 — ✅ pass

| Predicate | Expected | Org actual | Verdict |
|-----------|----------|-----------|---------|
| field-type(Assessment__c.Subsidy_Application__c, MasterDetail) | MasterDetail | Master-Detail(Subsidy Application) | ✅ |
| field-type(Medical_History__c.Subsidy_Application__c, Lookup) | Lookup | Lookup(Subsidy Application) | ✅ |
| field-type(Medical_History__c.Patient__c, Lookup) | Lookup | Lookup(Account) | ✅ |
| field-type(Subsidy_Application__c.Patient__c, Lookup) | Lookup | Lookup(Account) | ✅ |
| field-type(Allocation_Attempt__c.Subsidy_Application__c, Lookup) | Lookup | Lookup(Subsidy Application) | ✅ |

### INT-003-C20 — ⚠ unresolved

| Predicate | Expected | Org actual | Verdict |
|-----------|----------|-----------|---------|
| tab-exists(Treatment_Type__c) | row | 1 row(s) | ✅ |
| tab-exists(Practitioner_Registration__c) | row | 1 row(s) | ✅ |
| tab-exists(Subsidy_Application__c) | row | 1 row(s) | ✅ |
| tab-exists(Assessment__c) | row | 1 row(s) | ✅ |
| tab-exists(Allocation_Attempt__c) | row | 1 row(s) | ✅ |
| object-in-app(PTSF_Operations, Subsidy_Application__c) | row | AppTabMember: 0 rows, app not visible to probing user; org metadata read lists the tab in PTSF_Operations | ⚠ |
| object-in-app(PTSF_Operations, Treatment_Type__c) | row | AppTabMember: 0 rows, app not visible to probing user; org metadata read lists the tab in PTSF_Operations | ⚠ |
