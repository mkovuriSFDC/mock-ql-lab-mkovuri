#!/usr/bin/env node
// Azure DevOps REST transport for /ql-sync-jira — the API pen for the ADO adapter
// (decisions/0046), the counterpart of jira-rest.mjs for Jira (decisions/0011).
// It draws the SAME one-way projection /ql-sync-jira builds, over the ADO Work
// Item Tracking REST API instead of the Azure DevOps MCP.
//
// ZERO DEPENDENCIES — plain node + global fetch, no client library, no npm install.
// Tested against Azure DevOps Services (https://dev.azure.com/<org>). Azure
// DevOps Server (https://<host>/<collection>) may differ; it is untested.
//
// AUTH — env only, NEVER committed (the config stays secret-free):
//   ADO_PAT       a personal access token (Work Items: Read & write, Project and
//                 Team: Read), sent as Basic auth with an empty user name
//   ADO_TOKEN     or a bearer token instead, e.g. from
//                 `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798`
//   ADO_ORG_URL   the org, e.g. https://dev.azure.com/acme (or pass --org-url;
//                 the skill reads it from the config's `org_url`)
//   ADO_PROJECT   the project name (or pass --project; the config's `project`)
//
// SUBCOMMANDS (each maps to an adapter-contract operation):
//   whoami                                     reachability probe (the signed-in identity)
//   projects                                   list visible projects
//   meta                                       the project's process, work item types,
//                                              their states (with category) and fields
//   find --tags a,b,c [--types T1,T2] [--fields f1,f2]
//                                              items carrying any of these exact tags
//   search --wiql "<WIQL>" [--fields f1,f2]    any WIQL query, items fetched in batches
//   states ID | --type "<type>"                the states an item (or type) can take
//   create-item --type "<type>" --json '{…}'   prints the new id
//   edit-item ID --json '{…}' [--rev N]        --rev fails the edit if someone else
//                                              changed the item since revision N
//   set-state ID --state "<name>" | --category <Proposed|InProgress|Resolved|Completed|Removed> [--rev N]
//   comment ID --body "<markdown>"
//   read-item ID | --tag <slug/INT-NNN>        the item's content as markdown + its revision
//                                              (snapshot/pointer modes, decisions/0083)
//   list-revisions ID                          when its title or description changed
//
// PAYLOAD for create-item / edit-item (--json, or on stdin):
//   { "title": "…", "body_markdown": "…", "tags": ["intent:acme/INT-001", "phase:1"],
//     "tags_add": […], "tags_remove": […], "parent": 12 | null,
//     "fields": { "Custom.ScopeHash": "…" } }
// `fields` takes raw field reference names. `tags` replaces the item's tags;
// `tags_add`/`tags_remove` edit them and keep any tag a person added by hand.
// Any other key is refused, so a misspelled or Jira-named key can't be dropped
// silently: `intent-ledger.mjs tracker-body`'s `summary` is the `title` here, and
// its `labels` are `tags`.
//
// BODY SHAPE — ADO long-text fields take markdown natively (the description is
// switched to Markdown format on write), so there is no ADF-style converter. ADO
// does sanitize it as HTML on save, though: an unescaped `<slug>` is stripped as a
// tag, and `"` and astral characters (🚫) come back as entities. So the body is
// escaped on write (& < >) and entity-decoded on read, and what the skill writes
// is what read-item gives back. `md-encode` / `md-decode` expose the same pair to
// the MCP transport (no auth needed):
//   md-encode   < markdown      the escaped text to send as a Markdown field
//   md-decode   < stored text   the markdown it stands for
//
// Every op prints JSON to stdout on success; errors go to stderr and exit non-zero
// so the skill can log-and-continue per operation. Exit 3 means the item changed
// since --rev (HTTP 412): read it again and retry. Any other failure exits 1.
// One op per invocation — the skill orchestrates the sequence.

