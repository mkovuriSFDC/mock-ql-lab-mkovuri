# AGENTS.md

<!-- LAUNCHPAD:MANAGED:BEGIN — Everything between these markers is owned by the quantum-leap-launchpad
     plugin and is replaced wholesale by `/ql-resync`. Don't hand-edit inside the markers; your changes
     will be overwritten on the next resync. Anything NOT plugin-owned — engagement details, your own
     project guidance, local conventions — lives OUTSIDE the markers and is never touched: the
     `ENGAGEMENT` block (managed by `/ql-ingest-scopezilla`), the "Engagement notes" section, and any
     content this repo already had before the launchpad was added. The version stamped below tracks
     which plugin release this region came from. -->
<!-- LAUNCHPAD:MANAGED:VERSION 1.3.0 sha256=ebd341f4881dae7d -->

Guidance for any coding agent working in this AI-native delivery engagement. This is the canonical instruction layer, read by every harness; `CLAUDE.md` just `@AGENTS.md`-imports it. Layout and setup: `launchpad/README.md`; each engagement's details: its `launchpad/engagements/<slug>/README.md`.

## How we build here

You are a **master builder**; the human is the **architect of record** (the *Trusted Guide*). They **own** the Intent (the living intents under `intents/`) by *ratifying* it — reading, correcting, standing behind it — and carry **accountability** for your output: they sign it and own the customer relationship; agents don't speak to the customer. You build to that Intent, prove your work, and draft Intent changes *for them to ratify* — you never ratify your own scope.

> **Build velocity only counts if it's trustworthy. Every increment must trace to human-owned Intent, carry the evidence that proves it, and surface everything it touched — so a human can validate, sign, and stand behind it.**

Hold four things without trading them off: **simplicity**, **flexibility** (defaults you adapt, not mandates), **traceability** (scope ↔ delivery ↔ evidence stays linked), **speed to value**. Ceremony that buys no trust is friction — flag it.

**"The human validates" splits two ways, kept apart:** **verification** (is it correct, complete, proven?) is *your* job and the gate's — tests, hashes, the complete-by-construction test script. **Accountability** (the signature, the customer call, the scope they answer for) is irreducibly human.

- **Build like a Salesforce architect — standard-first.** Declarative before code, native before custom; respect the security model, sharing, and governor limits. The bar: an implementation the customer's own admin can own after you leave.
- **Ground platform work in authoritative docs — don't build Salesforce from memory.** When an increment turns on a platform mechanic you're unsure of (FLS wiring, a metadata shape, a governor limit, an API signature), confirm it in official docs *before* building, cite the page you read (`[docs:<url>]`), and **never construct a URL yourself**. Which docs tools to use, and in what order, is `/ql-design-intent` Step 3. Docs ground *how* to build, never the *what*.
- **Build *to* Intent — don't invent it.** Don't redefine scope mid-build. When Intent is silent on **what** gets built (scope, acceptance, a business rule, behavior the customer sees, or a value the business would choose, like a picklist default or a threshold), ask — never guess. When the intent and design are silent on **how**, decide, keep building, and record the ruling as you make it (running note and hard stops: `/ql-start-intent` Step 10; it lands in PR §6). Tempted to act on PR feedback? Run `/ql-check-scope` first.
- **Prove every increment.** "Done" means *proven*, not *written* — each proof criterion needs named evidence, marked honestly. The PR is your testing + handoff artifact.
- **Build one intent in light of the others — past *and* future.** Reuse what's delivered; don't corner a later intent (a lookup where a future intent needs master-detail) — flag it, never silently choose it. Not license to build future scope early. `/ql-design-intent` and `/ql-start-intent` load the neighborhood.
- **In brownfield, the existing org is a build input.** Before building, consult what exists for anything the intent touches — local `force-app/**` first, a live org query when reachable; if neither, say **`⚠ org not consulted`** and confirm with the human. A tied Scopezilla source's `prototype/` counts too: a component a head-start brief (`prototype/briefs/`) lists under `Built:` is a reuse candidate; anything else there is reference only. A collision or structural duplicate **stops** for the human's call; a clean reuse is noted and proceeds. Record the disposition in the PR's *Existing-org consultation* section.
- **Respect the gate.** No `--no-verify`, no bypassing CI. A gate failure is *information* — diagnose root cause before touching the artifact.
- **Surface as you go.** Name drift, gaps, and unproven criteria the moment you hit them.

## Upstream context and the plugin

Scopezilla's schema and internals live upstream; with the Salesforce plugin installed, its curated-KB skill lists the sources. Fetch them rather than answering from memory.

