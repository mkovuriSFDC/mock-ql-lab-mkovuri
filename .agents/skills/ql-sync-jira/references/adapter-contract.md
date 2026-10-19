# Tracker adapter contract

How to add a project-tracker adapter to `/ql-sync-jira` **without changing the sync flow** (see `decisions/0046`). Read this when adding a tracker or working on the Azure DevOps one. The Jira adapter is the worked example — everything in `SKILL.md` below the "Tracker adapters" section *is* the Jira adapter — and [the Azure DevOps adapter](#the-azure-devops-adapter) below is the second. How the skill runs on ADO, step by step, is `ado-adapter.md` next to this file.

The projection is tracker-neutral. The skill owns the flow; an adapter owns only the tracker-specific pieces. `tracker` in `delivery/jira.config.json` selects the adapter: `"jira"` (the default) or `"ado"`.

## What the skill owns — an adapter never touches these

`build desired state → look up what exists → show the diff → confirm → apply`, plus: desired state built from the repo (`intents/`, `intent-ledger.md`, and the tied sources' `data/epics.json`, read in place, when present); **label/tag-anchored identity** (never summary text); **ledger-is-canonical** (the repo is the only writer of delivery status); the **scope hash** (always `node launchpad/scripts/intent-ledger.mjs hash …`, never reimplemented); the dry-run-then-confirm checkpoint; and the **read boundary**: in `repo` storage mode a tracker read never authors repo scope; in `snapshot` mode the tracker holds intent content, and only the round-trip-checked pull writes it into the repo (`decisions/0083`). Building on these is the whole point — an adapter that reimplements any of them is wrong.

## What an adapter provides

1. **Primitive set** — the operations the flow calls, implemented for this tracker. The flow names the abstract op; the adapter maps each to a tool/subcommand (Jira maps them to MCP tools or `launchpad/scripts/jira-rest.mjs` subcommands — see the transport table in `SKILL.md`). The two reads exist for the `snapshot` and `pointer` storage modes, where the tracker holds intent content (`decisions/0083`); the format converter is the adapter's (Jira: `jira-rest.mjs`'s ADF pair, which the MCP transport uses too):

   | Abstract op | Purpose |
   |---|---|
   | reachability probe | confirm the transport is live and the target project/space is visible |
   | discovery | list issue/item types + fields (to fill config) |
   | find-existing | query items by **durable identity tag** (the idempotency lookup) |
   | list-states | the transitions/states available on an item |
   | create / edit | create a missing item, update a changed one |
   | set-state | move an item to the mapped status |
   | comment | attach delivery evidence |
   | read-item | an item's content, by identity tag, converted to the intent format (markdown), plus its revision |
   | list-revisions | when an item's content (summary, description) changed, with no author names |

2. **Concept mapping** — how the three projected levels land in this tracker's hierarchy: **epic → ?**, **intent → ?**, **open-question → ?**, including how children link to parents, and the ledger-token → tracker-status map (`⬜ 🔧 ✅ 🔄`). Jira: Epic / Story / Sub-task, parent-linked, `status_map` in config.

3. **Identity mechanism** — a durable, queryable tag equivalent to Jira's `intent:<id>` / `epic:<id>` / `open-question:<id>` labels. Idempotency depends on it: re-running must find what exists, never duplicate. If the tracker has no labels, the adapter must define an equally durable identity (a custom field) and its find-existing primitive must query *that*.

4. **Config keys** — the adapter reads its own keys from the (secret-free, committed) config: project/space id, the type + status maps, discovered field ids, and any transport selector. **Credentials are env-only, never in the file** (mirror the Jira `JIRA_API_TOKEN` rule).

5. **Transports (optional)** — an adapter may reach its tracker more than one way (Jira has MCP and API), selected by an adapter-owned key. Multiple transports must be **behaviorally identical** — swapping the pen never changes what's drawn (`decisions/0011`).

## Invariants every adapter honors

- **One-way, except the checked pull.** Never writes status or answers into the repo. Content comes back only through `read-item` in `snapshot` mode, and only when it re-hashes to the draft that was written (`decisions/0083`).
- **Zero-dep for any shipped script.** A transport script talks to the service over plain `node`/`fetch`, no client library, no `npm install` (the `jira-rest.mjs` bar, `decisions/0011`).
- **Identity by tag, not summary text.**
- **No push without the dry-run + explicit confirm.**
- **Resilience:** each create/edit/transition/comment is independent (log-and-continue); the next run retries only what's missing via the find-existing lookup.
- **Graceful degradation:** if the tracker rejects a parent link or a field write, create the item without it and report it — label/tag identity still lets a later run backfill.
- **Never run from CI** — always human-validated.

## Adding a tracker (checklist)

1. Implement the primitive set, including `read-item` with a converter whose round trip keeps the intent's scope and proof hashes (`test/jira-rest.test.mjs` is the bar) — either an MCP, or a zero-dep engine script. A script primitive ships as a **template engine script** invoked **repo-relative** (`node launchpad/scripts/<tracker>-rest.mjs …`), exactly like Jira's `launchpad/scripts/jira-rest.mjs` — *not* co-located with the skill (mind the path-form rule: template scripts are repo-relative, co-located skill scripts use the vendored `.claude/skills/` \|\| `.agents/skills/` \|\| `${CLAUDE_PLUGIN_ROOT}` fallback).
2. Define the concept mapping + identity mechanism above.
3. Add the adapter's config block to `delivery/jira.config.example.json` (mark its keys like the Jira ones), keeping the file secret-free.
4. Add a `tracker: "<name>"` branch in `SKILL.md` that routes the flow's abstract ops to your primitives.
5. Document it here as a sibling to the Jira example.

No step changes the flow. If you find yourself editing the build-desired-state, identity, ledger, scope-hash, or confirm logic, stop — that's the skill's, not the adapter's.

## The Azure DevOps adapter

`tracker: "ado"`. Its config is the `ado` block of `delivery/jira.config.example.json`. It was tested on Azure DevOps Services. Azure DevOps Server may differ; it is untested.

### Primitive set

Two transports, picked by `ado.transport`: the Azure DevOps MCP (`@azure-devops/mcp`, signed in as you) or `launchpad/scripts/ado-rest.mjs` (REST, `ADO_PAT` or `ADO_TOKEN` from the environment). Both must draw the same projection (`decisions/0011`).

| Abstract op | MCP (`@azure-devops/mcp`, the tool that does it) | API (`node launchpad/scripts/ado-rest.mjs …`) |
|---|---|---|
| reachability probe | list the visible projects | `whoami`, then `projects` |
| discovery | read a work item type, once per configured type | `meta` |
| find-existing | a WIQL query with the tag query below (set its result limit: it defaults to 50), then a batch read of the matches | `find --tags …` |
| list-states | read the work item type (its `states`) | `states <id>` |
| create / edit | create the work item, then update it with raw ops for the description; link the parent (type `parent`), unlinking first to re-parent | `create-item`, `edit-item` |
| set-state | update `/fields/System.State` | `set-state <id> --category …` |
| comment | add a comment (`format: "Markdown"`), text from `md-encode` | `comment <id> --body …` |
| read-item | read the work item, description through `md-decode` | `read-item --tag <slug/INT-NNN>` |
| list-revisions | list the work item's revisions (paging through them); keep only title/description changes and drop the authors | `list-revisions <id>` |

**The format converter is `md-encode` / `md-decode`** (`ado-rest.mjs`, no auth). ADO stores markdown natively but sanitizes it as HTML on save: an unescaped `<slug>` is stripped as a tag, `< 5M` comes back as `&lt; 5M`, and `"` and astral characters (🚫) come back as entities. So every description and comment is escaped on write (`& < >`) and decoded once on read. That round trip keeps both intent hashes (`test/ado-rest.test.mjs` is the bar). On the MCP transport, don't pass `format: "Markdown"` in the create call's fields: the server escapes `<` and `>` but not `&`, so the text wouldn't decode back. Write the description with a raw update (the `/multilineFieldsFormat/System.Description` = `Markdown` op, then the `md-encode`d value), as `ado-rest.mjs` does.

A description that isn't in Markdown format (an item created before markdown support, or switched back to HTML) is reported as `format: "html"`, never passed off as markdown. Snapshot mode must not pull it: it can't be checked against the draft.

### Concept mapping

| Level | Work item type (`ado.work_item_types`) | Links to |
|---|---|---|
| epic | `Epic` | — |
| intent | `User Story` (Agile), `Product Backlog Item` (Scrum), `Issue` (Basic), `Requirement` (CMMI) | its Epic, as parent |
| open-question | `Task` | its intent, as parent |

- The Feature level is skipped. A story parented straight to an Epic shows nested under it on the Epics backlog.
- New teams have the Epics backlog level turned off (Team settings → Backlogs). Say so in setup, or the epics look missing.
- In Agile, `Issue` is an impediment type, not a story. Don't map intents to it.
- **Status:** `ado.status_map` maps each ledger token to a state **category** (`Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed`). The adapter sets the first state the type lists in that category, so one map fits Agile, Scrum, Basic, CMMI and customized processes. `{"state": "<name>"}` pins an exact state instead. ADO has no transitions API: the state is a field, set directly. The stock processes let any state follow any other; a customized process can add rules, and a rejected write is reported per item.
- **🚫 where the type has no `Removed` category** (Basic): add the `ado.tags.removed` tag and a comment, and report it as degraded.

### Identity mechanism

ADO tags, the same slug-qualified values as the Jira labels (`intent:<slug>/INT-001`, `epic:<slug>/E01`, `open-question:<slug>/Q-001`). Tags live in `System.Tags` as one `"a; b"` string. WIQL `[System.Tags] CONTAINS '<tag>'` matches a **whole tag**, case-insensitively, so `intent:acme/INT-001` never matches `intent:acme/INT-0012`. Batch the look-up as one OR query, scoped with `[System.TeamProject] = @project`. A tag can't contain `;`. Edits add and remove tags against the item's current set, so tags a person added by hand survive.

### Config keys

`ado.transport`, `ado.org_url`, `ado.project`, `ado.area_path` (optional; a team only sees items under its own area paths), `ado.work_item_types`, `ado.status_map`, `ado.fields` (optional custom-field reference names, such as `Custom.ScopeHash`), `ado.tags`. No credentials. The PAT needs only **Work Items: Read & write** and **Project and Team: Read**.

### ADO behaviors the adapter relies on

- **Concurrency:** an edit can lead with `{op: "test", path: "/rev", value: N}`. If the item changed since revision N, ADO rejects the whole edit with HTTP 412 (`VS403351`). Every field change and every comment bumps `rev`; a link-only change (a re-parent) doesn't.
- **Auth failures redirect.** A bad or expired PAT gets a 302 to the sign-in page (or a 203 with HTML), not a 401. `ado-rest.mjs` refuses redirects and reports them as an auth failure. An MCP or script that follows redirects would read a sign-in page as success.
- **Revisions:** `list-revisions` reports when the title or description changed, never who changed it. Its output can land in the repo.