import { argv, env, exit, stdin } from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'api-version=7.1';
const COMMENTS_API = 'api-version=7.1-preview.4';
const PARENT = 'System.LinkTypes.Hierarchy-Reverse';
const CATEGORIES = ['Proposed', 'InProgress', 'Resolved', 'Completed', 'Removed'];
const BATCH = 200; // workitemsbatch's limit per call
const PAYLOAD_KEYS = ['title', 'body_markdown', 'tags', 'tags_add', 'tags_remove', 'parent', 'fields'];
const STALE_EXIT = 3; // the item changed since --rev (HTTP 412)

// ---------------------------------------------------------------------------
// Arg parsing — dead simple: positional command, then --flag value pairs.
// ---------------------------------------------------------------------------
const [, , cmd, ...rest] = argv;
const flags = {};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true; // boolean flag
    } else {
      flags[key] = next;
      i++;
    }
  } else {
    positional.push(rest[i]);
  }
}

function die(msg, code = 1) {
  process.stderr.write(`ado-rest: ${msg}\n`);
  exit(code);
}

const flagValue = (name) => (flags[name] === undefined || flags[name] === true ? undefined : String(flags[name]));
const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

// ---------------------------------------------------------------------------
// Config from env (+ --org-url / --project overrides).
// ---------------------------------------------------------------------------
const PAT = env.ADO_PAT;
const TOKEN = env.ADO_TOKEN;
const ORG_URL = (flagValue('org-url') || env.ADO_ORG_URL || '').replace(/\/+$/, '');
const PROJECT = flagValue('project') || env.ADO_PROJECT || '';

function requireAuth() {
  const missing = [];
  if (!PAT && !TOKEN) missing.push('ADO_PAT or ADO_TOKEN');
  if (!ORG_URL) missing.push('ADO_ORG_URL (or --org-url)');
  if (missing.length) {
    die(
      `missing required env: ${missing.join(', ')}. ` +
        `Create a PAT under User settings → Personal access tokens (Work Items: Read & write, ` +
        `Project and Team: Read), export ADO_PAT, and set org_url in the config.`,
    );
  }
  // Never send credentials over a non-HTTPS URL (cleartext creds / downgrade).
  if (!/^https:\/\//i.test(ORG_URL)) {
    die(`org_url must be https:// (got "${ORG_URL}") — refusing to send credentials over a non-HTTPS connection.`);
  }
}

function requireProject(what) {
  if (!PROJECT) die(`${what} needs --project "<name>" (or ADO_PROJECT)`);
  return encodeURIComponent(PROJECT);
}

function requireId(what) {
  const id = positional[0];
  if (!id) die(`${what} needs a work item id`);
  if (!/^\d+$/.test(id)) die(`work item id must be a number (got "${id}")`);
  return Number(id);
}

/** --rev, checked before any request: a bare or non-numeric --rev would otherwise drop the concurrency check. */
function revFlag() {
  if (flags.rev === undefined) return undefined;
  const rev = flagValue('rev');
  if (rev === undefined || !/^\d+$/.test(rev)) die(`--rev must be a revision number (got ${rev === undefined ? 'nothing' : `"${rev}"`})`);
  return Number(rev);
}

const authHeader = () => (PAT ? 'Basic ' + Buffer.from(`:${PAT}`).toString('base64') : `Bearer ${TOKEN}`);

/**
 * ADO answers a bad or missing credential with a redirect to its sign-in page
 * (302, or 203 with an HTML body), not a 401. Following it would turn an auth
 * failure into a "successful" HTML page, so redirects are refused and named.
 */
function authFailure(status) {
  if (status === 203 || (status >= 300 && status < 400)) {
    return 'Azure DevOps redirected to its sign-in page: the PAT or token is invalid, expired, or has no access to this org';
  }
  if (status === 401) return 'the PAT or token was rejected (expired, revoked, or missing a scope)';
  return null;
}

/** One REST call. Returns {ok, status, body} where body is parsed JSON (or text). */
async function api(method, url, payload, contentType = 'application/json') {
  const headers = { Authorization: authHeader(), Accept: 'application/json' };
  const init = { method, headers, redirect: 'manual' };
  if (payload !== undefined) {
    headers['Content-Type'] = contentType;
    init.body = JSON.stringify(payload);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    return { ok: false, status: 0, body: `network error: ${e.message}` };
  }
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const auth = authFailure(res.status);
  if (auth) return { ok: false, status: res.status, body: auth };
  return { ok: res.ok, status: res.status, body };
}

