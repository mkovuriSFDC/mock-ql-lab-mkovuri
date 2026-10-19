# Launchpad

Everything the Quantum Leap Launchpad keeps in this repo lives in this folder, so it never mixes with the rest of the codebase.

- `engagements/<slug>/` holds one engagement each: its intents, delivery ledger and test evidence, its own decisions, and a `README.md` with the delivery index. An engagement that has closed stays here, frozen, as the audit record.
- `decisions/` holds records that apply to the whole org. `decisions/architecture/` holds the standing premises every engagement builds on.
- `build-notes.md` and `deploy-runbook.md` describe this org, so every engagement shares them.
- `scripts/` is the engine CI runs to prove the trust chain. `/ql-resync` keeps it current; don't edit it by hand.
- `REVIEW.md` is how build PRs are reviewed. `prose-style.md` is the writing standard for intents, decisions and PRs.
