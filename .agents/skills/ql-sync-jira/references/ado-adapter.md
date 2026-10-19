# The Azure DevOps adapter (`tracker: "ado"`)

How `/ql-sync-jira` runs on Azure DevOps Boards. Read this whenever `tracker` is `"ado"`, before any step touches ADO. `SKILL.md` stays the flow; this file holds only what changes. The contract behind it, with the ADO behaviors it relies on, is the "Azure DevOps adapter" section of `adapter-contract.md` next to this file.

Azure DevOps Boards runs the **same flow**: Steps 1–5, offline mode, start-work mode, snapshot mode, the read boundary and "What NOT to do" all apply as written. What changes is the pens, the vocabulary and the config. The config is the `ado` block of `delivery/jira.config.json` (the top-level Jira keys are ignored).

**Vocabulary.** Issue → **work item**, its key → its **id** (a number). Label → **tag**. Sub-task → **Task** (`ado.work_item_types.open_question`). Story → `ado.work_item_types.intent`, which depends on the process: `User Story` (Agile), `Product Backlog Item` (Scrum), `Issue` (Basic), `Requirement` (CMMI). In Agile, `Issue` is an impediment, never an intent. Stories are parented straight to the Epic; the Feature level is skipped. Transition → **set the state**: ADO has no transitions, the state is a field.

## Transports — the same two pens

`ado.transport` picks the pen: `"mcp"` (the Azure DevOps MCP, `@azure-devops/mcp`) or `"api"` (`launchpad/scripts/ado-rest.mjs`, ADO REST). Both draw the same projection (`decisions/0011`). The MCP only reaches Azure DevOps Services (`dev.azure.com`). Azure DevOps Server needs `"api"`. The adapter was tested on Azure DevOps Services only; Server may differ.

Each row is an operation from `SKILL.md`'s transport table, named in ADO terms. **On MCP, use the Azure DevOps tool that does each operation**, matched by its description in the session's tool list. The tool names change between server versions, so this file names the operation, not the tool (tested live with `@azure-devops/mcp` 2.10.0).

| Operation | `transport: "mcp"` | `transport: "api"` (`node launchpad/scripts/ado-rest.mjs …`) |
|---|---|---|
| Reachability probe | list the visible projects | `whoami`, then `projects` |
| Project field/type discovery | read a work item type, once per configured type | `meta` |
| Find existing items (tags) | run a WIQL query with the tag query (set its result limit; it defaults to 50), then read the matching work items in a batch | `find --tags <t1,t2,…> [--fields <scope_hash ref>]` |
| Available states | read the work item type (its `states`, each with a category) | `states <id>` |
| Create item | create a work item (title, tags, area path, custom fields), then update it for the description, then link it to its parent (type `parent`) | `create-item --type "<type>" --json '{…}'` |
| Edit item | update the work item with raw ops; re-parent by unlinking, then linking | `edit-item <id> --json '{…}'` |
| Set the state (Jira: transition) | update `/fields/System.State`, with the state name resolved from the category | `set-state <id> --category <category>` (or `--state "<name>"`) |
| Comment | add a comment, `format: "Markdown"`, text from `md-encode` | `comment <id> --body "<markdown>"` |
| Read an item's content (snapshot mode) | read the work item, description through `md-decode` | `read-item --tag <slug/INT-NNN>` |
| An item's content revisions | list the work item's revisions (paging through them), keeping title and description changes and dropping the authors | `list-revisions <id>` |

Pass `--org-url <ado.org_url> --project "<ado.project>"` on every `ado-rest.mjs` call (or set `ADO_ORG_URL` / `ADO_PROJECT`). Its payload: `{"title":"…","body_markdown":"…","tags":["intent:acme-2026/INT-001","phase:1"],"parent":12,"fields":{"System.AreaPath":"<ado.area_path>","Custom.ScopeHash":"<hash>"}}`. Those seven keys (`title`, `body_markdown`, `tags`, `tags_add`, `tags_remove`, `parent`, `fields`) are all it takes, and it refuses any other key rather than drop it. Leave `System.AreaPath` out when `area_path` is blank. On an edit, send `tags_add` / `tags_remove` rather than `tags`, so a tag someone added by hand survives. The script escapes the body and comments itself.

