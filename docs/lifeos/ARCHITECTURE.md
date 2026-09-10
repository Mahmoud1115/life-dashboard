# Architecture — as of 2026-09-10

Snapshot of how the code actually works today. Update when reality changes, not when a plan changes.

## Runtime

- Static site. `index.html` loads 15 same-origin `<script>` tags in a fixed order, one Google Fonts stylesheet, everything else self-hosted.
- No runtime framework, build step, or bundler. `package.json` is dev-tooling only (ADR-009).
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
One versioned JSON blob under `dune_state_v4` (schema `SCHEMA_VERSION = 13` — B0 wrapper: `{version, revision, committedAt, data}`). Owns:
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
- Rolling snapshot buffer (`dune_snapshots_v1`, max 8) — outer format `[{at, payload}]` unchanged; payload is a schema-13 wrapper.
- Forward-only migration chain in `migrateUp()`; schema-12 blobs still load and are re-wrapped as schema-13 on the next commit.
- Validate-on-load — missing `qatarVisit`/`money.salary_net` → snapshot recovery, then legacy migration.
- **Revision exhaustion** — the last accepted revision is `Number.MAX_SAFE_INTEGER`; the next write fails with `STORE_REVISION_EXHAUSTED`.
- **Pure, deterministic legacy derivation** — `Store.deriveStateFromLegacy(read)` reads only from a caller-supplied reader; no live localStorage access when a reader is supplied, no wall-clock (uses a fixed `DETERMINISTIC_META_ISO` epoch), no random defaults. Used by boot (live-localStorage reader) and by `processImport`'s legacy-only import derivation (staged-key reader). Same reader → byte-equivalent candidate across calls.

See `docs/lifeos/DECISIONS.md` ADR-010 for the full protocol.

### The bridge
`core.js`'s `migrateFromLegacy()` reads Gen-1 keys **once, on first load**, to seed `dune_state_v4`. After that, Gen-1 code keeps writing legacy keys independently — **with two live reconciliation exceptions**: Money-Russia (Gen-1 `dune_finance_v1.russia` shadowed one-way into `state.money`) and Logbook (Tracker + Builder legacy sources reconciled into `state.logbook` on boot and after every add/delete write, `authority: 'legacy-mirror'`). For all other domains (EASA, Goals, Apartments, Study Board, …), the Gen-1 key remains the write-authoritative source and the corresponding field inside `dune_state_v4` may be empty or stale. See `STORAGE_MAP.md`.

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

## Sync (Gist) — base-aware concurrency (schema 1)

Manual backup synchronization to a private GitHub Gist. User-initiated only, never automatic. Not multi-device continuous sync.

**Architecture.** All Gist-Save/Load orchestration lives in `gist-sync.js` (`window.GistSync`). `app.js` retains only `getAllBackupData` and `processImport` (the safe full-state import path); Save/Load window functions are overwritten to route through the module.

**Sync base (authoritative concurrency record).** `dune_gist_sync_base_v1` (schema 1) is a single JSON object outside `BACKUP_KEYS`:

```json
{ "schema": 1, "gistId": "...", "remoteVersion": "<gist-history[0].version>",
  "baseDataHash": "<sha-256 hex>", "acceptedAt": "<ISO>" }
```

- `baseDataHash` is a SHA-256 of a **canonical semantic JSON** rendering of the `backup.data` object (key-sorted objects, preserved arrays, no outer `exported_at`/`version`, no `dune_change_count_v1`). Store transaction metadata that `processImport` necessarily regenerates—`dune_state_v4.revision`, `committedAt`, and `data.meta.lastUpdated`—is also excluded. The generic `canonicalHash` helper remains byte-semantic and does not apply this normalization.
- `remoteVersion` is the Gist `history[0].version` revision SHA (or a `node_id@updated_at` fallback if history is unavailable).
- A base is accepted only if all five fields are present and strictly valid: schema 1, bounded non-whitespace Gist/revision identifiers, an exact 64-hex SHA-256, and a parseable timestamp. Malformed records are never concurrency authority.
- The base is written only after a successful Save/Load and **read back byte-for-byte, reparsed, and revalidated** in the same call. Every failed write/readback invalidates and attempts to remove the base; an in-memory fail-closed latch prevents stale bytes from becoming authoritative even if removal is swallowed.
- Ownership check: a strict `syncBase.gistId` and the active, verified `dune_gist_id_v1` must both equal the requested Gist. Mismatch → treated as absent (bootstrap).
- If SHA-256 (`crypto.subtle.digest`) is unavailable, Save/Load refuse with a truthful "sync unavailable" message and perform no destructive operation. There is no fallback hash; sync identity has one algorithm.

**Four-state classifier.** Given `localHash`, `remoteHash`, `remoteVersion`, and `base`:

