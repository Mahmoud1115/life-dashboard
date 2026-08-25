# Architectural Decisions — ADR log

Each entry records **one** decision, why it was made, what was rejected, and when. Append only. Never rewrite history — supersede via a later ADR if a decision changes.

Format per ADR: **decision**, **status**, **context**, **decision made**, **rejected alternatives**, **date**, **supersedes / superseded by** (optional).

---

## ADR-001 — Supabase as the future structured backend for Life OS 2.0

- **Status**: Accepted
- **Context**: Life OS 1.0 stores everything in browser `localStorage`. This is fine for one device but has no server-side backup, no cross-device sync (Gist is a workaround, not sync), no multi-user model, and no ability to structure/query data server-side. Life OS 2.0 wants relational structure for domains like sources, review items, and audit history.
- **Decision**: Use **Supabase (Postgres + Auth + RLS)** as the future structured backend, added *behind* the existing GitHub Pages frontend, not as a replacement for it. Only the publishable/anon key and project URL ever reach the browser. Row Level Security scopes every table to the authenticated user.
- **Rejected alternatives**:
  - Firebase — Google lock-in, less SQL-friendly, RLS-equivalent (security rules) is a separate language.
  - Own Postgres + auth server — real infrastructure to operate, not justified for one user.
  - Cloudflare D1 / KV — less mature auth story, unfamiliar territory.
  - Keep everything in `localStorage` + Gist forever — doesn't support the Review Center / AI review architecture at all.
- **Date**: 2026-08-22 (approved after three review rounds — audit + Codex + ChatGPT + Codex)

---

## ADR-002 — Keep vanilla JS + GitHub Pages during the 2.0 transition

- **Status**: Accepted
- **Context**: Life OS 1.0 has no framework, no build step, no bundler. Every temptation to modernize the frontend adds risk and slows migration.
- **Decision**: Life OS 2.0 does **not** rewrite the frontend. The existing HTML/CSS/JS keeps running on GitHub Pages. Supabase integration lands as a small "bridge" layer, not as a frontend framework migration.
- **Rejected alternatives**:
  - React / Vue / Svelte SPA rewrite — high effort, no user-visible payoff for a one-user site.
  - Next.js on Vercel — introduces build step, deployment complexity, node runtime.
  - SvelteKit or Astro — same objection.
- **Date**: 2026-08-22

---

## ADR-003 — Qatar visit goal section removed from UI, state slice retained

- **Status**: Accepted
- **Context**: User no longer wanted the "Visit Mom in Qatar" savings goal as a first-class section. All UI, nav entries, quick-add buttons, calendar events, and derivations were removed.
- **Decision**: Delete the UI end-to-end. **Do not delete** `core.js`'s `qatarVisit` state slice or `derive.qatar*` functions — `validate()` at `core.js:254` requires `qatarVisit` to exist, and removing it would wipe the entire Store to defaults on the next load.
- **Rejected alternatives**:
  - Delete the state slice as well — would break `validate()` and cause catastrophic state loss.
  - Bump `SCHEMA_VERSION` and remove via a migration — possible but higher-risk for a UI change; deferred.
- **Date**: 2026-08-23

---

## ADR-004 — Review Center is informational-only in Phase 1; transactional approval deferred

- **Status**: Accepted
- **Context**: The original 2.0 audit proposed transactional AI-review approval — a Postgres function checks the target record's version, applies the change atomically, and writes the audit event in one transaction. Codex's second review round caught the flaw: **Postgres cannot atomically update a browser's `localStorage`.** In Phase 1, domain records still live in `localStorage`, not Postgres.
- **Decision**: Phase 1's Review Center is **informational only** — AI or system proposes a review item, user reads it, decides approve/edit/defer/dismiss, and if approved, **manually applies the change** in the existing UI. The audit event records the approval, not an automatic write. Transactional approval turns on **per domain**, only after that domain has actually been migrated into Postgres with a real per-record `target_version` column.
- **Rejected alternatives**:
  - Ship transactional approval with client-side "atomic" writes — false claim, race-prone, would violate the "never silently modify important records" principle.
  - Delay the entire Review Center until at least one domain is in Postgres — loses the value of having the review inbox exist for other flag types (inconsistencies, missing info, stale sources).
- **Date**: 2026-08-22 (Rev. 4 of the audit)
- **Supersedes**: informal Section H of Rev. 1-3 of the audit

