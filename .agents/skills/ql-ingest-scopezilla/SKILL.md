---
name: ql-ingest-scopezilla
disable-model-invocation: true
description: Ingest a Scopezilla project in place, turning its scoped intents into living intents and seeding delivery scaffolding, for a first ingest, a re-ingest, or a follow-on project.
produces: >-
  Living `intents/INT-NNN/intent.md` files (each recording its `source:`), a tied-source entry in the engagement profile, seeded `delivery/phase-N/` + `delivery/intent-ledger.md`, engagement details in the engagement README, adopted architecture ADRs in `launchpad/decisions/architecture/`, and a kickoff `decisions/` record. On re-ingest: a reconcile report only (never clobbers). On the `--grill` path: interactively-shaped living intents (origin local, `derived_from` provenance, intact `## Grounding`) authored via the `new` engine command, plus a `decisions/YYYY-MM-DD-scope-grill.md` session record and, optionally, a drafted upstream Scopezilla issue for scope gaps too thin to rebuild. No commit.
---

# Ingest Scopezilla output

You are pulling a Scopezilla scoping project into this AI-native delivery engagement. The scoping work has already been done in a separate project (a folder from Scopezilla's recent-projects list, or a cloned `scopezilla-<slug>` repo). This skill **ties that project to the engagement as a source**, **transforms its scoped intents into living per-intent files under `intents/`**, populates engagement metadata, and seeds the delivery scaffolding.

**Nothing from the Scopezilla project is copied into this repo** (`decisions/0082`). The repo is the customer's, and a scoping project holds deal and discovery material that doesn't belong in their history. The project is read **in place**: its location stays in the gitignored `.launchpad/local.json`, and the engine reads its files with `node launchpad/scripts/intent-ledger.mjs source show <name> <path>`. The one deliberate exception is an architecture ADR the Trusted Guide **adopts** (Step 4c): it becomes the engagement's own record.

Run **after** `setup` (which handles tooling). This skill handles engagement content.

> **Harness note.** Some steps use `AskUserQuestion`. In a harness without it, ask the same question as plain text with the options enumerated — the shape of the question matters, the tool doesn't.

> **Two paths through Step 4.** Everything else in this skill — locating and tying the source, the pre-flight, the existing-content guard, the metadata/delivery/ledger seeding — is shared. Only the transform in the middle forks:
>
> - **Deterministic (default).** `from-json` turns the scoped intents into living files. Fast, reproducible, right when the Scopezilla scope is clean.
> - **Interactive grill (`--grill`, or offered when the scope looks rough).** Instead of a straight transform, you sit down with the human over the *rich* Scopezilla source and shape it into buildable intents — split an oversized intent, rebuild a thin one from the discovery context, confirm the good ones as-is. The deliverable here is the **conversation**, not a classifier: you exercise judgment (informed by the ~24-hour build-validate-demo cycle as a *prompt*, not a hard gate) and the human ratifies each call. See **Step 4-grill**.
>
> Both paths are bound by the dirty-source membrane in `AGENTS.md`.

> **Scopezilla is a context source, not the scope of record.** `intents/INT-NNN/intent.md` is the **living canonical Intent**: human-owned, refined in-repo via `/ql-refine-intent` and `/ql-capture-intent`, with git + `decisions/` as its provenance. A first ingest *seeds* `intents/` from the source; after that **the repo owns the intents** — a re-ingest *reconciles and reports* against the source as last reviewed (its **cursor**), and never overwrites your refinements. An engagement can tie several Scopezilla projects over its life (a follow-on project for the next phase): each is its own named source, and the engagement allocates every intent id, so their numbers never collide.

## Step 1 — Locate and tie the source

The user must point at a Scopezilla project root. If they invoked the skill with a path, use it. Otherwise, if `.launchpad/local.json` records a `scopezilla_source` (set when the repo was seeded), offer that. Otherwise ask. If the engagement already has tied sources (`node launchpad/scripts/intent-ledger.mjs source list`), say which and ask whether this is a re-ingest of one of them or a **new** project for this engagement.

Validate:

- `<src>/.project-metadata.json` exists. If missing, abort: "That doesn't look like a Scopezilla project — no `.project-metadata.json` at the root."
- `<src>/data/intents.json` exists. If missing, abort: "That project has no scoped intents yet (`data/intents.json`). Finish scoping in Scopezilla first."

The `quantum-leap` build bundle (`<src>/outputs/quantum-leap/`) is **optional**: the Launchpad assembles its own build brief. When the project has one, the pre-flight and the phase seeding read a few details from it.

**Tie it** (first time for this project). Propose a short name for the source: the project slug without the `scopezilla-` prefix plus a year or phase (`discovery-2026`, `phase2-2027`), lowercase with hyphens. The Trusted Guide confirms it; it appears in every intent's `source:` line and can't change once an intent records it. The Scopezilla slug is the project's own (its repo name without `scopezilla-`, or its folder name):

```bash
node launchpad/scripts/intent-ledger.mjs source tie <name> --slug <scopezilla-slug> --path "<src>" [--role follow-on]
```

This writes `{name, scopezilla_slug, role, cursor, tied_at}` into the engagement profile and the folder path only into `.launchpad/local.json`. A teammate who clones finds the project from the slug (their recent-projects list, `gh` search, or a pasted path), clones it themselves if they don't have it, and re-runs the tie with `--path` on their machine.

## Step 2 — Pre-flight summary

Read `<src>/.project-metadata.json` in place, plus `<src>/data/roadmap.json` and `<src>/data/epics.json`. Surface a one-screen summary:

- Project name (`project_name`)
- Quantum Leap blueprint (`quantum_leap_blueprint`, top level)
- Target org name + type + build_allowed (`target_org`, top level: `name`, `type`, `build_allowed`)
- Phase count and names (`data/roadmap.json`: `phase_number`, `phase_name`)
- Clouds in scope: the "Clouds in scope:" line of `outputs/quantum-leap/00-agent-brief.md` when the bundle exists; otherwise read them off the epics' names and descriptions
- Depth mode (`depth_mode`)
- Total weeks if `timeline.user_commitment.total_weeks` is set

These reads come off the folder, but the transform reads the project's last commit. Run `node launchpad/scripts/intent-ledger.mjs source status <name>`: if it warns about uncommitted changes in `data/` or `decisions/`, say so in the summary and recommend committing in Scopezilla, then re-running, so the intents you ingest are the ones on screen.

Ask the user to confirm before writing anything.

**Quality read → offer the grill path.** While you have the intents in view, take a cheap read of their shape — roughly how many build-target steps each carries, whether any read as thin/placeholder, whether any are so broad they clearly won't land in a single build-validate-demo cycle. This is a *glance*, not a full `/ql-vet-intent` sweep. Then:

- If the user invoked with **`--grill`**, go the interactive path (Step 4-grill) regardless of what the read shows — they asked for it.
- If the read surfaces **oversized or thin intents** and no flag was passed, surface what you saw and **offer** the grill: *"3 of these 12 intents look oversized for a single build cycle and 1 reads like a placeholder — want to grill the scope interactively instead of a straight transform? (default: proceed deterministic)."* Use `AskUserQuestion`. **Default to deterministic** — a clean source is never slowed down, and the offer is a nudge, not a gate.
- If the read is clean and no flag was passed, say nothing about grilling and proceed deterministic.

The read is judgment you'll reuse *inside* the grill if the user accepts — carry it forward rather than re-deriving it.

## Step 3 — First ingest or re-ingest (per source)

Whether this **source** has been ingested decides the flow, not whether `intents/` is empty: a second project for the same engagement is a first ingest *of that source*.

- **No intent records `source: <name>#…` → FIRST INGEST of this source.** Step 4a transforms it.
- **Some do → RE-INGEST.** The repo already owns those living intents. Reconcile and report (Step 4b) — the human decides what upstream changes to take.

Then:

- **`delivery/`** — if non-empty, default to **merge** (only create phase folders that don't exist). The user has build notes there.
- **`decisions/`** — if a kickoff file already exists for today's date, skip it.

**An old repo with a committed `scopezilla/` mirror** belongs to the migration (`/ql-resync`), which ties the source and removes the mirror in its own PR. Stop and point the user at `/ql-resync`.

If anything's ambiguous, ask the user.

## Step 4 — Read the source in place

Everything below reads `<src>` where it is. The engine reads a file at the reviewed commit with:

```bash
node launchpad/scripts/intent-ledger.mjs source show <name> data/intents.json --at cursor   # or --at head
node launchpad/scripts/intent-ledger.mjs source status <name>                                # what changed since the last review
```

A project with no git is read from its folder; the engine keeps the reviewed copy on this machine only and says so, and the user should hear that teammates can't reconcile it until the project is in git (Scopezilla's `collaborate`).

Stage the upstream intents for the engine in a scratch dir outside the repo:

```bash
TMP=$(mktemp -d)
node launchpad/scripts/intent-ledger.mjs source show <name> data/intents.json --at head > "$TMP/fresh.json"
```

## Step 4a — Transform scoped intents → living `intents/` (FIRST INGEST of this source)

> **Grill path chosen?** If the user passed `--grill` or accepted the Step 2 offer, **skip this deterministic transform and go to Step 4-grill** — the interactive session authors the living intents instead. Come back here only if they declined and want the straight transform. (On a re-ingest the grill composes with the reconcile — see Step 4b and Step 4-grill.)

Once the user has confirmed the pre-flight, mark the source as reviewed at what you just read, then transform at that commit:

```bash
node launchpad/scripts/intent-ledger.mjs source ack <name>
node launchpad/scripts/intent-ledger.mjs source status <name> --json      # read "cursor" for --at
node launchpad/scripts/intent-ledger.mjs from-json "$TMP/fresh.json" --source <name> --at <cursor>
```

The engine allocates the engagement ids. Each source intent keeps its own number when that number is free in this engagement, so a first source lines up 1:1; a later source's colliding numbers get the next free ids, and the engine prints every remap (`phase2-2027#INT-001 → INT-013`). Each file records `source: <name>#INT-NNN`, and upstream dependency ids are remapped to engagement ids. The transform is **hash-stable** (the scope hash is identical before and after, so seeding never causes false drift), and `from-json` **refuses to overwrite** an existing intent file, so it can't clobber a refinement. It also checks the project's `contract_version`: output from before the field existed reads as version 1, and a version this engine doesn't know is refused with a pointer to `/ql-resync`. On that refusal, stop and say so; don't edit the JSON to get past it.

**Loss-proof by construction — surface the carry report.** `from-json` doesn't drop upstream fields it has no first-class home for. Architectural **grounding** — a requirement ID, the approved-architecture reference, a wireframe — lands in a `## Grounding` section, with each project-relative location written source-qualified and pinned to the reviewed commit (`discovery-2026:reference/arch.pdf@abc123def456`), so it opens with `source show`. Any *other* unmapped upstream field is preserved **verbatim** under `## Grounding → ### Carried` and **reported on stdout**. Read that report to the user:

- If it says *"Carried architectural grounding for N intent(s)"* — the scope carries **architectural grounding** (a requirement ID / approved-architecture reference). Traceability is now something the `conformance` report can surface, and `/ql-design-intent` / `/ql-vet-intent` will check the build approach against it.
- If it warns *"Preserved N intent(s) with upstream fields that have no first-class schema home"* — surface those field names to the user. They were kept, not lost, but a field the transform had to carry-verbatim is a hint the SZ→QL contract may need a first-class home for it (a cross-repo hand-off issue).

Then, if any intent carried grounding, run the conformance report so the user sees the traceability baseline:

```bash
node launchpad/scripts/intent-ledger.mjs conformance     # per-intent grounding traceability (a report, never a gate)
```

If no intent carries grounding, the report says "nothing to trace" — say so and move on.

Confirm the transform:

```bash
node launchpad/scripts/intent-ledger.mjs validate     # every intent parses, sections present, deps resolve
```

If `validate` flags anything, the upstream JSON had a shape the template didn't expect — surface it (and consider an issue for the Scopezilla team); don't hand-patch silently.

## Step 4b — Reconcile fresh upstream against living intents (RE-INGEST only)

Start with what changed since the last review, then run the read-only 3-way reconcile — base = the source at its cursor, ours = the intents recorded as coming from it, theirs = the source now:

```bash
node launchpad/scripts/intent-ledger.mjs source status <name>
node launchpad/scripts/intent-ledger.mjs source show <name> data/intents.json --at cursor > "$TMP/base.json"
node launchpad/scripts/intent-ledger.mjs reconcile "$TMP/fresh.json" --source <name> --base "$TMP/base.json"
```

A **lost cursor** (the project's history was rewritten) has no base: the reconcile then flags every intent that differs for a human, which is the honest answer.

It reports, per intent (engagement id with its source id), who changed it since the last review:

- **🆕 Added upstream** — new intents not in the repo. Pull just these in: `from-json "$TMP/fresh.json" --source <name> --at <head sha>` writes only the missing ones, then `node launchpad/scripts/intent-ledger.mjs sync` opens their ledger rows.
- **🟡 Changed upstream ONLY** — upstream refined them, we didn't touch them. Usually safe to take the new text; re-author those specific intents — hand-merge, or run the exact `from-json … --source <name> --force --only <source ids>` command `reconcile` prints (never a bare `--force`, which overwrites every intent from the source including ones refined in-repo) — but it's the human's call.
- **🔵 Refined in-repo ONLY** — we changed them, upstream didn't. **Keep ours.** Do nothing.
- **🔴 CONFLICT — changed BOTH sides** — a human must settle each: compare `intents/<id>/intent.md` against the fresh output and decide. Record the decision.
- **ℹ Changed upstream outside scope** — upstream moved a phase, an epic, grounding or an answer, which the scope hash doesn't cover. Not drift; nothing re-verifies. Read the change to the human, who refines the intent if it matters.
- **⚫ Removed from upstream** — an intent from this source vanished from the fresh output. If intentional, retire it through `/ql-refine-intent` (decision + `intent-ledger.mjs retire`, never a deleted directory or row); if upstream dropped it by mistake, keep ours and flag upstream.

Present this to the user and apply only what they ratify. Once the chosen upstream changes are applied, **move the cursor** so the next reconcile compares against this review: `node launchpad/scripts/intent-ledger.mjs source ack <name>`. Re-run `validate`, then continue to the ledger drift check (Step 6b).

> **Grilling on a populated repo composes with this reconcile — it is never a door around it.** Grilling is useful past the first ingest (a phase-2 batch, a fresh upstream run for the next value drop, mid-engagement discovery). But the reconcile is the safety net that protects your in-repo refinements, so the grill operates on **what the reconcile surfaces**, not around it: after this report, an accepted grill works *only* the **🆕 added upstream** intents and the **🔴 conflicts** — exactly the things worth an interactive session. A **🔵 refined-in-repo** (settled) intent is never touched by the grill; the never-clobber rule stands. Shaping brand-new scope from notes/rich source *without* a fresh upstream run is `/ql-capture-intent`'s job, not this. So: reconcile first, then grill its output. Go to Step 4-grill with that scoped worklist.

## Step 4c — Adopt the source's architecture ADRs (only if it has any)

In a grounded / ARB-governed engagement, Scopezilla authors the **load-bearing architecture premises** the scope was built on (single-org, LWR-over-Aura, PII-residency) as ADRs in the project's `decisions/` (see Scopezilla's `DECISION-HANDOFF-CONTRACT.md`). **Default zero** — most projects have none; then say "no architecture ADRs in source" and move on.

When it has some, list them as of the cursor (`source show <name> decisions/ --at cursor` lists the folder in a git project; `ls` it in a folder-only one), read each with `source show <name> decisions/<file> --at cursor`, and ask the Trusted Guide which to **adopt** — the premises this engagement will build on. They're pre-selected on a first ingest, since the scope was built on them. Each adopted ADR is copied verbatim, once, into `launchpad/decisions/architecture/` (or the engagement's own `decisions/architecture/` when it holds for this engagement only), with a provenance line added under its title and its `Source:` re-stamped to `scopezilla-inherited`:

```markdown
**Adopted-from:** <name>@<cursor sha, 12 chars>:decisions/<file>
```

From then on it's the engagement's record: a deviation supersedes it with a `BLD-NNNN` ADR marked `Deviation: pending-ARB` (`/ql-design-intent`), and nobody edits the adopted copy. An ADR left unadopted stays in the source, read as context only. On a re-ingest, an ADR that changed upstream since its `Adopted-from` sha is reported to the human; they decide whether to supersede the adopted copy. Report the count adopted in Step 8.

## Step 4-grill — Interactively shape scope from the rich source

Reach here when the user passed `--grill` or accepted the Step 2 offer. This **replaces** the deterministic Step 4a transform (first ingest) or works the reconcile's worklist (populated repo, per Step 4b). The point is a working session, not a pipeline: you and the human go through the scope together and land good, buildable living intents.

> **Same session, one difference — where the intent comes from.** This is the *same* interactive shaping session `/ql-grill-intents` runs on **existing** living intents (the four shapes, the facts/decisions posture, the membrane, the conditional scrub — all canonical there). The one difference is authoring: at ingest the intents **don't exist yet**, so this path **authors them directly** from upstream (the `new` scaffold, below) instead of decide-and-routing through `/ql-refine-intent` / `/ql-capture-intent` the way `/ql-grill-intents` does. Reshaping intents *after* ingest — a mid-engagement drift check, a phase-2 grill — is `/ql-grill-intents`, not a re-run of this.

