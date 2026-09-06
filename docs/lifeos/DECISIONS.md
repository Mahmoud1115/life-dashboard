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

### ADR-010 addendum #5 (2026-08-25 coordinator exact-once proof)

Codex's final remaining finding on `d3ba2c4` was that the committed coordinator regression did not yet prove the exact-once contract at the strength Codex verified independently. Addressed here without changing production source (Codex previously confirmed the production coordinator is correct):

- **Regression name:** `T-coordinator-recovers-real-lock-rejection-exact-once` (supersedes the earlier weaker `T-coordinator-recovers-real-lock-rejection`).
- **What the test proves at the real coordinator boundary:**
  - `navigator.locks.request` is patched once. Lock-request invocations and lock-callback executions are counted **separately** (they are not the same metric).
  - The first matching `('lifeos-state-write-v1', ...)` request returns `Promise.reject(new Error('TEST_LOCK_REJECTION'))` without invoking the supplied callback → `rejectionCount === 1`.
  - Subsequent requests delegate to the original `navigator.locks.request`, wrapping the supplied callback to bump `callbackExecutionCount` before invoking the real callback.
  - After Task A is submitted and observed to fail via the coordinator's `.catch(recover)` path, Task B is submitted. Assertions: `callbackExecutionCount === 1` (exactly one supplied callback executed), `taskBResult.committed === true`, `taskBResult.revision === startRevision + 1`, `finalRevision - startRevision === 1`.
  - The rejected Task A op is not dropped by design: its CAS op remains in `pendingOps` and lands together with Task B in B's single committed generation. The test explicitly asserts both `finalA === 'A-intended'` AND `finalB === 'B-intended'` — matching the actual B0 pending-op retention semantics.
- **Determinism:** the harness idles via two consecutive `flushNow()` calls (with a 50 ms yield between them) before capturing `startRevision`. Runs cleanly 3× in a row.
- **Skip behaviour:** if `navigator.locks` is unavailable in the harness the test skips (not fails), because it is by definition a real-lock-boundary probe.
- **Earlier coverage:** `T-coordinator-recovers` (initial B0 landing) and `T-coordinator-recovers-forced` (single-call `commitFullStateWrapper` monkey-patch) are retained as earlier synthetic API-level coverage; they are superseded, in terms of coordinator-chain proof, by the exact-once real-lock regression above.

Wording carried forward from earlier ADR-010 addenda that referred to weaker coordinator coverage as if it proved the same invariants should now be read alongside this addendum: only `T-coordinator-recovers-real-lock-rejection-exact-once` proves the "one lock rejection → one subsequent callback → one revision bump" contract at the real coordinator boundary.

Tests: 135/135 passing (85 baseline + 48 store-durability + 2 store-two-page).

## ADR-011 — Persisted-content rendering safety (B1)

**Status:** Accepted (2026-08-25).
**Applies to:** Any DOM sink or CSV/export sink that renders persisted
(user-controlled or restore-imported) content. Logbook Tracker, Logbook
Builder, Logbook CSV, global Search, Apartments, and Life Timeline are
the initial in-scope surfaces. ADR-011 governs contextual output safety,
not input cleansing.

**Context.** Life OS 2.0 persists user-authored records in localStorage
and accepts them back through `processImport`. Import cannot certify the
contents. Before Phase B2 flips Logbook authority to the Gen-2 canonical
mirror, every path that renders or exports persisted data must be safe
against stored XSS, executable ID interpolation, and CSV formula
injection — regardless of whether the payload was typed by the user, sat
in an old backup, or arrived via restore.

### Rules (R1–R8)

- **R1.** No user-controlled Logbook field enters `innerHTML`,
  `outerHTML`, or `insertAdjacentHTML`.

- **R2.** Dynamic persisted-content rendering uses contextual DOM APIs:
  `document.createElement`, `textContent`, `classList`, `dataset`,
  `DocumentFragment`, `replaceChildren`, `addEventListener`. ADR-011 does
  not claim every renderer in the app has been migrated — R2 applies to
  the surfaces enumerated above and to every new persisted-content
  renderer added after this ADR.

- **R3.** Dynamic persisted-content actions do not interpolate
  user-controlled values into inline JavaScript (`onclick=`, `onchange=`,
  `oninput=`, `href="javascript:…"`). Static author-controlled inline
  handlers on markup that does not interpolate persisted content may
  remain.

- **R4.** Record IDs are opaque data. They may be assigned via
  `element.dataset.*`, but never interpolated into JavaScript source
  strings, HTML source strings, or raw CSS selector source. DOM lookup
  of a record uses `closest('[data-…]')` and reads the raw id from
  `dataset`; a `Map` keyed by raw ID or a direct element reference is
  also acceptable.

- **R5.** CSV export policy:
  - Text cells are quote-and-escape (`"…"`, embedded `"` doubled) and
    are apostrophe-prefixed when the first character is `=`, `+`, `-`,
    `@`, TAB, CR, LF, or the full-width forms `＝`, `＋`, `－`, `＠`.
  - Numeric cells are written unquoted only when the value satisfies
    `typeof v === 'number' && Number.isFinite(v)`. Numeric-looking
    strings (`"12"`, `"-5"`, `"1e3"`) go through the text path.
  - Date cells are written unquoted only when the value is a strictly
    valid `YYYY-MM-DD` calendar date (both format and calendar
    validity — `2026-02-31` and `2026-13-10` are rejected). Malformed
    dates go through the text path.
  - Output uses CRLF line endings and a UTF-8 BOM.
  - Neutralization modifies export output only; stored values are never
    rewritten.
  - **Cross-spreadsheet limitation.** The apostrophe-prefix defence is
    the widely-recommended mitigation for spreadsheet formula
    injection, but behaviour differs across Microsoft Excel,
    LibreOffice Calc, Google Sheets, and raw CSV consumers. ADR-011
    treats R5 as risk reduction, not a universal guarantee of
    non-execution across every consumer.

- **R6.** Import and restore do not cleanse content for rendering
  safety. Persisted data remains round-trip faithful. Safety is
  enforced contextually at each render/export sink.

- **R7.** Malformed-but-import-accepted persisted members — `null`,
  primitives, `{}`, `[]`, missing fields, wrong-typed fields, IDs of
  arbitrary shape, and objects whose own `toString` / `valueOf` are
  shadowed with non-callable values (hostile coercion) — do not crash
  the enumerated B1 render / export / action surfaces, and are not
  silently rewritten merely by viewing or exporting them. Safe coercion
  at the sink uses a local helper that catches `String(v)` throws
  (`_b1SafeText`, `_b1SafeNumber`, `_b1SafeDateValue` in `app.js`);
  bare `String(v ?? '')` is not sufficient as an R7 boundary because
  ToPrimitive on a hostile object throws `TypeError`. Enumerated
  surfaces: Home Logbook metric card, Tracker (`renderStats`,
  `renderATACoverage`, `renderTable`, delegated delete), Builder
  (`renderLogbookBuilder` aggregation, `lbbRenderEntries`, `lbbSearch`,
  `lbbCopyEntry`, `lbbReuseEntry`, `lbbDeleteEntry`), Logbook CSV
  (`lbbExportCSV`), global Search (`doSearch`), Apartments
  (`renderApartments`, sort, `aptDelete`, `aptToggleWinner`), Life
  Timeline (`wireTimeline` render, sort, `deleteTimeline`). R7 makes no
  claim about non-enumerated surfaces.

- **R8.** Delegated action handlers use a fixed action allowlist,
  validated indices where indices are used, opaque `dataset` IDs, and
  exactly-once handler binding (a `dataset.b1Bound === '1'` guard, or
  equivalent, on the delegate container).

### Non-goals

ADR-011 does not attempt to sanitize stored data, does not extend
persisted-content safety to non-persisted surfaces (author-controlled
static markup, computed numeric aggregates, in-file constants), and
does not certify every future spreadsheet client's behaviour. Extending
R1–R8 to other persisted-content sinks (Ideas, BHT, Reviews, Decisions,
Deadlines beyond the confirmed P0 set) is a separate scope decision, not
a B1 deliverable.

## ADR-012 — Risk-tier review and evidence policy

**Status:** Accepted (2026-08-28).
**Applies to:** every pull request, review request, and merge into
`main` in this repository. Applies uniformly whether the author is
Claude Code, Codex CLI, ChatGPT-assisted, or a human maintainer.
**Applies to Layer 1** per the Council doc hierarchy: this ADR is
project-owned truth. Agent-instruction files (`CLAUDE.md`,
`AGENTS.md`) link to this ADR; they do not restate it.

**Context.** B0 and B1 landed with heavy multi-model review round-trips
on every commit. The safety of that pattern was appropriate for storage
durability and security work but is not sustainable if applied
uniformly to every change. Life OS is a single-user project; a
one-line CSS fix and a canonical-authority cutover must not attract
the same review cost. This ADR pins a three-tier risk model that
right-sizes the review effort.

### The tiers

**LOW.**
- Examples: docs, copy, isolated CSS, non-persisted UI polish, narrow
  dev tooling, small tests-only PRs, one-file bug fix in a domain
  whose invariants are stable.
- Deterministic evidence: the deterministic CI baseline (Playwright
  full suite + `node --check` on tracked `.js` files + `git diff
  --check`).
- Independent reviewer: not required. Author self-merges once CI is
  green.

**MEDIUM.**
- Examples: a bounded feature in one domain, a persisted-content UI
  change, a bounded refactor, a new low-risk Gen-2 product slice with
  no authority change, a new test file, adding a key to `BACKUP_KEYS`.
- Deterministic evidence: the deterministic CI baseline plus targeted
  domain behavior tests, smoke or compatibility as relevant, and a
  written rollback note in the PR description.
- Independent reviewer: one focused reviewer where persistence,
  cross-domain behavior, or user-facing surface warrants it.

**HIGH.**
- Examples: storage schema, authority cutover, migration, transaction
  or coordinator changes, operation journal, import/restore, snapshot
  or reset lifecycle, backup or recovery mechanisms, secrets or auth
  or RLS, sync, external transactional actions.
- Deterministic evidence: architecture approval, the full deterministic
  suite, per-scenario fault/crash evidence where applicable, recovery
  and rollback proofs, deployment verification where applicable.
- Independent reviewer: one — the reviewer must be independent from
  the authoring session (Codex CLI reviews Claude-authored HIGH work,
  and vice versa; not another session of the same authoring tool).
- Human approval: explicit user approval at any irreversible gate
  (merge to `main`, deploy, authority flip, retirement, restore).

### Firm rules

- **HIGH never becomes MEDIUM** merely because review took a long time.
  The tier is a property of the change, not the review latency.
- **CI-green is a required status check on `main`** (enforced via the
  main-branch ruleset). No reviewer may bypass it.
- **Bounded review loops:** maximum two revisit rounds per task
  (defined in `council/README.md`). After that, the user decides.
- **One implementer per PR** (see the one-implementer rule in the
  Council doc). Two models never write the same PR simultaneously.
- **Multiple simultaneous AI reviewers are not required by default.**
  If a reviewer experiment adds one, it lands as its own ADR with
  measured material-finding evidence.

### Non-goals

ADR-012 does not:

- specify which reviewer tool must be used (that is per-task);
- mandate a specific CI provider beyond "the project's canonical CI";
- require CodeRabbit, GitLeaks, Semgrep, hosted telemetry, or any other
  third-party check as default;
- automate risk-tier assignment. The author declares the tier in the
  PR description; a reviewer may disagree and request escalation.

### Rejected alternatives

- Applying B0-scale independent review to every PR (rejected: unsustainable).
- Trusting the author's judgment alone for HIGH-risk work (rejected:
  ADR-005/006/007 exist precisely because unreviewed HIGH-risk work
  went wrong before).
- A single flat review policy (rejected: over-invests on LOW,
  under-invests on HIGH).

**Supersedes:** the implicit CLAUDE.md / AGENTS.md line
"High-risk changes require independent Codex/ChatGPT review before
merge" — that line remains true, but this ADR is the primary source
of the tier definitions. Agent-instruction files link here.

## ADR-013 — Never-autonomous operations policy

**Status:** Accepted (2026-08-28).
**Applies to:** every AI worker (Claude Code, Codex CLI, ChatGPT,
future models), every hook, every scheduled job, every automated
workflow, and every third-party integration.

**Context.** As the workflow grows to accommodate multiple models and
agent instruction files, there is a real risk that a scheduled job,
a hook, an MCP tool, or a per-model instruction file will make
autonomous decisions on operations that are not safely reversible.
This ADR pins the class of operations that no automation of any kind
may perform without explicit per-instance human approval.

### The list — operations no automation may perform autonomously

- Merge to `main`.
- Bypass a required CI status check.
- Push a tag or release to `origin`.
- Deploy any change that touches HIGH-risk authority or storage.
- Restore production user data from any backup source.
- Reset production user data.
- Flip storage authority (Logbook or any future canonical domain).
- Retire a legacy authority key.
- Delete a backup or recovery generation.
- Rotate or change credentials (GitHub PAT, any API key, any secret).
- Perform any financial transfer, purchase, or payment.
- Make an aviation maintenance decision or claim
  approved-maintenance-data authority.
- Upload proprietary, OEM, or company-confidential aviation content
  to any external AI provider or third-party service.
- Send an outbound message on behalf of the user (email, chat, DM,
  calendar invite, form submission) without explicit per-message
  approval.
- Change GitHub repository settings (branch protection, ruleset, MCP
  permission, integration OAuth scope).

### Clarifications

- "Autonomous" means "without an explicit per-instance human approval
  at the moment of the action." A general standing consent recorded
  in an ADR is not per-instance approval.
- "Automation" includes: scheduled GitHub Actions jobs, MCP tools
  called during an agent session without user prompt, hooks
  (PreToolUse / SessionStart / etc.), any scripted workflow that runs
  without a real-time human present.
- **Some of the operations above may later be performed by an AI
  worker with explicit per-action human approval.** This ADR
  prohibits only the *autonomous* case; the approved case is
  governed by the workflow that requests the approval.

### Rejected alternatives

- Encoding this policy solely in agent-specific files (`CLAUDE.md`,
  `AGENTS.md`) — rejected: those files are Layer 2 and rot when a
  Layer 1 rule changes. Rules live in Layer 1.
- Rely on human vigilance during hook design — rejected: the list
  is easier to consult than to remember.
- Prohibit ALL AI writes — rejected: too restrictive for daily
  implementation work. The policy targets the irreversible class only.

### Enforcement

- Any hook, MCP tool, or scheduled workflow that attempts to perform
  an operation on this list without per-instance approval must be
  disabled and reviewed.
- CI is not on this list; CI is deterministic evidence, not an
  autonomous actor. A CI-green build does not by itself authorize any
  operation above; the merge / deploy / restore is a separate human
  act.

### Supersedes

