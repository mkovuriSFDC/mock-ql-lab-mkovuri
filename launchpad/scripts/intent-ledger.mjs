#!/usr/bin/env node
// Intent ledger helper — the backward link between canonical scope and delivery.
//
// `intents/INT-NNN/intent.md` is the WHAT — the LIVING canonical Intent. It is
// human-authored and refined in-repo (relabel, resequence, fix scope, add
// dependencies) via /ql-refine-intent; git history + decisions/ are its provenance.
// `delivery/intent-ledger.md` is the STATUS (intent → PR → evidence → the scope
// hash captured when it was delivered). A tied Scopezilla source is NOT canonical:
// read in place at its reviewed cursor, it's only the merge base for `reconcile`
// on re-ingest. This script keeps the three honest:
//
//   hash  [INT-xxx]   print the current scope hash for an intent (or all of them).
//      [--proof]       --proof prints the PROOF hash instead (scope + success
//                     criteria) — what a test script stamps as `proof_hash:` (#108).
//                     `deliver` stamps this into the ledger for you — you rarely
//                     need to read it by hand except to eyeball a value.
//
//   drift              compare each delivered/in-progress ledger row's recorded
//                     hash against the current intent hash. A mismatch means scope
//                     moved AFTER you built against it — re-verify. (Refining a
//                     delivered intent in-repo trips this too, by design: the edit
//                     IS a scope change and should force re-verification.) Exits
//                     non-zero on drift (so /ql-ingest-scopezilla and CI gate on it).
//
//   validate           the safety net for living intent files: every intent parses,
//                     carries required frontmatter (id/phase/title) and the canonical
//                     ## sections, every internal dependency resolves to a real
//                     intent, and no intent depends on a later-phase intent
//                     (sequencing error). Exits non-zero on any problem. A broken
//                     intent file can make drift detection LIE, so CI gates on this.
//
//   seed               print a fresh ledger table (one row per intent, status
//                     "Not started"). Used by /ql-ingest-scopezilla to scaffold the
//                     file; safe to diff against an existing ledger by hand.
//
//   start INT-xxx      flip one intent's row to "🔧 In progress" (use --pr <ref>
//      [--pr <ref>]    to also record the branch/PR). Idempotent; refuses to move a
//                     ✅ Delivered or 🔄 Needs re-verify row back.
//
//   deliver INT-xxx    the close-out twin of `start`, run while the delivering PR
//      [--pr <ref>]    is assembled: atomically flips the row to "✅ Delivered",
//                     stamps the CURRENT scope hash (no hand-copy), records the PR,
//                     and refreshes the README delivery index — the whole ledger
//                     side in one write, so a Delivered row can't be left unstamped.
//                     Idempotent when already delivered at the current hash; REFUSES
//                     to silently re-stamp a delivered row whose scope has since
//                     moved (that's drift — `reverify` it, re-verify, then deliver).
//
//   retire INT-xxx     the terminal-lifecycle twin of `deliver`: flip a row to
//      [--decision      "🚫 Retired" for an intent deliberately pulled from delivery
//        <ref>]         (possibly after it was partially built). Clears the scope
//                     hash (a retired intent isn't being verified), records the
//                     decision-record pointer in Evidence, preserves the PR, and
//                     refreshes the README index. Retirable from ANY status;
//                     idempotent when already retired. Retired intents are EXCLUDED
//                     from drift/coverage/conformance — so ⬜ Not started no longer
//                     has to double as "de-scoped" (issue #139).
//
//   ratify INT-xxx     record that the Trusted Guide stands behind an intent:
//      --by <name>     writes `ratified: YYYY-MM-DD by <name> @ <scope-hash>` into its
//                     frontmatter. On a refinement, --absorbed or --scope-change
//                     appends the Trusted Guide's call. `deliver` refuses an
//                     explicit draft (confidence: draft) with no ratification,
//                     or one ratified at different scope; `start` warns.
//                     Frontmatter isn't hashed.
//
//   reverify INT-xxx   flip a ✅ Delivered row to "🔄 Needs re-verify" when its
//      [--decision      scope moved after delivery. Keeps the recorded hash + PR
//        <ref>]         (the record of what was delivered). drift then reports
//                     the moved hash as ACKNOWLEDGED (notice, not failure) until
//                     `deliver` re-stamps it after the build is re-verified.
//
//   index [--write]    render a phase-grouped delivery index (intent title from
//                     scope + status/PR from the ledger) for the engagement README.
//                     `--write` splices it into README.md between the
//                     ENGAGEMENT:INDEX markers, idempotently. A DERIVED VIEW.
//
//   coverage           report, per intent, whether a test script (the co-located
//      [INT-xxx]       per-intent proof plan at intents/INT-xxx/test-script.md)
//      [--gate]        exists, is current (stamped hash still matches), and is
//      [--results      complete. With --gate, exits non-zero when an intent the
//        <file>]       LEDGER marks ✅ Delivered has no script, has drifted, or is
//      [--tests-       incomplete — "shipped = proven". Manual criteria awaiting
//        complete]     human sign-off are WARNED, never failed.
//                       --results <file> cross-checks each ✅ criterion's named
//                     `Class.method` test (read ONLY from backtick-fenced spans in
//                     the "how proven" cell, so a field ref like Account.Industry is
//                     never mistaken for a test) against an sf `--json` (deploy-
//                     validate or apex-run-test) or JUnit XML results file:
//                       • RED test            → gate failure for ANY intent.
//                       • method MISSING but its class RAN (typo / deleted test)
//                                             → fails only under --tests-complete,
//                                               for Delivered intents.
//                       • test not in the run (class never ran → delta run), OR a ✅
//                         proven by a SOQL/config assertion that names no method
//                                             → "unconfirmed", surfaced, NEVER gated
//                                               (this is the false-failure trap the
//                                               class-corroboration check avoids).
//                     --tests-complete says the run was exhaustive (a full
//                     RunLocalTests). This turns a ✅ from the author's assertion
//                     into a CI-confirmed proof, without ever failing honest work.
//                     Also flags a 📋 accepted gap whose named pointer (an
//                     `INT-NNN` cited alongside the accepter) is now ✅ Delivered
//                     in the ledger — "ready to revisit," surfaced per-intent and
//                     summarized across the whole run. A 📋 accepted gap is a
//                     write-once record by design (the accepter's call, not this
//                     script's, to reopen), so without this nothing ever re-checks
//                     whether the reason it was deferred has since gone away — it
//                     only got picked up before if a human happened to remember.
//                     Never gates; a stale pointer (target not yet delivered, or
//                     no INT-NNN in the cell) reports nothing extra.
//
//   conformance        the traceability REPORT for a regulated program. Two
//      [INT-xxx]       halves, both report-not-gate: (1) requirements grounding
//                     (#49) — per intent, what approved requirement / architecture
//                     it's grounded in (## Grounding), and which DELIVERED intents
//                     carry none; (2) architecture-decision conformance (0009) —
//                     the AUDIT of DECLARED deviations (a build-authored ADR that
//                     supersedes a scopezilla-inherited premise), pending-ARB loud
//                     vs accepted-by-ARB quiet. Always prints, never exits non-zero.
//                     Presence-gated: silent when the engagement carries no
//                     grounding / no inherited premise. DETECTION of a SILENT
//                     deviation is the /ql-design-intent + /ql-vet-intent reflex's job,
//                     not this report's — this audits that DECLARED deviations got
//                     a human ARB signature.
//
//   metrics [INT-xxx]  within-engagement delivery signals, TIER 1 — derived from
//      [--json]        git FILE-HISTORY alone (no stamping, no gh, no commit-MESSAGE
//                     parsing). Per intent, walks intent.md's commits and recomputes
//                     the SAME scope hash the drift gate uses at each revision, so
//                     "scope change" means exactly what drift means: scope_changes
//                     (real churn, distinct from cosmetic edits), revisions,
//                     time-to-stable (days the WHAT kept moving), open-question
//                     trajectory. HONEST BY CONTRACT — degrades to partial/unknown,
//                     never a wrong number: no git → unknown; a revision that doesn't
//                     parse is SKIPPED and surfaced (never a fake transition); a
//                     shallow/renamed/single-commit history is flagged. Read-only;
//                     never gates on findings. See decisions/0043.
//
//   from-json <file>   one-time / per-ingest transform: read a raw Scopezilla
//                     intents JSON (array or {intents:[]}) and write one
//                     intents/INT-NNN/intent.md per intent. Used by
//                     /ql-ingest-scopezilla to seed the living files from upstream.
//                     LOSS-PROOF: known grounding fields land in ## Grounding, and
//                     ANY upstream field with no schema home is CARRIED verbatim
//                     (## Grounding → ### Carried) and reported — never silently
//                     dropped (the failure mode #49 fixes).
//
//   reconcile <file>   3-way divergence REPORT on re-ingest (read-only, never
//                     clobbers): base = --base (the source at its cursor; a
//                     pre-0082 repo's scopezilla/data/intents.json), ours = intents/ (living), theirs = <file> (fresh
//                     upstream). Tells you, per intent, whether UPSTREAM moved, WE
//                     refined, or BOTH (a real conflict for a human to settle).
//
//   currency [INT-xxx] the branch-currency guard for the intent-EDIT skills
//                     (/ql-refine-intent, /ql-capture-intent, /ql-start-intent).
//                     Best-effort git fetch, then reports whether the current branch
//                     is behind its upstream (the shared branch) and — with an id —
//                     whether THAT intent's scope hash has changed upstream since you
//                     started (a possible clobber). WARN-only, never exits non-zero
//                     (a hard block mid-edit is friction; CI `drift` is the backstop).
//                     `--json` for the machine-readable envelope; `--no-fetch` to skip
//                     the network (offline / VDI). See decisions/0014.
//
// The scope hash covers the fields that define "what to build / what counts as
// done" — title, build_target, guardrails, out_of_scope, acceptance —
// whitespace-normalized so prose re-wrapping never trips it. It deliberately
// EXCLUDES open_questions, phase/priority/surface/confidence, dependencies, AND grounding
// (all planning/traceability metadata: discovering a new cross-team dependency —
// or backfilling a requirement ID / architecture link onto an already-delivered
// intent — shouldn't force re-verifying code that still matches its build target).
//
// Canonical source: intents/INT-NNN/intent.md (LIVING — refined in-repo via
// /ql-refine-intent; see AGENTS.md). `start` is the ONLY command that writes
// delivery/intent-ledger.md; `from-json` writes intents/ files; everything else
// is read-only.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, realpathSync, cpSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, resolve, sep } from 'node:path';

const INTENTS_DIR = 'intents';
const RAW_JSON = 'scopezilla/data/intents.json'; // merge base only — NOT canonical
const LEDGER = 'delivery/intent-ledger.md';
// The ledger as a path from the repo root, for hints a person pastes there (set once the engagement resolves).
let LEDGER_FROM_ROOT = LEDGER;
const README = 'README.md';
// Org-level files live in launchpad/, two levels above the engagement folder the
// engine works from (decisions/0082 W1): they describe the org, so every
// engagement shares them.
const ORG_DIR = join('..', '..');
const RUNBOOK = join(ORG_DIR, 'deploy-runbook.md'); // carries the "## Go-live gate" checklist (golive command)
// How a path reads in output: an org-level path as the repo path a person would open.
const shown = (p) => (p.startsWith(ORG_DIR + sep) ? `launchpad/${p.slice(ORG_DIR.length + 1).split(sep).join('/')}` : p);
// Architecture ADRs (decisions/0009, 0082). Two locations, split by reach:
//   BUILD_ADR_DIR — the org's, launchpad/decisions/architecture/: standing premises
//     that span engagements, adopted from Scopezilla (Source: scopezilla-inherited)
//     or build-authored (BLD-NNNN, so their numbers never collide with the 00XX range).
//   ENGAGEMENT_ADR_DIR — the engagement's own decisions/architecture/, for a premise
//     that holds for this engagement only.
//   LEGACY_ADR_DIR — the pre-0082 read-only mirror, still read so an engagement
//     that carries one keeps its premises until the mirror is retired.
// The conformance pass keys off Source/Supersedes/Deviation, not the location.
const ENGAGEMENT_ADR_DIR = join('decisions', 'architecture');
const LEGACY_ADR_DIR = join('scopezilla', 'decisions');
const BUILD_ADR_DIR = join(ORG_DIR, 'decisions', 'architecture'); // org-level: a standing premise spans engagements

// ── Engagement resolution (decisions/0082 W1) ────────────────────────────────
// An org repo holds one folder per engagement: launchpad/engagements/<slug>/. The
// engine resolves the active engagement first and then works from inside its
// folder, so every path below (intents/, delivery/, decisions/) is
// engagement-relative. Order: --engagement flag, a slug-qualified id
// (acme/INT-001), LAUNCHPAD_ENGAGEMENT, .launchpad/local.json `active_engagement`
// (per machine, never committed), then the only engagement in the repo. A cwd
// inside an engagement folder is that engagement. A pre-tenant repo is refused
// with the migration pointer: the engine supports one layout, never two.
const ENGAGEMENTS_DIR = join('launchpad', 'engagements');
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const QUALIFIED_ID_RE = /^([a-z0-9][a-z0-9-]*)\/(INT-\d+[a-z]?)$/i; // a bare id only: never a path like test-evidence/INT-001-x.md

// The repo root: the nearest ancestor holding launchpad/engagements/, else the git
// top level, else the cwd.
function findRepoRoot(cwd) {
  for (let d = cwd; ; d = dirname(d)) {
    if (existsSync(join(d, ENGAGEMENTS_DIR))) return d;
    if (dirname(d) === d) break;
  }
  const top = git(['-C', cwd, 'rev-parse', '--show-toplevel']);
  return top.ok && top.out ? top.out : cwd;
}

function listEngagements(root) {
  try {
    return readdirSync(join(root, ENGAGEMENTS_DIR), { withFileTypes: true })
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name)).map((e) => e.name).sort();
  } catch { return []; }
}

// Take --engagement <slug> and any slug prefix off the args. Returns the cleaned
// args plus the slug each named, or { error }.
function takeEngagementArgs(argv) {
  const args = [];
  let flag = null;
  let qualified = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--engagement') {
      flag = argv[++i];
      if (!flag || flag.startsWith('--')) return { error: '--engagement needs a slug:  --engagement <slug>' };
      continue;
    }
    const m = a.match(QUALIFIED_ID_RE);
    if (m) {
      const slug = m[1].toLowerCase();
      if (qualified && qualified !== slug) {
        return { error: `These ids name two engagements (${qualified}, ${slug}). Run one engagement at a time.` };
      }
      qualified = slug;
      args.push(m[2]);
      continue;
    }
    args.push(a);
  }
  if (flag && qualified && flag !== qualified) {
    return { error: `--engagement ${flag} disagrees with the id prefix ${qualified}/. Pick one.` };
  }
  return { args, flag, qualified };
}

function readLocalActive(root) {
  try {
    const v = JSON.parse(readFileSync(join(root, '.launchpad', 'local.json'), 'utf8')).active_engagement;
    return typeof v === 'string' && v ? v : null;
  } catch { return null; }
}

function unknownSlug(pick, all) {
  return `No engagement "${pick}" in this repo. Engagements: ${all.length ? all.join(', ') : 'none'}.`;
}

// Returns { root, slug, dir } or { error }.
function resolveEngagement({ cwd, flag, qualified, env }) {
  const here = resolve(cwd);
  const parts = here.split(sep);
  let root = null;
  let inside = null;
  for (let i = parts.length - 2; i >= 1; i--) {
    if (parts[i - 1] === 'launchpad' && parts[i] === 'engagements' && SLUG_RE.test(parts[i + 1] || '')) {
      root = parts.slice(0, i - 1).join(sep) || sep;
      inside = parts[i + 1];
      break;
    }
  }
  if (!root) root = findRepoRoot(here);
  const all = listEngagements(root);
  if (!all.length) {
    if (existsSync(join(root, 'intents')) || existsSync(join(root, 'delivery', 'intent-ledger.md'))) {
      return { error: 'This repo uses the old layout (intents/ and delivery/ at the root). ' +
        'Run /ql-resync to move it under launchpad/engagements/<slug>/.' };
    }
    return { error: 'No engagement here yet (no launchpad/engagements/<slug>/). Run /ql-init-engagement first.' };
  }
  const envPick = env.LAUNCHPAD_ENGAGEMENT || null;
  const pick = flag || qualified || inside || envPick || readLocalActive(root);
  if (pick) {
    if (!all.includes(pick)) return { error: unknownSlug(pick, all) };
    return { root, slug: pick, dir: join(root, ENGAGEMENTS_DIR, pick) };
  }
  if (all.length === 1) return { root, slug: all[0], dir: join(root, ENGAGEMENTS_DIR, all[0]) };
  return { error: `This repo has ${all.length} engagements (${all.join(', ')}). ` +
    `Name one with --engagement <slug> or a qualified id like ${all[0]}/INT-001.` };
}

// ── engagements: which engagements CI gates, and the frozen guard ────────────
// A repo-level command (it runs before an engagement is resolved). Prints the
// slugs CI should run the trust chain for, one per line:
//   - an open engagement the PR touches is gated;
//   - a PR that touches anything outside launchpad/engagements/ (force-app/,
//     the shared scripts, workflows) gates every open engagement;
//   - a closed engagement is never gated, and a PR that changes one fails,
//     unless that PR is the close (open → closed) or the reopen (closed → open).
// With no --base (or one git can't resolve), every open engagement is gated.
function engagementStatus(text) {
  try { return JSON.parse(text).status === 'closed' ? 'closed' : 'open'; } catch { return 'open'; }
}

function cmdEngagements(baseRef) {
  const root = findRepoRoot(process.cwd());
  const prefix = (slug) => `launchpad/engagements/${slug}/`;
  const headProfile = (slug) => { try { return readFileSync(join(root, ENGAGEMENTS_DIR, slug, 'engagement.json'), 'utf8'); } catch { return null; } };
  let changed = null;
  let baseSlugs = [];
  const baseOk = baseRef && git(['-C', root, 'rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]).ok;
  if (baseOk) {
    // --no-renames: a file moved out of an engagement counts as changed in it.
    const d = git(['-C', root, 'diff', '--no-renames', '--name-only', `${baseRef}...HEAD`]);
    if (d.ok) changed = d.out.split('\n').filter(Boolean);
    const t = git(['-C', root, 'ls-tree', '--name-only', `${baseRef}:launchpad/engagements`]);
    if (t.ok) baseSlugs = t.out.split('\n').filter((n) => SLUG_RE.test(n));
  }
  const headSlugs = listEngagements(root);
  const violations = [];
  const gate = [];
  for (const slug of [...new Set([...headSlugs, ...baseSlugs])].sort()) {
    const touched = changed ? changed.filter((f) => f.startsWith(prefix(slug))) : [];
    const before = baseOk ? git(['-C', root, 'show', `${baseRef}:${prefix(slug)}engagement.json`]) : { ok: false };
    const headText = headProfile(slug);
    // With no base to compare, the engagement's own status stands for both.
    const base = before.ok ? engagementStatus(before.out) : baseOk ? 'open' : engagementStatus(headText || '{}');
    if (!headSlugs.includes(slug)) {
      // Gone at head: a deleted or renamed engagement takes its delivered record with it.
      violations.push({ slug, why: `This PR deletes or renames ${slug}. Its folder is the audit record and its slug is fixed; close it instead.`, files: touched });
      continue;
    }
    // A closed engagement whose profile went missing is still closed.
    const head = headText === null ? base : engagementStatus(headText);
    const others = touched.filter((f) => f !== `${prefix(slug)}engagement.json`);
    if (base === 'closed' && head === 'closed' && touched.length) {
      violations.push({ slug, why: `${slug} is closed, so its trust chain is the frozen audit record.`, files: touched });
    } else if (base === 'closed' && head === 'open' && others.length) {
      violations.push({ slug, why: `${slug} is being reopened. Reopen it in its own PR (the profile and its reopen record only), then change it.`,
        files: others.filter((f) => !/\/decisions\/[^/]*reopen[^/]*\.md$/.test(f)) });
      if (!violations[violations.length - 1].files.length) violations.pop();
    }
    if (base === 'closed' && head === 'open' && !touched.some((f) => /\/decisions\/[^/]*reopen[^/]*\.md$/.test(f))) {
      violations.push({ slug, why: `${slug} is being reopened without a reopen record: add decisions/YYYY-MM-DD-reopen.md (reopen --decision).`, files: [] });
    }
    if (base === 'open' && head === 'closed' && !existsSync(join(root, ENGAGEMENTS_DIR, slug, SUMMARY_FILE))) {
      violations.push({ slug, why: `${slug} is being closed without its ${SUMMARY_FILE}: run summary --write, then close.`, files: [] });
    }
    if (head === 'closed' && base === 'closed') continue;
    // The close PR itself is gated: what it freezes must still hold.
    const outside = changed && changed.some((f) => !f.startsWith('launchpad/engagements/'));
    if (!changed || outside || touched.length) gate.push(slug);
  }
  for (const v of violations) {
    console.error(v.why + (v.files.length ? ' This PR changes:' : ''));
    for (const f of v.files) console.error(`  ${f.slice(prefix(v.slug).length)}`);
  }
  for (const slug of gate) console.log(slug);
  process.exit(violations.length ? 1 : 0);
}

// A path for `git show <ref>:<path>` and `git ls-tree <ref>:<path>`. A bare path
// there is relative to the repo root; `./` makes it relative to the cwd, which is
// the engagement folder once resolved.
const treePath = (p) => `./${p}`;

// ── git helpers (best-effort, never load-bearing) ────────────────────────────
// Parallel teams (many IAs on many branches) hit two problems this script guards
// against: id collisions when two branches allocate the same INT-NNN, and edits
// authored off a stale copy. Both guards want to know what's on OTHER branches —
// but a shipped engine script must degrade cleanly with no network, no git, or a
// locked-down VDI. So every git call here is best-effort: it returns a sentinel on
// ANY failure and the caller carries on. Git is an OPTIMIZATION that narrows a
// race window; it is never the thing that makes a guard correct (the never-clobber
// check at write time and CI `drift` are). See decisions/0014.
function git(args, { allowFail = true } = {}) {
  try {
    return { ok: true, out: execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch (e) {
    if (!allowFail) throw e;
    return { ok: false, out: '' };
  }
}

// True only inside a git work tree — the gate for every other git helper.
function inGitRepo() {
  return git(['rev-parse', '--is-inside-work-tree']).out === 'true';
}

// Best-effort refresh of remote refs so max-across-branches (nextIntentId) and the
// ahead/behind banner see teammates' work. Silent + fast-failing by design; a
// timeout keeps an unreachable remote from hanging an allocation. Returns nothing.
function gitFetchQuiet() {
  if (!inGitRepo()) return;
  try {
    execFileSync('git', ['fetch', '--quiet', '--all', '--prune'],
      { stdio: 'ignore', timeout: 8000 });
  } catch { /* offline / no remote / VDI — carry on with what we have locally */ }
}

// Highest INT-NNN numeric id visible in intents/ dirs across ALL refs (local
// branches + remotes), so an id claimed on an unmerged branch is still counted.
// Best-effort: on any git failure returns 0 and the caller falls back to the local
// filesystem scan alone. Reads `git ls-tree` per ref rather than checking anything
// out — no working-tree mutation.
function intentNumbersAcrossRefs() {
  const out = new Set();
  if (!inGitRepo()) return out;
  const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  if (!refs.ok || !refs.out) return out;
  for (const ref of refs.out.split('\n').filter(Boolean)) {
    const tree = git(['ls-tree', '--name-only', `${ref}:${treePath(INTENTS_DIR)}`]);
    if (!tree.ok) continue;
    for (const name of tree.out.split('\n')) {
      const m = name.match(/^INT-(\d+)/i);
      if (m) out.add(Number(m[1]));
    }
  }
  return out;
}

function maxIntentIdAcrossRefs() {
  return Math.max(0, ...intentNumbersAcrossRefs());
}

// {ahead, behind} of the current branch vs its upstream tracking ref, or null when
// there's no upstream / not a repo / git unavailable. Powers the staleness banner
// the intent-edit skills print before writing. (OpenSpec relationship-health pattern.)
function aheadBehind() {
  if (!inGitRepo()) return null;
  const up = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (!up.ok || !up.out) return null;
  const counts = git(['rev-list', '--left-right', '--count', `${up.out}...HEAD`]);
  if (!counts.ok || !counts.out) return null;
  const [behind, ahead] = counts.out.split(/\s+/).map(Number);
  if (Number.isNaN(ahead) || Number.isNaN(behind)) return null;
  return { ahead, behind, upstream: up.out };
}

// Canonical intent id: uppercase, numeric part zero-padded to 3 (INT-3 → INT-003)
// so an upstream "INT-3" and a local "INT-003" land in the same directory and
// the duplicate-id check sees them as the same logical intent.
function normId(raw) {
  const m = String(raw || '').toUpperCase().match(/^INT-(\d+)(.*)$/);
  return m ? `INT-${m[1].padStart(3, '0')}${m[2]}` : String(raw || '').toUpperCase();
}

// ── Intent file format ───────────────────────────────────────────────────────
// One directory per intent: intents/INT-NNN/{intent.md, test-script.md}. The
// intent.md is YAML-ish frontmatter (the machine fields) + canonical ## sections
// (the human prose). The parser is intentionally tolerant on read and strict in
// `validate`, so a half-finished hand edit degrades to a clear validation error
// rather than a silent mis-parse.
//
// Sections, and how each maps back to the object shape the rest of this script
// (and scope-digest.mjs) already expects:
const SECTIONS = [
  // Optional business framing carried through from Scopezilla's `outcome` field
  // ({ summary, metric: { baseline, target, window } }). First, to match the
  // upstream section order and read as the "why" above the "what". Deliberately
  // NOT in REQUIRED_SECTIONS (an intent without it is still valid) and NOT in
  // scopeHash (it's context, not a change to what-to-build — so backfilling it
  // into already-delivered intents never trips false drift, zero migration).
  { key: 'outcome', heading: 'Outcome', kind: 'outcome' },
  { key: 'build_target', heading: 'Build target', kind: 'prose' },
  { key: 'guardrails', heading: 'Guardrails', kind: 'list' },
  { key: 'out_of_scope', heading: 'Out of scope', kind: 'list' },
  { key: 'acceptance', heading: 'Acceptance', kind: 'prose' },
  // Optional, additive: measurable, technology-agnostic success criteria (SC-x),
  // separated from the prose acceptance walkthrough. Registered here so the
  // "## Success criteria" heading is a recognized section BOUNDARY — without this
  // an authored block would silently fold into Acceptance and corrupt ITS hash.
  // Deliberately NOT in REQUIRED_SECTIONS (optional) and NOT in scopeHash (so
  // adding/editing it never trips drift — zero migration for existing intents).
  { key: 'success_criteria', heading: 'Success criteria', kind: 'list' },
  { key: 'dependencies', heading: 'Dependencies', kind: 'deps' },
  { key: 'open_questions', heading: 'Open questions', kind: 'questions' },
  // Optional architectural GROUNDING carried through from upstream — the backward
  // link a regulated / ARB-governed program needs: a requirement ID, the approved-
  // architecture artifact, a wireframe, anything that maps this intent back to a
  // documented, approved source. Two parts, both tolerant:
  //   • a list of "Label: value" grounding entries (Requirement / Architecture /
  //     Wireframe / Source / …) — the KNOWN, first-class grounding;
  //   • a "### Carried (unmapped upstream fields)" sub-block that preserves, VERBATIM,
  //     any upstream field the transform had no schema home for — so grounding is
  //     loss-proof by CONSTRUCTION (a field we didn't anticipate is surfaced and
  //     carried, never silently collapsed). This is the whole point of the section:
  //     the failure mode flips from "silent drop" to "loud carry".
  // Registered here so "## Grounding" is a recognized section BOUNDARY. Deliberately
  // NOT in REQUIRED_SECTIONS (a commercial engagement carries none) and NOT in
  // scopeHash (it's traceability/provenance, like dependencies — backfilling it onto
  // a delivered intent must never trip false drift; zero migration).
  { key: 'grounding', heading: 'Grounding', kind: 'grounding' },
];
const REQUIRED_SECTIONS = ['build_target', 'guardrails', 'out_of_scope', 'acceptance'];

// The canonical section headings, lowercased. Sorted longest-first so that IF a
// future heading were ever a prefix of another, the longer name is tested first;
// no current heading is a prefix of another, so today the order is immaterial —
// the sort is cheap insurance against a future addition, not a live collision.
const CANONICAL_HEADINGS = SECTIONS
  .map((s) => s.heading.toLowerCase())
  .sort((a, b) => b.length - a.length);

// Resolve a raw "## " heading to its canonical lowercased heading (the key
// splitSections stores the block under — e.g. "build target"), or null if it
// isn't a section boundary. Split ONLY on these — not on any "## " line — so
// prose that legitimately contains a line starting with "## " (or "### ") isn't
// mis-read as a boundary and silently truncating the hashed content. A heading
// matches a canonical name when it EQUALS it, or STARTS WITH it followed by a
// separator: a colon or em/en-dash may be adjacent ("Acceptance:", "Build
// Target—x"), but a bare ASCII hyphen must be surrounded by whitespace (" — "/
// " - ") — space before AND after (or end), so a hyphenated word ("Acceptance-
// rate targets", "Build target -lite") does NOT match. That distinction is
// load-bearing: it lets a descriptive suffix the generator emits ("Build Target
// — how it functions") resolve to "build target" and be hashed, WITHOUT a
// hyphenated word falsely matching a canonical name and truncating the preceding
// hashed section. A typo'd *required* heading still won't resolve — the section
// goes missing and the required-section check in parseIntentFile fires.
function canonicalHeading(raw) {
  const h = raw.toLowerCase().trim();
  for (const name of CANONICAL_HEADINGS) {
    if (h === name) return name;
    if (h.startsWith(name) && /^(?:\s*[—–:]|\s+-(?=\s|$))/.test(h.slice(name.length))) return name;
  }
  return null;
}

// Placeholders that mean "deliberately empty". Treated as empty everywhere so an
// empty upstream field → placeholder on serialize → empty on re-parse keeps the
// scope hash stable (invariant: JSON→markdown→parse round-trips the hash).
const PLACEHOLDER = /^_(none|todo|n\/a|tbd)_$/i;

// List sections that feed the scope hash (see SCOPE_FIELDS). Symbol keys carry
// parse side-facts on the intent object without showing up in JSON output.
const HASHED_LIST_KEYS = new Set(['guardrails', 'out_of_scope']);
const STRAY_LIST_TEXT = Symbol('strayListText'); // text in a list section that isn't a bullet
const LEGACY_LISTS = Symbol('legacyLists');      // lists as bullet-only parseList reads them, when different
const OUTCOME_EXTRA = Symbol('outcomeExtra');    // prose paragraphs in Outcome past its summary

// A fence line: an opening/closing code-fence marker (``` or ~~~), ignoring indent.
const FENCE_RE = /^\s*(```|~~~)/;

// Split known "## Heading" blocks out of a markdown body. Returns a map of
// lowercased-heading → raw block text (up to the next known heading / EOF).
//
// Fence-awareness, guarded by BALANCE (decisions/0014). A "## Guardrails" line
// inside an example Apex/SOQL block (our intents legitimately carry code) must not
// be read as a section boundary — but naive toggle-on-every-fence is WORSE than
// the disease: a single stray/odd fence line (a lone ``` in prose) would leave the
// parser "inside a fence" forever and SILENTLY swallow every real section after it
// (dropped dependencies, polluted scope hash, validate still green). A stray fence
// is a normal authoring reality; a real code block spanning real ## headings is
// rare. So we only trust fences when the body's fences are BALANCED (even count).
// Balanced → skip boundaries inside blocks (the safe, intended behavior). Unbalanced
// → fall back to fence-blind splitting (the pre-0014 behavior), which never swallows
// a real section; at worst a genuine "## Known-heading" inside an unterminated block
// is treated as a boundary, and `validate`'s required-section check stays honest.
function splitSections(body) {
  const lines = body.split('\n');
  const fenceCount = lines.filter((l) => FENCE_RE.test(l)).length;
  const trustFences = fenceCount % 2 === 0; // balanced fences only
  const out = {};
  let cur = null;
  let buf = [];
  let inFence = false;
  // Concatenate rather than overwrite when two headings resolve to the same key
  // (e.g. suffixed "## Guardrails — a" and "## Guardrails — b"): silently dropping
  // the earlier block would lose hashed content.
  const flush = () => {
    if (cur === null) return;
    const t = buf.join('\n').trim();
    out[cur] = out[cur] ? `${out[cur]}\n${t}` : t;
  };
  for (const line of lines) {
    if (trustFences && FENCE_RE.test(line)) { inFence = !inFence; if (cur !== null) buf.push(line); continue; }
    const m = !inFence && line.match(/^##\s+(.+?)\s*$/);
    const key = m ? canonicalHeading(m[1]) : null;
    if (key) { flush(); cur = key; buf = []; }
    else if (cur !== null) buf.push(line);
  }
  flush();
  return out;
}

// List SECTION (Guardrails / Out of scope / Success criteria) → array of strings,
// bullet marker stripped. Accepts "-"/"*"/"+" and numbered ("1." / "1)") bullets.
// Every non-blank line lands in an item, so nothing written in a hashed list
// section can hide from the scope hash:
//   • a continuation line (indented, or unindented with no blank line between —
//     markdown's lazy continuation) joins the item above it;
//   • any other text (e.g. a paragraph after a blank line) becomes its own item
//     and is reported in `stray` so `validate` can warn about it.
// A lone placeholder (`_none_`) and whole-line HTML comments are ignored.
const LIST_BULLET_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
function parseListDetailed(block) {
  const items = [];
  const stray = [];
  let afterBlank = false;
  for (const line of (block || '').split('\n')) {
    const t = line.trim();
    if (!t) { afterBlank = true; continue; }
    if (/^<!--.*-->$/.test(t)) continue;
    const m = line.match(LIST_BULLET_RE);
    if (m) items.push(m[1].trim());
    else if (items.length && (!afterBlank || /^(\s{2,}|\t)/.test(line))) items[items.length - 1] += ` ${t}`;
    else if (!(items.length === 0 && PLACEHOLDER.test(t))) { items.push(t); stray.push(t); }
    afterBlank = false;
  }
  return { items: items.filter((s) => s && !PLACEHOLDER.test(s)), stray };
}
// Bullet-only list reader, for the sub-lists inside Dependencies / Open questions /
// Grounding (which have their own tolerance rules). It is also exactly how the
// hashed list sections were read before continuation/numbered-bullet support, so
// legacyScopeHash uses it to recognize stamps written then — a repo upgrading the
// script re-stamps instead of failing drift on unchanged scope.
function parseList(block) {
  if (!block) return [];
  return block.split('\n')
    .map((l) => l.match(/^\s*[-*+]\s+(.*)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((s) => s && !PLACEHOLDER.test(s));
}

// Prose section → single trimmed string (newlines preserved; the hash collapses
// whitespace so wrapping is irrelevant). A lone placeholder (`_TODO_`) means the
// field is empty — return "" so it hashes identically to an empty source field.
function parseProse(block) {
  // Tolerant on read (same contract as asList/renderOutcome): upstream may send a
  // scalar, an array of lines, or null for a field we expect as prose. Coerce
  // rather than crash — a non-string build_target/acceptance must degrade, not
  // abort the ingest mid-loop (the cross-repo backward-tolerance rule in AGENTS.md).
  const raw = Array.isArray(block) ? block.join('\n') : block == null ? '' : String(block);
  const t = raw.trim();
  return PLACEHOLDER.test(t) ? '' : t;
}

// Dependencies section → { internal: [intentId...], external: [{system,need,owner}] }.
// Internal lives under "### Internal" as bullets beginning with an intent id.
// External lives under "### External" as bullets "System | need | owner: Name".
function parseDeps(block) {
  const deps = { internal: [], external: [] };
  if (!block) return deps;
  const sub = {};
  let cur = null, buf = [];
  const flush = () => { if (cur) sub[cur] = buf.join('\n'); };
  for (const line of block.split('\n')) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) { flush(); cur = m[1].toLowerCase().trim(); buf = []; }
    else if (cur) buf.push(line);
  }
  flush();
  for (const item of parseList(sub.internal || '')) {
    const m = item.match(/\b(INT-\d+)\b/i);
    if (m) deps.internal.push(m[1].toUpperCase());
  }
  for (const item of parseList(sub.external || '')) {
    // "System name | what's needed | owner: Owner Name"  (owner part optional)
    const parts = item.split('|').map((p) => p.trim());
    const ext = { system: parts[0] || '', need: parts[1] || '' };
    const ownerPart = parts.find((p) => /^owner\s*:/i.test(p));
    if (ownerPart) ext.owner = ownerPart.replace(/^owner\s*:/i, '').trim();
    deps.external.push(ext);
  }
  return deps;
}

// Open questions → array of {id, question, answer, status}. Bullet forms:
//   "- Q-001: <question> — UNANSWERED"
//   "- Q-002: <question> — ANSWERED: <answer>"
// Tolerant of a hand edit that dropped the leading "- ": a bare line beginning
// "Q-NNN" is still counted, so a malformed question can't silently vanish from the
// open-question count (surface, don't swallow). open_questions is NOT part of the
// scope hash, so this tolerance can never affect drift/churn — only the count.
function questionItems(block) {
  const items = [];
  const seen = new Set();
  for (const item of parseList(block)) { items.push(item); seen.add(item); }
  for (const raw of (block || '').split('\n')) {
    const m = raw.match(/^\s*(Q-\d+\b.*)$/i);
    if (!m) continue;
    const t = m[1].trim();
    if (t && !PLACEHOLDER.test(t) && !seen.has(t)) { items.push(t); seen.add(t); }
  }
  return items;
}
function parseQuestions(block) {
  const out = [];
  for (const item of questionItems(block)) {
    const idm = item.match(/^(Q-\d+)\s*:?\s*(.*)$/i);
    const id = idm ? idm[1].toUpperCase() : undefined;
    let rest = idm ? idm[2] : item;
    let answer, status = 'UNANSWERED';
    // The status marker is anchored on a separator — whitespace then em-dash or
    // hyphen — so an in-word hyphen (e.g. "multi-region") can't be mistaken for
    // the "— ANSWERED:" delimiter.
    const am = rest.match(/\s[—–-]\s*ANSWERED\s*:?\s*(.*)$/i);
    if (am) { answer = am[1].trim(); status = 'ANSWERED'; rest = rest.slice(0, am.index).trim(); }
    else { rest = rest.replace(/\s[—–-]\s*UNANSWERED\s*$/i, '').trim(); }
    // Pull the inline "(Resolver: …)" back off the tail of the question so a
    // round-trip (parse → renderQuestions) neither loses it nor doubles it. It
    // renders after the question text and before the status marker (already
    // stripped above), so it's now the trailing parenthetical on `rest`.
    let resolver;
    const rm = rest.match(/\s*\(Resolver:\s*([^)]*)\)\s*$/i);
    if (rm) { resolver = rm[1].trim(); rest = rest.slice(0, rm.index).trim(); }
    out.push({ id, question: rest.replace(/\s[—–-]\s*$/, '').trim(), answer, status, resolver });
  }
  return out;
}

// Outcome section → { summary, metric: { baseline, target, window } } | null.
// Layout: a prose summary line (the "why"), optionally followed by a bullet list
// of "Baseline:" / "Target:" / "Window:" metric lines. Tolerant: any subset may
// be present; a lone placeholder (`_none_`) or an empty block parses to null so
// an intent without an outcome round-trips as absent, not as an empty object.
// The summary is the FIRST prose paragraph only: it's what /ql-sync-jira leads a
// story with, and later paragraphs are usually refinement history piling up
// (#178). Those are counted under OUTCOME_EXTRA so `validate` can say so.
function parseOutcome(block) {
  const t = (block || '').trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  const metric = {};
  const paragraphs = [];
  let current = null;
  for (const line of t.split('\n')) {
    const m = line.match(/^\s*[-*+]\s*(baseline|target|window)\s*:?\s*(.*)$/i);
    if (m) { const v = m[2].trim(); if (v) metric[m[1].toLowerCase()] = v; current = null; }
    else if (!line.trim()) current = null;
    else if (current) current.push(line.trim());
    else paragraphs.push(current = [line.trim()]);
  }
  const outcome = {};
  const summary = paragraphs.length ? paragraphs[0].join(' ').trim() : '';
  if (summary) outcome.summary = summary;
  if (Object.keys(metric).length) outcome.metric = metric;
  if (!Object.keys(outcome).length) return null;
  if (paragraphs.length > 1) outcome[OUTCOME_EXTRA] = paragraphs.length - 1;
  return outcome;
}

// Grounding section → { entries: [{label, value}], carried: [{key, value}] } | null.
// Layout (all optional; a lone placeholder → null so an ungrounded intent round-trips as absent):
//   - Requirement: REQ-114
//   - Architecture: ARB-approved solution design §4.2 (link)
//   - Wireframe: Figma frame "Case console"
//   ### Carried (unmapped upstream fields)
//   - some_upstream_key: <verbatim value the transform had no home for>
// The "Label: value" bullets are the known, first-class grounding; the Carried
// sub-block preserves anything the transform couldn't map, so nothing is lost.
// Tolerant: a bullet with no "Label:" is kept as an entry with an empty label
// rather than dropped (surface, don't swallow).
function parseGrounding(block) {
  const t = (block || '').trim();
  if (!t || PLACEHOLDER.test(t)) return null;
  // Split the optional "### Carried" sub-block off the top-level entries.
  const sub = {};
  let cur = '_entries';
  let buf = [];
  const flush = () => { sub[cur] = (buf.join('\n')).trim(); };
  for (const line of block.split('\n')) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) { flush(); cur = /carried/i.test(m[1]) ? '_carried' : m[1].toLowerCase().trim(); buf = []; }
    else buf.push(line);
  }
  flush();
  const splitLabel = (item) => {
    const m = item.match(/^([^:]+?)\s*:\s*(.*)$/);
    return m ? { label: m[1].trim(), value: m[2].trim() } : { label: '', value: item.trim() };
  };
  const entries = parseList(sub._entries || '').map(splitLabel);
  const carried = parseList(sub._carried || '').map((item) => {
    const { label, value } = splitLabel(item);
    return { key: label, value };
  });
  if (!entries.length && !carried.length) return null;
  const out = {};
  if (entries.length) out.entries = entries;
  if (carried.length) out.carried = carried;
  return out;
}

// Parse one intent.md into the canonical object shape. `path` is used only for
// error messages. Returns { intent, problems[] } — problems is empty on a clean
// parse; `validate` surfaces them, readers ignore them.
function parseIntentFile(text, path) {
  const problems = [];
  text = text.replace(/\r\n?/g, '\n'); // normalize CRLF/CR so the --- fence + ## headings parse on Windows
  let fmText = '', body = text;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) { fmText = text.slice(4, end); body = text.slice(end + 5); }
    else problems.push(`${path}: frontmatter opened with --- but never closed`);
  } else {
    problems.push(`${path}: no YAML frontmatter (--- block) at top of file`);
  }

  const fm = {};
  for (const line of fmText.split('\n')) {
    const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }

  const sections = splitSections(body);
  const intent = {
    id: normId(fm.id),
    phase: fm.phase !== undefined && fm.phase !== '' ? Number(fm.phase) : undefined,
    epic_id: fm.epic || fm.epic_id || '',
    confidence: fm.confidence || '',
    surface: fm.surface || '',
    priority: fm.priority || '',
    ratified: fm.ratified || '',
    // origin records provenance: 'scopezilla' = seeded from upstream output,
    // 'local' = authored in-repo (from meeting notes / an ask, via /ql-capture-intent).
    // reconcile relies on it so a locally-authored intent is never mistaken for
    // one upstream "deleted". Defaults to 'scopezilla' for files seeded before
    // this field existed.
    origin: (fm.origin || 'scopezilla').toLowerCase(),
    // source records WHICH upstream project and id an intent came from
    // (`discovery-2026#INT-003`, decisions/0082 W3). The engagement allocates its own
    // ids, so this is how a re-ingest finds the intent a source id maps to.
    source: fm.source || '',
    // snapshot marks a copy pulled from the tracker (decisions/0083); `pull` writes it.
    snapshot: fm.snapshot || '',
    title: fm.title || '',
    outcome: null,
    build_target: '',
    guardrails: [],
    out_of_scope: [],
    acceptance: '',
    success_criteria: [],
    dependencies: { internal: [], external: [] },
    open_questions: [],
    grounding: null,
  };

  for (const spec of SECTIONS) {
    const block = sections[spec.heading.toLowerCase()];
    if (block === undefined) continue;
    if (spec.kind === 'prose') intent[spec.key] = parseProse(block);
    else if (spec.kind === 'list') {
      const { items, stray } = parseListDetailed(block);
      intent[spec.key] = items;
      if (HASHED_LIST_KEYS.has(spec.key)) {
        if (stray.length) (intent[STRAY_LIST_TEXT] ||= []).push(...stray.map((s) => `${spec.heading}: "${s}"`));
        const legacy = parseList(block);
        if (JSON.stringify(legacy) !== JSON.stringify(items)) (intent[LEGACY_LISTS] ||= {})[spec.key] = legacy;
      }
    }
    else if (spec.kind === 'deps') intent.dependencies = parseDeps(block);
    else if (spec.kind === 'questions') intent.open_questions = parseQuestions(block);
    else if (spec.kind === 'outcome') intent.outcome = parseOutcome(block);
    else if (spec.kind === 'grounding') intent.grounding = parseGrounding(block);
  }

  // Validation problems (collected; only `validate` acts on them).
  if (!intent.id) problems.push(`${path}: missing "id:" in frontmatter`);
  if (intent.phase === undefined || Number.isNaN(intent.phase))
    problems.push(`${path}: missing or non-numeric "phase:" in frontmatter`);
  if (!intent.title) problems.push(`${path}: missing "title:" in frontmatter`);
  for (const key of REQUIRED_SECTIONS) {
    const spec = SECTIONS.find((s) => s.key === key);
    if (sections[spec.heading.toLowerCase()] === undefined)
      problems.push(`${path}: missing required "## ${spec.heading}" section`);
  }
  // Note: we deliberately do NOT flag "unrecognized ## headings" by scanning the
  // body — splitSections only captures canonical headings, so prose that contains a
  // line starting with "## " is left inside its section rather than mistaken for
  // a boundary (keeps the scope hash round-trip-stable). A typo'd *required*
  // heading is still caught above (the section goes missing). A typo'd *optional*
  // heading (Dependencies/Open questions) just leaves that non-hashed field empty
  // — not a drift risk, so we don't fail on it.

  return { intent, problems };
}

// Load all living intents. Returns the array in id order — same object shape the
// rest of this script and scope-digest.mjs expect from the old JSON.
//
// A MISSING intents/ directory is not an error — it's the normal pre-ingest state
// of a freshly scaffolded (or just-/ql-resync'd) repo. We return empty (with a
// `missing` flag for callers that want to print a friendlier "run
// /ql-ingest-scopezilla" note) rather than exiting, so a human running validate /
// drift / coverage before the first ingest gets a clean no-op, not an ENOENT
// crash. Only a genuine read error (permissions, a non-directory) hard-exits.
// The single discovery rule for living-intent directories (INT-NNN dirs under
// intents/). Both loadIntents and loadIntentsWithPath go through it so the filter
// can't diverge. Throws on a read error (ENOENT included) — callers decide whether
// a missing intents/ is "pre-ingest" (fine) or a real error (exit).
function intentDirNames() {
  return readdirSync(INTENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^INT-\d+/i.test(e.name))
    .map((e) => e.name);
}

function loadIntents({ withProblems = false } = {}) {
  let dirs;
  let missing = false;
  try {
    dirs = intentDirNames();
  } catch (e) {
    if (e.code === 'ENOENT') {
      missing = true;
      dirs = [];
    } else {
      console.error(`Could not read ${INTENTS_DIR}/: ${e.message}`);
      console.error('Run from the engagement repo root.');
      process.exit(2);
    }
  }
  const intents = [];
  const allProblems = [];
  for (const dir of dirs) {
    const path = `${INTENTS_DIR}/${dir}/intent.md`;
    let text;
    try { text = readFileSync(path, 'utf8'); }
    catch { allProblems.push(`${path}: directory ${dir}/ has no intent.md`); continue; }
    const { intent, problems } = parseIntentFile(text, path);
    intents.push(intent);
    allProblems.push(...problems);
  }
  intents.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return withProblems ? { intents, problems: allProblems, missing } : intents;
}

// True when the repo has no intents/ directory yet AND no per-intent files —
// the normal state of a freshly scaffolded or just-/ql-resync'd repo before the
// first /ql-ingest-scopezilla. The gate commands (validate/drift/coverage) treat
// this as a clean no-op rather than an error, so running them pre-ingest (or in
// CI on such a repo) doesn't fail. If the legacy scopezilla/data/intents.json is
// present, we point the user at /ql-ingest-scopezilla to migrate it.
function preIngestNotice() {
  const { intents, missing } = loadIntents({ withProblems: true });
  if (!missing && intents.length) return false;
  if (!missing && !intents.length) return false; // intents/ exists but empty — let normal flow report it
  const legacy = existsSync(RAW_JSON);
  console.log('intents/ not present yet — nothing to check.');
  console.log(legacy
    ? 'This repo still has the legacy scopezilla/data/intents.json. Run /ql-ingest-scopezilla to\n' +
      'transform it into living intents/ files (hash-stable), then this check applies.'
    : 'Run /ql-ingest-scopezilla once scope is available to seed intents/.');
  return true;
}

// The fields that define scope, and how each normalizes — the SINGLE source of
// truth for what the drift hash covers. Both hash entry points (scopeHash for
// parsed intents, reconcileHash for raw upstream JSON) go through it, so they can
// never disagree on what "scope" is or how it's shaped. Order fixes the canonical
// key order; changing this set is a deliberate change to drift detection.
const SCOPE_FIELDS = [
  ['title', 'scalar'],
  ['build_target', 'scalar'],
  ['guardrails', 'list'],
  ['out_of_scope', 'list'],
  ['acceptance', 'scalar'],
];

// Stable, shape-agnostic hash over SCOPE_FIELDS: the source shape (raw JSON vs
// parsed markdown) must not change the hash. Two normalizers by field kind, and
// each is shape-agnostic on its own terms:
//   • list  — coerces to an array, so a scalar "x" and a single-item ["x"] hash
//     identically (the scalar-vs-list divergence this unification fixed).
//   • scalar — stringifies; an ARRAY value is space-joined and then whitespace-
//     collapsed, so array-valued prose hashes the same as its \n-joined markdown
//     form (parseProse joins arrays with \n on read; the collapse erases the
//     difference). So re-wrapping a paragraph, or a JSON→markdown transform, never
//     trips drift regardless of whether prose arrives as a string or a list.
function hashScopeFields(obj) {
  const asArr = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]);
  const norm = {
    scalar: (v) => (Array.isArray(v) ? v.join(' ') : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim(),
    list: (v) => asArr(v).map((x) => String(x).replace(/\s+/g, ' ').trim()),
  };
  const canonical = JSON.stringify(
    Object.fromEntries(SCOPE_FIELDS.map(([key, kind]) => [key, norm[kind](obj[key])])));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

// Hash a parsed (markdown) intent. Thin wrapper over the shared normalizer.
function scopeHash(intent) {
  return hashScopeFields(intent);
}

// The PROOF hash a test script stamps (`proof_hash:`): the scope fields PLUS the
// success criteria. Two hashes, two jobs (issue #108, decisions/0061): the scope
// hash keeps the LEDGER quiet against edits that don't change what to build, so it
// excludes SC-x; the proof hash exists to catch "the intent changed after the
// script was authored", and an SC-x drives a proof criterion, so it includes them.
// An SC edit therefore flags the test script for a refresh — never the ledger.
function proofHash(intent) {
  const sc = (intent.success_criteria || []).map((x) => String(x).replace(/\s+/g, ' ').trim());
  return createHash('sha256').update(JSON.stringify({ scope: scopeHash(intent), success_criteria: sc })).digest('hex').slice(0, 12);
}

// The hash the pre-continuation list reading (bullet-only parseList) would have produced,
// or null when it would equal scopeHash (no wrapped/numbered list lines — the
// common case). A recorded stamp equal to this is an OLD-PARSER stamp of unchanged
// scope, not drift: callers warn and let `deliver` re-stamp it. Transitional.
function legacyScopeHash(intent) {
  const legacy = intent && intent[LEGACY_LISTS];
  return legacy ? hashScopeFields({ ...intent, ...legacy }) : null;
}

// ── intent.md serializer (used by from-json) ─────────────────────────────────
function renderList(arr) {
  if (!arr || !arr.length) return '_none_';
  return arr.map((x) => `- ${x}`).join('\n');
}

// Outcome → prose summary + optional Baseline/Target/Window metric bullets.
// Tolerant of the upstream shape: `outcome` may be a bare string (summary only)
// or { summary, metric: { baseline, target, window } }; the metric key is often
// absent (Scopezilla omits it rather than fabricate a baseline). Renders `_none_`
// when empty so the section round-trips to null on re-parse.
function renderOutcome(outcome) {
  if (!outcome) return '_none_';
  const o = typeof outcome === 'string' ? { summary: outcome } : outcome;
  const lines = [];
  if (o.summary) lines.push(String(o.summary).trim());
  const m = o.metric || {};
  const metricLines = [];
  if (m.baseline) metricLines.push(`- Baseline: ${String(m.baseline).trim()}`);
  if (m.target) metricLines.push(`- Target: ${String(m.target).trim()}`);
  if (m.window) metricLines.push(`- Window: ${String(m.window).trim()}`);
  if (metricLines.length) { if (lines.length) lines.push(''); lines.push(...metricLines); }
  return lines.length ? lines.join('\n') : '_none_';
}

// Grounding → "Label: value" bullets + an optional "### Carried" sub-block.
// Renders `_none_` when empty so the section round-trips to null on re-parse.
// The `carried` list is the loss-proofing: any upstream field with no first-class
// home is preserved here verbatim rather than dropped.
function renderGrounding(grounding) {
  const g = grounding || {};
  const entries = g.entries || [];
  const carried = g.carried || [];
  if (!entries.length && !carried.length) return '_none_';
  const lines = [];
  for (const e of entries) {
    const label = (e.label || '').trim();
    const value = (e.value || '').trim();
    lines.push(label ? `- ${label}: ${value}` : `- ${value}`);
  }
  if (carried.length) {
    if (lines.length) lines.push('');
    lines.push('### Carried (unmapped upstream fields)');
    for (const c of carried) {
      const key = (c.key || '').trim();
      lines.push(key ? `- ${key}: ${c.value}` : `- ${c.value}`);
    }
  }
  return lines.join('\n');
}

function renderDeps(deps) {
  const d = deps || {};
  const internal = (d.internal || []).map((x) => (typeof x === 'string' ? x : x.id || ''));
  const external = d.external || [];
  const out = ['### Internal'];
  out.push(internal.length ? internal.map((x) => `- ${x}`).join('\n') : '_none_');
  out.push('', '### External');
  if (external.length) {
    out.push(external.map((e) => {
      const owner = e.owner ? ` | owner: ${e.owner}` : '';
      return `- ${e.system || ''} | ${e.need || ''}${owner}`;
    }).join('\n'));
  } else out.push('_none_');
  return out.join('\n');
}

function renderQuestions(qs) {
  if (!qs || !qs.length) return '_none_';
  return qs.map((q) => {
    if (typeof q === 'string') return `- ${q}`;
    const id = q.id ? `${q.id}: ` : '';
    // Resolver ("who decides") renders inline right after the question text, the
    // SAME shape Scopezilla emits (`{question} (Resolver: {resolver})`) — so the
    // field survives the JSON→markdown ingest bridge instead of being dropped
    // (BIS feedback; SZ commit 7bddf4c). It sits BEFORE the status marker so the
    // ANSWERED/UNANSWERED delimiter still anchors the tail.
    const resolver = q.resolver ? ` (Resolver: ${q.resolver})` : '';
    const text = `${q.question || q.text || ''}${resolver}`;
    if (q.answer) return `- ${id}${text} — ANSWERED: ${q.answer}`;
    return `- ${id}${text} — UNANSWERED`;
  }).join('\n');
}

// The top-level upstream keys the transform already has a first-class home for.
// Anything on a raw intent NOT in this set (and not a known grounding key below)
// is "unmapped" and gets CARRIED into ## Grounding rather than dropped — that's
// what makes the ingest loss-proof by construction.
const MAPPED_KEYS = new Set([
  'id', 'phase', 'epic', 'epic_id', 'confidence', 'origin', 'source', 'source_ref', 'title',
  'outcome', 'build_target', 'guardrails', 'out_of_scope', 'acceptance',
  'success_criteria', 'dependencies', 'open_questions', 'grounding', 'surface', 'priority',
]);
// The SZ→QL grounding contract (scoping-agent#147). Scopezilla emits a nested
// `grounding` object; this is the shape we read it as first-class:
//   "grounding": {
//     "requirements": ["REQ-114", ...],                        // documented requirement ids
//     "artifacts": [{ "type": "architecture", "ref": "...",   // approved-arch / wireframe / etc.
//                     "location": "drive://..." }]             // pointer (optional)
//   }
// An artifact's `type` maps to its render label; an unknown type keeps its own
// name as the label (never dropped). We ALSO still read the flat aliases below,
// so an older SZ build (or a hand-authored intent) keeps working — and anything
// we don't recognize is still swept into `carried`, so the transform is
// loss-proof regardless of which shape upstream sends.
const ARTIFACT_TYPE_LABELS = {
  architecture: 'Architecture',
  arch: 'Architecture',
  wireframe: 'Wireframe',
  mockup: 'Wireframe',
  design: 'Design',
  requirement: 'Requirement',
  source: 'Source',
};
// Flat-field aliases (pre-contract / hand-authored tolerance).
const GROUNDING_LABELS = [
  [['requirement_id', 'requirement', 'req_id', 'requirementId'], 'Requirement'],
  [['architecture', 'architecture_ref', 'arch_artifact', 'arch_ref', 'approved_architecture'], 'Architecture'],
  [['wireframe', 'wireframe_ref'], 'Wireframe'],
  [['source_artifact', 'source', 'source_doc'], 'Source'],
];

// Build the { entries, carried } grounding object for one raw upstream intent.
// - entries  = grounding mapped to friendly labels — from the nested contract
//              shape (requirements[]/artifacts[]) first, then flat aliases.
// - carried  = EVERY other upstream key/subkey with no schema home, preserved
//              verbatim (value JSON-stringified when not a scalar), so a field
//              the transform didn't anticipate is surfaced and kept, never lost.
// If `i.grounding` is already the parsed { entries, carried } shape (a
// re-serialize of a living intent), it's used as-is.
function buildGrounding(i) {
  if (i.grounding && (Array.isArray(i.grounding.entries) || Array.isArray(i.grounding.carried))) {
    return i.grounding;
  }
  const entries = [];
  const carried = [];
  const seenFlat = new Set();
  const scalarize = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const nested = i.grounding && typeof i.grounding === 'object' && !Array.isArray(i.grounding) ? i.grounding : {};
  const nestedHandled = new Set();

  // ── Contract shape: grounding.requirements[] ─────────────────────────────
  if (Array.isArray(nested.requirements)) {
    nestedHandled.add('requirements');
    for (const r of nested.requirements) {
      const value = typeof r === 'object' && r ? (r.id || r.ref || scalarize(r)) : scalarize(r);
      if (value) entries.push({ label: 'Requirement', value: String(value).trim() });
    }
  }
  // ── Contract shape: grounding.artifacts[] ────────────────────────────────
  if (Array.isArray(nested.artifacts)) {
    nestedHandled.add('artifacts');
    for (const a of nested.artifacts) {
      if (a == null) continue;
      if (typeof a !== 'object') { entries.push({ label: 'Artifact', value: scalarize(a) }); continue; }
      const type = String(a.type || '').toLowerCase().trim();
      const label = ARTIFACT_TYPE_LABELS[type] || (a.type ? String(a.type).trim() : 'Artifact');
      const ref = (a.ref || a.reference || a.name || '').toString().trim();
      const rawLoc = (a.location || a.url || a.href || '').toString().trim();
      // A project-relative location (no URL scheme) resolves under the read-only
      // scopezilla/ mirror of a pre-0082 repo — prefix it so the rendered
      // citation actually opens, instead of a bare `decisions/00XX.md` that reads
      // as repo-root-relative and 404s. A scheme-qualified location (http://,
      // drive://, figma://, …) already points somewhere real; leave it alone.
      // The ingest mirror renames two outputs/ paths (outputs/quantum-leap/ →
      // build-bundle/, top-level outputs/*.md → deliverables/), so a location
      // under them is renamed to match or it dangles.
      // From a tied source (decisions/0082 W3) the location is source-qualified and
      // pinned to the reviewed commit, `<source>:<path>@<sha>`, read in place with
      // `source show`; nothing points into a mirror.
      const local = rawLoc && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rawLoc) && !rawLoc.startsWith('scopezilla/');
      const loc = !local ? rawLoc
        : i.source_ref ? `${i.source_ref.name}:${rawLoc}${i.source_ref.at ? `@${i.source_ref.at.slice(0, 12)}` : ''}`
        : `scopezilla/${rawLoc.replace(/^outputs\/quantum-leap\//, 'build-bundle/').replace(/^outputs\/(?=[^/]+$)/, 'deliverables/')}`;
      const value = [ref, loc && `(${loc})`].filter(Boolean).join(' ') || scalarize(a);
      entries.push({ label, value });
    }
  }

  // ── Flat aliases (older SZ / hand-authored), nested or top-level ──────────
  for (const [keys, label] of GROUNDING_LABELS) {
    for (const k of keys) {
      const v = i[k] !== undefined ? i[k] : nested[k];
      if (v !== undefined && v !== null && v !== '') {
        entries.push({ label, value: scalarize(v) });
        seenFlat.add(k);
        if (nested[k] !== undefined) nestedHandled.add(k);
        break; // one entry per label — first matching alias wins
      }
    }
  }

  // ── Loss-proofing: carry everything with no home, verbatim ───────────────
  for (const [k, v] of Object.entries(i)) {
    if (MAPPED_KEYS.has(k) || seenFlat.has(k)) continue;
    if (v === undefined || v === null || v === '') continue;
    carried.push({ key: k, value: scalarize(v) });
  }
  for (const [k, v] of Object.entries(nested)) {
    if (nestedHandled.has(k) || k === 'entries' || k === 'carried') continue;
    if (v === undefined || v === null || v === '') continue;
    carried.push({ key: k, value: scalarize(v) });
  }

  if (!entries.length && !carried.length) return null;
  const out = {};
  if (entries.length) out.entries = entries;
  if (carried.length) out.carried = carried;
  return out;
}

// Turn one raw-JSON intent into intent.md text. Tolerant of the upstream shape:
// guardrails/out_of_scope may be arrays or strings; epic may be `epic` or `epic_id`.
function serializeIntent(i) {
  const asList = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)]);
  const fm = [
    '---',
    `id: ${(i.id || '').toUpperCase()}`,
    `phase: ${i.phase ?? ''}`,
    `epic: ${i.epic_id || i.epic || ''}`,
    `confidence: ${i.confidence || ''}`,
    // Scopezilla's deliverable-shape tag and the architect's priority. Optional, and
    // outside the scope hash; written only when set (a draft's priority is null).
    ...(i.surface ? [`surface: ${i.surface}`] : []),
    ...(i.priority != null && i.priority !== '' ? [`priority: ${i.priority}`] : []),
    `origin: ${i.origin || 'scopezilla'}`,
    ...(i.source ? [`source: ${i.source}`] : []),
    `title: ${i.title || ''}`,
    '---',
  ].join('\n');
  const parts = [
    fm,
    '',
    `# ${(i.id || '').toUpperCase()} — ${i.title || ''}`,
    '',
    '## Outcome', '', renderOutcome(i.outcome),
    '', '## Build target', '', parseProse(i.build_target) || '_TODO_',
    '', '## Guardrails', '', renderList(asList(i.guardrails)),
    '', '## Out of scope', '', renderList(asList(i.out_of_scope)),
    '', '## Acceptance', '', parseProse(i.acceptance) || '_TODO_',
    '', '## Success criteria', '', renderList(asList(i.success_criteria)),
    '', '## Dependencies', '', renderDeps(i.dependencies),
    '', '## Open questions', '', renderQuestions(i.open_questions),
    '', '## Grounding', '', renderGrounding(buildGrounding(i)),
    '',
  ];
  return parts.join('\n');
}

// Parse ledger markdown table TEXT. Column positions are discovered from the
// header row by name, so the table can gain/reorder columns without breaking us.
// Split out from parseLedger so the same parser can read a ledger at a git ref
// (the `regression` guard compares the PR's table against the base branch's).
// One way to read an intent id out of a table cell — used by the parser, by the
// row matchers in `start`/`deliver`, and by the duplicate scan. It strips the
// same markdown decoration `stampStatus` strips, because a decorated id is still
// that id and reading it any other way silently DROPS the row: `` `INT-003` ``
// failed the /^INT-\d+/ test, so the parser skipped it, every gate concluded the
// intent had no ledger row, and `start` appended a SECOND row for an intent
// already stamped ✅ Delivered two rows above. Decoration on an id is not exotic —
// this table's own hash cells are backticked.
function idCellValue(raw) {
  return String(raw || '').replace(/[`*~]/g, '').trim();
}

function parseLedgerText(text) {
  const rows = text.split('\n').filter((l) => l.trim().startsWith('|'));
  // ledgerExists is TRUE here: we are holding the file's text. Omitting it made
  // every `ledgerExists && !headerFound` guard silently unreachable on precisely
  // the input it was written for — an emptied or table-less ledger — because
  // `undefined && …` is falsy. The file existing and the table being readable are
  // two different facts and each caller needs to tell them apart.
  if (rows.length < 2) return { byId: {}, dupes: [], headerFound: false, ledgerExists: true };

  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(rows[0]).map((h) => h.toLowerCase());
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  const hashCol = header.findIndex((h) => h.includes('hash'));
  const prCol = header.findIndex((h) => h === 'pr');
  const evidenceCol = header.findIndex((h) => h === 'evidence');

  const byId = {};
  // Two rows normalizing to one id are RECORDED, not silently merged. This map is a
  // bare assignment, so the last row in the file wins — which means normalizing the
  // key (so a decorated id no longer drops out) turned a dropped duplicate into one
  // that OVERWRITES the real row: `` `INT-001` | ⬜ Not started `` below
  // `INT-001 | ✅ Delivered` erased the stamp, and `coverage --gate` then passed an
  // input it used to fail. Only the parser can see the collision; throwing that
  // away leaves every caller reading one confident, wrong answer.
  const dupes = [];
  for (const line of rows.slice(2)) {
    const c = cells(line);
    const id = idCellValue(c[idCol]);
    if (!/^INT-\d+/i.test(id)) continue;
    if (byId[id.toUpperCase()] && !dupes.includes(id.toUpperCase())) dupes.push(id.toUpperCase());
    byId[id.toUpperCase()] = {
      status: c[statusCol] || '',
      hash: (c[hashCol] || '').replace(/[`*]/g, '').trim(),
      pr: c[prCol] || '',
      evidence: evidenceCol === -1 ? '' : (c[evidenceCol] || ''),
    };
  }
  return { byId, dupes, headerFound: idCol !== -1 && hashCol !== -1 && statusCol !== -1, ledgerExists: true };
}

// Parse the ledger markdown table from the working tree.
function parseLedger({ soft = false } = {}) {
  let text;
  try {
    text = readFileSync(LEDGER, 'utf8');
  } catch (e) {
    if (soft) return { byId: {}, dupes: [], headerFound: false, ledgerExists: false };
    console.error(`Could not read ${LEDGER}: ${e.message}`);
    console.error(`Seed it first:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }
  return parseLedgerText(text);
}

const STATUS = {
  notStarted: '⬜ Not started',
  inProgress: '🔧 In progress',
  delivered: '✅ Delivered',
  drift: '🔄 Needs re-verify',
  // A scoped (and possibly partially built) intent that was deliberately pulled
  // from delivery. TERMINAL and untracked: its scope is no longer being verified,
  // so drift/coverage/conformance exclude it. Distinct from ⬜ Not started, which
  // means "nobody picked it up yet" — the opposite end of the lifecycle (issue #139).
  // 🚫 (not ⛔, which already means "blocked" in test-script criteria).
  retired: '🚫 Retired',
};

// ── ledger row/footer upkeep ─────────────────────────────────────────────────
// The ledger's closing sentence opens with a literal intent count ("_37 intents
// — the engagement …"). It's the one hand-maintained number in a file the docs
// say never to hand-edit, so it drifts: observed nine rows behind reality.
// Every path that writes the ledger now re-derives it, and `validate` gates it.
// The narrative prose after the count is human-authored and left untouched.
// The ids in the ledger's table rows, in file order. This runs the SAME row scan
// as parseLedgerText — Intent column discovered from the header, bold stripped,
// whole cell kept — so the ids it names match the keys the parser uses. It can't
// simply call parseLedgerText because that collapses a duplicated row into one
// key, hiding the very thing this is used to REPORT. Two ways an earlier
// positional regex diverged from the parser, both now covered:
// it read the id from cell 0 (wrong on a reordered table, which the header
// lookup exists to support) and captured only `INT-\d+` (truncating a suffixed
// `INT-012a` onto `INT-012`, so two distinct intents collapsed into a phantom
// duplicate). Duplicates are PRESERVED: the caller decides whether to count
// them (it must not) or report them (it must).
function ledgerRowIds(lines) {
  const rows = lines.filter((l) => l.trim().startsWith('|'));
  if (rows.length < 2) return [];

  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const idCol = cells(rows[0]).map((h) => h.toLowerCase()).findIndex((h) => h === 'intent');
  if (idCol === -1) return [];

  const ids = [];
  for (const line of rows.slice(2)) {
    const id = idCellValue(cells(line)[idCol]);
    if (!/^INT-\d+/i.test(id)) continue;
    ids.push(id.toUpperCase());
  }
  return ids;
}

function refreshFooterCount(lines) {
  // Count through parseLedgerText — the SAME function `validate` compares this
  // footer against — so the two cannot drift apart by construction. Counting any
  // other way is unrecoverable when it disagrees: `validate` fails on the
  // mismatch and `sync`, being additive, sees nothing missing and declines, so
  // CI stays red with no exit but hand-editing the file the docs say never to
  // hand-edit. Two earlier versions each had such a divergence (matching lines,
  // then a separate id scan); deriving from the parser removes the whole class.
  const parsed = parseLedgerText(lines.join('\n'));
  // A malformed table is another check's problem — never rewrite the count from
  // one. Notably this must not early-return on a count of ZERO: a ledger whose
  // rows are all gone still needs its footer corrected, and refusing to touch it
  // was itself a deadlock.
  if (!parsed.headerFound) return { updated: false };
  const rowCount = Object.keys(parsed.byId).length;
  const i = lines.findIndex((l) => /^_\d+ intents\b/.test(l));
  if (i === -1) return { updated: false };
  const was = Number(lines[i].match(/^_(\d+) intents\b/)[1]);
  if (was === rowCount) return { updated: false };
  lines[i] = lines[i].replace(/^_\d+ intents\b/, `_${rowCount} intents`);
  return { updated: true, was, now: rowCount };
}

// Build a ledger row for `intent` that respects the header's actual column
// layout (default every cell to "—", then fill id/phase/status), so a
// customized or reordered ledger stays valid. Shared by `start` and `new`.
function buildLedgerRow(header, intent, status = STATUS.notStarted) {
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  const phaseCol = header.findIndex((h) => h === 'phase');
  const cells = header.map(() => '—');
  cells[idCol] = intent.id;
  if (phaseCol !== -1) cells[phaseCol] = String(intent.phase ?? '—');
  cells[statusCol] = status;
  return `| ${cells.join(' | ')} |`;
}

// Ensure `intent` has a ledger row, creating a ⬜ Not started one if it doesn't.
// This is what makes a row a BYPRODUCT of creating an intent rather than a step
// someone remembers: `new` calls it, so the common path can't produce an intent
// that is invisible to the ledger and the README index derived from it.
// Idempotent — returns { created:false } when a row already exists.
function ensureLedgerRow(intent) {
  let text;
  try { text = readFileSync(LEDGER, 'utf8'); }
  catch { return { created: false, reason: 'no-ledger' }; }

  const lines = text.split('\n');
  const table = lines.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
  if (table.length < 2) return { created: false, reason: 'no-table' };

  const cellsOf = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = cellsOf(table[0][0]).map((h) => h.toLowerCase());
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  if (idCol === -1 || statusCol === -1) return { created: false, reason: 'no-columns' };

  const wanted = intent.id.toUpperCase();
  const exists = table.slice(2).some(([line]) =>
    idCellValue(cellsOf(line)[idCol]).toUpperCase() === wanted);
  if (exists) return { created: false, reason: 'already-present' };

  // Insert after the ledger table's LAST row — the last line of the contiguous
  // pipe-row run that starts at the header. `table` collects every pipe-prefixed
  // line in the file, so its final entry could belong to a SECOND markdown table
  // below the ledger (an engagement-notes table); appending there would drop the
  // row into the wrong table. Walk the run while it stays contiguous and stop at
  // the first gap.
  let insertAfter = table[0][1];
  for (const [, idx] of table) {
    if (idx === insertAfter || idx === insertAfter + 1) insertAfter = idx;
    else break;
  }
  lines.splice(insertAfter + 1, 0, buildLedgerRow(header, intent));
  const footer = refreshFooterCount(lines);
  writeLedgerLines(lines);
  return { created: true, footer };
}

// Write the ledger back with ONE line ending. Readers split on '\n', so on a CRLF
// checkout (Windows, core.autocrlf) untouched lines keep their '\r' while a row
// rebuilt from trimmed cells loses it — a mixed-EOL file and a noisy diff. Keep
// whichever ending the file came in with.
function writeLedgerLines(lines) {
  const crlf = lines.some((l) => l.endsWith('\r'));
  writeFileSync(LEDGER, lines.map((l) => l.replace(/\r$/, '')).join(crlf ? '\r\n' : '\n'));
}

// ── ratification ─────────────────────────────────────────────────────────────
// A Trusted Guide RATIFIES an intent: reads it, corrects it, stands behind it.
// Recorded in frontmatter as `ratified: YYYY-MM-DD by <name> @ <scope-hash>`,
// written by `ratify` when the human says so (the agent records; it never
// ratifies its own draft). Binding it to the scope hash makes a later scope edit
// visible, like drift. Frontmatter isn't hashed, so writing it never drifts.
// On a refinement the line also carries the Trusted Guide's call
// (` · absorbed` or ` · scope-change`, decisions/0076); older lines have none.
const RATIFIED_RE = /^(\d{4}-\d{2}-\d{2}) by (.+?) @ ([0-9a-f]{12})(?: · (absorbed|scope-change))?$/;
const RATIFIED_SHAPE = '"YYYY-MM-DD by <name> @ <scope-hash>[ · absorbed|scope-change]"';

// { state, date, by, hash, call }: 'current' (ratified at this scope), 'stale'
// (ratified, then scope changed), 'missing', or 'malformed'.
function ratificationOf(intent) {
  const raw = (intent.ratified || '').trim();
  if (!raw) return { state: 'missing' };
  const m = raw.match(RATIFIED_RE);
  if (!m) return { state: 'malformed', raw };
  const [, date, by, hash, call] = m;
  return { state: hash === scopeHash(intent) ? 'current' : 'stale', date, by, hash, call };
}

// A one-line human description of an unratified intent, or '' when current.
function ratificationNote(intent) {
  const r = ratificationOf(intent);
  if (r.state === 'current') return '';
  if (r.state === 'stale') return `scope changed since ${r.by} ratified it on ${r.date} (@ ${r.hash}) — re-ratify with their call on the edit (--absorbed or --scope-change)`;
  if (r.state === 'malformed') return `its \`ratified:\` line doesn't read as ${RATIFIED_SHAPE}`;
  return intent.confidence === 'draft' ? 'it is an unratified draft (confidence: draft)' : 'no ratification is recorded';
}

function cmdRatify(filterId, by, call) {
  if (!filterId || !/^INT-\d+/i.test(filterId) || !by || !by.trim() || by.startsWith('--')) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs ratify INT-xxx --by "<Trusted Guide name>" [--absorbed|--scope-change]');
    console.error('Run it when the Trusted Guide has read the intent and stands behind it — never on an agent\'s own say-so.');
    process.exit(2);
  }
  const wanted = filterId.toUpperCase();
  const found = loadIntentsWithPath().find(({ intent }) => intent.id.toUpperCase() === wanted);
  if (!found) {
    console.error(`${wanted} is not a known intent (no intents/${wanted.toLowerCase()}/intent.md).`);
    process.exit(1);
  }
  const { intent, path } = found;
  const raw = readFileSync(path, 'utf8');
  const crlf = /\r\n/.test(raw);
  const text = raw.replace(/\r\n?/g, '\n'); // same normalization as parseIntentFile; EOL restored on write
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  if (end === -1) {
    console.error(`${path} has no frontmatter block — run \`validate\` and fix it first.`);
    process.exit(1);
  }
  const who = by.trim().replace(/\s+/g, ' ');
  // A plain re-ratify at the same scope keeps the call already recorded for it.
  const prior = ratificationOf(intent);
  const kept = call || (prior.state === 'current' ? prior.call : undefined);
  const line = `ratified: ${new Date().toISOString().slice(0, 10)} by ${who} @ ${scopeHash(intent)}${kept ? ` · ${kept}` : ''}`;
  const fm = text.slice(4, end).split('\n').filter((l) => !/^ratified\s*:/.test(l));
  fm.push(line);
  const out = `---\n${fm.join('\n')}${text.slice(end)}`;
  writeFileSync(path, crlf ? out.replace(/\n/g, '\r\n') : out);
  console.log(`${wanted}: ${line}`);
}

function cmdHash(filterId, { proof = false } = {}) {
  const intents = loadIntents();
  const wanted = filterId ? filterId.toUpperCase() : null;
  let any = false;
  for (const i of intents) {
    if (wanted && i.id.toUpperCase() !== wanted) continue;
    any = true;
    console.log(`${i.id}\t${proof ? proofHash(i) : scopeHash(i)}\t${i.title}`);
  }
  if (!any) {
    console.error(`No intent matched "${filterId}".`);
    process.exit(1);
  }
}

// Build a fresh ledger's full markdown text (one ⬜ row per intent). Returned as
// a string so both `seed` (prints it) and `sync` (writes it when no ledger
// exists yet) share one definition of what a seeded ledger looks like.
function seedLedgerText() {
  const intents = loadIntents();
  const phases = [...new Set(intents.map((i) => i.phase))].sort((a, b) => a - b);
  const out = [];
  out.push('# Intent delivery ledger\n');
  out.push('> The backward link between scope and delivery. `intents/INT-NNN/intent.md`');
  out.push('> is the canonical WHAT (living — refined in-repo); this file tracks STATUS —');
  out.push('> which intent was built, in which PR, with what evidence, against which version');
  out.push('> of the scope.');
  out.push('>');
  out.push('> **Written by the ledger commands, not by hand.** `start INT-00x` opens a row');
  out.push('> (🔧 In progress); `deliver INT-00x --pr <ref>` closes it out as you assemble the');
  out.push('> PR — atomically flipping to ✅ Delivered, stamping the current scope hash, and');
  out.push('> refreshing the README index. When `drift` finds a delivered intent whose');
  out.push('> scope moved after you built it, `reverify INT-00x` flips the row to 🔄 (keeping');
  out.push('> the hash + PR); `deliver` re-stamps it once the build is re-verified.\n');
  out.push('Status: ⬜ Not started · 🔧 In progress · ✅ Delivered · 🔄 Needs re-verify (scope drifted) · 🚫 Retired (de-scoped)\n');
  out.push('| Intent | Phase | Status | PR | Evidence | Scope hash @ delivery |');
  out.push('|--------|-------|--------|----|----------|-----------------------|');
  for (const i of intents) {
    out.push(`| ${i.id} | ${i.phase} | ${STATUS.notStarted} | — | — | — |`);
  }
  out.push(`\n_${intents.length} intents across phase(s) ${phases.join(', ')}. ` +
    `Seeded from \`${INTENTS_DIR}/\`._`);
  return out.join('\n');
}

function cmdSeed() {
  console.log(seedLedgerText());
}

// `gatedIds`:
//   null    → gate every tracked row (manual runs, re-ingest — the default).
//   Set<ID> → only these ids can FAIL the check; drift on any other tracked row
//             is reported as a `::warning::`, not a failure. This is the CI
//             blast-radius fix (issue #91): one intent's stale hash must not red
//             every other intent's PR. CI passes the set of intents THIS PR
//             touched; an empty Set gates nothing (a PR touching no intents).
function cmdDrift(gatedIds = null) {
  if (preIngestNotice()) process.exit(0);
  const intents = loadIntents();
  const { byId, headerFound, dupes } = parseLedger();
  if (!headerFound) {
    console.error(`Could not find Intent/Status/Scope-hash columns in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }
  // Only the last row for an id is read, so a duplicate hides whatever the earlier
  // row said — including a ✅ Delivered this would otherwise track for drift.
  if (dupes.length) {
    console.error(`${LEDGER} has more than one row for ${dupes.join(', ')}, so their delivery status`);
    console.error('is ambiguous and drift can\'t be judged. Remove the duplicate row(s), then re-run.');
    process.exit(2);
  }
  const current = Object.fromEntries(intents.map((i) => [i.id.toUpperCase(), scopeHash(i)]));
  const legacy = Object.fromEntries(intents.map((i) => [i.id.toUpperCase(), legacyScopeHash(i)]));
  const isGated = (id) => gatedIds === null || gatedIds.has(id);

  const drifted = [];
  const driftedUntouched = [];
  const missing = [];
  const missingUntouched = [];
  const unreadable = [];
  const unreadableUntouched = [];
  const stampNeeded = [];
  const stampNeededUntouched = [];
  const acknowledged = [];
  const oldParserStamp = [];

  for (const [id, row] of Object.entries(byId)) {
    // Only DELIVERED (or already-flagged 🔄 Needs re-verify) rows carry a drift
    // signal. A 🔧 In progress intent is under active edit — its scope changing is
    // EXPECTED, not drift — so it is deliberately NOT tracked here (issue #91). This
    // removes the biggest false-positive source: editing the intent you're building.
    const trackedStatus = stampStatus(row.status);
    // A row this can't grade is a row it didn't check — say so instead of
    // dropping it, because "not tracked" and "unreadable" are different facts and
    // only one of them is a deliberate choice.
    if (trackedStatus === null) {
      (isGated(id) ? unreadable : unreadableUntouched).push(id);
      continue;
    }
    const isTracked = trackedStatus === STATUS.delivered || trackedStatus === STATUS.drift;
    if (!isTracked) continue;
    const cur = current[id];
    if (!cur) {
      (isGated(id) ? missing : missingUntouched).push(id);
      continue;
    }
    // A Delivered row with no stamp can never drift — it passes every gate by
    // having nothing to compare. Same scoping as drift: fail for an intent this
    // change touched, warn for the rest.
    if (!row.hash || row.hash === '—' || row.hash === '-') {
      (isGated(id) ? stampNeeded : stampNeededUntouched).push(id);
      continue;
    }
    if (row.hash !== cur && row.hash === legacy[id]) {
      oldParserStamp.push({ id, recorded: row.hash, current: cur });
      continue;
    }
    if (row.hash !== cur && trackedStatus === STATUS.drift) {
      acknowledged.push({ id, recorded: row.hash, current: cur });
      continue;
    }
    if (row.hash !== cur) {
      (isGated(id) ? drifted : driftedUntouched).push({ id, recorded: row.hash, current: cur, pr: row.pr });
    }
  }

  let problems = 0;

  // 🔄 Needs re-verify with a moved hash: drift already acknowledged in the ledger.
  for (const d of acknowledged) {
    console.log(`::notice::${d.id} is 🔄 Needs re-verify (recorded ${d.recorded} → now ${d.current}) — ` +
      `acknowledged; re-verify the build, then \`deliver ${d.id}\` re-stamps it.`);
  }
  // Stamped by the pre-continuation list parser over scope that hasn't changed
  // since — not drift, but the stamp covers less text than the hash now does.
  for (const d of oldParserStamp) {
    console.log(`::warning::${d.id}: scope stamp ${d.recorded} predates the list-parser fix — it never covered ` +
      `wrapped or numbered Guardrails / Out-of-scope lines, so an edit to those since delivery can't be ruled out. ` +
      `Re-verify them against the build, then re-stamp to ${d.current}: node launchpad/scripts/intent-ledger.mjs deliver ${d.id}`);
  }

  if (drifted.length) {
    problems += drifted.length;
    console.log('🔄 SCOPE DRIFT — these intents changed AFTER they were delivered:');
    for (const d of drifted) {
      console.log(`   ${d.id}  recorded ${d.recorded} → now ${d.current}` +
        (d.pr && d.pr !== '—' ? `  (delivered in ${d.pr})` : ''));
    }
    console.log('   → Acknowledge it in this change:  node launchpad/scripts/intent-ledger.mjs reverify <INT-xxx>');
    console.log('     (flips the row to 🔄 Needs re-verify). Then re-verify the build against the new intent');
    console.log('     text and run `deliver` to re-stamp. If the build already holds, `reverify` then `deliver`.');
    console.log('   Scope hash = title · build target · guardrails · out of scope · acceptance. Editing one of');
    console.log('   these is what tripped this. Outcome, Success criteria, Dependencies, Grounding, and Open');
    console.log('   questions are context — editing them never drifts a delivered intent.\n');
  }
  // Drift on an intent THIS PR didn't touch (base moved, an unrelated refine) — real,
  // but not this PR's responsibility, so it's surfaced (never swallowed) as a warning.
  for (const d of driftedUntouched) {
    console.log(`::warning::Scope drift on ${d.id} (recorded ${d.recorded} → now ${d.current}) — ` +
      `not touched by this change; re-verify and re-deliver on its own branch.`);
  }
  if (stampNeeded.length) {
    problems += stampNeeded.length;
    console.log('⛔ Delivered but no scope hash recorded (drift can\'t be detected):');
    for (const id of stampNeeded) console.log(`   ${id}  →  re-verify, then: node launchpad/scripts/intent-ledger.mjs deliver ${id}`);
    console.log('');
  }
  for (const id of stampNeededUntouched) {
    console.log(`::warning::${id} is Delivered but has no scope hash recorded, so drift can't be detected — ` +
      `not touched by this change; re-verify and run \`deliver ${id}\` on its own branch.`);
  }
  if (missing.length) {
    problems += missing.length;
    console.log('⚠️  Ledger tracks intents not present in intents/ (renamed/removed?):');
    for (const id of missing) console.log(`   ${id}`);
    console.log('');
  }
  for (const id of missingUntouched) {
    console.log(`::warning::Ledger tracks ${id} but no intents/ file is present — not touched by this change.`);
  }
  if (unreadable.length) {
    problems += unreadable.length;
    console.log('⛔ Status cell unreadable — NOT checked for drift (the marker must come first):');
    for (const id of unreadable) console.log(`   ${id}`);
    console.log('   → node launchpad/scripts/intent-ledger.mjs validate  (names the exact rows)\n');
  }
  for (const id of unreadableUntouched) {
    console.log(`::warning::${id}: ledger Status doesn't begin with a marker, so it was not checked for drift — ` +
      `not touched by this change.`);
  }

  if (!problems && !stampNeeded.length) {
    const warned = driftedUntouched.length + missingUntouched.length + unreadableUntouched.length + stampNeededUntouched.length + oldParserStamp.length;
    console.log(warned
      ? `✅ No drift on the intents this change touched. (${warned} warning(s) above are on intents it didn't touch.)`
      : '✅ No drift. Every delivered intent matches its recorded scope hash.');
  }
  process.exit(problems ? 1 : 0);
}

// ── validate ─────────────────────────────────────────────────────────────────
// The safety net that makes living intent files safe. A malformed file (bad
// frontmatter, renamed heading) could make drift compute over empty content and
// LIE about whether scope moved — the single worst failure. CI gates on this.
// Ledger structural integrity — column count, status vocabulary, hash cell shape.
// `validate` is described as the gate that keeps the ledger well-formed "so drift
// detection can be trusted"; without this a hand-added or merge-mangled row (wrong
// column count, unknown status, junk in the hash cell) passed clean and only
// surfaced later when `deliver` silently rewrote the row's shape (issue #94).
// Returns problem strings; empty when there's no ledger yet (pre-ingest) or no table.
function validateLedgerShape() {
  let text;
  try { text = readFileSync(LEDGER, 'utf8'); }
  catch { return []; }
  const rows = text.split('\n').map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
  const problems = [];
  // The file exists (we just read it) but holds no table. Returning clean here made
  // validate pass on an EMPTIED ledger while failing on the milder case of a ledger
  // whose header survived and rows didn't — the strictly worse input reported
  // healthier. A destroyed table is the loudest thing this check can find.
  if (rows.length < 2) {
    problems.push(`${LEDGER} exists but contains no table, so no delivery status can be read from it. ` +
      'If it held stamps, restore it from git history; otherwise re-seed:  ' +
      'node launchpad/scripts/intent-ledger.mjs seed > ' + LEDGER);
    return problems;
  }
  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(rows[0][0]);
  const cols = header.length;
  const statusIdx = header.findIndex((h) => h.toLowerCase() === 'status');
  const hashIdx = header.findIndex((h) => h.toLowerCase().includes('hash'));
  const idIdx = header.findIndex((h) => h.toLowerCase() === 'intent');
  // A header cell this can't locate is a problem to REPORT, not a reason to skip
  // the per-row checks silently. Bolding one (`**Status**`) or renaming it
  // (`State`) left every row unchecked here AND unreadable to every gate, so a
  // delivered-but-unproven intent passed both. Same shape as every other finding
  // on this file: a lookup that failed was treated as a column with nothing to say.
  // All three are checked, not just Status — parseLedgerText needs Intent, Status
  // AND a hash column to read a single row, so any one of them missing leaves the
  // gates with nothing while validate reported the ledger clean.
  for (const [name, idx, exact] of [['Intent', idIdx, true], ['Status', statusIdx, true], ['Scope hash', hashIdx, false]]) {
    if (idx !== -1) continue;
    problems.push(`ledger header: no \`${name}\` column found — the cell must ` +
      (exact ? `read exactly "${name}"` : 'contain "hash"') +
      ' (no bold, no rename), or no command can read this table');
  }
  for (const [line, lineNo] of rows.slice(2)) { // rows[1] is the |---| separator
    const c = cells(line);
    // Label the row by its Intent cell wherever that column actually is — reading
    // position 0 named the row after its Phase on a reordered table, and collided
    // with the `line N` fallback's own wording.
    const rowId = idCellValue(c[idIdx !== -1 ? idIdx : 0]) || `line ${lineNo + 1}`;
    if (c.length !== cols) {
      problems.push(`ledger row ${rowId}: has ${c.length} column(s), header has ${cols} — every row must match the header's column count`);
      continue; // a column-shifted row would mis-report its status/hash cells too
    }
    if (statusIdx !== -1) {
      const st = (c[statusIdx] || '').trim();
      // The status must LEAD with a marker, not merely contain one somewhere.
      // A substring test here was the same bug the gates had, in the one check
      // whose entire job is to reject a malformed cell: it passed
      // "Was ✅ Delivered, now reopened", "(re-stamped) ✅ Delivered" and
      // "partially delivered", each of which then read as null in every gate
      // downstream — so the rows nothing could grade were exactly the rows this
      // check waved through. Validating with the same function the gates read
      // with is what makes "a valid ledger is a gradeable ledger" true.
      if (stampStatus(st) === null) {
        problems.push(`ledger row ${rowId}: Status "${st}" does not begin with a recognized marker — ` +
          `expected ⬜ Not started · 🔧 In progress · ✅ Delivered · 🔄 Needs re-verify · 🚫 Retired. ` +
          `An annotation may follow it (e.g. "✅ Delivered (stamp rode the QA PR)"), but the marker comes first.`);
      }
    }
    if (hashIdx !== -1) {
      const h = (c[hashIdx] || '').replace(/[`*]/g, '').trim();
      if (h && !/^[—–-]$/.test(h) && !/^[0-9a-f]{6,64}$/i.test(h)) {
        problems.push(`ledger row ${rowId}: Scope-hash cell "${h}" is neither a placeholder (—) nor a hex hash`);
      }
    }
  }
  return problems;
}

// Parity between intents/ and the ledger table, plus the derived footer count.
// Both directions matter and they fail differently:
//   intent with no row  → invisible to every status gate; nothing to check, so
//                         nothing complains, so it can sit that way for weeks.
//   row with no intent  → a phantom the README index renders with no title, and
//                         a scope hash that can never be verified.
// Ledger rows for intents deliberately moved OUT of the working set (the Phase 2
// set under deferred/) are not a concern here: those rows were removed with the
// directories, so parity holds. A row kept on purpose for a merged/retired id
// still has its intents/ directory, so it passes.
function validateLedgerPresence(intents) {
  const { byId, headerFound, ledgerExists } = parseLedger({ soft: true });
  // A ledger that EXISTS but can't be read is this function's business; one that
  // isn't there at all is not. `validate` runs on repos mid-scaffold, where intent
  // directories legitimately precede the generated ledger, so failing here fails a
  // healthy repo — and the loss case it was reaching for (a branch deleting the
  // file) is proven by `regression`, which reads base AND head and so can tell a
  // deletion from a repo that never had one. Strictness belongs in the gate that
  // can prove the loss, not in the one that has to guess.
  if (!ledgerExists) return [];
  if (!headerFound) return []; // unparseable header — validateLedgerShape names it
  const problems = [];

  const rowIds = new Set(Object.keys(byId));
  const intentIds = new Set(intents.map((i) => i.id.toUpperCase()));
  const lines = readFileSync(LEDGER, 'utf8').split('\n');

  // Duplicate ids come first, because they make every other count in this
  // function lie: the parsed table collapses them into one key. Naming the id is
  // the whole point — a bare count mismatch routes the author to `sync`, which
  // is additive-only and cannot remove the extra row.
  const counts = new Map();
  for (const id of ledgerRowIds(lines)) counts.set(id, (counts.get(id) || 0) + 1);
  for (const [id, n] of counts) {
    if (n > 1) {
      problems.push(`${id}: appears in ${n} ledger rows — delete the duplicate(s) by hand, ` +
        `keeping the row that carries the delivery stamp (a merge that duplicates a row is the usual cause)`);
    }
  }

  for (const i of intents) {
    if (!rowIds.has(i.id.toUpperCase())) {
      problems.push(`${i.id}: has intents/${i.id}/intent.md but NO ledger row — ` +
        `run \`node launchpad/scripts/intent-ledger.mjs sync\` to open a ⬜ Not started row`);
    }
  }
  for (const id of rowIds) {
    if (!intentIds.has(id)) {
      problems.push(`${id}: has a ledger row but no intents/${id.toLowerCase()}/intent.md — ` +
        `restore the intent file (a merge may have dropped it). A retired intent keeps its intent.md ` +
        `and a 🚫 row — retire it with \`retire ${id} --decision <ref>\`, never by deleting the file or row`);
    }
  }

  // Footer count is derived; every write path refreshes it. A mismatch here means
  // the file was hand-edited.
  const footer = lines.find((l) => /^_\d+ intents\b/.test(l));
  if (footer) {
    const claimed = Number(footer.match(/^_(\d+) intents\b/)[1]);
    if (claimed !== rowIds.size) {
      problems.push(`ledger footer claims ${claimed} intents but the table has ${rowIds.size} row(s) — ` +
        `run \`node launchpad/scripts/intent-ledger.mjs sync\` to re-derive it`);
    }
  }
  return problems;
}

// Intent size (#178): an intent grows when each refinement appends instead of
// rewriting, so answered questions keep their reasoning, Outcome keeps a dated
// changelog, and the scope gets buried. Surfaced, never failed; each warning
// points at the fix in /ql-refine-intent Step 2b.
const INTENT_WORDS_MAX = 1500;
const ANSWER_CHARS_MAX = 300;
function sizeWarnings(intent, raw) {
  const out = [];
  const body = raw.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').replace(/<!--[\s\S]*?-->/g, '');
  const words = (body.match(/\S+/g) || []).length;
  if (words > INTENT_WORDS_MAX) {
    out.push(`${intent.id}: ${words} words (past ~${INTENT_WORDS_MAX}).`);
  }
  const extra = intent.outcome && intent.outcome[OUTCOME_EXTRA];
  if (extra) {
    out.push(`${intent.id}: Outcome has ${extra} paragraph(s) past its summary; only the first reaches Jira.`);
  }
  for (const q of intent.open_questions || []) {
    if (q.status === 'ANSWERED' && (q.answer || '').length > ANSWER_CHARS_MAX) {
      out.push(`${intent.id}: ${q.id || 'an open question'} answer runs ${q.answer.length} characters (past ${ANSWER_CHARS_MAX}).`);
    }
  }
  return out;
}

function cmdValidate() {
  if (preIngestNotice()) process.exit(0);
  const { intents, problems } = loadIntents({ withProblems: true });
  const issues = [...problems];

  const byId = Object.fromEntries(intents.map((i) => [i.id.toUpperCase(), i]));

  // Dependency integrity: internal deps must resolve and must not point at a
  // LATER phase (that's the sequencing error Rohit flagged — an intent can't
  // depend on something scheduled after it).
  for (const i of intents) {
    const deps = (i.dependencies && i.dependencies.internal) || [];
    for (const depId of deps) {
      const dep = byId[depId.toUpperCase()];
      if (!dep) {
        issues.push(`${i.id}: internal dependency ${depId} does not resolve to any intent`);
        continue;
      }
      if (typeof i.phase === 'number' && typeof dep.phase === 'number' && dep.phase > i.phase) {
        issues.push(`${i.id} (phase ${i.phase}) depends on ${depId} (phase ${dep.phase}) — ` +
          `a dependency scheduled AFTER it. Resequence one of them.`);
      }
    }
    // An external dependency with no system name is almost certainly a typo.
    for (const e of (i.dependencies && i.dependencies.external) || []) {
      if (!e.system) issues.push(`${i.id}: external dependency with no system name — check the "System | need | owner" format`);
    }
  }

  // Duplicate ids (two folders, same id in frontmatter).
  const seen = {};
  for (const i of intents) {
    if (!i.id) continue;
    seen[i.id] = (seen[i.id] || 0) + 1;
  }
  for (const [id, n] of Object.entries(seen)) {
    if (n > 1) issues.push(`${id}: appears in ${n} intent files — ids must be unique`);
  }

  // Ledger row shape (column count / status vocab / hash cell) — see issue #94.
  issues.push(...validateLedgerShape());

  // Ledger PRESENCE — every intent has a row, every row has an intent.
  // The shape check above only inspects rows that exist, so an intent with no row
  // was invisible to it, and to `drift`/`coverage`/`regression` (all of which
  // reason about rows, and an absent row makes no claim). `new` now opens the row
  // itself, so this is the backstop for the paths where it can't: `from-json`
  // ingest, a hand-created directory, or a branch merge that drops a row.
  issues.push(...validateLedgerPresence(intents));

  // Ratification record: a malformed line is a problem (deliver can't read it);
  // a stale one (scope changed since) is surfaced, not failed. So is a delivered
  // row with none at all: `deliver` only warns on a first stamp, so an intent
  // delivered before the field existed would otherwise stay green forever
  // (warn, never refuse — decisions/0060).
  const { byId: ledgerRows } = parseLedger({ soft: true });
  for (const i of intents) {
    const r = ratificationOf(i);
    if (r.state === 'malformed') issues.push(`${i.id}: \`ratified: ${r.raw}\` doesn't read as ${RATIFIED_SHAPE} — re-run \`ratify\``);
    else if (r.state === 'stale') console.log(`::warning::${i.id}: ${ratificationNote(i)}.`);
    else if (r.state === 'missing') {
      const status = stampStatus(ledgerRows[i.id.toUpperCase()]?.status);
      if (status === STATUS.delivered || status === STATUS.drift) {
        console.log(`::warning::${i.id}: ${status} with no ratification recorded — have the Trusted Guide ratify it: ` +
          `node launchpad/scripts/intent-ledger.mjs ratify ${i.id} --by "<name>"`);
      }
    }
  }

  // Text in a Guardrails / Out-of-scope section that isn't part of a bullet. It IS
  // hashed (as its own item), so it can't hide from drift — but it's probably a
  // formatting slip, so say so without failing.
  for (const i of intents) {
    for (const s of i[STRAY_LIST_TEXT] || []) {
      console.log(`::warning::${i.id}: ${s} isn't part of a bullet — it's hashed as its own item. Make it a "- " bullet (or indent it under one).`);
    }
  }

  // Decision citations (decisions/0075): a missing or superseded cited record is
  // surfaced, never failed — the intent still governs. A Delivered intent's message
  // routes to reverify, because the scope it was built to has moved.
  const dctx = loadDecisionContext();
  const dledger = parseLedger({ soft: true }).byId;
  for (const { intent, path } of loadIntentsWithPath()) {
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch { continue; }
    const delivered = stampStatus((dledger[intent.id.toUpperCase()] || {}).status || '') === STATUS.delivered;
    for (const w of citationWarnings(intent, decisionBrief(intent, raw, dctx), delivered)) console.log(`::warning::${w}`);
    for (const w of sizeWarnings(intent, raw)) console.log(`::warning::${w}`);
  }

  const snap = snapshotIssues(intents);
  issues.push(...snap.issues);
  for (const w of snap.warnings) console.log(`::warning::${w}`);

  if (issues.length) {
    console.log(`⛔ validate FAILED — ${issues.length} problem(s) in intents/:\n`);
    for (const p of issues) console.log(`   ${p}`);
    console.log('\nFix the intent files (or /ql-refine-intent) so the toolchain can trust them.');
    process.exit(1);
  }
  console.log(`✅ validate passed — ${intents.length} intent(s) parse cleanly, ` +
    `frontmatter + sections present, dependencies resolve, no phase inversions.`);
  process.exit(0);
}

// Flip one intent's row to "🔧 In progress".
function cmdStart(filterId, prRef) {
  if (!filterId || !/^INT-\d+/i.test(filterId)) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs start INT-xxx [--pr <ref>]');
    process.exit(2);
  }
  const wanted = filterId.toUpperCase();

  let text;
  try {
    text = readFileSync(LEDGER, 'utf8');
  } catch (e) {
    console.error(`Could not read ${LEDGER}: ${e.message}`);
    console.error(`Seed it first:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const lines = text.split('\n');
  const tableIdx = lines.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
  if (tableIdx.length < 2) {
    console.error(`Could not find a ledger table in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(tableIdx[0][0]).map((h) => h.toLowerCase());
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  const prCol = header.findIndex((h) => h === 'pr');
  if (idCol === -1 || statusCol === -1) {
    console.error(`Could not find Intent/Status columns in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const matches = tableIdx.slice(2).filter(([line]) => idCellValue(cells(line)[idCol]).toUpperCase() === wanted);
  // Writing the FIRST match while every reader keeps the LAST would stamp a row no
  // gate ever looks at, silently. Refuse instead of picking one.
  if (matches.length > 1) {
    console.error(`${wanted} has ${matches.length} rows in ${LEDGER}. Only the last is ever read, so`);
    console.error('writing one of them would leave the status ambiguous. Remove the duplicate row(s) first.');
    process.exit(1);
  }
  const match = matches[0];
  let line, lineNo, createdRow = false;
  if (match) {
    [line, lineNo] = match;
  } else {
    // No ledger row yet. If the intent actually exists in intents/, create a
    // ⬜ Not started row and carry on — this is the sanctioned alternative to
    // hand-editing the ledger the docs tell you never to hand-edit (issue #95).
    // If there's no intent file, it's a genuine "unknown intent" error.
    const intentObj = loadIntents().find((i) => i.id.toUpperCase() === wanted);
    if (!intentObj) {
      console.error(`${wanted} has no ledger row and no intents/${wanted.toLowerCase()}/intent.md.`);
      console.error('Re-seed after /ql-ingest-scopezilla, or check the intent id.');
      process.exit(1);
    }
    // Build the row respecting the header's column layout (default every cell to
    // "—", then fill id/phase/status) so a customized/reordered ledger stays valid.
    const phaseCol = header.findIndex((h) => h === 'phase');
    const newCells = header.map(() => '—');
    newCells[idCol] = intentObj.id;
    if (phaseCol !== -1) newCells[phaseCol] = String(intentObj.phase ?? '—');
    newCells[statusCol] = STATUS.notStarted;
    line = `| ${newCells.join(' | ')} |`;
    // Insert after the ledger table's LAST CONTIGUOUS row, not the last pipe-line
    // in the whole file: a second markdown table below the ledger (an engagement-
    // notes table) would otherwise catch the row, leaving it invisible to every
    // gate and malforming that table. Walk the run from the header, stop at the
    // first gap — the same guard ensureLedgerRow uses.
    let insertAfter = tableIdx[0][1];
    for (const [, idx] of tableIdx) {
      if (idx === insertAfter || idx === insertAfter + 1) insertAfter = idx;
      else break;
    }
    lineNo = insertAfter + 1;
    lines.splice(lineNo, 0, line);
    createdRow = true;
  }
  const c = cells(line);
  const status = c[statusCol] || '';

  // These guards decide whether to REFUSE a write, so they read the leading
  // marker like every gate — but an unreadable cell has to refuse too. A plain
  // swap to stampStatus would have made this LESS safe than the substring scan it
  // replaces: "Was ✅ Delivered, now reopened" used to match /delivered/ and stop
  // here, and would otherwise have become null and been flipped to In progress,
  // overwriting a stamp.
  // No blank-cell exemption: a blank Status is exactly what a bad merge leaves
  // behind, on a row that may still carry a hash, a PR and signed evidence, and
  // `coverage --gate` already calls that unreadable. Exempting it here graded one
  // input two ways and let the WRITING half be the lenient one. Nothing legitimate
  // needs it either — the row-creation path above sets ⬜ Not started before this.
  const startStatus = stampStatus(status);
  if (startStatus === null) {
    console.error(`${wanted}'s ledger Status reads "${status.trim() || '(blank)'}", which doesn't begin with a marker,`);
    console.error('so whether it has already been delivered can\'t be determined — refusing to overwrite it.');
    console.error('Run `node launchpad/scripts/intent-ledger.mjs validate`, fix the cell, then retry.');
    process.exit(1);
  }
  if (startStatus === STATUS.delivered) {
    console.error(`${wanted} is ✅ Delivered — won't reopen it to In progress.`);
    console.error('If scope changed after delivery, that\'s drift — run `drift` and re-verify, don\'t restart.');
    process.exit(1);
  }
  if (startStatus === STATUS.drift) {
    console.error(`${wanted} is 🔄 Needs re-verify (delivered, then scope drifted).`);
    console.error('Reconcile the drift — don\'t restart it as new work.');
    process.exit(1);
  }
  if (startStatus === STATUS.retired) {
    console.error(`${wanted} is 🚫 Retired — it was deliberately pulled from delivery, so restarting it would silently revive de-scoped work.`);
    console.error('If it\'s genuinely back in scope, revive it as a recorded scope change via /ql-capture-intent or /ql-refine-intent first.');
    process.exit(1);
  }

  const alreadyInProgress = startStatus === STATUS.inProgress;

  c[statusCol] = STATUS.inProgress;
  let prNote = '';
  if (prCol !== -1 && prRef) {
    const existing = (c[prCol] || '').trim();
    if (!existing || existing === '—' || existing === '-') {
      c[prCol] = prRef;
    } else if (existing !== prRef) {
      prNote = `\n  (PR column already reads "${existing}" — left as-is; pass a matching --pr or edit by hand.)`;
    }
  }
  lines[lineNo] = `| ${c.join(' | ')} |`;

  refreshFooterCount(lines);
  writeLedgerLines(lines);

  const rowNote = createdRow ? ' (added a new ledger row — the intent had none)' : '';
  if (alreadyInProgress) {
    console.log(`${wanted} is already 🔧 In progress.${rowNote}${prNote}`);
  } else {
    console.log(`${wanted} → 🔧 In progress.${rowNote}${prNote}`);
  }
  console.log(`  git add ${LEDGER_FROM_ROOT}`);
  console.log('Ledger updated (canonical). To mirror this one intent into Jira:');
  console.log(`  /ql-sync-jira start ${wanted}`);
  // Building to Intent nobody has stood behind is allowed to START (drafting and
  // design review happen here) but is surfaced now, not discovered at deliver.
  const startIntent = loadIntents().find((i) => i.id.toUpperCase() === wanted);
  const unratified = startIntent ? ratificationNote(startIntent) : '';
  if (unratified) {
    console.log(`::warning::${wanted}: ${unratified}. Have the Trusted Guide ratify it: ` +
      `node launchpad/scripts/intent-ledger.mjs ratify ${wanted} --by "<name>"`);
  }
}

// Flip one intent's row to "✅ Delivered" AND stamp its current scope hash — the
// close-out twin of cmdStart, run while the delivering PR is assembled (the same
// moment the PR §2 traceability matrix is filled). Atomic: status + hash land in
// one write, so you can't leave a Delivered row with no hash (the exact half-done
// state `drift` warns about). Also regenerates the README delivery index in the
// same run, so the one command is the whole ledger-side close-out. See issue #41.
function cmdDeliver(filterId, prRef) {
  if (!filterId || !/^INT-\d+/i.test(filterId)) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs deliver INT-xxx [--pr <ref>]');
    process.exit(2);
  }
  const wanted = filterId.toUpperCase();

  // The hash we're about to stamp is the intent's CURRENT canonical scope hash —
  // the same value `hash` prints and `drift`/`coverage` check against. Compute it
  // first so a bad/missing intent fails before we touch the ledger.
  const intent = loadIntents().find((i) => i.id.toUpperCase() === wanted);
  if (!intent) {
    console.error(`${wanted} is not a known intent (no intents/${wanted.toLowerCase()}/intent.md).`);
    process.exit(1);
  }
  const freshHash = scopeHash(intent);

  let text;
  try {
    text = readFileSync(LEDGER, 'utf8');
  } catch (e) {
    console.error(`Could not read ${LEDGER}: ${e.message}`);
    console.error(`Seed it first:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const lines = text.split('\n');
  const tableIdx = lines.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
  if (tableIdx.length < 2) {
    console.error(`Could not find a ledger table in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(tableIdx[0][0]).map((h) => h.toLowerCase());
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  const prCol = header.findIndex((h) => h === 'pr');
  const hashCol = header.findIndex((h) => h.includes('hash'));
  if (idCol === -1 || statusCol === -1 || hashCol === -1) {
    console.error(`Could not find Intent/Status/Scope-hash columns in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const matches = tableIdx.slice(2).filter(([line]) => idCellValue(cells(line)[idCol]).toUpperCase() === wanted);
  // Same reason as `start`: stamping the first of two rows puts ✅ Delivered where
  // nothing reads it, and leaves the row that IS read saying something else.
  if (matches.length > 1) {
    console.error(`${wanted} has ${matches.length} rows in ${LEDGER}. Only the last is ever read, so`);
    console.error('stamping one of them would leave the status ambiguous. Remove the duplicate row(s) first.');
    process.exit(1);
  }
  const match = matches[0];
  if (!match) {
    console.error(`${wanted} is not in the ledger.`);
    console.error('Re-seed after /ql-ingest-scopezilla, or check the intent id.');
    process.exit(1);
  }

  const [line, lineNo] = match;
  const c = cells(line);
  const status = c[statusCol] || '';
  // A `—`/`-` placeholder means no stamp was ever recorded (same reading as
  // drift) — re-stamping it swallows nothing.
  const rawHash = (c[hashCol] || '').replace(/[`*]/g, '').trim();
  const recordedHash = /^[—–-]*$/.test(rawHash) ? '' : rawHash;
  const deliverStatus = stampStatus(status);
  if (deliverStatus === null) {
    console.error(`${wanted}'s ledger Status reads "${status.trim() || '(blank)'}", which doesn't begin with a marker,`);
    console.error('so its current state can\'t be determined — refusing to stamp over it.');
    console.error('Run `node launchpad/scripts/intent-ledger.mjs validate`, fix the cell, then retry.');
    process.exit(1);
  }
  if (deliverStatus === STATUS.retired) {
    console.error(`${wanted} is 🚫 Retired — refusing to stamp a deliberately de-scoped intent as ✅ Delivered.`);
    console.error('If it\'s genuinely back in scope, revive it as a recorded scope change via /ql-refine-intent first, then deliver.');
    process.exit(1);
  }
  const alreadyDelivered = deliverStatus === STATUS.delivered;

  // Idempotent no-op: already Delivered and the stamped hash still matches the
  // current scope. Nothing to write.
  if (alreadyDelivered && recordedHash === freshHash) {
    console.log(`${wanted} is already ✅ Delivered and its scope hash is current (${freshHash}). No change.`);
    return;
  }
  // Delivered, but the stamped hash no longer matches: scope MOVED after delivery.
  // Refuse to silently re-stamp — that would swallow drift, the one thing the
  // ledger exists to surface. Route to the drift/re-verify path instead.
  // Exception: the stamp was written by the pre-continuation list parser over
  // scope that hasn't changed since (legacyScopeHash) — re-stamp it at the full hash.
  const oldParserStamp = alreadyDelivered && !!recordedHash && recordedHash === legacyScopeHash(intent);
  if (alreadyDelivered && recordedHash && recordedHash !== freshHash && !oldParserStamp) {
    console.error(`${wanted} is ✅ Delivered with hash ${recordedHash}, but the intent's current hash is ${freshHash}.`);
    console.error('Scope moved AFTER delivery — that\'s drift, not a re-delivery. Acknowledge it:');
    console.error(`  node launchpad/scripts/intent-ledger.mjs reverify ${wanted}`);
    console.error('then re-verify the build against the changed scope and run deliver again — don\'t silently re-stamp.');
    process.exit(1);
  }

  // Ratification (CONTEXT.md → Ratify): don't stamp Delivered on scope no
  // Trusted Guide stands behind. Graduated so existing engagements (which predate
  // the field) keep working: an explicit agent draft, a malformed record, or a
  // ratification of DIFFERENT scope refuses; no record at all only warns.
  const rat = ratificationOf(intent);
  if (rat.state === 'stale' || rat.state === 'malformed' || (rat.state === 'missing' && intent.confidence === 'draft')) {
    console.error(`${wanted}: refusing to stamp ✅ Delivered — ${ratificationNote(intent)}.`);
    // A stale ratification means the scope was edited: the command carries their call on it.
    const callFlag = rat.state === 'stale' ? ' --absorbed   (or --scope-change: their call on the edit)' : '';
    console.error(`Have the Trusted Guide read it and ratify:  node launchpad/scripts/intent-ledger.mjs ratify ${wanted} --by "<name>"${callFlag}`);
    process.exit(1);
  }
  if (rat.state === 'missing') {
    console.log(`::warning::${wanted}: no ratification is recorded. Delivering anyway (the field is new); ` +
      `record it with: node launchpad/scripts/intent-ledger.mjs ratify ${wanted} --by "<name>"`);
  }

  // Normal path: ⬜ / 🔧 → Delivered, or 🔄 Needs re-verify → Delivered (a
  // deliberate re-delivery after the drift was reconciled and re-verified).
  c[statusCol] = STATUS.delivered;
  c[hashCol] = `\`${freshHash}\``;
  let prNote = '';
  if (prCol !== -1 && prRef) {
    const existing = (c[prCol] || '').trim();
    if (!existing || existing === '—' || existing === '-') {
      c[prCol] = prRef;
    } else if (existing !== prRef) {
      prNote = `\n  (PR column already reads "${existing}" — left as-is; pass a matching --pr or edit by hand.)`;
    }
  }
  lines[lineNo] = `| ${c.join(' | ')} |`;
  refreshFooterCount(lines);
  writeLedgerLines(lines);

  const wasDrift = deliverStatus === STATUS.drift;
  const why = wasDrift ? ' (re-delivered after drift)'
    : oldParserStamp ? ` (re-stamped: ${recordedHash} predated the list-parser fix and didn't cover wrapped/numbered ` +
      'Guardrails / Out-of-scope lines — re-stamp only after re-verifying those against the build)' : '';
  console.log(`${wanted} → ✅ Delivered, scope hash stamped ${freshHash}.${why}${prNote}`);

  // Regenerate the README delivery index so the derived view matches the ledger
  // in the SAME PR — folding it in here means the one command leaves the ledger
  // side fully consistent instead of a second chore. (CI only WARNS on a stale
  // index — it's a cosmetic derived view, see decisions/0013 — but keeping it in
  // step here means the warning never fires on a normal deliver.)
  // Best-effort: the canonical write (the ledger) already succeeded, so a missing
  // README must NOT turn `deliver` into a non-zero failure — warn and point at the
  // manual refresh instead.
  if (existsSync(README)) {
    cmdIndex(true);
  } else {
    console.error(`(No ${README} found — skipped the delivery-index refresh. Run \`index --write\` once it exists.)`);
  }
  const readmeFromRoot = LEDGER_FROM_ROOT.replace(/delivery\/intent-ledger\.md$/, 'README.md');
  const filesToAdd = existsSync(README) ? `${LEDGER_FROM_ROOT} ${readmeFromRoot}` : LEDGER_FROM_ROOT;
  console.log(`  git add ${filesToAdd}`);
}

// Flip one intent's row to "🚫 Retired" — the governed record of a de-scoped
// intent, the terminal-lifecycle twin of cmdDeliver (issue #139). Retirement is a
// recorded act, not a hand-edit: it clears the scope-hash cell (a retired intent's
// scope is no longer being verified, so a stamped hash would be a stale/misleading
// live anchor) and records a decision-record pointer in the Evidence cell (like
// `deliver` records the PR). The PR cell is PRESERVED — a partially-built intent
// that shipped code keeps that history. Idempotent when already retired. Retirable
// from ANY status (⬜/🔧/✅/🔄): the common case is an intent that was scoped, built,
// then pulled. Refreshes the README index in the same run, like `deliver`.
function cmdRetire(filterId, decisionRef) {
  if (!filterId || !/^INT-\d+/i.test(filterId)) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs retire INT-xxx [--decision <ref>]');
    process.exit(2);
  }
  const wanted = filterId.toUpperCase();

  let text;
  try {
    text = readFileSync(LEDGER, 'utf8');
  } catch (e) {
    console.error(`Could not read ${LEDGER}: ${e.message}`);
    console.error(`Seed it first:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const lines = text.split('\n');
  const tableIdx = lines.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
  if (tableIdx.length < 2) {
    console.error(`Could not find a ledger table in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = cells(tableIdx[0][0]).map((h) => h.toLowerCase());
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  const hashCol = header.findIndex((h) => h.includes('hash'));
  const evidenceCol = header.findIndex((h) => h.includes('evidence'));
  if (idCol === -1 || statusCol === -1) {
    console.error(`Could not find Intent/Status columns in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  // One id reader (idCellValue) like every other call site — stripping only `*`
  // here left a backticked `` `INT-001` `` (which `validate` accepts) unretirable.
  const matches = tableIdx.slice(2).filter(([line]) =>
    idCellValue(cells(line)[idCol]).toUpperCase() === wanted);
  // Refuse a duplicated row, as `start`/`deliver` do: readers keep the LAST row,
  // so retiring the first would report success while the row every gate reads
  // stays active.
  if (matches.length > 1) {
    console.error(`${wanted} has ${matches.length} rows in ${LEDGER}. Only the last is ever read, so`);
    console.error('retiring one of them would leave the status ambiguous. Remove the duplicate row(s) first.');
    process.exit(1);
  }
  const match = matches[0];
  if (!match) {
    console.error(`${wanted} is not in the ledger — nothing to retire.`);
    console.error('(A retired intent keeps its ledger row as the record it was pulled; retire operates on an existing row.)');
    process.exit(1);
  }

  const [line, lineNo] = match;
  const c = cells(line);
  const status = c[statusCol] || '';

  // Read the LEADING marker (stampStatus), not a substring scan: a whole-cell
  // scan reported "⬜ Not started (retired after INT-004)" as already-Retired
  // even though every gate correctly reads it as Not started.
  const retireStatus = stampStatus(status);
  if (retireStatus === null) {
    console.error(`${wanted}'s ledger Status reads "${status.trim() || '(blank)'}", which doesn't begin with a marker,`);
    console.error('so its current state can\'t be determined — refusing to overwrite it.');
    console.error('Run `node launchpad/scripts/intent-ledger.mjs validate`, fix the cell, then retry.');
    process.exit(1);
  }
  if (retireStatus === STATUS.retired) {
    console.log(`${wanted} is already 🚫 Retired. No change.`);
    return;
  }

  const wasDelivered = retireStatus === STATUS.delivered;
  c[statusCol] = STATUS.retired;
  // Clear the scope hash — a retired intent isn't being verified against scope, so
  // a stamped hash is no longer a live anchor (its delivery history stays in PR).
  if (hashCol !== -1) c[hashCol] = '—';
  let evNote = '';
  if (decisionRef && evidenceCol !== -1) {
    const existing = (c[evidenceCol] || '').trim();
    if (!existing || existing === '—' || existing === '-') {
      c[evidenceCol] = decisionRef;
    } else {
      evNote = `\n  (Evidence column already reads "${existing}" — left as-is; the retirement ref is ${decisionRef}.)`;
    }
  }
  lines[lineNo] = `| ${c.join(' | ')} |`;
  writeLedgerLines(lines);

  console.log(`${wanted} → 🚫 Retired${wasDelivered ? ' (was ✅ Delivered — pulled after building)' : ''}.${evNote}`);
  if (!decisionRef) {
    console.log('  Record WHY it was pulled in decisions/ and pass --decision <ref> so the ledger points at it —');
    console.log('  retirement is a scope change, and scope changes are recorded, not buried.');
  }

  // Keep the derived README index in step in the same run (mirrors `deliver`).
  if (existsSync(README)) {
    cmdIndex(true);
  } else {
    console.error(`(No ${README} found — skipped the delivery-index refresh. Run \`index --write\` once it exists.)`);
  }
}

// Flip a ✅ Delivered row to "🔄 Needs re-verify" — the governed acknowledgment
// that scope moved after delivery (decisions/0035, amended 2026-09-28). Keeps the
// recorded hash and the PR: they are the record of WHAT was delivered, and the
// re-verify is judged against them. `drift` then treats the row's moved hash as
// acknowledged (a notice, not a failure) until `deliver` re-stamps it after the
// build is re-verified against the new scope. Only a Delivered row can need
// re-verifying; idempotent when already 🔄.
function cmdReverify(filterId, decisionRef) {
  if (!filterId || !/^INT-\d+/i.test(filterId)) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs reverify INT-xxx [--decision <ref>]');
    process.exit(2);
  }
  const wanted = filterId.toUpperCase();
  let text;
  try {
    text = readFileSync(LEDGER, 'utf8');
  } catch (e) {
    console.error(`Could not read ${LEDGER}: ${e.message}`);
    process.exit(2);
  }
  const lines = text.split('\n');
  const tableIdx = lines.map((l, i) => [l, i]).filter(([l]) => l.trim().startsWith('|'));
  const cells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  const header = tableIdx.length ? cells(tableIdx[0][0]).map((h) => h.toLowerCase()) : [];
  const idCol = header.findIndex((h) => h === 'intent');
  const statusCol = header.findIndex((h) => h === 'status');
  const evidenceCol = header.findIndex((h) => h.includes('evidence'));
  if (tableIdx.length < 2 || idCol === -1 || statusCol === -1) {
    console.error(`Could not find Intent/Status columns in ${LEDGER}.`);
    console.error(`Re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }
  const matches = tableIdx.slice(2).filter(([line]) =>
    idCellValue(cells(line)[idCol]).toUpperCase() === wanted);
  if (matches.length > 1) {
    console.error(`${wanted} has ${matches.length} rows in ${LEDGER}. Only the last is ever read — remove the duplicate(s) first.`);
    process.exit(1);
  }
  if (!matches.length) {
    console.error(`${wanted} is not in the ledger.`);
    process.exit(1);
  }
  const [line, lineNo] = matches[0];
  const c = cells(line);
  const cur = stampStatus(c[statusCol] || '');
  if (cur === STATUS.drift && !decisionRef) {
    console.log(`${wanted} is already 🔄 Needs re-verify. No change.`);
    return;
  }
  if (cur !== STATUS.delivered) {
    console.error(`${wanted} is "${(c[statusCol] || '(blank)').trim()}" — only a ✅ Delivered intent can need re-verifying.`);
    console.error('An intent that isn\'t delivered yet just builds to its current scope; a retired one isn\'t verified at all.');
    process.exit(1);
  }
  c[statusCol] = STATUS.drift;
  let evNote = '';
  if (decisionRef && evidenceCol !== -1) {
    // Record the scope-change decision without discarding the delivery evidence
    // already in the cell: append it.
    const existing = (c[evidenceCol] || '').trim();
    if (!existing || existing === '—' || existing === '-') c[evidenceCol] = decisionRef;
    else if (!existing.includes(decisionRef)) c[evidenceCol] = `${existing} · scope change: ${decisionRef}`;
  } else if (decisionRef) {
    evNote = `\n  (No Evidence column — record the scope-change ref ${decisionRef} in the PR.)`;
  }
  lines[lineNo] = `| ${c.join(' | ')} |`;
  writeLedgerLines(lines);
  console.log(`${wanted} → 🔄 Needs re-verify (recorded hash and PR kept).${evNote}`);
  console.log(`  Re-verify the build against the changed intent; when it holds:  node launchpad/scripts/intent-ledger.mjs deliver ${wanted}`);
  if (existsSync(README)) cmdIndex(true);
}

const INDEX_BEGIN = '<!-- ENGAGEMENT:INDEX:BEGIN -->';
const INDEX_END = '<!-- ENGAGEMENT:INDEX:END -->';
const INDEX_WARN = '<!-- generated by launchpad/scripts/intent-ledger.mjs index — do not edit; regenerated by CI -->';


// Each canonical status opens with its own glyph, so derive the lookup from
// STATUS rather than restating it — a new status stays in sync for free.
// Spreading the string iterates code points, so a surrogate-pair emoji (🔧, 🔄)
// yields the whole glyph and not half of it.
const STATUS_BY_GLYPH = Object.fromEntries(Object.values(STATUS).map((s) => [[...s][0], s]));

// Read a status cell by its LEADING marker. (An earlier displayStatus()
// substring-scanned the whole cell, first match wins — dangerous for a guard,
// and it mislabeled the README index too, because the ledger
// sanctions free-text after the status word.) It graded
// "⬜ Not started (delivered under INT-004)" as Delivered and
// "🔧 In progress (re-verify after rebase)" as Needs re-verify — the second of
// which the regression guard accepts as a legitimate transition, so a stale
// branch reopening a stamped row passes green. Key on the LEADING marker only:
// the glyph when there is one, else the words before any annotation. Returns
// null for a cell this can't read, so a caller can fail closed rather than
// silently grading it Not started.
function stampStatus(raw) {
  // Strip markdown decoration before reading the marker. `validate` accepts a
  // backticked or struck-through status cell, and isEmptyCell strips the same
  // set — a reader that only stripped `*` returned null for "`✅ Delivered`",
  // which blocks a legitimate PR from the head side and, worse, drops the row
  // out of the guard from the base side.
  const cell = String(raw || '').replace(/[`*~]/g, '').trim();

  for (const [glyph, status] of Object.entries(STATUS_BY_GLYPH)) {
    if (cell.startsWith(glyph)) return status;
  }

  const lead = cell.split(/[(—]|\s-+\s/)[0].trim().toLowerCase();
  if (/^(needs )?re-verify\b/.test(lead)) return STATUS.drift;
  if (/^delivered\b/.test(lead)) return STATUS.delivered;
  if (/^in progress\b/.test(lead)) return STATUS.inProgress;
  if (/^not started\b/.test(lead)) return STATUS.notStarted;
  if (/^retired\b/.test(lead)) return STATUS.retired;
  return null;
}

function renderPr(raw) {
  const v = (raw || '').trim();
  if (!v || v === '—' || v === '-') return '—';
  const m = v.match(/^#?(\d+)$/);
  return m ? `[#${m[1]}](./pull/${m[1]})` : v;
}

function renderIndexBlock() {
  const intents = loadIntents();
  const { byId } = parseLedger({ soft: true });

  const rows = intents.map((i) => {
    const row = byId[i.id.toUpperCase()] || {};
    // The same leading-marker read the gates use (stampStatus), so the index can't
    // show "⬜ Not started (delivered under INT-004)" as ✅ Delivered — and an
    // unreadable cell says so instead of passing as ⬜ Not started.
    const status = row.status === undefined ? '— no ledger row (run `sync`)'
      : stampStatus(row.status) || '❓ unreadable — run `validate`';
    return { id: i.id, phase: i.phase, title: i.title, status, pr: renderPr(row.pr) };
  });

  // NB: no rolled-up status tally here on purpose (issue #98). A summary line
  // like "2 ✅ · 11 🔧 · 22 ⬜" re-derives to a value matching NEITHER side on
  // every parallel-delivery merge, so git's "pick a side" resolution silently
  // commits a wrong count. The per-intent rows below carry each status and
  // auto-merge cleanly (different lines); the count+phase sentence changes only
  // when the intent SET changes, not on a status flip. Per-status counts are a
  // derived nicety — read them off the canonical ledger, not a conflict-prone
  // committed line.
  const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b);
  const lines = [INDEX_BEGIN, INDEX_WARN, '## Delivery index', ''];
  lines.push(`_Derived view — intent titles from \`${INTENTS_DIR}/\`, status from \`${LEDGER}\`. ` +
    `The ledger stays canonical; this block is regenerated, never hand-edited._`);
  lines.push('');
  const noun = rows.length === 1 ? 'intent' : 'intents';
  lines.push(`**${rows.length} ${noun}** across phase(s) ${phases.join(', ')}.`);
  lines.push('');
  for (const phase of phases) {
    lines.push(`### Phase ${phase}`, '');
    lines.push('| Intent | Status | PR | Title |');
    lines.push('|--------|--------|----|-------|');
    for (const r of rows.filter((x) => x.phase === phase)) {
      lines.push(`| ${r.id} | ${r.status} | ${r.pr} | ${r.title} |`);
    }
    lines.push('');
  }
  lines.push(INDEX_END);
  return lines.join('\n');
}

// ── source: tied Scopezilla projects, read in place (decisions/0082 W3, #228) ──
// A tied source is recorded in the engagement profile by name (`sources[]`:
// name, scopezilla_slug, role, cursor, tied_at). Where it lives is per machine,
// in the gitignored .launchpad/local.json, so a private project URL or path never
// reaches the customer's history. Content is read in place with `git show
// <sha>:<path>`, which works in every harness and can't edit the source. The
// cursor is the last commit someone reviewed, shared by the team; it moves only
// on `ack`. A project with no git falls back to its folder, with the reviewed copy
// kept per machine under ~/.launchpad/source-snapshots/ and the cursor a content hash.
const PROFILE_FILE = 'engagement.json';
const SOURCE_DATA = ['data', 'decisions'];
// A folder-only source's reviewed copy also keeps what grounding pointers and the
// brownfield rule read: reference/ and the prototype/ workspace (scoping-agent 0061),
// minus installed packages and tool state. SOURCE_DATA alone still decides what
// counts as a scope change.
const SOURCE_SNAPSHOT = [...SOURCE_DATA, 'reference', 'prototype'];
const SNAPSHOT_SKIP = new Set(['node_modules', '.git', '.sf', '.sfdx']);

function readProfileFile() {
  try { return JSON.parse(readFileSync(PROFILE_FILE, 'utf8')); } catch { return { schema_version: 2 }; }
}
function writeProfileFile(p) { writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 2) + '\n'); }

function sourceLocations(root, update) {
  const f = join(root, '.launchpad', 'local.json');
  let local = {};
  try { local = JSON.parse(readFileSync(f, 'utf8')); } catch { /* none yet */ }
  if (update) {
    local.sources = { ...(local.sources || {}), ...update };
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(local, null, 2) + '\n');
  }
  return local.sources || {};
}

function sourceDie(msg) { console.error(msg); process.exit(1); }

function cmdSource(sub, rest, eng) {
  const flag = (f) => { const k = rest.indexOf(f); return k !== -1 ? rest[k + 1] : null; };
  const name = rest[0] && !rest[0].startsWith('--') ? rest[0] : null;
  const profile = readProfileFile();
  const sources = Array.isArray(profile.sources) ? profile.sources : [];
  const key = `${eng.slug}/${name}`;
  const entry = sources.find((s) => s.name === name);

  if (sub === 'list') {
    if (!sources.length) { console.log('No tied sources.'); return; }
    const where = sourceLocations(eng.root);
    for (const s of sources) {
      console.log(`${s.name}\t${s.role || 'primary'}\t${s.scopezilla_slug || '-'}\tcursor ${s.cursor || '(not reviewed)'}\t${where[`${eng.slug}/${s.name}`] ? 'located here' : 'not located on this machine'}`);
    }
    return;
  }
  if (!name || !SLUG_RE.test(name)) sourceDie(`Name the source: source ${sub || '<tie|show|status|ack|retire|list>'} <name> (lowercase, digits, hyphens).`);

  if (sub === 'tie') {
    const path = flag('--path');
    const slug = flag('--slug');
    if (!path || !existsSync(path)) sourceDie('source tie needs --path <the project folder on this machine>.');
    if (!slug) sourceDie('source tie needs --slug <the Scopezilla project slug>, so a teammate can find it.');
    const next = { name, scopezilla_slug: slug, role: flag('--role') || 'primary', cursor: entry ? entry.cursor : null, tied_at: entry ? entry.tied_at : new Date().toISOString().slice(0, 10) };
    profile.sources = entry ? sources.map((s) => (s.name === name ? next : s)) : [...sources, next];
    writeProfileFile(profile);
    sourceLocations(eng.root, { [key]: resolve(path) });
    console.log(`Tied ${name} (${slug}). Its location is in .launchpad/local.json on this machine only.`);
    return;
  }
  if (!entry) sourceDie(`No source "${name}" in this engagement. Tied: ${sources.map((s) => s.name).join(', ') || 'none'}.`);
  if (sub === 'retire') {
    profile.sources = sources.map((s) => (s.name === name ? { ...s, role: 'retired' } : s));
    writeProfileFile(profile);
    console.log(`${name} is retired: kept for provenance, skipped by reconcile and the nudges.`);
    return;
  }

  const loc = sourceLocations(eng.root)[key];
  if (!loc || !existsSync(loc)) {
    sourceDie(`${name} isn't located on this machine. Find the Scopezilla project "${entry.scopezilla_slug}" ` +
      `and run: source tie ${name} --slug ${entry.scopezilla_slug} --path <folder>`);
  }
  const g = (args) => git(['-C', loc, ...args]);
  const isGit = g(['rev-parse', '--is-inside-work-tree']).out === 'true';
  const head = isGit ? g(['rev-parse', 'HEAD']).out : null;
  // The reader reads commits, so scope the scoper hasn't committed is invisible to it
  // (#306). Say so, never fail; a folder-only source has nothing to compare.
  const uncommitted = isGit ? g(['status', '--porcelain', '--untracked-files=all', '--', ...SOURCE_DATA]).out.split('\n').filter(Boolean).length : 0;
  const warnUncommitted = () => {
    if (uncommitted) console.error(`⚠ ${name}: ${uncommitted} uncommitted change(s) in data/ or decisions/. ` +
      'The Launchpad reads the last commit, not the folder: commit in Scopezilla, then re-run.');
  };
  const fileHash = () => {
    try { return createHash('sha256').update(readFileSync(join(loc, 'data', 'intents.json'))).digest('hex').slice(0, 12); } catch { return null; }
  };
  const snapshotDir = (h) => join(homedir(), '.launchpad', 'source-snapshots', eng.slug, name, h);

  if (sub === 'show') {
    const path = rest[1];
    if (!path || path.startsWith('--')) sourceDie(`source show ${name} <path> [--at cursor|head|<sha>]`);
    const at = flag('--at') || 'head';
    if (!isGit) {
      const file = at === 'cursor' && entry.cursor
        ? join(snapshotDir(entry.cursor.replace(/^hash:/, '')), path) : join(loc, path);
      try { process.stdout.write(readFileSync(file, 'utf8')); return; } catch { sourceDie(`No ${path} in ${name}${at === 'cursor' ? ' at its cursor' : ''}.`); }
    }
    const ref = at === 'head' ? 'HEAD' : at === 'cursor' ? entry.cursor : at;
    if (!ref) sourceDie(`${name} has no cursor yet: nothing has been reviewed. Read it at head, then ack.`);
    if (at === 'head') warnUncommitted();
    // ./ makes the path relative to the project folder, which may sit inside a larger repo.
    const out = g(['show', `${ref}:./${path}`]);
    if (!out.ok) sourceDie(`No ${path} in ${name} at ${at}.`);
    process.stdout.write(out.out + '\n');
    return;
  }
  if (sub === 'status') {
    let status;
    if (!isGit) {
      const now = fileHash();
      status = { name, git: false, head: now && `hash:${now}`, cursor: entry.cursor, new_changes: entry.cursor === `hash:${now}` ? 0 : 1, cursor_lost: false, uncommitted: 0 };
    } else {
      const known = entry.cursor && g(['merge-base', '--is-ancestor', entry.cursor, 'HEAD']).ok;
      const count = known ? Number(g(['rev-list', '--count', `${entry.cursor}..HEAD`, '--', ...SOURCE_DATA]).out || 0) : null;
      status = { name, git: true, head, cursor: entry.cursor, new_changes: count, cursor_lost: !!entry.cursor && !known, uncommitted };
    }
    warnUncommitted();
    if (rest.includes('--json')) { console.log(JSON.stringify(status)); return; }
    console.log(status.cursor_lost ? `${name}: the cursor ${status.cursor} is no longer in its history (rewritten?). Treat everything as changed.`
      : !status.cursor ? `${name}: nothing reviewed yet.` : `${name}: ${status.new_changes} change(s) since the last review.`);
    return;
  }
  if (sub === 'ack') {
    let cursor;
    if (!isGit) {
      const h = fileHash();
      if (!h) sourceDie(`${name} has no data/intents.json to review.`);
      // Build the copy fresh, then swap it in: re-acking the same intents.json must not
      // keep files the project has since deleted. The old copy is this machine's cache.
      const dir = snapshotDir(h), fresh = `${dir}.tmp-${process.pid}`, stale = `${dir}.old-${process.pid}`;
      mkdirSync(fresh, { recursive: true });
      for (const d of SOURCE_SNAPSHOT) {
        if (existsSync(join(loc, d))) cpSync(join(loc, d), join(fresh, d), { recursive: true, filter: (src) => !SNAPSHOT_SKIP.has(basename(src)) });
      }
      if (existsSync(dir)) renameSync(dir, stale);
      renameSync(fresh, dir);
      rmSync(stale, { recursive: true, force: true });
      cursor = `hash:${h}`;
      console.log(`${name} has no git, so its reviewed copy is kept on this machine only; teammates can't reconcile it. ` +
        'Put the project in git (/scopezilla:collaborate) to share the review.');
    } else {
      const want = rest[1] && !rest[1].startsWith('--') ? rest[1] : head;
      const sha = g(['rev-parse', '--verify', '--quiet', `${want}^{commit}`]).out;
      if (!sha || !g(['merge-base', '--is-ancestor', sha, 'HEAD']).ok) sourceDie(`${want} is not in ${name}'s history.`);
      cursor = sha;
      warnUncommitted();
    }
    profile.sources = sources.map((s) => (s.name === name ? { ...s, cursor } : s));
    writeProfileFile(profile);
    console.log(`${name}: reviewed up to ${cursor}.`);
    return;
  }
  sourceDie(`Unknown source command "${sub}". Use tie, list, show, status, ack or retire.`);
}

// ── snapshot storage mode: the write-then-pull loop (decisions/0082 W5, 0083) ──
// In `snapshot` mode the tracker holds intent content and each intent.md is a
// copy of it, written only by `pull`. The skill writes the drafted intent to the
// tracker (`tracker-body` gives it the exact text), reads it back through the
// adapter's `read-item`, and hands that JSON to `pull`. `pull --check` refuses
// unless the read-back re-hashes to the draft, so a lossy converter or a tracker
// that reshapes text can't corrupt an intent without failing. `pull --refresh`
// takes an edit someone made in the tracker; the ratification then reads as
// stale until the Trusted Guide ratifies the new text. Ratification never comes
// from the tracker. The `proof` field is the proof hash at the pull, so `validate`
// can tell a copy someone edited by hand in the repo.
const STORAGE_MODES = ['repo', 'snapshot', 'pointer'];
const SNAPSHOT_KEYS = ['tracker', 'key', 'revision', 'at', 'proof'];

function parseSnapshotField(raw) {
  const m = String(raw || '').trim().match(/^\{(.*)\}$/);
  if (!m) return null;
  const out = {};
  for (const part of m[1].split(/,\s*(?=[a-z]+:\s)/)) {
    const kv = part.match(/^\s*([a-z]+):\s*(.*?)\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out.tracker && out.key ? out : null;
}
function renderSnapshotField(s) { return `{${SNAPSHOT_KEYS.filter((k) => s[k]).map((k) => `${k}: ${s[k]}`).join(', ')}}`; }

function storageMode() {
  const mode = readProfileFile().intent_storage || 'repo';
  return STORAGE_MODES.includes(mode) ? mode : 'repo';
}

function intentFileOrDie(id) {
  const want = normId(id);
  const found = loadIntentsWithPath().find(({ intent }) => intent.id.toUpperCase() === want);
  if (!found) { console.error(`${want} is not a known intent (no ${INTENTS_DIR}/${want}/intent.md).`); process.exit(1); }
  return { ...found, text: readFileSync(found.path, 'utf8').replace(/\r\n?/g, '\n') };
}

// The sections, exactly as the file has them (everything after the H1).
function bodyOfIntent(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^\s*#\s+[^\n]*\n/, '');
  return body.replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

function cmdTrackerBody(id, eng) {
  const { intent, text } = intentFileOrDie(id);
  console.log(JSON.stringify({ tag: `${eng.slug}/${intent.id}`, labels: [`intent:${eng.slug}/${intent.id}`],
    summary: intent.title, body_markdown: bodyOfIntent(text) }, null, 2));
}

const hashDiff = (a, b) => SCOPE_FIELDS.map(([k]) => k).concat('success_criteria')
  .filter((k) => JSON.stringify(a[k] ?? null).replace(/\s+/g, ' ') !== JSON.stringify(b[k] ?? null).replace(/\s+/g, ' '));

function cmdPull(id, itemPath, mode, tracker) {
  if (!itemPath || !['check', 'refresh'].includes(mode)) {
    console.error('pull INT-xxx --item <read-item.json|-> --check|--refresh [--tracker jira|ado]');
    process.exit(2);
  }
  let item;
  try { item = JSON.parse(readFileSync(itemPath === '-' ? 0 : itemPath, 'utf8')); } catch (e) { console.error(`--item: ${e.message}`); process.exit(2); }
  if (!item || !item.key || typeof item.markdown !== 'string' || !item.revision) {
    console.error('--item needs the adapter\'s read-item JSON: { key, revision, summary, markdown }.'); process.exit(2);
  }
  const { intent, path, text } = intentFileOrDie(id);
  const was = parseSnapshotField((text.match(/^snapshot\s*:\s*(.*)$/m) || [])[1]);
  if (mode === 'refresh' && was && was.key === item.key && was.revision === String(item.revision)) {
    console.log(`${intent.id}: current (${item.key} revision unchanged).`);
    return;
  }
  const title = String(item.summary || intent.title).replace(/\s+/g, ' ').trim();
  const fmEnd = text.indexOf('\n---\n', 4);
  const fm = text.slice(4, fmEnd).split('\n').filter((l) => !/^(title|snapshot)\s*:/.test(l));
  const draft = (snap) => `---\n${[...fm, `title: ${title}`, `snapshot: ${renderSnapshotField(snap)}`].join('\n')}\n---\n\n` +
    `# ${intent.id} — ${title}\n\n${item.markdown.replace(/\r\n?/g, '\n').replace(/\s+$/, '')}\n`;
  const snap = { tracker: tracker || (was && was.tracker) || 'jira', key: item.key, revision: String(item.revision), at: new Date().toISOString().slice(0, 10) };
  const { intent: pulled, problems } = parseIntentFile(draft(snap), path);
  snap.proof = proofHash(pulled);
  const sameScope = scopeHash(pulled) === scopeHash(intent);
  const sameProof = proofHash(pulled) === proofHash(intent);
  if (mode === 'check' && (!sameScope || !sameProof || problems.length)) {
    console.error(`${intent.id}: the read-back from ${item.key} doesn't match the draft, so nothing was written.`);
    const fields = hashDiff(intent, pulled);
    if (fields.length) console.error(`  changed in the round trip: ${fields.join(', ')}`);
    for (const p of problems) console.error(`  ${p}`);
    console.error('  Fix the tracker item (or the converter) and pull again. Never commit around this.');
    process.exit(1);
  }
  writeFileSync(path, draft(snap));
  if (mode === 'check') { console.log(`${intent.id}: round trip ok (scope ${scopeHash(pulled)}, proof ${proofHash(pulled)}); snapshot of ${item.key} written.`); return; }
  console.log(`${intent.id}: refreshed from ${item.key}.`);
  if (!sameScope) console.log(`  The scope changed in the tracker (${hashDiff(intent, pulled).filter((f) => f !== 'success_criteria').join(', ')}): ` +
    'the ratification is stale until the Trusted Guide ratifies the new text, and a delivered intent shows as drift.');
  else if (!sameProof) console.log('  Success criteria changed: re-stamp the test script with /ql-test-script.');
  for (const p of problems) console.log(`  ⚠ ${p}`);
}

// Switching modes. Into `snapshot`, every intent must already carry a snapshot
// from a passing `pull --check`; out of it, the snapshot lines go and the repo
// copy becomes the canonical text again.
function cmdStorage(target) {
  if (!STORAGE_MODES.includes(target)) { console.error(`storage ${STORAGE_MODES.join('|')}`); process.exit(2); }
  if (target === 'pointer') { console.error('pointer mode is designed but not built (decisions/0082 W5). Ask for it on the Launchpad tracker.'); process.exit(1); }
  const profile = readProfileFile();
  const now = profile.intent_storage || 'repo';
  const files = loadIntentsWithPath();
  if (target === 'snapshot') {
    const missing = files.filter(({ path }) => {
      const snap = parseSnapshotField((readFileSync(path, 'utf8').match(/^snapshot\s*:\s*(.*)$/m) || [])[1]);
      return !snap || !snap.proof || !snap.revision;
    });
    if (missing.length) {
      console.error(`Not switching to snapshot: ${missing.length} intent(s) haven't passed the round trip yet: ${missing.map((f) => f.intent.id).join(', ')}.`);
      console.error('Write each to the tracker, read it back, and run `pull INT-xxx --item <file> --check`, then switch.');
      process.exit(1);
    }
  } else {
    for (const { path } of files) {
      const raw = readFileSync(path, 'utf8');
      if (/^snapshot\s*:/m.test(raw)) writeFileSync(path, raw.replace(/^snapshot\s*:.*\r?\n/m, ''));
    }
  }
  writeProfileFile({ ...profile, intent_storage: target });
  console.log(`Intent storage: ${now} → ${target} (${files.length} intent(s)).` + (target === 'repo' && now !== 'repo'
    ? ' The repo copy is the canonical text from here; stop editing it in the tracker.' : ''));
}

// validate, in snapshot mode: every intent is a copy with a snapshot, and its text
// still hashes to what the last pull wrote.
function snapshotIssues(intents) {
  if (storageMode() !== 'snapshot') return { issues: [], warnings: [] };
  const issues = [];
  const warnings = [];
  for (const i of intents) {
    const s = parseSnapshotField(i.snapshot);
    if (!s) { issues.push(`${i.id}: no snapshot line, but this engagement keeps intents in the tracker — write it there and \`pull --check\` it`); continue; }
    if (!s.proof || !s.revision) { issues.push(`${i.id}: its snapshot line has no ${!s.proof ? 'proof' : 'revision'}, so it never passed \`pull --check\`. Pull it again.`); continue; }
    if (s.proof !== proofHash(i)) issues.push(`${i.id}: edited in the repo since it was pulled from ${s.key} — change it in the tracker and pull, or revert the edit`);
    const days = Math.floor((Date.now() - Date.parse(s.at)) / 86400000);
    if (days > 30) warnings.push(`${i.id}: snapshot of ${s.key} last refreshed ${days} days ago`);
  }
  return { issues, warnings };
}

// ── writers: exact work skills used to do by hand (decisions/0082 W7, #231) ────
// stamp   — copy an intent's current hash into design.md / test-script.md
// next-id — the next criterion, defect, report filename or BLD id, collision-safe
// signoff — write a Sign-off cell in exactly the shape `coverage` parses
// A machine reads each of these later, so a machine writes them too: the writer
// and the parser can't drift.
function intentOrDie(id) {
  const want = normId(id);
  const found = loadIntents().find((i) => i.id.toUpperCase() === want);
  if (!found) { console.error(`${want} is not a known intent (no ${INTENTS_DIR}/${want}/intent.md).`); process.exit(1); }
  return found;
}

function setFrontmatterField(text, key, value) {
  const n = text.replace(/\r\n?/g, '\n');
  if (!n.startsWith('---\n')) return null;
  const end = n.indexOf('\n---\n', 4);
  if (end === -1) return null;
  const lines = n.slice(4, end).split('\n');
  const at = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (at === -1) lines.push(`${key}: ${value}`);
  else lines[at] = lines[at].replace(new RegExp(`^(${key}\\s*:\\s*)\\S*`), `$1${value}`);
  return `---\n${lines.join('\n')}${n.slice(end)}`;
}

function cmdStamp(id, where) {
  const files = { design: ['design.md', 'scope_hash'], 'test-script': ['test-script.md', 'proof_hash'] };
  if (!files[where]) { console.error('stamp INT-xxx --in design|test-script'); process.exit(2); }
  const intent = intentOrDie(id);
  const [file, key] = files[where];
  const path = join(INTENTS_DIR, intent.id, file);
  if (!existsSync(path)) { console.error(`No ${path} to stamp. Author it first.`); process.exit(1); }
  const value = key === 'proof_hash' ? proofHash(intent) : scopeHash(intent);
  const next = setFrontmatterField(readFileSync(path, 'utf8'), key, value);
  if (next === null) { console.error(`${path} has no frontmatter block to stamp.`); process.exit(1); }
  writeFileSync(path, next);
  console.log(`${path}: ${key} ${value}`);
}

function cmdNextId(kind, id, opts) {
  const pad = (n, w) => String(n).padStart(w, '0');
  const maxIn = (names, re) => Math.max(0, ...names.map((x) => (x.match(re) || [])[1]).filter(Boolean).map(Number));
  const ls = (dir) => { try { return readdirSync(dir); } catch { return []; } };
  if (kind === 'bld') {
    // One BLD sequence across the org's and this engagement's architecture records.
    const names = [...ls(BUILD_ADR_DIR), ...ls(join(DECISIONS_DIR, 'architecture'))];
    console.log(`BLD-${pad(maxIn(names, /^BLD-(\d+)/i) + 1, 4)}`);
    return;
  }
  const intent = intentOrDie(id);
  const dir = join(INTENTS_DIR, intent.id);
  if (kind === 'criterion') {
    let text = '';
    try { text = readFileSync(join(dir, 'test-script.md'), 'utf8'); } catch { /* none yet → C1 */ }
    const n = maxIn(text.match(new RegExp(`${intent.id}-C(\\d+)`, 'gi')) || [], new RegExp(`-C(\\d+)$`, 'i'));
    console.log(`${intent.id}-C${n + 1}`);
    return;
  }
  const evidence = join(dir, 'test-evidence');
  if (kind === 'defect') {
    console.log(`defect-${intent.id}-${pad(maxIn(ls(evidence), new RegExp(`^defect-${intent.id}-(\\d+)`, 'i')) + 1, 2)}`);
    return;
  }
  if (kind === 'report') {
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const commit = opts.commit || git(['rev-parse', '--short', 'HEAD']).out || 'nocommit';
    const base = `${date}-${commit}-execution-report`;
    let name = `${base}.md`;
    for (let k = 2; existsSync(join(evidence, name)); k++) name = `${base}-${k}.md`;
    console.log(join(evidence, name).split(sep).join('/'));
    return;
  }
  console.error('next-id bld | criterion INT-xxx | defect INT-xxx | report INT-xxx [--date YYYY-MM-DD] [--commit <sha>]');
  process.exit(2);
}

const SIGNOFF_VERDICTS = new Set(['pass', 'fail', 'not-run', 'blocked', 'deferred-as-is', 'deferred-backlog']);
function cmdSignoff(id, criterion, opts) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  let cell;
  if (opts.verify) {
    const forms = { green: `(verify — green, ${date})`, refutes: `❌ org refutes — ${opts.detail || 'see the org-probe evidence'}`, 'not-verified': '⚠ org not verified' };
    if (!forms[opts.verify]) { console.error('--verify green|refutes|not-verified'); process.exit(2); }
    cell = forms[opts.verify];
  } else {
    if (!opts.by || / \/ |\|/.test(opts.by)) { console.error('A human sign-off names the human: --by "<name>" (no " / " or "|").'); process.exit(2); }
    if (!SIGNOFF_VERDICTS.has(opts.verdict)) { console.error(`--verdict ${[...SIGNOFF_VERDICTS].join('|')}`); process.exit(2); }
    if (!opts.report) { console.error('--report <the execution report or defect filename> — the sign-off cites its evidence.'); process.exit(2); }
    // A deferral only closes the criterion with a pointer to where it went (coverage).
    if (opts.verdict.startsWith('deferred') && !opts.deferredTo) {
      console.error('A deferral names where it went: --deferred-to <INT-NNN | decisions/… | BACKLOG.md | URL>.'); process.exit(2);
    }
    cell = `${opts.by} / ${date} / ${opts.verdict} / ${opts.report}${opts.deferredTo ? ` → ${opts.deferredTo}` : ''}`;
  }
  const intent = intentOrDie(id);
  const path = join(INTENTS_DIR, intent.id, 'test-script.md');
  let text;
  try { text = readFileSync(path, 'utf8'); } catch { console.error(`No ${path}.`); process.exit(1); }
  const lines = text.split('\n');
  const want = String(criterion || '').toUpperCase();
  let header = null;
  let hit = false;
  for (let k = 0; k < lines.length; k++) {
    if (!lines[k].trim().startsWith('|')) { header = null; continue; }
    const cells = lines[k].split('|').slice(1, -1).map((c) => c.trim());
    if (!header) { header = cells.map((c) => c.toLowerCase()); continue; }
    if (cells[0].toUpperCase() !== want) continue;
    const col = header.findIndex((h) => h.startsWith('sign'));
    if (col === -1) { console.error(`${path}: the criteria table has no Sign-off column.`); process.exit(1); }
    // A ⚠️ partial's cell already records its automated half: --append keeps it.
    cells[col] = opts.append && cells[col] && !/^_?pending_?$/i.test(cells[col]) ? `${cells[col]} · manual: ${cell}` : cell;
    lines[k] = `| ${cells.join(' | ')} |`;
    hit = true;
  }
  if (!hit) { console.error(`${want} isn't a criterion in ${path}.`); process.exit(1); }
  writeFileSync(path, lines.join('\n'));
  console.log(`${want}: ${cell}`);
}

// ── brief: the build brief (decisions/0082 W6, #233) ──────────────────────────
// One generated brief per build, the same for every build agent: what to build and
// the rules to follow, assembled from ratified sources; never how to build. Written
// to the gitignored .launchpad/briefs/<engagement>/INT-x.md at the repo root, so
// pointer-mode requirement text never lands in history and the brief never goes
// stale in it. Its STAMP line is what gets committed (build note, PR §2): the
// hash of every input, so a PR can prove what it was built against. The exact
// parts are written here; the judgment parts are SLOTs the skill fills.
const BRIEF_RULES = [
  'Where the intent and design are silent on **how**, decide, keep building, and write the ruling down as `<ruling> — <why> — <cost if wrong>` in `decisions/YYYY-MM-DD-INT-00x-build-rulings.md` (Deciders: `agent rulings, pending Trusted Guide review in PR §6`).',
  '**Stop and ask** instead, even on a how question, when the choice changes *what* gets built; is destructive (deleting a field or object, changing a field type, anything that loses data, even when it looks unused); widens sharing, FLS or access beyond the design; is a material architecture call the design should have settled (reopen it with `/ql-design-intent`); or changes any org other than the build org.',
  '**The lane:** build to a PR into `develop` (or `main` when the repo has only `sf-validate` + `sf-deploy`). Integration orgs change only through PRs; release branches and prod promotion are the Trusted Guide\'s. No `--no-verify`, no gate bypass.',
];
const BRIEF_STEERING = 'Build with the Salesforce build toolkit your session has (its skills, generators and deploy commands), following its own conventions and precedence. This brief says what to build and what must hold; your toolkit decides how.';
const BRIEF_INTAKE = [
  'A PR into the lane above, built against the stamp at the top of this brief: paste the stamp line into PR §2.',
  'PR §2 maps every criterion (`INT-00x-Cy`) in the proof plan to its evidence, marked honestly (✅ automated / 👁 manual / ⚠️ partial / ⛔ blocked).',
  'PR §6 carries the build rulings note, every ruling with its why and cost.',
  'Leave the ledger alone: the session that takes the result in runs `deliver INT-00x --pr <ref>` as it assembles the PR, once the proof is complete. The ✅ is true when the Trusted Guide merges.',
];

const bodyOf = (text) => text.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
const demote = (md) => md.split('\n').map((l) => (/^#{1,5} /.test(l) ? `#${l}` : l)).join('\n');
const short = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

function designHashOf(text) { return short(bodyOf(text).replace(/^#.*\n/, '').trim()); }

// { exists, hash, stampCurrent, ratified: 'current'|'stale'|'missing', by, date }
function designState(intent) {
  const path = join(INTENTS_DIR, intent.id, 'design.md');
  if (!existsSync(path)) return { exists: false };
  const text = readFileSync(path, 'utf8');
  const fm = (text.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---\n/) || [])[1] || '';
  const field = (k) => ((fm.match(new RegExp(`^${k}\\s*:\\s*(.*)$`, 'm')) || [])[1] || '').replace(/\s+#.*$/, '').trim();
  const hash = designHashOf(text);
  const r = field('ratified').match(RATIFIED_RE);
  return {
    exists: true, path, text, hash,
    stampCurrent: field('scope_hash') === scopeHash(intent),
    ratified: !r ? 'missing' : r[3] === hash ? 'current' : 'stale', by: r && r[2], date: r && r[1],
  };
}

function cmdRatifyDesign(id, by) {
  if (!by || !by.trim() || by.startsWith('--')) { console.error('ratify INT-xxx --design --by "<Trusted Guide name>"'); process.exit(2); }
  const intent = intentOrDie(id);
  const d = designState(intent);
  if (!d.exists) { console.error(`No ${join(INTENTS_DIR, intent.id, 'design.md')} to ratify.`); process.exit(1); }
  const line = `${new Date().toISOString().slice(0, 10)} by ${by.trim().replace(/\s+/g, ' ')} @ ${d.hash}`;
  // Replace the whole line, as intent `ratify` does: the value has spaces in it.
  const text = d.text.replace(/\r\n?/g, '\n');
  const end = text.startsWith('---\n') ? text.indexOf('\n---\n', 4) : -1;
  if (end === -1) { console.error(`${d.path} has no frontmatter block.`); process.exit(1); }
  const fm = text.slice(4, end).split('\n').filter((l) => !/^ratified\s*:/.test(l));
  writeFileSync(d.path, `---\n${[...fm, `ratified: ${line}`].join('\n')}${text.slice(end)}`);
  console.log(`${intent.id} design: ratified: ${line}`);
}

// Custom metadata names an intent and its design mention (Account.Tier__c → Tier__c).
function metadataNames(text) {
  return [...new Set((text.match(/\b[A-Za-z][A-Za-z0-9_]*__(?:c|r|mdt|e|x|b|kav|share|history)\b/g) || []))].sort();
}

function otherEngagementHits(eng, names) {
  if (!names.length) return [];
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return entries.flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.md$/i.test(e.name) ? [join(dir, e.name)] : []));
  };
  for (const slug of listEngagements(eng.root)) {
    if (slug === eng.slug) continue;
    for (const file of walk(join(eng.root, ENGAGEMENTS_DIR, slug, 'decisions'))) {
      let text = '';
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      const found = names.filter((n) => text.includes(n));
      if (found.length) hits.push({ slug, file: file.slice(eng.root.length + 1).split(sep).join('/'), found });
    }
  }
  return hits;
}

// Scopezilla's user-facing `surface` values (its quantum-leap intent schema). The
// brief names them so the build and its proof plan cover usability.
const USER_FACING_SURFACES = new Set(['screen-flow', 'lightning-record-page', 'agentforce', 'console', 'lwc', 'experience-cloud']);

function cmdBrief(id, eng, opts) {
  const intent = intentOrDie(id);
  const slugId = `${eng.slug}/${intent.id}`;
  const intentPath = join(INTENTS_DIR, intent.id, 'intent.md');
  const intentText = readFileSync(intentPath, 'utf8');
  const rat = ratificationOf(intent);
  const d = designState(intent);
  const scriptPath = join(INTENTS_DIR, intent.id, 'test-script.md');
  const script = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : null;
  const proof = proofHash(intent);
  const scriptStamp = script ? ((script.match(/^proof_hash\s*:\s*([0-9a-f]{12})/m) || [])[1] || '') : '';

  const problems = [];
  if (rat.state !== 'current') problems.push(`the intent is not ratified at its current scope (${ratificationNote(intent)})`);
  if (d.exists && !d.stampCurrent) problems.push('design.md was drawn for a different scope (its scope_hash is stale): revisit it with /ql-design-intent');
  if (d.exists && d.ratified === 'stale') problems.push(`the design changed since ${d.by} ratified it on ${d.date}: re-ratify it`);
  if (d.exists && d.ratified === 'missing') problems.push('the design is not ratified: `ratify INT-xxx --design --by "<name>"` once the Trusted Guide approves it');
  if (script && scriptStamp !== proof) problems.push('the proof plan was drawn for a different scope (proof_hash is stale): re-stamp it with /ql-test-script');
  if (opts.for === 'hosted' && problems.length) {
    console.error(`Refusing a hosted hand-off of ${slugId}: a hosted build runs unattended, so it must start from ratified, current inputs.`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const ctx = loadDecisionContext();
  const b = decisionBrief(intent, intentText, ctx);
  const ledger = parseLedger({ soft: true }).byId;
  const statusOf = (x) => stampStatus((ledger[x.toUpperCase()] || {}).status || '') || STATUS.notStarted;
  const decisionLines = renderBrief(intent, b, citationWarnings(intent, b, statusOf(intent.id) === STATUS.delivered));
  const names = metadataNames(`${intentText}\n${d.exists ? d.text : ''}`);
  const hits = otherEngagementHits(eng, names);

  const all = loadIntents();
  const deps = (intent.dependencies && intent.dependencies.internal) || [];
  const upstream = all.filter((x) => deps.map((y) => normId(y)).includes(x.id.toUpperCase()));
  const downstream = all.filter((x) => ((x.dependencies && x.dependencies.internal) || []).map((y) => normId(y)).includes(intent.id.toUpperCase()));
  const siblings = all.filter((x) => x.id !== intent.id && intent.epic_id && x.epic_id === intent.epic_id
    && !upstream.includes(x) && !downstream.includes(x));
  const row = (x) => `- ${x.id} — ${x.title} — ${statusOf(x.id)}`;

  let profile = {};
  try { profile = JSON.parse(readFileSync('engagement.json', 'utf8')); } catch { /* no profile */ }
  const sources = (Array.isArray(profile.sources) ? profile.sources : []).filter((s) => s.role !== 'retired' && s.cursor)
    .map((s) => `${s.name}@${String(s.cursor).replace(/^hash:/, '').slice(0, 12)}`);
  const stampFields = [`intent=${intent.id}`, `scope=${scopeHash(intent)}`, `proof=${proof}`, `design=${d.exists ? d.hash : 'none'}`,
    `decisions=${short(decisionLines.join('\n'))}`, `sources=${sources.join(',') || 'none'}`];
  const stamp = stampFields.join(' ');
  const routing = [opts.agent && `agent=${opts.agent}`, opts.recommended && `recommended=${opts.recommended}`].filter(Boolean).join(' ');

  let notes = '';
  try { notes = bodyOf(readFileSync(join(ORG_DIR, 'build-notes.md'), 'utf8')); } catch { /* none */ }
  const grounding = (intent.grounding && intent.grounding.entries) || [];

  const out = [
    `# Build brief: ${slugId} — ${intent.title}`,
    `<!-- BRIEF:STAMP ${stamp} built=${new Date().toISOString()} for=${opts.for || 'session'}${routing ? ` ${routing}` : ''} -->`,
    '',
    '_Generated by `intent-ledger.mjs brief` from the engagement\'s ratified sources. It is not committed: regenerate it, never edit it. Build to it; your toolkit decides how._',
    '',
    ...(problems.length ? ['> **⚠ Not ready for an unattended build:**', ...problems.map((p) => `> - ${p}`), ''] : []),
    `## 1. Intent — ${intent.id} (scope ${scopeHash(intent)}; ${rat.state === 'current' ? `ratified by ${rat.by} on ${rat.date}` : '⚠ not ratified'})`, '',
    ...(intent.surface ? [USER_FACING_SURFACES.has(intent.surface.toLowerCase())
      ? `Surface: ${intent.surface} (user-facing): prove a person can use it, not only that it exists.` : `Surface: ${intent.surface}`, ''] : []),
    demote(bodyOf(intentText).replace(/^# .*\n/, '').trim()), '',
    `## 2. Design${d.exists ? ` (design ${d.hash}; ${d.ratified === 'current' ? `ratified by ${d.by} on ${d.date}` : '⚠ not ratified at this text'})` : ''}`, '',
    d.exists ? demote(bodyOf(d.text).replace(/^# .*\n/, '').trim())
      : '_No design.md: treated as a trivial intent. Take the neighbourhood (5) and the existing-org read (6) seriously; if either turns up something non-trivial, design it first with `/ql-design-intent`._', '',
    `## 3. Proof plan${script ? ` (proof ${proof}; ${scriptStamp === proof ? 'stamped current' : '⚠ stamped for another scope'})` : ''}`, '',
    script ? (script.split('\n').filter((l) => /^\|/.test(l.trim())).join('\n') || '_The test script has no criteria table._')
      : '_No test-script.md yet: draft it with `/ql-test-script` before building, so "done" means proven._', '',
    '## 4. Binding decisions', '',
    ...decisionLines, '',
    '### Other engagements in this repo', '',
    ...(hits.length ? hits.map((h) => `- ${h.slug}: ${h.file} (${h.found.join(', ')})`) : [names.length
      ? `_No other engagement's decisions mention ${names.join(', ')}._` : '_This intent names no custom metadata to search for._']),
    ...(hits.length ? ['', '<!-- SLOT: significance — for each hit above, whether it constrains this build and how. -->'] : []), '',
    '## 5. Neighbourhood', '',
    '**Built on** (upstream; build consistently with what\'s delivered):', ...(upstream.length ? upstream.map(row) : ['- none']), '',
    '**Built on by** (downstream; don\'t corner them):', ...(downstream.length ? downstream.map(row) : ['- none']), '',
    `**Epic siblings** (epic ${intent.epic_id || '—'}, no declared dependency):`, ...(siblings.length ? siblings.map(row) : ['- none']), '',
    '## 6. Existing org', '',
    '<!-- SLOT: existing-org — what force-app/ and the org already have for the metadata this intent touches, and the disposition of each: reuse, extend, or collision (stop and ask). Or "⚠ org not consulted" with why. -->', '',
    '## 7. Grounding', '',
    ...(grounding.length ? grounding.map((g) => `- ${g.label}: ${g.value}`) : ['_Not grounded: no requirement or architecture link._']),
    ...(grounding.length ? ['', '<!-- SLOT: grounding — the short excerpts that matter, read in place with `source show`. -->'] : []), '',
    '## 8. Org notes', '',
    notes ? demote(notes) : '_No build notes for this org yet._', '',
    '## 9. Rules', '',
    ...BRIEF_RULES.map((r) => `- ${r}`), '',
    '## 10. Steering', '',
    BRIEF_STEERING, '',
    '## 11. Intake', '',
    'Hand back:', ...BRIEF_INTAKE.map((r) => `- ${r}`), '',
  ];
  const dir = join(eng.root, '.launchpad', 'briefs', eng.slug);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${intent.id}.md`);
  writeFileSync(file, out.join('\n'));
  console.log(`Wrote ${file.slice(eng.root.length + 1).split(sep).join('/')}${problems.length ? ` (⚠ ${problems.length} readiness warning(s) at the top)` : ''}.`);
  console.log(`brief: ${slugId} ${stampFields.slice(1).join(' ')}${routing ? ` ${routing}` : ''}`);
}

// ── outcomes: per-build signals in the build note (decisions/0082 W6, #233) ────
// Written at close-out, by code: the routing pick (from the note's routing line),
// the counts the note itself holds (rulings, stop-and-asks), and two counts the
// skill reads from GitHub and passes in (red gate runs before green, review
// rounds), since the engine never calls out. Every value is a fact the loop
// observed; a count nobody measured is refused, never guessed.
const BUILD_KINDS = new Set(['field', 'object', 'flow', 'apex', 'lwc', 'integration', 'permissions', 'data', 'config', 'other']);
const OUTCOMES_RE = /^outcomes: (.+)$/m;

function buildNoteFor(id) {
  let names = [];
  try { names = readdirSync(DECISIONS_DIR).filter((n) => new RegExp(`-${id}-build-rulings\\.md$`, 'i').test(n)).sort(); } catch { /* none */ }
  return names.length ? join(DECISIONS_DIR, names[names.length - 1]) : null;
}

function parseRouting(text) {
  const m = text.match(/^routing: recommended ([^,]+), picked ([^,]+), (accepted|override)\b/m);
  return m ? { recommended: m[1].trim(), agent: m[2].trim(), override: m[3] === 'override' } : null;
}

function cmdOutcomes(id, opts) {
  const intent = intentOrDie(id);
  const count = (v, flag) => {
    if (!/^\d+$/.test(String(v ?? ''))) { console.error(`${flag} <n>: a count you read, not an estimate.`); process.exit(2); }
    return Number(v);
  };
  if (!BUILD_KINDS.has(opts.kind)) { console.error(`--kind ${[...BUILD_KINDS].join('|')}`); process.exit(2); }
  const red = count(opts.redRuns, '--red-runs');
  const rounds = count(opts.reviewRounds, '--review-rounds');
  const path = buildNoteFor(intent.id);
  if (!path) { console.error(`No build-rulings note for ${intent.id} in ${DECISIONS_DIR}/ to record outcomes in.`); process.exit(1); }
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
  const routing = parseRouting(text);
  if (!routing) { console.error(`${path} has no routing line ("routing: recommended <x>, picked <y>, accepted|override, <why>").`); process.exit(1); }
  const items = text.split('\n').filter((l) => /^\s*-\s+\S/.test(l));
  const asks = items.filter((l) => /^\s*-\s+ASKED:/.test(l)).length;
  const rulings = items.filter((l) => !/^\s*-\s+ASKED:/.test(l) && (l.match(/ — /g) || []).length >= 2).length;
  const line = `outcomes: agent=${routing.agent} recommended=${routing.recommended} override=${routing.override ? 'yes' : 'no'} ` +
    `kind=${opts.kind} red_runs=${red} review_rounds=${rounds} rulings=${rulings} asks=${asks}`;
  const block = `## Outcomes\n\n<!-- written by intent-ledger.mjs outcomes at close-out; don't hand-edit -->\n${line}\n`;
  const next = /^## Outcomes\n[\s\S]*?^outcomes: .*\n?/m.test(text)
    ? text.replace(/^## Outcomes\n[\s\S]*?^outcomes: .*\n?/m, block)
    : `${text.replace(/\n*$/, '\n')}\n${block}`;
  writeFileSync(path, next);
  console.log(`${path}: ${line}`);
}

// Read back every build note's outcomes, plus whether the intent flipped to 🔄 within
// 30 days of first reaching ✅ (from the ledger's git history; unknown without it).
function reverifiedWithin30(id) {
  if (!inGitRepo()) return null;
  const log = git(['log', '--reverse', '--format=%H\t%aI', '--', LEDGER]);
  if (!log.ok || !log.out) return null;
  let delivered = null;
  for (const line of log.out.split('\n')) {
    const [sha, date] = line.split('\t');
    const file = git(['show', `${sha}:${treePath(LEDGER)}`]);
    if (!file.ok) continue;
    const st = stampStatus((parseLedgerText(file.out).byId[id] || {}).status || '');
    if (!delivered && st === STATUS.delivered) delivered = new Date(date);
    else if (delivered && st === STATUS.drift) return (new Date(date) - delivered) / 86400000 <= 30;
  }
  return delivered ? false : null;
}

function outcomeRows() {
  let names = [];
  try { names = readdirSync(DECISIONS_DIR).filter((n) => /-build-rulings\.md$/i.test(n)); } catch { return []; }
  const rows = [];
  for (const name of names) {
    const m = readFileSync(join(DECISIONS_DIR, name), 'utf8').match(OUTCOMES_RE);
    if (!m) continue;
    // Values may hold spaces (`agent=Claude Code`), so split on ` key=`, not on spaces.
    const f = Object.fromEntries([...m[1].matchAll(/(\w+)=(.*?)(?= \w+=|$)/g)].map((x) => [x[1], x[2]]));
    const id = (name.match(/(INT-\d+[a-z]?)-build-rulings/i) || [])[1];
    rows.push({ id: id && id.toUpperCase(), agent: f.agent, recommended: f.recommended, override: f.override === 'yes', kind: f.kind,
      red_runs: Number(f.red_runs), review_rounds: Number(f.review_rounds), rulings: Number(f.rulings), asks: Number(f.asks) });
  }
  return rows;
}

const SMALL_SAMPLE = 5;
function cmdMetricsByAgent(json) {
  const rows = outcomeRows().map((r) => ({ ...r, reverified_30d: r.id ? reverifiedWithin30(r.id) : null }));
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
  const keyOf = (r) => `${r.agent}\t${r.kind}`;
  const groups = [...new Set(rows.map(keyOf))].sort().map((key) => {
    const g = rows.filter((r) => keyOf(r) === key);
    const known = g.filter((r) => r.reverified_30d !== null);
    return {
      agent: g[0].agent, kind: g[0].kind, n: g.length, overrides: g.filter((r) => r.override).length,
      red_runs_median: median(g.map((r) => r.red_runs)), review_rounds_median: median(g.map((r) => r.review_rounds)),
      rulings_median: median(g.map((r) => r.rulings)), asks_total: g.reduce((a, r) => a + r.asks, 0),
      reverified_30d: known.length ? known.filter((r) => r.reverified_30d).length : null, reverify_known: known.length,
      small_sample: g.length < SMALL_SAMPLE,
    };
  });
  if (json) { console.log(JSON.stringify({ source: 'build-rulings notes', builds: rows.length, groups }, null, 2)); return; }
  if (!rows.length) { console.log('No build has recorded outcomes yet (intent-ledger.mjs outcomes, at close-out).'); return; }
  console.log(`Build outcomes by build agent and kind — ${rows.length} build(s), from the build-rulings notes.\n`);
  for (const g of groups) {
    const rv = g.reverified_30d === null ? 'unknown' : `${g.reverified_30d}/${g.reverify_known}`;
    console.log(`${g.agent.padEnd(14)} ${g.kind.padEnd(12)} n=${g.n}  red runs (median) ${g.red_runs_median}  review rounds ${g.review_rounds_median}  ` +
      `rulings ${g.rulings_median}  asks ${g.asks_total}  re-verify ≤30d ${rv}  overrides ${g.overrides}${g.small_sample ? '  (too few builds to compare)' : ''}`);
  }
  console.log(`\nA group under ${SMALL_SAMPLE} builds is too few to compare. These are counts, not a ranking: which agent suits which work is the Trusted Guide's read.`);
}

// ── summary: the factual half of SUMMARY.md (decisions/0082 W1) ────────────────
// Written once, at close, by /ql-close-engagement. Where every intent ended, read
// from the ledger in code, so the record of what shipped is never a tally someone
// typed. The narrative slot is the Trusted Guide's, filled by the skill.
const SUMMARY_FILE = 'SUMMARY.md';

function renderSummary(slug) {
  const intents = loadIntents();
  const { byId } = parseLedger({ soft: true });
  const rows = intents.map((i) => {
    const row = byId[i.id.toUpperCase()] || {};
    return { id: i.id, title: i.title, status: stampStatus(row.status) || STATUS.notStarted, pr: row.pr || '—', evidence: row.evidence || '—' };
  });
  const delivered = rows.filter((r) => r.status === STATUS.delivered);
  const retired = rows.filter((r) => r.status === STATUS.retired);
  const open = rows.filter((r) => r.status !== STATUS.delivered && r.status !== STATUS.retired);
  const noun = rows.length === 1 ? 'intent' : 'intents';
  const out = [`# ${slug}: engagement summary`, '',
    `_Written at close by \`/ql-close-engagement\`. The lists are generated from \`${LEDGER}\`; ` +
    'the engagement is frozen, so they no longer change._', '',
    `**${rows.length} ${noun}**: ${delivered.length} delivered, ${retired.length} retired, ${open.length} open at close.`, '',
    '<!-- SUMMARY:NARRATIVE -->', '', '_The Trusted Guide\'s account of the engagement goes here._', '',
    '<!-- SUMMARY:NARRATIVE:END -->', ''];
  const table = (title, head, items, cells) => {
    out.push(`## ${title} (${items.length})`, '');
    if (!items.length) { out.push('_None._', ''); return; }
    out.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const r of items) out.push(`| ${cells(r).join(' | ')} |`);
    out.push('');
  };
  table('Delivered', ['Intent', 'Title', 'PR'], delivered, (r) => [r.id, r.title, r.pr]);
  table('Retired', ['Intent', 'Title', 'Decision'], retired, (r) => [r.id, r.title, r.evidence]);
  table('Open at close', ['Intent', 'Title', 'Status'], open, (r) => [r.id, r.title, r.status]);
  return out.join('\n');
}

// close / reopen: the status CI gates on, written by code (decisions/0082 W1).
function cmdClose(eng) {
  const profile = readProfileFile();
  if (profile.status === 'closed') { console.error(`${eng.slug} is already closed.`); process.exit(1); }
  if (!existsSync(SUMMARY_FILE)) { console.error(`Write the close record first: summary --write (no ${SUMMARY_FILE} in ${eng.slug} yet).`); process.exit(1); }
  writeProfileFile({ ...profile, status: 'closed', closed_at: new Date().toISOString().slice(0, 10) });
  const localPath = join(eng.root, '.launchpad', 'local.json');
  try {
    const local = JSON.parse(readFileSync(localPath, 'utf8'));
    if (local.active_engagement === eng.slug) { delete local.active_engagement; writeFileSync(localPath, JSON.stringify(local, null, 2) + '\n'); }
  } catch { /* no local.json */ }
  console.log(`${eng.slug}: closed. Commit ${SUMMARY_FILE} and engagement.json as one close PR, with nothing else in it.`);
}

function cmdReopen(eng, decision) {
  const profile = readProfileFile();
  if (profile.status !== 'closed') { console.error(`${eng.slug} isn't closed.`); process.exit(1); }
  if (!decision || !existsSync(decision)) {
    console.error('reopen --decision <decisions/YYYY-MM-DD-reopen.md>: record why it reopens first (a late defect, a change order, a missed criterion).');
    process.exit(2);
  }
  const { closed_at: _closed, ...rest } = profile;
  writeProfileFile({ ...rest, status: 'open' });
  console.log(`${eng.slug}: reopened. Put ${decision} and engagement.json in their own PR; the work goes in later PRs.`);
}

function cmdSummary(slug, write) {
  const text = renderSummary(slug);
  if (!write) { console.log(text); return; }
  if (existsSync(SUMMARY_FILE)) {
    console.error(`${SUMMARY_FILE} already exists here. It's the close record, so it is never regenerated over.`);
    process.exit(1);
  }
  writeFileSync(SUMMARY_FILE, text);
  console.log(`Wrote ${SUMMARY_FILE}. Fill the narrative between the SUMMARY:NARRATIVE markers.`);
}

function spliceIndex(readme, block) {
  const b = readme.indexOf(INDEX_BEGIN);
  const e = readme.indexOf(INDEX_END);
  if (b !== -1 && e !== -1 && e > b) {
    return readme.slice(0, b) + block + readme.slice(e + INDEX_END.length);
  }
  const afterEngagement = readme.indexOf('<!-- ENGAGEMENT:END -->');
  if (afterEngagement !== -1) {
    const at = afterEngagement + '<!-- ENGAGEMENT:END -->'.length;
    return readme.slice(0, at) + '\n\n' + block + readme.slice(at);
  }
  const nl = readme.indexOf('\n');
  const at = nl === -1 ? readme.length : nl + 1;
  return readme.slice(0, at) + '\n' + block + '\n' + readme.slice(at);
}

function cmdIndex(write, { quiet = false } = {}) {
  const block = renderIndexBlock();
  if (!write) {
    console.log(block);
    return;
  }
  let readme;
  try {
    readme = readFileSync(README, 'utf8');
  } catch (e) {
    console.error(`Could not read ${README}: ${e.message}`);
    console.error('Run from the engagement repo root.');
    process.exit(2);
  }
  const next = spliceIndex(readme, block);
  if (next === readme) {
    if (!quiet) console.error('Index already up to date — no change.');
    return;
  }
  writeFileSync(README, next);
  if (!quiet) console.error(`Updated delivery index in ${README}.`);
}

// ── coverage ────────────────────────────────────────────────────────────────
// Test scripts are co-located with their intent: intents/INT-NNN/test-script.md,
// authored by /ql-test-script. Each carries frontmatter with a `scope_hash:` stamped
// at authoring, and a "## Criteria" table whose rows mark a proof type.

// Find intents/INT-*/test-script.md.
function findTestScripts() {
  const out = [];
  let dirs;
  try {
    dirs = readdirSync(INTENTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^INT-\d+/i.test(e.name));
  } catch { return out; }
  for (const d of dirs) {
    const path = `${INTENTS_DIR}/${d.name}/test-script.md`;
    if (existsSync(path)) out.push(path);
  }
  return out;
}

// A defect is "resolved" (out of the open count) only in one of these terminal
// states; everything else (open / needs-info / fixed-awaiting-retest, or an
// unrecognized value) is unresolved. `fixed` is NOT resolved — a fix landed but
// nobody re-verified it (the criterion is still 🔁). See issue #93.
const RESOLVED_DEFECT = new Set(['verified', 'deferred', 'not-a-defect']);

// Scan each intent's test-evidence/defect-*.md and count unresolved defects, so
// coverage/preflight can SURFACE them (a Delivered intent with an open defect —
// the report's PII finding — must never read as a clean green). Zero-dep, tolerant
// of a missing dir. Returns { [ID]: { total, unresolved } }, only intents with any.
function scanDefects() {
  const out = {};
  let dirs;
  try {
    dirs = readdirSync(INTENTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory() && /^INT-\d+/i.test(e.name));
  } catch { return out; }
  for (const d of dirs) {
    const evDir = `${INTENTS_DIR}/${d.name}/test-evidence`;
    let files;
    try { files = readdirSync(evDir).filter((f) => /^defect-.*\.md$/i.test(f)); }
    catch { continue; }
    let total = 0, unresolved = 0;
    for (const f of files) {
      let text;
      try { text = readFileSync(`${evDir}/${f}`, 'utf8'); } catch { continue; }
      total++;
      // Read status only from the frontmatter fence, so a `status:` word in the
      // narrative body can't be mistaken for the lifecycle field.
      let fm = text;
      if (text.startsWith('---\n')) { const end = text.indexOf('\n---\n', 4); if (end !== -1) fm = text.slice(4, end); }
      const m = fm.match(/^status:\s*(.+)$/mi);
      const status = (m ? m[1] : 'open').replace(/[`'"]/g, '').trim().toLowerCase();
      if (!RESOLVED_DEFECT.has(status)) unresolved++;
    }
    if (total) out[d.name.toUpperCase()] = { total, unresolved };
  }
  return out;
}

function parseTestScript(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n?/g, '\n'); // normalize CRLF/CR so the --- fence parses on Windows
  const fm = {};
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---\n', 4);
    if (end !== -1) {
      for (const line of text.slice(4, end).split('\n')) {
        const m = line.match(/^([A-Za-z_]+):\s*(.*)$/);
        if (m) fm[m[1]] = m[2].replace(/#.*$/, '').replace(/[`'"]/g, '').trim();
      }
    }
  }
  const tableLines = text.split('\n').filter((l) => l.trim().startsWith('|'));
  const splitCells = (line) => line.split('|').slice(1, -1).map((c) => c.trim());
  let typeCol = -1;
  let idCol = -1;
  let headerIdx = -1;
  for (let i = 0; i < tableLines.length; i++) {
    const h = splitCells(tableLines[i]).map((c) => c.toLowerCase());
    const t = h.findIndex((c) => c === 'type');
    const d = h.findIndex((c) => c === 'id');
    if (t !== -1 && d !== -1) { typeCol = t; idCol = d; headerIdx = i; break; }
  }
  // retest        = 🔁 fix landed, awaiting retest (gates)
  // acceptedGap   = 📋 total (a criterion consciously closed WITHOUT proving it)
  // acceptedGapBare = a 📋 missing its named accepter + pointer → treated as unproven,
  //                   so 📋 can't become a silent "mark unproven work done" (issue #96).
  // manualFailed     = a 👁 whose Sign-off records a `fail` verdict → unproven (gates).
  // deferredUnrouted = a 👁 signed `deferred-*` with no pointer to where the deferral
  //                    was formalized → unproven, same bar as a bare 📋 (decisions/0036).
  // orgRefuted       = an org-probe ✅ whose Sign-off records `❌ org refutes` — the
  //                    build org said no, so the ✅ is unproven (gates; decisions/0031
  //                    amendment). orgUnverified = an org-probe ✅ never confirmed
  //                    against an org (`(verify)`, `⚠ org not verified`) — noted only.
  const markers = { auto: 0, manual: 0, partial: 0, blocked: 0, retest: 0, acceptedGap: 0, acceptedGapBare: 0, manualFailed: 0, deferredUnrouted: 0, orgRefuted: 0, orgUnverified: 0, manualNotProven: 0, none: 0, total: 0 };
  const orgRefutedIds = [];
  const manualFailedIds = [];
  const manualNotProvenIds = [];
  const deferredUnroutedIds = [];
  let manualPending = 0;
  // Well-formed accepted gaps that point at another intent (INT-NNN), so
  // `coverage` can later check whether that pointer target has since delivered —
  // see the acceptedGaps push below and coverageRowFor's "ready to revisit" check.
  const acceptedGaps = [];
  // For each ✅ row, the Class.method test reference(s) named in its "How proven"
  // cell — the join from a proof claim to the test that must actually be green in
  // CI. `coverage --results` checks these; without it, ✅ stays an agent assertion.
  const autoCriteria = [];
  if (headerIdx !== -1) {
    const h = splitCells(tableLines[headerIdx]).map((c) => c.toLowerCase());
    const signCol = h.findIndex((c) => c.includes('sign'));
    const provenCol = h.findIndex((c) => c.includes('proven') || c.includes('how'));
    for (const line of tableLines.slice(headerIdx + 2)) {
      const c = splitCells(line);
      // Read the Id column wherever the header says it is, with the same one
      // reader every ledger id uses. This was the sixth id reader: it hardcoded
      // column 0 while its own header lookup located `type`/`sign`/`proven` by
      // name, and it stripped its own subset of decoration (no `~`). Either miss
      // silently DROPPED the row — and a dropped criterion isn't a failure, it
      // just lowers the total, so it can only ever flatter the count.
      const id = idCellValue(c[idCol]).toUpperCase();
      if (!/^INT-\d+-C\d+/i.test(id)) continue;
      markers.total++;
      const type = c[typeCol] || '';
      if (/✅/.test(type)) {
        markers.auto++;
        // Pull Class.method test refs out of the "how proven" cell — ONLY from
        // backtick-delimited spans, matching the /ql-test-script convention of writing
        // the test as `Class.method`. This is deliberately strict: an unfenced dotted
        // token (a field reference like Account.Industry, an API name, a file path)
        // must NOT be mistaken for a test, or it'd read as a "missing test" and could
        // fail the gate on honestly-green work. So we scan only inside `...` and keep
        // the Class.method-shaped ones. A ✅ proven by a SOQL/config assertion (no
        // backticked Class.method) yields an empty tests[] — correctly "unconfirmed",
        // never "missing" (see evalAutoResults).
        const cell = provenCol !== -1 ? (c[provenCol] || '') : '';
        const refs = [];
        for (const span of cell.matchAll(/`([^`]+)`/g)) {
          const inner = span[1].trim();
          // A test ref is a single Class.method token (optionally Namespace.Class.method),
          // nothing else inside the backticks — so `Account.Industry is populated` (a
          // prose-y backtick) won't match, but `MedHistTest.assessorCannotSee` will.
          if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(inner)) refs.push(inner);
        }
        autoCriteria.push({ id, tests: refs });
        // org-probe ✅: /ql-verify-build records the org's verdict in the Sign-off
        // cell. This reads that COMMITTED record — it never queries an org.
        const signCell = signCol !== -1 ? (c[signCol] || '') : '';
        if (/org[- ]probe/i.test(cell) || /\(verify\b/i.test(signCell)) {
          if (/❌|org refutes/i.test(signCell)) { markers.orgRefuted++; orgRefutedIds.push(id); }
          else if (!/verify\s*[—–-]\s*green/i.test(signCell)) markers.orgUnverified++;
        }
      } else if (/👁/.test(type)) {
        markers.manual++;
        const sign = signCol !== -1 ? (c[signCol] || '') : '';
        // A criterion is "awaiting sign-off" only if the cell is empty, a bare
        // placeholder (just a dash), or literally says pending/tbd. The dash test
        // is anchored to the WHOLE cell (`/^[—–-]+$/`) — an em-dash MID-cell is the
        // natural separator for the evidence citation /ql-record-test-execution
        // writes ("Name / date / pass — evidence `…report.md`"), so an unanchored
        // dash test mis-read a well-formed, evidence-citing sign-off as unsigned
        // (issue #92 — the richer the sign-off, the more likely it was miscounted).
        const s = sign.replace(/[*_]/g, '').trim();
        const fields = s.split(/\s+\/\s+/).map((f) => f.trim().toLowerCase());
        // Pending = an empty/placeholder cell, or a verdict FIELD of pending/tbd — not
        // the substring anywhere ("Pat Pending / … / pass" is signed).
        if (!sign || /^(pending|tbd)$/i.test(s) || /^[—–-]+$/.test(s) || fields.some((f) => /^(pending|tbd)$/.test(f))) manualPending++;
        else {
          // A signed cell is `name / date / verdict / artifact`. Only a `pass` (or a
          // routed deferral) closes the criterion: a recorded `fail` is a human saying
          // it DOESN'T work, and a bare `deferred-*` is a tester's call that hasn't
          // been formalized in scope yet — it needs the same pointer a 📋 does
          // (decision record, other intent, BACKLOG.md, URL). A defect filename and
          // this intent's own id don't count as pointers.
          if (fields.some((f) => /^fail(ed)?$/.test(f))) { markers.manualFailed++; manualFailedIds.push(id); }
          // A recorded verdict that says the criterion was NOT proven (not run,
          // blocked, skipped) is unproven, not signed. Free-form legacy sign-offs
          // without a recognizable verdict still read as signed.
          else if (fields.some((f) => /^(not[- ]?run|blocked|skip(ped)?|incomplete|n\/?a)$/.test(f))) {
            markers.manualNotProven++; manualNotProvenIds.push(id);
          }
          else if (fields.some((f) => /^deferred(-[\w-]+)?$/.test(f))) {
            const own = (fm.intent || '').toUpperCase();
            const ptrText = sign.replace(/defect-INT-\d+(-\d+)?(\.md)?/gi, '');
            const otherIntent = (ptrText.match(/INT-\d+/gi) || []).some((x) => x.toUpperCase() !== own);
            if (!(otherIntent || /decisions\/|https?:\/\/|BACKLOG\.md/i.test(ptrText))) {
              markers.deferredUnrouted++; deferredUnroutedIds.push(id);
            }
          }
        }
      } else if (/⚠️|⚠/.test(type)) markers.partial++;
      else if (/⛔/.test(type)) markers.blocked++;
      else if (/🔁/.test(type)) markers.retest++;
      else if (/📋/.test(type)) {
        // Accepted gap — closed without proof. It earns its non-gating status ONLY
        // when it carries a named accepter AND a pointer (follow-on intent, decision
        // record, URL, or an explicit waiver); the accepter/pointer may live in the
        // "how proven" or "sign-off" cell. A bare 📋 is treated as unproven so it
        // can't be a sanctioned way to mark unproven work done (issue #96).
        markers.acceptedGap++;
        const cellText = `${provenCol !== -1 ? (c[provenCol] || '') : ''} ${signCol !== -1 ? (c[signCol] || '') : ''}`;
        const hasAccepter = /\bby\s+\S+/i.test(cellText);
        const hasPointer = /INT-\d+|decisions\/|https?:\/\/|\bwaiver\b/i.test(cellText);
        if (!(hasAccepter && hasPointer)) markers.acceptedGapBare++;
        else {
          // Extract which OTHER intent(s) this gap points at, so coverage can
          // later check whether the pointer target has since delivered. A
          // same-intent mention (this criterion citing a sibling INT-070-C2) is
          // not a cross-intent pointer — excluded by comparing against fm.intent.
          const self = (fm.intent || '').toUpperCase();
          const pointerIntents = [...new Set((cellText.match(/INT-\d+/gi) || []).map((x) => x.toUpperCase()))]
            .filter((ptr) => ptr !== self);
          if (pointerIntents.length) acceptedGaps.push({ id, pointerIntents });
        }
      }
      else markers.none++;
    }
  }
  return {
    path,
    intent: (fm.intent || '').toUpperCase(),
    scopeHash: (fm.scope_hash || '').trim(),   // legacy stamp (scope fields only)
    proofHash: (fm.proof_hash || '').trim(),   // current stamp (scope fields + success criteria)
    markers,
    manualPending,
    manualFailedIds,
    manualNotProvenIds,
    deferredUnroutedIds,
    orgRefutedIds,
    acceptedGaps,
    autoCriteria,
    hasTable: headerIdx !== -1,
  };
}

// ── CI test-results parsing (for `coverage --results`) ───────────────────────
// Turn an `sf` test/deploy result file into a lookup of class.method → pass/fail,
// so a ✅ criterion's named test can be CONFIRMED green rather than trusted. Zero-dep:
// JSON via JSON.parse, JUnit XML via regex. Tolerant of the common `sf` shapes —
// `project deploy validate --json` (runTestResult.successes/failures) and
// `apex run test --json` (tests[] with Outcome) — plus JUnit `<testcase>`.
function collectJsonResults(data, set) {
  const r = (data && data.result) || data || {};
  const rtr = r.details?.runTestResult || r.runTestResult;
  if (rtr) {
    for (const s of rtr.successes || []) set(s.name, s.methodName, 'pass');
    for (const f of rtr.failures || []) set(f.name, f.methodName, 'fail');
  }
  const tests = r.tests || (data && data.tests);
  if (Array.isArray(tests)) {
    for (const t of tests) {
      const outcome = String(t.Outcome || t.outcome || '').toLowerCase();
      // pass → pass; skip → skip (ran nothing, proves nothing); anything else with
      // an outcome (fail/compilefail) → fail. No outcome → ignore the row.
      const status = outcome === 'pass' ? 'pass' : !outcome ? null : outcome === 'skip' ? 'skip' : 'fail';
      if (!status) continue;
      const full = String(t.FullName || t.fullName || '');
      const cls = t.ApexClass?.Name || t.apexClass?.name || full.split('.')[0];
      const method = t.MethodName || t.methodName || full.split('.')[1];
      set(cls, method, status);
    }
  }
}

function parseTestResults(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (e) {
    console.error(`Could not read test results ${file}: ${e.message}`);
    process.exit(2);
  }
  const byKey = new Map(); // "class.method" (lowercased) → 'pass' | 'fail' | 'skip'
  // Worst verdict wins when a Class.method appears twice (a retry, merged suites):
  // a pass must never hide a fail just by coming later in the file.
  const RANK = { pass: 0, skip: 1, fail: 2 };
  const set = (cls, method, status) => {
    if (!cls || !method) return;
    const k = `${cls}.${method}`.toLowerCase();
    const prev = byKey.get(k);
    if (prev === undefined || RANK[status] > RANK[prev]) byKey.set(k, status);
  };
  const trimmed = text.trim();
  let parseError = null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let data = null;
    // A truncated/malformed file must not read as "no tests" silently — keep the
    // error so the caller can name it next to its "no results parsed" warning.
    try { data = JSON.parse(trimmed); } catch (e) { parseError = e.message; }
    if (data) collectJsonResults(data, set);
  } else if (trimmed.includes('<testcase')) {
    const re = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
    let m;
    while ((m = re.exec(text))) {
      const attrs = m[1];
      const inner = m[2] || '';
      // XML allows either quote style.
      const name = (attrs.match(/\bname\s*=\s*(["'])(.*?)\1/) || [])[2];
      const cls = (attrs.match(/\bclassname\s*=\s*(["'])(.*?)\1/) || [])[2];
      // A <skipped/> testcase ran nothing — it must not read as green.
      set(cls, name, /<(?:failure|error)\b/.test(inner) ? 'fail' : /<skipped\b/.test(inner) ? 'skip' : 'pass');
    }
  }
  // Set of test CLASSES that appear in the run (lowercased), so we can tell a
  // genuinely-missing method (its class ran, the method didn't → likely a typo /
  // deleted test) apart from a test simply not in this run (its class never ran →
  // a delta run, or the ref isn't an Apex test at all).
  const classesRun = new Set([...byKey.keys()].map((k) => k.split('.').slice(0, -1).join('.')));
  return {
    count: byKey.size,
    parseError,
    lookup: (ref) => byKey.get(String(ref).toLowerCase()) ?? null,
    classRan: (ref) => {
      const parts = String(ref).toLowerCase().split('.');
      return classesRun.has(parts.slice(0, -1).join('.'));
    },
  };
}

// For one test script's ✅ criteria, classify each against the CI results:
//   failed      — a named test went RED (unambiguous; gates for any intent).
//   verified    — every named test ran GREEN.
//   missing     — a named test is absent BUT its class ran (the method doesn't
//                 exist → a real proof gap; only this absence may gate, and only
//                 under --tests-complete for a Delivered intent).
//   unconfirmed — absent because its class never ran (delta run), OR the ✅ named
//                 no `Class.method` at all (e.g. a SOQL/config-proven criterion).
//                 NEVER gated — that's the false-failure trap we must not fall into.
//   skipped     — a named test is in the run but was SKIPPED: it exists, proves
//                 nothing. Treated like missing (gates only under --tests-complete
//                 for a Delivered intent), with its own label.
// A criterion mixing states resolves worst-first: failed > missing > skipped > unconfirmed > verified.
function evalAutoResults(script, results, testsComplete = false) {
  const out = {
    verified: 0, failed: 0, missing: 0, skipped: 0, unconfirmed: 0,
    failedIds: [], missingIds: [], skippedIds: [], unconfirmedIds: [],
  };
  for (const crit of script.autoCriteria || []) {
    // A ✅ that named no backticked Class.method (SOQL/config assertion, or a manual
    // co-proof) can't be CI-confirmed and must never be treated as "missing".
    if (!crit.tests.length) { out.unconfirmed++; out.unconfirmedIds.push(crit.id); continue; }
    let anyFail = false, anyMissing = false, anySkip = false, anyAbsent = false;
    for (const ref of crit.tests) {
      const status = results.lookup(ref);
      if (status === 'fail') anyFail = true;
      else if (status === 'skip') anySkip = true;
      // A run declared complete that yielded ZERO results can't have run this test:
      // missing, not "not in this delta" (which would never gate).
      else if (status == null) ((results.classRan(ref) || (testsComplete && results.count === 0)) ? (anyMissing = true) : (anyAbsent = true));
    }
    if (anyFail) { out.failed++; out.failedIds.push(crit.id); }
    else if (anyMissing) { out.missing++; out.missingIds.push(crit.id); }
    else if (anySkip) { out.skipped++; out.skippedIds.push(crit.id); }
    else if (anyAbsent) { out.unconfirmed++; out.unconfirmedIds.push(crit.id); }
    else out.verified++;
  }
  return out;
}

// The per-intent coverage ladder — the single source of truth for "what state is
// this intent's proof in?", shared by `coverage` and `preflight` so the two can
// never diverge. Pure: takes the intent + the loaded scripts/ledger/hashes (and
// optional CI results), returns { state, detail, delivered, gateFail }. Worst-first.
function coverageRowFor(i, ctx) {
  const { scripts, ledger, current, results, testsComplete } = ctx;
  const id = i.id.toUpperCase();
  const s = scripts[id];
  const ledgerStatus = (ledger[id] || {}).status || '';
  // stampStatus, not a substring scan: this decides whether the coverage GATE
  // fails the PR, and a scan grades "⬜ Not started (delivered under INT-004)" as
  // Delivered — failing CI for a row that was never stamped.
  const stamped = stampStatus(ledgerStatus);
  const delivered = stamped === STATUS.delivered;
  const retired = stamped === STATUS.retired;
  // An unreadable cell must not let this gate FAIL OPEN: grading a cell we can't
  // read as "not delivered" would pass an unproven delivered intent, the one
  // thing this gate exists to stop. Keyed on the ROW EXISTING, not on the cell
  // being non-empty — an intent with no ledger row at all is a different fact
  // (handled by the ladder below), while a row whose Status cell is blank or
  // unlocatable is precisely an unreadable status. Conflating the two is how the
  // blank cell a bad merge leaves behind slips through.
  const statusUnreadable = !!ledger[id] && stamped === null;

  // A retired intent was pulled from delivery — its scope isn't being verified, so
  // it demands no test script and never fails the gate. Short-circuit before the
  // ladder so it reads as excluded, not as an unproven "⛔ no test script" (#139).
  if (retired) {
    return { id, phase: i.phase, state: '🚫 retired', detail: 'de-scoped — excluded from the proof gate', delivered: false, gateFail: false, statusUnreadable: false, unresolvedDefects: 0, resolvedGaps: [] };
  }

  let state, detail, gateFail = false;
  // A table that parsed to ZERO criteria is caught here rather than falling through
  // the whole ladder to "✅ current & complete" on a count of 0/0. Nothing below has
  // a floor on the total, so any change that makes rows unreadable — a renamed
  // column, an id shape the reader misses — would otherwise read as fully proven.
  if (!s || !s.hasTable || s.markers.total === 0) {
    state = '⛔ no test script';
    detail = s ? 'file present but no criteria parsed from its table' : '—';
    gateFail = delivered;
  } else if (!s.proofHash && !s.scopeHash) {
    state = '⚠️ unstamped';
    detail = `no proof_hash — run: node launchpad/scripts/intent-ledger.mjs hash ${id} --proof`;
    gateFail = delivered;
  } else if (s.proofHash ? s.proofHash !== proofHash(i)
    : (s.scopeHash !== current[id] && s.scopeHash !== legacyScopeHash(i))) {
    // proof_hash (current rule) covers the success criteria too, so an SC-x edit
    // lands here; a legacy scope_hash stamp is judged by the rule it was written
    // under (scope fields only) and asked to re-stamp further down.
    state = '🔄 drifted';
    detail = s.proofHash
      ? `stamped ${s.proofHash} → now ${proofHash(i)} — the intent's scope or success criteria changed; re-verify the proof plan`
      : `stamped ${s.scopeHash} → now ${current[id]} — re-verify against new intent text`;
    gateFail = delivered;
  } else if (s.markers.orgRefuted > 0) {
    // The build org contradicted a structural ✅ (/ql-verify-build recorded it).
    state = '⛔ org refutes';
    detail = `${s.markers.orgRefuted} org-probe ✅ criterion(s) refuted by the build org: ${s.orgRefutedIds.join(', ')} — ` +
      'fix the build and re-run /ql-verify-build, or downgrade the criterion honestly (⚠️/⛔)';
    gateFail = delivered;
  } else if (s.markers.manualFailed > 0) {
    // A human ran it and it failed. Not "incomplete" — the opposite of proven.
    state = '⛔ manual failed';
    detail = `${s.markers.manualFailed} 👁 criterion(s) signed \`fail\`: ${s.manualFailedIds.join(', ')} — ` +
      'fix (/ql-diagnose) and re-run /ql-record-test-execution, or record a 📋 accepted gap';
    gateFail = delivered;
  } else if (s.markers.none > 0 || s.markers.blocked > 0 || s.markers.partial > 0 || s.markers.retest > 0 || s.markers.acceptedGapBare > 0 || s.markers.deferredUnrouted > 0 || s.markers.manualNotProven > 0) {
    state = '⚠️ incomplete';
    const bits = [];
    if (s.markers.none) bits.push(`${s.markers.none} criterion(s) with no proof marker`);
    if (s.markers.blocked) bits.push(`${s.markers.blocked} ⛔ blocked`);
    if (s.markers.partial) bits.push(`${s.markers.partial} ⚠️ partial`);
    if (s.markers.retest) bits.push(`${s.markers.retest} 🔁 awaiting retest`);
    if (s.markers.acceptedGapBare) bits.push(`${s.markers.acceptedGapBare} 📋 accepted gap missing its named accepter + pointer`);
    if (s.markers.manualNotProven) bits.push(`${s.markers.manualNotProven} 👁 signed with a not-proven verdict (${s.manualNotProvenIds.join(', ')} — not run / blocked / skipped)`);
    if (s.markers.deferredUnrouted) bits.push(`${s.markers.deferredUnrouted} 👁 deferral not yet routed (${s.deferredUnroutedIds.join(', ')} — add the decision/BACKLOG.md/INT pointer to its Sign-off cell)`);
    detail = bits.join(', ');
    gateFail = delivered;
  } else if (results) {
    // Structurally complete & current — now confirm the ✅ proofs against CI.
    // Worst-first: a RED test (always gates) > a method MISSING from a class that
    // ran (gates only under --tests-complete, for Delivered) > a test simply not
    // in this run / a non-Apex proof (never gates) > manual-pending > proven.
    const ev = evalAutoResults(s, results, testsComplete);
    const m = s.markers;
    if (ev.failed > 0) {
      state = '⛔ proof failed';
      detail = `${ev.failed} ✅ criterion(s) with a RED test in CI: ${ev.failedIds.join(', ')}`;
      gateFail = true; // a red proof is a failure for ANY intent, not just delivered
    } else if (testsComplete && (ev.missing > 0 || ev.skipped > 0)) {
      state = '⛔ proof missing';
      const bits = [];
      if (ev.missing) bits.push(results.count === 0
        ? `${ev.missing} ✅ criterion(s) whose named test didn't run — 0 results parsed from a run declared complete: ${ev.missingIds.join(', ')}`
        : `${ev.missing} ✅ criterion(s) whose named test's class ran but the method is absent — the test doesn't exist: ${ev.missingIds.join(', ')}`);
      if (ev.skipped) bits.push(`${ev.skipped} ✅ criterion(s) whose named test was skipped — it ran nothing: ${ev.skippedIds.join(', ')}`);
      detail = bits.join('; ');
      gateFail = delivered;
    } else if (ev.missing > 0 || ev.skipped > 0 || ev.unconfirmed > 0) {
      // Not gated: either a delta run that didn't run these classes, or a ✅ proven
      // by a SOQL/config assertion that names no Apex method. Surface, never fail.
      const notRun = ev.missing + ev.skipped + ev.unconfirmed;
      const ids = [...ev.missingIds, ...ev.skippedIds.map((x) => `${x} (skipped)`), ...ev.unconfirmedIds];
      state = '⚠️ proof unconfirmed';
      detail = `${ev.verified}/${m.auto} ✅ confirmed green; ${notRun} not confirmed in this run (${ids.join(', ')})`;
      gateFail = false;
    } else if (s.manualPending > 0) {
      state = '👁 manual pending';
      detail = `${m.auto} ✅ confirmed green; ${s.manualPending} manual criterion(s) awaiting human sign-off`;
      gateFail = false;
    } else {
      state = '✅ proven (CI-confirmed)';
      const parts = [`${ev.verified} ✅ green in CI`];
      if (m.manual) parts.push(`${m.manual} 👁 manual, signed`);
      if (m.acceptedGap) parts.push(`${m.acceptedGap} 📋 accepted gap`);
      detail = `${m.total}/${m.total} (${parts.join(' · ')})`;
    }
  } else if (s.manualPending > 0) {
    state = '👁 manual pending';
    detail = `${s.manualPending} manual criterion(s) awaiting human sign-off`;
    gateFail = false;
  } else {
    state = '✅ current & complete';
    const m = s.markers;
    const parts = [`${m.auto} ✅ auto`];
    if (m.manual) parts.push(`${m.manual} 👁 manual, signed`);
    if (m.acceptedGap) parts.push(`${m.acceptedGap} 📋 accepted gap`);
    detail = `${m.total}/${m.total} (${parts.join(' · ')})`;
  }
  // A test-script stamp from the pre-continuation list parser over unchanged
  // scope: not drift, but ask for a re-stamp so the transitional allowance can go.
  // A legacy `scope_hash:` stamp (pre-#108: scope fields only, and possibly the
  // pre-continuation list reading) over unchanged scope passes, but can't see a
  // success-criteria edit — ask for a proof_hash re-stamp. Transitional.
  if (s && !s.proofHash && s.scopeHash && s.hasTable && s.markers.total > 0 &&
      (s.scopeHash === current[id] || s.scopeHash === legacyScopeHash(i))) {
    detail = `${detail && detail !== '—' ? detail + ' · ' : ''}⚠ legacy scope_hash stamp (doesn't cover success ` +
      `criteria) — re-stamp as proof_hash: ${proofHash(i)}`;
  }
  // Org-probe ✅ criteria never confirmed against an org: honest degradation when
  // no org is reachable (decisions/0031) — surfaced, never gated or held.
  if (s && s.markers && s.markers.orgUnverified > 0) {
    detail = `${detail && detail !== '—' ? detail + ' · ' : ''}⚠ ${s.markers.orgUnverified} org-probe ✅ criterion(s) not verified against an org (/ql-verify-build)`;
  }
  // Unresolved defects are surfaced (never swallowed) but don't change the gate —
  // the criterion markers are the gate; an open defect against a criterion that's
  // still marked ✅/👁 is the honest contradiction this makes visible (issue #93).
  const def = (ctx.defects || {})[id];
  if (def && def.unresolved > 0) {
    detail = `${detail && detail !== '—' ? detail + ' · ' : ''}⚠ ${def.unresolved} unresolved defect(s)`;
  }
  // Additive, like the defect note above, and deliberately NOT its own branch in
  // the ladder: as a branch it REPLACED the proof diagnosis, so "no test script"
  // became "status unreadable" — and since preflight's hold test reads the state
  // string, an unreadable cell turned a ⛔ hold into "✅ Ready to deliver". A note
  // that adds a fact must not erase the one it's annotating.
  if (statusUnreadable) {
    gateFail = true;
    detail = `${detail && detail !== '—' ? detail + ' · ' : ''}⚠ ledger Status ` +
      `"${ledgerStatus.trim() || '(blank)'}" does not begin with a marker — run \`validate\``;
  }
  // A 📋 accepted gap is a write-once record — the accepter's call, not something
  // this script silently reopens. But nothing else ever re-checks whether the
  // REASON it was deferred (the pointer target hadn't shipped) has since gone
  // away, so surface it: any well-formed accepted gap whose pointer names an
  // INT-NNN that the ledger now shows ✅ Delivered is "ready to revisit." Never
  // gates — this is a nudge to a human, not a new obligation the gate enforces.
  const isDelivered = (xid) => stampStatus((ledger[xid] || {}).status || '') === STATUS.delivered;
  const resolvedGaps = (s && s.acceptedGaps ? s.acceptedGaps : [])
    .flatMap((g) => g.pointerIntents.filter(isDelivered).map((ptr) => `${g.id}→${ptr}`));
  if (resolvedGaps.length) {
    detail = `${detail && detail !== '—' ? detail + ' · ' : ''}⚠ ${resolvedGaps.length} accepted gap(s) ready to revisit (pointer now Delivered): ${resolvedGaps.join(', ')}`;
  }
  return {
    id, phase: i.phase, state, detail, delivered, gateFail, statusUnreadable,
    unresolvedDefects: def ? def.unresolved : 0, resolvedGaps,
  };
}

// Load every test script once, keyed by intent id; report any intent with two.
function loadTestScripts() {
  const scripts = {};
  const dupes = [];
  for (const path of findTestScripts()) {
    const s = parseTestScript(path);
    if (!s.intent) continue;
    if (scripts[s.intent]) dupes.push(s.intent);
    scripts[s.intent] = s;
  }
  return { scripts, dupes };
}

function cmdCoverage(filterId, gate, opts = {}) {
  if (preIngestNotice()) process.exit(0);
  const intents = loadIntents();
  const wanted = filterId ? filterId.toUpperCase() : null;
  const current = Object.fromEntries(intents.map((i) => [i.id.toUpperCase(), scopeHash(i)]));
  // A ledger this can't read yields NO rows, which this gate would otherwise read
  // as "nothing is delivered" and pass — so bolding or renaming the Status header,
  // or deleting the file outright, silently disarmed it. `drift`, `sync` and
  // `regression` all already refuse; so must the gate, which runs WITHOUT any of
  // them beside it in two other workflows.
  const parsedLedger = parseLedger({ soft: true });
  // No ledger at all was the last severity inversion: the maximal input produced no
  // output and a green gate, while merely emptying the same file exited 2. It refuses
  // in GATE mode only — a repo mid-scaffold has intents before it has a generated
  // ledger, and the advisory read-out is not the place to fail that. The gate can't
  // afford the benefit of the doubt; the report can.
  if (!parsedLedger.ledgerExists && intents.length) {
    console.error(`${LEDGER} does not exist, but ${intents.length} intent(s) do — no delivery status`);
    console.error('can be read, so nothing here can be graded. Restore it from git history, or');
    console.error('re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ' + LEDGER);
    if (gate) process.exit(2);
    process.exit(0);
  }
  if (parsedLedger.ledgerExists && !parsedLedger.headerFound) {
    console.error(`Could not find Intent/Status/Scope-hash columns in ${LEDGER}, so no delivery`);
    console.error('status can be read and this gate would pass everything. Fix the header row');
    console.error('(plain `Intent` / `Status` / `Scope hash` cells — no bold, no renaming), then re-run.');
    process.exit(2);
  }
  // An id with two rows has no single delivery status: the later row wins silently,
  // so a stamp on the earlier one is invisible here. `validate` names duplicates,
  // but this gate also runs without it in feature-ci_pr-validation.yml and
  // sf-validate.yml, and an ambiguous table must not be graded as a clean one.
  if (parsedLedger.dupes.length) {
    console.error(`${LEDGER} has more than one row for ${parsedLedger.dupes.join(', ')}, so no single`);
    console.error('delivery status can be read — the last row silently wins and a stamp on an earlier');
    console.error('row is lost. Remove the duplicate row(s), then re-run. (`validate` names them.)');
    process.exit(2);
  }
  const ledger = parsedLedger.byId;

  // Optional CI test-results: when provided, a ✅ criterion's named test is
  // CONFIRMED green (not just asserted by the author). `testsComplete` says the
  // run was exhaustive (a full RunLocalTests, not a delta), so a ✅ whose test is
  // ABSENT means the test doesn't exist → a gate failure for delivered intents.
  // Without it, an absent test is just "not in this (delta) run" → warned.
  const results = opts.resultsFile ? parseTestResults(opts.resultsFile) : null;
  const testsComplete = !!opts.testsComplete;

  const { scripts, dupes } = loadTestScripts();

  const ctx = { scripts, ledger, current, results, testsComplete, defects: scanDefects() };
  const rows = [];
  for (const i of intents) {
    const id = i.id.toUpperCase();
    if (wanted && id !== wanted) continue;
    rows.push(coverageRowFor(i, ctx));
  }

  if (wanted && rows.length === 0) {
    console.error(`No intent matched "${filterId}".`);
    process.exit(1);
  }

  if (results) {
    console.log(results.count
      ? `Cross-checking ✅ criteria against ${results.count} test result(s) from ${opts.resultsFile}` +
        (testsComplete ? ' (run treated as complete — absent ✅ tests fail).' : ' (delta run — absent ✅ tests warned, not failed).')
      : `⚠️  No test results parsed from ${opts.resultsFile} — ✅ criteria can't be CI-confirmed. ` +
        (results.parseError ? `It isn't valid JSON (${results.parseError}).` : 'Check the file format (sf --json or JUnit XML) and that the run reached the tests.') +
        (testsComplete ? ' The run was declared complete, so every named ✅ test counts as missing.' : ''));
  }

  const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b);
  for (const phase of phases) {
    console.log(`Phase ${phase}`);
    for (const r of rows.filter((x) => x.phase === phase)) {
      const flag = r.delivered ? ' (Delivered)' : '';
      console.log(`  ${r.id}${flag}\t${r.state}\t${r.detail}`);
    }
  }
  if (dupes.length) {
    console.log(`\n⚠️  More than one test script found for: ${[...new Set(dupes)].join(', ')} — keep one per intent.`);
  }

  const gateFailures = rows.filter((r) => r.gateFail);
  // A row that also failed on an unreadable status is NOT "surfaced, not gated" —
  // printing it in both lists tells the reader it's fine and that it blocked.
  const pendingWarn = rows.filter((r) => !r.statusUnreadable && /manual pending|proof unconfirmed/.test(r.state));
  if (pendingWarn.length) {
    console.log(`\nℹ️  ${pendingWarn.length} intent(s) complete but awaiting manual sign-off or CI confirmation ` +
      `(${pendingWarn.map((r) => r.id).join(', ')}) — surfaced, not gated.`);
  }
  const readyToRevisit = rows.filter((r) => (r.resolvedGaps || []).length > 0);
  if (readyToRevisit.length) {
    const all = readyToRevisit.flatMap((r) => r.resolvedGaps);
    console.log(`\nℹ️  ${all.length} accepted gap(s) across ${readyToRevisit.length} intent(s) have a pointer target ` +
      `that's since delivered — worth revisiting (${all.join(', ')}); not gated.`);
  }
  if (gate) {
    if (gateFailures.length) {
      console.log(`\n⛔ Coverage gate FAILED — ${gateFailures.length} intent(s) not proven:`);
      for (const r of gateFailures) console.log(`   ${r.id}  ${r.state} — ${r.detail}`);
      console.log('   → Author/refresh the script with /ql-test-script, fix the red test, or reconcile drift.');
      process.exit(1);
    }
    // Only claim CI confirmation when this run actually confirmed a ✅ green.
    const confirmed = results && rows.some((r) => /CI-confirmed/.test(r.state));
    console.log('\n✅ Coverage gate passed — every Delivered intent has a current, complete' +
      (confirmed ? ', CI-confirmed' : '') + ' test script.' +
      (results && !confirmed ? ' (No ✅ criterion was confirmed green by this run.)' : ''));
  }
  process.exit(0);
}

// ── preflight ────────────────────────────────────────────────────────────────
// The close-out convenience: run the readiness checks locally, BEFORE you stamp
// ✅ Delivered, that CI would otherwise run only after the PR opens — so an
// unproven ✅ or a drifted stamp is caught in one call instead of a round-trip.
// A per-intent readout over the SAME coverage ladder `coverage` uses plus a drift
// check; ADVISORY by design — it ALWAYS exits 0 and never gates (CI stays the
// backstop, decisions/0014). It informs the human standing at close-out; it does
// not stop them. `deliver` remains the only writer of the ledger.
function cmdPreflight(filterId) {
  if (preIngestNotice()) process.exit(0);
  if (!filterId || !/^INT-\d+/i.test(filterId)) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs preflight INT-xxx');
    process.exit(2);
  }
  const wanted = filterId.toUpperCase();
  const intents = loadIntents();
  const intent = intents.find((i) => i.id.toUpperCase() === wanted);
  if (!intent) {
    console.error(`${wanted} is not a known intent (no intents/${wanted.toLowerCase()}/intent.md).`);
    process.exit(1);
  }

  const current = Object.fromEntries(intents.map((i) => [i.id.toUpperCase(), scopeHash(i)]));
  const ledger = parseLedger({ soft: true }).byId;
  const { scripts } = loadTestScripts();
  const row = coverageRowFor(intent, { scripts, ledger, current, results: null, testsComplete: false, defects: scanDefects() });

  console.log(`Preflight — ${wanted}  ${intent.title || ''}`.trimEnd());

  // The ledger row's own state (drift after a prior delivery is its signal, not
  // the script's): surface it so a 🔄 Needs re-verify row is obvious pre-stamp.
  const ledgerStatus = (ledger[wanted] || {}).status || '';
  if (stampStatus(ledgerStatus) === STATUS.drift) {
    console.log('  ⚠️  ledger row is 🔄 Needs re-verify — scope moved after a prior delivery; re-verify before re-stamping.');
  }

  const s = scripts[wanted];
  const manualPending = s && s.hasTable ? (s.manualPending || 0) : 0;

  // "Ready" = the script is current, complete, and structurally sound — i.e. the
  // coverage ladder didn't land on a ⛔/🔄/⚠️ state. Manual-pending is NOT a
  // blocker (the agent can't sign; UAT trails a merge) — surfaced, never a hold.
  const unresolvedDefects = row.unresolvedDefects || 0;
  // An unreadable ledger status holds too: you cannot decide it's safe to stamp
  // ✅ Delivered from a row nothing can grade. This is checked as a flag rather
  // than by matching the state string, so a future state can't quietly opt out.
  const held = /^⛔|^🔄|unstamped|incomplete|proof failed|proof missing/.test(row.state)
    || unresolvedDefects > 0 || !!row.statusUnreadable;

  console.log(`  proof:   ${row.state}${row.detail && row.detail !== '—' ? ` — ${row.detail}` : ''}`);
  if (manualPending > 0) {
    console.log(`  manual:  👁 ${manualPending} criterion(s) awaiting human sign-off (not a blocker — sign with /ql-record-test-execution)`);
  }
  if (unresolvedDefects > 0) {
    console.log(`  defects: ⚠ ${unresolvedDefects} unresolved defect(s) in test-evidence/ — resolve, verify, or consciously defer (📋) before stamping.`);
  }

  const withPath = loadIntentsWithPath().find(({ intent: i }) => i.id.toUpperCase() === wanted);
  if (withPath) {
    const b = decisionBrief(intent, readFileSync(withPath.path, 'utf8'), loadDecisionContext());
    if (b.pending.length) console.log(`  rulings: ⚠ ${b.pending.length} build-rulings note(s) still pending — close them out in PR §6 (not a hold)`);
    for (const w of citationWarnings(intent, b, stampStatus(ledgerStatus) === STATUS.delivered)) console.log(`  cites:   ⚠ ${w}`);
  }

  if (held) {
    console.log('\n⛔ Hold — not ready to stamp ✅ Delivered yet. Fix the above (author/refresh the script');
    console.log('   with /ql-test-script, prove the ✅ criteria, or reconcile drift), then re-run preflight.');
  } else {
    console.log('\n✅ Ready to deliver — the proof plan is current & complete.');
    if (manualPending > 0) {
      console.log('   (Manual criteria still need sign-off, but that trails the merge — you can stamp now.)');
    }
    console.log(`   When you've filled the PR §2 matrix:  node launchpad/scripts/intent-ledger.mjs deliver ${wanted} --pr <ref>`);
  }
  console.log('\n(Advisory — CI on the PR is the backstop; this never gates.)');
  process.exit(0);
}

// ── verify ───────────────────────────────────────────────────────────────────
// Record an org-probe verification run (decisions/0031). /ql-verify-build gathers
// the structural `## Org assertions` for an intent's `org-probe` ✅ criteria, runs
// them against the BUILD org (the org the build deployed to), and hands the
// structured verdicts here. This writes the durable, commit-pinned evidence file —
// the deterministic script owns the pass/fail RECORD; the skill owns the org query
// and the test-script mark. ADVISORY by construction: exits 0 (bad input → 2); a
// refuted assertion is DATA surfaced for the human at PR, never a gate (CI's
// coverage --gate stays the backstop, decisions/0023). Attested evidence, not a CI
// re-run — CI can't reach the build org.
//
// --results <file>: JSON, an array of criteria OR { target_org?, criteria: [...] }.
//   Each criterion: { id, verdict: "pass"|"refute"|"unresolved",
//     predicates: [ { predicate, expected, actual, verdict } ] }.
function cmdVerify(filterId, resultsFile) {
  if (!filterId || !/^INT-\d+/i.test(filterId)) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs verify INT-xxx --results <probe-results.json>');
    console.error('Schema: { target_org?, criteria: [ { id, verdict: pass|refute|unresolved,');
    console.error('          predicates: [ { predicate, expected, actual, verdict } ] } ] }');
    process.exit(2);
  }
  const wanted = normId(filterId);
  // Intent dirs are created UPPERCASE (normId) by from-json/new — do NOT lowercase
  // here or the existence check fails on a case-sensitive filesystem (Linux/CI).
  const dir = `${INTENTS_DIR}/${wanted}`;
  if (!existsSync(`${dir}/intent.md`)) {
    console.error(`${wanted} is not a known intent (no ${dir}/intent.md).`);
    process.exit(1);
  }
  if (!resultsFile) {
    console.error('verify needs --results <probe-results.json> — the org-probe verdicts from /ql-verify-build.');
    console.error('Schema: { target_org?, criteria: [ { id, verdict: pass|refute|unresolved,');
    console.error('          predicates: [ { predicate, expected, actual, verdict } ] } ] }');
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resultsFile, 'utf8'));
  } catch (e) {
    console.error(`Could not read/parse --results file ${resultsFile}: ${e.message}`);
    process.exit(2);
  }
  // Bad-input degrades to exit 2 (the promised contract), never an uncaught crash:
  // JSON.parse can yield null / a scalar / an array-shaped `criteria`.
  if (!parsed || typeof parsed !== 'object') {
    console.error('--results must be a JSON object { target_org, criteria: [...] } or an array of criteria.');
    process.exit(2);
  }
  const rawCriteria = Array.isArray(parsed) ? parsed : parsed.criteria;
  if (!Array.isArray(rawCriteria)) {
    console.error('--results: `criteria` must be an array.');
    process.exit(2);
  }
  const criteria = rawCriteria.filter((c) => c && typeof c === 'object' && !Array.isArray(c));
  if (!criteria.length) {
    console.error('No well-formed criteria objects in the results file — nothing to record.');
    process.exit(2);
  }
  const targetOrg = (Array.isArray(parsed) ? '' : (parsed.target_org || '')) || '(unspecified)';

  const norm = (v) => String(v || '').toLowerCase();
  const glyph = (v) => (norm(v) === 'pass' ? '✅' : norm(v) === 'refute' ? '❌' : '⚠');
  const cell = (v) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|'); // one row, never break the table
  // The RECORD owns the verdict: derive each criterion's from its OWN predicates so
  // a contradictory envelope (criterion "pass" over a refuting predicate) can't
  // produce false-confirmed evidence. Any predicate refutes → refute; else any
  // non-pass → unresolved; else pass. Fall back to the stated verdict only when no
  // predicates were supplied (a criterion the skill couldn't decompose).
  const predsOf = (c) => (Array.isArray(c.predicates) ? c.predicates.filter((p) => p && typeof p === 'object') : []);
  const criterionVerdict = (c) => {
    const preds = predsOf(c);
    if (!preds.length) return norm(c.verdict) || 'unresolved';
    if (preds.some((p) => norm(p.verdict) === 'refute')) return 'refute';
    if (preds.some((p) => norm(p.verdict) !== 'pass')) return 'unresolved';
    return 'pass';
  };
  let confirmed = 0, refuted = 0, unresolved = 0;
  for (const c of criteria) {
    c._verdict = criterionVerdict(c);
    if (c._verdict === 'pass') confirmed++; else if (c._verdict === 'refute') refuted++; else unresolved++;
  }

  // commit / branch — best-effort; evidence is still valid without git. Flag a
  // DIRTY worktree so the pin can't claim a clean commit while uncommitted
  // metadata is what was actually deployed/tested (honest attestation).
  let commit = git(['rev-parse', '--short', 'HEAD']).out || 'nocommit';
  if (commit !== 'nocommit' && git(['status', '--porcelain']).out) commit += '-dirty';
  const ref = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const branch = ref && ref !== 'HEAD' ? ref : '(detached)'; // rev-parse prints "HEAD" when detached
  const date = new Date().toISOString().slice(0, 10);

  const evDir = `${dir}/test-evidence`;
  mkdirSync(evDir, { recursive: true });
  let path = `${evDir}/${date}-${commit}-org-probe.md`;
  let n = 2;
  while (existsSync(path)) { path = `${evDir}/${date}-${commit}-org-probe-${n}.md`; n++; }

  const lines = [
    '---',
    `intent: ${wanted}`,
    'verified_by: ql-verify-build',
    `verified_at: ${date}`,
    `target_org: ${targetOrg}`,
    `branch: ${branch}`,
    `commit: ${commit}`,
    'type: org-probe',
    '---',
    '',
    `# ${wanted} — Org-probe verification`,
    '',
    `**Target org:** ${targetOrg} · **Commit:** ${commit} · **Branch:** ${branch}`,
    '',
    `**Summary:** ${confirmed} confirmed · ${refuted} refuted · ${unresolved} unresolved (of ${criteria.length} criteria)`,
    '',
    '## Results',
  ];
  for (const c of criteria) {
    lines.push('', `### ${c.id || '(unnamed criterion)'} — ${glyph(c._verdict)} ${c._verdict}`);
    const preds = predsOf(c);
    if (preds.length) {
      lines.push('', '| Predicate | Expected | Org actual | Verdict |', '|-----------|----------|-----------|---------|');
      for (const p of preds) {
        lines.push(`| ${cell(p.predicate)} | ${cell(p.expected)} | ${cell(p.actual)} | ${glyph(p.verdict)} |`);
      }
    }
  }
  lines.push('');
  writeFileSync(path, lines.join('\n'));

  console.log(`Org-probe verification recorded — ${wanted}`);
  console.log(`  ${confirmed} confirmed · ${refuted} refuted · ${unresolved} unresolved  (org: ${targetOrg}, commit: ${commit})`);
  console.log(`  evidence: ${path}`);
  if (refuted > 0) {
    console.log('  ❌ The org refutes some assertions — you cannot publish those ✅. Fix the build and re-run,');
    console.log('     or downgrade the criterion honestly (⚠️/⛔) via /ql-refine-intent.');
  }
  if (unresolved > 0) {
    console.log('  ⚠  Some assertions were unresolved/unreachable — recorded as ⚠ not verified (surfaced, not swallowed).');
  }
  console.log('\n(Advisory — attested evidence reviewed at PR; CI\'s coverage --gate stays the backstop.)');
  process.exit(0);
}

// ── conformance ──────────────────────────────────────────────────────────────
// The traceability REPORT a regulated program needs. Two halves, both report-
// never-gate (always print, NEVER exit non-zero):
//
//   1. Requirements grounding (issue #49): per intent, what approved requirement
//      / architecture it's grounded in (## Grounding), and which DELIVERED intents
//      carry none to trace back to.
//   2. Architecture-decision conformance (decisions/0009): the AUDIT of DECLARED
//      deviations. Every build-authored ADR whose Supersedes: points at a
//      scopezilla-inherited premise is a declared deviation — pending-ARB is a
//      LOUD open item; accepted-by-ARB is listed QUIETLY as the permanent
//      traceability artifact an auditor wants. This pass does NOT detect a SILENT
//      deviation (a build that strays but authored no ADR) — that's the
//      /ql-design-intent + /ql-vet-intent reflex's job, which converts a silent
//      deviation into a declared one BEFORE it ships. So this report audits that
//      declared deviations got a human ARB signature; it is not the detector.
//
// The "does this build match the approved architecture?" judgment is semantic and
// lives in /ql-design-intent + /ql-vet-intent (a human / ARB ratifies it); the durable
// traceability artifact is this listing. Grounding + architecture ADRs are both
// optional first-class data — there is no "commercial vs ARB" mode to detect. When
// neither is present the report says so. The last-resort enforcement (a red build)
// isn't reliable here anyway — engagement repos may not run GitHub Actions at all
// (see the plugin's own repo-check, which runs from /ship, not CI) — so the honest
// signal is the visible report plus the skill reflex, not an exit code.
const REQ_LABELS = new Set(['requirement']);
const ARCH_LABELS = new Set(['architecture', 'design']);
function groundingSummary(g) {
  if (!g) return { grounded: false, hasReq: false, hasArch: false, labels: [], carried: [] };
  const entries = g.entries || [];
  const labels = entries.map((e) => (e.label || '').toLowerCase());
  return {
    grounded: entries.length > 0,
    // The engine writes these labels itself (ARTIFACT_TYPE_LABELS, GROUNDING_LABELS),
    // so they're matched exactly rather than guessed at by keyword.
    hasReq: labels.some((l) => REQ_LABELS.has(l)),
    hasArch: labels.some((l) => ARCH_LABELS.has(l)),
    labels: entries.map((e) => e.label).filter(Boolean),
    carried: (g.carried || []).map((c) => c.key),
  };
}

// ── architecture ADRs (decisions/0009) ───────────────────────────────────────
// Parse the header line of an architecture ADR. The shape SZ emits (and that
// build-authored ADRs reuse) is a single ` · `-separated line of **Key:** value
// pairs right under the `# NNNN — title` heading:
//   **Date:** 2026-07-20 · **Status:** accepted · **Source:** scopezilla-inherited
//   · **Supersedes:** 0004 · **Deviation:** pending-ARB
// We read by MEANING, tolerantly: keys are matched case-insensitively, Status is
// free-form (`accepted` | `superseded-by-NNNN`), and only the fields we need are
// extracted — anything else on the line is ignored, never an error. This mirrors
// SZ decisions/0028's "prose the consumer reads by meaning, no JSON side-file".
function parseAdr(text, file) {
  const lines = text.split(/\r?\n/);
  const titleIdx = lines.findIndex((l) => /^#\s+[A-Za-z]*-?\d+/.test(l));
  const idMatch = titleIdx !== -1 ? (lines[titleIdx].match(/^#\s+([A-Za-z]*-?\d+)\b/) || [])[1] || '' : '';
  const id = idMatch.toUpperCase();
  const title = titleIdx !== -1 ? (lines[titleIdx].match(/^#\s+[A-Za-z]*-?\d+\s*[—-]\s*(.+?)\s*$/) || [])[1] || '' : '';

  const field = headerFieldReader(lines, titleIdx);
  const source = field('Source').toLowerCase();
  const status = field('Status').toLowerCase();
  // Supersedes may name one or more ADR ids, separated by the header's ` · `, a
  // comma, or a continuation line — all preserved by headerFieldReader's whole-value capture,
  // then tokenized here.
  const supersedes = (field('Supersedes').match(/[A-Za-z]*-?\d+/g) || []).map((s) => s.toUpperCase());
  const deviation = field('Deviation').toLowerCase();
  return {
    id, title, source, status, supersedes, deviation, file,
    date: (field('Date').match(/\d{4}-\d{2}-\d{2}/) || [''])[0],
    intents: field('Intents') ? intentIdsIn(field('Intents')) : intentIdsIn(text),
    core: coreParagraph(text),
  };
}

// The metadata block of a decision record: the contiguous run of non-blank,
// non-heading lines right after the `# ` title — one line, or wrapped across a
// couple — joined so a value that spans the header's own ` · ` separator (multiple
// Supersedes ids) or wraps is captured whole. Stopping at the first heading keeps a
// "Status:" mentioned in prose from being read. Returns a field reader. Shared by
// architecture ADRs (parseAdr) and dated notes (parseDecisionNote).
function headerFieldReader(lines, titleIdx) {
  const metaLines = [];
  for (let i = titleIdx + 1; titleIdx !== -1 && i < lines.length; i++) {
    if (/^\s*#/.test(lines[i])) break;                 // next heading → header ends
    if (/^\s*$/.test(lines[i])) { if (metaLines.length) break; else continue; }
    metaLines.push(lines[i]);
  }
  const head = metaLines.join(' ');
  // Capture each `**Key:**` value up to the NEXT `**Key:**` (or end of the block) —
  // NOT to the first ` · `, which is the separator BETWEEN key/value pairs AND
  // between multiple ids in one value. Trailing separators/space are stripped.
  return (name) => {
    const m = head.match(new RegExp(`\\*\\*${name}\\s*:\\*\\*\\s*(.*?)\\s*(?=\\*\\*[A-Za-z]|$)`, 'i'));
    return m ? m[1].replace(/[·\s]+$/, '').trim() : '';
  };
}

// First paragraph under `## Choice` (dated note) or `## Decision` (ADR), quote
// lines skipped, truncated — the "core paragraph" the briefing shows.
function coreParagraph(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let i = lines.findIndex((l) => /^##\s+(choice|decision)\b/i.test(l));
  if (i === -1) return '';
  const para = [];
  for (i += 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    if (/^\s*>/.test(lines[i])) continue;
    if (!lines[i].trim()) { if (para.length) break; continue; }
    para.push(lines[i].trim());
  }
  const t = para.join(' ');
  return t.length > 240 ? `${t.slice(0, 239).trimEnd()}…` : t;
}

function intentIdsIn(text) {
  return [...new Set((String(text).match(/\bINT-\d+\b/gi) || []).map((x) => normId(x)))];
}

// Load architecture ADRs from both authority locations. Inherited ADRs live in
// the read-only scopezilla/ mirror; build-authored ADRs in decisions/architecture/.
// A missing directory is the normal (default-zero) case — most engagements carry
// no architecture ADRs at all — so an absent dir yields an empty list, never an
// error. `origin` records which location a file came from, independent of the
// (self-declared) Source stamp, so a mis-stamped file is still traceable.
function loadArchAdrs() {
  const out = [];
  const readDir = (dir, origin) => {
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true })
        // Accept regular files AND symlinks-to-files (a symlinked ADR must not be
        // silently skipped — silent-skip is the exact anti-pattern this report
        // exists to prevent); exclude only subdirectories, the README, and the
        // shipped TEMPLATE.md skeleton (a copy-me scaffold, not a real ADR — it
        // must never surface in the conformance report).
        .filter((e) => !e.isDirectory() && /\.md$/i.test(e.name) && !/^readme\.md$/i.test(e.name) && !/^template\.md$/i.test(e.name))
        .map((e) => e.name);
    } catch { return; } // ENOENT / not-a-dir → default-zero, nothing to load
    for (const name of names) {
      let text;
      try { text = readFileSync(join(dir, name), 'utf8'); } catch { continue; }
      // An adopted premise (decisions/0082 W3) sits beside build-authored ADRs in
      // launchpad/decisions/architecture/; its Source line, not its folder, says it's inherited.
      const adr = parseAdr(dir === BUILD_ADR_DIR ? forThisEngagement(text) : text, shown(join(dir, name)));
      out.push({ ...adr, origin: adr.source === 'scopezilla-inherited' ? 'inherited' : origin });
    }
  };
  readDir(LEGACY_ADR_DIR, 'inherited');
  readDir(ENGAGEMENT_ADR_DIR, 'build');
  readDir(BUILD_ADR_DIR, 'build');
  return out;
}

// ── decisions: the per-intent briefing (issue #146, decisions/0075) ──────────
// Which decision records bear on an intent, and with what standing. Computed from
// the files on every run; nothing is persisted, so nothing goes stale.
//   binding — every live standing premise, and any record the intent CITES (its
//             path or BLD id appears in intent.md, e.g. #178's guardrail line).
//             A Guardrails citation sits in hashed scope, so drift sees it.
//             A deviation ADR binds only the intents it names (or all, if none).
//   pending — a build-rulings note for this intent whose Deciders still says
//             "pending" (decisions/0066): agent calls awaiting PR §6 review.
//   ratified — a rulings note the Trusted Guide ratified: how-calls the intent and
//             design were silent on, binding until PR §6 routes them home.
//   history — a dated note that only MENTIONS the intent. Its outcome is already in
//             the intent; listed by title so it's findable, never as authority.
// Binding, pending and ratified are never cut; history shares the budget.
// The intent always governs. Advisory: never gates.
const DECISIONS_DIR = 'decisions';
const BRIEF_BUDGET = 5000; // chars, ~1.2k tokens; warnings sit outside it

const decisionStem = (file) => String(file).split('/').pop().replace(/\.md$/i, '');

function parseDecisionNote(text, file) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const titleIdx = lines.findIndex((l) => /^#\s+/.test(l));
  const field = headerFieldReader(lines, titleIdx);
  const stem = decisionStem(file);
  // An unfilled template placeholder (`INT-NNN`) names nobody: fall back to the body scan.
  const declared = field('Intents') && (intentIdsIn(field('Intents')).length || /\bnone\b/i.test(field('Intents'))) ? field('Intents') : '';
  const rulings = /build-rulings$/i.test(stem);
  // A rulings note belongs to the intent in its filename (/ql-start-intent Step 10);
  // its body names other intents in passing ("reuse INT-003's permission set").
  // Deciders is searched in the whole note when the header block misses it, and a
  // note with no readable Deciders counts as pending: unratified until shown otherwise.
  const deciders = field('Deciders') || ((String(text).match(/\*\*Deciders:\*\*\s*([^\n·]*)/i) || [])[1] || '').trim();
  return {
    ref: stem,
    file,
    title: titleIdx === -1 ? stem : lines[titleIdx].replace(/^#\s+/, '').trim(),
    date: (field('Date').match(/\d{4}-\d{2}-\d{2}/) || stem.match(/^\d{4}-\d{2}-\d{2}/) || [''])[0],
    intents: declared ? intentIdsIn(declared) : intentIdsIn(rulings ? stem : `${stem}\n${text}`),
    // Every record ref (a path, an id, a dated stem) carries a digit; prose words in
    // the value ("0004 (we no longer need it)") don't, so they never become keys.
    supersedes: (field('Supersedes').match(/[\w./-]+/g) || [])
      .map((t) => t.replace(/\.+$/, '')).filter((t) => /\d/.test(t)).map((t) => decisionStem(t)),
    ownStatus: field('Status').toLowerCase(),
    rulings,
    pending: rulings && (!deciders || /pending/i.test(deciders)),
    core: coreParagraph(text),
    bullets: rulings ? lines.map((l) => l.match(/^\s*[-*+]\s+(.*)$/)).filter(Boolean).map((m) => m[1].trim()) : [],
  };
}

// decisions/*.md (not architecture/, which loadArchAdrs owns), newest first.
// README.md and the TEMPLATE.md scaffold are not records. Missing dir → [].
// Decisions live in two scopes (decisions/0082 W2): this engagement's decisions/
// and the org's launchpad/decisions/, which every engagement reads. An org record
// can name intents of several engagements, so a slug-qualified id there
// (acme-2026/INT-003) binds only that engagement's intent, and a bare INT-003
// binds in every engagement. A one-engagement repo reads exactly as before.
const ORG_DECISIONS_DIR = join(ORG_DIR, 'decisions');

function forThisEngagement(text) {
  const slug = basename(process.cwd());
  return text.replace(/(?<![\w/-])([a-z0-9][a-z0-9-]*)\/(INT-\d+[a-z]?)\b/gi,
    (_, s, id) => (s.toLowerCase() === slug ? id : ''));
}

function loadDecisionNotes() {
  const out = [];
  for (const dir of [DECISIONS_DIR, ORG_DECISIONS_DIR]) {
    let names;
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.isDirectory() && /\.md$/i.test(e.name) && !/^(readme|template)\.md$/i.test(e.name))
        .map((e) => e.name);
    } catch { continue; }
    for (const name of names) {
      try {
        const text = readFileSync(join(dir, name), 'utf8');
        out.push(parseDecisionNote(dir === ORG_DECISIONS_DIR ? forThisEngagement(text) : text, shown(join(dir, name))));
      } catch { /* unreadable: skip */ }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.file.localeCompare(b.file));
}

const decisionRefs = (d) => [d.ref, d.id, decisionStem(d.file)].filter(Boolean).map((s) => s.toUpperCase());

// Records an intent's raw text cites: a decisions/… or scopezilla/decisions/… path
// (with or without .md, tolerating a sentence-ending period, relative `../` links
// included), or a BLD-NNNN id. Not citations: a URL (it points at another repo's
// records), a bare folder mention (`decisions/architecture/`), README/TEMPLATE, and
// a BLD id already cited by its path. UPPER ref → the form as written (for messages).
function citedDecisionRefs(raw) {
  const refs = new Map();
  const text = String(raw).replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, ' ');
  for (const m of text.matchAll(/(?<![\w-])(?:scopezilla\/)?decisions\/(?:architecture\/)?([\w.-]+)(?![\w.-]*\/)/gi)) {
    const ref = m[1].replace(/\.+$/, '').replace(/\.md$/i, '');
    if (ref && !/^(readme|template|architecture)$/i.test(ref)) refs.set(ref.toUpperCase(), m[0].replace(/\.+$/, ''));
  }
  for (const m of text.matchAll(/\bBLD-\d+\b/gi)) {
    const id = m[0].toUpperCase();
    if (![...refs.keys()].some((k) => k === id || k.startsWith(`${id}-`))) refs.set(id, m[0]);
  }
  return refs;
}

function loadDecisionContext() {
  const notes = loadDecisionNotes();
  const adrs = loadArchAdrs();
  const S = (x) => String(x).toUpperCase();
  const premiseRefs = new Set(adrs.flatMap(decisionRefs));
  const byRef = new Map([...notes, ...adrs].flatMap((d) => decisionRefs(d).map((r) => [r, d])));
  // A build ADR that supersedes an inherited premise (live or since retired), or
  // revises such a deviation, is scoped like a deviation (decisions/0009): it binds
  // the intents it names, or every intent if it names none, and it never retires
  // the inherited premise (only Scopezilla's own status does). A revision that names
  // no intent inherits the intents of every deviation it revises. Both passes run
  // to a fixpoint, so file order never changes the result.
  const inherited = adrs.filter((d) => d.origin === 'inherited');
  const inheritedRefs = new Set(inherited.flatMap(decisionRefs));
  // Live the way `conformance` reads it (a `superseded-by` status), so the
  // "deviation declared" annotation matches what conformance audits.
  const liveInherited = new Set(inherited.filter((d) => !/superseded-by/i.test(d.status || '')).flatMap(decisionRefs));
  const devRefs = new Set(inheritedRefs);
  const devAdrs = new Set();
  for (let grew = true; grew;) {
    grew = false;
    for (const d of adrs) {
      if (d.origin !== 'build' || devAdrs.has(d) || !d.supersedes.some((x) => devRefs.has(S(x)))) continue;
      devAdrs.add(d);
      for (const r of decisionRefs(d)) devRefs.add(r);
      grew = true;
    }
  }
  const namesOwn = new Set([...devAdrs].filter((d) => d.intents.length));
  for (let grew = true; grew;) {
    grew = false;
    for (const d of devAdrs) {
      if (namesOwn.has(d)) continue;
      const from = d.supersedes.map((x) => byRef.get(S(x))).filter((p) => p && devAdrs.has(p)).flatMap((p) => p.intents);
      const next = [...new Set([...d.intents, ...from])];
      if (next.length > d.intents.length) { d.intents = next; grew = true; }
    }
  }
  const isDeviation = (d) => devAdrs.has(d);
  // ref → the record that replaced it. A dated note can't retire a premise (leaving
  // one is a BLD ADR's job). Newest record wins when two name the same ref.
  const replacedBy = new Map();
  const deviations = new Map(); // inherited premise ref → the deviation ADRs that stray from it
  for (const d of [...notes, ...adrs]) {
    for (const x of d.supersedes) {
      const ref = S(x);
      if (isDeviation(d) && inheritedRefs.has(ref)) {
        if (liveInherited.has(ref)) (deviations.get(ref) || deviations.set(ref, []).get(ref)).push(d);
      } else if (d.ref && premiseRefs.has(ref)) continue;
      else if (!replacedBy.has(ref) || String(d.date || '') > String(replacedBy.get(ref).date || '')) replacedBy.set(ref, d);
    }
  }
  // Either encoding: a newer record names it (`Supersedes:`, decisions/0009's
  // one-way edge), or the record says so itself (Scopezilla's `superseded-by-NNNN`).
  // A chain (A → B → C) resolves to the record that's current now. A self-declared
  // replacement (an id, a path, or a markdown link) is resolved against the repo;
  // prose or a ref that isn't here is reported, never pasted into a command.
  const ownSuperseded = (d) => (String(d.ownStatus || d.status || '').match(/superseded[-\s]by[-\s:]*(\S*)/i) || [])[1];
  const currentOf = (d) => {
    let cur = d;
    const seen = new Set([d.file]);
    for (;;) {
      const next = decisionRefs(cur).map((r) => replacedBy.get(r)).find(Boolean);
      if (!next || seen.has(next.file)) return cur === d ? null : cur;
      seen.add(next.file);
      cur = next;
    }
  };
  const replacement = (d) => {
    const last = currentOf(d);
    if (last) return { ref: last.file, concrete: true };
    const own = ownSuperseded(d);
    if (own === undefined) return null;
    const token = ((own.match(/\]\(([^)]+)\)/) || [])[1] || own).replace(/[.,;:)\]]+$/, '');
    if (!/\d/.test(token)) return { ref: '', concrete: false };
    const hit = byRef.get(S(decisionStem(token))) || byRef.get(S(token));
    return hit ? { ref: hit.file, concrete: true } : { ref: `${token} (not in the repo)`, concrete: false };
  };
  const superseded = (d) => replacement(d) !== null;
  // Name the deviation as it stands now: a revised one is labeled by its revision.
  const deviatedBy = (d) => [...new Set(decisionRefs(d).flatMap((r) => deviations.get(r) || [])
    .map((x) => currentOf(x) || x).map((x) => `${x.id || decisionStem(x.file)} (${x.deviation || 'unmarked'})`))];
  const known = new Set(byRef.keys());
  return { notes, adrs, superseded, replacement, deviatedBy, isDeviation, known };
}

// An intent's `## Grounding` points at the approved architecture it conforms to; it
// isn't scope and isn't hashed, so it's not read as a citation (premises bind anyway).
const withoutGrounding = (raw) => String(raw).replace(/\r\n?/g, '\n')
  .replace(/^##\s+grounding\b[^\n]*\n[\s\S]*?(?=^##\s|(?![\s\S]))/gim, '');

function decisionBrief(intent, raw, ctx) {
  const id = intent.id.toUpperCase();
  const cited = citedDecisionRefs(withoutGrounding(raw));
  const isCited = (d) => decisionRefs(d).some((r) => cited.has(r));
  const live = (d) => !ctx.superseded(d);
  const mine = (d) => d.intents.includes(id);
  const pending = ctx.notes.filter((d) => d.pending && mine(d) && live(d));
  return {
    citedNotes: ctx.notes.filter((d) => isCited(d) && live(d) && !pending.includes(d)),
    pending,
    // A deviation ADR binds only the intents it names or that cite it; one that
    // names no intent is shown to all, so its own intent never loses sight of it.
    premises: ctx.adrs.filter((d) => live(d) && (!ctx.isDeviation(d) || !d.intents.length || mine(d) || isCited(d)))
      .map((d) => ({ ...d, cited: isCited(d), deviatedBy: ctx.deviatedBy(d) })),
    // A ratified rulings note holds how-calls the intent and design were silent on,
    // so it isn't history; it binds the build until PR §6 routes it to its home.
    ratified: ctx.notes.filter((d) => d.rulings && !d.pending && mine(d) && live(d) && !isCited(d)),
    history: ctx.notes.filter((d) => !d.rulings && !isCited(d) && live(d) && mine(d)),
    supersededCites: [...ctx.notes, ...ctx.adrs].filter((d) => isCited(d) && !live(d))
      .map((d) => ({ ...d, replacedBy: ctx.replacement(d) })),
    dangling: [...cited].filter(([ref]) => !ctx.known.has(ref)).map(([, asWritten]) => asWritten),
  };
}

function citationWarnings(intent, b, delivered) {
  const out = b.dangling.map((c) => `${intent.id} cites ${c} but no such record exists — fix the citation or restore the record`);
  for (const d of b.supersededCites) {
    const r = d.replacedBy;
    const by = r.ref ? ` by ${r.ref}` : '';
    out.push(delivered
      ? `${intent.id} is ✅ Delivered and cites ${d.file}, which has been superseded${by} — the scope it was built to moved: \`reverify ${intent.id} --decision ${r.concrete ? r.ref : '<the superseding record>'}\`, refine the citation, re-ratify`
      : `${intent.id} cites ${d.file}, which has been superseded${by} — refine the intent to cite ${r.concrete ? 'it' : 'the record that replaced it'} instead, then re-ratify`);
  }
  return out;
}

function renderBrief(intent, b, warnings, { budget = BRIEF_BUDGET } = {}) {
  const out = [
    `Decisions for ${intent.id}  ${intent.title || ''}`.trimEnd(),
    'The intent governs the what; a ratified design.md governs the how; binding records say why.',
    'If any of them disagree, raise an open question (to stray from an inherited premise, declare the deviation). Never resolve it silently.',
  ];
  let used = out.join('\n').length; // warnings sit outside the budget
  out.push(...warnings.map((w) => `  ⚠ ${w}`));
  const line = (d) => `  - ${d.date || '(undated)'} · ${d.title} (${d.file})`;
  const clip = (x) => (x.length > 240 ? `${x.slice(0, 239).trimEnd()}…` : x);
  const rulingsEntry = (d) => [line(d), ...d.bullets.slice(0, 12).map((x) => `      - ${clip(x)}`),
    ...(d.bullets.length > 12 ? [`      … ${d.bullets.length - 12} more in the file`] : [])];
  // [heading, entries, capped]. What binds (cited records, rulings, premises) is
  // never cut; the cap applies to history, whose rows the overflow line's grep finds
  // by this intent's id.
  const groups = [
    ['BINDING — cited by this intent', b.citedNotes.map((d) => [line(d), ...(d.core ? [`      ${d.core}`] : [])]), false],
    ['PENDING BUILD RULINGS — agent calls awaiting Trusted Guide review in PR §6; build consistent with them', b.pending.map(rulingsEntry), false],
    ['STANDING PREMISES — bind every intent', b.premises.map((d) => [
      `  - ${[d.id, d.title].filter(Boolean).join(' — ')} (${d.file})${d.deviation ? ` · deviation: ${d.deviation}` : ''}${d.deviatedBy.length ? ` · deviation declared: ${d.deviatedBy.join(', ')}` : ''}`,
      ...(d.cited && d.core ? [`      ${d.core}`] : []),
    ]), false],
    ['RATIFIED BUILD RULINGS — how-calls the Trusted Guide accepted where the intent and design were silent; build consistent with them', b.ratified.map(rulingsEntry), false],
    ['HISTORY — mentions this intent; already reflected in it, not authority', b.history.map((d) => [line(d)]), true],
  ];
  let skipped = 0, full = false, shown = 0;
  for (const [heading, entries, capped] of groups) {
    let headed = false;
    for (const entry of entries) {
      const block = (headed ? entry : ['', `${heading}:`, ...entry]).join('\n');
      if (capped && (full || used + block.length + 1 > budget)) { full = true; skipped++; continue; }
      out.push(block);
      used += block.length + 1;
      headed = true;
      shown++;
    }
  }
  if (!shown && !skipped) out.push('', '(no decision records bear on this intent)');
  if (skipped) out.push('', `${skipped} more record(s) not shown (size cap). \`node launchpad/scripts/intent-ledger.mjs decisions | grep ${intent.id}\` lists them.`);
  return out;
}

function decisionIndexLines(ctx) {
  const rows = [...ctx.adrs.map((d) => ({ ...d, premise: true })), ...ctx.notes]
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || a.file.localeCompare(b.file));
  const lines = rows.map((d) => {
    const tags = [];
    if (d.premise) tags.push('standing premise');
    if (ctx.superseded(d)) tags.push('superseded');
    if (d.pending) tags.push('pending ratification');
    return `${d.date || '(undated)'}  ${(d.intents || []).join(',') || '-'}  ${[d.id, d.title].filter(Boolean).join(' — ')}  (${d.file})${tags.length ? `  [${tags.join('; ')}]` : ''}`;
  });
  lines.push('', `${rows.length} record(s): ${ctx.adrs.length} standing premise(s), ${ctx.notes.length} dated note(s).`);
  return lines;
}

function cmdDecisions(filterId) {
  const ctx = loadDecisionContext();
  if (!filterId) { console.log(decisionIndexLines(ctx).join('\n')); process.exit(0); }
  const wanted = normId(filterId);
  const found = loadIntentsWithPath().find(({ intent }) => intent.id.toUpperCase() === wanted);
  if (!found) {
    console.error(`${wanted} is not a known intent (no intents/${wanted.toLowerCase()}/intent.md).`);
    process.exit(1);
  }
  const b = decisionBrief(found.intent, readFileSync(found.path, 'utf8'), ctx);
  const ledger = parseLedger({ soft: true }).byId;
  const delivered = stampStatus((ledger[wanted] || {}).status || '') === STATUS.delivered;
  console.log(renderBrief(found.intent, b, citationWarnings(found.intent, b, delivered)).join('\n'));
  process.exit(0);
}

function cmdConformance(filterId) {
  if (preIngestNotice()) process.exit(0);
  const intents = loadIntents();
  const wanted = filterId ? filterId.toUpperCase() : null;
  const ledger = parseLedger({ soft: true }).byId;

  const rows = [];
  for (const i of intents) {
    const id = i.id.toUpperCase();
    if (wanted && id !== wanted) continue;
    const g = groundingSummary(i.grounding);
    const delivered = stampStatus((ledger[id] || {}).status || '') === STATUS.delivered;
    rows.push({ id, phase: i.phase, delivered, grounded: g.grounded, g });
  }

  if (wanted && rows.length === 0) {
    console.error(`No intent matched "${filterId}".`);
    process.exit(1);
  }

  const anyGrounded = rows.some((r) => r.grounded);

  const phases = [...new Set(rows.map((r) => r.phase))].sort((a, b) => a - b);
  for (const phase of phases) {
    console.log(`Phase ${phase}`);
    for (const r of rows.filter((x) => x.phase === phase)) {
      const flag = r.delivered ? ' (Delivered)' : '';
      let state, detail;
      if (r.grounded) {
        const bits = [];
        if (r.g.hasReq) bits.push('requirement ✓');
        if (r.g.hasArch) bits.push('architecture ✓');
        const extra = r.g.labels.filter((l) => !REQ_LABELS.has(l.toLowerCase()) && !ARCH_LABELS.has(l.toLowerCase()));
        if (extra.length) bits.push(extra.join(', '));
        state = '🔗 grounded';
        detail = bits.join(' · ') || 'grounded';
      } else {
        // A delivered intent with no grounding is the untraceable increment #49
        // is about — flag it (⚠), don't fail. An undelivered one is just "not yet".
        state = r.delivered ? '⚠ delivered, no grounding' : '— no grounding';
        detail = r.delivered ? 'no requirement/architecture link to trace back to' : '';
      }
      const carriedNote = r.g.carried.length ? `  [carried: ${r.g.carried.join(', ')}]` : '';
      console.log(`  ${r.id}${flag}\t${state}\t${detail}`.trimEnd() + carriedNote);
    }
  }

  // Carried-but-unmapped upstream fields anywhere → surface (never fail).
  const carriedRows = rows.filter((r) => r.g.carried.length);
  if (carriedRows.length) {
    console.log(`\nℹ️  ${carriedRows.length} intent(s) carry upstream fields with no first-class home ` +
      '(preserved verbatim, not lost). Promote any that should be first-class via scoping-agent#147.');
  }

  if (!anyGrounded) {
    console.log('\nNo intent carries architectural grounding — nothing to trace. ' +
      '(Grounding is optional; it appears here whenever an intent carries it.)');
  } else {
    console.log(`\n${rows.filter((r) => r.grounded).length}/${rows.length} intent(s) carry architectural grounding.`);
    const gaps = rows.filter((r) => r.delivered && !r.grounded);
    if (gaps.length) {
      console.log(`\n⚠  ${gaps.length} Delivered intent(s) carry NO grounding — no approved requirement/architecture to trace to:`);
      for (const r of gaps) console.log(`   ${r.id}`);
      console.log('   → If this engagement needs traceability, add the link to intents/INT-00x/intent.md');
      console.log('     ## Grounding via /ql-refine-intent. (Reported, not enforced — the call is yours.)');
    }
  }

  // ── architecture-decision conformance (decisions/0009) ──────────────────────
  // Whole-engagement view; skip when the report was filtered to one intent (ADRs
  // aren't tied to an intent id). Presence-gated on an inherited premise existing
  // anywhere — the same "is this engagement grounded at all?" trigger the grounding
  // half uses; a commercial deal with no architecture ADRs stays silent here.
  if (!wanted) reportArchConformance();
  process.exit(0);
}

// The architecture-decision half of `conformance`. Presence-gated: silent unless
// a scopezilla-inherited premise exists (default-zero engagements print nothing).
// Never gates. Sorts declared deviations pending-ARB (loud) vs accepted (quiet).
function reportArchConformance() {
  const adrs = loadArchAdrs();
  // Classify by ORIGIN (the directory), not the self-declared Source stamp — the
  // directory is the authority (decisions/0009: "a path test, not a filename
  // guess"), and keying off it avoids double-counting a mis-stamped file.
  const inheritedAll = adrs.filter((a) => a.origin === 'inherited');
  if (!inheritedAll.length) return; // default-zero: no approved architecture to conform to → silent

  // A `Status: superseded-by-NNNN` inherited ADR was RETIRED during scoping (SZ's
  // `revise` chain). It's historical provenance, not a STANDING premise — so it's
  // excluded from the live premise set: it doesn't inflate the count, and
  // superseding an already-dead rule is not a deviation.
  const live = inheritedAll.filter((a) => !/superseded-by/.test(a.status));
  const retired = inheritedAll.length - live.length;
  const inheritedIds = new Set(live.map((a) => a.id));
  const builds = adrs.filter((a) => a.origin === 'build');
  // A declared deviation = a build-authored ADR that supersedes a LIVE inherited one.
  const deviations = builds
    .filter((a) => a.supersedes.some((s) => inheritedIds.has(s)))
    .map((a) => ({
      ...a,
      against: a.supersedes.filter((s) => inheritedIds.has(s)),
      // Accepted only in the exact form the human writes when the ARB signs,
      // `accepted-by-ARB (YYYY-MM-DD, <who>)`. Anything else (unmarked,
      // "pending-ARB", "accepted pending re-review", "rejected") is loud: the safe
      // default for a signal is to surface, not suppress.
      accepted: /^accepted-by-arb \(\d{4}-\d{2}-\d{2}, [^)]+\)$/i.test((a.deviation || '').trim()),
    }));

  const retiredNote = retired ? ` (${retired} more retired during scoping, not counted)` : '';
  console.log(`\nArchitecture conformance — ${live.length} inherited premise(s) (Source: scopezilla-inherited)${retiredNote}.`);
  const pending = deviations.filter((d) => !d.accepted);
  const accepted = deviations.filter((d) => d.accepted);

  if (!deviations.length) {
    console.log('  No build-authored ADR supersedes an inherited premise — no declared deviation.');
    console.log('  (A SILENT deviation — a build that strays but authored no ADR — is caught by the');
    console.log('   /ql-design-intent + /ql-vet-intent reflex, not this report.)');
    return;
  }
  if (pending.length) {
    console.log(`\n⚠  ${pending.length} declared deviation(s) AWAITING ARB sign-off:`);
    for (const d of pending) {
      console.log(`   ${d.id} supersedes ${d.against.join(', ')} — ${d.title || '(untitled)'}`);
      console.log(`     Deviation: ${d.deviation || 'unmarked'} → flip to "accepted-by-ARB (date, who)" once the ARB signs. ${d.file}`);
    }
  }
  if (accepted.length) {
    console.log(`\n✓  ${accepted.length} ARB-ratified deviation(s) (kept for the traceability record):`);
    for (const d of accepted) {
      console.log(`   ${d.id} supersedes ${d.against.join(', ')} — ${d.title || '(untitled)'}  [${d.deviation}]`);
    }
  }
}

// ── from-json ────────────────────────────────────────────────────────────────
// Transform a raw Scopezilla intents JSON into the living per-intent markdown
// files. Used by /ql-ingest-scopezilla to seed intents/ on first ingest (and to
// stage a fresh upstream import before `reconcile`). Writes intents/INT-NNN/
// intent.md; refuses to overwrite an existing one unless --force is given, so a
// careless re-run can't blow away in-repo refinements.
// The Scopezilla intents.json contract versions this engine reads (dgerow/scoping-agent
// #277). Scopezilla bumps `contract_version` only on a breaking change (a field
// renamed, removed or re-meant), so a newer one is refused rather than guessed at.
// Output from before the field existed is read as version 1.
const SZ_CONTRACT_VERSIONS = [1];

function loadRawJson(file) {
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); }
  catch (e) { console.error(`Could not read ${file}: ${e.message}`); process.exit(2); }
  if (data && !Array.isArray(data) && data.contract_version !== undefined) {
    const v = data.contract_version;
    if (!Number.isInteger(v)) { console.error(`${file}: contract_version must be an integer (got ${JSON.stringify(v)}).`); process.exit(2); }
    if (!SZ_CONTRACT_VERSIONS.includes(v)) {
      console.error(`${file} is Scopezilla contract version ${v}; this engine reads ${SZ_CONTRACT_VERSIONS.join(', ')}. ` +
        'Run /ql-resync to update launchpad/scripts/, then try again.');
      process.exit(2);
    }
  }
  return Array.isArray(data) ? data : (data.intents || []);
}

// Frontmatter keys serializeIntent writes from upstream. Anything else on an
// existing intent (`ratified:`, `derived_from:`, …) was recorded in-repo, so a
// --force rewrite carries it over rather than dropping it: losing `ratified:`
// would turn a "ratified at different scope" refusal into a mere "no record"
// warning at deliver.
const SERIALIZED_FM_KEYS = new Set(['id', 'phase', 'epic', 'confidence', 'surface', 'priority', 'origin', 'source', 'title']);
function carryLocalFrontmatter(oldText, newText) {
  const fmOf = (t) => {
    const n = t.replace(/\r\n?/g, '\n');
    const end = n.startsWith('---\n') ? n.indexOf('\n---\n', 4) : -1;
    return end === -1 ? null : { lines: n.slice(4, end).split('\n'), rest: n.slice(end) };
  };
  const oldFm = fmOf(oldText), newFm = fmOf(newText);
  if (!oldFm || !newFm) return newText;
  const keep = oldFm.lines.filter((l) => {
    const m = l.match(/^([A-Za-z_]+)\s*:/);
    return m && !SERIALIZED_FM_KEYS.has(m[1]);
  });
  return keep.length ? `---\n${[...newFm.lines, ...keep].join('\n')}${newFm.rest}` : newText;
}

// With --source <name>, the engagement allocates every id (decisions/0082 W3): an
// upstream id already mapped (`source: <name>#INT-003`) keeps its engagement intent;
// a new one keeps its own number when that number is free in this engagement on
// every branch, else takes the next free id. So a first source lines up 1:1 and a
// later one never collides. Upstream dependency ids are remapped the same way.
function sourceIdMap(raw, source) {
  const key = (srcId) => `${source}#${srcId}`;
  const mapped = new Map();
  for (const i of loadIntents()) if (i.source) mapped.set(i.source.toUpperCase(), i.id.toUpperCase());
  const taken = new Set([...intentNumbersAcrossRefs()]);
  try {
    for (const d of readdirSync(INTENTS_DIR, { withFileTypes: true })) {
      const m = d.isDirectory() && d.name.match(/^INT-(\d+)/i);
      if (m) taken.add(Number(m[1]));
    }
  } catch { /* no intents/ yet */ }
  const ids = new Map();
  const sorted = [...raw].map((i) => normId(i.id)).filter((id) => /^INT-\d+/.test(id))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const srcId of sorted) {
    const known = mapped.get(key(srcId).toUpperCase());
    if (known) { ids.set(srcId, known); continue; }
    let n = Number(srcId.match(/^INT-(\d+)/)[1]);
    if (taken.has(n)) n = Math.max(0, ...taken) + 1;
    taken.add(n);
    ids.set(srcId, `INT-${String(n).padStart(3, '0')}`);
  }
  return ids;
}

function withEngagementIds(i, source, ids, at = null) {
  const srcId = normId(i.id);
  const deps = i.dependencies && typeof i.dependencies === 'object' ? i.dependencies : null;
  const internal = deps && Array.isArray(deps.internal)
    ? deps.internal.map((d) => ids.get(normId(d)) || `${source}#${normId(d)}`) : undefined;
  return { ...i, id: ids.get(srcId), source: `${source}#${srcId}`, source_ref: { name: source, at },
    ...(internal ? { dependencies: { ...deps, internal } } : {}) };
}

function cmdFromJson(file, force, only = null, source = null, at = null) {
  if (!file) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs from-json <intents.json> [--force] [--only INT-001,INT-005]');
    process.exit(2);
  }
  let raw = loadRawJson(file);
  if (!raw.length) { console.error(`No intents found in ${file}.`); process.exit(1); }
  // Ids map over the whole source, so a dependency on an intent outside --only still
  // lands on its engagement id.
  const ids = source ? sourceIdMap(raw, source) : null;
  // --only scopes the write (and so --force) to named intents, so taking upstream's
  // text for the 🟡 changed-upstream-only set can't overwrite 🔵/🔴 intents we
  // refined in-repo — `reconcile` prints exactly this command.
  if (only) {
    const unknown = [...only].filter((id) => !raw.some((i) => normId(i.id) === id));
    if (unknown.length) {
      console.error(`--only names intent(s) not in ${file}: ${unknown.join(', ')}`);
      process.exit(2);
    }
    raw = raw.filter((i) => only.has(normId(i.id)));
  }
  if (source) {
    const moved = [...ids].filter(([s, e]) => s !== e && raw.some((i) => normId(i.id) === s));
    raw = raw.filter((i) => ids.has(normId(i.id))).map((i) => withEngagementIds(i, source, ids, at));
    if (moved.length) console.log(`Engagement ids for ${source}: ${moved.map(([s, e]) => `${source}#${s} → ${e}`).join(', ')}`);
  }

  let written = 0, skipped = 0;
  const grounded = [];          // intents that carried known grounding
  const carriedUnmapped = [];   // {id, keys[]} — upstream fields with no schema home, preserved verbatim
  const failed = [];            // {id, err} — malformed entries skipped so one bad shape can't strand a half-written tree
  for (const i of raw) {
    const id = normId(i.id);
    if (!/^INT-\d+/.test(id)) { console.error(`Skipping entry with bad id: ${JSON.stringify(i.id)}`); continue; }
    const dir = `${INTENTS_DIR}/${id}`;
    const path = `${dir}/intent.md`;
    if (existsSync(path) && !force) {
      skipped++;
      continue;
    }
    // One malformed upstream entry must not abort the batch or leave a bare,
    // half-written directory behind (the partial-ingest failure). Isolate each
    // write; report failures loudly at the end rather than crashing mid-loop.
    try {
      // Compute grounding BEFORE writing so we can report what was carried — the
      // "loud carry" that makes the ingest loss-proof instead of silently strict.
      const g = buildGrounding({ ...i, id });
      const body = serializeIntent({ ...i, id });   // may throw on an unexpected shape — before any mkdir/write
      if (g && g.entries && g.entries.length) grounded.push(id);
      if (g && g.carried && g.carried.length) carriedUnmapped.push({ id, keys: g.carried.map((c) => c.key) });
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, existsSync(path) ? carryLocalFrontmatter(readFileSync(path, 'utf8'), body) : body);
      written++;
    } catch (err) {
      failed.push({ id, err: err && err.message ? err.message : String(err) });
    }
  }
  console.log(`from-json: wrote ${written} intent file(s)` +
    (skipped ? `, skipped ${skipped} existing (use --force to overwrite — this discards in-repo refinements)` : '') +
    ` under ${INTENTS_DIR}/.`);
  if (grounded.length) {
    console.log(`Carried architectural grounding (## Grounding) for ${grounded.length} intent(s): ${grounded.join(', ')}.`);
  }
  if (carriedUnmapped.length) {
    // These are the fields that, before this change, would have been SILENTLY
    // DROPPED. Surfacing them is the whole fix — the human decides whether an
    // unmapped field deserves a first-class home (a scoping-agent#147 follow-up).
    console.log(`⚠️  Preserved ${carriedUnmapped.length} intent(s) with upstream fields that have no first-class schema home —`);
    console.log('    carried VERBATIM under "## Grounding → ### Carried" rather than dropped:');
    for (const c of carriedUnmapped) console.log(`      ${c.id}: ${c.keys.join(', ')}`);
    console.log('    If any of these should be first-class, note it for the SZ→QL contract (scoping-agent#147).');
  }
  if (skipped && !force) {
    console.log('Skipped files already exist as LIVING intents. To compare them against this');
    console.log(`upstream import instead of overwriting:  node launchpad/scripts/intent-ledger.mjs reconcile ${file}`);
  }
  if (failed.length) {
    // Surface, don't swallow: a shape the transform couldn't render is a likely
    // SZ→QL contract drift — flag it (per intent) instead of a silent partial ingest.
    console.error(`⚠️  Could not transform ${failed.length} intent(s) — skipped so the rest still landed:`);
    for (const f of failed) console.error(`      ${f.id}: ${f.err}`);
    console.error('    This usually means an unexpected upstream field shape — check data/intents.json,');
    console.error('    and consider a scoping-agent issue per the cross-repo hand-off convention.');
  }
}

// ── new ──────────────────────────────────────────────────────────────────────
// ── currency guard (decisions/0014, item 7) ──────────────────────────────────
// Before an intent-EDIT skill (/ql-refine-intent, /ql-capture-intent,
// /ql-start-intent) writes an intent, it asks this: am I working off the latest?
// Two signals, both WARN-not-block (a hard wall mid-flow on a VDI is the reflexive-
// ceremony failure the mission forbids — CI `drift` is the real backstop):
//   1. ahead/behind banner   — is my branch behind its upstream at all?
//   2. per-intent divergence  — has THIS intent's scope hash changed on the shared
//      branch since I started? (OpenSpec's base-fingerprint guard, using the scope
//      hash we already ship.) If so, my write may clobber someone's edit.
// The "shared branch" is the current branch's upstream tracking ref — the same ref
// the ahead/behind banner compares against — so this needs no config and honors
// whatever branch the team actually integrates on (develop, main, …).
// Best-effort throughout: if git/remote/upstream is unavailable, it reports "can't
// check" and the skill proceeds. Never exits non-zero.
function intentHashOnRef(ref, id) {
  const file = git(['show', `${ref}:${treePath(`${INTENTS_DIR}/${id}/intent.md`)}`]);
  if (!file.ok || !file.out) return null;
  const { intent } = parseIntentFile(file.out, `${ref}:${id}`);
  return scopeHash(intent);
}

function cmdCurrency(id, { json = false, fetch = true } = {}) {
  if (fetch) gitFetchQuiet();
  const ab = aheadBehind();
  const result = {
    checked: ab !== null,
    upstream: ab ? ab.upstream : null,
    ahead: ab ? ab.ahead : null,
    behind: ab ? ab.behind : null,
    intent: id ? id.toUpperCase() : null,
    diverged: false,          // this intent's scope hash differs on the upstream
    localHash: null,
    upstreamHash: null,
  };

  if (id && ab) {
    const norm = id.toUpperCase();
    const localPath = `${INTENTS_DIR}/${norm}/intent.md`;
    if (existsSync(localPath)) {
      const { intent } = parseIntentFile(readFileSync(localPath, 'utf8'), localPath);
      result.localHash = scopeHash(intent);
    }
    result.upstreamHash = intentHashOnRef(ab.upstream, norm);
    // Diverged only when BOTH sides exist and differ. Upstream-missing (a brand-new
    // local intent) or local-missing is not a clobber risk — it's a clean add.
    result.diverged = !!(result.localHash && result.upstreamHash && result.localHash !== result.upstreamHash);
  }

  if (json) { console.log(JSON.stringify(result, null, 2)); return; }

  if (!result.checked) {
    console.log('ℹ Currency: couldn\'t check (no upstream tracking branch, or git/remote unavailable) — proceeding.');
    return;
  }
  if (result.behind > 0) {
    console.log(`⚠ Your branch is ${result.behind} commit(s) behind ${result.upstream}` +
      `${result.ahead ? ` (and ${result.ahead} ahead)` : ''}.`);
    console.log(`  Pull first so you're editing the latest:  git pull --rebase`);
  } else {
    console.log(`✅ Up to date with ${result.upstream}.`);
  }
  if (result.diverged) {
    console.log('');
    console.log(`⛔ ${result.intent} has CHANGED on ${result.upstream} since you started ` +
      `(${result.upstreamHash} there → ${result.localHash} here).`);
    console.log('  Editing now may overwrite someone else\'s change to this intent.');
    console.log(`  Recommended:  git pull --rebase   (then re-open ${result.intent})`);
    console.log('  This is a warning, not a block — you can proceed if you know it\'s yours to change.');
  }
}

// ── stamp-regression guard (the stale-branch clobber) ────────────────────────
// The failure this exists for, observed on a live engagement: a branch cut
// BEFORE a delivery stamp merged carried a stale whole-table copy of the ledger,
// so merging it silently reverted six intents from ✅ Delivered back to 🔧 In
// progress and blanked their PR/evidence/hash cells. Nothing caught it —
// `validate`, `drift` and `coverage --gate` all pass on a ledger that has simply
// FORGOTTEN it delivered something, and README kept the old status because its
// own edit was a localized row that merged cleanly.
//
// `currency` is the wrong instrument for this: it asks "is my branch behind?",
// which both over- and under-fires (behind-but-untouched is fine; up-to-date can
// still clobber on a concurrent merge) and it never exits non-zero by design.
// This asks the precise question instead — does merging this PR take away a
// stamp the base branch already has? — which is deterministic and needs no fetch.
//
// Delivered → 🔄 Needs re-verify is NOT a regression: that's `drift` correctly
// flagging that scope moved. A re-stamped hash is not a regression either.
const EMPTY_CELL = new Set(['', '—', '-', '–']);
const isEmptyCell = (v) => EMPTY_CELL.has((v || '').replace(/[`*]/g, '').trim());

function cmdRegression(baseRef) {
  if (!baseRef) {
    const ab = aheadBehind();
    baseRef = ab ? ab.upstream : null;
  }
  if (!baseRef) {
    console.log('ℹ Stamp regression: no base ref given and no upstream tracking branch — skipping.');
    console.log('  Pass one explicitly:  node launchpad/scripts/intent-ledger.mjs regression --base origin/develop');
    return;
  }

  // A base ref that does not RESOLVE is a setup failure, not a first ingest —
  // fail loud rather than skip. `git show <ref>:<path>` conflates "ref missing"
  // with "path missing on that ref"; a PR that never fetched its base (a shallow
  // clone, a missing fetch-depth:0) would otherwise disarm this whole gate while
  // printing "nothing to compare". This is the one command that fails closed, so
  // an unresolvable ref must never be read as "nothing to lose".
  if (!git(['rev-parse', '--verify', '--quiet', `${baseRef}^{commit}`]).ok) {
    console.error(`⛔ Stamp regression: base ref "${baseRef}" does not resolve — cannot compare.`);
    console.error('   In CI, ensure the base branch is fetched (actions/checkout with fetch-depth: 0).');
    console.error('   Locally, pass a ref that exists:  node launchpad/scripts/intent-ledger.mjs regression --base origin/develop');
    process.exit(1);
  }

  let baseFile = git(['show', `${baseRef}:${treePath(LEDGER)}`]);
  // The layout-migration PR: the base is pre-0082, with one ledger at the repo root.
  // Compare against it, so CI checks the stamps on the PR that moves them.
  if ((!baseFile.ok || !baseFile.out) && !git(['ls-tree', '--name-only', baseRef, 'launchpad/engagements']).out) {
    const legacy = git(['show', `${baseRef}:delivery/intent-ledger.md`]);
    if (legacy.ok && legacy.out) { baseFile = legacy; console.log(`ℹ Stamp regression: ${baseRef} predates the launchpad/ layout; comparing against its root delivery/intent-ledger.md.`); }
  }
  if (!baseFile.ok || !baseFile.out) {
    console.log(`ℹ Stamp regression: no ${LEDGER} on ${baseRef} — nothing to compare (first ingest?). Skipping.`);
    return;
  }

  const base = parseLedgerText(baseFile.out);
  const head = parseLedger({ soft: true });
  if (!base.headerFound) {
    console.log('ℹ Stamp regression: could not find the Intent/Status columns on the base ledger — skipping.');
    return;
  }
  // A duplicated row means last-one-wins, so a stamp on the earlier row is invisible
  // to the comparison below — and on the BASE side that understates what there is to
  // lose, which is this command's whole subject. Nothing else ever validates the base
  // text, so this is the only place that can catch it.
  if (base.dupes.length || head.dupes.length) {
    const where = [base.dupes.length ? `${baseRef} (${base.dupes.join(', ')})` : null,
      head.dupes.length ? `this branch (${head.dupes.join(', ')})` : null].filter(Boolean).join(' and ');
    console.error(`⛔ Stamp regression: ${LEDGER} has more than one row for the same intent on ${where}.`);
    console.error('   Only the last row for an id is read, so a stamp on an earlier row can\'t be seen');
    console.error('   and this comparison would understate what was lost. Remove the duplicate first.');
    process.exit(1);
  }

  // The maximal regression is the one a working-tree `-f` guard is blind to: the
  // ledger is GONE on this branch while the base has stamps. Losing the whole
  // table has to fail louder than losing one row, not pass silently.
  const baseStamps = Object.values(base.byId).map((r) => stampStatus(r.status));
  const baseDelivered = baseStamps.filter((s) => s === STATUS.delivered).length;
  const baseUnreadable = baseStamps.filter((s) => s === null).length;
  if (!head.ledgerExists || !head.headerFound) {
    const why = head.ledgerExists
      ? `has no parseable Intent/Status header`
      : `is missing entirely`;
    // Nothing stamped on the base means nothing to lose — say so and pass,
    // rather than failing a PR while announcing "0 Delivered intent(s)".
    // An UNREADABLE status is not evidence of absence: skipping on it would let a
    // PR that deletes the whole table pass on a technicality, which is the
    // maximal regression this command exists to catch.
    if (!baseDelivered && !baseUnreadable) {
      console.log(`ℹ Stamp regression: ${LEDGER} ${why} on this branch, but ${baseRef} carries no delivery stamps — nothing to lose. Skipping.`);
      return;
    }
    console.error('');
    if (baseUnreadable) {
      console.error(`   (${baseUnreadable} status cell(s) on ${baseRef} could not be read, so the stamp count below is a floor.)`);
    }
    console.error(`⛔ Stamp regression — ${LEDGER} ${why} on this branch, but ${baseRef} carries ${baseDelivered} Delivered intent(s).`);
    console.error('');
    console.error(`Restore it from the base and re-apply this branch's own row edits:`);
    console.error('');
    console.error(`   git checkout ${baseRef} -- ${LEDGER}`);
    console.error('');
    process.exit(1);
  }

  const regressions = [];
  const unreadable = [];
  for (const [id, baseRow] of Object.entries(base.byId)) {
    // Compare the LEADING marker, never the raw cell.
    // The ledger's own preamble sanctions a free-text parenthetical after the
    // status word ("✅ Delivered (stamp rode the QA PR)"): an exact string match
    // silently skips such a row, and a whole-cell substring scan misgrades it in
    // both directions. See stampStatus.
    const baseStatus = stampStatus(baseRow.status);
    // Can't judge a cell we can't read — but surface it rather than dropping it,
    // because "the guard silently ignored this row" is how a stamp goes missing.
    if (baseStatus === null) {
      unreadable.push({ id, where: baseRef, cell: baseRow.status || '(blank)' });
      continue;
    }
    if (baseStatus !== STATUS.delivered) continue;
    const headRow = head.byId[id];

    if (!headRow) {
      regressions.push({ id, kind: 'row removed', was: baseRow.status, now: '(row absent)' });
      continue;
    }
    const headStatus = stampStatus(headRow.status);
    // Fail closed: a stamped row whose status this branch made unreadable can't
    // be confirmed as still stamped, and it gets its own message because
    // "downgraded" would misdescribe it and send the author looking for a status
    // change that isn't there.
    if (headStatus === null) {
      regressions.push({ id, kind: 'status no longer readable', was: baseRow.status, now: headRow.status || '(blank)' });
      continue;
    }
    if (headStatus !== STATUS.delivered && headStatus !== STATUS.drift && headStatus !== STATUS.retired) {
      regressions.push({ id, kind: 'status downgraded', was: baseRow.status, now: headRow.status || '(blank)' });
      continue;
    }
    // A governed ✅ Delivered → 🚫 Retired is a deliberate de-scoping (#139), not a
    // lost stamp — the same sanctioned category as → 🔄 drift. `retire` clears the
    // scope hash by design, so this MUST skip the proof-cell-wipe check below, which
    // would otherwise flag the intentionally-cleared hash as a blanked stamp and
    // hard-fail every PR that retires a delivered intent.
    if (headStatus === STATUS.retired) continue;
    // Still Delivered — but did the proof cells get wiped?
    const wiped = [];
    if (!isEmptyCell(baseRow.hash) && isEmptyCell(headRow.hash)) wiped.push('scope hash');
    if (!isEmptyCell(baseRow.evidence) && isEmptyCell(headRow.evidence)) wiped.push('evidence');
    if (!isEmptyCell(baseRow.pr) && isEmptyCell(headRow.pr)) wiped.push('PR');
    if (wiped.length) {
      regressions.push({ id, kind: `${wiped.join(' + ')} blanked`, was: 'stamped', now: 'cells emptied' });
    }
  }

  // Surfaced whether or not anything regressed: a row the guard couldn't read is
  // a row the guard didn't check, and that has to be visible rather than implied
  // by a count. Never a failure on its own — the cell may be legitimately odd.
  for (const u of unreadable) {
    console.log(`⚠️  ${u.id}: could not read the status cell on ${u.where} (${u.cell}) — not checked for a lost stamp. Lead the cell with its status marker.`);
  }

  if (!regressions.length) {
    console.log(`✅ No stamp regression — all ${baseDelivered} intent(s) Delivered on ${baseRef} are still stamped here.`);
    return;
  }

  console.error('');
  console.error(`⛔ Stamp regression — this branch takes away ${regressions.length} delivery stamp(s) that ${baseRef} already has:`);
  console.error('');
  for (const r of regressions) {
    console.error(`   ${r.id}  ${r.kind}`);
    console.error(`      on ${baseRef}: ${r.was}`);
    console.error(`      here:        ${r.now}`);
  }
  console.error('');
  console.error(`Almost always this branch predates the stamp and is carrying a stale copy of`);
  console.error(`${LEDGER}. Bring the base in and keep the incoming stamps:`);
  console.error('');
  console.error(`   git fetch origin && git rebase ${baseRef}`);
  console.error(`   # resolve ${LEDGER} in favour of the rows already Delivered on ${baseRef}`);
  console.error(`   node launchpad/scripts/intent-ledger.mjs regression --base ${baseRef}`);
  console.error('');
  console.error('If a stamp is being withdrawn ON PURPOSE, say so in the PR description and');
  console.error('use 🔄 Needs re-verify (the drift status) rather than reopening the row.');
  process.exit(1);
}

// ── sync ─────────────────────────────────────────────────────────────────────
// Open a ⬜ Not started row for every intent in intents/ that has none, and
// re-derive the footer count + README index. The self-heal half of the presence
// gate: `validate` tells you a row is missing, this fixes it without anyone
// hand-editing a file the docs say never to hand-edit.
//
// Deliberately NOT `start` — that marks work 🔧 In progress, which is a lie about
// a freshly captured intent and is how a backlog item gets misreported as active.
// Deliberately additive: a ledger row with no intents/ directory is REPORTED and
// left alone, because deleting a row can throw away delivery history and the
// right fix is usually to restore the intent file a merge dropped.
function cmdSync() {
  if (preIngestNotice()) process.exit(0);
  const intents = loadIntents();
  const { byId, headerFound, ledgerExists } = parseLedger({ soft: true });
  // No ledger at all is the one input `sync` can self-heal without risk: there is
  // no delivery history to clobber, so seed a fresh one (a row per intent) and
  // stop. This closes the dead-end where the first grilled ingest, or capturing
  // the first local intent before any ingest, ran `new`/`sync` before a ledger
  // existed — `new` could not open a row and `sync` used to exit 2. A ledger that
  // EXISTS but is unreadable is different: it may carry stamps, so refuse rather
  // than overwrite.
  if (!ledgerExists) {
    writeFileSync(LEDGER, seedLedgerText() + '\n');
    console.log(`No ${LEDGER} yet — seeded a fresh ledger with ${intents.length} ⬜ Not started row(s).`);
    if (existsSync(README)) { cmdIndex(true, { quiet: true }); console.log('Refreshed the README delivery index.'); }
    return;
  }
  if (!headerFound) {
    console.error(`${LEDGER} exists but has no readable Intent/Status table — refusing to overwrite it.`);
    console.error(`Fix the header by hand, or re-seed:  node launchpad/scripts/intent-ledger.mjs seed > ${LEDGER_FROM_ROOT}`);
    process.exit(2);
  }

  const rowIds = new Set(Object.keys(byId));
  const added = [];
  for (const i of intents) {
    if (rowIds.has(i.id.toUpperCase())) continue;
    const res = ensureLedgerRow(i);
    if (res.created) added.push(i.id);
  }

  const phantom = [...rowIds].filter((id) => !intents.some((i) => i.id.toUpperCase() === id));

  if (added.length) {
    console.log(`Opened ${added.length} ⬜ Not started ledger row(s): ${added.join(', ')}`);
    if (existsSync(README)) { cmdIndex(true, { quiet: true }); console.log('Refreshed the README delivery index.'); }
  } else {
    console.log('Every intent already has a ledger row.');
  }

  // Re-derive the footer even when nothing was added — it may have been hand-edited.
  const lines = readFileSync(LEDGER, 'utf8').split('\n');
  const footer = refreshFooterCount(lines);
  if (footer.updated) {
    writeLedgerLines(lines);
    console.log(`Ledger footer count ${footer.was} → ${footer.now}.`);
  }

  if (phantom.length) {
    console.log('');
    console.log(`⚠ ${phantom.length} ledger row(s) have no intents/ directory: ${phantom.join(', ')}`);
    console.log('  Left in place on purpose — removing a row can discard delivery history.');
    console.log('  Restore the intent file if a merge dropped it. A de-scoped intent keeps its intent.md and is');
    console.log('  retired with `retire INT-xxx --decision <ref>` — never by deleting the file or the row.');
  }
}

// Scaffold a NEW, locally-authored intent (origin: local, confidence: draft) —
// the engine half of /ql-capture-intent and ad-hoc authoring. Allocates the next
// free INT-NNN across ALL existing intents (single sequence; local intents are
// first-class, not a reserved range), creates intents/INT-NNN/intent.md from a
// template, and prints the id so the skill can fill it in + add a ledger row.
// Refuses to clobber. The phase/title can be seeded via flags; everything else
// is a _TODO_ for the human-ratified draft.
// Highest INT-NNN numeric id in the LOCAL working tree's intents/ dir.
function maxLocalIntentId() {
  let max = 0;
  let dirs = [];
  try { dirs = readdirSync(INTENTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()); }
  catch { /* intents/ may not exist yet */ }
  for (const d of dirs) {
    const m = d.name.match(/^INT-(\d+)/i);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// Allocate the next free INT-NNN. Collision-safe for parallel teams (decisions/0014):
// a best-effort `git fetch` + max across local dirs AND all refs (local + remote)
// means an id already claimed on someone's unmerged branch is skipped, not reused.
// This NARROWS the race window; it does not close it (two simultaneous allocations
// off the same base still tie) — the never-clobber auto-bump at write time (cmdNew)
// is the actual backstop. Degrades to the plain local scan when git is unavailable.
function nextIntentId({ fetch = true } = {}) {
  if (fetch) gitFetchQuiet();
  const max = Math.max(maxLocalIntentId(), maxIntentIdAcrossRefs());
  return `INT-${String(max + 1).padStart(3, '0')}`;
}

function cmdNew(opts) {
  let id = (opts.id || nextIntentId({ fetch: opts.fetch !== false })).toUpperCase();
  if (!/^INT-\d+/.test(id)) {
    console.error(`Bad intent id "${id}". Use INT-NNN or omit --id to auto-allocate.`);
    process.exit(2);
  }
  // --id is a PREFERENCE, not a command (decisions/0014). If the requested id (or
  // an auto-allocated one that raced a parallel branch) is already taken locally,
  // bump to the next free slot and warn — NEVER clobber an existing intent dir.
  // This is the real collision backstop: fetch-and-max narrows the window, this
  // closes it. Only the local filesystem is authoritative for "taken" here (a dir
  // that exists = a real file we must not overwrite); the cross-ref max already
  // steered auto-allocation clear of unmerged branches.
  if (existsSync(`${INTENTS_DIR}/${id}/intent.md`)) {
    const requested = id;
    let n = Number(id.match(/^INT-(\d+)/i)[1]);
    do { n += 1; id = `INT-${String(n).padStart(3, '0')}`; }
    while (existsSync(`${INTENTS_DIR}/${id}/intent.md`));
    console.error(`⚠ ${requested} is already taken — allocated ${id} instead (existing intents are never overwritten).`);
  }
  const dir = `${INTENTS_DIR}/${id}`;
  const path = `${dir}/intent.md`;
  const draft = serializeIntent({
    id,
    phase: opts.phase ?? '',
    epic_id: opts.epic || '',
    confidence: 'draft',
    origin: 'local',
    title: opts.title || '',
    build_target: '',
    guardrails: [],
    out_of_scope: [],
    acceptance: '',
    dependencies: { internal: [], external: [] },
    open_questions: [],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, draft);
  console.log(`Scaffolded ${path} (origin: local, confidence: draft).`);

  // Open the ledger row and refresh the derived README index in the SAME run.
  // These used to be printed instructions ("4. Add a ledger row + index --write"),
  // which is why a captured-but-not-yet-started intent could sit invisible: the
  // row was only ever created as a side effect of `start`/`deliver`, so an
  // intent could go weeks with a directory and no row. A row is bookkeeping the
  // tool owes the author, not homework — same reasoning as `deliver`'s atomic
  // stamp+index.
  const row = ensureLedgerRow({ id, phase: opts.phase ?? '' });
  if (row.created) {
    console.log(`Added a ⬜ Not started ledger row for ${id}.`);
    if (row.footer && row.footer.updated) {
      console.log(`  (ledger footer count ${row.footer.was} → ${row.footer.now})`);
    }
    if (existsSync(README)) {
      cmdIndex(true, { quiet: true });
      console.log('Refreshed the README delivery index.');
    }
  } else if (row.reason && row.reason !== 'already-present') {
    console.log(`⚠ Could not open a ledger row automatically (${row.reason}).`);
    console.log(`  Add one by hand, then: node launchpad/scripts/intent-ledger.mjs index --write`);
  }

  console.log('Next:');
  console.log(`  1. Fill in build_target / guardrails / out_of_scope / acceptance (the _TODO_ markers).`);
  console.log(`  2. Record why it exists in decisions/ (cite the meeting note / ask it came from).`);
  console.log(`  3. node launchpad/scripts/intent-ledger.mjs validate   # confirm it parses & deps resolve`);
}

// ── reconcile ────────────────────────────────────────────────────────────────
// 3-way divergence REPORT for re-ingest. Read-only — never writes. Tells you, per
// intent, whether the change since last import came from UPSTREAM, from US (an
// in-repo refinement), or BOTH (a genuine conflict a human must settle).
//   base   = scopezilla/data/intents.json  (raw upstream as last imported)
//   ours   = intents/                       (living canonical, possibly refined)
//   theirs = <file>                         (fresh upstream output)
// Hash a raw-JSON or parsed-markdown intent to the same scope hash. hashScopeFields
// is shape-agnostic, so no pre-coercion is needed here — both paths share exactly
// one definition of scope, which is the point.
function reconcileHash(intentLike) {
  return hashScopeFields(intentLike);
}

// The whole upstream record, for noticing a change outside the scope fields (phase,
// epic, grounding, answers). Key order is normalized so a reordered file isn't news.
function recordHash(raw) {
  const norm = (v) => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v);
  return createHash('sha256').update(JSON.stringify(norm(raw))).digest('hex');
}

// With --source <name> (decisions/0082 W3) the report is about one tied source:
// upstream ids are that source's own, ours are the intents recorded as coming from
// it (`source: <name>#INT-003`), and the base is the source at its last reviewed
// commit, passed in as --base (the skill reads it with `source show`). Without
// --source it reads the old in-repo mirror as the base.
function cmdReconcile(file, { source = null, baseFile = null } = {}) {
  if (!file) {
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs reconcile <fresh-upstream-intents.json> [--source <name> --base <base.json>]');
    process.exit(2);
  }
  const theirs = Object.fromEntries(loadRawJson(file).map((i) => [normId(i.id), i]));
  const engId = {};
  const ours = Object.fromEntries(loadIntents().flatMap((i) => {
    if (!source) return [[i.id.toUpperCase(), i]];
    const m = (i.source || '').match(/^(.+)#(INT-\d+[a-z]?)$/i);
    if (!m || m[1] !== source) return [];
    engId[normId(m[2])] = i.id.toUpperCase();
    return [[normId(m[2]), i]];
  }));
  const label = (id) => (source ? (engId[id] ? `${engId[id]} (${source}#${id})` : `${source}#${id}`) : id);
  const baseSource = source ? baseFile : RAW_JSON;
  let base = {};
  const haveBase = !!baseSource && existsSync(baseSource);
  if (haveBase) {
    base = Object.fromEntries(loadRawJson(baseSource).map((i) => [normId(i.id), i]));
  } else {
    console.log(`(No merge base${baseSource ? ` at ${baseSource}` : ''} — can't attribute a change to upstream vs in-repo,\n` +
      ` so any intent that differs is flagged for a human to settle.)\n`);
  }

  const ids = [...new Set([...Object.keys(theirs), ...Object.keys(ours), ...Object.keys(base)])].sort(
    (a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const groups = { added: [], removedUpstream: [], localAuthored: [], upstreamOnly: [], localOnly: [], conflict: [], outsideScope: [], unchanged: [] };

  for (const id of ids) {
    const t = theirs[id], o = ours[id], b = base[id];
    if (!o && t) { groups.added.push(id); continue; }       // upstream added; not in repo
    if (o && !t) {                                          // not in fresh upstream
      // A locally-authored intent (origin: local) was never upstream — its
      // absence is expected, not a deletion. Only a scopezilla-origin intent
      // that vanished is a real "removed upstream".
      if ((o.origin || 'scopezilla') === 'local') groups.localAuthored.push(id);
      else groups.removedUpstream.push(id);
      continue;
    }
    if (!o && !t) continue;
    const tHash = reconcileHash(t);
    const oHash = reconcileHash(o);
    const bHash = b ? reconcileHash(b) : null;
    const upstreamMoved = bHash ? tHash !== bHash : true;   // no base → treat as moved
    const weMoved = bHash ? oHash !== bHash : oHash !== tHash;
    if (tHash === oHash) {                                   // agree on scope
      if (b && tHash === bHash && recordHash(t) !== recordHash(b)) groups.outsideScope.push(id);
      else groups.unchanged.push(id);
      continue;
    }
    if (upstreamMoved && weMoved) groups.conflict.push(id);
    else if (upstreamMoved) groups.upstreamOnly.push(id);
    else groups.localOnly.push(id);
  }

  const srcFlag = source ? ` --source ${source}` : '';
  const section = (title, ids, hint) => {
    if (!ids.length) return;
    console.log(`${title} (${ids.length}): ${ids.map(label).join(', ')}`);
    if (hint) console.log(`   ${hint}\n`); else console.log('');
  };

  console.log('Re-ingest reconcile report (read-only — nothing was changed):\n');
  section('🆕 Added upstream', groups.added,
    `New intents in the fresh output. Run: node launchpad/scripts/intent-ledger.mjs from-json ${file}${srcFlag} (writes only the new ones), then node launchpad/scripts/intent-ledger.mjs sync to open their ledger rows.`);
  section('🟡 Changed upstream ONLY', groups.upstreamOnly,
    `Upstream refined these; we have not touched them. Safe to take the new text: node launchpad/scripts/intent-ledger.mjs from-json ${file}${srcFlag} --force --only ${groups.upstreamOnly.join(',')} (or hand-merge).`);
  section('🔵 Refined in-repo ONLY', groups.localOnly,
    'We refined these; upstream did not move them. KEEP ours — do not overwrite. (If upstream is the same draft we started from, nothing to do.)');
  section('🔴 CONFLICT — settle by hand', groups.conflict,
    haveBase
      ? 'Upstream AND we changed these since last import. A human must settle each: compare intents/<id>/intent.md against the fresh output and decide.'
      : 'These differ between the repo and the fresh output, and with no merge base we can\'t tell who moved. A human compares intents/<id>/intent.md against the fresh output and decides.');
  section('⚫ Removed from upstream', groups.removedUpstream,
    'Scopezilla-origin intents no longer in the fresh output. If intentional, retire it: node launchpad/scripts/intent-ledger.mjs retire <id> --decision <ref>; if upstream dropped it by mistake, keep ours and flag upstream.');
  section('🟣 Locally authored (origin: local)', groups.localAuthored,
    'Authored in-repo from notes/an ask — never upstream, so correctly absent from the fresh output. Kept as-is; no action.');
  section('ℹ Changed upstream outside scope', groups.outsideScope,
    'Upstream moved something the scope hash doesn\'t cover (phase, epic, grounding, answers). Not drift and nothing re-verifies; a human reads the change and refines the intent if it matters.');
  section('✅ Unchanged', groups.unchanged, null);

  const needsHuman = groups.conflict.length + groups.removedUpstream.length;
  console.log(needsHuman
    ? `\n${needsHuman} intent(s) need a human decision. Nothing was written — the repo stays canonical.`
    : '\nNo conflicts. Apply the additions/upstream-only changes with from-json as noted above.');
}

// ── metrics (within-engagement delivery signals; decisions/0043) ─────────────
// TIER 1: everything here is derived from git FILE-HISTORY alone — no stamping,
// no gh, and (the maintainer's hard constraint) no parsing of commit MESSAGES.
// Per intent we walk intent.md's commits and recompute the SAME scope hash the
// drift gate uses (scopeHash — the five fields of decisions/0038) at each
// revision, so "a scope change" here means exactly what it means to drift.
//
// BRANCH-INDEPENDENT BY REQUIREMENT: the numbers must be the same whether you run
// this from an intent's feature branch or from the integration branch it merged
// into — a Trusted Guide takes stock from wherever they happen to be, and a metric
// that changes with your checkout isn't trustworthy. So we do NOT walk
// --first-parent (that folds a merged intent's whole authoring history into the
// single merge commit when viewed from the mainline — the iteration vanishes). We
// walk the file's real change history (`git log -- path`, default simplification),
// which surfaces the same authoring revisions from either branch: a genuinely
// iterated intent (its scope actually moved and the moves survived to the current
// content) reports the same churn from the feature branch and from main after the
// merge. (One honest asymmetry, never an inflation: git's simplification prunes a
// branch whose net change did NOT survive — an edit-and-revert X→Y→X shows its two
// moves on the branch itself but reads as unchanged once merged, since the kept
// content never left X. We count the scope moves that were KEPT, and never
// fabricate one that wasn't.)
//
// The HONESTY CONTRACT is load-bearing: a metric degrades to partial/unknown,
// NEVER to a wrong number. The traps this guards against (all found in review):
//   - a revision that doesn't CLEANLY parse (missing a required section, bad
//     frontmatter) hashing empty fields into a FAKE scope change → we skip ANY
//     revision parseIntentFile flags, not just a missing title;
//   - a shallow clone or a rename-truncated history looking complete → both
//     force coverage to partial (we can only UNDERcount there);
//   - a squash-merge collapsing an intent's revisions into one commit → the
//     single-commit history is flagged partial (churn can only undercount);
//   - non-monotonic author dates (rebase) yielding a NEGATIVE (or intermediate
//     out-of-order) time-to-stable → clamped, and flagged;
//   - an unparseable author date → time-to-stable unavailable (null + flagged),
//     never a silent 0;
//   - a dirty working tree mixing committed history with uncommitted edits
//     → counts come from committed history; a dirty tree is flagged;
//   - unknown rows emitting 0 (which a JSON consumer reads as "no churn")
//     → numeric fields are null when unknown.
// Read-only; never gates on findings (a bad filter arg is the only non-zero exit).
// Cost: O(intents × revisions) git calls (a `git show` per revision, plus a small
// fixed set per intent). Acceptable for an advisory report run occasionally — not
// on a hot path — so it favors correctness/clarity over minimizing subprocesses.

// Shallow clones (CI `fetch-depth`) and squash/rebase can't be undone here — we
// DETECT and DISCLOSE them. `git rev-parse --is-shallow-repository` is git ≥2.15;
// on older git the flag is absent → treated as not-shallow (best-effort).
function isShallowRepo() {
  return git(['rev-parse', '--is-shallow-repository']).out === 'true';
}

// intent.md has uncommitted (staged or unstaged) changes → the working tree is
// ahead of the history these metrics read. Any porcelain output for the path.
function workingTreeDirty(path) {
  const r = git(['status', '--porcelain', '--', path]);
  return r.ok && r.out.trim().length > 0;
}

// Commits that changed intent.md at `path`, oldest→newest ({sha,dateISO}), plus
// `renamed`: whether --follow sees history the path-walk can't (a rename hid
// earlier revisions we then can't `git show` at this path).
// We walk the file's real change history (default history simplification, NOT
// --first-parent) so the authoring revisions of a merged intent are visible from
// the integration branch too — the branch-independence the top comment requires;
// git drops the TREESAME merge commit and lists the underlying edits in order. The
// rename probe uses plain all-parents counts (its own question, kept separate from
// the walk). Best-effort throughout.
function fileHistory(path) {
  const walk = git(['log', '--reverse', '--format=%H\t%aI', '--', path]);
  const commits = (walk.ok && walk.out)
    ? walk.out.split('\n').filter(Boolean).map((line) => {
        const [sha, dateISO] = line.split('\t');
        return { sha, dateISO };
      })
    : [];
  // A single --follow --diff-filter=R probe: any rename commit for this path means
  // history reaches back past a rename we can't `git show` at today's path.
  let renamed = false;
  if (commits.length) {
    const r = git(['log', '--follow', '--diff-filter=R', '--format=%H', '--', path]);
    renamed = r.ok && r.out.trim().length > 0;
  }
  return { commits, renamed };
}

// A revision is unusable for the scope hash only when a HASHED field can't be
// trusted — broken/absent frontmatter (→ title), or a missing required section
// (all four required sections ARE hashed fields). A problem about a NON-hashed
// frontmatter field (id/phase) must NOT trigger a skip: the hash is still fully
// computable, and skipping would undercount churn for a perfectly hashable revision.
function hashUnreliable(problems) {
  return problems.some((p) =>
    /no YAML frontmatter|frontmatter opened with|missing "title:"|missing required "## /.test(p));
}

// The intent's scope hash + OPEN (unanswered) question count at one commit, read
// from `path` at `sha`. Returns null when a HASHED field can't be trusted at that
// revision (see hashUnreliable), so a malformed mid-edit commit is skipped rather
// than hashed into a fake transition — without over-skipping on a missing id/phase.
function intentAtCommit(sha, path) {
  const file = git(['show', `${sha}:${treePath(path)}`]);
  if (!file.ok || !file.out) return null;
  const { intent, problems } = parseIntentFile(file.out, `${sha}:${path}`);
  if (hashUnreliable(problems)) return null;
  return { hash: scopeHash(intent), openQs: openQuestionCount(intent) };
}

// Only UNANSWERED questions are "open" — an answered-in-place question must not
// keep the count up (or burn-down never fires).
function openQuestionCount(intent) {
  return (intent.open_questions || []).filter((q) => q.status !== 'ANSWERED').length;
}

// Whole days between two ISO instants, to one decimal. null if either won't parse.
function daysBetween(aISO, bISO) {
  const a = Date.parse(aISO), b = Date.parse(bISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round(((b - a) / 86400000) * 10) / 10;
}

// One intent's metrics row. `coverage` is the honesty marker:
//   full    — a clean multi-revision history, every revision parsed, not shallow/
//             renamed/dirty.
//   partial — some revisions skipped, or the history is shallow / rename-truncated
//             / a lone (maybe-squashed) commit / a dirty tree — churn can only
//             UNDERcount, so the note says why.
//   unknown — no git, or no tracked history for this intent.md. The HISTORY-derived
//             fields (scope_changes, time_to_stable_days) are null (never 0), so no
//             consumer reads a phantom "no churn". open_questions_now still reflects
//             the CURRENT file (a present-state reading, not history), with peak=now
//             and burned=false since there's no trajectory to measure.
// `ctx` carries repo-wide facts computed once: { inRepo, shallow }.
function metricsRowFor(intent, path, ctx) {
  const id = intent.id.toUpperCase();
  const row = {
    id, phase: intent.phase ?? null,
    revisions: 0,
    scope_changes: null,
    time_to_stable_days: null,
    // For an unknown row (no history) the working tree is the only signal we have;
    // a known row overwrites these from committed history below.
    open_questions_now: openQuestionCount(intent),
    open_questions_peak: openQuestionCount(intent),
    open_questions_burned: false,
    coverage: 'full',
    note: '',
  };

  if (!ctx.inRepo) { row.coverage = 'unknown'; row.note = 'not a git work tree'; return row; }
  const { commits, renamed } = fileHistory(path);
  row.revisions = commits.length;
  if (commits.length === 0) { row.coverage = 'unknown'; row.note = 'no tracked history for intent.md (uncommitted?)'; return row; }

  const parsed = [];
  let skipped = 0;
  let headParsed = false; // did the CURRENT (HEAD) revision itself parse cleanly?
  for (let idx = 0; idx < commits.length; idx++) {
    const at = intentAtCommit(commits[idx].sha, path);
    if (!at) { skipped++; continue; }
    parsed.push({ dateISO: commits[idx].dateISO, ...at });
    if (idx === commits.length - 1) headParsed = true;
  }
  if (parsed.length === 0) {
    row.coverage = 'unknown';
    row.note = `all ${commits.length} revision(s) unparseable at their commit`;
    return row;
  }

  // Churn = hash transitions across the PARSED sequence. A change made and reverted
  // entirely within skipped revisions can go uncounted — but skipped>0 forces
  // coverage to `partial` below, so that undercount is disclosed, never presented
  // as an exact `full` count.
  let changes = 0;
  let lastChangeISO = parsed[0].dateISO;
  for (let k = 1; k < parsed.length; k++) {
    if (parsed[k].hash !== parsed[k - 1].hash) { changes++; lastChangeISO = parsed[k].dateISO; }
  }
  row.scope_changes = changes;

  // Time-to-stable is anchored to the first PARSED revision (not raw hist[0],
  // which may have been skipped) and is 0 by definition when nothing ever moved.
  const notes = [];
  // Author dates out of order across the parsed sequence (a rebase can reorder
  // them relative to topology) make any duration derived from them untrustworthy —
  // detect it up front so both the "no move" (tts stays 0) and "moved" branches can
  // flag it, and so an INTERMEDIATE reversal (not just a final negative) is caught.
  let datesNonMonotonic = false;
  for (let k = 1; k < parsed.length; k++) {
    const prev = Date.parse(parsed[k - 1].dateISO), cur = Date.parse(parsed[k].dateISO);
    if (!Number.isNaN(prev) && !Number.isNaN(cur) && cur < prev) { datesNonMonotonic = true; break; }
  }
  let tts = 0;
  let dateUnparseable = false;
  if (changes > 0) {
    const d = daysBetween(parsed[0].dateISO, lastChangeISO);
    if (d === null) {
      // An unparseable author date — report time-to-stable as unavailable rather
      // than a silent 0 (which reads as "stabilized instantly"). Degraded below.
      row.time_to_stable_days = null;
      dateUnparseable = true;
    } else {
      tts = d < 0 ? 0 : d;
      row.time_to_stable_days = tts;
    }
  } else {
    row.time_to_stable_days = tts;
  }

  // Open-question trajectory over COMMITTED revisions (never mixing in the working
  // tree — that's the dirty-tree case, flagged below). "now" is the count at HEAD;
  // if HEAD itself didn't parse, the last parseable revision is STALE, so we null
  // "now" rather than pass an old count off as current (a validate-gated main can't
  // hit this — an unparseable committed HEAD is the trigger). peak stays meaningful.
  const peak = Math.max(...parsed.map((p) => p.openQs));
  row.open_questions_peak = peak;
  if (headParsed) {
    const committedNow = parsed[parsed.length - 1].openQs;
    row.open_questions_now = committedNow;
    row.open_questions_burned = peak > 0 && committedNow === 0;
  } else {
    row.open_questions_now = null;
    row.open_questions_burned = false;
    notes.push('current revision unparseable — open-question count unavailable');
  }

  const degrade = (msg) => { if (row.coverage === 'full') row.coverage = 'partial'; notes.push(msg); };
  if (skipped > 0) degrade(`${skipped}/${commits.length} revision(s) unparseable — skipped`);
  if (ctx.shallow) degrade('shallow clone — history truncated, churn may undercount');
  if (renamed) degrade('history predates a rename — pre-rename revisions not counted');
  if (commits.length === 1) degrade('single-commit history (possibly squashed) — churn may undercount');
  if (dateUnparseable) degrade('unparseable commit date — time-to-stable unavailable');
  if (datesNonMonotonic) degrade('non-monotonic commit dates (rebase?) — time-to-stable is approximate');
  if (workingTreeDirty(path)) degrade('uncommitted changes to intent.md — working tree ahead of history');
  row.note = notes.join('; ');
  return row;
}

// Load living intents WITH their on-disk path — metrics must read history at the
// real directory, not one reconstructed from the (normalized) frontmatter id,
// which diverges for a non-standard dir name (e.g. an unpadded intents/INT-1/).
// Uses the same intentDirNames() discovery + ENOENT-vs-real-error handling as
// loadIntents, so the two loaders can't silently diverge.
function loadIntentsWithPath() {
  let dirs;
  try {
    dirs = intentDirNames();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    console.error(`Could not read ${INTENTS_DIR}/: ${e.message}`);
    process.exit(2);
  }
  const out = [];
  for (const dir of dirs) {
    const path = `${INTENTS_DIR}/${dir}/intent.md`;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    const { intent } = parseIntentFile(text, path);
    out.push({ intent, path });
  }
  out.sort((a, b) => a.intent.id.localeCompare(b.intent.id, undefined, { numeric: true }));
  return out;
}

function cmdMetrics(filterId, { json = false } = {}) {
  // Load once (loadIntentsWithPath); only fall back to preIngestNotice's richer
  // "run /ql-ingest-scopezilla" messaging when there's nothing to report.
  const loaded = loadIntentsWithPath();
  if (loaded.length === 0 && preIngestNotice()) process.exit(0);
  const ctx = { inRepo: inGitRepo(), shallow: false };
  if (ctx.inRepo) ctx.shallow = isShallowRepo();
  // normId (not bare toUpperCase) so an unpadded filter — `metrics INT-14` —
  // matches the normalized intent id INT-014.
  // normId returns a canonical uppercase, zero-padded id; intent.id is normId'd at
  // parse time, so both sides are already canonical — compare directly.
  const wanted = filterId ? normId(filterId) : null;
  const rows = [];
  for (const { intent, path } of loaded) {
    if (wanted && intent.id !== wanted) continue;
    rows.push(metricsRowFor(intent, path, ctx));
  }
  if (wanted && rows.length === 0) {
    console.error(`No intent matched "${filterId}".`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify({ source: 'git-file-history', tier: 1, intents: rows }, null, 2));
    process.exit(0);
  }

  console.log('Intent delivery metrics — Tier 1 (git file-history; decisions/0043)');
  console.log('Scope Δ = times the hashed scope actually moved (real churn, not cosmetic edits).\n');
  const pad = (v, n) => String(v).padEnd(n);
  const rowLine = (c) =>
    `  ${pad(c[0], 9)} ${pad(c[1], 5)} ${pad(c[2], 8)} ${pad(c[3], 10)} ${pad(c[4], 15)} ${pad(c[5], 19)} ${c[6]}`;
  console.log(rowLine(['Intent', 'Phase', 'Scope Δ', 'Revisions', 'Time-to-stable', 'Open Qs (now/peak)', 'Coverage']));
  for (const r of rows) {
    const nowStr = r.open_questions_now === null ? '—' : r.open_questions_now;
    const oq = `${nowStr}/${r.open_questions_peak}${r.open_questions_burned ? ' ✓burned' : ''}`;
    console.log(rowLine([
      r.id,
      r.phase ?? '?',
      r.scope_changes === null ? '—' : r.scope_changes,
      r.revisions || '—',
      r.time_to_stable_days === null ? '—' : `${r.time_to_stable_days}d`,
      oq,
      r.coverage,
    ]));
    if (r.note) console.log(`             ↳ ${r.note}`);
  }
  const partial = rows.filter((r) => r.coverage !== 'full');
  if (partial.length) {
    console.log(`\nℹ ${partial.length} intent(s) marked partial/unknown (see ↳ notes). ` +
      'Numbers degrade honestly — none are fabricated.');
  }
  process.exit(0);
}

// ── golive ────────────────────────────────────────────────────────────────
// Advisory readiness surface for the cross-intent go-live gate (decisions/0040).
// launchpad/deploy-runbook.md carries a "## Go-live gate" section: a checklist of
// prerequisites that must be true BEFORE go-live and that no single intent's
// deployment plan owns — a prod URL/endpoint to swap in, an approval, a token
// rotation, a DNS change. Nothing DEPLOYS these and no test proves them, so
// clearing them is the Trusted Guide's call. But a checklist nobody surfaces is a
// checklist people forget (the reported pain: "nowhere is it gated that I need
// this before go-live"). This lists what's still open so it can't go dark.
// REPORT-ONLY: always exits 0, never gates — go-live accountability is human
// (decisions/0001; same advisory posture as conformance/preflight).
function cmdGolive() {
  let text;
  try { text = readFileSync(RUNBOOK, 'utf8').replace(/\r\n?/g, '\n'); }
  catch {
    console.log(`No ${shown(RUNBOOK)} yet — no go-live gate to check.`);
    console.log('The runbook (seeded by /ql-init-engagement, refreshed by /ql-resync) carries the');
    console.log('"## Go-live gate" checklist; add a prerequisite there the moment you find one.');
    return;
  }
  // Pull the "## Go-live gate" section (its heading → the next "## " heading / EOF)
  // and read GitHub-style task-list checkboxes within it.
  let inGate = false, sectionFound = false;
  const open = [], done = [];
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { inGate = /^go-live gate$/i.test(h[1].trim()); if (inGate) sectionFound = true; continue; }
    if (!inGate) continue;
    const m = line.match(/^\s*[-*]\s*\[([ xX])\]\s*(.+?)\s*$/);
    if (m) (/[xX]/.test(m[1]) ? done : open).push(m[2].trim());
  }
  if (!sectionFound) {
    console.log(`${shown(RUNBOOK)} has no "## Go-live gate" section yet.`);
    console.log('Add one to track prerequisites that gate go-live (a prod URL swap, an approval, a');
    console.log('token rotation) — the things no single intent\'s deployment plan owns.');
    return;
  }
  if (open.length) {
    console.log(`⏳ Go-live gate — ${open.length} prerequisite(s) still open:`);
    for (const item of open) console.log(`   ☐ ${item}`);
    if (done.length) console.log(`\n   (${done.length} already cleared.)`);
    console.log('\nThese gate go-live and are the Trusted Guide\'s to clear. Advisory — nothing is blocked.');
  } else if (done.length) {
    console.log(`✅ Go-live gate — all ${done.length} prerequisite(s) cleared.`);
  } else {
    console.log('Go-live gate section is present but lists no prerequisites yet.');
  }
}

// Dispatch the CLI only when run directly (`node intent-ledger.mjs <cmd>`), not
// when the module is imported for its exported pure functions (unit tests). The
// body below is left at its original indentation to keep this a minimal, reviewable
// diff — the guard is the only structural change. Zero-dep (decisions/0012).
//
// Compare REAL paths, not URLs: Node resolves import.meta.url through symlinks but
// process.argv[1] keeps the symlink path, so a symlinked invocation (this repo uses
// a symlink model for vendored content — see fix-skill-symlinks.mjs) would make the
// two differ and silently no-op the whole CLI (exit 0) — the vacuous-pass a gate
// step must never do. realpathSync both sides so they match through a symlink.
function invokedDirectly() {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false; // argv[1] missing/unreadable → not a direct script run
  }
}
const isMain = invokedDirectly();
if (isMain) {
if (process.argv[2] === 'engagements') {
  const i = process.argv.indexOf('--base');
  cmdEngagements(i !== -1 ? process.argv[i + 1] : null);
}
const taken = takeEngagementArgs(process.argv.slice(2));
if (taken.error) {
  console.error(taken.error);
  process.exit(2);
}
const eng = resolveEngagement({ cwd: process.cwd(), flag: taken.flag, qualified: taken.qualified, env: process.env });
if (eng.error) {
  console.error(eng.error);
  process.exit(2);
}
// File arguments mean what they say where the command ran (a results file the test
// run wrote at the repo root, an upstream JSON next to you), so make them absolute
// before working from inside the engagement folder.
const FILE_ARG_CMDS = new Set(['from-json', 'reconcile']);
for (let i = 0; i < taken.args.length; i++) {
  const a = taken.args[i];
  const isFile = (i === 1 && FILE_ARG_CMDS.has(taken.args[0])) || taken.args[i - 1] === '--results' || (taken.args[i - 1] === '--item' && a !== '-')
    || (taken.args[0] === 'reconcile' && taken.args[i - 1] === '--base') || (taken.args[0] === 'source' && taken.args[i - 1] === '--path');
  if (isFile && a && !a.startsWith('--')) taken.args[i] = resolve(a);
}
if (taken.args[0] === 'where') {
  console.log(join(ENGAGEMENTS_DIR, eng.slug).split(sep).join('/'));
  process.exit(0);
}
LEDGER_FROM_ROOT = `${ENGAGEMENTS_DIR.split(sep).join('/')}/${eng.slug}/${LEDGER}`;
process.chdir(eng.dir);
const args = taken.args;
const [cmd, arg] = args;
const prFlagIdx = args.indexOf('--pr');
const prRef = prFlagIdx !== -1 ? args[prFlagIdx + 1] : undefined;
if (prFlagIdx !== -1 && !prRef) {
  console.error('--pr needs a value:  node launchpad/scripts/intent-ledger.mjs start INT-xxx --pr <ref>');
  process.exit(2);
}
switch (cmd) {
  case 'hash': cmdHash(args.find((a, k) => k > 0 && /^INT-\d+/i.test(a)), { proof: args.includes('--proof') }); break;
  case 'drift': {
    // --only <comma-list> scopes the GATE (what can fail) to those intent ids;
    // drift on any other tracked row is warned, not failed (issue #91). Absent
    // --only → gate every tracked row (default). Present but empty → gate none.
    const onlyIdx = args.indexOf('--only');
    let gatedIds = null;
    if (onlyIdx !== -1) {
      gatedIds = new Set(
        (args[onlyIdx + 1] || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
    }
    cmdDrift(gatedIds);
    break;
  }
  case 'validate': cmdValidate(); break;
  case 'seed': cmdSeed(); break;
  case 'start': cmdStart(arg, prRef); break;
  case 'deliver': cmdDeliver(arg, prRef); break;
  case 'retire': {
    const decIdx = args.indexOf('--decision');
    if (decIdx !== -1 && !args[decIdx + 1]) {
      console.error('--decision needs a value:  node launchpad/scripts/intent-ledger.mjs retire INT-xxx --decision <ref>');
      process.exit(2);
    }
    cmdRetire(arg, decIdx !== -1 ? args[decIdx + 1] : undefined);
    break;
  }
  case 'ratify': {
    const byIdx = args.indexOf('--by');
    if (args.includes('--design')) { cmdRatifyDesign(arg, byIdx !== -1 ? args[byIdx + 1] : undefined); break; }
    const calls = ['--absorbed', '--scope-change'].filter((f) => args.includes(f));
    if (calls.length > 1) {
      console.error('ratify takes one of --absorbed or --scope-change, not both.');
      process.exit(2);
    }
    cmdRatify(arg, byIdx !== -1 ? args[byIdx + 1] : undefined, calls[0]?.slice(2));
    break;
  }
  case 'reverify': {
    const decIdx = args.indexOf('--decision');
    if (decIdx !== -1 && !args[decIdx + 1]) {
      console.error('--decision needs a value:  node launchpad/scripts/intent-ledger.mjs reverify INT-xxx --decision <ref>');
      process.exit(2);
    }
    cmdReverify(arg, decIdx !== -1 ? args[decIdx + 1] : undefined);
    break;
  }
  case 'index': cmdIndex(arg === '--write'); break;
  case 'from-json': {
    const onlyIdx = args.indexOf('--only');
    const only = onlyIdx !== -1
      ? new Set((args[onlyIdx + 1] || '').split(',').map((s) => normId(s.trim())).filter(Boolean))
      : null;
    if (only && !only.size) {
      console.error('--only needs a comma-separated list:  from-json <file> --only INT-001,INT-005');
      process.exit(2);
    }
    const srcIdx = args.indexOf('--source');
    const atIdx = args.indexOf('--at');
    cmdFromJson(arg, args.includes('--force'), only, srcIdx !== -1 ? args[srcIdx + 1] : null, atIdx !== -1 ? args[atIdx + 1] : null);
    break;
  }
  case 'reconcile': {
    const flag = (f) => { const k = args.indexOf(f); return k !== -1 ? args[k + 1] : null; };
    if (args.includes('--source') && !args.includes('--base')) {
      console.log('(No --base given: pass the source at its cursor, from `source show <name> data/intents.json --at cursor`.)');
    }
    cmdReconcile(arg, { source: flag('--source'), baseFile: flag('--base') ? resolve(flag('--base')) : null });
    break;
  }
  case 'summary': cmdSummary(eng.slug, args.includes('--write')); break;
  case 'close': cmdClose(eng); break;
  case 'reopen': { const k = args.indexOf('--decision'); cmdReopen(eng, k !== -1 ? args[k + 1] : undefined); break; }
  case 'tracker-body': cmdTrackerBody(arg, eng); break;
  case 'pull': {
    const f = (x) => { const k = args.indexOf(x); return k !== -1 ? args[k + 1] : undefined; };
    const mode = ['check', 'refresh'].filter((m) => args.includes(`--${m}`));
    cmdPull(arg, f('--item'), mode.length === 1 ? mode[0] : null, f('--tracker'));
    break;
  }
  case 'storage': cmdStorage(arg); break;
  case 'source': cmdSource(args[1], args.slice(2), eng); break;
  case 'brief': {
    const f = (x) => { const k = args.indexOf(x); return k !== -1 ? args[k + 1] : undefined; };
    cmdBrief(arg, eng, { for: f('--for'), agent: f('--agent'), recommended: f('--recommended') });
    break;
  }
  case 'stamp': { const k = args.indexOf('--in'); cmdStamp(arg, k !== -1 ? args[k + 1] : null); break; }
  case 'next-id': {
    const f = (x) => { const k = args.indexOf(x); return k !== -1 ? args[k + 1] : undefined; };
    cmdNextId(args[1], args[2], { date: f('--date'), commit: f('--commit') });
    break;
  }
  case 'signoff': {
    const f = (x) => { const k = args.indexOf(x); return k !== -1 ? args[k + 1] : undefined; };
    cmdSignoff(args[1], args[2], { by: f('--by'), verdict: f('--verdict'), report: f('--report'), date: f('--date'),
      verify: f('--verify'), detail: f('--detail'), deferredTo: f('--deferred-to'), append: args.includes('--append') });
    break;
  }
  case 'new': {
    const flag = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
    const phaseVal = flag('--phase');
    cmdNew({
      id: flag('--id'),
      phase: phaseVal !== undefined ? Number(phaseVal) : undefined,
      title: flag('--title'),
      epic: flag('--epic'),
      fetch: !args.includes('--no-fetch'),
    });
    break;
  }
  case 'currency': {
    const curId = args.slice(1).find((a) => /^INT-\d+/i.test(a));
    cmdCurrency(curId, { json: args.includes('--json'), fetch: !args.includes('--no-fetch') });
    break;
  }
  case 'regression': {
    const bi = args.indexOf('--base');
    cmdRegression(bi !== -1 ? args[bi + 1] : null);
    break;
  }
  case 'sync': {
    cmdSync();
    break;
  }
  case 'coverage': {
    const resIdx = args.indexOf('--results');
    // The id filter is a bare INT-NNN argument — not the --results value, which
    // can itself start with INT- (`--results INT-001-results.json`).
    const covId = args.find((a, k) => k > 0 && k !== resIdx + 1 && /^INT-\d+$/i.test(a));
    if (resIdx !== -1 && !args[resIdx + 1]) {
      console.error('--results needs a file:  node launchpad/scripts/intent-ledger.mjs coverage --results <test-results.json>');
      process.exit(2);
    }
    cmdCoverage(covId, args.includes('--gate'), {
      resultsFile: resIdx !== -1 ? args[resIdx + 1] : undefined,
      testsComplete: args.includes('--tests-complete'),
    });
    break;
  }
  case 'preflight': {
    const pfId = args.slice(1).find((a) => /^INT-\d+/i.test(a));
    cmdPreflight(pfId);
    break;
  }
  case 'verify': {
    const vId = args.slice(1).find((a) => /^INT-\d+/i.test(a));
    const rIdx = args.indexOf('--results');
    cmdVerify(vId, rIdx !== -1 ? args[rIdx + 1] : undefined);
    break;
  }
  case 'conformance': {
    const confId = args.slice(1).find((a) => /^INT-\d+/i.test(a));
    cmdConformance(confId);
    break;
  }
  case 'decisions': cmdDecisions(args.slice(1).find((a) => /^INT-\d+/i.test(a))); break;
  case 'outcomes': {
    const f = (x) => { const k = args.indexOf(x); return k !== -1 ? args[k + 1] : undefined; };
    cmdOutcomes(arg, { kind: f('--kind'), redRuns: f('--red-runs'), reviewRounds: f('--review-rounds') });
    break;
  }
  case 'metrics': {
    if (args.includes('--by-agent')) { cmdMetricsByAgent(args.includes('--json')); break; }
    const mId = args.slice(1).find((a) => /^INT-\d+/i.test(a));
    cmdMetrics(mId, { json: args.includes('--json') });
    break;
  }
  case 'golive': cmdGolive(); break;
  default:
    if (cmd) console.error(`Unknown command: ${cmd}. If a skill told you to run it, the skills may be newer than this script: run /ql-resync.`);
    console.error('Usage: node launchpad/scripts/intent-ledger.mjs <command> [--engagement <slug>]');
    console.error('  where                       print the active engagement folder (launchpad/engagements/<slug>)');
    console.error('  summary [--write]           the factual half of SUMMARY.md at close: where every intent ended (never overwrites)');
    console.error('  source <tie|list|show|status|ack|retire> <name>  tied Scopezilla projects, read in place (decisions/0082)');
    console.error('  brief INT-xxx [--for session|hosted] [--agent <name>] [--recommended <name>]');
    console.error('                              the build brief, from ratified sources, stamped; hosted refuses unratified/stale inputs');
    console.error('  outcomes INT-xxx --kind <kind> --red-runs <n> --review-rounds <n>  close-out counts into the build note');
    console.error('  stamp INT-xxx --in design|test-script  write the current scope/proof hash into the file');
    console.error('  next-id bld | criterion|defect|report INT-xxx  the next id or filename, collision-safe');
    console.error('  signoff INT-xxx INT-xxx-Cy --by <name> --verdict pass|fail|not-run|blocked --report <file>');
    console.error('                              | --verify green|refutes|not-verified   write a Sign-off cell coverage parses');
    console.error('  engagements [--base <ref>]  repo-level: the engagements CI gates for this PR, one per line;');
    console.error('                              fails if the PR changes a closed (frozen) engagement');
    console.error('  Runs against one engagement under launchpad/engagements/<slug>/: --engagement, a qualified');
    console.error('  id (acme-2026/INT-001), LAUNCHPAD_ENGAGEMENT, .launchpad/local.json, or the only one there.');
    console.error('  hash [INT-xxx] [--proof]    print the scope hash (ledger); --proof prints the proof hash a test script stamps');
    console.error('  drift [--only <ids>]        report delivered intents whose scope hash no longer matches');
  console.error('                              (--only INT-001,INT-005 gates just those; others warn — CI scoping)');
    console.error('  validate                    check every intent file parses & is well-formed (CI gate)');
    console.error('  seed                        print a fresh ledger table (one row per intent)');
    console.error('  start INT-xxx [--pr <ref>]  flip one intent\'s row to 🔧 In progress (idempotent; won\'t reopen delivered)');
    console.error('  deliver INT-xxx [--pr <ref>]  flip a row to ✅ Delivered, stamp the current scope hash, refresh the index (atomic)');
    console.error('  retire INT-xxx [--decision <ref>]  flip a row to 🚫 Retired (de-scoped): clears the scope hash, records the');
    console.error('                              decision ref in Evidence, refreshes the index. Excluded from drift/coverage. (#139)');
    console.error('  ratify INT-xxx --by "<name>" [--absorbed|--scope-change]  record that the Trusted Guide stands behind');
    console.error('                              this intent (frontmatter `ratified:`, bound to the current scope hash); on a');
    console.error('                              refinement, add their call. deliver refuses a draft or stale ratification;');
    console.error('                              start warns.');
    console.error('  reverify INT-xxx [--decision <ref>]  flip a ✅ Delivered row to 🔄 Needs re-verify after its scope moved;');
    console.error('                              keeps the hash + PR. drift treats it as acknowledged until `deliver` re-stamps.');
    console.error('  index [--write]             render the README delivery index (--write splices it into README.md)');
    console.error('  coverage [INT-xxx] [--gate] [--results <file>] [--tests-complete]');
    console.error('                              report test-script coverage/drift per intent (--gate fails on Delivered gaps).');
    console.error('                              --results cross-checks each ✅ criterion\'s named test against an sf');
    console.error('                              --json / JUnit results file (red = fail; absent = warn, or fail with --tests-complete).');
    console.error('  verify INT-xxx --results <file>  record an org-probe run (/ql-verify-build): write a commit-pinned');
    console.error('                              test-evidence/{date}-{commit}-org-probe.md from the structural verdicts.');
    console.error('                              Advisory (decisions/0031) - always exits 0, never gates.');
    console.error('  preflight INT-xxx           close-out readiness readout BEFORE you stamp: coverage + drift in one call,');
    console.error('                              ready-to-deliver or the hold reason. Advisory — always exits 0, never gates.');
    console.error('  conformance [INT-xxx]       REPORT traceability: (1) per-intent grounding (requirement/architecture');
    console.error('                              link), flags any Delivered intent with no grounding; (2) architecture-ADR');
    console.error('                              conformance — declared deviations (a build ADR superseding an inherited');
    console.error('                              premise), pending-ARB loud vs accepted quiet. Never gates.');
    console.error('  decisions [INT-xxx]         the decision records that bear on an intent: binding (premises + records');
    console.error('                              it cites), pending + ratified rulings, history (capped); intent governs. No id: one-line');
    console.error('                              index of every record. Advisory (decisions/0075) — never gates.');
    console.error('  from-json <file> [--force] [--only INT-001,…]  transform raw upstream intents JSON → intents/INT-NNN/intent.md');
    console.error('                              (--only scopes the write — and --force — to the named intents)');
    console.error('  reconcile <file>            3-way divergence report on re-ingest (read-only, never clobbers)');
    console.error('  new [--id INT-NNN] [--phase N] [--title ..] [--epic ..] [--no-fetch]  scaffold a new local intent (collision-safe id; origin: local, draft)');
    console.error('  currency [INT-xxx] [--json] [--no-fetch]  is my branch/this intent behind the shared branch? (warn, never block)');
    console.error('  regression [--base <ref>]   does this branch REMOVE a ✅ Delivered stamp the base already has?');
    console.error('                              catches the stale-branch clobber (CI gate; exits 1 on regression)');
    console.error('  sync                        open a ⬜ row for any intent missing one, re-derive the footer +');
    console.error('                              README index (the self-heal for what `validate` reports)');
    console.error('  golive                      list still-open prerequisites in the deploy-runbook\'s "## Go-live gate".');
    console.error('                              Advisory (decisions/0040) — always exits 0, never gates.');
    console.error('  close | reopen --decision <f> mark the engagement closed (after summary --write) or open again');
    console.error('  tracker-body INT-xxx        the summary, label and body to write to the tracker (snapshot mode)');
    console.error('  pull INT-xxx --item <f|-> --check|--refresh   write the tracker copy into intent.md; --check');
    console.error('                              refuses unless it re-hashes to the draft (decisions/0083)');
    console.error('  storage repo|snapshot       switch where intent content lives; into snapshot needs every intent pulled');
    console.error('  metrics [INT-xxx] [--json]  within-engagement delivery signals from git history: scope churn,');
    console.error('                              revisions, time-to-stable, open-question trajectory. Honest by contract');
    console.error('                              (partial/unknown, never a wrong number). Read-only (decisions/0043).');
    if (cmd) {
      console.error('');
      console.error(`If "${cmd}" isn't listed above, this engine script may be behind the skills that call it.`);
      console.error('Run /ql-resync to pull the current launchpad/scripts/intent-ledger.mjs into this repo.');
    }
    process.exit(2);
}
}

// Pure core, exported for unit testing (the seam; decisions/0012 keeps this zero-dep).
// Importing this module has no side effects — the CLI dispatch above is main-guarded.
export {
  parseIntentFile, scopeHash, legacyScopeHash, proofHash, serializeIntent, parseLedgerText,
  hashScopeFields, reconcileHash, SCOPE_FIELDS, parseDecisionNote, citedDecisionRefs,
  takeEngagementArgs, resolveEngagement,
};