---

## ADR-005 — BHT AI coach: cloud-key handling disabled outright

- **Status**: Accepted
- **Context**: The BHT subsystem includes an optional AI "coach" that can call Anthropic or OpenRouter directly from the browser using a user-supplied API key stored in `state.bht.ai.apiKey` — which lives inside `dune_state_v4` and therefore rides along with every Gist backup. User has confirmed the feature has **never** been configured.
- **Decision**: Rather than "move the key to a different `localStorage` bucket," disable the direct-from-browser cloud provider call entirely. Local Ollama (which never leaves the machine) can stay reachable. If the feature is ever wanted, rebuild it behind a Supabase Edge Function proxy so the provider key stays server-side.
- **Rejected alternatives**:
  - Move the key to a separate `localStorage` key excluded from `BACKUP_KEYS` — doesn't fix the underlying problem (still XSS-readable, still a plaintext credential in the browser).
  - Encrypt the key in `localStorage` with a user passphrase — added UX friction for a feature never used.
  - Do nothing — leaves a plaintext credential in the backup Gist payload for a feature that isn't even used.
- **Date**: 2026-08-22

---

## ADR-006 — Storage migration direction: Gen-1 → Gen-2 → Supabase, never Gen-1 → Supabase directly

- **Status**: Accepted
- **Context**: The app has two coexisting `localStorage` generations (flat legacy keys and the `dune_state_v4` Store). See `STORAGE_MAP.md`. Migrating two storage systems into Supabase in parallel doubles the migration surface, doubles the failure modes, and produces two irreconcilable sources of truth in Postgres.
- **Decision**: Consolidate Gen-1 into Gen-2 **first**, one domain at a time, each with its own commit. Only then migrate a Gen-2 Store slice into Supabase. Never migrate Gen-1 directly to Supabase.
- **Rejected alternatives**:
  - Migrate Gen-1 keys directly to Supabase — doubles the migration surface and leaves Gen-2 as a stale second source of truth.
  - Leave Gen-1 as permanent legacy — accumulates fragility every time a new feature touches those domains.
- **Date**: 2026-08-24 (ChatGPT / Codex review consensus)

---

## ADR-007 — Motion polish and Life OS 2.0 foundation on separate feature branches

- **Status**: Accepted
- **Context**: Storage and security changes are the highest-risk work in the project. Mixing them into a diff that also contains cosmetic CSS changes makes debugging and rollback harder.
- **Decision**: All cosmetic motion / animation work lives on `feature/motion-polish`. All Life OS 2.0 foundation work (BHT key removal, storage reconciliation, export/restore hardening, docs, later Supabase integration) lives on `feature/supabase-foundation`. Each meaningful change on the foundation branch gets its own commit so a single revert can undo a single concern.
- **Rejected alternatives**:
  - Single working branch — cheaper to type, expensive to debug or roll back.
- **Date**: 2026-08-24

---

## ADR-008 — Public-repo hygiene: no personal user data in commits

- **Status**: Accepted
- **Context**: The repo is public. The user's real dashboard state contains personal financial numbers, mental-health-adjacent behavior tracking data, and other private content.
- **Decision**: Nothing that would appear in a real backup export ever gets committed. Test fixtures use synthetic data (BHT has a `seedSyntheticData()` for exactly this). AI agents (Claude, Codex, subagents) do not write personal content into any repo file. When a review or test requires real data, it's loaded from an out-of-repo file (Downloads, scratchpad) never committed.
- **Rejected alternatives**:
  - `.gitignore` a "backups" folder inside the repo — one accidental commit outside that folder still leaks; better to establish the principle that personal data never enters the repo at all.
  - Make the repo private — user explicitly wants the code public; only the data must stay private.
- **Date**: 2026-08-24

---

## ADR-009 — Dev tooling (npm + Playwright) allowed; runtime remains no-build vanilla JS

