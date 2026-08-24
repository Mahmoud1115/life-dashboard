---
name: life-os-storage-migration
description: Independently review Dune Life OS storage migrations using docs/lifeos/STORAGE_MIGRATION.md. Use for changes involving localStorage, dune_state_v4, import/export, snapshots, canonical-source changes, or Supabase migrations.
---

# Life OS storage migration — Codex wrapper

Independent, adversarial storage-migration review for a Dune Life OS change. Purpose is to challenge the migration author's assumptions — not to defer to them.

## Step 1 — Load context

Read in order, do not skip:

1. `AGENTS.md` — Codex's project instructions and hard rules
2. `docs/lifeos/PROJECT.md`
3. `docs/lifeos/ARCHITECTURE.md`
4. `docs/lifeos/STORAGE_MAP.md` — the current source of truth for per-domain ownership
5. `docs/lifeos/DECISIONS.md` — especially ADR-006 (migration direction), ADR-003 (`qatarVisit` retention), ADR-005 (BHT AI key), ADR-007 (branch hygiene)
6. `docs/lifeos/STORAGE_MIGRATION.md` — the authoritative 14 required fields, one-domain-per-commit rule, invariants requirement, dual-write handling, safe-context rule for export/restore testing, and merge gate

## Stance — adversarial by default

Assume the migration author may have:

- Gotten the current canonical source wrong (e.g., claimed Gen-2 when the write path is still Gen-1)
- Claimed idempotency without testing what happens on the second run
- Covered "empty / partial / full / already-migrated" but skipped the older-schema or malformed-parseable cases
- Silently cleaned up an unrelated legacy key in the same commit
- Described a rollback path that was never actually tested
- Proposed export/restore validation against real user storage instead of an isolated context
- Invented default values to satisfy validation — a data-loss defect dressed as a success
- Stated invariants that field 14 (Validation) doesn't actually verify
- Underestimated dual-write drift because "the bridge always fires"

Do not accept "the author checked" — reproduce every claim against the current tree.

## Step 2 — Establish scope

Confirm what is being reviewed:

- A migration proposal (report only, no code yet)?
- An in-progress diff (`git diff`, `git diff --staged`, `git diff main..HEAD`)?
- A PR by number or URL?
- A specific domain fold (which one, per `STORAGE_MAP.md`)?

If more than one domain is touched in a single commit, that's an ADR-006 violation on its face — flag before running the rest of the checklist.

## Step 3 — Verify current state via grep

Before trusting the migration report's **Before** section, verify each claim yourself:

- Grep for reads and writes to the claimed current source(s) — cite current file:line
- Grep for `BACKUP_KEYS`, `getAllBackupData`, `processImport` to see how the domain currently flows through export/restore
- Read the current Store slice in `core.js` if Gen-2 is involved
- Confirm the domain's row in `STORAGE_MAP.md` is still accurate — if the map drifted from reality, flag as a blocking issue (per `STORAGE_MIGRATION.md`'s rules, the map must be corrected first in a separate commit)

## Step 4 — Attack the migration report

For each of the 14 required fields in `docs/lifeos/STORAGE_MIGRATION.md`, hunt for the failures the author may have missed:

- **Fields 2, 3, 6** (current sources, canonical): does the author's claim match what grep says right now?
- **Field 8** (transformation): does the before/after example use synthetic data, and is the transformation deterministic?
- **Field 9** (invariants): are they stated, and does field 14 verify each one — or is verification hand-waved?
- **Field 10** (compatibility): all six cases addressed (empty / partial / full / already-migrated / older-schema / malformed-parseable)? Does the malformed-parseable case fail safely, or does it invent user data?
- **Field 11** (export/restore impact): are pre-migration exports still restorable, or is a forward-compat path documented?
- **Field 12** (rollback/recovery): was the rollback tested end-to-end, or only described?
- **Field 13** (data-loss risks): any scenario the author overlooked — partial browser-storage failure, quota overflow, interrupted save, stale/offline device state later reconnecting or being restored?
- **Field 14** (validation): were tests run in an isolated context (separate browser profile, localhost origin, disposable environment) — or against the user's real storage?

## Step 5 — Attack the commit structure

- **One domain per commit** — does the diff modify only the target domain, or does it silently touch legacy keys / `BACKUP_KEYS` / `processImport()` handling for other domains?
- **Legacy-source retention (default)** — is the old source retained in this commit? If not, does the PR claim the same-commit atomic cutover exception with all four conditions met (dual-write demonstrably riskier, operation transactional/reversible, recovery tested, reviewer explicitly names the exception)? Current Gen-1 → Gen-2 client-storage folds do NOT qualify.
- **Dual-write divergence detection** — if the transition period will have both sources live, is there a real detection mechanism (validation on load, periodic reconciliation, console warning on mismatch), or is it "trust the bridge"?

## Step 6 — Report

Output the completed migration-report review, plus:

- **Blocking issues** — anything missing, unverified, or in violation of the one-domain rule / no-silent-cleanup rule / invariants requirement / safe-context rule / dual-write divergence detection
- **Non-blocking observations** — potential improvements, follow-ups worth filing separately
- **Merge gate footer** with the author-attribution rule below

## Step 7 — Independent-review footer

State explicitly whether this Codex review satisfies the "independent review" requirement in `CLAUDE.md` / `AGENTS.md`:

- Claude-authored migration → this Codex review can serve as independent review.
- **Codex-authored migration → this Codex review does NOT count as independent review.** Another Codex session is still Codex; the merge requires Claude Code review or a human maintainer.
- Human-authored migration → both Claude and Codex reviews are equally independent.

State the author-attribution assumption used.

## Boundaries

- Review and planning focused. Do not implement or modify the migration. If asked to implement, stop and confirm scope with the human first.
- Never modify `STORAGE_MAP.md` inline as part of a migration review — corrections to the map are a separate commit that precedes any migration.
- Never propose test steps that would clear the user's real production storage without the explicit-authorization flow required by `STORAGE_MIGRATION.md`.
- Do not spawn a second Codex session to "double-check" a Codex-authored migration and treat the result as independent — see the footer rule above.
- Do not commit, push, or merge anything.
- Cite `docs/lifeos/STORAGE_MIGRATION.md`, `STORAGE_MAP.md`, and any relevant ADRs by pointer; do not restate the standard in the review output.
- If any check fails, surface the failure explicitly — do not paper over.
