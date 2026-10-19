---
name: ql-sync-jira
disable-model-invocation: true
description: Project this engagement's scope and delivery status into your project tracker (Jira or Azure DevOps Boards, each via its MCP or an API token). One way by default; in snapshot storage mode the tracker holds the intent text and `pull` refreshes the repo's checked copies.
produces: Jira issues or Azure DevOps work items via the tracker's MCP or REST API (epics, stories, open-question sub-tasks, status changes, evidence comments, scope-drift labels or tags) + `delivery/jira.config.json` (mappings + chosen transport, no secrets) on first setup. One-way in repo storage mode. In snapshot mode, `pull` rewrites `intents/` copies from the tracker, only through the engine's round-trip check.
---

# Sync Jira — project scope + delivery status (one way)

You are projecting this engagement into Jira so delivery leads, sponsors, and the PMO can report on it. This is a **one-way mirror**: the repo is the canonical system of engagement (the living `intents/` are the WHAT; `delivery/intent-ledger.md` is the STATUS), and Jira is the parallel system of record for **reporting**. Scope never flows back *from* Jira — see "The read boundary" — unless the engagement keeps its intents in Jira (`intent_storage: "snapshot"` in its `engagement.json`); then "Snapshot mode" below governs the intent text.

The whole flow is tracker-agnostic: **build desired state → look up what exists → show the diff → confirm → apply**. You are the human checkpoint before anything is written to the tracker. Only the *lookup/apply primitives* and the *concept mapping* differ by tracker — everything else in this skill is identical either way.

> **Harness note.** The confirm-before-push steps use `AskUserQuestion`. In a harness without it, ask the same question as plain text with the options enumerated — the shape of the question matters, the tool doesn't.

## Tracker adapters — the seam (see decisions/0046)