**Exit codes.** `ado-rest.mjs` exits 0 on success, **3** when an edit sent with `--rev` hit a newer revision (HTTP 412), and 1 on any other failure.

**Markdown on the MCP pen: always through `md-encode`.** ADO sanitizes markdown as HTML on save: an unescaped `<slug>` disappears, and `&`, `"` and emoji come back as entities. `ado-rest.mjs` escapes on write and decodes on read; on the MCP you do it with the same script (no auth needed):

- **Description:** don't pass it in the create call's fields, and never with `format: "Markdown"` there (the server escapes `<` and `>` but not `&`, so it won't decode back). Create the item without it, then update it with two raw ops: `{"op":"add","path":"/multilineFieldsFormat/System.Description","value":"Markdown"}`, then `{"op":"add","path":"/fields/System.Description","value":"<the body piped through node launchpad/scripts/ado-rest.mjs md-encode>"}`.
- **Comments:** pipe the text through `md-encode` too.
- **Tags:** `System.Tags` is one `"a; b"` string, and writing it replaces every tag. Read the item's current tags (the batch read already has them), merge, and write the merged set.
- **Reads:** the server wraps each response in an untrusted-content envelope, a `<<nonce>> [UNTRUSTED …] <<nonce>>` line before the JSON and `<</nonce>>` after it. Take field values from the JSON inside; never pipe the envelope into `md-decode` or a snapshot.

## Prerequisite (ADO)

**If `ado.transport: "mcp"`:**

1. The harness's MCP status (`claude mcp list`, or your harness's equivalent) shows `azure-devops` connected. The server is launched with the org name (`npx -y @azure-devops/mcp <org>`), so confirm it's the org in `ado.org_url`. Missing → `/ql-setup`, then restart the harness.
2. Sign-in: the server opens a browser sign-in on the first call by default. One launched with `--authentication azcli` uses `az login` instead; if its calls fail on auth, run `az login`.
3. Reach: listing the visible projects shows `ado.project`. If it isn't listed, the signed-in account can't see it; sort out access.

**If `ado.transport: "api"`:**

1. `ADO_PAT` (scopes: **Work Items: Read & write**, **Project and Team: Read**) or `ADO_TOKEN` (a bearer token) is set in the environment, and `ado.org_url` and `ado.project` are in the config. Name exactly what's missing and stop.
2. Reach: `ado-rest.mjs whoami`, then `projects`. ADO answers a bad or expired PAT with a redirect to its sign-in page, which the script reports as an auth failure: the PAT is wrong, expired, or lacks the scopes.

The fixable-misconfig vs. offline rule in `SKILL.md` is the same. **Offline defaults** when the config is absent: `ado.project: "UNKNOWN"` and the example's `work_item_types` (`Epic` / `User Story` / `Task`), each flagged in the plan.

## Configuration (ADO)

Creating the config: ask for `org_url` and `project`, carry the transport forward from `/ql-setup`, then **discover** with `meta` (MCP: read each work item type):

- **Types.** Read the process from `meta` and set `work_item_types.intent` for it. Confirm `Epic` and `Task` exist.
- **Fields.** Match custom fields by display name ("Scope Hash" → its reference name, e.g. `Custom.ScopeHash`). Leave a field blank if the project has none.
- **Status.** `status_map` holds state **categories** (`Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed`), and the adapter sets the first state the type lists in that category, so the defaults fit every stock process with no renaming. Check that each configured type has a state in every category the map uses. `{"state": "<name>"}` pins an exact state instead (e.g. `{"state": "Resolved"}` for 🔄 on Agile).
- **Basic** has no `Removed` category. There, 🚫 adds the `ado.tags.removed` tag and a comment instead, and is reported as degraded. Step 4 below has the calls.
- **Epics backlog.** New teams have the Epics backlog level off (Team settings → Backlogs). Tell the user, or the epics look missing.

