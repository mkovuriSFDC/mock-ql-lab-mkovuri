# INT-003 build rulings

**Date:** 2026-10-20 · **Deciders:** agent rulings, pending Trusted Guide review in PR §6 · **Intents:** INT-003

routing: recommended sf-pi, picked claude-code, override, the interactive build session was already open with the design context loaded
brief: ptsf-2026/INT-003 scope=ec4093237f07 proof=ad2a9933fbc2 design=93499bca2e33 decisions=9635a3ac6d6b sources=ptsf-scoping-2026@8eb2432b0381 agent=claude-code recommended=sf-pi

## Rulings

- `Patient__c` on the application and on medical history is optional at the field level, with a validation rule making it mandatory — a universally required field is readable by everyone with object access, which would expose the patient lookup to practitioners — cost if wrong: one validation rule to drop and a field flag to flip.
- Lookups use `Restrict` on delete — deleting a patient, practitioner or treatment type with dependent records should fail rather than silently orphan them — cost if wrong: an admin must delete children first.
- Medical History has search disabled — groundwork for decision 0002 and INT-002; nobody searches it in INT-003 — cost if wrong: one object flag.
- "Grant Access Using Hierarchies" off on Medical History is a runbook Setup step, not metadata — the CustomObject reference documents no field for it — cost if wrong: if a field exists, move it into metadata.
- Page layouts are the platform's auto-generated defaults, retrieved and committed after the first deploy — avoids hand-written layout XML for objects with few fields — cost if wrong: hand-tune the layouts later.
- The patient phone formula reads `Account.Phone` (design Q-design-5) — cost if wrong: one formula.
- Profiles `PTSF Patient` and `PTSF Practitioner` are created as bare custom profiles via metadata; all object access comes from permission sets — cost if wrong: clone them in Setup from the standard licence profiles instead.
- The patient record type is `PersonAccount.Patient`, deployed under `objects/PersonAccount/` — cost if wrong: rename after enabling Person Accounts.
- Case and Opportunity org-wide defaults set to Private (internal and external) — the platform rejects Account = Private while either is more open (dry-run deploy, 2026-10-20); INT-003 uses neither and the org has no data — cost if wrong: a support or sales intent that needs them wider adds sharing rules.
- `PTSF_Patient_Access` grants Read on Contact — the platform requires it for Account Read; a patient's own person contact is the only contact their sharing reaches — cost if wrong: none expected; patients still see no other contacts.
- Schema and Apex deploy together with `NoTestRun`, and the tests run as a separate step — the object's sharing-recalculation entry needs `ApplicationShareRecalc` in the same deploy, so the design's two-deploy split can't hold; with no tests in the deploy, a test failure can't roll back the schema — cost if wrong: none; the split's purpose is preserved.