| local vs base | remote-hash vs base | remote-version vs base | Kind |
|---|---|---|---|
| = | = | = | `synced` |
| = | = | ≠ | `synced-revision-drift` (Gist revision advanced without backup content change — e.g., unrelated file added) |
| = | ≠ | — | `remote-only` |
| ≠ | = | — | `local-only` |
| ≠ | ≠ (localHash = remoteHash) | — | `converged` (both drifted to identical content) |
| ≠ | ≠ (localHash ≠ remoteHash) | — | `conflict` |
| base absent / non-owned | — | — | `no-base` |

**Save.** Preflight → fetch the exact connected Gist (no discovery retargeting) → hash local + remote → classify → dispatch by kind. `local-only` performs an immediate second exact-Gist GET and requires the same Gist ID, revision, and semantic hash before PATCH; it then refetches, verifies `remoteHash === localHash` and a newly advanced revision, and persists a verified base. `converged` accepts the already-identical remote as the new base without PATCH. `remote-only`, `conflict`, and `no-base` refuse; `synced` is a no-op; `synced-revision-drift` refreshes only the base revision.

GitHub's Gist Update endpoint does not document an atomic conditional `PATCH` or an `If-Match` precondition for this unsafe method. The second GET closes the observed stale-classification window, but a residual provider race remains between that GET and PATCH. A post-PATCH semantic-hash and revision acknowledgement prevents the client from claiming a trusted base when the result cannot be proven; it cannot make the provider write itself atomic.

**Load.** Same classifier. Destructive path (`remote-only`) runs in this exact order:
1. Explicit confirmation (`processImport` runs the normal `confirm()`; a resolver that already displayed the same destructive confirmation passes a narrow `{confirmed:true}` option so it is not asked twice).
2. Rotate the recovery capsule: copy `dune_pre_import_backup_v1` (if any) to `dune_pre_import_backup_prev_v1` and read-back-verify byte-for-byte. **Rotation is a hard gate — on any failure, destructive Load is refused before `processImport` is ever invoked.**
3. Invoke `processImport(remoteContentText)`.
4. Recompute the semantic backup hash and assert it equals `remote.remoteHash`; on mismatch, clear sync base and refuse to claim synced.
5. Write and read-back-verify sync base.

`local-only` refuses (Save-first prompt). `conflict` refuses. `no-base` refuses (bootstrap). `synced` is a no-op. `converged` advances the verified base to the shared content/revision without importing or PATCHing.

**Pre-Load recovery.** `processImport` writes `dune_pre_import_backup_v1` before applying. `gist-sync.js` rotates that capsule into `dune_pre_import_backup_prev_v1` (one generation) before allowing the next destructive Load, so a second Load cannot silently destroy the only remaining pre-Load recovery point. A confirmation-gated Restore action hands each capsule back through `processImport`—bytes never enter Store directly. Restoring the current capsule retains the fresh capsule created by that import, enabling an immediate second Restore as undo; restoring the previous generation consumes only the previous slot.

**Discovery vs. connected identity.** Discovery of matching backup Gists happens only in `bootstrapOrReconnect` (explicit user action). The selected ID is serialized, read back byte-for-byte, and normalized before success is acknowledged; a failed acknowledgement clears base authority. Ordinary Save/Load targets exactly that verified `dune_gist_id_v1`; multiple matches never silently retarget. If the selected local and remote data differ, bootstrap remains base-less and exposes dedicated **Use Local** and **Load Remote** resolvers. Use Local confirms, byte-verifies a prior-remote audit record, revalidates the remote generation, then follows the guarded Save path. Load Remote preserves local recovery evidence, confirms, revalidates the remote generation, and executes the real destructive import. A connected-Gist 404 clears base authority and exposes reconnect without choosing another Gist.

**Import:** `app.js:processImport` remains an `async` full-state transaction. Preflight → confirmation (unless the calling resolver already confirmed) → `beginFullStateTransaction({force:true, reason:'import'})` → snapshot byte-exact `BACKUP_KEYS` → write recovery capsule (`dune_pre_import_backup_v1`, preserved after success and failure) → apply non-`dune_state_v4` keys → derive candidate → `validateData` → `commitFullStateWrapper` writes `dune_state_v4` LAST as a schema-13 wrapper. The optional confirmation acknowledgement changes no transaction, validation, recovery, or rollback invariant.

**Security note.** The PAT is deliberately excluded from `BACKUP_KEYS`. `state.bht.ai` no longer carries an `apiKey` field (ADR-005). BHT AI provider config is fallback/ollama only; nothing that touches a network key is persisted.

**Legacy metadata (kept for continuity, no longer authoritative).**

| Key | Role after this task |
|---|---|
| `dune_gist_remote_updated_v1` | Display only — never read for classification. |
| `dune_last_gist_sync_v1` / `dune_last_backup_v1` | Display only — pill / "Last synced". |
| `dune_change_count_v1` | Display only — hash is authoritative dirty state. |

**UI copy — device attribution.** The previous "Another device saved newer data" copy has been removed. Device identity is not modeled: the classifier reports what actually changed on each side without unsupported attribution.

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