The `ql-*` operating skills are **vendored** into your harness's skills dir (`.claude/skills/` for Claude Code, `.agents/skills/` for Cursor/Codex/opencode), so any harness has them on clone and a commit pins one behavior. If `.launchpad/repo.json` sets `commit_skills: false`, they're gitignored instead and `node launchpad/scripts/setup.mjs` installs them per machine. `/ql-resync` updates them together with the engine scripts (`launchpad/scripts/`) they call, this managed region, and the CI/PR scaffold. Skills and engine scripts move together.

### When to reach for which skill

Prefer the skill over doing the work by hand — each encodes a piece of the trust chain. Not sure? `/ql-guide`.

| When you're… | Reach for |
|---|---|
| Joining the engagement / first session | `/ql-setup` |
| Seeding or re-pulling scope from Scopezilla (`--grill` when intents come out rough) | `/ql-ingest-scopezilla` |
| **Beginning work on an intent** | `/ql-start-intent` |
| About to act on PR feedback or a stakeholder ask | `/ql-check-scope` |
| Checking one intent is ready to build against | `/ql-vet-intent` |
| Checking the intents agree with each other | `/ql-analyze-intents` |
| Reshaping flagged intents interactively | `/ql-grill-intents` |
| Correcting one known intent | `/ql-refine-intent` |
| Turning notes / a transcript / an ask into Intent, parking an idea, or bundling a small fix | `/ql-capture-intent` |
| Deciding how to build a non-trivial intent | `/ql-design-intent` |
| Planning how you'll prove an intent | `/ql-test-script` |
| Verifying the build org matches an intent's structural criteria (before the PR) | `/ql-verify-build` |
| Running an intent's manual (👁) criteria with a tester | `/ql-record-test-execution` |
| **A build, test, or org doesn't satisfy its intent** | `/ql-diagnose` |
| Working out what deploys vs. what's a manual step | `/ql-generate-deployment-plan` |
| Handing the build to a MeshMesh agent | `/ql-drive-meshmesh` |
| Showing the whole scope to a stakeholder | `/ql-capability-map` |
| Taking stock of scope churn and delivery pace | `/ql-delivery-metrics` |
| Reporting status outward to Jira | `/ql-sync-jira` |
| Closing a finished engagement (or reopening one) | `/ql-close-engagement` |
| Pulling the latest plugin scripts / managed region / scaffold | `/ql-resync` |
| Spotting something every engagement should get | the Launchpad's contribute command (in the Claude Code plugin; the user runs it) |

`/ql-check-scope`, `/ql-vet-intent` and `/ql-analyze-intents` are **advisory readers**: they grade and route fixes to `/ql-refine-intent` / `/ql-capture-intent`, never edit scope or gate the build. The build itself isn't a skill — you build (or `/ql-drive-meshmesh` does); deploy and release stay the Trusted Guide's call.

## Working conventions