- **Status**: Accepted
- **Context**: ADR-002 keeps Life OS on vanilla HTML/CSS/JS served by GitHub Pages — no framework, no bundler, no build step. That decision is about what ships to the browser. It leaves an ambiguity around dev-only tooling: could a test runner ever be added, or does "no build step" forbid `package.json` outright? Regression coverage needs an answer.
- **Decision**: Dev-only tooling (an `npm`-installed `devDependencies` set, currently just `@playwright/test`) is allowed. It is not shipped to the browser, not required to build or run the site, and does not become a deployment prerequisite. GitHub Pages continues to serve the repo root as-is. The site can still be opened locally by pointing any static server at the repo root without ever running `npm install`.
- **Concrete boundary**:
  - Allowed: `package.json` with `devDependencies` only; a committed `package-lock.json` for reproducibility; `.gitignore` entries for `node_modules/` and tool caches; `playwright.config.js`; a `tests/` directory.
  - Not allowed under this ADR: any runtime `dependencies`; any `import`/`require` from `index.html` or the app JS pointing at `node_modules`; any bundler, transpiler, or build script that rewrites shipped assets; any CI step that mutates repo files before Pages deploys them.
- **Rejected alternatives**:
  - Playwright MCP driven manually per session — no CI-runnable regression, no reproducibility, no version pinning.
  - A separate testing repo — duplicates the surface it's testing and drifts.
  - Reading ADR-002 as forbidding `package.json` entirely — over-reads it; the intent was to keep the runtime unchanged, not to ban tooling.
- **Date**: 2026-08-24
- **Relates to**: ADR-002 (does not supersede — narrows the interpretation of its scope to *runtime*)

---

## ADR-010 — B0 Store durability protocol

- **Status**: Accepted (implementation landed on `claude/lifeos-master-handoff-4c2347`, awaiting Codex implementation review before merge)
- **Context**: Before Logbook can safely become the canonical authority (Phase B2), the global Store persistence layer must be safe against stale full-state overwrites, multi-tab races, debounced-flush races, imports bypassing Store, and snapshot/reset replacement races. Prior to B0, `Store.set()` overwrote the entire `dune_state_v4` blob from in-memory optimistic state with no revision, no lock, and no rebase; a second tab could silently erase the first tab's most recent change on its own next flush.
- **Decision** — the reviewed and now-implemented B0 protocol:
  1. **Persisted wrapper schema 13** — `{ version:13, revision:int, committedAt:ISO, data:{} }`. `revision` is a monotonically increasing non-negative integer; `committedAt` is the wrapper-level commit clock. Old schema-12 blobs still load via `migrateUp`. A wrapper with a revision below the currently-known revision is rejected as `STORE_REVISION_REGRESSION`.
  2. **State model split** — `baseState` (last accepted persisted data), `pendingOps` (ordered CAS queue), and `state` = `optimisticReplay(baseState, pendingOps)`. Callers observe the optimistic projection; the base is only advanced by a successful commit or an accepted external event.
  3. **Absent-path-safe CAS operation** — every op carries `beforeExists`/`before` and `afterExists`/`after`. Absent paths are represented by existence flags, never by persisting `undefined`. `Store.set(path, undefined)` is rejected.
  4. **Defensive read boundary** — `Store.get(path)` returns a defensive `clonePersistable` clone; the eight prior mutation-before-set callers now mutate their own copies without corrupting internal state.
  5. **Execute-once updater** — `Store.update(path, fn)` invokes `fn` exactly once immediately on a defensive clone, then enqueues only concrete `before`/`after` intent. The updater closure is never retained or replayed.
  6. **Strict vs optimistic replay** — persistence uses strict replay (compares existence AND value; conflicts when neither the `before` nor `after` shape matches disk). UI uses optimistic replay (baseState + all pending). Same-path chain `A→B, B→C` with external base `C` conflicts on op1 only; `B→C` is not auto-subsumed.
  7. **Conflict lifecycle** — a typed `conflict` record freezes persistence but not enqueueing. Resolution is `use-this-tab` (replace op in-place with `force-set`) or `use-saved-version` (remove only the conflicting op). Banner UI in `index.html` is accessible, keyboard-operable, and never displays raw stored values.
  8. **Persistence coordinator** — same-tab Promise serializer plus `navigator.locks.request('lifeos-state-write-v1', {mode:'exclusive'})` when available. Inside the lock, the read → migrate → validate → rebase → replay → primary write → snapshot write chain stays synchronous.
  9. **Fallback capability** — when `navigator.locks` is unavailable, `Store.capabilities.crossTabSafe === false`. Store remains functional; equal-revision events still trigger a defensive current-disk reread and may adopt/rebase; Phase B2 canonical Logbook authority stays gated on this being `true`.
  10. **Storage-event model** — newer revisions adopt; lower revisions raise `STORE_REVISION_REGRESSION`; equal-revision events with different raw wrapper trigger a current-disk reread and, if the disk still shows the different value, emit `STORE_REVISION_COLLISION` and adopt the disk. Events never trigger a write.
  11. **Full-state transaction freeze** — `import`, snapshot restore, and reset share `beginFullStateTransaction / commitFullStateWrapper / endFullStateTransaction`. During freeze, `Store.set/update` return `FULL_STATE_TRANSACTION_IN_PROGRESS`; storage events are deferred; `endFullStateTransaction` always fires in `finally` and re-reads the authoritative disk.
  12. **Revision exhaustion** — the last accepted revision is `Number.MAX_SAFE_INTEGER`; the next write fails with `STORE_REVISION_EXHAUSTED`. Resetting the counter requires an out-of-band protocol-epoch migration; snapshot restore does not reset it.
  13. **Pure legacy derivation** — `Store.deriveStateFromLegacy(read)` reads only from a caller-supplied reader; the boot path uses live localStorage, the legacy-only import path uses staged auxiliary keys. No live-Store mutation, no wall-clock defaults inside the derivation.
  14. **BHT deterministic boot** — `defaultBhtState()` uses fixed IDs (`b_default_procrastination`, etc.) and a fixed epoch (`DEFAULT_EPOCH_ISO`). `migrateSlice` is pure, returns the same reference when no repair is needed, and never touches `meta.lastUpdated` as a side effect. `ensureSlice` writes only when structural repair or empty-husk reseed is required. Per-action `touch()` is now a no-op; the commit clock lives on the wrapper. Two first-run tabs converge on identical initial slices.
  15. **Phase A Logbook compatibility** — `state.logbook.schemaVersion` stays `1` and `state.logbook.authority` stays `'legacy-mirror'`. Tracker/Builder legacy readers, Home, CSV, and backup summary readers are unchanged. `LOGBOOK.reconcile()` writes via ordinary CAS; if the mirror CAS conflicts, the legacy authoritative writes survive and the mirror recovers on the next reconcile.
  16. **Import capsule** — `dune_pre_import_backup_v1` remains in localStorage after both success and apply failure (preserving `b4083a8` behaviour). Byte-exact rollback of `BACKUP_KEYS`, rollback-failure surfacing, and the state-key-last apply order are unchanged.
