# Engagement kickoff — PTSF Patient Travel Platform

**Date:** 2026-10-19
**Source:** ptsf-scoping-2026 (Scopezilla project ptsf-lab), reviewed at 8eb2432b0381

## Context

PTSF is moving its patient travel-subsidy process off separately customized office systems onto one Salesforce platform. Patients register, onboard, and apply for travel support. Each application is checked against insurance cover and allocated to the nearest registered practitioner for a medical assessment. Assessors then recommend and approve a subsidy. Success is measured per phase: Mobilize closes the blocking gaps and provisions the pipeline. Platform Foundations proves the medical-history access rules, ownership pools, and sign-in for staff and patients. Patient Journey runs register → onboard → apply → insurance check → allocation end to end in UAT. The later phases carry the practitioner and assessor journey, migration and scale validation, and cutover. The source's phase files hold the full measures.

## Choice

- **Quantum Leap blueprint:** Mixed / multi-cloud
- **Clouds in scope:** Agentforce, Experience Cloud, Service Cloud
- **Target org:** `PTSF Lab Sandbox` (sandbox; build_allowed=true)
- **Phase plan:** 6 phases over 43 weeks
- **Depth mode:** epic-level

## Consequences (cross-cutting commitments)

- One global production org for all three regions (adopted as `launchpad/decisions/architecture/0001-single-global-org.md`).
- Medical history isolated on its own record, Private for internal and external users, owned by a system owner pool, with time-bound practitioner access and a named break-glass list (source decision 0002; not adopted as an engagement record, read as context).
- Health Cloud is not used; Service Cloud plus two Experience Cloud sites (patient, practitioner) on LWR.
- Patients are Person Accounts on the high-volume Customer Community license; practitioners are contacts under practice accounts on Customer Community Plus.
- The subsidy application is a custom object, not a Case; Case is reserved for support inquiries.
- Staff sign in through SAML single sign-on against three regional directories; patients through email/password or Facebook.
- Record ownership is spread across office owner pools; no owner exceeds 10,000 records per object.
- Source-driven delivery through Integration → UAT → Staging → Production; masked or synthetic data in every non-production org.

These were locked during scoping. Do not re-litigate; surface them as constraints to the build agent.