- No prior ADR. Consolidates warnings scattered across previous
  strategic reviews and the Council architecture review of 2026-08-28.

### ADR-013 addendum #1 (2026-08-28 personal-data egress + deployment approval semantics)

Codex's Round 1 audit of the AI Council V1 branch flagged that the
personal-data egress rule existed only in Layer 2 docs (`CLAUDE.md`
/ `AGENTS.md` guidance and the Council README) and was not
canonical at Layer 1. This addendum pins the egress rule as Layer 1
truth (P1-7 remediation on the AI Council V1 branch).

**Canonical rule.** No automation of any kind may transmit raw or
private user data to any of the following without explicit
per-instance human approval:

- external AI providers (Anthropic, OpenAI, Google, Alibaba,
  Mistral, Cohere, any other hosted model provider);
- hosted MCP services;
- third-party SaaS integrations;
- remote telemetry / debugging / error-tracking services;
- cloud logging or monitoring endpoints;
- any host outside the user's own browser or a local process running
  under the user's direct control.

**Data classes covered — non-exhaustive:**

- Money values (rent, salary, expenses, savings, custom rows).
- Health data.
- Journal content, decision text, weekly review notes.
- Contacts.
- Real Logbook entries (Tracker AND Builder), unredacted.
- Real Apartments listings with personally identifying addresses.
- Real backups (file / clipboard / Gist).
- Real exports.
- Credentials (GitHub PAT, any API key, any secret).
- Unredacted diagnostic bundles.
- Any content the user has flagged as private.

**Allowed by default** (subject to repository confidentiality per
ADR-008 and to any per-provider allowlist declared in Layer 2):

- Source code in this repository.
- Architecture, ADR, and roadmap documents.
- Synthetic test fixtures under `tests/fixtures/**` provided they
  contain no real user data.
- Redacted diagnostics — output of `lifeos diagnostics` or the
  in-app `#health` panel, which by design emit key NAMES and byte
  SIZES only, never values.
- Redacted CI logs — Playwright artifacts, because tests use
  isolated in-page synthetic localStorage and the CI harness has
  no real user profile.

**Local-model clarification.** A cloud-model CLI running locally
(e.g. Claude Code CLI, Codex CLI) still transmits every message it
sends to an external provider's API. "Local" refers to the process
location, not the data path. The egress rule applies to those CLIs
identically: real personal data does not flow into their prompts
without explicit per-instance human approval.

