# Architecture — as of 2026-08-25

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
One versioned JSON blob under `dune_state_v4` (schema `SCHEMA_VERSION = 14` — B0 wrapper: `{version, revision, committedAt, data}`; PRV-0.5 R2 bumped from 13 to 14 to introduce the `data.records.*` subtree and the `data.meta.recordsMigration` marker — see ADR-015 addendum #1). Owns:
- `money`, `qatarVisit`, `todayFocus`, `goals`, `career`, `easa`, `logbook`, `reviews`, `decisions`, `timeline`, `about`, `apartments`, `sbTasks`, `bht`, `telemetry`, `ideas`

Features:
- Dot-path get/set (`Store.get('money.salary_net')`, `Store.set('bht.entries', [...])`)
- **CAS-based writes** — every `Store.set/update` enqueues an absent-path-safe operation. `Store.get()` returns a defensive `clonePersistable` clone; internal state is never exposed by reference.
- **Persistence coordinator** — same-tab Promise serializer plus `navigator.locks.request('lifeos-state-write-v1', {mode:'exclusive'})` when available. Inside the lock, read → migrate → validate → rebase → strict-replay → primary write → snapshot write is synchronous.
- **Capability probe** — `Store.capabilities.crossTabSafe` reports whether Web Locks are available. Phase B2 canonical Logbook activation is gated on `true`.
- **Storage-event rebasing** — a newer revision seen on `window.storage` is adopted as the new base; equal-revision + different raw triggers a defensive current-disk reread and emits `STORE_REVISION_COLLISION`; lower revisions raise `STORE_REVISION_REGRESSION`. Events never trigger writes.
- **Full-state transaction protocol** — `import`, snapshot restore, and reset share `beginFullStateTransaction / commitFullStateWrapper / endFullStateTransaction`. During freeze, `Store.set/update` return `FULL_STATE_TRANSACTION_IN_PROGRESS`; storage events are deferred; `endFullStateTransaction` always fires in `finally`.
- **Conflict lifecycle** — a typed `Store.conflict` record freezes persistence but not enqueueing. Resolution: `use-this-tab` (`force-set` in place) or `use-saved-version` (drop the conflicting op only; later same-path ops are not silently subsumed). Accessible banner UI in `index.html`.
- Pub/sub subscriptions (`Store.subscribe('qatarVisit', fn)`)
- 300ms debounced flush
- Rolling snapshot buffer (`dune_snapshots_v1`, max 8) — outer format `[{at, payload}]` unchanged; payload is a schema-14 wrapper. Snapshot restore enforces the schema-14 destructive-boundary guard in `core.js:validateSnapshotWrapperFull()` via `isRecordsMigrationShapeSafe()` (NOT the softer load-time `validate()`, which stays permissive so a malformed persisted wrapper can be healed by app.js hydration rather than rejected into a stranded revision divergence). PRV-0.5 R4 (Codex Round-3 P1-B): the destructive guard rejects EVERY schema-14 payload whose migration marker is missing / non-object / of unknown status, OR whose `records.*` is not an object with all four required domain arrays — regardless of marker status. Gating only on `status='migrated'` was the R3 bypass Codex reproduced.
- Forward-only migration chain in `migrateUp()`; older-schema blobs still load and are re-wrapped as schema-14 on the next commit. The v13→v14 step adds `records: {deadlines:[], claims:[], risks:[], goals:[]}` and marks `meta.recordsMigration = { status: 'unmigrated', priorSchemaVersion, … }` so app.js hydration can complete the preservation migration from `_migration-legacy-records.js` + surviving Gen-1 override keys.
- Validate-on-load — missing `qatarVisit`/`money.salary_net` → snapshot recovery, then legacy migration.
- **Revision exhaustion** — the last accepted revision is `Number.MAX_SAFE_INTEGER`; the next write fails with `STORE_REVISION_EXHAUSTED`.
- **Pure, deterministic legacy derivation** — `Store.deriveStateFromLegacy(read)` reads only from a caller-supplied reader; no live localStorage access when a reader is supplied, no wall-clock (uses a fixed `DETERMINISTIC_META_ISO` epoch), no random defaults. Used by boot (live-localStorage reader) and by `processImport`'s legacy-only import derivation (staged-key reader). Same reader → byte-equivalent candidate across calls.

See `docs/lifeos/DECISIONS.md` ADR-010 for the full protocol.

### The bridge
`core.js`'s `migrateFromLegacy()` reads Gen-1 keys **once, on first load**, to seed `dune_state_v4`. After that, Gen-1 code keeps writing legacy keys independently — **with two live reconciliation exceptions**: Money-Russia (Gen-1 `dune_finance_v1.russia` shadowed one-way into `state.money`) and Logbook (Tracker + Builder legacy sources reconciled into `state.logbook` on boot and after every add/delete write, `authority: 'legacy-mirror'`). For EASA, Apartments, and Study Board, the Gen-1 key remains the write-authoritative source and the corresponding field inside `dune_state_v4` may be empty or stale. **PRV-0.5 R2 (ADR-015): Goals, Deadlines, Claims, and Risks moved to Gen-2 authoritative under `dune_state_v4.data.records.*` — `dune_goals_v1` / `dune_claims_v1` / `dune_deadlines_ext_v1` are retained in `BACKUP_KEYS` for pre-PRV restore compatibility only, no active reader or writer.** See `STORAGE_MAP.md`.

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
- The PAT is deliberately excluded from `BACKUP_KEYS`. `state.bht.ai` no longer carries an `apiKey` field: `bht.js:sanitizeAI` strips it on load and rejects it on write (ADR-005). BHT AI provider config is fallback/ollama only; nothing that touches a network key is persisted.
- **Known UX bug**: the "load from a different Gist ID" input only appears when auto-discovery fails, which makes recovering from a bad cached `dune_gist_id_v1` hard. Slated for fix under Priority 1.
- **Import** (B0, ADR-010, PRV-0.5 R4 hardened): `app.js:processImport` is an `async` full-state transaction. Preflight → `beginFullStateTransaction({force:true, reason:'import'})` (freezes ordinary Store writes; UI banner via `lifeos:store-freeze-begin`) → snapshot byte-exact `BACKUP_KEYS` → write recovery capsule (`dune_pre_import_backup_v1`, preserved after both success and failure) → apply non-`dune_state_v4` `BACKUP_KEYS` in order (staged writes / removeItem for omitted keys) → **source-wrapper revision check**: any wrapped payload claiming `version >= 13` MUST carry an in-range non-negative integer revision or the import aborts with `IMPORT_SOURCE_WRAPPER_INVALID_REVISION` (R4 Codex P1-A: `revision=-1` used to fast-path as migrated) → derive candidate: `Store.migrateData` for a wrapped `dune_state_v4` payload (v13 wrappers get migrated up to v14 with `meta.recordsMigration.status='unmigrated'`), or `Store.deriveStateFromLegacy(stagedReader)` for legacy-only backups → `Store.validateData` (base validity) → **destructive-boundary shape guard** `_isSchema14CanonicalDestructiveShape(candidate)` applies to EVERY candidate regardless of marker status: reject if the migration marker is missing / non-object / of unknown status, or if `records.*` lacks any of the four required domain arrays. Prior to R4 the guard fired only when `status==='migrated'`; Codex R3 bypassed it with missing marker / bogus status / missing records and watched hydration seed from `LEGACY_RECORDS`, inventing user intent. → `commitFullStateWrapper(token, candidate, 'import')` writes `dune_state_v4` LAST as a schema-14 wrapper under `navigator.locks.request('lifeos-state-write-v1', {mode:'exclusive'})`, revision = latest validated disk revision + 1, `committedAt` from `nowISO()`. Byte-exact rollback of touched auxiliaries on any apply failure. Guaranteed `endFullStateTransaction(token)` in a `finally`. Convergence for a `status='unmigrated'` import lands via the scheduled `location.reload()` fired by `processImport` (which re-runs `hydratePreservationRecordsOnce()` at fresh boot under the `lifeos-prv05-migrate` Web Lock) — production import does NOT emit ordinary `Store.onSave` listeners for the committed wrapper, so a same-tab `onSave`-triggered re-invocation is not the convergence path. All callers (`handleImportFile`, `importFromClipboard`, Gist restore) `await`.

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

The empty ones are because those domains still write to their Gen-1 keys (`dune_easa_v1`, `dune_logbook_entries_v1`) rather than into the Store. Goals moved to Gen-2 in PRV-0.5 R2 and now live in `dune_state_v4.records.goals` — `dune_goals_v1` is historical-restore-compatibility only. See `STORAGE_MAP.md`.

## Logbook Phase A canonical mirror

Logbook has **two live Gen-1 sources** (Tracker `dune_logbook_v1` and Builder `dune_logbook_entries_v1`) written by two separate UI tabs. Phase A introduces a Gen-2 mirror without switching authority.

- `state.logbook` is a versioned envelope (`schemaVersion: 1`, `authority: 'legacy-mirror'`, `entries`, `migration.sourceCounts`, `drift`) — added by Store `SCHEMA_VERSION 12`.
- **All pure normalisers live in `core.js` under `Store.logbookHelpers`** (`normalizeTrackerRecord`, `normalizeBuilderRecord`, `assignCanonicalIds`, `parseHours`, `contentDigest`, …). `app.js` `LOGBOOK` is a thin I/O wrapper. Schema migration does not depend on app-layer globals.
- **Load-time reconciliation** — on every page load, `LOGBOOK.reconcile()` reads both live legacy keys and rebuilds `state.logbook.entries` deterministically. Recovery matrix for state-only backups:

  | Legacy key | Behaviour |
  |---|---|
  | present (even `[]`) | Legacy authoritative for that source; envelope recovery suppressed |
  | truly absent (`null`) | Recover source-tagged records from the existing canonical envelope |

  Applies symmetrically to Tracker and Builder — Builder-tagged canonical records survive state-only restores just like Tracker-tagged ones.
- **Store validation is domain-local**: a malformed `state.logbook` (string, plain array, wrong shape) is recovered to `defaultLogbookEnvelope()` at load; unrelated slices are never touched. No full-state reset for a Logbook-only defect.
- **Writer mirrors** — after each successful legacy write in the four paths (`submitLogEntry`, `deleteLogEntry`, `lbbSaveEntry`, `lbbDeleteEntry`), `LOGBOOK.reconcile()` refreshes the mirror.
- **No automatic cross-source dedupe** — same task entered in both tabs produces two canonical records. A diagnostic `possibleDuplicateKey` is computed but never used to merge.
- **Deterministic canonical IDs, stable under prepend/reorder** — legacy-ID counts are pre-computed per source before ID assignment:
  - Unique legacy ID (count == 1) → `lb2:<source>:<legacyId>`
  - Duplicate legacy ID (count > 1) → **every** member gets `lb2:<source>:dup:<legacyId>:<contentHash>:<occurrence>` (occurrence counted per `source|legacyId|contentHash` bucket). No member of a duplicate group ever receives the unsuffixed form, so reversing two same-ID records with different content cannot swap identities.
  - Missing legacy ID → `lb2:<source>:fallback:<contentHash>:<occurrence>` (occurrence counted per `source|contentHash` bucket).

  Unrelated prepends or distinct-record reorderings do not shift IDs.
- **Bounded timestamp inference** — `inferredCreatedAt` only set when a legacy ID matches `(lb|lbe)_<epoch>` AND the epoch lies in the plausible range 2000-01-01 .. 2100-01-01 (ms). `lb_1` → `null`; real 2025-ish epoch → ISO string.
- **Safe `legacyExtra`** — a null-prototype dictionary populated via `Object.defineProperty` own-property writes; real own keys like `__proto__` / `constructor` / `prototype` (as delivered by JSON.parse) cannot mutate `Object.prototype`. Malformed known-field values (e.g. object where scalar was expected, invalid `hours` string) are preserved under `legacyExtra.<field>` so raw data is never silently dropped.
- **Deterministic structured serialisation** — one `stableSerialize(value)` helper (in `core.js`) drives BOTH the identity content hash and the drift digest. Object keys sorted lexicographically; special own keys preserved; no prototype traversal. Ensures identity and drift never subtly diverge.
- **`legacyExtra` participates in identity AND drift** — the identity payload includes sorted `legacyExtra` own properties, so records that differ only in preserved unknown/malformed data get distinct canonical IDs and count as content changes for drift.
- **Explicit reconciliation marker** — `state.logbook.reconciled: boolean`. Default and migrate-only envelopes start `false`. `LOGBOOK.reconcile()` sets `true` on success. Drift comparison only runs when the previous envelope carried `reconciled === true`, so the first real reconciliation after schema-11 migration cannot produce false drift even when the migrate step already source-tagged the interim records.
- **Drift metadata** — `{detected:true, previousCount, reconciledCount, reason:'legacy_divergence', previousDigest, reconciledDigest}` when digests differ; `null` otherwise. Same-count content changes are detected; no record data leaked.
- **Builder cap removed** — the previous 50-entry `pop()` in `lbbSaveEntry` is gone; every Builder record survives.
- **Readers unchanged in Phase A.** Home still reads `dune_logbook_v1`; CSV export and backup summary still read `dune_logbook_entries_v1`. Phase B will flip readers and writers to canonical together.

## Future direction (not implemented)

Life OS 2.0 adds a Supabase-backed structured backend **behind** the existing site, incrementally, one domain at a time, gated by a Review Center approval loop. Not built yet. See the standalone Life OS 1.0 Audit artifact (Rev. 5) and `DECISIONS.md`.
