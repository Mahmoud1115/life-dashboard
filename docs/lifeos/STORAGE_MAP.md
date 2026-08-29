# Storage Map — canonical per-domain source of truth

Snapshot as of 2026-08-25. Update whenever a domain's write source changes.

Every domain in Life OS reads from one or both of two storage generations:

- **Gen-1**: a flat top-level `localStorage` key, written directly by `app.js` (or a bolt-on module like `money-custom.js`).
- **Gen-2**: a slice inside `dune_state_v4` (the reactive `Store` in `core.js`). Since **B0** the wrapper is `{version, revision, committedAt, data}` (schema version is currently **14** as of PRV-0.5 R2 — was 13 through B0/B1) and writes use absent-path-safe CAS operations under a `navigator.locks` coordinator (see ADR-010).

For each domain, exactly **one** is the write-authoritative source. Any migration plan must respect this.

| Domain | Write-authoritative source | Also written to Store? | Notes |
|---|---|---|---|
| Money — Russia salary/expenses | `dune_finance_v1` (Gen-1) | Yes, via `bridgeFinance()` in `app.js` — Store is mirror only | Custom rows added by `money-custom.js` live directly in `dune_finance_v1.russia.customIncome[]` / `customExpenses[]` |
| Money — custom rows | `dune_finance_v1.russia.custom*` (Gen-1) | No | Bolt-on module; does not touch the Store |
| Career (company, position, aircraft, engines, licenses, milestones) | `dune_state_v4.career` (Gen-2) | — | Fully migrated |
| BHT (habits, entries, snapshots, life events) | `dune_state_v4.bht` (Gen-2) | — | Fully migrated; ~93+ entries in real user data |
| Timeline | `dune_state_v4.timeline` (Gen-2) | — | Fully migrated; typically empty in real user data |
| About You (profile, values, reminders) | `dune_state_v4.about` (Gen-2) | — | Fully migrated |
| Today (daily focus) | `dune_state_v4.todayFocus` (Gen-2) | — | Fully migrated |
| Weekly Reviews | `dune_state_v4.reviews` (Gen-2) | — | Fully migrated; typically empty |
| Decision Journal | `dune_state_v4.decisions` (Gen-2) | — | Fully migrated; typically empty |
| Ideas parking lot | `dune_state_v4.ideas` (Gen-2) | — | Fully migrated |
| Goals — full record | `dune_state_v4.records.goals` (Gen-2, schema 14) | — | **PRV-0.5 R2 (ADR-015 addendum #1): Gen-2 authoritative.** Migrated from `dune_goals_v1` per-id overrides + `_migration-legacy-records.js`. Legacy overrides merged once by `hydratePreservationRecordsOnce()` in `app.js`, then `dune_goals_v1` becomes read-only historical. Migration-complete state lives in `data.meta.recordsMigration` inside the same coordinated wrapper as the records; the old out-of-band sticky flag `dune_records_hydrated_v1` was removed in R2 (it could survive a durability failure and permanently skip migration). |
| Deadlines — full record | `dune_state_v4.records.deadlines` (Gen-2) | — | **PRV-0.5 (ADR-015): migrated from tracked seed in `data.js:D.deadlines`.** Legacy `dune_deadlines_ext_v1` extension slot preserved in `BACKUP_KEYS` for historical restore compatibility only. |
| Claims register — full record | `dune_state_v4.records.claims` (Gen-2) | — | **PRV-0.5 (ADR-015): migrated from `dune_claims_v1` per-id overrides + tracked seed in `data.js:D.claims`.** Legacy overrides merged once by hydration, then `dune_claims_v1` becomes read-only historical. |
| Risks register — full record | `dune_state_v4.records.risks` (Gen-2) | — | **PRV-0.5 (ADR-015): first canonical storage for risks.** Previously identity-only in `data.js:D.risks` with no persistence key. Score computed at hydration time (`prob * impact`). |
| Migration-only legacy seed | `_migration-legacy-records.js` — `window.LEGACY_RECORDS` (frozen, in-memory) | No | **PRV-0.5 bridge only.** Consumed exclusively by `hydratePreservationRecordsOnce()`. Renderers do not read it. To be removed in a later explicitly-approved cleanup step after PRV-1 restore-independence proves out. |
| PRV-0.5 migration marker | `dune_state_v4.data.meta.recordsMigration` (Gen-2, inside the coordinated wrapper, schema 14) | — | **PRV-0.5 R2 (ADR-015 addendum #1).** Migration authority lives INSIDE the same coordinated wrapper as the records, not as an out-of-band sticky flag. `defaultState()` (fresh browser + `Store.reset()`) initializes `{ status: 'migrated' }` with empty records — Reset cannot rehydrate legacy personal records. A v13 wrapper migrated up marks `{ status: 'unmigrated' }`; app.js hydration flips it to `{ status: 'migrated' }` ONLY after durable persistence is re-read and verified. Distinguishes unmigrated / migrated + populated / migrated + intentionally empty / malformed states without array-length inference. |
| EASA — module status/progress | `dune_easa_v1` (Gen-1) | Store has `easa: {}` — never populated | Static module list in `data.js:D.easa`; overrides in Gen-1 key. **IDs must remain stable through PRV-1 sanitization** so existing overrides continue to bind — see ADR-015 scope-out. |
| Logbook — Tracker entries | `dune_logbook_v1` (Gen-1) | **Yes — live Phase A mirror.** Every Tracker write (`submitLogEntry`, `deleteLogEntry`) refreshes the reconciled `state.logbook` envelope via `LOGBOOK.reconcile()`. Legacy remains authoritative for reads. | Active Tracker read/write ([app.js:930-1018](app.js:930)). **Home dashboard reads this key** ([app.js:625-627](app.js:625)) for `entries`/`hours` metrics. |
| Logbook — Builder entries | `dune_logbook_entries_v1` (Gen-1) | **Yes — live Phase A mirror.** Every Builder write (`lbbSaveEntry`, `lbbDeleteEntry`) refreshes `state.logbook` via `LOGBOOK.reconcile()`. Legacy remains authoritative for reads. | Active Builder read/write ([app.js:1891-2041](app.js:1891)). **Backup summary line** ([app.js:1646](app.js:1646)) and **CSV export** ([app.js:2033-2041](app.js:2033)) both read this key. The prior destructive 50-entry `unshift`+`pop` cap has been removed as part of Phase A — every Builder record now survives. |
| Logbook — active tab | `dune_logbook_tab_v1` (Gen-1) | No | UI state only (which of Tracker/Builder is open); not record data. |
| Apartments | `dune_apartments_v1` (Gen-1) | Store has `apartments: []` — never populated | |
| Deadlines — legacy extension slot | `dune_deadlines_ext_v1` (Gen-1) | No | **Superseded by `records.deadlines` (ADR-015). Retained in `BACKUP_KEYS` for historical restore compatibility only; no active reader or writer.** |
| Claims — legacy per-id overrides | `dune_claims_v1` (Gen-1) | No | **Superseded by `records.claims` (ADR-015). Retained in `BACKUP_KEYS` for restore compatibility only; migration hydrates once, then no active reader or writer.** |
| Goals — legacy per-id overrides | `dune_goals_v1` (Gen-1) | No | **Superseded by `records.goals` (ADR-015). Retained in `BACKUP_KEYS` for restore compatibility only; migration hydrates once, then no active reader or writer.** |
| Sync — GitHub PAT | `dune_github_token_v1` (Gen-1) | No | **Plaintext** — excluded from `BACKUP_KEYS` deliberately |
| Sync — Gist ID | `dune_gist_id_v1` (Gen-1) | No | Cached; see known UX bug in `ARCHITECTURE.md` |
| Sync — misc bookkeeping | `dune_last_gist_sync_v1`, `dune_last_backup_v1`, `dune_backup_dismissed_v1`, `dune_pre_import_backup_v1`, `dune_change_count_v1` | No | UI/reminder state |
| Nav — last section | `dune_activesec`, `dune_activegroup` (Gen-1) | No | UI state |

## What this means for Life OS 2.0 migration

Gen-1 remains write-authoritative for **EASA, Apartments**, and Money's non-Russia phases + custom rows. (Goals, Deadlines, Claims, and Risks moved to Gen-2 `dune_state_v4.records.*` in PRV-0.5 R2 — see ADR-015 addendum #1. The legacy Gen-1 override keys `dune_goals_v1` / `dune_claims_v1` / `dune_deadlines_ext_v1` are retained in `BACKUP_KEYS` for restore compatibility only, no active reader or writer.) A Supabase migration that reads only from `dune_state_v4` will miss those. **Money-Russia** is a live one-way bridge into `state.money` (Gen-1 authoritative, Gen-2 shadow). **Logbook is a Phase A exception**: both live legacy sources (`dune_logbook_v1` Tracker, `dune_logbook_entries_v1` Builder) reconcile into `state.logbook` on boot and after every add/delete write; legacy remains authoritative for UI reads and `state.logbook` is a live legacy-mirror envelope (`authority: 'legacy-mirror'`), not yet canonical UI authority.

Reconciliation direction (per approved audit / ADR-006):

```
Gen-1 flat keys
      ↓  (one domain at a time, with its own commit)
dune_state_v4  (Store — Gen-2)
      ↓  (later, gated by Review Center)
Supabase       (structured backend)
```

Do **not** migrate two storage systems into Supabase in parallel. Fold Gen-1 into Gen-2 first, then migrate one canonical Store slice into Supabase.

## Domain-by-domain migration priority

Recommended order for the remaining Gen-1 → Gen-2 folds (least risk first):

1. **Money** — bidirectional bridge already exists (`bridgeFinance()`); just flip the write direction so Store becomes authoritative and Gen-1 becomes the mirror.
2. **EASA** — read-mostly, small object, low churn.
3. **Apartments** — array, isolated, low usage.
4. **Logbook** — largest write volume, do last so the pattern is proven first.

*Deadlines, Claims, Risks, Goals already landed on Gen-2 in PRV-0.5 R2 (schema 14, `dune_state_v4.records.*`) — see ADR-015 addendum #1. Not on this list.*

## Logbook status (as of Phase A landing)

Logbook has **two live Gen-1 record sources** — one per UI tab — plus a **live Phase A reconciled mirror** in Gen-2:

- **Live Gen-1 sources**: `dune_logbook_v1` (Tracker) and `dune_logbook_entries_v1` (Builder) are both actively written today by their respective forms. Neither is a mirror of the other; the two tabs never cross-write.
- **Gen-2 slice `state.logbook`**: a versioned envelope (`schemaVersion: 1`, `authority: 'legacy-mirror'`, `entries`, `migration.sourceCounts`, `reconciled`, `drift`), introduced by Store `SCHEMA_VERSION 12`. `LOGBOOK.reconcile()` rebuilds it on every page load and after every legacy write in all four writer paths.
- **Union, no automatic dedupe**: reconciliation preserves records from both sources with source-tagged provenance. A diagnostic `possibleDuplicateKey` is computed but never used to merge records automatically.
- **Reader disagreement today** (unchanged from pre-Phase-A because Phase A does not flip authority): Home reads Tracker; CSV export and backup summary read Builder; `Store.derive.logbookStats` now reads the reconciled envelope's `entries[]`.
- **Builder 50-entry cap removed** — Phase A dropped the destructive `entries.pop()` from `lbbSaveEntry`; every Builder record now survives.

### Phase B (approved future direction — not implemented)

Canonical Gen-2 becomes authoritative; all Tracker/Builder readers and writers switch to `Store.get/set('logbook', …)` together; legacy keys become passive compatibility mirrors only. Not landed. **Do not describe legacy keys as retired.**

Not on the migration path (leave as-is):
- Sync/backup bookkeeping keys — UI state, not user domain data.
- `dune_github_token_v1` — should ideally migrate *out* of localStorage entirely (see Priority 1 fixes).