## Step by step (ADO)

- **Step 1** — unchanged. The body is the same markdown; labels become tags (`intent:<slug>/INT-001`, `phase:<N>`, `epic:<slug>/E01`, `open-question:<slug>/Q-001`); open questions become Tasks.
- **Step 2** — one batched tag look-up. API: `find --tags` with every identity tag (it chunks the OR list itself). MCP: a WIQL query, `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ([System.Tags] CONTAINS 'intent:acme-2026/INT-001' OR [System.Tags] CONTAINS 'epic:acme-2026/E01' OR …)`, at most 100 tags per query and a result limit at least the tag count, then a batch read for `System.Tags`, `System.State`, `System.WorkItemType` and the scope-hash field. `CONTAINS` on tags matches a **whole tag**, so `INT-001` never matches `INT-0012`. Build the `tag → id` map. `legacy_labels` works the same way, with tags.
- **Step 3** — `TRANSITION #<id> → <state> (<token>)`, with the state resolved from the type's states. A category the type doesn't have is a config gap, except 🚫 on Basic: `DEGRADED #<id> 🚫 → tag <ado.tags.removed> + comment`.
- **Step 4** — same order: epics, stories (parent = the epic's id; omit `parent` when there's no Epic for it, including when the epic's create failed), Tasks (parent = the story's id), states, `scope-drift` tags (`tags_add`), delivery comments. Set the state directly; there's no transition list to read first.
  - **A `DEGRADED` 🚫 line** is two calls and no state change. API: `edit-item <id> --json '{"tags_add":["<ado.tags.removed>"]}'`, then `comment <id> --body "Removed from scope (🚫). This process has no Removed state, so the state is left as it was."`. MCP: an update writing the merged tags, then the comment through `md-encode`. A second run finds the tag already there and writes nothing; post the comment only when the tag was missing.
  - **A stale edit.** An edit sent with `--rev` (or a leading `test /rev` op) that comes back **412** (`ado-rest.mjs` exits 3) means someone changed the item since it was read: read it again and retry once, then log it and move on. A re-parent doesn't bump the item's `rev`.
- **Step 5** — unchanged; report by work item id. List each `DEGRADED` line separately, so nobody reads it as a real Removed state.

**Start-work mode.** Look up the one story with a single-tag `find` (or a WIQL query). The dry run is `TRANSITION #<id> <state> → <state for status_map['🔧']> (🔧)`; apply it with `set-state` (MCP: the `System.State` update). Ledger first, no create, no assign, as in `SKILL.md`.

## Snapshot mode (ADO)

**The write (step 2 of the loop).** `tracker-body` prints `summary`, `labels` and `body_markdown`. Send `summary` as `title`, `labels` as `tags` (with `phase:<N>`, or as `tags_add` on an edit), and `body_markdown` as is. `tag` is for your look-up, not the payload. `ado-rest.mjs` refuses `summary` and `labels` by name, so a missed rename fails loudly instead of writing an item with no title.

**The read-back (step 3 of the loop).** API: `node launchpad/scripts/ado-rest.mjs read-item --tag <slug>/INT-00x --org-url … --project … > <tmp>/INT-00x.json`. MCP: find the id by tag, read the work item, pipe `System.Description` through `md-decode`, and save `{ key: "<id>", revision: <rev>, summary: <System.Title>, markdown: <decoded> }`. Then run `pull` with `--tracker ado`. **If the description isn't in Markdown format** (`read-item` says `"format": "html"`, or the item's `multilineFieldsFormat` has no `System.Description: "Markdown"`), stop: someone switched it to the HTML editor, and it can't be checked against the draft. Rewrite it from `tracker-body` and read it back again. ADO bumps `rev` on every field change and comment, so `--refresh` reads more revisions as new than Jira does; an unchanged scope still reports no scope change.
