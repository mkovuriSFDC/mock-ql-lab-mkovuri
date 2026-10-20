# Build notes — this org's recurring traps

Traps that keep biting builds **in this org**: its quirks, its integrations, the things a new engagement here should know before it builds. Shared by every engagement in the repo. Skim it before building a new automation or lifecycle intent, and append a trap the moment you fight through it twice; per-increment specifics belong in each `delivery/phase-N/README.md` instead.

General Salesforce platform traps live with `/ql-design-intent` (`salesforce-traps.md` beside its skill) and the build toolkits, not here.


- **Apex at API 67.0 runs in user mode by default** (field-level security and object permissions enforced; `without sharing` only drops record sharing). Service code that must act beyond the running user (managed sharing, cross-user recomputes) needs `WITH SYSTEM_MODE` / `insert as system` / `AccessLevel.SYSTEM_MODE` explicitly. Test data inserted under `System.runAs` needs field access too: grant it with a test-only permission set, not a deployed one. Updating a non-reparentable master-detail field (even to the same value) fails in user mode; update only the changed fields. [docs:https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_enforce_usermode.htm] (INT-003)