- **Rejected alternatives**:
  - **Deep-frozen internal state** — would require rewriting every mutation-before-set caller and interacts poorly with null-prototype `legacyExtra` objects.
  - **Auto-subsumed same-path chains** — masks user intent; conservative pin-only-first is safer.
  - **Reject writes while `conflict !== null`** — silently drops UI actions because current callers ignore Store return codes; freezing only during full-state transactions is safer.
  - **`state.systemMeta` for commit clock** — adds a hidden mutable slice touched by every commit; the wrapper-level `committedAt` is cleaner and reads via `Store.wrapperMeta()`.
- **Date**: 2026-08-25
- **Relates to**: ADR-006 (storage strategy), ADR-002 (no build step — B0 remains vanilla), Logbook Phase A canonical mirror (commit 521fe70).

### ADR-010 addendum (2026-08-25 focused fix pass, post Codex implementation review)

Codex identified P1 blockers on the initial B0 implementation. Repaired items:

- **Coordinated production import.** `app.js:processImport` is now `async` and uses `Store.beginFullStateTransaction / commitFullStateWrapper / endFullStateTransaction` under the coordinator. STATE_KEY is written LAST as a schema-13 wrapper with revision = latest validated disk revision + 1. All callers (file input, clipboard, Gist restore) `await`. Byte-exact rollback of touched auxiliary keys on any apply failure; recovery capsule survives success and failure (unchanged from `b4083a8`). Legacy-only backups derive the candidate via the pure `Store.deriveStateFromLegacy(stagedReader)` reading only the freshly-staged auxiliary keys.
- **Token-guarded full-state API.** `beginFullStateTransaction` mints a token; `commitFullStateWrapper(token, ...)` rejects if no transaction is active or the token doesn't match. `endFullStateTransaction(token)` requires the same token. Fires `lifeos:store-freeze-begin` / `lifeos:store-freeze-end` events so the freeze banner in `index.html` renders during the transaction and hides after.
- **Persistent durability blocker.** Corrupt authoritative wrapper, external `STATE_KEY` clear, and lower-revision + different-raw storage events set a `durabilityBlocker` record. While set, `Store.set/update` return `STORE_DURABILITY_BLOCKED` and flushes reject; recovery is via `Store.clearDurabilityBlocker()` (explicit human intervention) or an approved full-state transaction. `Store.getDurabilityBlocker()` exposes the record. Events: `lifeos:store-durability-blocked`, `lifeos:store-durability-cleared`.
- **Corrupt-state fail-closed under lock.** `commitLocked` now sets the blocker and refuses to overwrite on: corrupt disk wrapper, external clear of an accepted STATE_KEY, or disk revision below the known revision.
- **Coordinator rejection recovery.** `flushChain` now `.catch(recover).then(runCurrent)` — a previous rejection is observed but does not consume the current queued task. Regression: `T-coordinator-recovers`.
- **Frozen subscriber boundary.** `subscribe`, `notify(path)`, `notify('*')`, immediate hydration, and `onSave` all deliver ONE `deepFreezePersistable(clonePersistable(state))` snapshot per notification cycle. Subscribers cannot mutate internal state; `notify('*')` deduplicates callbacks across paths.
- **`clonePersistable` corrections.** Symbol keys hard-reject as `STORE_UNPERSISTABLE` (never silently dropped). Cycle detection uses recursion-ancestry, so shared non-cyclic references are accepted and produce structurally-cloned copies at each site. Actual cycles still throw `STORE_CYCLE`.
- **Wrapper revision validation.** Schema-13 wrappers require `Number.isInteger(revision) && 0 <= revision <= MAX_SAFE_INTEGER`. Non-integer or out-of-range values are corrupt and trigger the durability blocker.
- **Latest-disk revision rule.** `commitFullStateWrapper` uses `diskRevision + 1` exclusively — no `Math.max(diskRevision, knownRevision)` shortcut, no adopting the imported/snapshot revision.
- **Conflict UI initialization.** The banner-wiring script now defers to `DOMContentLoaded` so `window.Store` is always defined when it runs.
- **Freeze UI functional.** Same banner element listens for `lifeos:store-freeze-begin` / `-end` and `lifeos:store-durability-blocked` / `-cleared`.
- **`beforeunload` covers all unsafe states.** `Store.hasUnsavedWork()` returns true for pending ops, active conflict, active full-state transaction, or a durability blocker; the banner script uses it to gate the warning.
- **Storage-event equal-revision reread** happens even with Web Locks available (per Codex §15 correction). Corrupt or regressed disk seen from a storage event sets the durability blocker.

