# Salesforce build traps

Recurring platform traps that bite Salesforce builds in any org: the "expect this again" list. They ship with `/ql-design-intent` until the build toolkits carry them (`decisions/0082`; the ones already filed upstream link their issue). Read the sections a design touches; a trap this org keeps hitting goes in `launchpad/build-notes.md` instead.

## Deploy / metadata

- **Read deploy results from `sf project deploy report`, not the streamed output.** In agent shells a long
  `sf project deploy start`/`validate` can scroll the final status and component errors out of view. Run it with
  `--async`, then `sf project deploy report --job-id <id> --wait <minutes>` (or `--use-most-recent`); add `--json`
  for a compact result.
- **`rollbackOnError` is whole-transaction.** A multi-component deploy that fails on any one
  component rolls back *all* of them — an Apex class can silently un-deploy because a Flow in the
  same request failed. Deploy a fixed component on its own, or re-include everything, and re-verify
  what actually persisted rather than trusting a partial earlier success.
- **Anonymous Apex has a hard source-length limit.** A large seed-data `insert` or backfill script
  passed to `sf apex run` can exceed it and fail to run at all. Load records with `sf data` instead,
  and keep `sf apex run` for short one-off operational steps.
- **`ExternalServiceRegistration` fullNames must be alphanumeric, no underscores.** An ESR named
  with an underscore (e.g. `My_Insurance_Eligibility`) fails deploy with `Enter a name that starts
  with a letter and contains only alphanumeric characters.` The fullName is the file basename, so rename the file
  (`MyInsuranceEligibility`); the `<label>` allows spaces and can stay as it is. sf-skills: https://github.com/forcedotcom/sf-skills/issues/364
- **Page layouts must mark universally required fields `Required`.** In `Layout` metadata, the `<layoutItem>` for the
  standard `Name` field (or any other universally required field, e.g. Opportunity `StageName` and `CloseDate`) must set
  `<behavior>Required</behavior>`. Any other value, including `Edit`, fails deploy with "Field:Name must be Required". sf-skills: https://github.com/forcedotcom/sf-skills/issues/365
- **A new custom object has no nav entry until its tab ships and is visible.** The object deploys clean, but it isn't
  in the App Launcher until a `CustomTab` (`tabs/<Object>.tab-meta.xml`) is in the deploy *and* a permission set (or
  profile) gives that tab a visible `tabSettings` entry: a tab deployed without one is hidden from everyone. To put it
  in an app's navigation bar too, list the tab in the target `CustomApplication`'s `navigationItems`
  ([CustomTab](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_tab.htm)).
  Ship all of it alongside the object and prove it with `tab-exists(Obj)` + `object-in-app(App, Obj)` org-probe criteria. sf-skills: https://github.com/forcedotcom/sf-skills/issues/369

## Roles / RecordTypes (UserRole and RecordType metadata)

- **Role access levels use `Edit`, not `ReadWrite`.** The valid enum values for `caseAccessLevel`, `contactAccessLevel`, and `opportunityAccessLevel` on UserRole are `None`, `Read`, `Edit` — not `ReadWrite`. Using `ReadWrite` produces an "unexpected error" (no schema error message) that looks like a transient server issue but is consistent. The retrieved org XML uses `Edit`; that's the canonical form. Access levels must also be >= the org OWD for that object, which varies by org (with Opportunity OWD at Public Read Only, `None` fails with `field integrity exception: unknown (Opportunity access level below organization default)`). Omit an access-level element when you aren't restricting: an absent element inherits the OWD, while a present `None` overrides it and fails whenever the OWD is above None. sf-skills: https://github.com/forcedotcom/sf-skills/issues/366
- **Role XML requires `<name>` (display label), not `<label>`.** The `<label>` element is not valid in the Role metadata type; the display name goes in `<name>`. The DeveloperName (API name) is inferred from the filename.
- **Deploying one record type by name may need an explicit `<fullName>`.** Source-format RecordType files usually omit it and the CLI infers it from the file path, but a deploy can fail with "element fullName missing for a child of type RecordType" — observed when selecting the record type with `--metadata RecordType:Object.RTName` rather than `--source-dir`. Fix: add `<fullName>RTName</fullName>` to the XML body (just the RT name, not the object-qualified form).
- **A metadata-only deploy blocked on Apex coverage means Apex is in the payload.** A deploy with no Apex (roles, profiles, record types, layouts) runs no tests and needs no test level. If a production-style org (not a sandbox) rejects the deploy on the 75% coverage gate, Apex slipped into the payload; narrow the deploy to the metadata you intend. `--test-level NoTestRun` won't save a production deploy that *does* contain Apex — production runs tests whenever Apex is present.

