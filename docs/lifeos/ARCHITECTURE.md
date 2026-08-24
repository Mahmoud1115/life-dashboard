# Architecture — as of 2026-08-24

Snapshot of how the code actually works today. Update when reality changes, not when a plan changes.

## Runtime

- Static site. `index.html` loads 15 same-origin `<script>` tags in a fixed order, one Google Fonts stylesheet, everything else self-hosted.
- No framework, no build step, no `package.json`, no bundler.
- Deployment: push to `main` → GitHub Pages rebuilds and serves from `/`.
- PWA manifest is present (`manifest.json`) — installable, but **no service worker exists** so it is not offline-capable.

## Two coexisting storage generations

### Gen-1 (legacy, still live)
`app.js` (~2,500 lines) writes flat `localStorage` keys directly. See `STORAGE_MAP.md` for the full canonical list. Key examples:
- `dune_finance_v1` — Money section (rent, food, salary, custom rows)
- `dune_easa_v1` — per-module EASA status/progress overrides
- `dune_logbook_entries_v1` — logbook draft entries
- `dune_github_token_v1` — GitHub PAT for Gist sync (plaintext)
- `dune_gist_id_v1` — cached Gist ID for sync target

### Gen-2 (reactive Store, in `core.js`)
One versioned JSON blob under `dune_state_v4` (schema `SCHEMA_VERSION = 11`). Owns:
- `money`, `qatarVisit`, `todayFocus`, `goals`, `career`, `easa`, `logbook`, `reviews`, `decisions`, `timeline`, `about`, `apartments`, `sbTasks`, `bht`, `telemetry`, `ideas`

Features:
- Dot-path get/set (`Store.get('money.salary_net')`, `Store.set('bht.entries', [...])`)
- Pub/sub subscriptions (`Store.subscribe('qatarVisit', fn)`)
- 300ms debounced autosave
- Rolling snapshot buffer (`dune_snapshots_v1`, max 8)
- Forward-only migration chain in `migrateUp()`
- Validate-on-load — `validate()` at `core.js:254` requires `qatarVisit` to exist; missing → full reset to defaults

### The bridge
`core.js`'s `migrateFromLegacy()` reads Gen-1 keys **once, on first load**, to seed `dune_state_v4`. After that, Gen-1 code keeps writing legacy keys independently. **No ongoing reconciliation.** This is why `STORAGE_MAP.md` matters — for many domains (Finance, EASA, Goals, Logbook), the Gen-1 key is still the write-authoritative source, and the corresponding field inside `dune_state_v4` may be empty or stale.

## Data flow

```
user types in a form field
  ↓
inline onchange / oninput handler (app.js or core.js)
  ↓
either: Store.set(path, val)         [Gen-2]
    or: localStorage.setItem(...)    [Gen-1]
  ↓ (Store only)
300ms debounce → dune_state_v4 rewritten → rolling snapshot → notify(path)
  ↓ (Store only)
subscribed render functions repaint only the affected DOM
```

No server, no queue, no scheduled job. Every state change fires synchronously from a browser event.

## Sync (Gist)

- User-initiated only, never automatic.
- **Save to Gist**: `getAllBackupData()` collects the `BACKUP_KEYS` set (`app.js:1378`) → POST/PATCH `api.github.com/gists` with the PAT as a Bearer header → private Gist "Dune Life OS — Auto Backup" (file `dune-backup.json`).
- **Load from Gist**: reverse. GET the Gist by cached ID (`dune_gist_id_v1`), overwrite matching `localStorage` keys, reload.
- The PAT is deliberately excluded from `BACKUP_KEYS`. The BHT AI provider key (`state.bht.ai.apiKey`) lives inside `dune_state_v4` so it *is* backed up — feature currently unused.
- **Known UX bug**: the "load from a different Gist ID" input only appears when auto-discovery fails, which makes recovering from a bad cached `dune_gist_id_v1` hard. Slated for fix under Priority 1.
- **Known correctness gap**: `processImport()` at `app.js:1483-1499` is commented `// atomic write` but is a sequential loop with no allowlist, no schema validation beyond `.version` / `.data` existence, and no rollback. Slated for fix under Priority 1.

## The BHT subsystem

7 files (~3,400 lines): `bht.js`, `bht-ui.js`, `bht-components.js`, `bht-analytics.js`, `bht-coach.js`, `bht-bridge.js`, `bht-duku.js`, `bht-grid.js`.

- CBT-style habit/urge tracker: mood, trigger, coping method, sleep, stress, urge intensity, resisted?, entries per day.
- Lives entirely inside `state.bht` in the Store — has no storage of its own. Inherits save, snapshots, and Gist sync for free.
- Injects its own nav group ("Behavior") and section at runtime; also injects a floating action button and a `Ctrl/Cmd+Shift+B` hotkey.
- **Cross-domain scanning**: `bht-bridge.js:14-23` inspects other Store paths (`sleep`, `stress`, `health.*`, `today.*`, `daily.*`, etc.) looking for cross-module signal to enrich BHT entries with. No other module currently writes to those paths, but the coupling is real and worth remembering when refactoring.
- **Optional AI coach**: multi-provider router (Ollama / Anthropic / OpenRouter). Currently **disabled outright** — user has never configured a provider key. See `DECISIONS.md` ADR-005.
- **Synthetic-data seeder** available (`bht-bridge.js:seedSyntheticData()`) for demo/testing.

## What lives in `dune_state_v4`, what does not (as of 2026-08-24)

Non-empty in a real user backup:
- `money`, `career`, `about`, `ideas`, `bht` (~93+ entries, growing)

Structurally present but empty in real user backups:
- `goals`, `easa`, `logbook`, `reviews`, `decisions`, `timeline`, `apartments`, `sbTasks`

The empty ones are because those domains still write to their Gen-1 keys (`dune_easa_v1`, `dune_logbook_entries_v1`, `dune_goals_v1`) rather than into the Store. See `STORAGE_MAP.md`.

## Future direction (not implemented)

Life OS 2.0 adds a Supabase-backed structured backend **behind** the existing site, incrementally, one domain at a time, gated by a Review Center approval loop. Not built yet. See the standalone Life OS 1.0 Audit artifact (Rev. 5) and `DECISIONS.md`.