**What "the rich source" is, and why it matters.** The deterministic transform reads only `data/intents.json`. The grill may read the *whole* Scopezilla project at `<src>` for context — `discovery-notes/`, `knowledge/`, `outputs/*.md`, the deliverables — because that's where the detail to rebuild a thin intent or justify a split actually lives. Reading it is the grill's job; **landing any of it in the repo is forbidden** (see the membrane below).

### The session, the membrane, and the scrub — same as `/ql-grill-intents`

Run the sitting **exactly as `/ql-grill-intents` specifies** — the four shapes (good-as-is / oversized→split / thin→rebuild / reconcile-against-the-build), the facts-vs-decisions posture, the lane boundary (refine the *expression* of scope, never originate it), and the dirty-source membrane (provenance is a pointer, never a quote) are all canonical there (its Step 3 and Step 5). Go intent by intent — first ingest: the whole set; populated repo: only the 🆕 + 🔴 worklist from Step 4b.

The membrane is at its **sharpest** on this path: ingest reads the *most* sensitive material to rebuild the *most* scope, so the scrub-verify pass (Step 4-grill-scrub) is **unconditional** here.

### Authoring each ratified intent

Use the engine's scaffold — the same primitive `/ql-capture-intent` uses — so grilled intents are honest `origin: local` living intents, collision-safe, never clobbering:

