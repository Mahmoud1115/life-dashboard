# Life OS storage migration — shared standard

The project-specific storage-migration standard for the Dune Life OS repository. Usable by any author or reviewer — Claude, Codex, or a human maintainer. Not AI-specific.

**Scope**: any change that moves data between storage sources — Gen-1 flat `localStorage` keys, the Gen-2 reactive `Store` (`dune_state_v4`), rolling snapshots (`dune_snapshots_v1`), Gist export payloads, or (later) Supabase tables. Also covers Store schema-version migrations (`SCHEMA_VERSION` bumps + `migrateUp()`).

**Non-goals**: purely additive changes that don't touch existing storage (e.g., a new UI-only feature reading from an already-canonical source); style or performance changes; feature design.

## Prerequisites

Before proposing or reviewing a migration, know the current state of:

1. `PROJECT.md` — principles, especially "preserve the working system" and "incremental only"
2. `ARCHITECTURE.md` — the two storage generations, sync flow, Store `validate()` / `migrateUp()` mechanics
3. **`STORAGE_MAP.md` — the canonical current source of truth for per-domain read/write ownership.** Every migration proposal starts from this map.
4. `DECISIONS.md` — active ADRs, especially ADR-006 (Gen-1 → Gen-2 → Supabase direction), ADR-007 (branch hygiene), ADR-003 (`qatarVisit` must not be removed from Store), ADR-005 (BHT AI key handling), ADR-008 (public-repo hygiene)

Do not duplicate content from those docs. Cite by pointer.

## Locating code

Do not trust line numbers from any Life OS document. Verify current locations via `grep -n` and cite what you find *now*.

## What counts as a migration

Any of the following triggers this standard:

- Moving a domain's write-authoritative source from one storage to another (Gen-1 → Gen-2, Gen-2 → Supabase, etc.)
- Changing the shape of an existing Store slice (rename, restructure, split, merge)
- Bumping `SCHEMA_VERSION` and adding a `migrateUp()` step
- Adding or removing entries in `BACKUP_KEYS`
- Changing what `getAllBackupData()` collects or what `processImport()` writes
- Changing the format or scope of `dune_snapshots_v1`
- Any Supabase schema or destructive data migration once Supabase exists

## Required fields for every migration

Every migration proposal must document all fourteen fields before implementation begins. Missing fields = incomplete proposal, review blocked.