/** Surface a REST error the way ADO reports it, then exit non-zero. */
function failFrom(res, what) {
  const detail = res.body && typeof res.body === 'object' ? res.body.message || JSON.stringify(res.body) : res.body;
  if (res.status === 412) die(`${what}: the item changed since the --rev you sent (HTTP 412). Read it again and retry.`, STALE_EXIT);
  die(`${what} failed (HTTP ${res.status}): ${detail || 'no detail'}`);
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function readStdin() {
  const chunks = [];
  for await (const c of stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests).
// ---------------------------------------------------------------------------
function parseTags(s) {
  return String(s || '').split(';').map((t) => t.trim()).filter(Boolean);
}

function checkTags(tags) {
  for (const t of tags) if (String(t).includes(';')) throw new Error(`tag "${t}" cannot contain ";" (ADO's tag separator)`);
  return tags;
}

/** Refuse a key the patch would otherwise drop without a word (tracker-body's `summary`, a typo). */
function checkPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('the payload must be a JSON object');
  const unknown = Object.keys(payload).filter((k) => !PAYLOAD_KEYS.includes(k));
  if (unknown.length) {
    throw new Error(`unknown payload key${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')} ` +
      `(allowed: ${PAYLOAD_KEYS.join(', ')}). From tracker-body, send summary as title and labels as tags.`);
  }
  for (const k of ['tags', 'tags_add', 'tags_remove']) {
    const v = payload[k];
    if (v !== undefined && (!Array.isArray(v) || v.some((t) => typeof t !== 'string'))) throw new Error(`"${k}" must be an array of strings`);
  }
  if (payload.parent !== undefined && payload.parent !== null && !/^\d+$/.test(String(payload.parent))) throw new Error(`"parent" must be a work item id (a number), or null`);
  if (payload.fields !== undefined && (!payload.fields || typeof payload.fields !== 'object' || Array.isArray(payload.fields))) throw new Error('"fields" must be an object');
  return payload;
}

const parentIdOf = (url) => Number(String(url).split('/').pop());

/**
 * The create/edit payload → an ADO JSON Patch document. `current` (edit only) is
 * the item as it stands: its tags (for tags_add/tags_remove) and relations (for
 * re-parenting). `rev` adds a leading test op so a stale edit fails with 412.
 */
function buildPatch(payload, { orgUrl, rev, current = {} } = {}) {
  checkPayload(payload);
  if (rev !== undefined && !/^\d+$/.test(String(rev))) throw new Error(`--rev must be a revision number (got "${rev}")`);
  const ops = [];
  if (rev !== undefined) ops.push({ op: 'test', path: '/rev', value: Number(rev) });
  if (payload.title !== undefined) ops.push({ op: 'add', path: '/fields/System.Title', value: payload.title });
  if (payload.body_markdown !== undefined) {
    // Switch the field to Markdown first, then write it, escaped so ADO keeps the text.
    ops.push({ op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' });
    ops.push({ op: 'add', path: '/fields/System.Description', value: encodeMarkdown(payload.body_markdown) });
  }
  let tags;
  if (payload.tags !== undefined) tags = checkTags([...payload.tags]);
  if (payload.tags_add !== undefined || payload.tags_remove !== undefined) {
    const drop = new Set((payload.tags_remove || []).map((t) => t.toLowerCase()));
    const base = (tags || current.tags || []).filter((t) => !drop.has(t.toLowerCase()));
    const have = new Set(base.map((t) => t.toLowerCase()));
    tags = base.concat(checkTags(payload.tags_add || []).filter((t) => !have.has(t.toLowerCase())));
    // Nothing to add or drop: leave System.Tags alone rather than rewrite it unchanged.
    if (payload.tags === undefined && tags.join('; ') === (current.tags || []).join('; ')) tags = undefined;
  }
  if (tags !== undefined) ops.push({ op: 'add', path: '/fields/System.Tags', value: tags.join('; ') });
  for (const [ref, value] of Object.entries(payload.fields || {})) ops.push({ op: 'add', path: `/fields/${ref}`, value });
  if (payload.parent !== undefined) {
    const rels = current.relations || [];
    const k = rels.findIndex((r) => r.rel === PARENT);
    const same = k >= 0 && payload.parent !== null && parentIdOf(rels[k].url) === Number(payload.parent);
    if (!same) {
      if (k >= 0) ops.push({ op: 'remove', path: `/relations/${k}` });
      if (payload.parent !== null) {
        ops.push({ op: 'add', path: '/relations/-', value: { rel: PARENT, url: `${orgUrl}/_apis/wit/workItems/${Number(payload.parent)}` } });
      }
    }
  }
  // A lone test op changes nothing; drop it so a no-op edit stays a no-op.
  return ops.length === 1 && ops[0].op === 'test' ? [] : ops;
}

const wiqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** WIQL finding items that carry any of these exact tags (ADO matches whole tags). */
function wiqlForTags(tags, { types = [] } = {}) {
  const any = tags.map((t) => `[System.Tags] CONTAINS ${wiqlString(t)}`).join(' OR ');
  const typeClause = types.length ? ` AND [System.WorkItemType] IN (${types.map(wiqlString).join(', ')})` : '';
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project${typeClause} AND (${any}) ORDER BY [System.Id]`;
}

/**
 * The state to set: an exact name, or the first state ADO lists in a category.
 * Categories are process-neutral, so one status map fits Agile, Scrum, Basic and
 * customized processes. Throws (naming what exists) when there's no match.
 */
function pickState(states, { state, category }) {
  const shown = () => states.map((s) => `${s.name} (${s.category})`).join(', ');
  if (state !== undefined) {
    const hit = states.find((s) => s.name.toLowerCase() === String(state).toLowerCase());
    if (!hit) throw new Error(`no state "${state}" for this work item type. Available: ${shown()}`);
    return hit.name;
  }
  const hit = states.find((s) => s.category.toLowerCase() === String(category).toLowerCase());
  if (!hit) throw new Error(`no state in category "${category}" for this work item type. Available: ${shown()}`);
  return hit.name;
}

/** Escape markdown for an ADO Markdown field, so its HTML sanitizer leaves the text alone. */
function encodeMarkdown(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Decode what ADO stored back to the markdown it stands for. One pass, so `&amp;lt;` becomes `&lt;`, not `<`. */
function decodeMarkdown(s) {
  return String(s).replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return NAMED[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n <= 0x10ffff ? String.fromCodePoint(n) : m;
  });
}

/** Revisions where the title or description changed. Who made them is left out on purpose: the output can land in the repo. */
function contentRevisions(revisions) {
  const out = [];
  let prev = {};
  for (const r of revisions) {
    const f = r.fields || {};
    const changed = [];
    if (f['System.Title'] !== prev['System.Title']) changed.push('summary');
    if (f['System.Description'] !== prev['System.Description']) changed.push('description');
    if (changed.length) out.push({ id: r.rev, at: f['System.ChangedDate'], fields: changed });
    prev = f;
  }
  return out;
}

/**
 * An ADO work item → read-item's output. The revision is the item's `rev`: every
 * field change bumps it (a comment too), so a stale check can't miss a content
 * edit. Link-only changes (a re-parent) don't bump it — they touch no content.
 * An HTML description is reported as such, never passed off as markdown.
 */
function itemFromApi(body, tag) {
  const f = body.fields || {};
  const desc = f['System.Description'];
  const fmt = (body.multilineFieldsFormat || {})['System.Description'];
  const isMarkdown = desc === undefined || desc === '' || String(fmt).toLowerCase() === 'markdown';
  const out = { key: String(body.id), id: body.id, tag, revision: body.rev, summary: f['System.Title'] || '', tags: parseTags(f['System.Tags']) };
  if (isMarkdown) Object.assign(out, { format: 'markdown', markdown: decodeMarkdown(String(desc ?? '').replace(/\r\n?/g, '\n')) });
  else Object.assign(out, { format: 'html', markdown: null, html: desc });
  if (tag === undefined) delete out.tag;
  return out;
}

/** Parse the --json payload (or stdin). */
async function itemPayload() {
  let raw = flags.json;
  if (raw === undefined || raw === true) raw = (await readStdin()).trim();
  if (!raw) die('expected a payload via --json \'{...}\' or on stdin');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return die(`--json is not valid JSON: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------
const projectUrl = (p) => `${ORG_URL}/${p}/_apis`;

async function getItem(p, id, what) {
  const res = await api('GET', `${projectUrl(p)}/wit/workitems/${id}?$expand=relations&${API}`);
  if (!res.ok) failFrom(res, what);
  return res.body;
}

async function typeStates(p, type, what) {
  const res = await api('GET', `${projectUrl(p)}/wit/workitemtypes/${encodeURIComponent(type)}?${API}`);
  if (!res.ok) failFrom(res, what);
  return (res.body.states || []).map((s) => ({ name: s.name, category: s.category }));
}

/** Run WIQL, then fetch the matching items in batches. */
async function queryItems(p, query, fields) {
  const res = await api('POST', `${projectUrl(p)}/wit/wiql?${API}`, { query });
  if (!res.ok) failFrom(res, 'query');
  // A WorkItemLinks query answers with workItemRelations instead; reading it as "no items" would hide every match.
  if (!Array.isArray(res.body && res.body.workItems)) die('the WIQL must be a flat query (SELECT … FROM WorkItems); a WorkItemLinks query is not supported');
  const ids = res.body.workItems.map((w) => w.id);
  const want = ['System.Id', 'System.WorkItemType', 'System.State', 'System.Title', 'System.Tags', 'System.Parent', ...fields];
  const out = [];
  for (let k = 0; k < ids.length; k += BATCH) {
    const batch = await api('POST', `${projectUrl(p)}/wit/workitemsbatch?${API}`, { ids: ids.slice(k, k + BATCH), fields: [...new Set(want)] });
    if (!batch.ok) failFrom(batch, 'query (fetch items)');
    for (const w of batch.body.value || []) {
      const f = w.fields || {};
      const extra = Object.fromEntries(fields.filter((x) => x in f).map((x) => [x, f[x]]));
      out.push({ id: w.id, rev: w.rev, type: f['System.WorkItemType'], state: f['System.State'], title: f['System.Title'],
        tags: parseTags(f['System.Tags']), parent: f['System.Parent'] ?? null, fields: extra });
    }
  }
  return out;
}

async function main() {
  switch (cmd) {
    case 'whoami': {
      requireAuth();
      const res = await api('GET', `${ORG_URL}/_apis/connectionData`);
      if (!res.ok) failFrom(res, 'whoami');
      const u = res.body.authenticatedUser || {};
      printJson({ id: u.id, name: u.providerDisplayName });
      break;
    }

    case 'projects': {
      requireAuth();
      const out = [];
      for (let skip = 0; ;) {
        const res = await api('GET', `${ORG_URL}/_apis/projects?$top=100&$skip=${skip}&${API}`);
        if (!res.ok) failFrom(res, 'projects');
        const page = res.body.value || [];
        for (const pr of page) out.push({ id: pr.id, name: pr.name });
        if (page.length < 100) break;
        skip += page.length;
      }
      printJson(out);
      break;
    }

    case 'meta': {
      requireAuth();
      const p = requireProject('meta');
      const proj = await api('GET', `${ORG_URL}/_apis/projects/${p}?includeCapabilities=true&${API}`);
      if (!proj.ok) failFrom(proj, 'meta (project)');
      const tpl = ((proj.body.capabilities || {}).processTemplate || {});
      const res = await api('GET', `${projectUrl(p)}/wit/workitemtypes?${API}`);
      if (!res.ok) failFrom(res, 'meta (types)');
      const types = (res.body.value || []).filter((t) => !t.isDisabled).map((t) => ({
        name: t.name,
        states: (t.states || []).map((s) => ({ name: s.name, category: s.category })),
        fields: (t.fields || []).map((f) => ({ referenceName: f.referenceName, name: f.name })),
      }));
      printJson({ project: proj.body.name, process: tpl.templateName || null, types });
      break;
    }

    case 'find': {
      requireAuth();
      const p = requireProject('find');
      const tags = list(flagValue('tags'));
      if (!tags.length) die('find needs --tags a,b,c');
      // Chunk the OR list so a large engagement stays well under WIQL's query-length limit.
      const out = [];
      for (let k = 0; k < tags.length; k += 100) {
        out.push(...await queryItems(p, wiqlForTags(tags.slice(k, k + 100), { types: list(flagValue('types')) }), list(flagValue('fields'))));
      }
      printJson([...new Map(out.map((w) => [w.id, w])).values()]);
      break;
    }

    case 'search': {
      requireAuth();
      const p = requireProject('search');
      const wiql = flagValue('wiql');
      if (!wiql) die('search needs --wiql "<WIQL>"');
      printJson(await queryItems(p, wiql, list(flagValue('fields'))));
      break;
    }

    case 'states': {
      requireAuth();
      const p = requireProject('states');
      let type = flagValue('type');
      if (!type) type = (await getItem(p, requireId('states'), 'states')).fields['System.WorkItemType'];
      printJson(await typeStates(p, type, 'states'));
      break;
    }

    case 'create-item': {
      requireAuth();
      const p = requireProject('create-item');
      const type = flagValue('type');
      if (!type) die('create-item needs --type "<work item type>"');
      let ops;
      try { ops = buildPatch(await itemPayload(), { orgUrl: ORG_URL }); } catch (e) { die(e.message); }
      const res = await api('POST', `${projectUrl(p)}/wit/workitems/$${encodeURIComponent(type)}?${API}`, ops, 'application/json-patch+json');
      if (!res.ok) failFrom(res, 'create-item');
      printJson({ id: res.body.id, rev: res.body.rev });
      break;
    }

    case 'edit-item': {
      requireAuth();
      const p = requireProject('edit-item');
      const id = requireId('edit-item');
      const rev = revFlag();
      const payload = await itemPayload();
      try { checkPayload(payload); } catch (e) { die(e.message); }
      const needsCurrent = payload.parent !== undefined || payload.tags_add !== undefined || payload.tags_remove !== undefined;
      let current = {};
      if (needsCurrent) {
        const item = await getItem(p, id, 'edit-item (read)');
        current = { tags: parseTags(item.fields['System.Tags']), relations: item.relations || [] };
      }
      let ops;
      try { ops = buildPatch(payload, { orgUrl: ORG_URL, rev, current }); } catch (e) { die(e.message); }
      if (!ops.length) { printJson({ id, updated: false }); break; }
      const res = await api('PATCH', `${projectUrl(p)}/wit/workitems/${id}?${API}`, ops, 'application/json-patch+json');
      if (!res.ok) failFrom(res, 'edit-item');
      printJson({ id, rev: res.body.rev, updated: true });
      break;
    }

    case 'set-state': {
      requireAuth();
      const p = requireProject('set-state');
      const state = flagValue('state');
      const category = flagValue('category');
      if (!state && !category) die('set-state needs --state "<name>" or --category <' + CATEGORIES.join('|') + '>');
      if (category && !CATEGORIES.some((c) => c.toLowerCase() === category.toLowerCase())) {
        die(`unknown state category "${category}" (one of ${CATEGORIES.join(', ')})`);
      }
      const id = requireId('set-state');
      const rev = revFlag();
      const item = await getItem(p, id, 'set-state (read)');
      const type = item.fields['System.WorkItemType'];
      let target;
      try { target = pickState(await typeStates(p, type, 'set-state (states)'), { state, category }); } catch (e) { die(`${type} ${id}: ${e.message}`); }
      if (item.fields['System.State'] === target) { printJson({ id, state: target, changed: false }); break; }
      // ADO has no transitions API: the state is a field, set directly.
      const ops = buildPatch({ fields: { 'System.State': target } }, { orgUrl: ORG_URL, rev });
      const res = await api('PATCH', `${projectUrl(p)}/wit/workitems/${id}?${API}`, ops, 'application/json-patch+json');
      if (!res.ok) failFrom(res, 'set-state');
      printJson({ id, state: target, rev: res.body.rev, changed: true });
      break;
    }

    case 'comment': {
      requireAuth();
      const p = requireProject('comment');
      const body = flagValue('body');
      if (!positional[0] || body === undefined) die('comment needs a work item id and --body "<markdown>"');
      const id = requireId('comment');
      const res = await api('POST', `${projectUrl(p)}/wit/workItems/${id}/comments?format=markdown&${COMMENTS_API}`, { text: encodeMarkdown(body) });
      if (!res.ok) failFrom(res, 'comment');
      printJson({ id, commented: true, commentId: res.body.id });
      break;
    }

    case 'read-item': {
      requireAuth();
      const p = requireProject('read-item');
      const tag = flagValue('tag');
      if (!positional[0] && !tag) die('read-item needs a work item id or --tag <slug/INT-NNN>');
      let id;
      if (positional[0]) id = requireId('read-item');
      else {
        const found = await queryItems(p, wiqlForTags([`intent:${tag}`]), []);
        if (found.length !== 1) {
          die(found.length ? `more than one item is tagged intent:${tag} (${found.map((w) => w.id).join(', ')}); fix the tags in ADO` : `no item is tagged intent:${tag}`);
        }
        id = found[0].id;
      }
      const res = await api('GET', `${projectUrl(p)}/wit/workitems/${id}?${API}`);
      if (!res.ok) failFrom(res, 'read-item');
      printJson(itemFromApi(res.body, tag));
      break;
    }

    case 'list-revisions': {
      requireAuth();
      const p = requireProject('list-revisions');
      const id = requireId('list-revisions');
      const revs = [];
      for (let skip = 0; ;) {
        const res = await api('GET', `${projectUrl(p)}/wit/workitems/${id}/revisions?$top=200&$skip=${skip}&${API}`);
        if (!res.ok) failFrom(res, 'list-revisions');
        const page = res.body.value || [];
        revs.push(...page);
        if (page.length < 200) break;
        skip += page.length;
      }
      printJson(contentRevisions(revs));
      break;
    }

    case 'md-encode':
      process.stdout.write(encodeMarkdown(await readStdin()));
      break;

    case 'md-decode':
      process.stdout.write(decodeMarkdown(await readStdin()));
      break;

    case undefined:
    case 'help':
    case '--help':
      process.stdout.write(
        'ado-rest — Azure DevOps REST transport for /ql-sync-jira (see decisions/0046)\n\n' +
          'Commands: whoami | projects | meta | find --tags a,b [--types T] [--fields f] |\n' +
          '          search --wiql "…" [--fields f] | states ID|--type T |\n' +
          '          create-item --type T --json \'{…}\' | edit-item ID --json \'{…}\' [--rev N] |\n' +
          '          set-state ID --state "…"|--category C [--rev N] | comment ID --body "…" |\n' +
          '          read-item ID|--tag <slug/INT-NNN> | list-revisions ID |\n' +
          '          md-encode | md-decode   (stdin → stdout, no auth)\n\n' +
          'Auth (env): ADO_PAT or ADO_TOKEN, ADO_ORG_URL (or --org-url), ADO_PROJECT (or --project).\n',
      );
      break;

    default:
      die(`unknown command "${cmd}" — run \`node launchpad/scripts/ado-rest.mjs help\``);
  }
}

// Export the pure helpers so they're unit-testable without a live org.
export { buildPatch, parseTags, wiqlForTags, pickState, contentRevisions, itemFromApi, authFailure, encodeMarkdown, decodeMarkdown };

// Run the CLI only when invoked directly (`node ado-rest.mjs …`), not on import.
// Compare real filesystem paths (see jira-rest.mjs): import.meta.url percent-encodes
// spaces and is file:///C:/… on Windows, and realpathSync matches through a symlink.
function invokedDirectly() {
  try {
    return !!argv[1] && realpathSync(argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (invokedDirectly()) {
  main().catch((e) => die(`unexpected error: ${e && e.stack ? e.stack : e}`));
}