## Experience Cloud (self-registration)

- **Configurable Self-Registration is not zero-Apex.** Experience Cloud's *Configurable Self-Registration* presents as declarative in the Login & Registration setup UI, but it's Apex-backed: selecting it makes Salesforce auto-generate a handler class (name begins `AutocreatedConfigSelfReg…`, implementing `Auth.ConfigurableSelfRegHandler`) that runs the `createUser` logic — the "configurable" refers to the form/fields, not the absence of code. You don't write the class from scratch, but you own it: customize it for the real registration logic and, because it's Apex in the org, cover it against the 75% gate before a production deploy. Don't scope customer or partner self-registration as "standard-first, no Apex" — budget the handler and its coverage.
- **The legacy `CommunitiesSelfRegController` scaffold ships with a registration-blocking bug.** The old `CommunitiesSelfRegController` self-registration scaffold assigns a `null` `ProfileId` directly to the `User` sObject, which can fail the user insert (seen as `Field is not writeable: User.ProfileId`; reproduce it in your org before relying on the exact error). The page may surface nothing, so it looks like the form is broken rather than a code fault. Fixes: prefer Configurable Self-Registration (whose auto-generated handler takes the profile through `createUser`), or patch the legacy handler to set a valid `ProfileId` before the insert. Catch it early — a self-reg flow that "does nothing" on submit is this bug until proven otherwise.
- **Creating portal users is a self-registration design choice, not a mid-build toggle.** Whether the build uses standard or cloned external profiles decides which org settings it needs, so stop and ask before any probe or test creates portal users.

## Flow XML (Metadata API)

- **Same-type elements must be grouped contiguously.** All `<recordLookups>` together, all
  `<assignments>` together, etc. Interleaving by execution order errors "Element ... is duplicated
  at this location in type Flow."
- **Picklist values in formulas need `TEXT()`.** Concatenating a picklist field directly errors
  "Picklist fields are only supported in certain functions"; wrap it: `TEXT({!picklist})`.

## Apex / tests

- **Seed geolocation test coords clearly non-zero.** `0` is a valid latitude and longitude, but code
  that treats a zero coordinate as "no location" (a common shortcut in distance helpers) skips the
  record, and the test passes or fails for the wrong reason. Non-zero coords keep it honest.
- **Type coordinate-taking helper params as `Decimal`.** It takes integer and decimal literals alike,
  so a call like `near(0, 0.1)` compiles however the caller writes the numbers.
- **Record-triggered Flows can form a live chain in tests.** If status transitions cascade (Flow A's
  write meets Flow B's entry criteria), inserting a record mid-lifecycle auto-runs downstream
  automation and pollutes state for a test meant to exercise one piece. Seed at an inert status
  (e.g. `Draft`) that triggers nothing when you need isolation.
- **From API 67.0, Apex DML enforces record-type availability for the running user, in tests too.** Inserting a record with a record type the running user's profile and permission sets don't grant fails with `INVALID_CROSS_REFERENCE_KEY … Record Type ID: this ID value isn't valid for the user`. At 66.0 and earlier the same insert succeeds, so bumping a class's API version can break it. A newly deployed record type isn't visible to the deploying admin either, so a test that inserts with it fails on its first deploy. Create a test user, assign the permission set that grants the record type (both outside the `runAs` block, to avoid mixed DML), and do the record DML inside `System.runAs`. sf-skills: https://github.com/forcedotcom/sf-skills/issues/367
- **`FOR UPDATE` cannot be combined with `ORDER BY` in SOQL.** Apex won't compile it (`Explicit ORDER BY not allowed when locking rows (Id order is implied)`). Lock the rows, then sort them in Apex (a `Comparable` wrapper). sf-skills: https://github.com/forcedotcom/sf-skills/issues/368
