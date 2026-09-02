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