The behavioural claims above are backed by tests in `tests/store-durability.spec.js` (`T-clone-symbol-reject`, `T-clone-shared-ref`, `T-clone-cycle-reject`, `T-wrapper-revision-integer`, `T-corrupt-blocks`, `T-full-state-token-guard`, `T-full-state-freeze-write-rejection`, `T-subscriber-frozen`, `T-coordinator-recovers`, `T-chain-C-use-saved`, `T-derive-pure`) plus the existing baseline suites.

### ADR-010 addendum #2 (2026-08-25 final focused fix pass)

Codex flagged final gaps on `82755f8`. All closed:

- **`endFullStateTransaction` strict token enforcement.** Missing / wrong / stale / double-end tokens now return `FULL_STATE_TRANSACTION_TOKEN_INVALID` and never mutate transaction state.
- **Full-state settlement fails closed.** After the transaction body, settlement rereads authoritative disk. Corrupt wrapper, external `STATE_KEY` clear, and lower revision than the accepted in-memory revision each establish the durability blocker instead of silently adopting. Newer valid wrappers are safely adopted.
- **Import always unfreezes.** `app.js:processImport` now runs the entire post-`beginFullStateTransaction` body inside `try/finally` so `endFullStateTransaction(token)` fires exactly once, including on `localStorage.getItem` failures during `rawBefore` capture.
- **`Store.getConflict` deeply immutable.** Returns `deepFreezePersistable(clonePersistable(conflict))` — external mutation cannot alter queued CAS intent or the resolved committed value.
- **Freeze-end preserves durability-blocker UI.** `index.html` banner listeners route through a single `repaintFreezeState()` that consults `Store.getDurabilityBlocker()` first; blocker banner stays visible after freeze-end.
- **Snapshot degradation surfaced.** `pushSnapshot` now returns `{ok, error?}`; a snapshot write failure after a successful primary commit emits `STORE_SNAPSHOT_DEGRADED` via `Store.onError` — the commit remains accepted, pending ops clear, Store stays usable.
- **Import / snapshot source wrapper revision validation.** Schema-13 source wrappers with non-integer or out-of-range revisions are rejected up front (`IMPORT_SOURCE_WRAPPER_INVALID_REVISION`).
- **`clonePersistable` array + accessor contract.** Arrays reject own symbol keys, indexed accessors (never invoked), non-index own properties, and sparse holes. Objects reject any own accessor (including non-enumerable) and any non-enumerable data property. Getters are never invoked during rejection.
- **True two-page Playwright regression.** `tests/store-two-page.spec.js` opens two pages in the same browser context (shared origin storage) — `T-two-page-A` (unrelated paths merge) and `T-two-page-B` (overlapping path conflict). Web-Lock coordination and storage-event rebasing exercised end-to-end.
- **Deferred storage-event regression.** `T-import-deferred-storage-event` fires a synthetic storage event mid-import and asserts settlement rereads the actual disk rather than trusting the queued payload.
- **Real mirror-conflict regression.** `T-mirror-conflict-real` drives `LOGBOOK.reconcile` and verifies legacy Tracker data survives a mirror CAS conflict with `authority='legacy-mirror'`.
- **Import test isolation.** `tests/import-restore.spec.js:waitReady` flushes boot writes before every test runs; T2/T2b/T4/T11 now compare STATE_KEY against a captured baseline instead of asserting `null` (the race the old assertions exploited is gone).