1. **Domain** — Money / EASA / Goals / Logbook / Apartments / etc.
2. **Current read source(s)** — the storage location(s) code currently reads from for this domain
3. **Current write source(s)** — the storage location(s) code currently writes to for this domain
4. **Current backup/export path** — whether this data is included in `BACKUP_KEYS`, how it appears in a Gist backup, whether it's covered by rolling snapshots
5. **Gen-1 / Gen-2 ownership** — where the domain currently sits per `STORAGE_MAP.md`
6. **Current canonical source** — which source is ground truth today (may differ from write source if there's mirroring)
7. **Target canonical source** — what becomes ground truth after the migration
8. **Migration transformation** — the exact shape change, key rename, or move that the migration performs. Include a concrete before/after example using synthetic (never real) values.
9. **Migration invariants** — the specific properties of the domain's data that must remain true both *before and after* the migration. Every migration has invariants; if the author cannot state any, the migration has not been thought through. Examples of the *kind* of invariant to state (specific list depends on the domain):
   - Total record count is preserved (except where the transformation explicitly folds or splits records — state the exception).
   - Ordering is preserved where the UI relies on it.
   - No field's value is silently synthesized to a default when the source had `null` or `undefined` — missing data stays missing; the migration must never invent values.
   - Monotonic properties (timestamps, `SCHEMA_VERSION`, snapshot count) are not decreased.
   - Backward-compatibility guarantees stated in prior ADRs still hold.
   Field 14 (Validation) must explicitly verify each stated invariant — invariants are enforced, not guidance.
10. **Compatibility with old data** — how the migration handles existing user data written under the old shape. Must handle all six cases:
    - Empty state.
    - Partially-populated state.
    - Fully-populated state.
    - State already migrated (idempotency — running the migration twice must be a no-op the second time).
    - **Older supported schema** — data produced by earlier `SCHEMA_VERSION` values in the `migrateUp()` chain. Users can restore old exports; the migration must not assume the immediately-preceding schema is the only prior state.
    - **Malformed / corrupt-but-parseable state** — JSON that parses but has missing required fields, unexpected types, or values outside expected ranges. The migration must **fail safely** — either refuse the migration with a clear error and leave the source untouched, or migrate only the fields that are recoverable and mark the rest explicitly missing. **It must never invent user data** (default values, plausible guesses, "cleanup" heuristics) to fill gaps.
11. **Export/restore impact** — whether `BACKUP_KEYS`, `getAllBackupData()`, or `processImport()` change; whether backups exported *before* the migration remain restorable *after* the migration (or an explicit forward-compatibility path).
12. **Rollback/recovery strategy** — how to undo the migration if it goes wrong. See "Legacy-source removal preconditions" below.
13. **Data-loss risks** — every scenario in which user data could be lost, corrupted, or become unreachable, and how the migration mitigates each.
14. **Validation/test plan** — the specific tests that will be run before merging, and what "passes" looks like. Must explicitly verify every invariant from field 9, cover every compatibility case in field 10, and include an export→restore round-trip run in an isolated test context (see "Export/restore round-trip testing" below).

## One domain per migration commit

Per ADR-006, a migration commit modifies exactly one domain at a time. This is non-negotiable.

- If two domains genuinely need to be moved together (e.g., they share a Store slice), that's still one migration — but the commit message must justify why they're inseparable.
- Do not fold "quick cleanup" of a second domain into a migration commit for a first one. Even if the cleanup is trivial. Even if the second domain's migration seems obvious. Separate commit, separate review.
- Do not fold unrelated refactoring, style fixes, or feature work into a migration commit.

## Never silently clean up unrelated legacy keys

A migration commit may only modify:

- The write path for the target domain
- The read path for the target domain (if flipping canonical source direction)
- The migration function that transforms old data to the new shape
- Tests/validation for the above

A migration commit **may not**:

- Delete or "clean up" legacy keys for domains other than the target
- Remove or add `localStorage.removeItem()` calls for domains other than the target
- Modify `BACKUP_KEYS` for domains other than the target
- Touch `processImport()`'s handling of other domains

If a legacy key for an untargeted domain looks stale during the work, note it and file a separate follow-up. Do not remove it in this commit.

## Legacy-source removal preconditions (default: separate commits)

By default, the write-authoritative source for a domain is removed in a **separate commit** from the one that introduces the new source. This is the safe path — and the required path for our current Gen-1 → Gen-2 client-storage folds, where a temporary dual-write proving period catches drift before it becomes data loss.

The separate removal commit may only land when all four preconditions are true:

1. **New source proven** — measurable exit criteria, all met:
   - The migration commit's own tests passed.
   - Export → import round-trip has been run in an isolated test context (see "Export/restore round-trip testing" below) against synthetic data, and passes an equality check on every field of the migrated domain plus every invariant from field 9.
   - Normal-use validation completed where applicable — the user (or a representative test harness) has exercised the migrated domain in real work without triggering drift alerts, data anomalies, or invariant failures.
   - No divergence detected during the dual-write proving period, according to the divergence-detection mechanism required by "Dual-write / divergence risk" below.
   - The rollback path has been tested end-to-end.
   - Independent review has passed.
2. **Export/restore passes** — round-trip test verified in an isolated test context (see next section) using synthetic data. Documented in the removal commit.
3. **Rollback documented** — the procedure to restore the legacy source (from a pre-migration backup or from the current data) is written down and has been tested.
4. **Independent review** — the removal has had a second-reviewer pass (Codex, ChatGPT, or a human maintainer), separate from the reviewer of the migration commit itself.

## Same-commit atomic cutover (exception)

A same-commit atomic cutover — introducing the new source and removing the old in one commit, skipping the dual-write proving period — may be permitted, but only when **all** of the following hold:

- **Temporary dual storage would be demonstrably riskier** than a clean flip. Concrete examples that would qualify: the domain has a strict single-writer invariant that dual-write would violate; two sources holding the same data would present the user with conflicting states in the UI; the transactional guarantees of the target source can only be established if the legacy source is removed simultaneously.
- **The operation is transactional or reversible.** A single Postgres transaction that both creates the new source and drops the old, with tested reversal SQL, qualifies. A client-side `localStorage` migration that writes-then-deletes across two synchronous calls does **not** — it's not atomic against a browser crash between the writes.
- **Recovery has been tested end-to-end** before the commit, not merely documented as a plan.
- **Independent review explicitly approves the exception** in the PR, stating which of the above conditions justifies it. The reviewer's approval must name the exception; a generic "LGTM" does not count.

The current Gen-1 → Gen-2 client-storage folds do **not** meet these conditions and must follow the default separate-commit path. This exception exists for future cases (e.g., certain Supabase-side transactional migrations) where dual-write is genuinely worse than a clean flip.

## Dual-write / divergence risk

Whenever both Gen-1 and Gen-2 sources exist for the same domain during a migration, the proposal must explicitly address:

- **Which source is authoritative for the transition period?** Exactly one may be. The other is either a passive mirror or fully removed.
- **How is drift detected?** If the two are dual-written (e.g., during the pre-removal proving period), what mechanism catches the case where they diverge? A validation check on load, a periodic reconciliation, or a console warning on mismatch — one of these must exist, not "trust that the bridge always fires."
- **What happens on partial failure?** The Gen-2 Store's 300ms debounced autosave and Gen-1's synchronous `localStorage.setItem` have different failure modes (browser offline, quota exceeded, save interrupted). The proposal must state which source wins on a partial failure and why.
- **Existing `bridgeFinance()` behavior** is a live example of a mirror bridge — read it (grep) before designing new ones. Note it is a *mirror* (Gen-2 writes flow to Gen-1), not a canonical-source flip.

Silent divergence between two storage sources is a data-loss bug that surfaces months later. Explicit divergence handling is non-negotiable for any dual-write phase.

## Synthetic-data-first rule

Every migration's first-pass test — the one that runs *before* touching a real user profile — must use synthetic data:

- **BHT**: use `seedSyntheticData()` (locate via grep in `bht-bridge.js`).
- **Money / EASA / Goals / Logbook / Apartments / Deadlines**: fabricate a plausible shape by hand or via a small in-repo test fixture; never copy from a real user export.
- **Supabase**: seed data in an available isolated environment — local Supabase (via the Supabase CLI), a dedicated development project/database separate from production, or another disposable environment. **Verify what is actually available on the current plan before relying on any specific feature** (branching, PITR, edge development environments, etc.). Assumed capability is not a plan.

Only once the synthetic-data run has passed all validation steps may the migration be run against real user data — and only after an explicit "ready for real data" checkpoint in the plan, never automatically.

Per ADR-008, real user data never enters the repo. Synthetic fixtures may.

## Export/restore round-trip testing — safe-context requirement

**Export/restore round-trip tests must run in an isolated test context** using synthetic data. They must never automatically clear or overwrite the user's real Life OS browser storage.

Acceptable isolated contexts:

- A **separate browser profile** (a Chrome/Safari/Firefox profile distinct from the one holding the user's real dashboard state) with only synthetic data seeded.
- A **localhost test origin** — serving `index.html` from `http://localhost:...` while the user's real data lives at the deployed origin (`https://mahmoud1115.github.io`). The two origins have separate `localStorage` containers by browser design, so tests at localhost cannot see or affect real data.
- A **disposable/throwaway browser environment** — a fresh incognito window closed without saving, a VM, or a containerized browser.

Anywhere the migration report or its checklist says "export → clear storage → import → equality check," it means in one of the above contexts, against synthetic data.

**Clearing the user's real production storage — even for a "quick" verification — requires all three of:**

1. Explicit user authorization for that specific operation.
2. A verified fresh backup taken and its restorability confirmed *before* the clear.
3. The verification result stated back to the user before any subsequent write.

**Never make the "clear-storage" step automatic.** A migration or its tooling that clears real user storage without an explicit interactive prompt is a data-loss defect regardless of what else it gets right.

## Required migration report template

Every migration proposal (in its PR description, ADR entry, or commit message body) must include this report, filled in for the specific migration:

```
### Before
- Current source(s):        [Gen-1 key(s) and/or Gen-2 slice path(s)]
- Current readers:          [file:function references — verified now via grep]
- Current writers:          [file:function references — verified now via grep]
- Currently canonical:      [which source is ground truth right now]

### Change
- Exact transformation:     [shape change, rename, move — with a before/after example (synthetic values only)]
- What becomes canonical:   [the target source after this commit]
- Bridge behavior (if any): [is the previous source mirrored, or fully cut over]

### Invariants
- What must remain true:    [enumerate each property that must hold before and after — count preserved, ordering preserved, no invented data, monotonic timestamps, etc.]
- How each is verified:     [test or check for each — feeds Validation section]

### Compatibility
- Old data behavior:        [empty / partial / full / already-migrated / older-schema / malformed-parseable — each explicitly addressed]
- Fail-safe on corrupt:     [what the migration does when it encounters unrecoverable state — refuse, partial-with-marks, log — never invent]
- Dual-write behavior:      [which source wins if both are being written; how divergence is detected]
- Idempotency:              [what happens if the migration function runs twice on the same data]

### Validation
- Synthetic tests:          [what was run in an isolated context, what passed]
- Invariant checks:         [each invariant from above, with pass/fail]
- Compatibility coverage:   [each case from field 10, with pass/fail]
- Export/restore proof:     [isolated-context round-trip: export → clear storage → import → equality check on the domain — synthetic data only, in a separate browser profile / localhost origin / disposable environment; never against real production data]
- Reconciliation check:     [for dual-write phases, how the two sources are compared]

### Recovery
- Rollback path:            [how to revert this commit safely — includes pre-restore backup handling]
- Recovery strategy:        [if a user hits a corrupt state after this migration, how they recover]
- Pre-migration snapshot:   [where the user's pre-migration state is preserved]

### Merge gate
- Independent review:       [REQUIRED / OPTIONAL, with reasoning]
- Commit structure:         [DEFAULT (separate introduction + removal commits) / EXCEPTION (same-commit atomic cutover — if exception, cite which conditions from "Same-commit atomic cutover" justify it and confirm reviewer named the exception)]
- Follow-up commits:        [what has to land later — e.g., legacy-source removal — with the preconditions from this document]
```

An incomplete template blocks review.

## Merge gate

Storage migration is a **high-risk** category per `SECURITY_REVIEW.md` (category 12) and per CLAUDE.md / AGENTS.md's hard rules. Every migration requires:

- The full migration report above
- The relevant checks from `SECURITY_REVIEW.md` (secrets, RLS if Supabase involved, export/restore integrity, personal-data hygiene)
- Independent external review (Codex / ChatGPT / human maintainer) before merge to `main`

The `project-reviewer` subagent may serve as the local first-pass, but does not satisfy the "independent review" requirement.

## Rules of engagement

- Ground every claim in verified code — grep now, cite current lines.
- If a `STORAGE_MAP.md` entry looks wrong, fix `STORAGE_MAP.md` in a separate commit first, then base the migration on the corrected map.
- Never propose a migration for a domain not in `STORAGE_MAP.md`. Add the domain to the map first.
- Empty state is a real state. Test it explicitly.
- Read paths matter as much as write paths — a canonical-source flip that only updates writes but leaves readers pointing at the old source will silently diverge.
- Never claim "the export includes it" or "the snapshot covers it" without verifying against the current `BACKUP_KEYS` and snapshot format.
- **A migration that invents user data to satisfy a validation check is a defect, not a success.** Missing data stays missing.