Customers mandate the tracker the same way they mandate the harness, so the projection is **tracker-neutral behind a per-tracker adapter**. An adapter supplies the tracker-specific pieces — the lookup/apply primitives, the concept mapping (epic / intent / open-question → that tracker's hierarchy), the identity mechanism, and the config keys it reads — while the flow above, label-anchored identity, the ledger-is-canonical rule, and the scope hash stay the same. The `tracker` key in `jira.config.json` selects the adapter (default `"jira"` if absent).

**Two adapters ship: Jira and Azure DevOps.** The steps below are written for Jira. On `tracker: "ado"`, run the same steps with the substitutions in `references/ado-adapter.md` (see **"The Azure DevOps adapter"** further down). Adding another tracker is drop-in adapter work, no change to the flow — the contract is in the co-located `references/adapter-contract.md` (in this skill's own dir: `.claude/skills/ql-sync-jira/references/adapter-contract.md`, or `.agents/skills/ql-sync-jira/references/adapter-contract.md` on other harnesses, or `${CLAUDE_PLUGIN_ROOT}/skills/ql-sync-jira/references/adapter-contract.md` on a plugin-only checkout). (Jira's own MCP-vs-API split below is a *transport* choice *within* the Jira adapter, not a second adapter.)

## The Jira adapter's transports — two pens, one projection (see decisions/0011)

Jira can be reached two ways, and **which one you use is the customer's call, not ours** — some enterprise tenants block third-party MCP OAuth apps but allow create-your-own API tokens; others are the reverse. The `transport` key in `jira.config.json` picks the pen. **Swapping the pen must not change what's drawn** — the desired state, identity, ledger-is-canonical rule, and scope hash are the same.

**On MCP, use the Atlassian tool that does each operation**, matched by its description in the session's tool list. The tool names change between server versions, so this skill names the operation, not the tool.

| Operation | `transport: "mcp"` (Atlassian Remote MCP) | `transport: "api"` (`launchpad/scripts/jira-rest.mjs`, Jira Cloud REST v3) |
|---|---|---|
| Reachability probe | list the visible projects | `node launchpad/scripts/jira-rest.mjs projects` |
| Project field/type discovery | list the project's issue types, then one type's fields | `node launchpad/scripts/jira-rest.mjs meta --project <KEY>` |
| Find existing issues (JQL) | search issues with JQL | `node launchpad/scripts/jira-rest.mjs search --jql "<JQL>" --fields key,labels,status,<hashField>` |
| Available transitions | list an issue's transitions | `node launchpad/scripts/jira-rest.mjs transitions <KEY>` |
| Create issue | create an issue | `node launchpad/scripts/jira-rest.mjs create-issue --json '{…fields…}'` |
| Edit issue | edit an issue | `node launchpad/scripts/jira-rest.mjs edit-issue <KEY> --json '{…fields…}'` |
| Transition | transition an issue | `node launchpad/scripts/jira-rest.mjs transition <KEY> --status "<name>"` |
| Comment | add a comment | `node launchpad/scripts/jira-rest.mjs comment <KEY> --body "<markdown>"` |
| Read an item's content (snapshot mode) | read the issue (its description is ADF), piped through `node launchpad/scripts/jira-rest.mjs adf-to-md` | `node launchpad/scripts/jira-rest.mjs read-item --tag <slug/INT-NNN>` |
| An item's content revisions | read the issue's changelog, keeping only summary and description changes | `node launchpad/scripts/jira-rest.mjs list-revisions <KEY>` |

For the API transport, the issue **body** goes in the `fields` payload as `body_markdown` (the *same* markdown you'd hand the MCP with `contentFormat:"markdown"`) — the script converts it to ADF. Parent link and custom fields go in the same `fields` payload (e.g. `{"summary":"…","issuetype":{"name":"Story"},"labels":["intent:acme-2026/INT-001"],"parent":{"key":"ABC-12"},"customfield_10014":"<hash>","body_markdown":"…"}`). Read the whole skill with the transport substitution in mind; the steps below name the MCP tool, and the table is how you translate each to the API subcommand.

## Prerequisite — the right adapter, then a working transport

**First, confirm the adapter.** Read the `tracker` key from `jira.config.json` (default `"jira"` if absent). **`jira` and `ado` are the adapters shipped.** On `ado`, skip the Jira checks below and use the prerequisite in `references/ado-adapter.md`, then follow the steps with its substitutions. On anything else, stop and tell the user that adapter isn't built yet (adding one is `references/adapter-contract.md`); do **not** proceed into the Jira operations below with a tracker they don't fit. The checks from here to "Offline mode" are the Jira adapter's.

**No `jira.config.json` and no signed-in transport yet** (check with the status command in step 1 below, not a tool call that would start OAuth): ask once whether to produce the offline plan now or set up the live projection (needs a project key and a Jira login), defaulting to the offline plan.

Then determine the transport from `jira.config.json`'s `transport` key (default `"mcp"` if the config predates this field), and confirm it's live:

**If `transport: "mcp"`** — needs the Atlassian Remote MCP server (wired in by `/ql-setup`, endpoint `https://mcp.atlassian.com/v1/mcp`). Auth is a one-time browser OAuth. Do the checks through *your harness's* MCP mechanism — the tool names below are the same on any harness; only the status/auth commands differ:
1. Confirm the server is live via the harness's MCP status command — Claude Code: `claude mcp list` (expect `atlassian` connected); opencode: `opencode mcp list`; other harnesses: their MCP list/status mechanism. If it's missing, run `/ql-setup` and restart the harness.
2. Confirm you're authenticated: the first Atlassian tool call triggers the OAuth browser flow. If tools 401, complete the one-time login via the harness's MCP auth — Claude Code: `/mcp`; opencode: `opencode mcp auth atlassian`; other harnesses: their MCP auth flow.
3. Confirm reach (this is also the real tool-exposure probe): list the visible projects. If it isn't callable, the MCP tools aren't actually exposed in this harness — recheck steps 1–2. If the target project isn't listed, the signed-in account can't see it — stop and sort out access. If the user has more than one Atlassian site, confirm which site the project lives on here.

**If `transport: "api"`** — needs a Jira API token in the environment (never committed):
1. Confirm the env is set: `JIRA_EMAIL` + `JIRA_API_TOKEN` (create a token at id.atlassian.com/manage-profile/security/api-tokens), and `base_url` in `jira.config.json` (the customer's `…atlassian.net`). If any are missing, tell the user exactly which and stop.
2. Confirm reach: `node launchpad/scripts/jira-rest.mjs projects`. If it errors on auth (401/403), the token/email are wrong or the account lacks access. If the target project isn't listed, the account can't see it — sort out access before projecting.

First separate a *fixable misconfig* from *no transport at all*: if the chosen transport just needs a correction the user can make now (a missing `JIRA_API_TOKEN`, wrong email, a project the account can't see), the checks above already told them exactly what to fix — that's the path, not offline. Offline mode is the fallback only when **neither** transport can be reached and there's nothing the user can quickly fix (OAuth denied by the tenant, network block, or no `jira.config.json` at all).

In that case, fall back to **offline mode** automatically — don't stop. Offline mode builds the same desired state from the repo (Step 1 is identical) and skips the JQL lookup (Step 2) by treating Jira as empty: every item in the desired state is a `CREATE`. The result is a **preview** of what the first live run would create — review it, then push it by re-running `/ql-sync-jira` live once a transport is available (the live run does the JQL lookup, so it dedupes against anything that already exists). See **Offline mode** below for the full behavior. Route the user to `/ql-setup` if they want to establish a live transport.

## Offline mode — full plan without Jira access

When neither transport is reachable (auth failure, network block, OAuth denied, or `jira.config.json` missing entirely), the skill still has everything it needs for the plan: the living intents, the ledger, and the Scopezilla epics (when present) are all in the repo. Offline mode computes the complete projection plan from those sources — identical to Steps 1–3 of the live flow, with one simplification: no JQL lookup, so Jira is assumed empty and every item is a `CREATE`.

**What changes in offline mode:**

- **Step 1 (desired state)** — identical. Read the sources' epics (if any, as above), all `intents/INT-NNN/intent.md`, and `delivery/intent-ledger.md` exactly as in the live flow, including the no-epics rule.
- **Step 2 (JQL lookup)** — skipped. The in-memory `label → issue key` map starts empty. No transport needed.
- **Step 3 (plan)** — every item is `CREATE` (no `UPDATE`, no `TRANSITION`, no `COMMENT` — those require knowing what already exists). The plan is still sorted: epics first, stories under them, sub-tasks under stories.
- **`jira.config.json` absent** — proceed with defaults (`project_key: "UNKNOWN"`, `issue_types: {epic:"Epic", intent:"Story", open_question:"Sub-task"}`) and **flag each assumption explicitly** in the plan output so the user can correct them before executing.
- **No files written** — not even the `jira.config.json` stub; the config is created on the first live run.
- **Step 4 (apply)** — not offered in offline mode. The plan is read-only; no transport means nothing can be pushed. Tell the user clearly: "This plan is ready to execute once a Jira transport is available — run `/ql-sync-jira` again with MCP or API token configured to push it."

**What the output looks like:**

> ⚠️ **Offline mode** — neither transport is reachable. Treating Jira as empty; all items are CREATEs.
>
> Using defaults: `project_key: UNKNOWN` (update `delivery/jira.config.json` before pushing).
>
> ```
> CREATE epic E01 "Patient Portal & Onboarding" (phase 1–3)
> CREATE story INT-001 "…" → epic E01
> CREATE sub-task Q-001 "…" → INT-001
> …
> ```
>
> **101 operations total** (10 epic CREATEs, 25 story CREATEs, 66 sub-task CREATEs).
>
> To push: configure a transport (`/ql-setup`) then re-run `/ql-sync-jira`. The first live run will create everything shown above; subsequent runs update only what changed.

The plan is the artifact — a preview to share with a PM or paste into a ticket before Jira access is sorted. **Push it by re-running `/ql-sync-jira` live, not by hand.** The live run anchors identity on durable `intent:<id>` labels and does the JQL lookup that dedupes against existing issues; hand-creating issues from this one-line plan skips both, so the labels are lost and the next live run can't tell your manual issues from missing ones — it duplicates them.

## Configuration — `delivery/jira.config.json` (mappings + transport, no secrets, no auth)

The config carries only the **project-specific mappings** and the chosen **transport** — never credentials (OAuth handles auth for MCP; the API token lives in `JIRA_API_TOKEN`, never here). See `delivery/jira.config.example.json` for the shape:

| Key | Meaning |
|---|---|
| `tracker` | which project-tracker adapter drives the projection — `"jira"` (default if absent) or `"ado"`, which reads only the `ado` block (see "The Azure DevOps adapter"; the contract is `references/adapter-contract.md`). The rows below are the Jira adapter's keys |
| `transport` | **Jira adapter** — `"mcp"` or `"api"`, which pen writes the projection (default `"mcp"` if absent) |
| `base_url` | **API transport only** — the customer's Jira site, e.g. `https://acme.atlassian.net`. Omit/blank for MCP (OAuth resolves the site) |
| `project_key` | e.g. `PTSF` — the Jira project everything is projected into |
| `issue_types` | Jira issue-type **names** per level: `{ epic, intent, open_question }` (defaults `Epic` / `Story` / `Sub-task`) |
| `status_map` | ledger token → Jira workflow **status name**: `{ "⬜": "To Do", "🔧": "In Progress", "✅": "Done", "🔄": "To Do", "🚫": "Won't Do" }` (🚫 = a retired/de-scoped intent — map it to the project's terminal *cancelled* status, not its *done* one) |
| `fields` | discovered **custom-field IDs** by name: `{ scope_hash, intent_id }` (optional stamps; identity still works via the `intent:<id>` label if absent) |
| `labels` | label prefixes: `{ intent_prefix: "intent:", open_question_prefix: "open-question:", scope_drift: "scope-drift" }` |

If `jira.config.json` doesn't exist, create it from the example: ask the user for `project_key` and confirm the `transport` (`/ql-setup` should already have recorded the reachable one — carry it forward; only re-probe if it's absent), then **discover the field IDs** rather than asking. On MCP, list the project's issue types, then the Story type's fields; on API, `node launchpad/scripts/jira-rest.mjs meta --project <KEY>`. Either way you get issue types and their fields — match field IDs by name ("Scope Hash" → `scope_hash`, "Intent ID" → `intent_id`). Record what you find; leave a field blank if the project has no such custom field (the projection degrades to label-only identity for it). Commit `jira.config.json` — it holds no secrets.

**Don't trust the example `status_map` status names — discover them too.** The names in the table above (`To Do` / `In Progress` / `Done`) are Jira's *defaults*; many projects run a customized workflow with different names (Open / Closed, or bespoke states), and a `status_map` pointing at a status that doesn't exist fails the transition at push time (Step 4) — and discovering the real names up front is cheaper than catching it at the Step 3 transition check. When first creating the config, read the transitions of any existing issue in the project (MCP: **list transitions**; API: `node launchpad/scripts/jira-rest.mjs transitions <KEY>`) to see the *actual* target status names, and map each ledger token (`⬜ 🔧 ✅ 🔄 🚫`) to a real one. Pick the project's terminal done-category status for `✅` — it's often **`Closed`**, not `Done` — and its terminal *cancelled* status (e.g. `Won't Do`) for `🚫`.

## Step 1 — Build the desired state (from the repo, offline)

Read the canonical sources and compute the set of issues that *should* exist:

- **Epics: the tied Scopezilla sources' `data/epics.json`, read in place for each active source (`node launchpad/scripts/intent-ledger.mjs source show <name> data/epics.json --at cursor`; `source list` names them)** → one **Epic** per epic that actually has intents (skip orphan epics). Label `epic:<slug>/<epic_id>`. (Epics live in the source — they aren't per-file living intents.) A file wrapped as `{"epics": [...]}` is read as its array.
  - **No epics** (no tied source, or a Scopezilla project that never produced epics) → no Epics; every story is created with no parent epic. Put one line at the top of the Step 3 plan: `no Scopezilla epics — stories created without epics`. If any intent carries an `epic_id` anyway, append: `epics are created on a later sync once the Scopezilla project produces them and is re-ingested; stories already synced stay without a parent`.
- **The living intents (`intents/INT-NNN/intent.md`)** → one **Story** per intent, under its epic (no parent when there's no Epic for it). Labels `intent:<id>` and `phase:<N>`. Stamp the `scope_hash` (`node launchpad/scripts/intent-ledger.mjs hash INT-00x`) and `intent_id` custom fields if those IDs are configured.
  - **In snapshot mode, leave the summary and body to the loop in "Snapshot mode"**: the story's text is the intent itself. The projection still sets labels, parent, status and comments.
  - **Story body = the full intent statement, every story, same shape, business summary first.** Not a one-line summary — mirror the complete intent so a stakeholder without repo access sees what the repo holds, but lead with the plain-English outcome so a business reader can stop there. Build the body from the intent file (never retype scope by hand — transcription drifts), in this fixed structure:
    - A header line: `**<INT-id>** · Phase <N> · Epic <epic_id> · Confidence: <confidence>` (drop the `· Epic <epic_id>` segment when the intent has no `epic_id`)
    - `**What this delivers:**` (the first paragraph of `## Outcome`, nothing after it). If the intent has no Outcome, leave the line off and list the story in the Step 3 plan as `NO OUTCOME <id>`, to backfill with `/ql-refine-intent` (Outcome isn't hashed, so backfilling never trips drift).
    - A blank line, a `---` rule, then `**Build detail**` (without the blank line, markdown turns the summary into a heading)
    - `**Build target:**` (the `build_target`)
    - `**Guardrails:**` (the `guardrails[]` as a bullet list)
    - `**Out of scope:**` (the `out_of_scope[]` as a bullet list)
    - `**Acceptance:**` (the `acceptance` walkthrough)
    - A footer: `_Projected from the engagement repo (<INT-id>). Scope hash: <hash>. The repo is canonical; do not edit scope here._`
  - **Pass the body as markdown.** On MCP, set `contentFormat: "markdown"` on the create and edit calls. On API, put the markdown under `body_markdown` in the `fields` payload — `jira-rest.mjs` converts it to ADF (REST v3's description field is ADF, not a markdown string). Either way it's the *same* markdown body. (Rich-text **custom** fields like an "Acceptance Criteria" field are ADF, not markdown — if you ever write one, pass a `{type:doc,version:1,…}` document, not a string. The Story *description* takes markdown fine on both transports.)
  - This fixed shape is what keeps every story uniform: an under-specified body is exactly how stories drift into two formats (a short summary on some, the full statement on others). One structure, sourced from canonical data, for all.
- **unanswered `open_questions[]`** (where `answer == null`) → one **Sub-task** per question, under the intent's story. Label `open-question:<Q-id>`.
- **`delivery/intent-ledger.md`** → per-intent delivery status. Parse the markdown table: find the `Intent`, `Status`, `hash`, `PR`, and `Evidence` columns by header. Map the status cell to a token:
  - `🚫` or "retired" → **🚫** (a de-scoped intent — transition to the terminal cancelled status, don't clear the `scope-drift` handling; it carries no live hash)
  - `✅` or "delivered" → **✅**
  - `🔄` or "re-verify" → **🔄** (also add the `scope-drift` label to that story)
  - `🔧` or "progress" → **🔧**
  - otherwise → **⬜**

**Project the integrated ledger, not your branch's.** A `deliver` stamp is true only once it merges — the merge is the sign-off — so Jira mirrors the integration branch, never the checkout. `git fetch`, then read `git show <integration>:delivery/intent-ledger.md`, where `<integration>` is the first of `origin/develop`, `origin/main`, `develop`, `main` that resolves. Every row's status, PR, evidence, and hash come from that ledger — so a stale branch can't drag a merged ✅ back to ⬜. The working tree contributes only a branch-only **🔧** (start-work mode depends on that). A ✅ or 🚫 that exists only on your branch is **held**: project it as 🔧 with no delivery comment, and list it in the Step 3 plan. If no integration ref resolves, fall back to the working tree and say `⚠ integration ledger not checked` in the plan rather than guessing. This applies in offline mode too, so the preview doesn't promise a Done the live run shouldn't push.

**Scope hash — reuse the ledger helper, never hash inline.** The value stamped into Jira must match what CI drift-checks against, so compute it with the existing script:

```bash
node launchpad/scripts/intent-ledger.mjs hash INT-00x   # prints "INT-00x<TAB><hash><TAB><title>"
```

The output is three tab-separated fields, not a bare hash. Take the second field (the 12-character hash) for `scope_hash` and for comparing against the ledger row; stamping the whole line writes a wrong value and shows a false drift.

(That hash is the first 12 chars of SHA-256 over the canonicalized `{title, build_target, guardrails, out_of_scope, acceptance}` — the script is the source of truth; don't reimplement it here.)

## Step 2 — Look up what already exists (idempotency)

Identity is anchored on the durable **`intent:<id>` / `epic:<id>` / `open-question:<id>` label**, never on summary text — so re-running never duplicates. **The `<id>` is always slug-qualified** (`intent:acme-2026/INT-001`, `epic:acme-2026/E01`, `open-question:acme-2026/Q-001`), because several engagements can share one Jira project and each counts from 001 (`decisions/0082`). An engagement migrated from the old layout carries `"legacy_labels": true` in its engagement profile: its look-up also matches the unqualified labels it wrote before (`intent:INT-001`), and every item it updates gains the qualified label, so nothing is created twice. Do **one batched JQL search** at the top of the run rather than a query per item:

```
project = "<KEY>" AND labels IN ("intent:acme-2026/INT-001", "intent:acme-2026/INT-002", …, "epic:acme-2026/E01", …, "open-question:acme-2026/Q-001", …)
```

Call the **JQL search** with that query, requesting the `key`, `labels`, `status`, and (if configured) the `scope_hash` field. Build an in-memory `label → issue key` map from the result. That map is the whole idempotency mechanism — there is **no `jira-map.json` file** to read or commit. A lost mapping self-heals on the next run because the labels are durable in Jira.

## Step 3 — Compute and show the plan (dry run, writes nothing)

Diff desired state against what the JQL lookup found. Emit one line per operation, grouped:

- `CREATE epic <id> "<summary>"`
- `CREATE story <id> "<summary>" → epic <epicId>` (no `→ epic` when there's no Epic for it)
- `CREATE sub-task <id> "<question excerpt>…" → <intentId>`
- `UPDATE <key> (…)` — summary/body/scope_hash changed; mark it `(body only)` when the body is the only change
- `TRANSITION <key> → <statusName> (<token>)`
- `LABEL <key> +scope-drift`
- `COMMENT <key> (delivery evidence)`
- `HELD <id> <token> on <branch>, <token> on <integration> — projects as 🔧 until merged`
- `NO OUTCOME <id>` — the story has no `**What this delivers:**` line

Show the user the diff and call out:

- Any **NO OUTCOME** stories — a business reader gets only the build detail. Offer to backfill the Outcome with `/ql-refine-intent`.
- Any **HELD** rows — a sign-off that hasn't merged yet. Tell the user to sync again after the merge; don't offer to push the branch status instead.
- How many issues would be **created** vs **updated** (first run creates everything; later runs are mostly updates/transitions).
- Any **TRANSITION** whose target status isn't in the project's workflow — check the issue's transitions before pushing; a missing status means `status_map` needs fixing.
- Any **scope-drift** labels — these come from ledger rows flipped to 🔄 by `reverify` after `drift` caught a scope change. That's a real signal: the delivered build may no longer match the intent's current scope. Surface it; don't paper over it.

This step makes no writes.

## Step 4 — Confirm, then apply

Use `AskUserQuestion` to confirm: **push to Jira now** or **stop here**. When the plan has `(body only)` updates, add a third option, **push everything except body-only updates**, so a team can take the status changes without rewriting every story's description (the first sync after a body-format change shows one for every story). A skipped body shows up as body-only again on the next sync, so the team can take it whenever it's ready; a story whose scope hash also changed is a full update and always goes. Only on explicit confirmation, apply the diff via the MCP, in dependency order so parents exist before children:

1. **Epics** — create (type from `issue_types.epic`, summary, body, label `epic:<id>`) for missing ones; edit for changed ones. Record each new key in the in-memory map immediately.
2. **Stories** — create (type `issue_types.intent`, summary, body, labels `intent:<id>`+`phase:<N>`, **parent = the epic's key** (omit `parent` when there's no Epic for it), and the `scope_hash`/`intent_id` custom fields) / edit. Parent linking and custom fields go in the `fields` payload.
3. **Sub-tasks** — create (type `issue_types.open_question`, **parent = the story's key**, label `open-question:<id>`) for each unanswered question.
4. **Transitions** — for each story, list its transitions, then transition it to the `status_map` target.
5. **Scope-drift labels** — edit to add `scope-drift` to stories whose ledger token is 🔄.
6. **Delivery comments** — for each ✅ story with a PR or evidence, add a comment:
   `Delivered[ in <PR>]. Scope hash at delivery: <hash>.` plus, if present, a blank line then `Evidence: <evidence>`.

**Resilience.** Treat each create/transition/comment as independent — if one fails, log it and keep going; the next run retries only what's missing (the JQL lookup finds whatever succeeded). Don't abort the whole push on a single failure.

**Graceful degradation.** If a project rejects a **parent link** or a **custom-field write** in the `fields` payload (some Jira configurations restrict these via the API), don't fail the issue: create it without the parent / without the stamp, and **report it clearly** in the summary so the user knows stories landed unparented or without `scope_hash`. The label-anchored identity still holds, so a later run can backfill once the field/parent is permitted.

Do **not** auto-commit. The user reviews the result.

## Step 5 — Summary

Report: counts (created / updated / transitioned / labeled / commented), any failures with their reason, any **degradation** (unparented stories, skipped custom-field stamps) and why, and any `status_map`/field gaps the user should fix in `jira.config.json`. If a `scope-drift` label was applied, restate which intents need re-verification (the ledger row + the drift, not a Jira decision). Remind the user to commit `jira.config.json` if it was created/changed.

## Start-work mode — mark one intent in progress (`/ql-sync-jira start INT-00x`)

A scoped, single-intent path for the moment you *begin* building an intent — far lighter than a full projection. It does **two** things, in this order, and never the second before the first:

**1 — Flip the ledger first (canonical).** Run the ledger helper so the repo records it:

```bash
node launchpad/scripts/intent-ledger.mjs start INT-00x          # add --pr <branch-or-PR> to record it too
```

That command is the only writer of delivery status; it flips the row `⬜ → 🔧 In progress` (idempotent, and it refuses to reopen a `✅ Delivered` or `🔄 Needs re-verify` row — that's drift, not start-work). **If it refuses or the intent isn't in the ledger, stop** — don't transition Jira. The ledger leads; Jira follows. Never transition Jira ahead of the ledger.

**2 — Project that one intent (transition-only).** Then mirror just this story into Jira:

1. **Precondition.** `delivery/jira.config.json` exists and its `transport` is working (same Prerequisite section above — MCP connected, or the API env set + reachable). If the config is missing, run the config-creation/discovery flow first. If neither transport is available, stop — start-work mode requires a live transport because it needs to find and transition an existing story; there is no offline path for a single-intent transition (unlike the full projection, which can plan all CREATEs without Jira access).
2. **Look up the one story.** Run the JQL search with a single-label query — `project = "<KEY>" AND labels = "intent:<slug>/INT-00x"` — requesting `key`, `labels`, `status`.
   - **Not found?** This intent hasn't been projected to Jira yet. Don't create a lone story here — story creation needs the parent epic (when there is one) and full field machinery, which is the batch path's job. Tell the user and offer to run the **full `/ql-sync-jira`** first; it creates the story (and epic), after which start-work mode can transition it.
3. **Dry run (writes nothing).** Show the plan — list the issue's transitions to confirm the target is reachable:
   - `TRANSITION <key> <currentStatus> → <status_map['🔧']> (🔧)`
   - *(optional, default off)* `COMMENT <key> "Work started[ on <branch/PR>]."` — offer it; it's harmless reporting context, not authority. Include the branch/PR only if known (e.g. from `--pr`).
   - If `status_map['🔧']` isn't among the issue's available transitions, surface it as a `jira.config.json` gap — same handling as the batch path's Step 3.
   - **No `ASSIGN`.** Assignee is Jira-side workflow data; auto-assigning from the repo would make the repo author a Jira people-field — that softens the one-way boundary. Leave assignment to humans in Jira.
4. **Confirm, then apply.** `AskUserQuestion`: push now or stop. Only on confirm: transition the issue, and add the comment if it was opted in. Treat each as independent (log-and-continue), like the batch path.
5. **Summary.** Report the transitioned key, any `status_map` gap, and restate that the ledger is canonical — Jira just reflects it.

Operations used are the same handful the batch path uses — find the story (JQL search), read transitions, transition, optionally comment — mapped to the config's transport via the table at the top. No create path either way.

## Snapshot mode — Jira holds the intent text (decisions/0083)

When the engagement's `engagement.json` sets `intent_storage: "snapshot"`, each story's summary and description *are* the intent, and `intents/INT-NNN/intent.md` is a copy with a `snapshot:` line that only the engine writes. People may edit the story in Jira; they never edit the copy (CI's `validate` fails a hand edit). Ratification still happens in the repo, against the copy's scope hash.

**Writing an intent (the loop).** `/ql-capture-intent`, `/ql-refine-intent` and `/ql-ingest-scopezilla` draft in `intent.md` as usual, then run this once the Trusted Guide has approved the draft:

1. `node launchpad/scripts/intent-ledger.mjs tracker-body INT-00x` prints the `summary`, `labels` and `body_markdown` to write. Use them verbatim. (Azure DevOps names two of them differently: see `references/ado-adapter.md`.)
2. Show the user what you'll write and confirm. Find the story by its label (Step 2's lookup). If it doesn't exist, create it with those fields (plus type, parent and `phase:<N>`); if it does, edit its summary and description only.
3. Read it back: `node launchpad/scripts/jira-rest.mjs read-item --tag <slug>/INT-00x > <tmp>/INT-00x.json` (any temp folder outside the repo) on the API transport. On MCP, read the issue and pipe its ADF description through `node launchpad/scripts/jira-rest.mjs adf-to-md`, then save `{ key, revision: <fields.updated>, summary, markdown }`. (Azure DevOps: the read-back is in `references/ado-adapter.md`.)
4. `node launchpad/scripts/intent-ledger.mjs pull INT-00x --item <tmp>/INT-00x.json --check`. It writes the copy only when the read-back re-hashes to the draft. **If it refuses, stop and show the user which fields changed**: the tracker reshaped the text. Fix the story or report a converter bug; never commit the draft around it.

**Refreshing (`/ql-sync-jira pull [INT-00x]`).** Read back each intent (or the one named) as in step 3, then run `pull INT-00x --item <file> --refresh`. An unchanged revision is a no-op. When it reports a scope change, list it for the Trusted Guide: their ratification is now stale, and a delivered intent will show as drift. Commit the refreshed copies. `/ql-start-intent` and `/ql-verify-build` run this for the one intent they work on.

**Switching modes.** Into snapshot: run the loop for every intent (`pull --check` must pass for each), then `node launchpad/scripts/intent-ledger.mjs storage snapshot`, which refuses while any intent lacks a snapshot. Back to repo: `storage repo` drops the snapshot lines, and the repo copy is canonical from then on. Tell the team to stop editing intents in Jira. `pointer` mode is designed but not built.

## The Azure DevOps adapter (`tracker: "ado"`)

Azure DevOps Boards runs the **same flow**: Steps 1–5, offline mode, start-work mode, snapshot mode, the read boundary and "What NOT to do" all apply as written. Only the pens, the vocabulary and the config change, and those live in the co-located **`references/ado-adapter.md`** (in this skill's own dir: `.claude/skills/ql-sync-jira/references/ado-adapter.md`, or `.agents/skills/ql-sync-jira/references/ado-adapter.md` on other harnesses, or `${CLAUDE_PLUGIN_ROOT}/skills/ql-sync-jira/references/ado-adapter.md` on a plugin-only checkout). **On `tracker: "ado"`, read it before any step touches ADO.** It covers the operation table for both transports, the Markdown escaping the MCP pen needs, the prerequisite, the config discovery, each step's ADO form (including 🚫 on the Basic process), and the snapshot write and read-back.

## How open questions work (the "no tracker shadowing" boundary)

Unanswered `open_questions` are projected as sub-tasks so stakeholders can see what's blocking. When an answer is decided, it is authored as a `decisions/YYYY-MM-DD-<slug>.md` file (the existing convention) and reflected into the living intent via `/ql-refine-intent`. The next projection run then closes the sub-task. The authoritative answer source is `decisions/` — exactly what `/ql-check-scope` greps (`grep -rn "Q-00x" decisions/`). **Never** copy an answer out of a Jira field back into the repo.

A sub-task closes only when the intent's question line carries the inline `— ANSWERED: <answer>` marker (format: `/ql-refine-intent` Step 2). A decision file alone doesn't close it: `/ql-check-scope` will treat the question as decided, but the projection keeps the sub-task open until the intent is updated.

## Test-script criteria (forward note — not yet projected)

Intents drafted with `/ql-test-script` carry individually-addressable validation criteria (`INT-00x-Cy`) in `intents/INT-00x/test-script.md`. Those ids are a deliberate **export seam**: the natural next mapping is intent → Story, **criterion → sub-task / test case**, automated evidence → comment, a drifted script → the `scope-drift` label (same as a drifted ledger row). This is **not** projected today — the criterion artifact is stable, but the downstream testing-tool/Jira test-management surface is still in flux, so we don't couple to one yet. When it firms up, map it here the same one-way way (repo canonical; a sign-off *result* is evidence that can ride back as a comment, but never as authority). Until then, `/ql-sync-jira` projects intents and open questions only.

## The read boundary (reads inform; reads don't author)

In `repo` storage mode this is one-way on **authority**, not a ban on reading. (In snapshot mode the intent text is the exception, and only through "Snapshot mode" above; status and answers stay one-way in both.) Three kinds of Jira read:

- **Reconciliation reads — fine.** The JQL label lookup in Step 2 reads Jira to diff desired vs. actual. It lands in a transient in-memory map, never in scope. This is core to idempotency.
- **Interactive reads — fine.** "What's the status of PTSF-412," "show me everything labeled `phase:2`," "who's assigned this." Just ask — the Atlassian MCP's read tools (read the issue, the JQL search) are right there, and on Azure DevOps the MCP's work-item read and query tools. The read lands in the conversation; nothing in the repo changes.
- **Authority reads — the violation.** Reading a status, an open-question answer, or a scope edit *out of Jira* and writing it into the living intents or `delivery/intent-ledger.md`. That makes Jira a writer of truth — tracker shadowing.

The trap wears a helpful hat: someone moves a ticket to Done or drops an answer in a Jira comment, and the natural urge is "pull it back so the repo's in sync." Resist it. **Jira being ahead means the *repo* is stale** — author the `decisions/` file (for answers) or update `delivery/intent-ledger.md` (for status), then let the next projection push the truth back down to Jira. The repo leads; Jira follows.

## What NOT to do

- **Don't** read scope, status, or answers *from* Jira into the repo (the authority-read violation above). Reconciliation and interactive reads are fine, and so is snapshot mode's checked `pull` of intent text.
- **Don't** make the ledger or the living intents defer to Jira. `delivery/intent-ledger.md` remains the only writer of delivery status; the existing `intent-ledger.mjs` drift machinery is unchanged.
- **Don't** push without showing the plan diff and getting confirmation.
- **Don't** edit the living intents to make a projection look right — scope changes are deliberate, recorded edits via `/ql-refine-intent` / `/ql-capture-intent`, never a side-effect of reporting.
- **Don't** anchor identity on summary text. Always use the `intent:<id>` / `epic:<id>` / `open-question:<id>` labels.
- **Don't** reimplement the scope hash — shell out to `node launchpad/scripts/intent-ledger.mjs hash`.
- **Don't** run the projection from CI. It's always human-validated.
- **Don't** project the checked-out ledger. Status comes from the integration branch; a ✅ or 🚫 only on a feature branch holds at 🔧 until the merge lands it.
- **Don't** transition an intent in start-work mode before flipping its ledger row, and don't assign or create issues there — it's ledger-first and transition-only.
