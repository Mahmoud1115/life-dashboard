# Architecture — as of 2026-08-25

Snapshot of how the code actually works today. Update when reality changes, not when a plan changes.

## Runtime

- Static site. `index.html` loads 15 same-origin `<script>` tags in a fixed order, one Google Fonts stylesheet, everything else self-hosted.
- No framework, no build step, no runtime `package.json`, no bundler. A dev-tooling `package.json` (name `dune-life-os-tests`, private) pins `@playwright/test` at `1.62.1`; it ships nothing to the browser.
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
- Rolling snapshot buffer (`dune_snapshots_v1`, max 8) — outer format `[{at, payload}]` unchanged; payload is a schema-14 wrapper. Snapshot restore enforces the R5 destructive-boundary guard in `core.js:validateSnapshotWrapperFull()`, which routes through the Store-owned `evaluateCandidateData()` (see the **Authority evaluator** section below). PRV-0.5 R5 (Codex Round-4): the guard rejects EVERY schema-14 payload whose migration marker is missing / non-object / non-canonical (unknown status; `schemaVersion !== SCHEMA_VERSION`; `unmigrated` without provable `priorSchemaVersion` + canonical `reason` matching `migrateUp-from-v<priorSchemaVersion>`) OR whose `records.*` is not an object with all four required domain arrays. Wrapper `version > SCHEMA_VERSION` is rejected at load / import / snapshot boundaries — never silently downgraded (R5 P1-5). The load-time `validate()` gate stays permissive so a stale-shape wrapper still loads and the recovery path can act, but boot into a corrupt / recovery-required disk state now sets a `STORE_CORRUPT_AUTHORITATIVE_STATE` durability blocker AND preserves the corrupt bytes as evidence — ordinary writes and normal backup export refuse until recovery lands through an approved full-state transaction (Codex R4 P1-4).
- Forward-only migration chain in `migrateUp()`; older-schema blobs still load and are re-wrapped as schema-14 on the next commit. The v13→v14 step adds `records: {deadlines:[], claims:[], risks:[], goals:[]}` and marks `meta.recordsMigration = { status: 'unmigrated', priorSchemaVersion, … }` so app.js hydration can complete the preservation migration from `_migration-legacy-records.js` + surviving Gen-1 override keys.
- **Supported historical range: v8..v13.** v8 is the first attested emission of the current-generation top-level domain set (`money`, `qatarVisit`, `career`, `easa`, `about`, `sbTasks`, `goals`, `bht`, `telemetry`, `meta`, `todayFocus`, `timeline`, `reviews`, `decisions`, `apartments`; ideas at v9+). Every persisted source at v8..v13 is source-validated against the version-specific matrix in `HISTORICAL_SCHEMA_REQUIREMENTS` before migration. **v0..v7 FAIL CLOSED with `version-unsupported`** at every destructive boundary — no permissive floor for the pre-emission generations. Round-6 (ADR-015 addendum #13) tightened the v8..v13 nested source contract to the COMPLETE emitted BHT + telemetry paths: `bht.{habits, entries, snapshots, lifeEvents}` (arrays); `bht.vocab.{triggers, coping, moods}` (arrays); `bht.ai.{provider, ollamaUrl, model}` (strings); `bht.meta` (object); `telemetry.{accumulatedFatigue, weeklyShiftHours, focusReserve}` (numbers). Version-specific `logbook`: array for v8..v11, `logbook-envelope` object for v12..v13. `bht.ai.apiKey` is intentionally NOT required (ADR-005 removed it in v12).
- **Current-schema (v14) canonical validation** is `validateFullStateCanonical()`. It enforces the ten top-level required objects + six required arrays + `records.{deadlines, claims, risks, goals}` + `meta.recordsMigration` (marker) + `money.{salary_net, expenses}` + the same complete BHT/telemetry emitted-paths contract that guards v8..v13 sources + a strict envelope-only Logbook (no legacy-array acceptance at v14). Applied at every destructive boundary: `commitFullStateWrapper` on the original candidate before normalization; `evaluateCandidateWrapper` v14 else-branch; `validateSnapshotWrapperFull` v14 branch; `migrateAndValidate` v14 boot branch. Legacy sources (v8..v13) continue through `validateLegacySourceRequiredFields` at the same boundaries; boot for legacy uses the softer-floor + `STORE_LEGACY_CONVERSION_PENDING` pathway (ADR-015 addendum #7) which itself refuses partial legacy sources at atomic conversion.
- **Pre-write vs post-write mapping.** Every destructive commit goes through the pre-write canonical check described above BEFORE the primary write. Post-write, `commitFullStateWrapper` re-reads the primary, re-parses via `parseWrapperRaw`, re-runs `evaluateCandidateData` on the durable data, and either settles `AUTHORITATIVE_MIGRATED` (success) or installs a `STORE_FULL_STATE_POST_WRITE_UNCERTAIN` durability blocker (uncertainty — Round-4/Round-5). No listener success advance runs on uncertainty. The freeze banner gives truthful post-write-uncertain guidance pointing at the three recovery controls in the Backup panel (Round-6 addendum #13).
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
- **Import** (B0, ADR-010, PRV-0.5 R5 authority-centralised): `app.js:processImport` is an `async` full-state transaction. Preflight → `beginFullStateTransaction({force:true, reason:'import'})` (freezes ordinary Store writes; UI banner via `lifeos:store-freeze-begin`) → snapshot byte-exact `BACKUP_KEYS` → write recovery capsule (`dune_pre_import_backup_v1`, preserved after both success and failure) → apply non-`dune_state_v4` `BACKUP_KEYS` in order (staged writes / removeItem for omitted keys) → derive candidate. PRV-0.5 R5 routes the ENTIRE source-wrapper authority decision through `Store.evaluateCandidateWrapper(sourceWrapper)` (see **Authority evaluator** below): `UNSUPPORTED_FUTURE_SCHEMA` → `IMPORT_UNSUPPORTED_FUTURE_SCHEMA`, `CORRUPT_STALE_COLLIDING` → `IMPORT_SOURCE_WRAPPER_INVALID_REVISION`, any other non-canonical class → `IMPORT_SCHEMA14_CANONICAL_SHAPE_INVALID`. A legacy-only backup (no `dune_state_v4`) uses `Store.deriveStateFromLegacy(stagedReader)`. Every candidate is then re-checked against `Store.evaluateCandidateData(candidate)` before commit. → `commitFullStateWrapper(token, candidate, 'import')` writes `dune_state_v4` LAST as a schema-14 wrapper under `navigator.locks.request('lifeos-state-write-v1', {mode:'exclusive'})`, revision = latest validated disk revision + 1, `committedAt` from `nowISO()`. Byte-exact rollback of touched auxiliaries on any apply failure. Guaranteed `endFullStateTransaction(token)` in a `finally`. Convergence for a `status='unmigrated'` import lands via the scheduled `location.reload()` fired by `processImport` (which re-runs `hydratePreservationRecordsOnce()` at fresh boot under the `lifeos-prv05-migrate` Web Lock) — production import does NOT emit ordinary `Store.onSave` listeners for the committed wrapper, so a same-tab `onSave`-triggered re-invocation is not the convergence path. All callers (`handleImportFile`, `importFromClipboard`, Gist restore) `await`.

### Authority evaluator (PRV-0.5 R5 — ADR-015 addendum #4)

The **single source of authority truth** for a persisted or candidate wrapper is `Store.evaluatePersistedAuthority(raw?)` in `core.js`. It replaces the parallel predicates that hydration (`app.js`), import (`app.js:processImport`), snapshot restore (`core.js:validateSnapshotWrapperFull`), and backup export (`app.js:exportBackup / copyBackupToClipboard / saveToGist`) previously each maintained. Every one of those consumers now routes its authority decision through the evaluator.

The evaluator returns one of six classifications plus consumer decision booleans:

- **AUTHORITATIVE_MIGRATED** — current version, valid revision, canonical marker (`status='migrated'`, `schemaVersion===SCHEMA_VERSION`), four record arrays. Fresh cold-boot defaults, post-Reset (both empty; sub-flag `allEmpty:true`), post-hydration migrated, and post-import migrated all land here. Only this class produces `acceptFastPathMigrated:true` (also requires no active durability blocker AND raw bytes matching Store's accepted baseline — no equal-revision divergent-bytes attack).
- **VERIFIED_LEGACY_TRANSITION** — either an outer wrapper `version < SCHEMA_VERSION` from a supported legacy schema (0..SCHEMA_VERSION-1), OR a schema-14 wrapper whose marker syntactically matches the canonical `unmigrated` provenance shape AND Store currently holds the transaction-scoped legacy-transition capability (`_legacyTransitionCapability`) granted by initialLoad when the raw persisted wrapper this boot was itself a supported outer legacy version. PRV-0.5 R6 (Codex Round-5 P1-1): marker text ALONE is NOT proof of an outer transition. A schema-14 wrapper written directly at current schema with a syntactically-matching `unmigrated` marker CANNOT self-authorise seeding on cold reload — the evaluator downgrades it to `MALFORMED_CURRENT_SCHEMA` because `Store.canAuthoriseLegacySeed() === false`. This is the ONLY class that authorises `LEGACY_RECORDS` seeding (`seedLegacy:true`), and only when the capability is present.
- **MALFORMED_CURRENT_SCHEMA** — a schema-14 wrapper with a valid outer envelope but a non-canonical marker (missing / non-object / unknown status / wrong `schemaVersion` / unmigrated without provenance / unmigrated with wrong reason) OR a non-canonical `records.*` (missing object, missing domain, non-array domain). Recovery required. Hydration MUST NOT synthesize `[]` for a missing/non-array required domain (R4 P1-2); MUST NOT seed `LEGACY_RECORDS`.
- **CORRUPT_STALE_COLLIDING** — corrupt outer JSON, invalid revision, stale revision (< Store's accepted disk revision), equal-revision but divergent raw bytes vs. Store's baseline (R4 P1-3 reproduction), OR an active Store durability blocker while looking at otherwise canonical bytes. Recovery required. Backup refused.
- **UNSUPPORTED_FUTURE_SCHEMA** — outer wrapper `version > SCHEMA_VERSION`. Rejected at every load / import / snapshot boundary (R4 P1-5). Never silently downgraded through `migrateUp`.
- **ABSENT** — no `dune_state_v4` on disk (fresh browser). Hydration fast-path B evaluates `Store`'s in-memory data via `evaluateCandidateData()` to distinguish fresh-cold-boot canonical from a legacy-transition-in-memory state.

Consumer decision rules:

- **Hydration fast-path** (`app.js:_hydrateUnderLock`): fast-skip on `acceptFastPathMigrated`; seed on `seedLegacy` for `VERIFIED_LEGACY_TRANSITION`; otherwise `{ok:false, reason:'recovery-required', classification, blocker}` — do NOT invent `[]`, do NOT seed. Durability verification after seeding re-evaluates and requires `AUTHORITATIVE_MIGRATED` (R4 P1-A export/reload invariant).
- **Import** (`app.js:processImport`): `evaluateCandidateWrapper(sourceWrapper)` up-front, then `evaluateCandidateData(candidate)` before commit. Non-canonical classes reject; current good state preserved (rollback of touched auxiliaries + guaranteed `endFullStateTransaction`).
- **Snapshot restore** (`core.js:validateSnapshotWrapperFull`): routes through the same `evaluateCandidateData()`; non-canonical snapshots refused with `SNAPSHOT_SOURCE_WRAPPER_INVALID` before mutation.
- **Backup export** (`app.js:exportBackup / copyBackupToClipboard / saveToGist`): call `evaluateBackupAuthority()` which consults `evaluatePersistedAuthority()`. Only `acceptForBackup:true` produces a normal restorable backup. Invalid authority is refused with a UX toast; `window.exportRecoveryEvidence()` provides a QUARANTINED envelope (`version:'2026.1-quarantine', quarantined:true, reason`) that `processImport` refuses on the way back in — corrupt bytes never round-trip as a normal backup (R4 P1-4).
- **Boot recovery** (`core.js:initialLoad`): a raw persisted wrapper that Store's parse / migrate / validate rejects preserves `baseWrapperRaw = raw` as evidence and stages a `STORE_CORRUPT_AUTHORITATIVE_STATE` pending durability blocker so ordinary `Store.set/update` refuse until an approved full-state transaction (snapshot restore / import / reset) clears it. Snapshot fallback still runs when a valid snapshot exists, so the app can render; the blocker still fires so writes must go through recovery.

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
- **Store validation is domain-local for FRESH-STATE initialization only.** For fresh storage / a genuinely-absent Gen-1 legacy path, `deriveStateFromLegacy()` synthesizes an envelope from `dune_logbook_v1` and `defaultState()` emits an envelope directly. For every DESTRUCTIVE boundary — `commitFullStateWrapper`, `evaluateCandidateWrapper` (import), `validateSnapshotWrapperFull` (snapshot restore), `migrateAndValidate` (boot) — a persisted current-schema `logbook` that is missing / null / non-envelope / a legacy array is corruption and FAILS CLOSED before any normalization runs. Round-6 (ADR-015 addendum #13) removed the previous branch in `normalizeLogbookDomain` that silently synthesized an empty envelope for `logbook === undefined`, which erased user data on a corrupted persisted authority. Malformed-Logbook-only defects still route to the domain-local recovery UX — the freeze banner names Restore snapshot / Import backup / Reset LIFE OS — rather than a full-state reset.
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
