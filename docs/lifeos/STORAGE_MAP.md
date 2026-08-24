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
| Logbook — draft entries | `dune_logbook_entries_v1` (Gen-1) | Store has `logbook: []` — never populated | CSV exporter reads Gen-1 key |
| Logbook — active tab | `dune_logbook_tab_v1` (Gen-1) | No | UI state only |
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

Not on the migration path (leave as-is):
- Sync/backup bookkeeping keys — UI state, not user domain data.
- `dune_github_token_v1` — should ideally migrate *out* of localStorage entirely (see Priority 1 fixes).