```bash
node launchpad/scripts/intent-ledger.mjs new --phase <N> --title "<title>"    # prints the allocated INT-NNN
```

Then fill the scaffolded `intents/INT-NNN/intent.md`:

- **Body sections** (`build_target`, `guardrails`, `out_of_scope`, `acceptance`, dependencies, open questions) — written as clean, derived prose. No verbatim source.
- **`derived_from:` frontmatter** — the provenance pointer(s), comma-separated on one line: the upstream intent ID(s) this came from, qualified with the source name, or the epic/requirement ID when rebuilt from below-intent-level context. A split stamps every child with the parent's pointer. Example: `derived_from: discovery-2026#INT-014` or `derived_from: discovery-2026#E05, REQ-042`. (Provenance metadata only: the engine doesn't read it, and it's excluded from the scope hash.)
- **`## Grounding`** — in a grounded/ARB engagement, preserve the requirement ID / approved-architecture reference exactly as the deterministic transform would (source-qualified, `<name>:<path>@<sha>`), so the `conformance` report keeps working. **On a rebuild, actively re-assert the requirement-level trace** — a rebuilt intent must still say which requirement it satisfies.

Then stamp and validate as usual:

```bash
node launchpad/scripts/intent-ledger.mjs hash INT-NNN        # print the scope hash (a test script stamps `hash --proof`)
node launchpad/scripts/intent-ledger.mjs validate            # confirm it parses, sections present, deps resolve
node launchpad/scripts/intent-ledger.mjs ratify INT-NNN --by "<name>"   # the human ratified it in this session
```

