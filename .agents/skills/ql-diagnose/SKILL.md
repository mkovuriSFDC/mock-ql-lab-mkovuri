---
name: ql-diagnose
description: >-
  Diagnose a build that doesn't satisfy its intent: get a signal that goes red on THIS bug before theorising, fix until green, then lock it with a regression criterion. Use when a build, a test, or org behavior is wrong, flaky, or misses an intent's acceptance (a defect to fix; editing the intent is /ql-refine-intent). Triggers — "diagnose this", "why is this failing", "the implementation doesn't match the intent", "it's intermittent", "/ql-diagnose".
produces: >-
  No artifact of its own — a reproducing signal, a fix, and a NEW regression criterion added to the intent's `test-script.md` (an `INT-00x-Cy` row or an `## Org assertions` predicate) so the bug is proven closed henceforth. When the bug surfaced in manual QA, drafts/updates the defect record for `/ql-record-test-execution`. No commit.
---

# Diagnose — reproduce it before you fix it

A build that doesn't satisfy an intent is a **trust-chain break**: a proof criterion that reads ✅ but doesn't hold, a Flow that fires wrong, sharing that doesn't cascade, a governor limit that trips at bulk. Fixing it by guessing is how the same bug comes back at UAT. This skill imposes one discipline: **no theory until you have a signal that goes red on *this* bug** — then fix until it goes green, and leave a regression criterion behind so it stays fixed.

It's the diagnosis discipline the build loop otherwise lacks — the step between "the org/test is wrong" and `/ql-record-test-execution` (which *records* a proven defect). This skill *finds* the cause; that one documents it.

## The rule: get the loop red first

Before proposing any cause, build the **tightest feedback loop** you can — one command or query that **already fails on this exact bug**, and would pass if it were fixed. Reading code to theorise is slower and wronger than watching a signal. If you can't yet make something go red on the bug, that *is* the first task; don't skip to a fix.

## Step 1 — Reproduce it

Reach for the cheapest signal that reproduces the bug. A failing test is the gold standard: it's the loop *and* the eventual regression criterion. When a test is too heavy, probe the org state or read the logs, with whatever your Salesforce build toolkit offers for it; this skill owns the discipline, your toolkit owns the debugging moves.

A bug you can't yet reproduce is not yet diagnosed — say so rather than guessing.

## Step 2 — Narrow to the cause with the loop, not by reading

With a red signal in hand, change one thing at a time and re-run it. Let the loop — not a theory — tell you when you've found the cause. Ground any platform mechanic you're unsure of in the docs (AGENTS.md → *don't build Salesforce from memory*).

## Step 3 — Fix, and watch the loop go green

Apply the fix and confirm the same signal that went red now passes. A fix that doesn't turn your reproducing signal green isn't confirmed — it's another theory.

## Step 4 — Lock it down: mint a regression criterion

A fix without a regression check is unproven the moment the next build lands. Leave the bug **provable henceforth**:

- Add a criterion to the intent's `intents/INT-00x/test-script.md` that fails on this bug — an `INT-00x-Cy` row backed by the Apex test from Step 1 (✅), or an `## Org assertions` predicate for a structural bug (`org-probe`, verified by `/ql-verify-build`). Re-run `/ql-test-script` or add the row directly; the id is the join key across the ledger and the PR §2 matrix.
- When the bug **surfaced in manual QA**, this is the diagnosis upstream of `/ql-record-test-execution`: draft or update `test-evidence/defect-INT-00x-NN.md` (expected vs. actual + the repro you found) and, once the retest passes, that skill closes it.

The regression criterion is what turns "I fixed it" into "it's proven fixed" — the same *shipped = proven* bar the whole trust chain holds.

## What this does NOT do

- It does **not** fix by theory. No proposed cause without a signal that reproduces the bug first.
- It does **not** edit the intent's scope. If diagnosis reveals the *intent* is wrong (the acceptance asked for the wrong thing), route to `/ql-refine-intent` — a bug in the build and a bug in the scope are different repairs.
- It does **not** sign off the fix. The regression criterion proves it; a human still ratifies delivery (`/ql-record-test-execution` for the 👁 half, CI/`/ql-verify-build` for the ✅ half).
- It is **not** a general profiler or a tech-debt sweep — it diagnoses a specific bug against a specific intent.