The behavioural claims above are backed by tests: `T-end-token-required`, `T-settlement-lower-rev`, `T-settlement-cleared`, `T-settlement-corrupt`, `T-import-always-unfreezes`, `T-conflict-immutable`, `T-snapshot-degraded`, `T-import-source-wrapper-invalid`, `T-clone-array-symbol`, `T-clone-array-getter`, `T-clone-object-getter`, `T-import-deferred-storage-event`, `T-mirror-conflict-real`, `T-two-page-A`, `T-two-page-B`.

### ADR-010 addendum #3 (2026-08-25 final merge-gate fix pass)

Codex's remaining findings on `bc3c075`, all closed:

- **Snapshot source wrapper validation covers BOTH paths.** `core.js:isValidSnapshotWrapper` gates schema-13 snapshots: `revision` must be a finite integer in `[0, MAX_SAFE_INTEGER]`. Malformed schema-13 wrappers are rejected in `restoreFromSnapshot()` (load-recovery path) and by `Store.restoreSnapshot(i)` (explicit-restore path, which returns `{ ok:false, error:'SNAPSHOT_SOURCE_WRAPPER_INVALID' }`). No Store mutation and no fresh wrapper written from bad source. Schema-12 sources remain migratable. Regressions: `T-snapshot-source-invalid-explicit`, `T-snapshot-source-invalid-recovery`.
- **Canonical ECMAScript array-index classification.** `core.js:isCanonicalArrayIndexKey` matches integers in `[0, 2^32 - 2]` whose decimal-string representation is exactly the property name. `"4294967295"` is not a valid array index and now rejects as `STORE_UNPERSISTABLE`. `"00"`, `"01"`, `"-1"`, `"1.0"`, `" 1"`, `"1 "` all reject. Regressions: `T-array-key-4294967295-reject`, `T-array-key-4294967294-valid`, `T-array-key-leading-zero-reject`.
- **Deterministic legacy derivation.** `defaultState({ deterministic:true })` is a wall-clock-free variant used only by `deriveStateFromLegacy`; passive migration/import candidate construction produces byte-equivalent results across calls. `nowISO()` still governs live user actions everywhere else. Fixed epoch `DETERMINISTIC_META_ISO = '2026-06-01T00:00:00.000Z'`. Regression: `T-legacy-derive-deterministic`.
- **Forced two-page Case B.** `tests/store-two-page.spec.js:T-two-page-B-forced-conflict` guarantees deterministic ordering: page A commits before B flushes, and a storage-event guard on B prevents rebase between enqueue and flush. Asserts `flushRes.reason === 'CONFLICT'`, `Store.getConflict()` non-null, `conflict.path === 'goals.__b0_tpConflictForced__'`, B's optimistic value equals the local intent, disk value equals A's commit. Then `use-saved-version` converges B to A's value on disk.
- **Forced real mirror-conflict.** `T-mirror-conflict-real-forced` drives `LOGBOOK.reconcile()` for a real Tracker write, enqueues a materially-different mirror op with a distinct `drift`, then commits a conflicting mirror at a higher revision via disk mutation. Flush returns `CONFLICT`, `conflict.path === 'logbook'`, legacy Tracker record intact, `state.logbook.authority === 'legacy-mirror'`.
- **Forced coordinator recovery.** `T-coordinator-recovers-forced` deterministically forces a coordinator task rejection (monkey-patched `commitFullStateWrapper` returning `Promise.reject`), then queues a subsequent normal write and asserts exactly one rejection, exactly one subsequent flush execution, and the correct final state/revision.
- **Docs accuracy.** `ARCHITECTURE.md` corrected: the BHT AI apiKey claim now reflects ADR-005 (apiKey is stripped, never persisted), and the legacy-derivation description reflects the wall-clock-free, in-production behavior (no "future" wording). ADR-010 addendum #2/#3 record the now-real behaviour; nothing here is aspirational.