Open a ledger row for each with `node launchpad/scripts/intent-ledger.mjs sync` — it adds a `⬜ Not started` row for every intent that lacks one and re-derives the footer count and README index. On a populated repo, an accepted 🔴-conflict resolution updates the existing row rather than adding one; a 🆕 add gets a new row.

### The session decision record

Write **one** `decisions/YYYY-MM-DD-scope-grill.md` for the whole session (copy `launchpad/decisions/TEMPLATE.md`), recording what was split / rebuilt / confirmed / escalated and **why** — sources cited **by pointer, never quoted**. This is the paper trail for the shaping calls the human ratified and the provenance of every derived intent. For an escalated scope gap, add a line naming the gap; then **offer** (default off) to draft an upstream issue for the Scopezilla team (with the Salesforce plugin installed, its curated-KB skill lists the upstream sources and how to file there) — scrubbed of client/org specifics, since it lands in the public plugin-adjacent repo. The human decides whether it goes upstream.

Once every ratified intent is authored, stamped, and validated, run the scrub-verify pass before anything is considered landed.

## Step 4-grill-scrub — Independent scrub of the authored output

The membrane's backstop, and **always warranted here** — the ingest grill reads the dirty rich source by definition, so the scrub is not conditional on this path (unlike `/ql-grill-intents`, where it fires only when a dirty source was opened). Because you (the authoring session) have read the source, you're not a reliable judge of whether the *output* leaked it — the check must be made by a reader that **never saw the source**, judging the files purely on their face.

