---
name: life-os-storage-migration
description: Project-specific storage-migration standard for the Dune Life OS dashboard. Runs the shared checklist and required-fields template in docs/lifeos/STORAGE_MIGRATION.md against a proposed or in-progress migration. Use when a change touches localStorage, the Store schema (dune_state_v4), BACKUP_KEYS, processImport, snapshots, a Supabase migration, or the canonical write source for any domain.
---

# Life OS storage migration — Claude wrapper

Runs the shared Life OS storage-migration standard against a proposed or in-progress migration. The standard itself lives in `docs/lifeos/STORAGE_MIGRATION.md` so Codex and human reviewers use the same checklist.

## Step 1 — Load context

Read in order, do not skip:

1. `docs/lifeos/PROJECT.md`
2. `docs/lifeos/ARCHITECTURE.md`
3. `docs/lifeos/STORAGE_MAP.md` — the current source of truth for per-domain ownership
4. `docs/lifeos/DECISIONS.md` — especially ADR-006 (migration direction), ADR-003 (`qatarVisit` retention), ADR-005 (BHT AI key), ADR-007 (branch hygiene)
5. `docs/lifeos/STORAGE_MIGRATION.md` — the required-fields template, one-domain-per-commit rule, invariants requirement, dual-write handling, safe-context rule for export/restore testing, and merge gate this work must follow

## Step 2 — Establish scope

Confirm what is being reviewed or planned before touching any code:

- A migration proposal (no code yet — just the plan)?
- An in-progress diff (`git diff`, `git diff --staged`, `git diff main..HEAD`)?
- A PR by number or URL?
- A specific domain fold (which one, per `STORAGE_MAP.md`)?

If the scope is unclear, ask before proceeding. Do not guess. If more than one domain is involved in a single commit, flag that against ADR-006 (one domain per commit) before doing anything else.

## Step 3 — Verify current state via grep

Every field in the migration report must be grounded in code you verified now — not in `STORAGE_MAP.md`'s snapshot. For the target domain:

- Grep for reads and writes to the current source(s) — cite current file:line
- Grep for `BACKUP_KEYS`, `getAllBackupData`, `processImport` to see how the domain appears in export/restore paths
- Read the current Store slice definition in `core.js` if Gen-2 is involved
- Confirm the domain's row in `STORAGE_MAP.md` is still accurate — flag drift if not

## Step 4 — Fill or check the migration report

The proposal (or the diff being reviewed) must have a completed report matching the template in `STORAGE_MIGRATION.md`. Sections: Before / Change / Invariants / Compatibility / Validation / Recovery / Merge gate.

- If planning: draft the report against the current state.
- If reviewing: verify every field is filled and every claim is grounded in the diff.

An incomplete report blocks progression.

## Step 5 — Run the acceptance checks

Against the report and the diff (or plan), verify:

- **One domain only** per commit — no unrelated cleanup, no legacy-key removals for other domains.
- **Legacy source retention (default)**: legacy source retained in this commit; removal is a separate future commit gated on the four preconditions in `STORAGE_MIGRATION.md`. If a **same-commit atomic cutover** is proposed, verify all four exception conditions are met and the independent reviewer has explicitly named the exception in the PR.
- **Migration invariants stated explicitly**, and Validation verifies each one.
- **Compatibility cases cover all six**: empty / partial / full / already-migrated / older-schema / malformed-parseable. The malformed-parseable case must have an explicit fail-safe behavior — the migration never invents user data to fill gaps.
- **Dual-write / divergence explicitly handled** with a real detection mechanism if both sources exist during transition.
- **Export/restore round-trip run in an isolated test context** (separate browser profile, localhost test origin, or disposable environment) against synthetic data. Never automatically against the user's real production storage. Clearing real storage requires explicit authorization + verified fresh backup + confirmed restorability before the clear.
- **Synthetic-data-first**: real user data does not appear until after synthetic tests pass, and only at an explicit user checkpoint.
- **Supabase environment claims** don't assume plan-specific features (branching, PITR, etc.) without verification; the standard requires an "available isolated environment," not a specific one.
- **Rollback path documented and tested**, not merely claimed.

## Step 6 — Report

Output the completed migration report, plus:

- **Blocking issues** — anything missing, unverified, or in violation of the one-domain rule / no-silent-cleanup rule / invariants requirement / safe-context rule.
- **Non-blocking observations** — potential improvements, follow-ups worth filing separately.
- **Merge gate** — state whether independent Codex / ChatGPT / human review is still required before merge (it usually is, per CLAUDE.md and AGENTS.md; this skill is a local first-pass, not the independent review itself).

## Boundaries

- Review and planning focused. Do not implement the migration unless the user explicitly asks. If asked to implement, still stop after the report and confirm scope before writing code.
- Never modify `STORAGE_MAP.md` inline as part of a migration commit — corrections to the map are a separate commit that precedes any migration.
- Never propose test steps that clear the user's real production storage without the explicit-authorization flow above.
- Do not commit, push, or merge anything.
- If any check fails, do not paper over it — surface the failure explicitly and stop.