Tests: 129/129 passing (85 baseline + 42 store-durability + 2 two-page).

### ADR-010 addendum #4 (2026-08-25 proof + snapshot data-validation pass)

Codex's remaining findings on `ee6fb95`, all closed:

- **Snapshot data validation.** `core.js:validateSnapshotWrapperFull(parsed)` runs the wrapper structural gate AND `migrateUp` AND `Store.validate` before any snapshot is accepted. Both paths use it: `Store.restoreSnapshot(i)` returns `{ok:false, error:'SNAPSHOT_SOURCE_WRAPPER_INVALID'}` on data-invalid schema-13 wrappers with no state mutation; `restoreFromSnapshot()` (load-time recovery) skips data-invalid snapshots and continues iterating to the next recoverable one. Regressions: `T-snapshot-source-invalid-data-explicit` (six invalid `data` shapes), `T-snapshot-source-invalid-data-recovery` (bad-data at index 0, valid at index 1 → salary=24680 recovered).
- **Real coordinator-chain recovery.** `T-coordinator-recovers-real-lock-rejection` patches `navigator.locks.request` for exactly one call to return `Promise.reject`, then restores. The next real `withCoordinator` invocation enters the real navigator.locks callback exactly once and commits. The previously-rejected task's write survives in the queue and lands with the next commit (single revision bump). Skips gracefully if `navigator.locks` unavailable in the harness.
- **Reconcile-generated mirror conflict.** `T-mirror-conflict-real-reconcile-generated`: seeds a Tracker legacy entry, calls production `LOGBOOK.reconcile()` to establish an accepted mirror, mutates legacy to a fresh 2-entry state, poisons the disk mirror at a higher revision with an empty-entries envelope, then calls production `LOGBOOK.reconcile()` again — the conflicting pending op is generated ENTIRELY by production reconcile, no `Store.set('logbook', ...)` from the test. Flush returns `CONFLICT` on `logbook`; optimistic mirror has 2 entries; disk mirror has 0; legacy Tracker intact; `authority === 'legacy-mirror'`.
- **Boundary-exercising array-index test.** `Store._test_isCanonicalArrayIndexKey` is a test-only public reference to the internal helper. `T-array-index-max-valid` asserts `isCanonicalArrayIndexKey('4294967294') === true`; `T-array-index-max-plus-one-invalid` asserts `('4294967295') === false`. No 4.29-billion-slot array is allocated.
- **Docs.** `ARCHITECTURE.md`: the old "known correctness gap" wording for `processImport` is replaced by the current B0 coordinated-import description (freeze protocol, coordinator, schema-13 wrapper written last with `diskRevision + 1`, guaranteed `endFullStateTransaction` in `finally`, byte-exact rollback, capsule preservation, awaiting callers). ADR-010 addendum #4 records these fixes; no aspirational wording remains.

Tests: 135/135 passing (85 baseline + 48 store-durability + 2 store-two-page).
