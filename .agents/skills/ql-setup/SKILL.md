---
name: ql-setup
disable-model-invocation: true
description: Set up (or re-sync) this AI-native delivery engagement workspace — installs the toolchain and wires up `.mcp.json`. Run on first clone or any time tooling drifts.
produces: >-
  `.mcp.json` (the Atlassian MCP server, plus Azure DevOps on an ADO engagement), and — when opencode is present — a committed `opencode.json` `mcp` block with the same servers in opencode's format; plus the installed toolchain (sf CLI and the build toolkits the repo profile picked) and `sfdx-project.json` if it was missing. No engagement content — that's /ql-ingest-scopezilla.
---

# Setup — AI-native delivery engagement workspace

You are setting up an AI-native delivery engagement workspace. This is the very first thing a consultant runs after cloning the repo. This skill is the single bootstrap entry point — it runs the installs itself in Step 1, so the user never runs `node launchpad/scripts/setup.mjs` separately (that would double-install).

## Prereq

**Node ≥ 22.20.** If `node --version` is missing or older, point the user at https://nodejs.org or `nvm install 22`. Don't try to install Node yourself.

## Step 1 — Run the setup script

```bash
node launchpad/scripts/setup.mjs
```

That handles the stable installs in one go:
- `@salesforce/cli` (npm global)
- the build toolkits in the repo profile's `toolkits` (`.launchpad/repo.json`): Pi with sf-pi, and forcedotcom/sf-skills per agent. On Claude Code that's the `salesforce-development` plugin from the `salesforce` marketplace, turned on for this repo only, with its auto-update turned on; the other agents setup finds on the machine get the skills globally. Each brings its own Salesforce skills, so none land in the repo. Pass on the follow-ups setup prints, including a `.gitignore` line to commit. The repo profile's `sf_skills` says which Claude Code gets: `plugin` (the default) or `skills` (plain global skills, in every folder). A builder who wants the other on their machine runs `node launchpad/scripts/setup.mjs --sf-skills plugin|skills`, and setup remembers it.
- the `ql-*` skills, only when the profile sets `commit_skills: false` and the quantum-leap-launchpad plugin isn't installed here (the plugin already serves them; `--harness other` installs them anyway, for a second harness on this machine)

Stream the output. If it fails, the most common cause is a stale npm cache or Node too old. Every step is safe to re-run. The script lives in `launchpad/`, so nothing touches the project's own `package.json`.

## Step 1b — Make the launchpad skills available to your agent

**First, check the repo profile, `.launchpad/repo.json`.** If it sets `commit_skills: false` (`decisions/0072`), the skills are **not** in the repo: they're gitignored, and either the quantum-leap-launchpad plugin serves them (Claude Code, SEAP) or `node launchpad/scripts/setup.mjs` (Step 1) just installed them for this machine. Confirm the skills load (a `ql-*` dir in `.claude/skills/` or `.agents/skills/`, or the plugin in `/plugin`), tell the user re-running `node launchpad/scripts/setup.mjs` is how they refresh, and **skip the rest of this step and Step 1d** (the Windows symlink repair only fixes committed links). Otherwise, the default:

This engagement's operating skills (the `ql-*` set — `/ql-ingest-scopezilla`, `/ql-check-scope`, `/ql-start-intent`, …) are **vendored into the repo** (into your harness's skills dir — `.claude/skills/` for Claude Code, `.agents/skills/` for other harnesses), so they work in **any** harness on clone (see the plugin's `decisions/0012`). How each agent picks them up, and how they stay current:

- **Claude Code** — the vendored skills load as project skills automatically. Salesforce team members should also install the `quantum-leap-launchpad` **plugin** (it adds a once-a-day nudge when the vendored skills fall behind upstream, plus `/ql-init-engagement` and `/ql-resync`):

  ```
  /plugin marketplace add https://git.soma.salesforce.com/dgerow/quantum-leap-launchpad.git
  /plugin install quantum-leap-launchpad@quantum-leap-launchpad
  ```

- **opencode, Cursor, Codex, Copilot, or any other agent** — the skills are already in the repo; nothing to install. These harnesses read their skills from `.agents/skills/` (opencode also reads `AGENTS.md` for the build conventions directly). If your agent keeps its skills in its own directory and the repo's copy isn't picked up, fan them into every detected harness dir with:

  ```bash
  npx -y skills@1.5.25 add . --yes    # re-vendors from the repo into each agent's skills dir
  ```

  **Joining on a non-Claude harness (e.g. opencode):** clone the engagement repo, then run `/ql-setup` — the vendored skills + `AGENTS.md` conventions are already present, and Step 1c below installs the opencode telemetry plugin. Note: **scaffolding a *new* engagement (`/ql-init-engagement`) and pulling committed-content updates (`/ql-resync`) run in Claude Code** (they read the plugin's templates), so a team with no Claude user does those steps another way (a teammate on Claude, or by hand: `npx skills add` plus the matching `launchpad/scripts/` from the plugin repo, together). Day-to-day build/validate/report skills run in any harness.

**Keeping them current:** `/ql-resync` (Claude Code, with the plugin) refreshes them together with the engine scripts they call, and teammates on any harness pick that up with `git pull`. Nothing auto-applies; the merge/commit is the gate.

## Step 1c — Install the opencode telemetry plugin (only if opencode is present)

Claude Code users get usage telemetry from the installed plugin's hooks. **opencode has no plugin-marketplace equivalent**, so if the user builds with **opencode** we install its telemetry sibling per-machine (mirroring the Claude posture — telemetry lives on the machine, never committed into the customer repo). See `decisions/0028`. Skip this entirely if opencode isn't installed.

```bash
command -v opencode >/dev/null 2>&1 || { echo "opencode not installed — skipping its telemetry plugin"; }
```

If opencode **is** present, install it from the Launchpad plugin, never from this repo: the plugin checkout if you have one, otherwise a shallow clone of the plugin source. It lands in opencode's per-machine plugin dir, outside the repo:

```bash
if command -v opencode >/dev/null 2>&1; then
  SRC=""
  for c in "${CLAUDE_PLUGIN_ROOT}/hooks/opencode" "$HOME/.claude/plugins/marketplaces/quantum-leap-launchpad/plugins/quantum-leap-launchpad/hooks/opencode"; do
    [ -f "$c/launchpad-telemetry.js" ] && { SRC="$c"; break; }
  done
  if [ -z "$SRC" ]; then
    TMP=$(mktemp -d)
    git clone -q --depth 1 --filter=blob:none --sparse https://git.soma.salesforce.com/dgerow/quantum-leap-launchpad.git "$TMP" \
      && git -C "$TMP" sparse-checkout set plugins/quantum-leap-launchpad/hooks/opencode \
      && SRC="$TMP/plugins/quantum-leap-launchpad/hooks/opencode"
  fi
  if [ -n "$SRC" ]; then
    DEST="$HOME/.config/opencode/plugin"; mkdir -p "$DEST"
    cp "$SRC/launchpad-telemetry.js" "$DEST/"
    [ -f "$SRC/.tracking-config.json" ] && cp "$SRC/.tracking-config.json" "$DEST/"
    echo "Installed opencode telemetry plugin → $DEST (re-run /ql-setup to refresh)"
  else
    echo "Couldn't reach the Launchpad plugin source — skipping opencode telemetry"
  fi
fi
```

Never block setup on this. To **opt out** of the network posts while keeping the local usage log, set `LAUNCHPAD_TELEMETRY_ENDPOINT=""`. Re-running `/ql-setup` on a new machine (or after an update) refreshes it.

## Step 1d — Windows: make vendored-skill symlinks resolve

The vendored skills are stored as **symlinks** (one canonical copy at `.agents/skills/<name>/`, each harness dir linked to it — git tracks them as mode-120000 objects). That model is deliberate (no duplication, clean update diffs), but **on Windows `git clone` writes each symlink as a one-line text file** unless the machine can create symlinks — so Claude Code finds a file where it expects a skill directory and the skill never loads (it won't auto-trigger; you'd have to point at it by name). This is a known limitation of the `skills` CLI on Windows-committed repos ([vercel-labs/skills#1199](https://github.com/vercel-labs/skills/issues/1199)), not something the repo can fix by itself.

**On Windows, one-time prerequisite:** enable **Developer Mode** (Settings → Privacy & security → For developers → *Developer Mode*) — this grants symlink-creation rights **without admin** on Win10 1703+. Then set the global default so every future clone materializes links correctly:

```bash
git config --global core.symlinks true
```

**Then repair any skill links this repo already checked out as files** — surgical and safe (it only re-materializes paths git *itself* tracks as symlinks; skills you added by hand are never touched, and it never deletes a directory):

```bash
node launchpad/scripts/fix-skill-symlinks.mjs          # repairs in place, sets core.symlinks=true on the repo
# node launchpad/scripts/fix-skill-symlinks.mjs --check  # report-only (exit 1 if any are still broken)
```

Run it on every harness (macOS/Linux no-op cleanly — links already resolve). If it reports paths it *couldn't* fix, the machine still can't create symlinks (Developer Mode off, or a locked-down/MDM-managed box) — enable Developer Mode and re-run, or re-clone with `git clone -c core.symlinks=true <url>`. **Windows users should take skill updates via `git pull` of a resync run on macOS, Linux or WSL, not a local `npx skills`** — that avoids the CLI's other open Windows bugs.

## Step 2 — Wire up the MCP servers

`.mcp.json` carries the **Atlassian** server (for `/ql-sync-jira` reporting), plus **Azure DevOps** when the engagement tracks there (2b) and any an add-on wrote. **Salesforce Docs** (doc grounding) needs an auth token, so it never goes in the repo (2c). Org work (deploy, retrieve, query, tests) comes from the build toolkit's skills and the `sf` CLI, not an MCP server.

If `.mcp.json` already exists, merge server by server: add or update the ones this step owns and leave every other server in place, including any an add-on wrote (`add_ons` in `.launchpad/repo.json`, e.g. `salesforce-docs-labs`). Say you're keeping them; don't ask. Ask before overwriting a server this step owns that differs from what it would write.

### 2a — Retire the Salesforce DX server

`@salesforce/mcp` reaches end of life on 2026-11-02 (archived, npm package deprecated), so setup no longer writes it (decisions/0086). If `.mcp.json` or `opencode.json` still has a server running `@salesforce/mcp` (usually `Salesforce DX` or `salesforce-dx`), say it's retired and ask before removing that one entry; keep every other server. If they'd rather keep it, leave it: it keeps working until it doesn't.

### 2b — Atlassian (Jira reporting)

`/ql-sync-jira` projects scope + delivery status into Jira, and it can reach Jira **two ways** (see decisions/0011) — **which one depends on the customer's tenant policy**, so this step figures out which is available and records it. Some enterprise tenants block third-party MCP OAuth apps but allow create-your-own API tokens; others are the reverse. Don't assume MCP.

**Always ship the MCP server block** (it's inert until used) — in `.mcp.json`:

```json
"atlassian": { "type": "http", "url": "https://mcp.atlassian.com/v1/mcp" }
```

- Use the streamable-HTTP endpoint `https://mcp.atlassian.com/v1/mcp` (`type: "http"`). **Not** the older `…/v1/sse` endpoint — Atlassian deprecated SSE (sunset 30 June 2026). No `mcp-remote` npx shim is needed; Claude Code does remote OAuth natively.
- Auth is a one-time **browser OAuth** on first use (`/mcp` → Atlassian login), not an API token.

**Then figure out the transport** so `/ql-sync-jira` fails fast at config time, not at push time. Ask the user (or, if they already know their tenant blocks third-party OAuth apps, skip straight to API):

- **MCP available** (the common, default case) → nothing more to configure here; the OAuth happens on first `/ql-sync-jira`. The transport stays the default `"mcp"`.
- **MCP blocked, API token allowed** → the projection runs over `launchpad/scripts/jira-rest.mjs` (Jira Cloud REST v3, zero-dep). It needs, at `/ql-sync-jira` time:
  - env vars `JIRA_EMAIL` + `JIRA_API_TOKEN` (a token from id.atlassian.com/manage-profile/security/api-tokens) — **never committed**; tell the user to export them (or add to a local, gitignored env file).
  - `base_url` (the customer's `…atlassian.net`) and `transport: "api"` in `delivery/jira.config.json` — non-secret, committed. `/ql-sync-jira` creates that config on first run; you can pre-seed `transport`/`base_url` now from `delivery/jira.config.example.json` so the choice is recorded.

Recording the transport now is the point: `/ql-sync-jira` reads it and confirms the right prerequisite up front, instead of dying mid-push when the MCP won't connect. A complete `.mcp.json` has these servers under `mcpServers` regardless of transport: `atlassian` (the block above), plus `azure-devops` when the engagement tracks in Azure DevOps (below).

**Azure DevOps Boards instead of Jira.** Ask which tracker the engagement uses. If it's Azure DevOps, `/ql-sync-jira` runs its ADO adapter (`tracker: "ado"`, the `ado` block of `delivery/jira.config.example.json`). Ask for the org URL and the project, then figure out the transport the same way:

- **MCP** (the default; Azure DevOps Services only) → add the server to `.mcp.json`, with the org name from the URL. An org name is not a secret:

  ```json
  "azure-devops": { "command": "npx", "args": ["-y", "@azure-devops/mcp", "<org>"] }
  ```

  It opens a browser sign-in on first use. If that's blocked, `"--authentication", "azcli"` at the end of `args` makes it use the user's `az login` instead.
- **API** (the MCP is blocked, or the org is on Azure DevOps Server, which is untested and may differ) → `launchpad/scripts/ado-rest.mjs` (ADO REST, zero-dep). At `/ql-sync-jira` time it needs `ADO_PAT` (scopes **Work Items: Read & write** and **Project and Team: Read**) or `ADO_TOKEN` in the environment, **never committed**.

Either way, pre-seed `tracker: "ado"` and the `ado` block's `transport`, `org_url` and `project` in `delivery/jira.config.json`. The `atlassian` block stays; it's inert.

### 2c — Salesforce Docs (doc grounding): not in the repo

The build loop grounds platform decisions in official Salesforce docs (`/ql-design-intent` Step 3, the build-conventions persona in `AGENTS.md`) through the **`salesforce-docs`** MCP, the official docs server at `https://mcp.docs.salesforce.com/` (Salesforce, MuleSoft, and Tableau docs). It exposes `list` (the doc collections), `list-landmarks` (a collection's `+guides:` product slugs), `search` (ranked results over **one** collection), `fetch` (a full doc body by `id` or `url`), and `answer`/`explain` (grounded synthesis for non-agentic callers; an agent uses `search`+`fetch`).

The server requires an auth token, and a token never goes in a committed file. So **don't write it into `.mcp.json` or `opencode.json`.** Where it comes from instead:

- **Claude Code with the Launchpad plugin:** the plugin carries the server with its token. Nothing to configure. It shows up as `plugin:quantum-leap-launchpad:salesforce-docs`.
- **Anything else** (no plugin, opencode, Cursor, Codex), **if you have a token for it:** export it as `SALESFORCE_DOCS_MCP_TOKEN` and add the server at **user scope**, never in a committed file. For example, with the variable set, `claude mcp add --scope user --transport http salesforce-docs https://mcp.docs.salesforce.com/ --header "Authorization: Bearer $SALESFORCE_DOCS_MCP_TOKEN"` (it stores the current value, so re-run it after a token rotation), or opencode's global `~/.config/opencode/opencode.json` with `"headers": { "Authorization": "Bearer {env:SALESFORCE_DOCS_MCP_TOKEN}" }`. The URL's trailing slash is required.
- **No token:** the repo can commit a public docs server that needs none: the `salesforce-docs-labs` add-on (decisions/0081), which a plugin user adds with `/ql-resync` ("show me all add-ons"). Without the plugin, add it by hand under that name: `{ "type": "http", "url": "https://salesforce-docs-76258744c9d7.herokuapp.com/api/mcp" }`. If the repo already has it, there's nothing to do here. Without either, the skills fall back to the public doc sites, so a missing server never blocks the work (decisions/0016).
- **Tenant blocks outbound to `mcp.docs.salesforce.com`:** doc queries carry search text only, no customer data or org context. If policy still blocks it, disable the server in `/mcp`; the same public-docs fallback applies.

**Removing an entry an older setup wrote.** Earlier versions of this step committed a `salesforce-docs` entry with no auth header. It now fails with a 403, and in Claude Code it also overrides the plugin's working server. In `.mcp.json`, and in a committed `opencode.json` whether or not opencode is installed here (a teammate depends on it), remove a `salesforce-docs` server only when it **exactly matches one we shipped**: url `https://mcp.docs.salesforce.com/` or `https://salesforce-docs-76258744c9d7.herokuapp.com/api/mcp`, and no keys besides `type`, `url`, and opencode's `enabled`. Leave every other server and key untouched. An entry with anything more (an auth header, env, a changed type) is the user's; keep it and tell them. A header-less entry under another name, or at user/local scope (`claude mcp list`), is also the user's: tell them it overrides the plugin's server and how to remove it, but don't edit it. Name the removal in the summary so it gets committed, and for a teammate on opencode, point them at the user-scope option above.

### 2d — opencode's MCP config (only if opencode is present)

**opencode does not read `.mcp.json`** — it reads an `mcp` block in a repo-root **`opencode.json`**. So an opencode builder needs the same servers in opencode's format, or they get no Atlassian MCP (the docs server is per-user, 2c). Mirror the committed-`.mcp.json` posture exactly: MCP config is shared project tooling (stable URLs, no secrets), so it's **committed**, not per-machine — the opposite of the opencode *telemetry* plugin (Step 1c, per-machine), which stays out of the repo for machine-path/deliverable reasons that don't apply here. See decisions/0029.

**Gate on `command -v opencode`** (same as Step 1c). Skip entirely if opencode isn't installed — a Claude-only pod that later adds an opencode user gets this when *they* run `/ql-setup`.

Write (or **merge** — never clobber; preserve any existing provider/model/mcp keys, same diff-before-overwrite rule as `.mcp.json`) `opencode.json` at repo root with the **same servers**, translated to opencode's format. When you create `opencode.json`, also carry over every other server already in `.mcp.json` (an add-on's, like `salesforce-docs-labs`, or the team's own), translated the same way, so an opencode builder gets the same set. **The format differs from `.mcp.json` in three ways** (verified live against opencode 1.18.4, decisions/0029):

- Top-level key is **`mcp`**, not `mcpServers`.
- Remote (HTTP) servers use **`"type": "remote"`** — *not* Claude's `"type": "http"`. opencode auto-detects OAuth on remote servers.
- Local (stdio) servers use **`"type": "local"`** with a **single `command` array** (`[cmd, ...args]`) — *not* Claude's split `command` + `args`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "atlassian": { "type": "remote", "url": "https://mcp.atlassian.com/v1/mcp", "enabled": true }
  }
}
```

The `atlassian` block is the stable shared endpoint from 2b. An `azure-devops` server from 2b becomes `{ "type": "local", "command": ["npx", "-y", "@azure-devops/mcp", "<org>"], "enabled": true }`. Same graceful-degradation applies: `/ql-sync-jira` has the API-token REST transport (2b, decisions/0011) if the customer's tenant blocks the Atlassian MCP OAuth app.

## Step 3 — Generate the SFDX project (if missing)

If `sfdx-project.json` is absent, run `sf project generate --name . --manifest`. Otherwise skip.

## Step 4 — Verify the MCP servers load

Writing `.mcp.json` is not the same as the servers running. Two things bite people:

1. **They only load after a restart.** Claude Code reads MCP config at startup, so a `.mcp.json` written during this session won't be active until Claude Code is restarted. There's no hot-reload (`/mcp` shows status and handles auth, but doesn't reload config).
2. **You approve the project servers once.** On restart, Claude Code prompts to trust the project MCP servers declared in `.mcp.json` — tell the user to accept it. (The shipped `.claude/settings.json` deliberately does *not* auto-trust every project MCP server, so this one-time prompt is expected and healthy — it's the gate on a repo's `.mcp.json`.)

After the restart, `claude mcp list` should show them. A cold first `npx` start can exceed the connect window: in Claude Code, set `MCP_TIMEOUT` (milliseconds, e.g. `"MCP_TIMEOUT": "60000"` under `env` in `.claude/settings.local.json`) and restart; other harnesses have their own MCP startup-timeout setting.

The `atlassian` server won't have authenticated yet — its tools stay gated until the user completes the one-time browser OAuth via `/mcp` (Atlassian login). That OAuth only matters before the first `/ql-sync-jira`; if this engagement doesn't report through Jira, it can be skipped entirely. An `azure-devops` server shows connected once `npx` has fetched it; it signs in on its first tool call.

**If you wrote `opencode.json` (Step 2d),** the opencode analog of `claude mcp list` is `opencode mcp list` — it reports status without a running TUI. Expect: `atlassian` ⚠ needs authentication (run `opencode mcp auth atlassian` for the one-time OAuth, the analog of Claude's `/mcp`).

**On any other harness (Cursor, Codex, a customer's own agent):** it reads MCP config from its *own* location, not `.mcp.json`/`opencode.json`. Configure the same servers wherever that harness expects them, including any an add-on put in `.mcp.json` (plus `salesforce-docs` at user scope if you have a token, 2c), and verify with its own MCP list/status command — consult the harness's MCP docs for both (the repo doesn't scaffold non-Claude/opencode harnesses; the servers and OAuth model are the same, only the config location and verify command differ).

## Step 4b — Check GitHub Actions can run

A repo with Actions off has PRs with no checks at all, and that looks just like a green gate. If the repo has a GitHub remote and `gh` is signed in, probe once:

```bash
gh api 'repos/{owner}/{repo}/actions/permissions'
```

Point the user to "Prerequisite — enable GitHub Actions" in `.github/workflows/README.md` when either of these holds:

- `enabled` is `false`: no workflow will run, the trust chain included.
- `allowed_actions` is anything but `all`: the workflows run only if the allowlist includes the actions they use. If the call fails (no remote, not signed in, no admin rights to read the setting), say the check was skipped and point to the same section. It's a warning, never a block.

## Step 5 — Carry on with any pending setup steps

If `.launchpad/local.json` exists, it's this machine's record of what setup still owes the repo (written when the repo was seeded; `pending` is an ordered list, `scopezilla_source` an absolute path). Tooling is done, so drop `setup` from `pending` and write the file back. Then:

- **`ingest` pending, with a `scopezilla_source` that still exists** → tell the user the next command: "Type `/ql-ingest-scopezilla` to pull in the Scopezilla scope from `<source>` (it picks up that path)." It's user-invoked, so you can't start it yourself. It clears `ingest` when it finishes; until then it stays pending.
- **`ingest` pending but the source is gone** (moved, a different machine) → say so and ask for the new path, or leave it pending.
- **No file, or nothing pending** → nothing to do. A teammate joining an existing repo lands here: the profiles (`.launchpad/repo.json` and each `launchpad/engagements/<slug>/engagement.json`) are already committed and need nothing from them. When the repo has more than one open engagement, ask which one they're working in and write it to `local.json` as `active_engagement`; skills and the engine read it when no engagement is named (`decisions/0082`).

**Then the add-on follow-ups, for everyone.** The committed repo profile lists each add-on in `add_ons`; one with `configured: false` hasn't been set up yet, so a teammate on any machine sees it. For each, name its `follow_up` command ("The `<id>` add-on isn't set up yet: run `<follow_up>`"). That skill sets `configured: true` when it finishes. Until then the add-on does nothing and keeps CI green.

The MCP restart in Step 4 doesn't block this; ingest doesn't need the MCP servers.

## What NOT to do

- **Don't ask for engagement identity.** No prompts for client / project / sponsor / org alias. README and AGENTS.md ship with `(fill in)` placeholders edited by hand once those are real.
- **Don't preflight `sf` org auth.** The first command that needs an authorized org will surface its own prompt (`sf org login web --alias <alias>`). Setup is about tooling, not auth.

## After everything installs

Summarize for the user:

- Versions of `node`, `sf`, `pi` now installed.
- Whether the SFDX project was generated or already existed.
- The contents of `.mcp.json` (the `atlassian` server, plus `azure-devops` on an ADO engagement) — **and `opencode.json` if opencode was present** (the same servers, opencode format) — and any retired `Salesforce DX` (2a) or `salesforce-docs` (2c) entry you removed, so it gets committed — and the servers' status from `claude mcp list` (or `opencode mcp list`; or "restart Claude Code, then run `claude mcp list`" if they haven't loaded yet). Note that the `atlassian` server needs a one-time OAuth before `/ql-sync-jira` (`/mcp` in Claude Code, `opencode mcp auth atlassian` in opencode), and is optional if Jira reporting isn't used. On an Azure DevOps engagement, name the `azure-devops` server (or the `ADO_PAT` the API transport needs) and the pre-seeded `ado` config. Docs grounding comes from the plugin's `salesforce-docs` server (it should appear in `claude mcp list`), or from the user-scope setup in 2c on other harnesses; it's optional, and skills fall back to public docs without it.
- The GitHub Actions probe (Step 4b): OK, the warning, or skipped.
- **On Windows:** whether the vendored-skill symlink repair (Step 1d) ran clean, and — if any links couldn't be created — the Developer Mode prerequisite. (macOS/Linux: no-op, skip mentioning.)
- Next steps:
  1. **If the tracker's MCP server (`atlassian` or `azure-devops`) isn't ✅ yet, restart Claude Code and run `claude mcp list` to confirm** before the first `/ql-sync-jira`. Org work doesn't wait on it: that's the build toolkit and the `sf` CLI.
  2. Fill in the engagement-detail placeholders in `README.md` and `AGENTS.md` when known.
  3. If Step 5 left `ingest` pending, run `/ql-ingest-scopezilla` when ready (it picks up the recorded source). No Scopezilla? `/ql-capture-intent` turns notes or a transcript into intents.
  4. When ready to do dev work: `sf org login web --alias <alias>`.

## Maintenance note

`launchpad/scripts/setup.mjs` is the source of truth for the stable installs. Bump versions there (in the plugin's template; `/ql-resync` carries it to repos). The MCP step stays docs-driven on purpose — its config shape changes faster than the install commands do.