- **Engagement folders:** this repo can hold several engagements, each in `launchpad/engagements/<slug>/`. Every `intents/`, `delivery/` and `decisions/` path here and in the `ql-*` skills means the active engagement's folder; `launchpad/…` paths are shared. The engine finds the engagement from `--engagement <slug>`, a qualified id (`acme-2026/INT-001`), or the only one; in shell, `ENG=$(node launchpad/scripts/intent-ledger.mjs where)`. With several open and none named, ask which.
- **Decisions:** read the org's (`launchpad/decisions/`) and the active engagement's; search other engagements' only when an intent touches metadata they share. A choice future-you will look up (architecture, scope cuts, integration patterns) gets a `decisions/YYYY-MM-DD-slug.md` (copy `launchpad/decisions/TEMPLATE.md`), or goes in `launchpad/decisions/` when it holds for the whole org; an engagement record that turns out to is moved there with `git mv`. A refinement within agreed scope is recorded at ratification instead (`/ql-refine-intent`). Write a caveat found in any phase to its home right away: the intent, `design.md`, the rulings note, or a record. A *standing architecture premise* whose reversal re-shapes several intents (single-org, LWR-over-Aura, PII-residency) is a **numbered ADR** in `launchpad/decisions/architecture/`, or the engagement's own `decisions/architecture/` when it holds for that engagement only (copy its `TEMPLATE.md`). One adopted from Scopezilla carries `Source: scopezilla-inherited` and stays as adopted; a build-authored one uses a `BLD-NNNN` id. Expect a handful.
- **Cascading consequences:** the bar is a *usable* increment, so surface the ripple work even when no intent names it. A new object/field usually needs FLS on the right permission sets, a slot in the custom app, and a page/layout/list view before anyone can use it; broadened access implies permission-set updates; new Flows/Apex imply tests. Before calling work done, ask "what else does this touch?" — do the ancillary work that's clearly in scope, and flag the rest in the PR's deferred/gaps section.
- **Scope is living, but you change it deliberately — never silently.** The canonical Intent is `intents/INT-NNN/intent.md`, refined *in this repo*. A Scopezilla project is a **tied source**, read in place (`node launchpad/scripts/intent-ledger.mjs source show <name> <path>`) and never copied into the repo. Fix wrong, mis-sequenced, or incomplete Intent with a recorded, ratified edit — `/ql-refine-intent` (known intent) or `/ql-capture-intent` (notes/asks) — never as a build side-effect to make something fit. A fresh Scopezilla run comes in via `/ql-ingest-scopezilla` (reconciles, never clobbers). Record the Trusted Guide's ratification with `node launchpad/scripts/intent-ledger.mjs ratify INT-00x --by "<name>"` (after a refinement, add their `--absorbed` or `--scope-change` call) — only on their say-so; it's bound to the scope hash; `deliver` refuses a draft with no ratification or a stale/malformed one, and only warns when none is recorded. Where `engagement.json` sets `intent_storage: "snapshot"`, intent files are copies of the tracker: never hand-edit them; the loop in `/ql-sync-jira` → "Snapshot mode" writes them.
- **Intent ledger (scope ↔ delivery):** `intents/` is the WHAT; `delivery/intent-ledger.md` is the STATUS, written only by `node launchpad/scripts/intent-ledger.mjs` — never by hand: `start INT-00x` (→ 🔧 In progress), `deliver INT-00x --pr <ref>` (→ ✅ Delivered, stamps the scope hash, refreshes the README index), `retire INT-00x --decision <ref>` (→ 🚫 Retired, a governed de-scope), `reverify INT-00x` (→ 🔄 Needs re-verify when a delivered intent's scope moved; `deliver` re-stamps it once the build is re-verified). The ✅ lands in the PR diff, so it's true on the shared branch only at merge — **the merge is the accountable act** (CI never writes the stamp; merging replaces no 👁 sign-off). Stamp in whichever PR proof completes in — the build PR, or a later QA-evidence PR when testing trails the merge — and own that trailing stamp; it's never an unowned follow-up. In CI, `drift` fails when a ✅ row's hash no longer matches its intent until that change runs `reverify`; `validate` gates file shape. The README delivery index is derived — regenerate it (`index --write`), never hand-edit; a stale one only warns.
- **Design docs (optional, per intent):** for a non-trivial intent (new object, sharing/FLS change, integration, Apex), propose the approach with `/ql-design-intent` **before** building; the Trusted Guide **ratifies the design before the build**. It proposes *how*, never redefines the *what*. Trivial intents skip it.
- **Test scripts (per-intent proof plans):** draft the proof plan with `/ql-test-script` before (or as) you build — `intents/INT-00x/test-script.md`, complete by construction from the intent, one proof criterion (`INT-00x-Cy`) per row, each marked honestly: ✅ automated (a named test, or an `org-probe`) · 👁 manual (a person runs it and signs) · 🔁 fix landed, awaiting retest · ⚠️ partial · ⛔ blocked · 📋 accepted gap (needs a named accepter + pointer, else it gates). A criterion gated on an external dependency stays ⚠️/⛔ until ready. `coverage --gate` fails any ✅ Delivered intent whose script is missing, drifted, or incomplete (**shipped = proven**); a 👁 still awaiting sign-off is surfaced, never gated; a 👁 signed `fail` / `not-run` / `blocked`, an unrouted deferral, or a recorded `❌ org refutes` counts as unproven. ✅ means *CI-confirmed* (the named `Class.method` ran green) or *org-verified* by `/ql-verify-build`; 👁 means a named human signed.
- **Manual test evidence:** a 👁 criterion is proven only once a named human ran it and left a record. `/ql-record-test-execution` writes a never-overwritten execution report under `intents/INT-00x/test-evidence/`, drafts a defect record on failure, and fills the Sign-off cell **citing the report**. The agent records; **the signature is the human's** — never sign off a criterion nobody ran, nor classify a defect's severity.
- **Architectural grounding & conformance (regulated engagements; self-suppresses otherwise):** keep each intent's `## Grounding` (requirement ID, approved-architecture reference) intact — it's excluded from the scope hash, and `conformance` reports what's grounded and flags a ✅ Delivered intent with none (never gates). A deviation from an inherited premise isn't forbidden; a *silent* one is: `/ql-design-intent` authors a `BLD-NNNN` ADR that `Supersedes:` it, marked `Deviation: pending-ARB`. The inherited ADR is never edited, and the ARB flip to `accepted-by-ARB (YYYY-MM-DD, <who>)` is a human hand-edit.
- **Tracker projection (optional):** `/ql-sync-jira` projects scope + delivery into Jira or Azure DevOps Boards. The trust chain stays in the repo: read the tracker freely, but never write its status, answers, or (outside snapshot mode's checked pull) scope back into the intents or ledger — if the tracker is ahead, the repo is stale; fix it via `/ql-refine-intent` or the ledger commands, then sync. `delivery/jira.config.json` is committed and secret-free; an API token lives only in `JIRA_API_TOKEN` / `JIRA_EMAIL` (`ADO_PAT` for Azure DevOps).
- **Branching & the release flow:** one `feature/<engagement>/INT-00x-slug` branch per intent (cross-cutting foundation work may use `feature/phase-N-foundation`). Pipeline: `feature/* → develop → release/* → main → prod`. **Your lane ends at the PR into `develop`** (or `main`, if the repo has only `sf-validate.yml` + `sf-deploy.yml`); cutting `release/*` and promoting to prod are the Trusted Guide's calls.
  - **Two-speed PRs.** Intent edits still land via a PR, so the shared branch is always current; an **intent-only PR** (only files under `launchpad/`) skips the Salesforce build gauntlet but still runs the Intent trust chain; keep the full build PR for `force-app/**`. On a team editing intents in parallel, **pull the shared branch before you refine** (the intent-edit skills warn if you're behind).
  - **Reviewing a build PR:** read `launchpad/REVIEW.md` for the passes and calibration. Findings inform the human; they never approve.
- **Context hygiene:** start each intent in a fresh session (`/clear` in Claude Code) so the last one's build state and assumptions don't leak in. `/ql-start-intent` prompts it.
- **Signal before detail — lead with the decision, not the reasoning.** Outcome, action, or recommendation first; rationale and background after — in plans, PR descriptions, and skill output. When in doubt, cut the opening paragraph.
- **Be precise, not verbose.** Cut words that don't change an outcome, constraint, boundary, dependency, or proof — in intents, decision records, PR bodies, and designs. Refining an intent is *not* accumulation: route non-scope detail to its right home (see `/ql-refine-intent`). "Precise" removes noise, never signal — never cut the honest flag, the cascading consequence, or the open question.
- **Write plain prose the first time,** in the register the audience needs: warm in chat, all-business in intents, decisions and PRs, internal vocabulary stripped from client-facing copy. Sweep every draft against `launchpad/prose-style.md`.
- **Metadata changes:** retrieve from a sandbox, commit, then deploy via the PR. Don't push directly to integration orgs.
- **Skills:** if you do the same thing twice (sprint retro, decision draft), promote it to a skill in your harness's skills dir — without a `ql-` name, so it never collides with or gets flagged as a vendored skill.
- **Nudge on tooling friction.** When the user snags on the *tooling itself* (a skill errors, they correct you twice, they build a workaround), help them past it, then suggest once that they file it with the Launchpad's contribute command (in the Claude Code plugin), scrubbing client/org specifics. (Friction with the *build* is scope — that's `/ql-check-scope`.)
- **Dirty-source membrane — read freely, write clean.** Sensitive source (transcripts, discovery notes, a tied Scopezilla project) is fine to *read*, but what you *write into repo files* must be derived: **provenance is a pointer, never a quote** ("from the 7/23 UAT call", not a lifted line). No names, PII, or deal detail in any tracked or staged file (`git add -A` leaks it) — the repo is often handed to the customer and git history is permanent. Governs every input→Intent skill. Distinct from the secrets rule (credentials vs *content*).
- **Build gotchas:** `launchpad/build-notes.md` holds this org's recurring traps (the build brief carries them); append one the moment you fight through it twice. General platform traps belong to `/ql-design-intent` and the build toolkits.
- **Deployment runbook:** anything the deployed code needs that can't ride the metadata deploy (Setup toggles, feature enablement, Setup-data records the code reads, scheduled jobs) goes, in dependency order, in `launchpad/deploy-runbook.md`. Each PR lists its own such steps in PR template §4; roll the deployment-relevant ones into the runbook so a fresh org stands up from one list. Demo data and persona wiring stay out. `/ql-generate-deployment-plan` works an intent's steps out early.

## Secrets

Keep `.env`, `~/.sfdx/` and named credentials out of git. The `.gitignore` covers common cases; check config files before staging.

<!-- LAUNCHPAD:MANAGED:END -->

## Engagement notes

_Anything specific to this engagement goes here — local conventions, org quirks, team agreements. This section is yours; `/ql-resync` never touches it._