**Deployment approval semantics.** GitHub Pages automatically
deploys `main` on every merge. Explicit human approval to merge a
PR to `main` counts as approval for the known automatic deployment
of that PR's contents to the public GitHub Pages site. Do not
require a second redundant approval click for the same
deterministic consequence, **unless** the deploy itself is
separately HIGH-risk (e.g. an authority-cutover, a change that
would broadcast previously-private data, a change that modifies
the site's outbound network footprint), in which case the deploy
requires its own per-instance approval distinct from the merge
approval.

No autonomous merge remains allowed. The user's merge click is the
approval; automation never produces it.

**Enforcement.** Any process (hook, MCP tool, scheduled workflow,
scripted `gh api` call, agent skill) discovered to be transmitting
personal data outside this rule must be disabled and reviewed. The
`.claude/agents/**` drift audit convention (per the reviewer md and
council/README.md) is the routine check.

## ADR-014 — Backend and per-domain migration policy (supersedes parts of ADR-001 and ADR-006)

**Status:** Accepted (2026-08-28).
**Applies to:** every future decision about backend adoption
(Supabase or alternatives), sync architecture, and per-domain
Gen-1 → Gen-2 consolidation.
**Supersedes:** ADR-001's inevitable-Supabase framing; ADR-006's
implicit universal Gen-1 → Gen-2 mandate. ADR-001 and ADR-006 are
NOT edited in place — their history is preserved and this ADR
governs going forward.

**Context.** ADR-001 (Supabase as the future structured backend)
and ADR-006 (Gen-1 → Gen-2 → Supabase, one domain per commit) both
framed Supabase adoption as inevitable. Since then, three factors
have accumulated evidence:

- The single-user constraint has held. No cross-device, multi-user,
  or relational-query pain has been measured that a backend would
  uniquely solve.
- Migrating every legacy domain "for architectural purity" is a
  cost the project cannot amortize — several legacy domains
  (Deadlines, Ideas, Claims, EASA) are stable and produce no user
  value from canonicalization.
- Money remains high-blast-radius (custom row shapes + one-way
  Russia finance bridge per commit `89728eb`); forcing it through
  a generic per-domain migration is a legitimate "never" decision,
  not a "later" decision.

**Decision.** The backend and per-domain migration policy is now:

- **Backend adoption is trigger-driven, not scheduled.** Supabase
  (or the best alternative at the time) is evaluated only when one
  of the following triggers fires: repeated cross-device conflict
  or friction; measured localStorage quota / size limit; a real
  relational or server-side query need; OAuth / secret-proxy /
  server-job / inbound-integration need; real multi-device
  concurrent editing.
- **Provider evaluation, not vendor lock-in.** When triggered,
  Supabase is the FIRST candidate but not the ONLY candidate; the
  evaluation ADR at the time compares realistic alternatives.
- **`Never Gen-1 directly to backend`** — preserved from ADR-006.
  Any backend migration goes through a canonical Gen-2 form first.
- **Mandatory Gen-1 → Gen-2 consolidation is limited to** active
  domains, retained domains, and migration-relevant domains. A
  legacy domain that is stable and produces no additional user
  value from canonicalization may remain on legacy indefinitely,
  or be explicitly retired via a follow-up decision recorded in a
  future ADR.
- **Explicit retirement / leave path.** For each inactive legacy
  domain, the current ADR (or its successor) records one of three
  states: `active-migrated`, `retained-legacy`, `retired`.
  `retained-legacy` is a legitimate long-term outcome, not a
  deferral.
- **Governance rule.** Accepted ADRs govern architecture until
  explicitly superseded by a later ADR. `docs/lifeos/ROADMAP.md`
  schedules and reflects those decisions but does NOT silently
  override ADRs. If the roadmap and an accepted ADR conflict, the
  ADR wins until a new ADR is written.

**Rejected alternatives.**

- Continue framing Supabase adoption as inevitable (rejected: no
  measured triggers; single-user pattern still holds).
- Migrate every legacy domain to Gen-2 for architectural symmetry
  (rejected: cost / benefit is negative on stable legacy).
- Delete ADR-001 or ADR-006 (rejected: history is append-only per
  the DECISIONS.md format; supersession is the correct mechanism).
- Route ADR authority through the roadmap (rejected: the roadmap
  changes weekly; ADRs are the durable authority).

**Consequences.**

- `docs/lifeos/ROADMAP.md` is updated to reference this ADR in its
  Supabase and M2 triggered-branch sections. The ROADMAP language
  already reflected the intent; this ADR makes the governance
  explicit.
- The M2 section of the roadmap is understood as a per-domain PR
  stream, not a phase, with each domain landing on one of the
  three end-state values above.
- Any future backend-evaluation ADR must reference this ADR as its
  starting point.

**Date:** 2026-08-28 (P1-6 remediation on the AI Council V1 branch).

## ADR-012 addendum #1 (2026-08-28 risk-tier precedence)

Codex's Round 1 audit of the AI Council V1 branch flagged that
ADR-012's tier examples could be read as permitting a HIGH-risk
change to be tier-declared MEDIUM if only a small portion of the
change looked MEDIUM-shaped. This addendum pins an explicit
precedence rule (P1-5 remediation).

**Precedence rule.** If a change touches ANY of the HIGH-risk
invariants listed below, the entire change-set is HIGH-tier
regardless of file count, narrow scope, current authority state,
or the presence of another MEDIUM-shaped example inside the same
change:

- `BACKUP_KEYS` set or `NON_BACKUP_KEYS` set.
- Persisted Store schema (schema version, wrapper shape, envelope
  authority values, migration path).
- Migration paths (`migrateUp`, `validate`, `normalizeLogbookDomain`,
  `deriveStateFromLegacy`, or any new per-domain migration
  function).
- Import / export scope (`processImport`, `getAllBackupData`, any
  Gist / clipboard / file backup path).
- Snapshot creation / restore / reset.
- Recovery derivation logic.
- Any change to the two-source Logbook reconstruction path.
- Canonical authority values or authority transitions.

**Reclassified as HIGH by this addendum.**

- `B2a.1` — Builder-complete / two-source derivation correction
  (touches `deriveStateFromLegacy` at [core.js:510](core.js:510)
  and `normalizeLogbookDomain` at [core.js:922](core.js:922); both
  are recovery-derivation surfaces).
- Any future change to the recovery-derivation surfaces named
  above, even if it is a one-file bug fix.

**Narrowed MEDIUM example.** A Gen-2 product slice may be MEDIUM
ONLY IF it does not change: persisted schema, migration paths,
import / export, snapshot / reset, recovery behavior, or authority
semantics. A Gen-2 slice that touches any of those is HIGH.

**Not all persisted UI is automatically HIGH.** A rendering-only
change that does not touch the invariants above (e.g. a display
tweak, a new filter, a new empty-state message) may remain
MEDIUM. The precedence rule targets the invariants, not the
persistence layer as a whole.

**Author self-declaration + reviewer escalation.** The author
declares the tier in the PR body. A reviewer may disagree with
the declaration and request escalation to HIGH; escalation is
never negotiable when the change touches a listed invariant.

## ADR-015 — PRV-0.5 durable authority for deadlines / claims / risks / goals

**Status:** Accepted (2026-08-28).
**Supersedes:** the runtime portion of the STORAGE_MAP entries for
`deadlines`, `claims`, `risks`, `goals` (which previously had no
canonical user-storage authority; identity lived only in
`data.js`).

### Context

The PRV-0.5 preservation-proof audit established that four
domains — deadlines, claims, risks, goals — were previously
served identity-first from a public tracked file (`data.js`)
with, at most, per-id override storage in
`dune_deadlines_ext_v1`, `dune_claims_v1`, `dune_goals_v1`.
Risks had no storage key at all. Consequently the current backup
(`BACKUP_KEYS`) could NOT reconstruct real user records for these
domains under sanitized code — the app never persisted the
identity to restore. A naive sanitization of `data.js` would
orphan every per-id override and delete the user's risk register
outright, with no recovery path.

This ADR establishes durable, restore-independent authority for
those four domains BEFORE any PRV-1 public-content sanitization
runs.

### Decision

1. **Durable authority.** For each of the four domains, the
   canonical read/write authority is now the Store path
   `state.records.<domain>` (i.e. `records.deadlines`,
   `records.claims`, `records.risks`, `records.goals`). Because
   these live inside `dune_state_v4`, they ride the existing
   `BACKUP_KEYS` set and inherit ADR-010's coordinated import,
   snapshot, and restore semantics without a schema bump.

2. **Migration-only legacy seed.** The pre-sanitization corpus
   for the four domains has been moved verbatim into a single
   internal seed module: `_migration-legacy-records.js`. This
   file is loaded before `data.js` at
   [index.html](index.html) and exposes
   `window.LEGACY_RECORDS = { deadlines, claims, risks, goals }`
   (frozen). Runtime renderers MUST NOT read from
   `window.LEGACY_RECORDS` — its sole consumer is the
   hydration path defined below. The seed remains public during
   PRV-0.5; PRV-1 continues to own the public-content sanitization
   of `data.js` and `PRODUCT.md`. A later explicitly-approved
   cleanup step removes `_migration-legacy-records.js` once
   restore-independence has been proven in the field.

3. **One-shot hydration.** `hydratePreservationRecordsOnce()` in
   [app.js](app.js) runs at script parse time and:
   - Skips if the sticky Gen-1 flag
     `dune_records_hydrated_v1` is set.
   - Skips (and sets the flag) if `records.<domain>` is already
     populated for every domain — a user with populated durable
     records is done.
   - Otherwise, for each empty domain, merges any legacy per-id
     override from `dune_goals_v1` and `dune_claims_v1` into a
     copy of `LEGACY_RECORDS.<domain>` and commits via
     `Store.set('records.<domain>', merged)`. Risks are copied
     verbatim and given a computed `score = prob * impact`.
   - If ANY commit fails, the flag is NOT set — retry runs on
     the next boot.
   - The path is idempotent under concurrent tab boot: Web-Locks
     serialization inside Store guarantees at-most-one accepted
     commit per domain per revision; a second tab that observes
     populated records skips the merge entirely.

4. **Sticky-flag placement.**
   `dune_records_hydrated_v1` is a Gen-1 key OUTSIDE
   `dune_state_v4`. This is deliberate: `Store.reset()` commits
   `defaultState()`, which does NOT include `records.*` and does
   NOT touch Gen-1 keys. The sticky flag therefore survives Reset.
   Post-Reset invariant:
   `records.<domain>` reads as empty AND the flag is still `'1'`,
   so hydration is a no-op — legacy personal records CANNOT
   resurrect. This is the required Reset-safety property.

5. **Single-writer authority.** The legacy per-id override keys
   `dune_goals_v1` and `dune_claims_v1` are no longer written by
   any code path. Their entries in `BACKUP_KEYS` are preserved
   for backward compatibility with existing backups (import still
   accepts them; hydration reads them once for the merge), but
   they are historical dead weight after the flag is set.
   `dune_deadlines_ext_v1` was already comment-marked as
   reader-less; it is unchanged.

6. **Reader accessors.** `data.js` retains read-only
   `Object.defineProperty` accessors for `D.deadlines`,
   `D.claims`, `D.risks`, `D.goals` that proxy to
   `Store.get('records.<domain>')`. This preserves the existing
   ~15 render call sites verbatim while making the Store the true
   authority. The accessors return `[]` if Store is not yet
   available, so first-paint remains defensive.

7. **Backup and restore.** `dune_state_v4` (which is in
   `BACKUP_KEYS`) now includes the new `records.*` field. Restore
   into a fresh browser reconstructs the four domains WITHOUT
   consulting `LEGACY_RECORDS` — the wrapper alone is sufficient.
   `BACKUP_KEYS` set membership is unchanged; the wrapper's
   inner shape is additively extended. `validate()` in
   [core.js](core.js) accepts the additive shape without
   modification.

### PRV-1 gating

PRV-1 source sanitization remains BLOCKED until:

- ADR-015 is merged.
- The nine deterministic PRV-preservation specs (`tests/prv-preservation.spec.js`) are green in CI.
- Independent HIGH-tier Codex review approves this ADR and the
  implementation against a specific `review_commit`.
- Explicit user approval per ADR-013 (merge to main).

### Explicit scope-outs

- **EASA** is not migrated by this ADR. The public Part-66 module
  list in `D.easa` is public-standard content; per-user
  progress/status overrides in `dune_easa_v1` continue to work
  as long as the module IDs are preserved through any future
  PRV-1 sanitization of `D.easa`. That ID stability is a
  PRV-1 checklist item, not a PRV-0.5 change.
- **Finance** is not migrated. `dune_finance_v1` already stores
  the full record; `D.finance` is fallback-only.
- **Ideas** is not migrated. `state.ideas` is a full Gen-2
  record; `SEED_IDEAS` runs once behind `meta.ideasSeeded` and
  can be sanitized in PRV-1 without preservation risk.
- **Personal-domain content in `defaultState()`** (money /
  qatarVisit / career / timeline / about seed defaults) is a
  separate PRV-1-analog problem outside this ADR's scope.

### Related

- [ADR-006](DECISIONS.md#adr-006) — storage migration cadence.
- [ADR-010](DECISIONS.md#adr-010) — Store durability protocol
  (coordinated import, snapshot semantics — extended in effect
  by this ADR without changing the protocol itself).
- [ADR-012 addendum #1](DECISIONS.md#adr-012-addendum-1-2026-08-28-risk-tier-precedence) — this
  change touches `BACKUP_KEYS`-adjacent shape (additive inside
  `dune_state_v4`) and migration paths, therefore HIGH-tier.
- [ADR-013 addendum #1](DECISIONS.md#adr-013) — personal-data
  egress; unaffected by this ADR.
- [ADR-014](DECISIONS.md#adr-014) — three per-domain end-states;
  the four migrated domains land at `active-migrated`.

**Date:** 2026-08-28 (PRV-0.5 implementation on branch
`claude/prv-0-5-preservation-migration`).

### ADR-015 addendum #1 (2026-08-29) — Codex PRV-0.5 R2 remediation

Codex's HIGH-risk review of the first PRV-0.5 implementation
(commit `09b3aa9`) returned FAIL / merge blocked with two P1
defects (P1-A: hydration flag preceded durable commit; P1-B:
imports / intentionally-empty state were ambiguous). This
addendum records the remediation applied.

**Schema bump: 13 → 14.** Migration authority now lives INSIDE
the coordinated wrapper. The Round 1 out-of-band Gen-1 sticky
flag `dune_records_hydrated_v1` has been removed — it could
survive a durability failure and permanently skip migration.

**New persisted marker.** `data.meta.recordsMigration = { status,
schemaVersion, at, reason }` inside `dune_state_v4`. Distinguishes
four states without inference from array length:

- **unmigrated** — `migrateUp` on a v13-or-earlier wrapper sets
  this; hydration in `app.js` fires on next boot and on the
  `onSave` re-trigger.
- **migrated + populated** — records carry authoritative user data.
- **migrated + intentionally empty** — user deleted all records or
  imported an empty-migrated wrapper; hydration MUST NOT
  resurrect legacy.
- **malformed** — marker absent or shape-invalid; treated as
  unmigrated so retry can complete safely.

**Reset safety without an out-of-band flag.** `defaultState()` at
v14 initializes `status: 'migrated'` with empty records. Because
`Store.reset()` commits `defaultState()`, post-Reset state is
"migrated + empty" — hydration is a no-op and legacy personal
records CANNOT resurrect.

**Durability contract.** `hydratePreservationRecordsOnce()` in
`app.js` is now async and only reports success after:

1. all four `Store.set('records.<domain>', …)` calls return `ok`;
2. `Store.set('meta.recordsMigration', { status: 'migrated', …})`
   returns `ok`;
3. one `Store.onSave` listener fires (the wrapper commit lands
   under the coordinator lock);
4. the persisted `dune_state_v4` is re-read from `localStorage`
   and independently verified to carry `status: 'migrated'` AND
   all four `records.*` arrays.

Failure at any step returns `ok: false` with a `reason:` field
and leaves the marker on `unmigrated` — retry is safe on the
next boot / next `onSave` re-trigger.

**Import awareness.** `processImport()` restores an imported
wrapper through the existing coordinated transaction (ADR-010),
which invokes `Store.migrateData` → `migrateUp`. A pre-PRV (v13)
backup imported through `processImport()` therefore commits a v14
wrapper with `status: 'unmigrated'`. An `onSave` listener
registered at boot re-invokes hydration when it observes that
status, so the post-import state converges to `migrated + populated`
without a manual reload.

**No dual authority.** Legacy per-id override keys
(`dune_goals_v1`, `dune_claims_v1`, `dune_deadlines_ext_v1`) are
no longer written by any code path. They remain in `BACKUP_KEYS`
for compatibility with pre-PRV backups; hydration reads them
once during the migration merge and never again.

**Test-only auto-retry toggle.** `window.__prv05HydrationAutoRetryEnabled = false`
disables the boot-time `onSave` auto-retry listener so
deterministic tests can inject Store failures without racing an
auto-retry. Production runs never touch this global; the default
`undefined !== false` keeps the listener enabled.

**Tests added / rewritten.** `tests/prv-preservation.spec.js`
covers every failure mode named in the Codex Round 2 handoff:
fresh-default (schema 14 + status='migrated' + empty), v13
hydrate + durable-persist verify, override merge, empty-state
preservation, Reset safety, Store.set failure keeps marker
unmigrated + retry succeeds, post-commit re-read verification,
cross-tab flag-before-durability regression, real
`processImport()` on a v13 backup + hydration converges to
`migrated`, restore-independence with `LEGACY_RECORDS`
neutralized, and D.* reader cutover. 11/11 pass; full suite
168/168 green.

**Test claim discipline.** Test names now describe only the
property actually exercised. The prior overstatements
("concurrent" for sequential-boot, "restore independence" without
neutralizing the seed, "production import safety" without using
`processImport`) have been corrected.

**STORAGE_MAP narrative.** Fixed a Codex-P2 internal contradiction:
the "priority" section listed Goals as still Gen-1 authoritative
while the domain table already showed Gen-2 authoritative. The
narrative and priority sections now match the table + production.

**Not addressed here.** The PRV-1 personal-data sanitization is a
separate cycle; this addendum only records the R2 remediation of
the preservation migration itself. Personal content still lives
in `_migration-legacy-records.js` (public) as designed — its
removal is PRV-1's job.

**Date:** 2026-08-29 (PRV-0.5 R2 remediation on branch
`claude/prv-0-5-preservation-migration`).

### ADR-015 addendum #2 (2026-08-29) — Codex PRV-0.5 R3 remediation

Codex's HIGH-risk re-review of the PRV-0.5 R2 implementation
(commit `4ead699`) returned FAIL / merge blocked with three
independent P1 reproductions. This addendum records the
remediation.

**P1-1 — false success after real durable wrapper-write failure.**
An actual `dune_state_v4` write failure (quota, patched
`localStorage.setItem`, etc.) left optimistic in-memory Store
state carrying `meta.recordsMigration.status='migrated'` while
the persisted wrapper on disk was still `unmigrated`. My prior
"already migrated?" early check read from `Store.get()`, so the
second same-tab hydration returned `ok:true / already-migrated`
without touching disk — permanent false success.

*Remediation.* The early check now reads the PERSISTED wrapper
directly from `localStorage` via `_readPersistedWrapper()` and
validates its schema-14 shape independently. Optimistic
in-memory state is never a source of truth for the completion
decision. If the on-disk marker is `migrated` AND the shape is
canonical, hydration returns success; otherwise it proceeds
with the migration and re-verifies durability post-commit. Any
optimistic in-memory drift is reconciled by re-writing the
persisted-authoritative marker so a subsequent save cannot leak
stale intent.

**P1-2 — partial schema-14 migrated wrappers accepted.**
`processImport()` accepted a schema-14 wrapper claiming
`status:'migrated'` but with `records.goals` absent. Hydration
then skipped permanently on the "already migrated" fast path.

*Remediation.* Introduced a canonical shape validator,
`_isSchema14CanonicalMigratedShape(data)`, requiring:
`data.records` is a plain object; each of `.deadlines`,
`.claims`, `.risks`, `.goals` is an array; `data.meta.recordsMigration`
is a plain object with `status` ∈ {`migrated`, `unmigrated`}.
Enforced at THREE boundaries:

1. `processImport()` (app.js) — rejects any candidate that
   claims migrated but fails shape validation, BEFORE
   `commitFullStateWrapper` overwrites good current state.
   Throws `IMPORT_SCHEMA14_MIGRATED_SHAPE_INVALID`; existing
   rollback-of-auxiliaries path fires. Error toast surfaced via
   the existing import-error path.
2. `Store.validate()` (core.js) — snapshot restore and load-time
   validation now reject a schema-14 wrapper that claims
   migrated without the canonical records shape. Every valid
   production data path (`defaultState()`, `migrateUp` v13→v14)
   already emits the canonical shape, so only corrupt/malformed
   inputs fail.
3. `hydratePreservationRecordsOnce()` early check — a wrapper
   that claims migrated but fails shape validation is treated
   as NOT migrated; hydration proceeds and heals the partial
   state.

**P1-3 — simultaneous hydration leaves losing tab conflict-blocked.**
Two tabs hydrating the same settled v13 state simultaneously
each generated a different `at` timestamp for the marker; Tab A
committed, Tab B's CAS-marker-op stayed non-idempotent (its
before-value diverged from the freshly-committed state) and Tab
B was left with an unresolved pending op on
`meta.recordsMigration` that blocked subsequent ordinary user
edits from persisting.

*Remediation.* Wrapped `hydratePreservationRecordsOnce()`'s
body in `navigator.locks.request('lifeos-prv05-migrate',
{mode:'exclusive'}, …)`. Cross-tab hydration now serializes:
the second tab acquires the lock only after the first releases,
re-reads the persisted wrapper (already migrated + shape-valid
by then), and early-returns via the disk-authoritative check —
without ever enqueuing a marker CAS op. If in-memory shows a
divergent pending marker, the early-return code re-writes the
persisted-authoritative marker to reconcile. No orphaned pending
op remains, and later ordinary user edits from the losing tab
persist normally. Falls back to same-tab-only dedupe when
`navigator.locks` is absent.

**P2 test claim discipline.** Every test now proves the exact
property claimed. Regressions added for each Codex reproduction:

- `PRV-R3-REAL-DURABLE-FAILURE-P1-1` — patches
  `Storage.prototype.setItem` to fail on `dune_state_v4` writes.
  First hydration returns `{ok:false, reason:'durability-verification-failed'}`;
  optimistic memory shows `migrated` but persisted disk stays
  `unmigrated`; SAME-TAB retry after removing the injection
  detects the disk-vs-memory drift and completes the migration.
- `PRV-R3-PARTIAL-MIGRATED-IMPORT-P1-2` — imports a hand-crafted
  schema-14 wrapper with `status:'migrated'` + `records.goals`
  missing via production `window.processImport()`. Import is
  rejected without overwriting the current good state.
- `PRV-R3-PARTIAL-MIGRATED-BOOT` — persists a hand-crafted
  partial-migrated wrapper before boot. Hydration detects the
  malformed shape, treats it as unmigrated, and heals it.
- `PRV-R3-SIMULTANEOUS-TABS-P1-3` — both tabs alive; both
  invoke hydration via `Promise.all`. Final disk is migrated +
  shape-valid; NEITHER tab retains a pending marker CAS op; a
  subsequent ordinary Store edit from the LOSING tab persists.

Sequential close-A / start-B is no longer used as a concurrency
proxy.

**Production import trigger.** `processImport()` completes by
committing the imported wrapper and then schedules
`location.reload()` at ~1.2 s. On reload, boot-time hydration
runs from persisted state. The `onSave` re-invocation is a
best-effort fast path (no manual reload) but the reload is
always the ultimate backstop — no import path depends on
`onSave` alone.

**No re-broadening.** ADR-014's per-domain end-state framing
still governs; PRV-1 personal-data sanitization is still out of
scope for this remediation. `_migration-legacy-records.js`
remains present until an explicitly-approved cleanup step.

**Date:** 2026-08-29 (PRV-0.5 R3 remediation on branch
`claude/prv-0-5-preservation-migration`).

### ADR-015 addendum #3 (2026-09-01) — Codex PRV-0.5 R4 remediation

Codex's HIGH-risk re-review of the PRV-0.5 R3 implementation
(commit `6022c0b0b58f1e7b8e43f27d3d0b6577a384503f`) closed the
R3 P1-1 (real durable-write authority) and P1-3
(simultaneous-tab convergence) findings but returned three new
HIGH-risk defects, all in the same authority-boundary class. R4
addresses each in isolation without changing the accepted
architecture.

**One authority state machine for schema 14.** Every code path
that decides whether a persisted / imported / snapshot-restored
wrapper is authoritative for the four records domains now
classifies the wrapper into exactly one of these states, using
the SAME predicates:

  A. **Canonical migrated** — outer wrapper is version 14 with a
     valid non-negative integer revision, `records.*` is an
     object with all four required domain arrays,
     `meta.recordsMigration.status === 'migrated'` (recognized
     status). Authoritative. Fast-path skip on hydration.

  B. **Canonical intentionally-empty migrated** — same as A with
     any/all `records.*` arrays as `[]`. Authoritative and MUST
     stay empty; hydration NEVER seeds LEGACY_RECORDS into a
     migrated-claimed empty domain.

  C. **Canonical unmigrated legacy-transition state** — outer
     wrapper valid current-schema (or accepted-and-migrated-up
     v13 wrapper), `records.*` present as four empty arrays,
     `meta.recordsMigration.status === 'unmigrated'`. Eligible
     for preservation hydration — the four arrays are the
     migrateUp bootstrap, not user intent, and are overwritten
     from `LEGACY_RECORDS` + surviving Gen-1 override keys.

  D. **Current-schema malformed / ambiguous** — outer wrapper is
     valid version 14 but `records.*` is missing / non-object /
     non-array-domain, or `meta.recordsMigration` is missing /
     non-object / of unknown status. NOT authoritative. At
     destructive boundaries (import, snapshot restore): REJECT
     before any commit touches disk. At hydration: preserve
     known-good present arrays exactly, and canonicalize any
     absent domain to `[]` when the marker CLAIMS migrated
     (fail-closed on inventing intent) — do NOT seed
     LEGACY_RECORDS.

  E. **Old schema** — outer wrapper is version <14 (or a
     wrapper without a version). Must flow through the canonical
     `migrateUp` chain at boot / snapshot / import. A version-13
     wrapper NEVER enters the schema-14 "already migrated" fast
     path in `_hydrateUnderLock`, even when its inner data
     happens to resemble schema 14.

  F. **Invalid / stale wrapper metadata** — negative /
     non-integer / out-of-range revision, corrupt JSON, or a
     revision that has regressed below the Store's accepted
     `knownRevision`. NOT authoritative. Same treatment as D.

**P1-A — persisted fast-path authority.** `app.js:_readPersistedWrapper()`
no longer accepts a wrapper solely because its inner data is
schema-14-shaped. It now delegates to `Store.parseWrapper` (the
same predicate Store applies at `initialLoad` /
`setWrapperFromOps`) and additionally requires the outer
`version === 14`, an in-range non-negative integer revision, and
a revision not stale relative to `Store.currentKnownRevision`.
Regressions: `PRV-R4-P1A-NEGATIVE-REVISION`,
`PRV-R4-P1A-OLD-VERSION`, `PRV-R4-P1A-EXPORT-RELOAD`.

**P1-B — destructive-boundary migration metadata.**

- `app.js:processImport()` now applies a NEW predicate,
  `_isSchema14CanonicalDestructiveShape(candidate)`, to EVERY
  schema-14 candidate — regardless of marker status. It rejects
  candidates whose migration marker is missing / non-object / of
  unknown status, OR whose `records.*` lacks any of the four
  required domain arrays. R3 gated only on `status === 'migrated'`,
  which Codex bypassed with missing marker / bogus status /
  missing records. The source-wrapper revision-validity check
  also extends from v13-only to any wrapper claiming
  `version >= 13`.

- `core.js:isRecordsMigrationShapeSafe()` (called from
  `validateSnapshotWrapperFull`, the snapshot restore
  destructive boundary) is tightened symmetrically: a schema-14
  candidate MUST carry a marker with a recognized status AND a
  canonical records shape. The R3 "no claim, no check" branch
  is removed. Regressions:
  `PRV-R4-P1B-IMPORT-MISSING-MARKER`,
  `PRV-R4-P1B-IMPORT-BOGUS-STATUS`,
  `PRV-R4-P1B-IMPORT-MISSING-RECORDS`,
  `PRV-R4-P1B-SNAPSHOT-MISSING-MARKER`.

**P1-C — no length-based intent inference for migrated state.**
`app.js:_hydrateUnderLock()` no longer uses `cur.length > 0` to
decide whether a present records domain is authoritative. The
new rule keys off the migration marker (persisted-disk marker
first, Store in-memory marker as fallback):

- **Migrated intent already established** (marker claims migrated
  in disk OR — when disk marker is unavailable — in Store
  memory): preserve present arrays verbatim, INCLUDING `[]`
  (an intentionally empty domain is meaningful state).
  Canonicalize absent / malformed domains to `[]`. NEVER seed
  LEGACY_RECORDS.

- **Unmigrated / absent-marker state** (legitimate v13→v14
  transition, fresh migrateUp bootstrap): the empty arrays came
  from `migrateUp`, not user intent — seed from LEGACY_RECORDS.
  A pre-existing non-empty array (from a partial prior
  migration attempt) is preserved.

Regressions: `PRV-R4-P1C-INTENT-PRESERVATION`, plus a
parameterized suite `PRV-R4-P1C-PARAM — missing <domain>` for
each of the four domains, and
`PRV-R4-P1C-UNMIGRATED-STILL-SEEDS` which pins the v13
preservation flow so the P1-C fix cannot regress it.

**Exposed Store primitives.** `core.js` now publishes
`Store.parseWrapper`, `Store.isValidRevision`, and
`Store.currentKnownRevision` so `app.js` uses exactly the same
authority rules Store itself applies — one source of truth for
wrapper validity, no shadow validator to drift.

**Documentation corrections.** `ARCHITECTURE.md` now names
`validateSnapshotWrapperFull` / `isRecordsMigrationShapeSafe`
as the snapshot-restore destructive guard (not `validate()`),
and describes convergence for a `status='unmigrated'` import as
the scheduled `location.reload()` (not an `onSave`
re-invocation) — `commitFullStateWrapper` does not fire
ordinary `Store.onSave` listeners for the committed wrapper.

**Legacy corpus lifecycle unchanged.** R4 does NOT remove or
sanitize `_migration-legacy-records.js`. That step remains
PRV-1's responsibility. R4's job is only to make every
accepted / restored / persisted state coherent enough that
eventual PRV-1 removal is safe.

**No re-broadening.** ADR-014's per-domain end-state framing
still governs; BHT / Ideas concurrency, personal-data
sanitization, Pages, repository visibility, Aviation, and B1.5
are all still out of scope for this remediation.

**Date:** 2026-09-01 (PRV-0.5 R4 remediation on branch
`claude/prv-0-5-r4-remediation`; base commit
`6022c0b0b58f1e7b8e43f27d3d0b6577a384503f`).

### ADR-015 addendum #4 (2026-09-01) — Codex PRV-0.5 R5 remediation

Codex Round-4 review of R4 exact SHA
`8efafc7f4e3ce2b658fc74cdf6b3cbaab0414011` returned FAIL — NOT
SAFE, MERGE BLOCKED. Independent production-path probes
reproduced five HIGH-risk defects: (P1-1) ambiguous schema-14
states still resurrected legacy, (P1-2) missing/malformed
migrated domains were silently converted to `[]` (invented
deletion intent), (P1-3) hydration fast-path was not equivalent
to Store authority — equal-revision divergent bytes and active
durability blockers still returned `already-migrated`, (P1-4)
corrupt-wrapper limitation could lose preserved records and
export invalid authority as a normal backup, (P1-5) unsupported
future wrapper versions (`version > SCHEMA_VERSION`) were
silently downgraded through `migrateUp` at import / snapshot /
boot boundaries. Plus P2: marker schema was not canonical
(`schemaVersion` could be absent or `99`).

The architectural lesson: parallel authority predicates in
`app.js` and `core.js` diverged under adversarial input. R4 had
its own destructive-boundary shape guard (`app.js`) alongside
`core.js:isRecordsMigrationShapeSafe` and a fast-path shallower
than `Store.parseWrapper`. Every reproduced defect traced back
to one of those parallel checks missing what another already
enforced. R5 collapses every wrapper-authority decision into a
**single Store-owned evaluator**.

**One evaluator, one contract.**
`Store.evaluatePersistedAuthority(raw?)` in `core.js` is the
single source of authority truth. It returns one of six
classifications and a set of consumer decision booleans. Its
counterpart for external wrapper objects is
`Store.evaluateCandidateWrapper(input)` (parses raw or accepts a
pre-parsed object, runs `migrateUp` internally when the source
is a legacy version); for a bare `data` object (post-migrateUp
candidate) callers use `Store.evaluateCandidateData(data)`.
Every previous callsite — hydration fast-path (`app.js`),
production import (`app.js:processImport`), snapshot restore
(`core.js:validateSnapshotWrapperFull`), backup export
(`app.js:exportBackup / copyBackupToClipboard / saveToGist`),
and boot recovery (`core.js:initialLoad`) — now consults the
evaluator instead of a local predicate.

**Six classifications:**

1. **AUTHORITATIVE_MIGRATED** — current version, valid revision,
   canonical marker (`status='migrated'`,
   `schemaVersion===SCHEMA_VERSION`), all four record arrays. A
   sub-flag `allEmpty:true` calls out the intentionally-empty
   subset (Codex's class B) and the explicit-reset subset (class
   G) — both behave identically. Only this class produces
   `acceptFastPathMigrated:true`, and only when the Store has no
   active durability blocker AND the raw bytes match the Store's
   accepted `baseWrapperRaw` (no equal-revision divergent-bytes
   attack).
2. **VERIFIED_LEGACY_TRANSITION** — either a wrapper
   `version < SCHEMA_VERSION` from a supported legacy schema, OR
   a schema-14 wrapper whose marker is `status='unmigrated'` with
   a provable v13→v14 provenance:
   `schemaVersion===SCHEMA_VERSION`, `priorSchemaVersion` in
   `[0..SCHEMA_VERSION-1]`, `reason` matching
   `migrateUp-from-v<priorSchemaVersion>`. This is the ONLY class
   that authorises `LEGACY_RECORDS` seeding (`seedLegacy:true`).
3. **MALFORMED_CURRENT_SCHEMA** — schema-14 wrapper with a valid
   outer envelope but a non-canonical marker (missing / of
   unknown status / wrong `schemaVersion` / unmigrated without
   provenance / unmigrated with wrong `reason`) OR non-canonical
   `records.*` (missing object, missing domain, non-array
   domain). Recovery required. Hydration MUST NOT synthesize
   `[]` for a missing/non-array required domain (P1-2); MUST NOT
   seed `LEGACY_RECORDS`.
4. **CORRUPT_STALE_COLLIDING** — corrupt outer JSON, invalid
   revision, stale revision (< `Store.currentKnownRevision`),
   equal-revision + divergent raw bytes vs. Store's baseline
   (P1-3 attack), OR an active Store durability blocker while
   looking at otherwise canonical bytes. Recovery required.
   Normal backup refused.
5. **UNSUPPORTED_FUTURE_SCHEMA** — outer wrapper
   `version > SCHEMA_VERSION`. Rejected at every load / import /
   snapshot boundary (P1-5). `parseWrapperRaw` treats this as
   `corrupt:true`, so hydration / storage-event rebase /
   `commitFullStateWrapper` / `endFullStateTransaction` all
   propagate the rejection uniformly. `migrateUp` is never
   invoked on an unknown future version.
6. **ABSENT** — no `dune_state_v4` on disk (fresh browser).
   Hydration fast-path B evaluates Store's in-memory data via
   `evaluateCandidateData()` to distinguish fresh-cold-boot
   canonical from a legacy-transition-in-memory state.

**Recovery semantics (P1-4).** When `initialLoad` reads a raw
wrapper that Store's own parse / migrate / validate rejects, R5
now preserves the corrupt bytes as `baseWrapperRaw = raw`
(evidence) AND stages a pending `STORE_CORRUPT_AUTHORITATIVE_STATE`
durability blocker so ordinary `Store.set/update` refuse until
recovery lands through an approved full-state transaction
(snapshot restore, import, or reset — all of which clear the
blocker via `commitFullStateWrapper`). Snapshot fallback still
runs when a valid rolling snapshot exists so the app can render;
the blocker still fires so writes must go through recovery. The
corrupt bytes never round-trip as a normal backup — `exportBackup`,
`copyBackupToClipboard`, and `saveToGist` all consult
`evaluateBackupAuthority()`. A quarantine path,
`window.exportRecoveryEvidence()`, packages the invalid wrapper as
`{version:'2026.1-quarantine', quarantined:true, reason}` which
`processImport` refuses on the way back in.

**Canonical marker schema (P2).** Every canonical marker MUST
carry `schemaVersion === SCHEMA_VERSION`. Fresh cold-boot / Reset
uses `{ status:'migrated', schemaVersion, reason:'default-state' }`.
Post-migrateUp uses
`{ status:'unmigrated', schemaVersion, priorSchemaVersion,
   reason:'migrateUp-from-v<priorSchemaVersion>' }`. Post-hydration
uses `{ status:'migrated', schemaVersion,
   reason:'hydration-complete' }`. Any deviation — missing
`schemaVersion`, `schemaVersion:99`, arbitrary `unmigrated`
without provenance — is `MALFORMED_CURRENT_SCHEMA` at every
boundary.

**Provenance requirement (P1-1).** Legacy seeding is
authorised ONLY by `VERIFIED_LEGACY_TRANSITION`. An arbitrary
schema-14 `unmigrated` marker (no `priorSchemaVersion`, wrong
`reason`, or fabricated by an external actor) fails the
canonical marker check and lands in
`MALFORMED_CURRENT_SCHEMA` — no seed, no synthetic deletion,
no silent success.

**Concurrency (unchanged from R3).** The hydration Web Lock
(`lifeos-prv05-migrate`) + deterministic marker content
mechanism is preserved verbatim. Simultaneous-tab hydration
still converges without a losing-tab conflict; the no-Web-Locks
fallback still uses same-tab `_hydrationInFlight` dedupe.

**Legacy corpus lifecycle unchanged.** R5 does NOT remove or
sanitize `_migration-legacy-records.js`. That step remains
PRV-1's responsibility. R5's job is only to make every
authority decision routed through one Store-owned contract so
PRV-1 can proceed on a durable foundation.

**No re-broadening.** ADR-014's per-domain end-state framing
still governs; BHT / Ideas concurrency, personal-data
sanitization, Pages, repository visibility, Aviation, and B1.5
are all still out of scope for this remediation. Backup gating
and quarantine cover only the PRV-0.5 authority contract.

**Date:** 2026-09-01 (PRV-0.5 R5 remediation on branch
`claude/prv-0-5-r5-authority-recovery`; base commit
`8efafc7f4e3ce2b658fc74cdf6b3cbaab0414011`).

### ADR-015 addendum #5 (2026-09-02) — Codex PRV-0.5 R6 remediation

Codex Round-5 review of R5 exact SHA
`df791627c0ec365261b0bed7518e0371a1accf38` returned **FAIL — NOT
SAFE, MERGE BLOCKED**. Independent production-path probes
reproduced five P1 blockers rooted in gaps between R5's new
authority pieces: (P1-1) a schema-14 wrapper could forge the
allegedly "provable" legacy-transition marker and resurrect all
four `LEGACY_RECORDS` domains on cold reload; (P1-2) snapshot,
import, and reset could NOT replace corrupt disk authority — the
in-app recovery route was a dead end; (P1-3) public
`commitFullStateWrapper()` bypassed the canonical authority
evaluator and could mint malformed schema-14 state; (P1-4) a
higher-revision raw mismatch fell through the hydration switch to
legacy seed and false success; (P1-5) load-time snapshot recovery
accepted a source-invalid snapshot after `migrateUp()` filled its
missing required data with defaults. Plus P2-1 (raw-vs-object
future classification inconsistency) and P2-2 (recovery UI /
documentation claimed stronger guarantees than code).

R6 closes each blocker architecturally, not by patching the
submitted reproductions.

**P1-1 — Transaction-scoped legacy-transition capability.** Legacy
seeding no longer trusts marker text on a current-schema wrapper.
Store now owns an internal boolean `_legacyTransitionCapability`
set by `initialLoad` ONLY when the raw persisted wrapper this boot
carried `version < SCHEMA_VERSION` (a supported outer legacy
version), and consumed by any commit that lands
`meta.recordsMigration.status='migrated'`. The evaluator's
schema-14 `VERIFIED_LEGACY_TRANSITION` branch (inner marker
canonical unmigrated + provenance) is DOWNGRADED to
`MALFORMED_CURRENT_SCHEMA` when `_legacyTransitionCapability` is
false. A cold-boot forgery attack — schema-14 wrapper with a
syntactically-canonical `unmigrated` marker written directly at
current schema — can no longer self-authorise seeding. `processImport`
for a genuine v13 backup INLINES the legacy seed during the
transaction so the committed wrapper is `status='migrated'` with
populated records atomically, eliminating the post-reload
schema-14 + `unmigrated` intermediate state that would otherwise
have to be re-authorised.

**P1-2 — Explicit recovery-mode full-state commit.**
`commitFullStateWrapper(token, data, reason, {recovery: true})` is
the ONLY path that can replace corrupt authority. In recovery
mode, a corrupt disk read is QUARANTINED under a distinct key
(`dune_state_v4_quarantine_<epoch-ms>`) as evidence, and the
commit proceeds using `max(knownRevision, 0) + 1` for monotonicity
(never trusting the corrupt revision). Post-write verification
re-parses the committed payload via the evaluator; only
`AUTHORITATIVE_MIGRATED` counts as durable success; on failure the
blocker is NOT cleared and evidence is retained. `restoreSnapshot`
and `reset` both pass `recovery: true` and now return a `settled`
Promise (`Store._lastResetSettled()` for reset) so callers can
await the truthful asynchronous outcome. Restore additionally
rewrites the migrated candidate's marker to
`{status:'migrated', schemaVersion, reason:'snapshot-restore'}`
inline — the user's explicit choice of THIS generation as
authoritative supersedes further legacy seeding.

**P1-3 — Canonical evaluator gate at the lowest destructive
boundary.** `commitFullStateWrapper` now runs
`evaluateCandidateData(cloned)` under the coordinator BEFORE the
write and BEFORE clearing the blocker. Any candidate that lacks
canonical marker / records / marker `schemaVersion` is rejected
with `FULL_STATE_CANDIDATE_NONCANONICAL` and the previous blocker
stays intact. Post-write, the same evaluator re-parses the exact
committed payload; a non-`AUTHORITATIVE_MIGRATED` result triggers
`FULL_STATE_POST_WRITE_VERIFICATION_FAILED`. Direct malformed
commits (missing `records.goals`, missing marker, etc.) can no
longer mint invalid current authority.

**P1-4 — Exhaustive hydration classification switch.** Hydration's
top-level branch is now a proper switch with a
default-fail-closed arm. `AUTHORITATIVE_MIGRATED` with
`acceptFastPathMigrated:false` returns recovery-required — not a
fallthrough to seed. The evaluator additionally demotes
`AUTHORITATIVE_MIGRATED` to `CORRUPT_STALE_COLLIDING` when the raw
bytes on disk are at a HIGHER revision than Store's baseline AND
don't match `baseWrapperRaw` (the Codex reproduction that seeded
legacy on a mismatched newer generation). Combined, the two
changes remove every path by which legacy seeding could be reached
without both `VERIFIED_LEGACY_TRANSITION` classification AND an
active `_legacyTransitionCapability`.

**P1-5 — Source validation before default-fill.**
`validateLegacySourceRequiredFields(data, version)` runs BEFORE
`migrateUp` on both snapshot restore
(`validateSnapshotWrapperFull`) and external candidate evaluation
(`evaluateCandidateWrapper`). A v12+ candidate whose source is
missing `money.salary_net` or `qatarVisit` is rejected at the
source stage — `migrateUp`'s default-fill can no longer convert
source corruption into plausibility. Recovery selection now skips
source-invalid snapshots and advances to the next independently
valid generation. The mandatory failing test
`T-snapshot-source-invalid-data-recovery` now genuinely passes:
the first `{qatarVisit:{}}` snap is rejected at source
validation, the second `salary=24680` snap wins.

**P2-1 — Future classification preserves outer wrapper context.**
`parseWrapperRaw` continues to mark `version > SCHEMA_VERSION` as
`corrupt:true, reason:'wrapper-version-unsupported'` with the
`version` field intact. Both `evaluatePersistedAuthority` and
`evaluateCandidateWrapper` inspect that reason and return
`UNSUPPORTED_FUTURE_SCHEMA` uniformly — live-raw and
object-candidate paths no longer disagree.

**P2-2 — Recovery UX correction.** The boot-time freeze banner
now paints on `DOMContentLoaded` when `Store.getDurabilityBlocker()`
is set (the blocker installed by `initialLoad` had no
`lifeos:store-durability-blocked` listener wired yet). The banner
message for `STORE_CORRUPT_AUTHORITATIVE_STATE` /
`STORE_REVISION_REGRESSION` / `STORE_STATE_CLEARED_EXTERNAL`
directs the user to Snapshot restore / Backup import / Reset via
the Backup panel — NOT the deprecated "please export a backup"
text (normal backup is refused while authority is corrupt).

**Concurrency invariant preserved.** R3's simultaneous-tab
migration Web Lock (`lifeos-prv05-migrate`) + deterministic marker
mechanism is unchanged. `PRV-R3-SIMULTANEOUS-TABS-P1-3` remains
green. The no-Web-Locks fallback continues to offer only same-tab
`_hydrationInFlight` deduplication — cross-tab serialisation of
hydration is NOT provided without Web Locks; this is documented
truthfully.

**Legacy corpus lifecycle unchanged.** R6 does NOT remove
`_migration-legacy-records.js`. PRV-1 remains responsible for
sanitising the tracked personal-looking source/defaults. R6 only
tightens the authority/recovery contract so PRV-1 can proceed on a
provably-safe foundation.

**Date:** 2026-09-02 (PRV-0.5 R6 remediation on branch
`claude/prv-0-5-r6-authority-recovery`; base commit
`df791627c0ec365261b0bed7518e0371a1accf38`).

### ADR-015 addendum #6 (2026-09-02) — Codex PRV-0.5 R7 remediation

Codex Round-6 review of R6 exact SHA
`357a9d26ad075cd1ad911db365569300f2113008` returned **FAIL — NOT
SAFE, MERGE BLOCKED**. Independent probes reproduced seven P1
defects rooted in R6 treating transition/recovery authority as
generic booleans and letting the destructive boundary short-circuit
durability verification. R7 collapses those authorities into ONE
source-generation-bound context and adds mandatory
observe→classify→authorise→prepare→lock→reread→verify→quarantine→
validate→write→reread→verify→success ordering.

**INV-1 / INV-2 / INV-12 — Source-bound transition and recovery
authority.** `Store` now owns a single `_transitionAuth` narrow
context with `{kind:'legacy'|'recovery', sourceRawBytes, sourceVersion, sourceRevision, issuedAt}`. Auth is issued at exactly two points:
`initialLoad` (kind `legacy`, bound to the raw legacy-source bytes)
and `Store.prepareRecoveryAuth()` (kind `recovery`, bound to the
current corrupt raw bytes). Auth is consumed on any accepted commit.
Every destructive path (hydration legacy seed, recovery-mode
`commitFullStateWrapper`) re-reads disk raw UNDER the destructive
lock and requires an exact byte-match against `_transitionAuth.sourceRawBytes` — a stale auth for a generation the disk no longer holds
fails closed with no mutation. Ordinary CAS commits that land a
still-`unmigrated` wrapper mid-transition rebind the auth's source
bytes to the new `baseWrapperRaw` so hydration RETRY within the
same boot still authorises seeding — this rebind is Store-controlled and cannot leak the auth to an externally-substituted wrapper.

**INV-3 / R6-P1-2 — Stale recovery cannot overwrite healthy
authority.** Recovery-mode `commitFullStateWrapper` performs the
source-identity re-check TWICE (immediately after quarantine-verify
and again immediately before primary write) so a Tab-B recovery
that lands between our steps refuses instead of clobbering. Callers
(`restoreSnapshot`, `reset`, `processImport`) issue the recovery
auth via `Store.prepareRecoveryAuth()` before beginning the
transaction; the auth binds to the exact corrupt raw bytes and
carries `absent:true` when the primary key was externally cleared.

**INV-4 / R6-P1-3 — Complete canonical full-state schema.** New
`validateFullStateCanonical(data)` runs under the coordinator BEFORE
the write and BEFORE any blocker clear. Required top-level domains:
`money` (with `salary_net` + `expenses`), `qatarVisit`, `todayFocus`,
`goals`, `career`, `easa`, `logbook`, `reviews`, `decisions`,
`timeline`, `about`, `apartments`, `sbTasks`, `bht` (with
`habits`/`entries` arrays), `telemetry`, `ideas`, `records` (with
four domain arrays), `meta.recordsMigration` (with exact
`schemaVersion` and recognised status). A missing / null / wrong-
type domain fails with `FULL_STATE_CANONICAL_INCOMPLETE` and a
`missing:[...]` list.

**INV-5 / R6-P1-4 — Quarantine before corrupt replacement, with
verify.** Recovery-mode commit ordering: source identity check →
quarantine setItem to `dune_state_v4_quarantine_<epoch-ms>_<rand>`
→ re-read quarantine key → require byte-match with source raw → if
either step fails, delete quarantine key and refuse. Only after
verified quarantine does the primary write proceed. Random suffix
prevents collision under rapid successive recoveries.

**INV-6 / R6-P1-5 — Durable verification of ACTUAL persisted
primary.** After the primary `localStorage.setItem`, the R7
implementation reads `localStorage.getItem(STATE_KEY)` and requires
the durable byte string to EXACTLY equal the payload we intended to
write. Silent-no-op writes, tampered writes, writes that went
elsewhere, all surface as `FULL_STATE_DURABLE_VERIFY_FAILED`. Only
after that byte-match AND a fresh evaluator classification of
`AUTHORITATIVE_MIGRATED` may `baseState` / `knownRevision` /
`baseWrapperRaw` / `durabilityBlocker=null` / auth consumption
proceed. Reset / snapshot restore / import all inherit this gate.

**INV-7 / R6-P1-6 — Version-specific historical source
validation.** `validateLegacySourceRequiredFields(data, version)`
now enforces version-specific floors derived from this repo's own
`migrateUp` history: v12+ requires `money.salary_net` + `qatarVisit`
+ `bht`; v13 additionally requires the additive domains introduced
by v3+ (career, easa, about, sbTasks, goals, apartments, telemetry,
ideas, logbook, reviews, decisions, timeline, todayFocus) plus a
non-empty `bht` substructure (habits + entries arrays). A trivial
`{money:{salary_net}, qatarVisit:{}}` stub is REJECTED at the source
stage before `migrateUp` can default-fill the missing structure.

**INV-8 / R6-P1-7 — Strict version semantics.** `parseWrapperRaw`
now returns `{corrupt:true, reason:'wrapper-version-malformed', versionType:<type>}` when `version` is PRESENT but not a finite integer.
String `"99"`, `null`, `true`, `14.5`, `{}` all fail closed. Only
truly absent `version` follows the legacy versionless path — and
that path never gains legacy-transition authority because
`initialLoad`'s auth requires `parsed.version < SCHEMA_VERSION`
with a numeric integer version.

**Concurrency model preserved.** Web Locks continue to serialise
participating operations, but authority never derives from a lock —
it derives from source-identity match under the destructive lock.
The R3 `PRV-R3-SIMULTANEOUS-TABS-P1-3` scenario remains green.

**Legacy corpus lifecycle unchanged.** R7 does NOT remove
`_migration-legacy-records.js`, Apartments, Claims Register, EASA,
or Risks — the user's product decisions to eventually retire those
domains remain PRV-1+ work.

**Date:** 2026-09-02 (PRV-0.5 R7 remediation on branch
`claude/prv-0-5-r7-invariant-remediation`; base commit
`357a9d26ad075cd1ad911db365569300f2113008`).

### ADR-015 addendum #7 (2026-09-05) — PRV-0.5 Final Closure Campaign

Codex R7 review of `8a03ac8837a8c11d683a19ab753aabb3a7f11858` found
9 P1 defects and 3 P2 defects rooted in the same architectural
cause: authority contexts were still permitted to leak across
source generations, durable verification was applied to full-state
commits only, and the recovery-authorisation matrix covered only
corrupt-JSON authority. Addendum #7 records the Final Closure
Campaign that closes every finding as one coherent redesign rather
than nine unrelated patches.

**Base:** R7 exact SHA `8a03ac8837a8c11d683a19ab753aabb3a7f11858`.
**Branch:** `claude/prv-0-5-final-closure`.
**Closes:** R7-P1-01 through R7-P1-09, R7-P2-01 through R7-P2-03.

#### Final invariants (INV-A..L)

- **INV-A — No authority crosses source generations.** Every path that
  changes `baseWrapperRaw` to bytes different from the transition
  auth's `sourceRawBytes` INVALIDATES the auth immediately: the
  commitLocked disk-rebase branches (both `revision > known` and
  `revision === known && divergent bytes`), `adoptExternal`
  (storage-event), and `endFullStateTransaction`. Same-boot legacy
  hydration retry rebinds ONLY when the pre-write baseline still
  matched the auth's source (`authWasValidAtPreWrite`) — this is
  safe because the invalidation guards above have already fired
  on any external adoption. The R6/R7 unconditional
  `_transitionAuth.sourceRawBytes = baseWrapperRaw` rebind is
  removed.
- **INV-B — Durable primary is authoritative only after successful
  reread.** Ordinary CAS commits in `commitLocked` now perform the
  same durable-reread + byte-match proof used by
  `commitFullStateWrapper`. On mismatch a persistent
  `STORE_ORDINARY_DURABLE_VERIFY_FAILED` blocker fires; base
  state / knownRevision / pendingOps / snapshot / listeners /
  `_transitionAuth` are all untouched until the reread proves
  exact durable persistence.
- **INV-C — Read failure is not absence.** Every `getItem` in
  destructive code paths (`commitLocked`, `commitFullStateWrapper`,
  `endFullStateTransaction`, `initialLoad`) sets
  `STORE_READ_FAILED` on exception and returns without proceeding.
  Boot with unreadable primary yields a `pendingBlocker` — the
  app renders from defaults but writes refuse until the user
  acknowledges recovery.
- **INV-D — Revision monotonicity.** Recovery-mode commits mint
  `max(diskRevision, knownRevision, transitionAuth.knownRevisionAtIssue) + 1`
  so a stale-revision disk cannot let a recovery replay an earlier
  number.
- **INV-E — Every blocker class has an exact-source recovery
  path.** `_issueRecoveryAuthFromCurrentDisk` now accepts every
  active `durabilityBlocker` — corrupt JSON, malformed wrapper,
  revision regression, unsupported future schema, versionless
  primary, external clear. Auth binds to `{ sourceRawBytes,
  blockerClassAtIssue, knownRevisionAtIssue }`. Under the
  destructive lock, `commitFullStateWrapper` requires the
  currently active blocker class to match `blockerClassAtIssue`;
  a class change (another tab already recovered under a different
  blocker) fails closed with `RECOVERY_AUTH_BLOCKER_CHANGED`.
- **INV-F — Validation happens before normalization/default-fill.**
  `commitFullStateWrapper` rejects a candidate whose `logbook` is
  neither a legacy array nor a valid v14 envelope BEFORE
  `normalizeLogbookDomain` runs. This closes the R7-P1-04 defect
  where a malformed current-schema Logbook object was silently
  replaced with `defaultLogbookEnvelope()` — destroying user data.
- **INV-G — Current full-state commit accepts only current
  authoritative shape.** After `evaluateCandidateData`, prewrite
  requires `classification === 'AUTHORITATIVE_MIGRATED'`. A
  `VERIFIED_LEGACY_TRANSITION` candidate is rejected pre-write
  (`FULL_STATE_CANDIDATE_NOT_MIGRATED`) rather than mutating disk
  and then failing post-classification. All three legitimate
  callers (`Store.reset` via `defaultState()`, `restoreSnapshot`
  rewriting the marker, `processImport` via inline hydration)
  already produce migrated candidates.
- **INV-H — Quarantine is retained through destructive
  uncertainty.** Every `removeItem(quarantineKey)` after primary
  mutation begins has been removed. On any post-primary failure
  the result carries `retainedEvidenceKey: quarantineKey`.
  Successful recovery retains the quarantine per documented
  policy (Final Closure Campaign §10 preferred safe policy).
  Quarantine keys are enumerable via `Store.listQuarantineKeys()`
  for tests/diagnostics. `_allocateQuarantineKey()` checks
  `getItem === null` and retries up to 8 attempts with a fresh
  cryptographic suffix; if no unique key can be established, the
  operation aborts BEFORE any primary mutation.
- **INV-I — Historical source validation is evidence-based by
  schema version.** `HISTORICAL_SCHEMA_REQUIREMENTS` is a
  version-indexed matrix derived from `migrateUp`'s own
  field-introduction timeline. v12 and v13 carry the strict
  Codex-identified emission set (career, easa, about, sbTasks,
  goals, bht {habits, entries}, telemetry, and the arrays
  todayFocus/timeline/reviews/decisions/apartments/ideas; logbook
  as array or object; money.salary_net as number). v6..v11
  intentionally keep the runtime `validate()` floor (money +
  salary_net + qatarVisit) so existing test fixtures and older
  wrappers still boot — the strict per-version emission floor
  applies to the DESTRUCTIVE IMPORT path
  (`evaluateCandidateWrapper → validateLegacySourceRequiredFields`)
  where P1-08 lives. `<v6` fails closed as unsupported.
- **INV-J — Version provenance must be real.** `parseWrapperRaw`
  now requires `'version' in parsed`; absence classifies as
  `wrapper-version-absent` corrupt and cannot receive a legacy
  transition auth. `evaluatePersistedAuthority` surfaces the new
  `WRAPPER_VERSION_ABSENT` classification (distinct from generic
  `CORRUPT_STALE_COLLIDING`) so consumers — backup gate,
  hydration, recovery UI — can react precisely. Explicit
  legacy-only backup import (no `dune_state_v4` value in the
  backup blob) still works through `deriveStateFromLegacy`.
- **INV-K — Recovery UX reflects actual reachable recovery.** The
  Backup panel now carries a Recovery section with three
  confirmation-gated buttons that the boot banner names:
  💾 Restore latest snapshot, ⬆ Import backup file, ♻ Reset LIFE
  OS. Each handler (`window.recoveryRestoreSnapshot`,
  `triggerImportFile`, `window.recoveryResetLifeOS`) routes to
  the Store's settled-promise API and reports the truthful
  outcome via `showBackupToast` — no phantom success.
- **INV-L — Canonical docs reflect runtime, not aspiration.** This
  addendum is written after the deterministic suites pass and
  refers to the exact test names that prove each invariant.

#### Test evidence (cold Playwright)

- **PRV suite:** 72 pre-existing tests + 33 new FINAL-* tests =
  **105/105 pass cold** in this file. (R7's "73/73" self-report
  was overstated by one; Codex's "72 executable" is the accurate
  count of the R7 file. Playwright is authoritative for both.)
- **Store durability suite:** **48/48 pass cold**, unchanged.
- **Full tracked suite:** **271/271 pass cold** (up from R7's
  229/229 by 33 new PRV FINAL-* tests + 9 non-PRV specs' unchanged
  counts).
- **`node --check`** on every tracked `.js`: clean.
- **`git diff --check`:** clean.

New FINAL-* groups:
- FINAL-V1..V5 — INV-J / P1-09 (versionless primary fails closed)
- FINAL-H1..H8 — INV-I / P1-08 (v12+ historical matrix)
- FINAL-C1..C7 — INV-F + INV-G / P1-04 + P1-07 (validate-before-normalize,
  prewrite classification gate)
- FINAL-Q4..Q7 — INV-H + P2-01 (quarantine retention + unique-key)
- FINAL-D1..D5 — INV-B / P1-06 (ordinary CAS durable reread)
- FINAL-R5..R6 — INV-C + INV-D / P1-03 (read-fail closed +
  same-tab regression convergence)
- FINAL-A3..A5 — INV-A / P1-01 (authority lineage)
- FINAL-R1..R2, R4, R7 — INV-E / P1-02 (regression recovery paths)
- FINAL-U1..U4 — INV-K / P2-02 (reachable recovery UX)

**Date:** 2026-09-05 (PRV-0.5 Final Closure Campaign on branch
`claude/prv-0-5-final-closure`; base commit
`8a03ac8837a8c11d683a19ab753aabb3a7f11858`).

### ADR-015 addendum #8 (2026-09-06) — Pre-Push Amendment: atomic legacy conversion + frozen matrices

The Codex R7 remediation addendum (#7) closed the nine P1 + three P2
findings by hardening the R7 rebind architecture. The pre-push review
of the resulting closure (`6028c59da811552daf1a647db8c46026521b47ba`)
rejected that as "hardening in the wrong direction": the Stage-1
amendment requires ELIMINATION of the rebind architecture in favour
of an ATOMIC legacy conversion, plus explicit lock-required
enforcement (BINDING-1) and two frozen matrices (BINDING-3).
Addendum #8 records the resulting refactor.

**Base:** R7 exact `8a03ac8837a8c11d683a19ab753aabb3a7f11858`,
following addendum #7's local-only closure `6028c59d…`.
**Branch:** `claude/prv-0-5-final-closure`.

#### Atomic legacy conversion (§2 of the pre-push review)

Hydration is now a SINGLE full-state transaction rather than a
multi-step sequence of ordinary `Store.set` calls. The flow:

1. `initialLoad` reads the persisted raw wrapper.
2. If `parsed.version < SCHEMA_VERSION`, `initialLoad` returns
   BOTH a legacy `_transitionAuth` bound to the exact raw bytes AND a
   `STORE_LEGACY_CONVERSION_PENDING` durability blocker. The blocker
   REFUSES every ordinary `Store.set` / `Store.update` /
   `commitLocked` write (the existing guard at core.js:2148/2187/2247)
   — there is NO durable current-schema `unmigrated` operating
   state in which normal writes continue.
3. `hydratePreservationRecordsOnce()` assembles a fully-migrated
   candidate in memory (from `Store.get()` + `_buildHydratedRecords`
   seed + `status='migrated'` marker) and submits it via
   `beginFullStateTransaction` + `commitFullStateWrapper(token,
   candidate, 'legacy-conversion', { legacyConversion: true })` +
   `endFullStateTransaction`.
4. Under the exclusive Web Lock inside the coordinator,
   `commitFullStateWrapper` rereads the disk raw, requires it to
   byte-match `_transitionAuth.sourceRawBytes` (identity check),
   validates the historical source against `HISTORICAL_SCHEMA_REQUIREMENTS`,
   validates the current-schema candidate against
   `validateFullStateCanonical`, writes ONCE, rereads the durable
   primary, requires byte-match with the payload, classifies
   authority as `AUTHORITATIVE_MIGRATED`, and only then advances
   memory + clears the blocker + consumes the auth.
5. Failure at any step: no primary mutation OR (if setItem ran)
   returns `retainedEvidenceKey` and leaves the blocker intact.
   Retry re-runs the atomic conversion; the auth is still valid
   because `baseWrapperRaw` was never advanced.

The R7 rebind machinery (`authWasValidAtPreWrite` gating the
`_transitionAuth.sourceRawBytes = baseWrapperRaw` rebind in
`commitLocked`) is removed entirely — under the atomic model
ordinary CAS commits during pending legacy conversion cannot run,
so there is no intermediate state to reconcile.

`adoptExternal` now also clears `STORE_LEGACY_CONVERSION_PENDING`
when the adopted external wrapper is a valid v14
`AUTHORITATIVE_MIGRATED` — this handles the concurrent-tabs case
where Tab A's atomic commit resolves Tab B's blocker via the
storage event.

#### BINDING-1: NO LOCK = FAIL CLOSED

`commitFullStateWrapper` re-evaluates `navigator.locks` availability
at commit time for both `recovery` and `legacyConversion` modes.
If unavailable (or the test hook `Store._testForceNoLock(true)` is
set), the commit refuses immediately with `STORE_LOCK_UNAVAILABLE`
— no primary mutation, no memory advance, blocker intact. Ordinary
CAS commits still fall back to the same-tab serializer (their scope
is bounded to same-tab consistency, not cross-tab identity), so
the strict rule applies only where cross-tab identity is required.

Proven by `FINAL-L1-LEGACY-CONVERSION-NO-LOCK-FAILS-CLOSED` and
`FINAL-L2-RECOVERY-NO-LOCK-FAILS-CLOSED`.

#### BINDING-3 (A): Frozen Historical-Version Matrix — evidence-backed (Round-2 remediation)

Pre-Push Review Round-2 rejected the earlier "scope-limited"
formulation. The matrix below is now fully evidence-backed: every
`SUPPORTED` row cites the exact commit that bumped `SCHEMA_VERSION`
to that value, the code path that emitted `{version:N, data:state}`
at that commit, and the `defaultState()` shape written on that
commit's disk. Anything below the earliest confirmed emission of
the current-generation domain set FAILS CLOSED with reason
`version-unsupported`. The permissive `validate()`-floor path for
v8..v11 has been eliminated.

Every referenced SHA is an ancestor of `origin/main`
(`git merge-base --is-ancestor <sha> origin/main` returns 0).

| Version | Emitted? | Evidence (commit / file / code) | Required source shape | Legal migration path | Test evidence | Disposition |
|---|---|---|---|---|---|---|
| v0..v3 | UNPROVEN | pre-history; no `SCHEMA_VERSION` constant | — | — | (`version < 8` branch) | **FAIL CLOSED** (`version-unsupported`) |
| v4..v7 | UNPROVEN | pre-Phase-1 iterations; `defaultState()` predates bht (v7)/telemetry (v8)/ideas (v9); the current-generation domain set has no confirmed persisted artifact at v<8 | — | — | FINAL-M1, FINAL-M9 | **FAIL CLOSED** (`version-unsupported`) |
| v8 | YES | `85e1d22` (2026-06-14) "core.js: additive v7 → v8 schema migration — add telemetry slice" — `core.js:11` bumps `SCHEMA_VERSION` 7→8; `core.js:110` seeds `telemetry` in `defaultState()`; `core.js:282-283` emits `JSON.stringify({version: SCHEMA_VERSION, data: state})` unchanged | money{salary_net:number}, qatarVisit obj, career obj, easa obj, about obj, sbTasks obj, goals obj, telemetry obj, bht{habits:array, entries:array}, todayFocus[], timeline[], reviews[], decisions[], apartments[], logbook (array-or-object) | v8 → v9 → v10 → v11 → v12 → v13 → v14 (steps in `core.js:migrateUp`) | FINAL-M2, FINAL-M5 | **SUPPORTED** |
| v9 | YES | `cea0dab` (2026-06-15) "Add Ideas section — parking lot for what's next" — `core.js:11` bumps 8→9; `core.js:115` seeds `ideas: []` in `defaultState()`; migrateUp v8→v9 seeds `s.ideas = []`; write path unchanged | v8 shape + `ideas: array` | v9 → v10 → … → v14 | FINAL-M6, FINAL-M10 | **SUPPORTED** |
| v10 | YES | `04af26a` (2026-06-19) "About You: update with everything added since the original build" — `core.js:11` bumps 9→10; migrateUp v9→v10 touches `s.about.lastUpdated` only, no domain added | v9 shape (unchanged domain set) | v10 → v11 → … → v14 | FINAL-M7 | **SUPPORTED** |
| v11 | YES | `8a1e374` (2026-06-19) "About: fix date — 19 June, not 15" — `core.js:11` bumps 10→11; migrateUp v10→v11 touches `s.about.lastUpdated` only, no domain added | v9 shape (unchanged domain set) | v11 → v12 → v13 → v14 | FINAL-H6, FINAL-M8, FINAL-M10 | **SUPPORTED** |
| v12 | YES | `521fe70` (2026-08-25) "feat(logbook): add canonical mirror phase A" — `core.js` bumps 11→12; introduces logbook envelope + records mirror in defaultState | v9 shape (logbook now array-or-object envelope; records subtree migrates in at v13→v14, not required in source) | v12 → v13 → v14 | FINAL-H1..H4, FINAL-H8, FINAL-M3 | **SUPPORTED** |
| v13 | YES | `94254c4` (2026-08-25) "feat(store): B0 durability protocol (schema-13 wrapper + CAS + coordinator)" — wrapper adds integer `revision` + `committedAt`; data shape unchanged from v12 | v12 shape; wrapper-level integer `revision` enforced by `parseWrapperRaw` (not this validator) | v13 → v14 | FINAL-H5, FINAL-H7 | **SUPPORTED** |
| v14 | YES | `4ead699` (2026-08-29) "feat(prv-0.5-r2): schema 14 migration marker + durable-verified hydration" — adds records subtree + `meta.recordsMigration`. Current `SCHEMA_VERSION`. | current — validated by `validateFullStateCanonical`, not this legacy validator | (identity; no migration) | validateFullStateCanonical tests | **SUPPORTED** (current) |
| v>SCHEMA_VERSION | UNPROVEN | future | — | — | `STORE_UNSUPPORTED_FUTURE_SCHEMA` blocker tests (PRV-R5-P1-5-*, PRV-R7-T19/T20) | **FAIL CLOSED** (`version-unsupported-future` at wrapper parse) |

Enforcement in `validateLegacySourceRequiredFields`:
- `version < 8` → `{ ok:false, reason:'version-unsupported', version }`. FAIL CLOSED (FINAL-M1, FINAL-M9).
- `version >= 8` → strict `HISTORICAL_SCHEMA_REQUIREMENTS[min(version, 13)]` applied to `data`: every required object present as a non-null non-array object, every required array present as an actual array, and the nested shape gate enforces `bht.habits`, `bht.entries`, `logbook` (array-or-object), and `money.salary_net` (number). Any miss fails closed with `missing-<domain>` or `malformed-<path>` or `malformed-bht-substructure`.
- `getHistoricalRequirements(v)` returns the frozen matrix row for `v ∈ [8, SCHEMA_VERSION)` and `null` outside that range.

Proven by:
- SUPPORTED rows: FINAL-M2 (v8 accepted / minimal rejected), FINAL-M5 (v8 telemetry-required), FINAL-M6 (v9 ideas-required), FINAL-M7 (v10 shares v9 shape), FINAL-M8 (v11 malformed-bht), FINAL-M10 (v11 full-shape migrates to canonical v14 with sentinel salary preserved), FINAL-H1..H8 (v12/v13 strict matrix + sentinel preservation), FINAL-H6 (v11 full-shape accepted / minimal rejected).
- FAIL-CLOSED rows: FINAL-M1 (v7 rejected), FINAL-M9 (v7 boundary — rejected even for shape that would otherwise pass a later matrix).
- Matrix exposure: FINAL-M4 (v8..v13 return non-null; v7 and v14 return null).

#### BINDING-3 (B): Frozen Blocker/Recovery Matrix

Every blocker class in the Store, its allowed operations, source
identity requirement, revision behavior, quarantine behavior,
required lock, and post-failure/success states:

| Blocker | Set by | Ordinary set/update/flush | Import (recovery mode) | Snapshot restore | Reset | Source identity | Revision after recovery | Quarantine | Lock | Post-failure state | Post-success state |
|---|---|---|---|---|---|---|---|---|---|---|---|
| STORE_LEGACY_CONVERSION_PENDING | initialLoad (raw version < SCHEMA_VERSION) | reject | permitted (recovery) | permitted (recovery) | permitted (recovery) | exact raw bytes match at commit time | monotonic > max(disk, known, knownAtIssue) | none | REQUIRED | blocker intact, disk unchanged | blocker cleared, disk = new v14 |
| STORE_CORRUPT_AUTHORITATIVE_STATE | initialLoad (unparseable / migrateAndValidate fail); onStorage on non-parseable adoption; commitLocked / commitFullStateWrapper on corrupt disk under lock | reject | permitted (recovery) | permitted (recovery) | permitted (recovery) | exact raw bytes match | monotonic ≥ 1 (disk revision unknown, use known+1) | REQUIRED — writes verified quarantine of source bytes before primary; retained on all failure paths; retained on success | REQUIRED | blocker intact, disk unchanged, retainedEvidenceKey returned | blocker cleared, quarantine retained |
| STORE_REVISION_REGRESSION | commitLocked / onStorage / endFullStateTransaction on disk revision < knownRevision | reject | permitted (recovery) | permitted (recovery) | permitted (recovery) | exact raw bytes match + blocker-class match + knownRevisionAtIssue captured | monotonic > max(disk, known, knownAtIssue) | none (source is parseable, no need) | REQUIRED | blocker intact | blocker cleared, revision advances |
| STORE_STATE_CLEARED_EXTERNAL | commitLocked / onStorage when disk absent but baseWrapperRaw was non-null | reject | permitted (recovery) | permitted (recovery) | permitted (recovery) | absence identity check (auth.absent === true) | monotonic > max(disk, known, knownAtIssue) | none | REQUIRED | blocker intact, disk still absent | blocker cleared, disk = new v14 |
| STORE_UNSUPPORTED_FUTURE_SCHEMA | parseWrapperRaw on parsed.version > SCHEMA_VERSION | reject | permitted (recovery) — user must confirm | permitted (recovery) | permitted (recovery) | exact raw bytes match | monotonic > max | none | REQUIRED | blocker intact | blocker cleared |
| STORE_READ_FAILED | initialLoad / commitLocked / commitFullStateWrapper / endFullStateTransaction on getItem exception | reject | reject until readable | reject until readable | reject until readable | n/a (cannot read) | n/a | none | blocker intact | blocker cleared only once reads succeed and a full-state commit lands |
| STORE_ORDINARY_DURABLE_VERIFY_FAILED | commitLocked when reread ≠ payload (silent no-op, altered bytes, truncated) | reject | permitted (recovery) | permitted (recovery) | permitted (recovery) | exact raw bytes match | monotonic > max | none (writes originated from ordinary CAS, not recovery-triggered mutation) | REQUIRED | blocker intact, pending ops retained, no memory / snapshot / listener advance | blocker cleared |
| STORE_ORDINARY_DURABLE_READ_FAILED | commitLocked when post-write getItem throws | reject | reject until readable | reject until readable | reject until readable | n/a | n/a | none | blocker intact | blocker cleared once reads succeed |
| STORE_FULL_STATE_POST_WRITE_UNCERTAIN | commitFullStateWrapper post-write reread ≠ payload OR post-write authority classification not AUTHORITATIVE_MIGRATED. Recorded in `_fullStatePostWriteUncertain` and installed by endFullStateTransaction. | reject | permitted (recovery) | permitted (recovery) | permitted (recovery) | fresh candidate + normal source-identity rules | monotonic > max(disk, known, knownAtIssue) | retained from the failed commit (evidence key surfaced in blocker detail) | REQUIRED | blocker intact, memory (baseState / knownRevision / baseWrapperRaw / snapshot) UNCHANGED — the divergent disk bytes are NOT adopted; NO success publication (rebuildOptimistic and notifyAll are skipped; subscribers receive ZERO notifications from this settlement); `emitError` fires the blocker record and `lifeos:store-durability-blocked` dispatches; `lifeos:store-freeze-end` fires with `detail.failure=true` so listeners can distinguish uncertainty-settled from success-settled; endFullStateTransaction returns `{ok:false, settlement:'FULL_STATE_POST_WRITE_UNCERTAIN', commitError, durabilityBlocker}` | blocker cleared once a subsequent full-state transaction commits and durably verifies |

Proven by:
- STORE_LEGACY_CONVERSION_PENDING → FINAL-A3, FINAL-L1, PRV-R2-DURABILITY-FAILURE, PRV-R2-CROSS-TAB-DURABILITY, PRV-R3-SIMULTANEOUS-TABS-P1-3
- STORE_CORRUPT_AUTHORITATIVE_STATE → PRV-R6-P1-2-CORRUPT-DISK-*, PRV-R7-T10..T14, FINAL-Q4..Q7, FINAL-L2
- STORE_REVISION_REGRESSION → FINAL-R1, FINAL-R2, FINAL-R4, FINAL-R5, FINAL-R7
- STORE_STATE_CLEARED_EXTERNAL → PRV-R5-P1-1-* (existing coverage)
- STORE_UNSUPPORTED_FUTURE_SCHEMA → PRV-R5-P1-5-*, PRV-R7-T19/T20
- STORE_READ_FAILED → FINAL-R6
- STORE_ORDINARY_DURABLE_VERIFY_FAILED → FINAL-D2, FINAL-D3, FINAL-D5
- STORE_ORDINARY_DURABLE_READ_FAILED → covered by FINAL-D1's read-failure adjacency (same code path)
- STORE_FULL_STATE_POST_WRITE_UNCERTAIN → R3-P1-01a, R4-P1-01a (altered-valid), R4-P1-01b (post-write reread throw), R4-P1-01c (silent primary no-op), R4-P1-01d (post-write authority-classification fail), R4-P1-01e (recovery-mode altered-valid); production paths R4-P1-02-BOOT / -IMPORT / -SNAPSHOT prove no success settlement, primary unchanged, zero subscriber notifications. See also FINAL-D-family for the underlying FULL_STATE_DURABLE_VERIFY_FAILED / FULL_STATE_POST_WRITE_VERIFICATION_FAILED commit-return codes.

#### R7 P1/P2 re-evaluation

All addendum #7 closures preserved. R7-P1-01 is now closed by
ELIMINATION of the rebind architecture (per pre-push review §7),
not by hardening it. Every other closure retained.

#### Binding gates

- **BINDING-1** (NO LOCK = FAIL CLOSED): **PASS**. `commitFullStateWrapper`
  refuses recovery + legacy-conversion commits at entry when
  `navigator.locks` is unavailable. Proven by FINAL-L1, FINAL-L2.
- **BINDING-2** (one durable-write contract): **PASS**. Ordinary CAS
  (INV-B / addendum #7) and full-state (recovery + legacy conversion)
  both reread + byte-match before advancing memory/snapshot/listener
  state. Proven by FINAL-D1..D5, FINAL-Q4..Q7, all commit-failure
  paths in the PRV suite.
- **BINDING-3-A** (frozen Historical-Version Matrix): **PASS**.
  Every supported historical version is anchored to a concrete
  emission commit (see BINDING-3-A matrix above). Interpolated
  SUPPORTED rows have been eliminated. `v < 8` fails closed with
  `version-unsupported`; `v >= 8` uses the strict per-version
  matrix — the permissive runtime-floor path is gone.
- **BINDING-3-B** (frozen Blocker/Recovery Matrix): **PASS**.
  Documented in the table above with per-row test citations.

**Date:** 2026-09-06 (Pre-Push Amendment on branch
`claude/prv-0-5-final-closure`; base commit
`8a03ac8837a8c11d683a19ab753aabb3a7f11858`).

### ADR-015 addendum #9 (2026-09-06) — Pre-Push Review Round-2 remediation: evidence-backed Historical-Version Matrix (BINDING-3-A closure)

**Trigger.** ChatGPT Pre-Push Review Round-2
(`93-PRV-0.5-PRE-PUSH-REVIEW-R2-HISTORICAL-MATRIX-CLOSURE.md`)
rejected the addendum #8 formulation of BINDING-3-A: the matrix
still carried interpolated `SUPPORTED` rows for v9/v10/v11 and a
permissive `validate()`-floor path for v8..v11 that did not meet
the frozen rule "historical support must be derived from actual
repository-emitted schemas". The Round-2 authorization
(`94-PRV-0.5-ROUND2-REMEDIATION-AUTHORIZATION.md`) required
extraction of concrete emission evidence per version or
fail-closed for anything unproven.

**What was extracted.** `git log --pickaxe-regex -S
"SCHEMA_VERSION\s*=\s*[0-9]+"` returned every commit that mutated
the constant. For each of v8..v11 we then verified:

1. The exact commit that bumped `SCHEMA_VERSION` (`core.js:11`).
2. That the write path `JSON.stringify({version: SCHEMA_VERSION, data: state})` (currently at ~`core.js:282-283` at each of those SHAs) was still present and unchanged, so that build DID emit `{version:N, data:state}` to `localStorage[STATE_KEY]` on any user's disk.
3. The `defaultState()` shape at that commit (evidence of what the emitted `data` contained).
4. That the commit is an ancestor of `origin/main`.

Result: every version v8..v14 has direct emission evidence (see
BINDING-3-A matrix above). Nothing below v8 has any confirmed
emission of the current-generation domain set, so v<8 remains
FAIL CLOSED.

**Behavior change.**

`validateLegacySourceRequiredFields` in `core.js` now:

- Rejects `version < 8` with `version-unsupported`.
- Applies the strict `HISTORICAL_SCHEMA_REQUIREMENTS[min(v, 13)]`
  matrix for every `version >= 8` — no permissive floor anywhere.

`HISTORICAL_SCHEMA_REQUIREMENTS` gains rows for v8, v9, v10, v11
(all reusing the same requiredObjects set and either v8's
requiredArrays for v8, or the v9+ set that also requires `ideas`).
`getHistoricalRequirements(v)` now returns the row for
`v ∈ [8, SCHEMA_VERSION)`.

`_migration-legacy-records.js` is unchanged; the migrateUp chain
still spans v8→…→v14 and no legitimate emission path was
regressed.

**Impact on existing tests.** Six test files carried minimal
`{version: 11, data: {money:{salary_net}, qatarVisit:{}}}` legacy
seeds that were valid under the old permissive floor but are
UNPROVEN wrappers under the strict matrix (this repository never
emitted them). Those seeds were rewritten to the full v11
defaultState shape:

- `tests/import-restore.spec.js` — introduces
  `_fullLegacyV11Data(salary)` helper; `minState()` and all four
  other minimal-v11 usages route through it.
- `tests/logbook-canonicalization.spec.js` — L20, L21, L40 seeds
  extended.
- `tests/store-durability.spec.js:793` — `_fullLegacyV11` seed.
- `tests/finance-bridge.spec.js` — `seedFinance` writes full-shape
  v11.
- `tests/prv-preservation.spec.js` — FINAL-H6 and FINAL-M2 flipped
  from "minimal accepted" to "full-shape accepted AND minimal
  rejected"; FINAL-M4 updated to expose v8..v13 (not just v12-v13).

**New tests.** FINAL-M5 (v8 telemetry-required), FINAL-M6 (v9
ideas-required), FINAL-M7 (v10 shares v9 shape / missing-bht
rejected), FINAL-M8 (v11 malformed-bht rejected), FINAL-M9 (v7
FAIL-CLOSED boundary), FINAL-M10 (v11 full-shape migrates to
canonical v14 with 24680 sentinel salary preserved).

**Preservation.** The atomic legacy conversion architecture,
BINDING-1 (NO LOCK = FAIL CLOSED), BINDING-2 (one durable-write
contract), BINDING-3-B (blocker/recovery matrix), quarantine
retention, revision-regression recovery, read-failure fail-closed
semantics, malformed-Logbook rejection, versionless-primary
rejection, and every R7 P1/P2 closure remain intact. No transition-auth
rebinding was reintroduced.

**Effect on binding closure summary:**

- BINDING-1: PASS (unchanged from addendum #8).
- BINDING-2: PASS (unchanged from addendum #8).
- BINDING-3-A: **PASS** (was PASS-with-scope-limit in addendum #8).
- BINDING-3-B: PASS (unchanged from addendum #8).

**Date:** 2026-09-06 (Round-2 remediation on branch
`claude/prv-0-5-final-closure`; parent commit
`7829009965bb41add17640766e4ee0f114e8cc78`). Local only, unpushed.

### ADR-015 addendum #10 (2026-09-06) — Codex final-review Round-3 remediation: four P1 fixes + BINDING-3-B extension

**Trigger.** The independent Codex final exact-SHA review of
`25ba8cca24716cdd5629e4afb7feb503c772869f` returned FAIL
(`101-PRV-0.5-CODEX-FINAL-GATE-REMEDIATION.md`) with four P1
data-integrity defects and one P2 documentation defect. This
remediation closes all five on the same Final Closure branch,
local only.

**Fixes.**

**P1-01 — full-state transaction settlement.** A composition
failure between `commitFullStateWrapper` and
`endFullStateTransaction` let post-write uncertainty (durable
reread ≠ payload, or post-write authority classification failure)
be independently observed by settlement, which then adopted the
divergent disk bytes as authority. Round-3 introduces the
module-level `_fullStatePostWriteUncertain` flag: both post-write
failure branches record uncertainty before returning failure;
`beginFullStateTransaction` clears it on every entry;
`endFullStateTransaction` consumes it and, when set, installs a
truthful `STORE_FULL_STATE_POST_WRITE_UNCERTAIN` durability
blocker and skips every adopt-newer/adopt-different branch —
`baseState`, `knownRevision`, `committedAt`, `baseWrapperRaw`, the
snapshot fan-out, and subscriber notifications are NOT advanced.
Proof: `R3-P1-01a-ALTERED-VALID-BYTES-NOT-ADOPTED`.

**P1-02 — Logbook validation before normalization.**
`normalizeLogbookDomain` previously replaced a malformed persisted
Logbook object with an empty envelope BEFORE source validation ran
— erasing the sentinel bytes across boot conversion / import /
snapshot restore. Round-3 pushes the version-specific Logbook
contract into the strict source matrix (`_V8_NESTED` requires
`'logbook': 'array'` for v8..v11 emission at 85e1d22..8a1e374;
`_V12_NESTED` requires `'logbook': 'logbook-envelope'` for v12..v13
emission from 521fe70 onward), tightens
`validateFullStateCanonical` to reject arbitrary non-envelope
objects as `logbook`, and changes `normalizeLogbookDomain` to
perform only the contractually-permitted array→envelope migration
(a genuinely absent `logbook` still gets a fresh default envelope;
a present-but-malformed value is now LEFT for the caller's
validator to reject). Proof: `R3-P1-02-V13-MALFORMED-LOGBOOK-OBJECT-REJECTED`
and `R3-P1-02b-V11-OBJECT-LOGBOOK-REJECTED`.

**P1-03 — Historical contract completeness + immutability.** The
matrix in addendum #9 was incomplete: `meta` and `money.expenses`
were emitted by every v8..v13 `defaultState()` but were not
required by the validator (default-fill downstream could
fabricate/erase persisted user state), and the generic
`array-or-object` Logbook rule accepted arbitrary objects. Round-3
adds `meta` to `_V8_REQUIRED_OBJECTS`, `money.expenses: 'object'`
to `_V8_NESTED` and `_V12_NESTED`, and replaces the generic
Logbook rule with version-specific `'array'` / `'logbook-envelope'`
kinds (see P1-02). `HISTORICAL_SCHEMA_REQUIREMENTS` is now
`Object.freeze`d at definition with `Object.freeze`d inner rows
(and `Object.freeze`d inner containers); `getHistoricalRequirements`
returns a fresh deep-frozen snapshot so mutation of the exposed
object cannot alter internal validator behavior. Proofs:
`R3-P1-03-META-REQUIRED`, `R3-P1-03-EXPENSES-REQUIRED`,
`R3-P1-03-MUT-IMMUTABLE-DIAGNOSTIC`.

**P1-04 — v14 snapshot revision enforcement.**
`isValidSnapshotWrapperShape` previously required integer
revision only for `parsed.version === 13`, leaving current v14
(and any future ≥13 SCHEMA_VERSION bump) unvalidated at the
wrapper level. Round-3 broadens the check to `parsed.version >= 13`
so `validateSnapshotWrapperFull` refuses a v14 snapshot with a
missing / malformed / out-of-range revision BEFORE
`commitFullStateWrapper` is even called. Proof:
`R3-P1-04-V14-SNAPSHOT-MISSING-REVISION-REJECTED`.

**BINDING-3-B extension.** New row for
`STORE_FULL_STATE_POST_WRITE_UNCERTAIN` documenting the actual
implementation: ordinary writes reject; import/snapshot/reset
permitted as explicit recovery; source identity uses the normal
rules for the recovery attempt; revision advances monotonically;
quarantine retained from the failed commit and surfaced in the
blocker detail; lock required; post-failure state is
memory-unchanged with disk uncertain and the blocker set;
recovery clears the blocker only after a subsequent full-state
transaction commits and durably verifies.

**P2-01 — Documentation truthfulness.** Test count references in
addendum #8 / #9 are superseded by this addendum's Round-3 cold
Playwright output. Two logbook tests whose old assertions
described obsolete "silent recovery from malformed source"
semantics were rewritten in addendum #9 (L19, L32) to assert the
new atomic-conversion-blocker semantics; both remain green.
FINAL-C4 was retargeted from v13 (which now requires the
envelope) to v11 (where the array shape was the actual
emission), preserving the test's spirit while aligning it with
the frozen historical contract.

**Effect on binding closure summary:**

- BINDING-1: PASS (unchanged).
- BINDING-2: **PASS** (now covers post-write uncertainty).
- BINDING-3-A: PASS (completeness gap closed — `meta`,
  `money.expenses`, version-specific Logbook).
- BINDING-3-B: PASS (matrix extended with
  `STORE_FULL_STATE_POST_WRITE_UNCERTAIN`).

**Date:** 2026-09-06 (Round-3 remediation on branch
`claude/prv-0-5-final-closure`; parent commit
`25ba8cca24716cdd5629e4afb7feb503c772869f`, the frozen remote
candidate — unchanged by this remediation). Local only, unpushed.

### ADR-015 addendum #11 (2026-09-06) — Round-3 pre-push review remediation: BINDING-2 listener semantics + five-case fault matrix + real production-path proofs

**Trigger.** ChatGPT pre-push review of `f2dc754b172a…`
(`103-PRV-0.5-ROUND3-PRE-PUSH-REVIEW-FAIL.md`) returned FAIL with
six defect classes:

1. **P1** — `endFullStateTransaction` still called `rebuildOptimistic()` + `notifyAll()` after post-write uncertainty, violating BINDING-2's "no listener success after post-write verification failure".
2. **P1** — Round-3 added only one BINDING-2 fault-injection test (altered-valid); the review demanded permanent regression tests for all five defect classes (altered-valid, reread throw, silent primary no-op, post-write authority-classification fail, recovery altered-valid).
3. **P1** — Malformed-Logbook coverage still routed through `commitFullStateWrapper` directly instead of the real `processImport` / `restoreSnapshot` / boot compositions.
4. **P1** — v14 snapshot revision was only exercised through the `validateSnapshotWrapperFull` helper, not through real `Store.restoreSnapshot()`.
5. **P1** — Historical-contract completeness relied on prose inspection instead of a deterministic evidence oracle.
6. **P1** — BINDING-3-B row for the uncertainty blocker did not explicitly document listener/publication semantics.

**Fixes.**

**P1 listener semantics.** `endFullStateTransaction`'s
post-write-uncertainty branch now short-circuits BEFORE
`rebuildOptimistic()` and `notifyAll()`. It returns
`{ok:false, settlement:'FULL_STATE_POST_WRITE_UNCERTAIN', commitError, durabilityBlocker}`
without running the ordinary success-publication path. Failure
signals still fan out — `setDurabilityBlocker` fires
`emitError` and the `lifeos:store-durability-blocked` custom
event during the uncertainty branch above; a separate
`lifeos:store-freeze-end` event is dispatched with
`detail.failure=true` so any listener that gates "settlement
completed" on that event can distinguish the two outcomes. The
`ok:true` return path is untouched.

**Five-case fault-injection matrix.** New R4 tests in
`tests/prv-preservation.spec.js` cover every failure mode the
review demanded, each asserting: commit fails, memory (Store.get)
unchanged, wrapper revision unchanged, snapshots unchanged, ZERO
subscriber notifications, and `STORE_FULL_STATE_POST_WRITE_UNCERTAIN`
blocker installed:

- `R4-P1-01a` altered-valid durable bytes.
- `R4-P1-01b` post-write reread throws (getItem error inside verification).
- `R4-P1-01c` silent primary no-op (setItem swallowed for STATE_KEY).
- `R4-P1-01d` post-write authority-classification failure (bytes match payload but `evaluateCandidateData` classifies MALFORMED_CURRENT_SCHEMA).
- `R4-P1-01e` recovery-mode altered-valid (`opts.recovery:true` after a corrupt-disk boot + `prepareRecoveryAuth`).

**Real production-path Logbook coverage.**

- `R4-P1-02-BOOT-MALFORMED-LOGBOOK-REAL-CONVERSION` — seeds disk with a malformed v12 Logbook wrapper; app boots; `hydratePreservationRecordsOnce()` refuses conversion; `STORE_LEGACY_CONVERSION_PENDING` stays; disk raw bytes are byte-identical to the seed.
- `R4-P1-02-IMPORT-REAL-MALFORMED-LOGBOOK` — invokes the real `window.processImport()` with a v14 backup whose Logbook is a plain string; `processImport` returns false; primary bytes unchanged; zero subscriber notifications.
- `R4-P1-02-SNAPSHOT-REAL-MALFORMED-LOGBOOK` — seeds a v14 snapshot with a malformed-Logbook payload into `dune_snapshots_v1`; invokes real `Store.restoreSnapshot()`; the settled result is not ok; primary bytes unchanged; zero subscriber notifications.

**Real Snapshot Restore revision coverage.**

- `R4-P1-04-RESTORE-VALID-V14` — valid v14 snapshot with integer revision succeeds through `Store.restoreSnapshot()`; sentinel salary lands.
- `R4-P1-04-RESTORE-V14-MISSING-REV-REJECTED` — missing revision → `restoreSnapshot` rejected at the shape gate; primary unchanged.
- `R4-P1-04-RESTORE-V14-STRING-REV-REJECTED` — `revision:'not-a-number'` → rejected; primary unchanged.
- `R4-P1-04-RESTORE-V14-NEGATIVE-REV-REJECTED` — `revision:-1` → rejected; primary unchanged.
- `R4-P1-04-RESTORE-FUTURE-VERSION-REJECTED` — `version:99` snapshot → rejected; primary unchanged.

**Historical-contract completeness oracle.**

- `R4-P1-03-EVIDENCE-ORACLE` — for every v8..v13, iterates the emitted `defaultState()` top-level domains (extracted from `git show <SHA>:core.js` at each version-bump commit) and asserts every one is either in `requiredObjects`, `requiredArrays`, or the top-level of some `nested` path. Any future addition to `defaultState()` that is not reflected in the validator will fail this oracle before it reaches production.
- `R4-P1-03-EXPENSES-NESTED-ENFORCED` — asserts every v8..v13 row has `money.expenses` in its nested spec (a top-level `money` object without `expenses` would otherwise pass the object check).

**BINDING-3-B row extension.** The `STORE_FULL_STATE_POST_WRITE_UNCERTAIN` row now explicitly documents:

- Post-failure memory: `baseState`, `knownRevision`, `baseWrapperRaw`, and the snapshot fan-out are UNCHANGED.
- Post-failure publication: `rebuildOptimistic()` and `notifyAll()` are SKIPPED; subscribers receive ZERO notifications from this settlement.
- Signal path: `setDurabilityBlocker` fires `emitError` + `lifeos:store-durability-blocked`; a `lifeos:store-freeze-end` event with `detail.failure=true` distinguishes uncertainty-settled from success-settled.
- Return contract: `endFullStateTransaction` returns `{ok:false, settlement:'FULL_STATE_POST_WRITE_UNCERTAIN', commitError, durabilityBlocker}` — not the success shape.

**Effect on binding closure summary:**

- BINDING-1: PASS (unchanged).
- BINDING-2: **PASS** (five-case fault matrix + listener semantics + real production compositions).
- BINDING-3-A: PASS (unchanged — completeness closed in addendum #10).
- BINDING-3-B: PASS (matrix row now covers listener/publication behavior + all Round-4 tests cited).

**Date:** 2026-09-06 (Round-4 remediation on branch
`claude/prv-0-5-final-closure`; parent commit
`f2dc754b172a4108a281663d669680528a08c26a`; the frozen remote
candidate `25ba8cca24716cdd5629e4afb7feb503c772869f` is unchanged
by this remediation). Local only, unpushed.

### ADR-015 addendum #12 (2026-09-06) — Round-4 pre-push review remediation: blocker truth-fulness after post-write uncertainty + deterministic auth-classification probe

**Trigger.** ChatGPT pre-push review of `711f793b85464605d2874803cc727b55a471707d`
(`105-PRV-0.5-ROUND4-PRE-PUSH-REVIEW-FAIL.md`) returned FAIL with
three narrow issues:

1. **Recovery post-write blocker can preserve a stale pre-write blocker.** The Round-4 uncertainty branch guarded `setDurabilityBlocker` with `if (!durabilityBlocker)` — so a corrupt-authority recovery flow that then failed durable verification kept `STORE_CORRUPT_AUTHORITATIVE_STATE` as the active blocker. That claim describes the pre-write generation, which may have been REPLACED by the failed write. Preserving it lets a listener treat "old corrupt bytes are still there" as current truth.
2. **Auth-classification probe not deterministic.** `R4-P1-01d` allowed either `FULL_STATE_DURABLE_VERIFY_FAILED` OR `FULL_STATE_POST_WRITE_VERIFICATION_FAILED`, so the intended branch wasn't proven to run.
3. **Required `npx playwright test --list` command not executed.** Round-4 relied on the line reporter's `[N/N]` counter.

**Fixes.**

**Blocker truthfulness.** `endFullStateTransaction`'s uncertainty branch now UNCONDITIONALLY calls `setDurabilityBlocker('STORE_FULL_STATE_POST_WRITE_UNCERTAIN', detail)` — no guard on the pre-existing blocker. The prior blocker (if any) is retained in `detail.priorBlocker: {code, since, detail}` for diagnostic history. Ordinary-write acceptance / recovery-mode acceptance flow from the new active blocker's code, not from the retired history.

**Deterministic auth-classification probe.** New test-only hook `Store._testForcePostWriteEvalFailure(bool)` — analogous to `_testForceNoLock`. When set, the post-write `evaluateCandidateData` call is replaced with `{canonical: false, classification: 'TEST_FORCED_NON_CANONICAL'}` so `commitFullStateWrapper` deterministically returns `FULL_STATE_POST_WRITE_VERIFICATION_FAILED`. `R4-P1-01d` uses the hook and asserts exactly that error code, `classification === 'TEST_FORCED_NON_CANONICAL'`, `endSettlement === 'FULL_STATE_POST_WRITE_UNCERTAIN'`, blocker `STORE_FULL_STATE_POST_WRITE_UNCERTAIN`, zero subscriber notifications, memory unchanged, snapshots unchanged.

**Cold `--list` evidence.** Recorded in this remediation's cold run:

- `npx playwright test --list` → **Total: 305 tests in 9 files**.
- `npx playwright test tests/prv-preservation.spec.js --list` → **Total: 148 tests in 1 file**.
- Both discovery counts match the executed suite.

**Effect on binding closure summary:**

- BINDING-1: PASS (unchanged).
- BINDING-2: PASS (uncertainty blocker is now always truthful; the deterministic auth-classification branch is proven).
- BINDING-3-A: PASS (unchanged).
- BINDING-3-B: PASS (uncertainty row unchanged; the blocker-overwrite rule is a within-row policy tightening — the "post-failure state" column already committed to "active blocker code reflects the current epistemic state").

**Date:** 2026-09-06 (Round-5 remediation on branch
`claude/prv-0-5-final-closure`; parent commit
`711f793b85464605d2874803cc727b55a471707d`; the frozen remote
candidate `25ba8cca24716cdd5629e4afb7feb503c772869f` remains
unchanged). Local only, unpushed.
