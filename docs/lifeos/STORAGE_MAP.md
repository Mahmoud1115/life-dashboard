# Storage Map — canonical per-domain source of truth

Snapshot as of 2026-08-24. Update whenever a domain's write source changes.

Every domain in Life OS reads from one or both of two storage generations:

- **Gen-1**: a flat top-level `localStorage` key, written directly by `app.js` (or a bolt-on module like `money-custom.js`).
- **Gen-2**: a slice inside `dune_state_v4` (the reactive `Store` in `core.js`).

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
| Goals — user overrides | `dune_goals_v1` (Gen-1) | Store has `goals: {}` — never populated | Static goal seeds live in `data.js:D.goals`; user progress/status overrides go to Gen-1 key |
| EASA — module status/progress | `dune_easa_v1` (Gen-1) | Store has `easa: {}` — never populated | Static module list in `data.js:D.easa`; overrides in Gen-1 key |
| Logbook — Tracker entries | `dune_logbook_v1` (Gen-1) | Store's `logbook` slice was seeded from this key **once** on first Store load via `core.js:migrateFromLegacy` (verified [core.js:148-149](core.js:148)); no live writer keeps it in sync | Active Tracker read/write ([app.js:930-1018](app.js:930)). **Home dashboard reads this key** ([app.js:625-627](app.js:625)) for `entries`/`hours` metrics. |
| Logbook — Builder entries | `dune_logbook_entries_v1` (Gen-1) | No — never bridged into the Store | Active Builder read/write ([app.js:1891-2041](app.js:1891)). **Backup summary line** ([app.js:1646](app.js:1646)) and **CSV export** ([app.js:2033-2041](app.js:2033)) both read this key. Writer at [app.js:1968](app.js:1968) hard-caps the array at 50 entries (`unshift` + `pop` when `length > 50`) — a known data-loss risk that pre-dates any planned migration and does not go away automatically. |
| Logbook — active tab | `dune_logbook_tab_v1` (Gen-1) | No | UI state only (which of Tracker/Builder is open); not record data. |
| Apartments | `dune_apartments_v1` (Gen-1) | Store has `apartments: []` — never populated | |
| Deadlines — user extensions | `dune_deadlines_ext_v1` (Gen-1) | No | Static deadlines in `data.js:D.deadlines` |
| Claims register | `dune_claims_v1` (Gen-1) | No | Static seeds in `data.js:D.claims` |
| Sync — GitHub PAT | `dune_github_token_v1` (Gen-1) | No | **Plaintext** — excluded from `BACKUP_KEYS` deliberately |
| Sync — Gist ID | `dune_gist_id_v1` (Gen-1) | No | Cached; see known UX bug in `ARCHITECTURE.md` |
| Sync — misc bookkeeping | `dune_last_gist_sync_v1`, `dune_last_backup_v1`, `dune_backup_dismissed_v1`, `dune_pre_import_backup_v1`, `dune_change_count_v1` | No | UI/reminder state |
| Nav — last section | `dune_activesec`, `dune_activegroup` (Gen-1) | No | UI state |

## What this means for Life OS 2.0 migration

Six domains are still on Gen-1 as write-authoritative and never mirror into the Store: **Money, Goals, EASA, Logbook, Apartments, Deadlines extensions**. A Supabase migration that reads only from `dune_state_v4` will miss all of them.

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

Recommended order for the Gen-1 → Gen-2 fold (least risk first):

1. **Money** — bidirectional bridge already exists (`bridgeFinance()`); just flip the write direction so Store becomes authoritative and Gen-1 becomes the mirror.
2. **EASA** — read-mostly, small object, low churn.
3. **Goals** — same shape as EASA, small.
4. **Apartments** — array, isolated, low usage.
5. **Deadlines extensions** — small array, static seeds elsewhere.
6. **Logbook** — largest write volume, do last so the pattern is proven first.

## Logbook status (2026-08-25)

Logbook has **two live Gen-1 record sources** — one per UI tab — and a **dormant** Gen-2 slice. Documented here so any future reader knows the migration is a union, not a copy:

- **Live Gen-1 sources**: `dune_logbook_v1` (Tracker) and `dune_logbook_entries_v1` (Builder) are both actively written today by their respective forms. Neither is a mirror of the other; the two tabs never cross-write.
- **Gen-2 slice `state.logbook`**: populated **once** from `dune_logbook_v1` by `core.js:migrateFromLegacy`. Since first-load, no live writer keeps it in sync, so it is **stale/dormant** and must **not** be treated as canonical today.
- **Reader disagreement today**: Home reads Tracker; CSV export and backup summary read Builder; `Store.derive.logbookStats` reads the dormant slice. This is the current runtime, not a design.
- **No approved cross-source dedupe** — a unification design exists (audit report) but is not implemented. A field-level fingerprint proposal is under review; nothing merges records automatically today.

### Approved future direction (not implemented)

- **Phase A** — Legacy remains authoritative; Tracker + Builder writers continue unchanged; canonical Gen-2 becomes a reconciled envelope (union of both sources, deduped by explicit rules, with provenance fields). Readers stay on legacy in Phase A.
- **Phase B** — Canonical Gen-2 becomes authoritative; all Tracker/Builder readers and writers switch together; legacy keys become passive compatibility mirrors only.

Neither phase has landed. Do not describe legacy keys as retired.

Not on the migration path (leave as-is):
- Sync/backup bookkeeping keys — UI state, not user domain data.
- `dune_github_token_v1` — should ideally migrate *out* of localStorage entirely (see Priority 1 fixes).