Run it exactly as **`/ql-grill-intents` Step 5** specifies (the canonical scrub-verify mechanics: fresh-context subagent → fresh session → isolated re-read, by harness capability; the reader gets *only* the authored output, never the source). Here the authored files are this session's new/changed `intents/INT-NNN/intent.md` and the `decisions/YYYY-MM-DD-scope-grill.md`. Surface findings, resolve each before the files are considered landed. Nothing commits here regardless — but the scrub gates the session's *"done."*


## Step 5 — Populate engagement metadata in the engagement README

Patch the engagement's own `README.md` (in its folder, not the repo root) with an Engagement block delimited by HTML comments so re-runs replace cleanly. It goes nowhere else: a repo can hold several engagements, so the root `AGENTS.md` describes none of them (`decisions/0082`).

```markdown
<!-- ENGAGEMENT:BEGIN -->
## Engagement at a glance

- **Client / project:** <project_name>
- **Blueprint:** <quantum_leap_blueprint>
- **Clouds in scope:** <clouds list>
- **Phases:** <N>
- **Target org:** `<target_org.name>` (<target_org.type>)
- **Depth mode:** <depth_mode>
- **Timeline:** <total_weeks> weeks (if available)
- **Scopezilla sources:** <name> (<scopezilla_slug>)[, <name> (<scopezilla_slug>)]
<!-- ENGAGEMENT:END -->
```

Name sources by name and slug only. If the block already exists (find the `<!-- ENGAGEMENT:BEGIN -->` marker), replace its contents in place; on a later source, add it to the sources line. If not, insert it after the H1 line. An older repo may still carry one in the root `AGENTS.md`: leave it as it is.

In `README.md`, also remove or rewrite the line `After setup, fill in the engagement details above.` since the details are now populated.

## Step 6 — Seed `delivery/`

For each phase in the source's `data/roadmap.json`, create `delivery/phase-N/README.md` (if it doesn't already exist):

```markdown
# Phase N — <phase_name>

<duration line, when the source's bundle has one>

The source's phase plan, when it has one: `source show <name> outputs/quantum-leap/10-phase-N.md`.

## Plan-mode notes

_(Capture answers to Plan-mode questions here as you walk them.)_

## Build log

_(Append build progress, decisions, and gotchas here.)_

## Acceptance evidence

_(Capture pass/fail for each proof criterion (`INT-00x-Cy`) as it lands.)_
```

The duration comes from a `> Phase duration:` line in the bundle's `outputs/quantum-leap/10-phase-N.md`, read with `source show`; leave it out when there's no bundle.

## Step 6b — Seed or reconcile the intent ledger

**Snapshot mode** (`intent_storage: "snapshot"` in `engagement.json`): the tracker holds the text, so write each new or changed intent there and pull it back with the loop in `/ql-sync-jira` → "Snapshot mode" before seeding the ledger. Report any intent whose `pull --check` refused; it stays out of the commit.

