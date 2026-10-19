---
name: ql-close-engagement
disable-model-invocation: true
description: Close a finished engagement, freezing its trust chain as the audit record with a generated SUMMARY.md, or reopen a closed one.
produces: >-
  For a close, launchpad/engagements/<slug>/SUMMARY.md (generated lists plus the Trusted Guide's narrative) and status closed in that engagement's profile, ready for one close PR. For --reopen, a dated reopen decision record and status open. Never moves or deletes an intent.
---

# Close an engagement — freeze its trust chain as the audit record

An org repo outlives the engagements in it (`decisions/0082`). When one ends, closing it keeps everything it proved (intents, ledger, test evidence, decisions) exactly where it is, adds a `SUMMARY.md`, and marks it `closed`. From then on CI skips its trust chain and **fails any PR that changes it**, so the record can't drift. Reopening is the one way back.

Closing is the Trusted Guide's call: they answer for what the engagement delivered. You prepare it, show what's still open, and do the mechanical steps on their say-so.

## Step 1 — Which engagement

```bash
node launchpad/scripts/intent-ledger.mjs where
```

Confirm the slug with the user by name ("Close **acme-2026**?"). If the repo has several open engagements and none is named, ask which.

`--reopen` skips to Step 6.

## Step 2 — Show where everything ended

```bash
node launchpad/scripts/intent-ledger.mjs summary --engagement <slug>
node launchpad/scripts/intent-ledger.mjs coverage --gate --engagement <slug>
node launchpad/scripts/intent-ledger.mjs drift --engagement <slug>
```

Lead with what's still open: the summary's **Open at close** rows, any 🔄 Needs re-verify, any 👁 criterion awaiting sign-off, and a coverage or drift failure. Then the counts.

## Step 3 — Disposition every open item, with the Trusted Guide

Each open item gets one answer, recorded where it belongs, before the close:

- **Retire it.** It won't be built here. `/ql-refine-intent` retires it with a decision ref, in its own PR.
- **Carry it forward.** A later engagement will pick it up. Capture it into that engagement's `intents/BACKLOG.md` (`/ql-capture-intent`), and say so in the narrative.
- **Leave it open, on the record.** It stays in **Open at close**, and the narrative says why.

An 🔧 In progress row or a failing gate needs the Trusted Guide to say plainly that they're closing anyway. Name it back to them. A frozen engagement can't be fixed later without reopening it.

## Step 4 — Write SUMMARY.md

```bash
node launchpad/scripts/intent-ledger.mjs summary --write --engagement <slug>
```

The lists are generated and never hand-edited. Draft the narrative between the `SUMMARY:NARRATIVE` markers with the Trusted Guide: what the engagement set out to do, what shipped, what didn't and why, and anything the next team in this org should know. Keep it short and all-business, under the dirty-source membrane and `launchpad/prose-style.md`. The Trusted Guide approves the wording.

## Step 5 — Mark it closed

```bash
node launchpad/scripts/intent-ledger.mjs close --engagement <slug>
```

It refuses until `SUMMARY.md` exists, sets `status: closed` and `closed_at`, and drops the engagement as this machine's active one.

Commit `SUMMARY.md` and `engagement.json` together as **one close PR** with nothing else in it. CI accepts the change that closes an engagement, and nothing after it. Tell the user that merging it is the accountable act.

## Step 6 — Reopen (`--reopen`)

Ask the Trusted Guide why it's reopening: a late defect, a change order, a missed criterion. Record it in the engagement's own `decisions/YYYY-MM-DD-reopen.md` (copy `launchpad/decisions/TEMPLATE.md`). Then:

```bash
node launchpad/scripts/intent-ledger.mjs reopen --engagement <slug> --decision decisions/YYYY-MM-DD-reopen.md
```

It refuses without the record, and sets `status` back to `open`.

Keep `SUMMARY.md`: it's the record of the first close. Put the reopen record and the profile change in their own PR (CI fails a reopen bundled with other changes); the work the reopen is for goes in later PRs, once it's open on the shared branch.

## What this does NOT do

- Move, archive or delete anything.
- Close on the agent's own judgment, or treat an open item as settled because it's old.
- Regenerate `SUMMARY.md` over an existing one. The engine refuses.
- Edit anything outside the engagement's folder, except clearing `active_engagement` from the gitignored `local.json`.