`delivery/intent-ledger.md` is the backward link between scope and delivery — one row per intent, tracking status / PR / evidence / the scope hash captured at delivery. The helper `launchpad/scripts/intent-ledger.mjs` seeds it and detects drift. The living `intents/` are the WHAT; the ledger is the STATUS.

**No ledger yet:** generate a fresh one — every intent starts ⬜ Not started.

```bash
ENG=$(node launchpad/scripts/intent-ledger.mjs where)   # the active engagement folder
node launchpad/scripts/intent-ledger.mjs seed > "$ENG"/delivery/intent-ledger.md
```

**A ledger already exists** (a re-ingest, or a later source): open rows for the new intents with `node launchpad/scripts/intent-ledger.mjs sync`.

Then write the README **Delivery index** — a derived, phase-grouped view of intent → status → PR that lives in the engagement `README.md` between `<!-- ENGAGEMENT:INDEX:BEGIN -->` markers (distinct from the Step 5 "at a glance" block). It's regenerated, never hand-edited; CI warns on a PR whose index is stale:

```bash
node launchpad/scripts/intent-ledger.mjs index --write
```

**On a re-ingest**, reconcile the *ledger* to the new intent set once Step 4b's changes are applied:

1. Run the drift check against the now-current `intents/`:

   ```bash
   node launchpad/scripts/intent-ledger.mjs drift
   ```

2. If it reports **🔄 SCOPE DRIFT** for any intent, that intent's `build_target` / guardrails / out_of_scope / acceptance changed **after** it was delivered — whether the change came from upstream (applied in Step 4b) or from an in-repo refinement. Either way it's the same honest signal. For each drifted intent: run `node launchpad/scripts/intent-ledger.mjs reverify INT-NNN` (flips the row to `🔄 Needs re-verify`, keeping the hash + PR — never hand-edit the ledger), and surface it in the Step 8 summary as an explicit action item (re-verify the delivered build against the new intent text; `deliver INT-NNN` re-stamps it if it still holds). Do not auto-resolve — the human decides whether the build still satisfies the changed scope.
3. If intents were removed/renamed, `drift` flags them as "tracked but not present" — reconcile by hand.
4. Once the ledger reflects the new scope, refresh the index: `node launchpad/scripts/intent-ledger.mjs index --write`.

Never hand-edit an intent file just to make drift go away — drift is information. The fix is either a deliberate `/ql-refine-intent` (with a decision) or accepting the re-verify; not silencing the signal.

## Step 6c — Offer to refresh the Jira projection (only if already configured)

If — and only if — `delivery/jira.config.json` exists, this engagement already projects scope + delivery status into Jira (via `/ql-sync-jira`). A fresh ingest may have added intents, changed scope, or flipped a ledger row to 🔄, so the Jira side is now behind. Offer (via `AskUserQuestion`) to run **`/ql-sync-jira`** to preview the projection — its plan step shows the diff (new stories, status transitions, any `scope-drift` labels) and writes nothing until the user confirms. Default to **no**; this is a convenience nudge, not part of ingest, and `/ql-sync-jira` is the human-validated path for any actual push.

If `delivery/jira.config.json` does **not** exist, skip this step silently — first-time engagements have no Jira connection and `/ql-sync-jira` sets one up when the user wants it.

## Step 7 — Record the engagement kickoff decision

This step is **not** conditional on Jira — it runs on the first ingest of each source (it is a declared deliverable). Create `decisions/YYYY-MM-DD-engagement-kickoff.md` (today's date; `…-<name>-kickoff.md` for a later source) **only if** no kickoff record for this source exists yet. When the source has a bundle, read `01-engagement-intent.md` and `10-phase-1.md` from it with `source show`; without one, write the Context from the project's own summary in your words.

```markdown
# Engagement kickoff — <project_name>

**Date:** <today>
**Source:** <name> (Scopezilla project <scopezilla_slug>), reviewed at <cursor sha, 12 chars>

## Context

<the Intent paragraph from `01-engagement-intent.md`, or a short derived summary>

## Choice

- **Quantum Leap blueprint:** <blueprint>
- **Clouds in scope:** <clouds>
- **Target org:** `<target_org.name>` (<target_org.type>; build_allowed=<bool>)
- **Phase plan:** <N> phases over <total_weeks> weeks
- **Depth mode:** <depth_mode>

## Consequences (cross-cutting commitments)

<the Pre-decided list from `10-phase-1.md`, when the bundle has one>

These were locked during scoping. Do not re-litigate; surface them as constraints to the build agent.
```

## Step 8 — Summary

If `.launchpad/local.json` lists `ingest` in `pending`, remove it now (keep the file's other fields).

Print a Deliverables block with inline-backtick absolute paths so the user can click to reveal in Finder:

```
**Deliverables**
- `<engagement>/intents/` (the living canonical Intent — one INT-NNN/intent.md per intent, each with its `source:`)
- `<engagement>/engagement.json` (the tied source: name, Scopezilla slug, the cursor it was reviewed at)
- `<repo>/launchpad/decisions/architecture/` (adopted ADRs — **only when the source has any**; report the count, or "no architecture ADRs in source")
- `<engagement>/delivery/phase-1/README.md` (...one per phase)
- `<engagement>/delivery/intent-ledger.md` (seeded on first ingest; drift-checked on re-ingest)
- `<engagement>/decisions/<date>-engagement-kickoff.md`
- `<engagement>/decisions/<date>-scope-grill.md` (**grill path only** — the session record: what was split/rebuilt/confirmed/escalated, sources by pointer)
- `<engagement>/README.md` (engagement "at a glance" + the generated Delivery index)
```

Report any id remaps `from-json` printed, so nobody looks for upstream INT-001 at engagement INT-001 when it moved. On the **grill path**, also report how many intents were confirmed / split / rebuilt / escalated; that the scrub-verify pass ran and what it flagged (or "clean"); and whether an upstream Scopezilla issue was drafted for any escalated gap.

Then suggest next steps:

1. `/ql-start-intent` on the first intent to build; it assembles the build brief.
2. If `sfdx-project.json` is missing, run `sf project generate --name . --manifest`.
3. Authorize the target org: `sf org login web --alias <target_org.name>`.

## What NOT to do

- **Don't** copy anything from the Scopezilla project into the repo: not the bundle, deliverables, `data/`, `reference/`, `knowledge/` or metadata. Read it in place; the one exception is an adopted ADR (Step 4c).
- **Don't** write the project's path or URL into a committed file. It lives only in `.launchpad/local.json`.
- **Don't** delete user content in `delivery/`, `decisions/`, or `intents/` — those have human-authored content after first run. Use merge / reconcile semantics. On re-ingest, **never overwrite `intents/`** — reconcile and report (Step 4b); the human applies what they ratify.
- **Don't** move the cursor (`source ack`) before the human has reviewed the changes. It records that the team reviewed the source up to there.
- **Don't** regenerate Scopezilla outputs. A fresh upstream run comes in via reconcile; in-repo scope corrections are `/ql-refine-intent` and `/ql-capture-intent`, not a patch here.
- **Don't** commit. The user reviews the diff first.
- **Don't** call any `mcp__plugin_scopezilla_*` telemetry tools — this skill runs on the launchpad side, not inside a Scopezilla project.

**Grill path (`--grill`) specifically:**

- **Don't** land a single verbatim line from the rich source — a transcript quote, a person's name, PII, or deal/commercial detail — in *any* file the repo keeps (intents, decision record). Provenance is a pointer, never a quote. The repo is a customer deliverable and git history is permanent.
- **Don't** stage dirty source in a scratch file to "organize" it — not even a gitignored one. Hold context in the session; write only clean derived prose.
- **Don't** give the scrub reader (subagent, fresh session, or isolated re-read) the source — only the authored output files. Its independence *is* the check; feeding it the transcripts defeats it. And don't skip the scrub because your harness lacks subagents — use the fresh-session or isolated-re-read fallback instead.
- **Don't** invent scope to fill a gap. A source too thin to rebuild honestly is a Scopezilla scope gap — escalate it (decision-record line + optional upstream issue), don't guess.
- **Don't** grill a settled (🔵 refined-in-repo) intent on a populated repo. The grill only works the reconcile's 🆕 adds and 🔴 conflicts; the never-clobber rule stands.
- **Don't** author grilled intents through `from-json` — they're derived, not transformed. Use `new` (origin local) so a future reconcile correctly treats them as locally-authored, not upstream-deleted.
