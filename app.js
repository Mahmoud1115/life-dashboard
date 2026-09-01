// DUNE LIFE OS — Application Logic v2.0
// All JS lives here. data.js must load first.

/* ═══════════════════════════════════════════
   STORAGE HELPERS
   ═══════════════════════════════════════════ */
const LS = {
  get:(k,def)=>{ try{ const v=localStorage.getItem(k); return v===null?def:JSON.parse(v); }catch(e){return def;} },
  set:(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};

/* ═══════════════════════════════════════════
   PRV-0.5 Round 2 — Preservation hydration (ADR-015 addendum #1).

   Migration authority now lives INSIDE the coordinated wrapper as
   `state.meta.recordsMigration = { status, at, ... }` (schema 14).
   The previous out-of-band Gen-1 sticky flag `dune_records_hydrated_v1`
   has been removed — it could survive a durability failure (flag set
   in localStorage while records.* absent from the wrapper) and permanently
   skip migration in later tabs.

   Semantics after the schema bump:

     - `defaultState()` (fresh browser + Reset) → status: 'migrated', records: {} (all empty).
       Cold-boot fresh browsers and post-Reset states are already-migrated
       with empty records; hydration is a no-op. Legacy personal records
       CANNOT resurrect from Reset.

     - `migrateUp` on a v13-or-earlier wrapper → status: 'unmigrated',
       records: { …empty arrays }. Hydration in this file seeds records
       from LEGACY_RECORDS (with per-id override merge from any surviving
       Gen-1 keys) and, ONLY AFTER durable persistence is verified,
       flips the marker to 'migrated'.

     - Import of a pre-PRV backup via `processImport()` → the coordinated
       transaction re-runs migrateUp on the imported wrapper, so the
       committed state carries status='unmigrated'. Convergence to
       `migrated` lands via the scheduled `location.reload()` at the
       end of `processImport()`, which re-runs boot-time hydration
       under the `lifeos-prv05-migrate` Web Lock. NOTE: production
       `commitFullStateWrapper()` does NOT fire ordinary Store.onSave
       listeners for the committed wrapper (only `restoreSnapshot()`
       and `reset()` explicitly fan out onSave from a full-state
       commit), so the reload — not an `onSave` re-invocation — is
       the authoritative convergence path for import.

   Durability contract:

       enqueue records.* + meta.recordsMigration-intent
             ↓
       await onSave (the wrapper commit lands)
             ↓
       re-read dune_state_v4 from localStorage
             ↓
       verify all 4 domains are persisted AND status flipped to 'migrated'
             ↓
       report ok:true — otherwise the marker stays 'unmigrated' and
       retry is possible on next boot / next onSave.

   Concurrency: hydration serializes internally via `hydrationInFlight`
   so a boot-time invocation and an onSave-triggered re-invocation
   cannot race. Store's own Web-Locks coordinator serializes wrapper
   commits across tabs.
   ═══════════════════════════════════════════ */

const MIGRATION_MIGRATED = 'migrated';
const MIGRATION_UNMIGRATED = 'unmigrated';
const PRV05_MIGRATE_LOCK = 'lifeos-prv05-migrate';

// PRV-0.5 R4 (Codex Round-3 P1-A): "already migrated" must be judged from
// the PERSISTED wrapper in localStorage, and BOTH the outer wrapper AND
// the inner data must satisfy the Store's own authority rules — never
// only the inner shape. R3 shipped an inner-only check, and Codex R3
// showed that a wrapper with revision=-1 or version=13 carrying
// canonical schema-14 inner data still fast-path-returned migrated.
// This helper now delegates the outer wrapper check to Store's own
// parseWrapper/isValidRevision (single source of authority) and
// additionally requires:
//   - version === SCHEMA_VERSION (14) — no old-schema wrapper enters
//     the "already migrated" fast path merely because its inner data
//     happens to resemble schema 14;
//   - revision satisfies Store's isValidRevision predicate;
//   - revision is not stale relative to the Store's accepted disk
//     revision (Store.currentKnownRevision).
// Any deviation returns ok:false, so hydration falls through to the
// heal/migrate path instead of trusting the wrapper.
function _readPersistedWrapper() {
  let raw;
  try { raw = localStorage.getItem('dune_state_v4'); } catch (e) { return { ok: false, reason: 'read-error' }; }
  if (raw === null || raw === undefined) return { ok: false, reason: 'absent' };
  // Prefer Store's own wrapper parser so the fast path cannot accept a
  // wrapper Store would reject at initialLoad/setWrapperFromOps.
  const storeHasParser = !!(window.Store && typeof window.Store.parseWrapper === 'function');
  if (storeHasParser) {
    const parsed = window.Store.parseWrapper(raw);
    if (!parsed) return { ok: false, reason: 'parse-error' };
    if (parsed.corrupt) return { ok: false, reason: 'wrapper-corrupt' };
    // Wrapper version MUST be the current schema. An older-version
    // wrapper (even one whose inner records happen to look canonical
    // schema-14) is not authoritative for the schema-14 fast path.
    if (parsed.version !== 14) return { ok: false, reason: 'wrapper-version-invalid', version: parsed.version };
    // Revision MUST satisfy Store's own validity predicate.
    const isValidRev = (typeof window.Store.isValidRevision === 'function')
      ? window.Store.isValidRevision
      : (n) => (typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= 0);
    if (!isValidRev(parsed.revision)) return { ok: false, reason: 'wrapper-revision-invalid', revision: parsed.revision };
    // Revision MUST NOT be stale relative to Store's accepted disk revision.
    // A regressed wrapper (e.g. someone rewrote the wrapper with an older
    // revision) is a Store-durability concern; the migration fast path must
    // not silently bless it.
    if (typeof window.Store.currentKnownRevision === 'function') {
      const known = window.Store.currentKnownRevision();
      if (typeof known === 'number' && Number.isInteger(known) && parsed.revision < known) {
        return { ok: false, reason: 'wrapper-revision-stale', revision: parsed.revision, known };
      }
    }
    if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
      return { ok: false, reason: 'data-shape-invalid' };
    }
    return { ok: true, wrapper: parsed, data: parsed.data, version: parsed.version, revision: parsed.revision };
  }
  // Fallback (Store not yet loaded / test harness) — apply the same
  // authority checks locally. Keeps hydration safe even under partial
  // page loads.
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return { ok: false, reason: 'parse-error' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'shape-invalid' };
  if (parsed.version !== 14) return { ok: false, reason: 'wrapper-version-invalid', version: parsed.version };
  const rev = parsed.revision;
  if (!(typeof rev === 'number' && Number.isFinite(rev) && Number.isInteger(rev) && rev >= 0 && rev <= Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: 'wrapper-revision-invalid', revision: rev };
  }
  if (!parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) return { ok: false, reason: 'data-shape-invalid' };
  return { ok: true, wrapper: parsed, data: parsed.data, version: parsed.version, revision: parsed.revision };
}

// PRV-0.5 R3 (P1-2): schema-14 canonical migrated-shape validator.
// A persisted wrapper is considered a valid current-schema migrated
// state ONLY when all four required record domains are present as
// arrays AND the marker exists AND status has a recognized value.
// Any deviation is malformed — hydration MUST NOT trust it, and
// processImport MUST NOT overwrite good state with it.
function isSchema14CanonicalMigratedShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const r = data.records;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  for (const d of ['deadlines', 'claims', 'risks', 'goals']) {
    if (!Array.isArray(r[d])) return false;
  }
  const m = data.meta && data.meta.recordsMigration;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (m.status !== MIGRATION_MIGRATED && m.status !== MIGRATION_UNMIGRATED) return false;
  return true;
}
// PRV-0.5 R4 (Codex Round-3 P1-B): the DESTRUCTIVE-boundary
// canonical-shape predicate. Applies the same rules to both migrated
// and unmigrated schema-14 candidates: marker MUST exist with a
// recognized status AND records MUST be an object with all four
// domain arrays. Codex R3 showed that gating only on
// `status === 'migrated'` let malformed backups (missing marker,
// bogus status, missing records) bypass the guard and overwrite good
// current state; hydration then seeded from LEGACY_RECORDS,
// inventing intent. Every schema-14 candidate — migrated or
// unmigrated — must carry the canonical shape or be rejected before
// it can replace live state.
function isSchema14CanonicalDestructiveShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const m = data.meta && data.meta.recordsMigration;
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
  if (m.status !== MIGRATION_MIGRATED && m.status !== MIGRATION_UNMIGRATED) return false;
  const r = data.records;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  for (const d of ['deadlines', 'claims', 'risks', 'goals']) {
    if (!Array.isArray(r[d])) return false;
  }
  return true;
}
window._isSchema14CanonicalMigratedShape = isSchema14CanonicalMigratedShape;
window._isSchema14CanonicalDestructiveShape = isSchema14CanonicalDestructiveShape;
window._readPersistedRecordsWrapper = _readPersistedWrapper;

function _buildHydratedRecords(seed, goalsOv, claimsOv) {
  return {
    deadlines: Array.isArray(seed.deadlines) ? seed.deadlines.map(o => Object.assign({}, o)) : [],
    claims: Array.isArray(seed.claims) ? seed.claims.map(c => {
      const o = (c && c.id && claimsOv[c.id]) || {};
      return Object.assign({}, c, {
        confidence: o.confidence || c.confidence,
        lastChecked: o.lastChecked || c.lastChecked
      });
    }) : [],
    risks: Array.isArray(seed.risks) ? seed.risks.map(r => Object.assign({}, r, {
      score: (Number(r && r.prob) || 0) * (Number(r && r.impact) || 0)
    })) : [],
    goals: Array.isArray(seed.goals) ? seed.goals.map(g => {
      const o = (g && g.id && goalsOv[g.id]) || {};
      const pct = (typeof o.progress === 'number') ? o.progress : g.progress;
      const status = o.status || g.status;
      return Object.assign({}, g, { progress: pct, status: status });
    }) : []
  };
}

let _hydrationInFlight = null;

async function hydratePreservationRecordsOnce() {
  if (_hydrationInFlight) return _hydrationInFlight;
  _hydrationInFlight = (async () => {
    try { return await _hydratePreservationRecordsOnceImpl(); }
    finally { _hydrationInFlight = null; }
  })();
  return _hydrationInFlight;
}

async function _hydratePreservationRecordsOnceImpl() {
  if (!window.Store || typeof window.Store.get !== 'function' || typeof window.Store.set !== 'function' || typeof window.Store.onSave !== 'function') {
    return { ok: false, reason: 'no-store' };
  }
  if (!window.LEGACY_RECORDS) return { ok: false, reason: 'no-seed' };

  // PRV-0.5 R3: serialize hydration across tabs via Web Locks so two
  // tabs booting the same v13 wrapper simultaneously cannot both
  // enqueue distinct-timestamp marker ops and leave the losing tab
  // conflict-blocked (Codex P1-3). Falls back to same-tab-only
  // dedupe (`_hydrationInFlight`) when navigator.locks is absent.
  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    return await navigator.locks.request(PRV05_MIGRATE_LOCK, { mode: 'exclusive' }, async () => {
      return await _hydrateUnderLock();
    });
  }
  return await _hydrateUnderLock();
}

async function _hydrateUnderLock() {
  const domains = ['deadlines', 'claims', 'risks', 'goals'];

  // PRV-0.5 R3 (P1-1): DISK-authoritative "already migrated?" check.
  // Optimistic in-memory Store.get() can carry a stale 'migrated'
  // marker after a durable-write failure, so we ignore it and read
  // the persisted wrapper directly. A wrapper that CLAIMS migrated
  // but fails schema-14 shape validation (P1-2) is treated as NOT
  // migrated — hydration proceeds to overwrite the partial state.
  const persistedNow = _readPersistedWrapper();
  if (persistedNow.ok) {
    const marker = persistedNow.data.meta && persistedNow.data.meta.recordsMigration;
    if (marker && marker.status === MIGRATION_MIGRATED && isSchema14CanonicalMigratedShape(persistedNow.data)) {
      // Persisted disk is authoritatively migrated + shape-valid.
      // If in-memory Store somehow has a divergent pending marker op
      // (e.g. from a prior optimistic write that never landed), drop
      // it by re-writing the persisted-authoritative marker so future
      // save flushes cannot leak a stale intent to disk.
      // Reconcile every path this migration owns to the disk-authoritative
      // values. Store.set is a noop when the in-memory value already
      // matches; when it differs (e.g. a stale optimistic marker or a
      // pending records op enqueued before storage-event rebase caught
      // up), the write drains the pending op via the optimistic-replay's
      // `opAppliesCleanlyToBase(cur, after)` idempotent-satisfied path.
      // This is the mechanism that clears the losing-tab conflict Codex
      // P1-3 called out: no `at` timestamp in the marker + matching
      // records content → op silently dropped → no orphaned pending op
      // blocks subsequent ordinary edits.
      try {
        for (const d of ['deadlines', 'claims', 'risks', 'goals']) {
          const diskDomain = persistedNow.data.records && persistedNow.data.records[d];
          if (Array.isArray(diskDomain)) window.Store.set('records.' + d, diskDomain);
        }
        window.Store.set('meta.recordsMigration', marker);
      } catch (e) { /* best-effort reconcile */ }
      return { ok: true, skipped: 'already-migrated', marker: marker };
    }
  } else if (persistedNow.reason === 'absent') {
    // Fresh cold-boot: no dune_state_v4 has ever been persisted. The
    // in-memory Store IS the truth here — it holds a freshly-minted
    // defaultState from core.js's initialLoad, and defaultState v14
    // is canonical migrated + empty records by design. Skip hydration
    // so fresh browsers do NOT get seeded from LEGACY_RECORDS.
    try {
      const inMemMarker = window.Store.get('meta.recordsMigration');
      const inMemData = {
        meta: { recordsMigration: inMemMarker },
        records: {
          deadlines: window.Store.get('records.deadlines'),
          claims: window.Store.get('records.claims'),
          risks: window.Store.get('records.risks'),
          goals: window.Store.get('records.goals')
        }
      };
      if (inMemMarker && inMemMarker.status === MIGRATION_MIGRATED
          && isSchema14CanonicalMigratedShape(inMemData)) {
        return { ok: true, skipped: 'default-state-migrated', marker: inMemMarker };
      }
    } catch (e) { /* fall through to normal migration path */ }
  }

  // Read any surviving legacy per-id override keys (pre-PRV browsers).
  let goalsOv = {};
  try { const v = localStorage.getItem('dune_goals_v1'); if (v) goalsOv = JSON.parse(v) || {}; } catch (e) {}
  let claimsOv = {};
  try { const v = localStorage.getItem('dune_claims_v1'); if (v) claimsOv = JSON.parse(v) || {}; } catch (e) {}

  const legacySeed = _buildHydratedRecords(window.LEGACY_RECORDS, goalsOv, claimsOv);

  // PRV-0.5 R4 (Codex Round-3 P1-C): distinguish "user's records intent
  // has already been established" from "user's records intent has not
  // yet been established" via the migration marker, and apply
  // different intent-preservation rules to each state class.
  //
  // MIGRATED-claimed state (persisted disk or Store in-memory says
  // status='migrated'): the user's records intent HAS been established.
  // A present valid empty `[]` domain is meaningful state (intentionally
  // empty) and MUST be preserved verbatim. An absent/malformed domain
  // MUST be canonicalised to `[]` (a lossless representation of the
  // migrated claim) — NEVER seeded from LEGACY_RECORDS, because doing
  // so would invent intent the user may have deliberately deleted.
  // (Codex R3 reproduced this by omitting only `records.goals` and
  // watching all four sibling domains repopulate from legacy.)
  //
  // UNMIGRATED / no-marker state (v13→v14 preservation transition,
  // absent wrapper, malformed marker with unknown status): the user's
  // records intent has NOT been established — this state class exists
  // precisely to trigger the LEGACY_RECORDS seeding. The empty arrays
  // present in Store's in-memory state came from migrateUp's bootstrap,
  // not from user intent, and must be OVERWRITTEN by the legacy seed.
  // A pre-existing non-empty array (from a partial prior migration
  // attempt) is preserved.
  const persistedMarker = persistedNow.ok
    ? (persistedNow.data.meta && persistedNow.data.meta.recordsMigration)
    : null;
  let inMemMarker = null;
  try { inMemMarker = window.Store.get('meta.recordsMigration'); } catch (e) { /* ignore */ }
  const markerClaimsMigrated = (
    (persistedMarker && persistedMarker.status === MIGRATION_MIGRATED)
    || (!persistedMarker && inMemMarker && inMemMarker.status === MIGRATION_MIGRATED)
  );

  const readForDomain = (d) => {
    if (persistedNow.ok && persistedNow.data.records && Array.isArray(persistedNow.data.records[d])) {
      return persistedNow.data.records[d];
    }
    const v = window.Store.get('records.' + d);
    return Array.isArray(v) ? v : null;
  };
  const merged = { deadlines: null, claims: null, risks: null, goals: null };
  for (const d of domains) {
    const cur = readForDomain(d);
    if (markerClaimsMigrated) {
      // Migrated intent already established. Preserve present arrays
      // verbatim — including `[]`. Canonicalise absent/malformed
      // domains to `[]`. NEVER seed from LEGACY_RECORDS in this state
      // class (Codex Round-3 P1-C invariant).
      merged[d] = Array.isArray(cur) ? cur : [];
    } else {
      // Unmigrated / absent-marker preservation flow. Empty arrays in
      // Store's in-memory state are migrateUp bootstrap, not user
      // intent — the legacy seed overwrites them. A pre-existing
      // non-empty array (from a partial prior migration attempt) is
      // authoritative user data and is preserved.
      merged[d] = (Array.isArray(cur) && cur.length > 0) ? cur : legacySeed[d];
    }
  }

  // Enqueue all writes. Store's debounced flush emits ONE coordinated
  // wrapper commit that includes every enqueued op.
  for (const d of domains) {
    const r = window.Store.set('records.' + d, merged[d]);
    if (!r || r.ok !== true) {
      try { console.warn('[PRV-0.5 R3 hydrate] set failed for ' + d, r); } catch (e) {}
      return { ok: false, reason: 'set-failed', domain: d, res: r };
    }
  }
  // PRV-0.5 R3 (P1-3): DETERMINISTIC marker content so simultaneous
  // tabs converge on the SAME value. A wall-clock `at` timestamp
  // would make each tab's marker CAS-non-idempotent — the losing tab
  // would retain a pending marker op that blocks future ordinary
  // Store edits. Two tabs that both complete the migration produce
  // the same {status, schemaVersion, reason} triple, so the second
  // Store.set returns `{ok:true, noop:true}` and no orphaned pending
  // op remains. (Wall-clock provenance for a completed migration
  // lives in the wrapper's own committedAt field.)
  const nextMarker = {
    status: MIGRATION_MIGRATED,
    schemaVersion: 14,
    reason: 'hydration-complete'
  };
  const mRes = window.Store.set('meta.recordsMigration', nextMarker);
  if (!mRes || mRes.ok !== true) {
    try { console.warn('[PRV-0.5 R3 hydrate] set failed for meta.recordsMigration', mRes); } catch (e) {}
    return { ok: false, reason: 'set-marker-failed', res: mRes };
  }

  // Await durable commit. Store fires onSave listeners only after the
  // wrapper write lands under the coordinator lock.
  await new Promise((resolve) => {
    let done = false;
    const unsub = window.Store.onSave(() => {
      if (done) return;
      done = true;
      try { unsub(); } catch (e) {}
      resolve();
    });
    // Safety timeout — if no save fires (paused / durability-blocked),
    // fall through to the verification step below, which will report
    // a durability failure and leave the marker unmigrated.
    setTimeout(() => {
      if (done) return;
      done = true;
      try { unsub(); } catch (e) {}
      resolve();
    }, 5000);
  });

  // Re-read the persisted wrapper from localStorage to prove durability.
  // Under a real primary-write failure (quota, etc.), the wrapper on
  // disk stays at the pre-hydration state; that failure surfaces here
  // and returns {ok:false} — the marker stays 'unmigrated' on disk
  // even though optimistic Store memory shows 'migrated'.
  const verified = _readPersistedWrapper();
  if (!verified.ok) {
    return { ok: false, reason: 'persisted-wrapper-missing', detail: verified.reason };
  }
  const pData = verified.data;
  const pMarker = pData.meta && pData.meta.recordsMigration;
  if (!pMarker || pMarker.status !== MIGRATION_MIGRATED || !isSchema14CanonicalMigratedShape(pData)) {
    return {
      ok: false,
      reason: 'durability-verification-failed',
      persisted: {
        wrapperVersion: verified.version,
        marker: pMarker || null,
        shapeValid: isSchema14CanonicalMigratedShape(pData)
      }
    };
  }
  return {
    ok: true,
    hydrated: true,
    persistedVersion: verified.version,
    committedAt: verified.wrapper && verified.wrapper.committedAt
  };
}
window.hydratePreservationRecordsOnce = hydratePreservationRecordsOnce;

// Boot invocation + import/reset-aware re-invocation.
// Register the onSave listener BEFORE the first invocation so we cannot
// miss a save that flips status to 'unmigrated' during import.
//
// Tests that inject Store.set / durability failures can suspend the
// auto-retry to prevent races with their own hydration invocations by
// setting `window.__prv05HydrationAutoRetryEnabled = false`. Production
// runs never touch this global; the default `undefined !== false` keeps
// the listener enabled.
if (window.Store && typeof window.Store.onSave === 'function') {
  window.Store.onSave((snap) => {
    try {
      if (window.__prv05HydrationAutoRetryEnabled === false) return;
      const m = snap && snap.meta && snap.meta.recordsMigration;
      if (m && m.status === MIGRATION_UNMIGRATED) {
        // Fire-and-forget; hydration is self-serializing via _hydrationInFlight.
        hydratePreservationRecordsOnce().catch(() => {});
      }
    } catch (e) { /* onSave listeners must not throw */ }
  });
  hydratePreservationRecordsOnce().catch((e) => {
    try { console.warn('[PRV-0.5 R2 hydrate] boot init exception', e); } catch (_) {}
  });
}

/* ═══════════════════════════════════════════
   LOGBOOK — Phase A canonical mirror (see docs/lifeos/ARCHITECTURE.md)
   Legacy Tracker (dune_logbook_v1) + Builder (dune_logbook_entries_v1)
   remain authoritative. This module reconciles both into the versioned
   state.logbook envelope introduced by core.js SCHEMA_VERSION 12. No
   automatic cross-source dedupe; readers stay on legacy until Phase B.
   Pure normalisers live in core.js Store.logbookHelpers so schema
   migration doesn't depend on app.js load order.
   ═══════════════════════════════════════════ */
(function(global){
  'use strict';
  const TRACKER_KEY='dune_logbook_v1';
  const BUILDER_KEY='dune_logbook_entries_v1';

  // Pull pure helpers from core.js. app.js LOGBOOK is the I/O wrapper.
  function helpers(){ return (global.Store && global.Store.logbookHelpers) || null; }

  function readLegacyTracker(){
    try{
      const raw=localStorage.getItem(TRACKER_KEY);
      if(raw===null) return null;
      const parsed=JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }catch(e){ return []; }
  }
  function readLegacyBuilder(){
    try{
      const raw=localStorage.getItem(BUILDER_KEY);
      if(raw===null) return null;
      const parsed=JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }catch(e){ return []; }
  }

  // Deterministic rebuild of the canonical mirror from the two live
  // legacy sources. Returns a new envelope; does NOT touch Store.
  //
  // Recovery semantics (state-only backups):
  //   Tracker key present  → Tracker legacy is authoritative
  //   Tracker key absent   → recover Tracker-tagged records from envelope
  //   Builder key present  → Builder legacy is authoritative
  //   Builder key absent   → recover Builder-tagged records from envelope
  //   'absent' = localStorage.getItem returned null; [] is authoritative-empty.
  function reconcileFrom(trackerArrOrNull, builderArrOrNull, existingEnvelope){
    const h = helpers();
    let trackerEntries = [];
    let builderEntries = [];
    let trackerCount = 0;
    let builderCount = 0;

    if (Array.isArray(trackerArrOrNull)) {
      trackerCount = trackerArrOrNull.length;
      for (let i = 0; i < trackerArrOrNull.length; i++) {
        const rec = h ? h.normalizeTrackerRecord(trackerArrOrNull[i], i) : null;
        if (rec) trackerEntries.push(rec);
      }
    } else if (trackerArrOrNull === null && existingEnvelope && Array.isArray(existingEnvelope.entries)) {
      const recovered = existingEnvelope.entries.filter(e => e && e.source === 'tracker');
      trackerEntries = recovered.map((e, i) => Object.assign({}, e, { sourceIndex: i }));
      trackerCount = trackerEntries.length;
    }
    if (Array.isArray(builderArrOrNull)) {
      builderCount = builderArrOrNull.length;
      for (let i = 0; i < builderArrOrNull.length; i++) {
        const rec = h ? h.normalizeBuilderRecord(builderArrOrNull[i], i) : null;
        if (rec) builderEntries.push(rec);
      }
    } else if (builderArrOrNull === null && existingEnvelope && Array.isArray(existingEnvelope.entries)) {
      const recovered = existingEnvelope.entries.filter(e => e && e.source === 'builder');
      builderEntries = recovered.map((e, i) => Object.assign({}, e, { sourceIndex: i }));
      builderCount = builderEntries.length;
    }

    const combined = trackerEntries.concat(builderEntries);
    if (h) h.assignCanonicalIds(combined);

    const envelope = (global.Store && global.Store.defaultLogbookEnvelope)
      ? global.Store.defaultLogbookEnvelope()
      : {
          schemaVersion: 1, authority: 'legacy-mirror', entries: [],
          migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } },
          drift: null
        };
    envelope.entries = combined;
    envelope.migration.sourceCounts = { tracker: trackerCount, builder: builderCount };
    // This function returns a reconciled envelope. Any caller that
    // persists it advertises Phase A reconciliation for subsequent
    // drift comparisons.
    envelope.reconciled = true;

    // Drift diagnostic — compare a deterministic content digest of the
    // reconciled entries against the previous canonical envelope's
    // digest. Only compare when the previous envelope was explicitly
    // marked reconciled by an earlier reconcile() cycle. The migrate-
    // only interim envelope is source-tagged but NOT reconciled, so
    // the first real reconciliation after schema migration cannot
    // produce false drift.
    if (h && existingEnvelope && existingEnvelope.reconciled === true
        && Array.isArray(existingEnvelope.entries)
        && existingEnvelope.entries.length > 0) {
      const previousDigest = h.contentDigest(existingEnvelope.entries);
      const reconciledDigest = h.contentDigest(combined);
      if (previousDigest !== reconciledDigest) {
        envelope.drift = {
          detected: true,
          previousCount: existingEnvelope.entries.length,
          reconciledCount: combined.length,
          reason: 'legacy_divergence',
          previousDigest,
          reconciledDigest
        };
      }
    }
    return envelope;
  }

  // Run reconciliation against current Store + live localStorage. One
  // Store.set → the existing debounce persists it normally. Never uses
  // pausePersistence/persistNow, per Phase A rules.
  function reconcile(){
    if(!global.Store || typeof global.Store.get!=='function' || typeof global.Store.set!=='function') return null;
    const existing=global.Store.get('logbook');
    const envelope=reconcileFrom(readLegacyTracker(), readLegacyBuilder(), existing);
    global.Store.set('logbook', envelope);
    return envelope;
  }

  const H = helpers();
  global.LOGBOOK={
    // Pure helpers re-exported from Store.logbookHelpers so tests and
    // callers can reach them via the app-layer surface too. These are
    // the same references core.js exposes; app.js does not duplicate.
    normalizeTrackerRecord: H ? H.normalizeTrackerRecord : null,
    normalizeBuilderRecord: H ? H.normalizeBuilderRecord : null,
    assignCanonicalIds:     H ? H.assignCanonicalIds     : null,
    parseHours:             H ? H.parseHours             : null,
    inferCreatedAtFromId:   H ? H.inferCreatedAtFromId   : null,
    possibleDuplicateKey:   H ? H.possibleDuplicateKey   : null,
    contentDigest:          H ? H.contentDigest          : null,
    stableHash:             H ? H.stableHash             : null,
    // I/O-bound.
    reconcile,
    reconcileFrom,
    readLegacyTracker,
    readLegacyBuilder,
    TRACKER_KEY,
    BUILDER_KEY
  };
})(window);

/* ═══════════════════════════════════════════
   B1 R7 — malformed-record coercion primitives (local, non-generic).
   ADR-011 R7: import-accepted persisted rows may be null, primitive,
   {}, array, or an object whose own `toString`/`valueOf` are shadowed
   with non-callable values. Bare `String(v)` and any arithmetic that
   triggers ToPrimitive throw on those. The helpers below give the
   B1 render/export/action surfaces a non-throwing coercion boundary
   without mutating stored data.
   ═══════════════════════════════════════════ */
function _b1SafeObject(v){ return (v && typeof v === 'object') ? v : null; }
function _b1SafeText(v){
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return String(v); }
  catch (e) { return ''; }
}
function _b1SafeNumber(v){
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  try {
    const s = _b1SafeText(v);
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  } catch (e) { return 0; }
}
function _b1SafeDateValue(v){
  // Returns a numeric epoch-ms suitable for sort/subtract, without
  // triggering ToPrimitive on a hostile object. Malformed → 0.
  try {
    const s = _b1SafeText(v);
    if (!s) return 0;
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  } catch (e) { return 0; }
}

/* ═══════════════════════════════════════════
   LIVE "LAST UPDATED" — reads the repo's latest commit
   ═══════════════════════════════════════════ */
(function(){
  const el=document.getElementById('hl-last-updated');
  if(!el) return;
  const CACHE_KEY='dune_last_commit_cache_v1';
  const CACHE_MS=10*60*1000; // 10 min — stays fresh without hammering GitHub's rate limit
  function fmt(iso){
    const d=new Date(iso);
    const datePart=d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
    const timePart=d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    return 'Last updated '+datePart+' · '+timePart;
  }
  function render(iso){ el.textContent=fmt(iso); }
  const cached=LS.get(CACHE_KEY,null);
  if(cached && cached.iso && (Date.now()-cached.fetchedAt)<CACHE_MS){
    render(cached.iso);
  }
  fetch('https://api.github.com/repos/Mahmoud1115/life-dashboard/commits?per_page=1')
    .then(r=>r.ok?r.json():Promise.reject(r.status))
    .then(commits=>{
      const iso=commits && commits[0] && commits[0].commit && commits[0].commit.author && commits[0].commit.author.date;
      if(!iso) return;
      LS.set(CACHE_KEY,{iso,fetchedAt:Date.now()});
      render(iso);
    })
    .catch(()=>{
      if(cached && cached.iso) render(cached.iso);
      else el.textContent='Dune Life OS';
    });
})();

/* ═══════════════════════════════════════════
   SCROLL PROGRESS BAR
   ═══════════════════════════════════════════ */
window.addEventListener('scroll',()=>{
  const el=document.getElementById('prog');
  if(!el)return;
  const pct=window.scrollY/(document.body.scrollHeight-window.innerHeight)*100;
  el.style.width=Math.min(100,pct)+'%';
});

/* ═══════════════════════════════════════════
   NAVIGATION — 9-GROUP STRUCTURE
   ═══════════════════════════════════════════ */
const NAV_GROUPS={
  home:      {primary:'home',           subs:[]},
  money:     {primary:'finance',        subs:[]},
  goals:     {primary:'progress',       subs:[]},
  career:    {primary:'career-tracker', subs:[{id:'easa',label:'EASA Modules'},{id:'logbook',label:'Logbook'}]},
  documents: {primary:'passport',       subs:[{id:'claims',label:'Claims'},{id:'deadlines',label:'Deadlines'}]},
  about:     {primary:'aboutyou',       subs:[{id:'timeline',label:'Life Timeline'}]},
  sync:      {primary:'sync',           subs:[]},
  review:    {primary:'review',         subs:[]},
};
const SEC_TO_GROUP={};
Object.entries(NAV_GROUPS).forEach(([k,g])=>{
  if(!SEC_TO_GROUP[g.primary]) SEC_TO_GROUP[g.primary]=k;
  g.subs.forEach(s=>{if(!SEC_TO_GROUP[s.id]) SEC_TO_GROUP[s.id]=k;});
});

function getSectionName(sid){
  const nsb=document.querySelector('.nsb[data-sec="'+sid+'"]');
  if(nsb) return nsb.textContent.trim();
  const gk=SEC_TO_GROUP[sid];
  if(gk&&NAV_GROUPS[gk]&&NAV_GROUPS[gk].primary===sid) return gk.charAt(0).toUpperCase()+gk.slice(1);
  return sid;
}
function renderSubNav(groupKey){
  const sub=document.getElementById('nav-sub');
  if(!sub) return;
  const g=NAV_GROUPS[groupKey];
  if(!g||!g.subs.length){sub.innerHTML='';return;}
  sub.innerHTML=g.subs.map(s=>'<button class="nsb" data-sec="'+s.id+'" onclick="show(\''+s.id+'\')">'+s.label+'</button>').join('');
}
function syncGroupNav(secId){
  const gk=SEC_TO_GROUP[secId];
  if(!gk) return;
  document.querySelectorAll('.nmb').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current');});
  const mb=document.querySelector('.nmb[data-group="'+gk+'"]');
  if(mb){mb.classList.add('active');mb.setAttribute('aria-current','page');}
  const sub=document.getElementById('nav-sub');
  if(sub&&sub.dataset.group!==gk){sub.dataset.group=gk;renderSubNav(gk);}
  document.querySelectorAll('.nsb').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current');});
  const sb=document.querySelector('.nsb[data-sec="'+secId+'"]');
  if(sb){sb.classList.add('active');sb.setAttribute('aria-current','page');}
}
function showGroup(groupKey){
  const g=NAV_GROUPS[groupKey];
  if(!g) return;
  const sub=document.getElementById('nav-sub');
  if(sub){sub.dataset.group=groupKey;renderSubNav(groupKey);}
  show(g.primary);
  LS.set('dune_activegroup',groupKey);
}
const _secScroll={};
function show(id,e){
  if(e && typeof e.preventDefault==='function') e.preventDefault();

  const prevY=window.scrollY;
  const cur=document.querySelector('.sec.active');
  if(cur) _secScroll[cur.id]=prevY;

  // Pin body (not .main) so the browser viewport engine sees a constant
  // document length throughout the section swap and never resets scrollY.
  document.body.style.minHeight=document.documentElement.scrollHeight+'px';

  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  let sec=document.getElementById(id);
  if(!sec){id='home';sec=document.getElementById('home');} // stale saved section from old plan
  if(sec) sec.classList.add('active');

  const pos=_secScroll[id]!==undefined?_secScroll[id]:prevY;
  window.scrollTo(0,pos);

  requestAnimationFrame(()=>{
    document.body.style.minHeight='';
    // If the new section is short and scroll snapped above the nav, clamp below it.
    const nav=document.querySelector('.nav');
    const navBottom=nav?nav.offsetTop+nav.offsetHeight:0;
    if(window.scrollY<navBottom && prevY>=navBottom){
      window.scrollTo(0,navBottom);
    }
  });

  LS.set('dune_activesec',id);
  syncGroupNav(id);
  document.querySelectorAll('.mob-nb').forEach(mb=>mb.classList.remove('active'));
  document.querySelectorAll('.mob-nb[data-sec="'+id+'"]').forEach(b=>b.classList.add('active'));
}

/* ═══════════════════════════════════════════
   PLAN HEALTH BAR
   ═══════════════════════════════════════════ */
(function(){
  function days(iso){return Math.ceil((new Date(iso)-new Date())/(864e5));}
  function pill(label,val,bg,col){
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:'+bg+';border-radius:100px;padding:3px 11px;white-space:nowrap">'
      +'<span style="font-family:var(--mono);font-size:9px;color:'+col+';opacity:.75">'+label+'</span>'
      +'<span style="font-family:var(--mono);font-size:9px;font-weight:600;color:'+col+'">'+val+'</span>'
      +'</span>';
  }
  function countdown(label,iso){
    const d=days(iso);
    if(d<0)return pill(label,'DONE','var(--green2)','var(--green)');
    if(d<=7)return pill(label,d+'d','var(--red2)','var(--red)');
    if(d<=60)return pill(label,d+'d','var(--amber2)','var(--amber)');
    return pill(label,d+'d','var(--bg3)','var(--tx2)');
  }
  function readSaveTarget(){
    try {
      const fin = JSON.parse(localStorage.getItem('dune_finance_v1') || '{}');
      const t = fin && fin.russia && parseFloat(fin.russia.save_target);
      return isFinite(t) && t > 0 ? t : 55000;
    } catch(e) { return 55000; }
  }
  function render(){
    const el=document.getElementById('phb');
    if(!el)return;
    const targetK = Math.round(readSaveTarget()/1000);
    el.innerHTML=[
      pill('Savings', targetK+'K/MO','var(--gold3)','var(--gold2)'),
      pill('Settlement','CLOSED','var(--bg3)','var(--tx3)'),
      countdown('MAI Deadline','2026-07-15'),
      countdown('M15 Target','2026-10-01'),
      countdown('ВНЖ Renewal','2027-03-01'),
      countdown('Passport Wall','2028-01-21'),
    ].join('');
  }
  render();
  setInterval(render,60000);
  // Re-render the pill immediately when finance inputs change so the
  // Savings number doesn't lag the user's edit by up to a minute.
  window.addEventListener('storage', (e) => { if (e.key === 'dune_finance_v1') render(); });
  // Same-tab finance changes (storage event only fires across tabs) — patch
  // the existing finInputChange so it triggers a phb re-render after saving.
  document.addEventListener('DOMContentLoaded', () => {
    const orig = window.finInputChange;
    if (orig && !orig._phbWired) {
      window.finInputChange = function(){ const r = orig.apply(this, arguments); render(); return r; };
      window.finInputChange._phbWired = true;
    }
  });
})();

/* ═══════════════════════════════════════════
   PRIVATE / PUBLIC MODE
   ═══════════════════════════════════════════ */
(function(){
  let isPublic=LS.get('dune_privacy',false);
  function maskNodes(){
    document.querySelectorAll('[data-private-val]').forEach(el=>{
      el.textContent=el.getAttribute('data-mask')||'••••••';
    });
  }
  function unmaskNodes(){
    document.querySelectorAll('[data-private-val]').forEach(el=>{
      el.textContent=el.getAttribute('data-private-val');
    });
  }
  function apply(){
    document.body.classList.toggle('public-mode',isPublic);
    document.body.classList.toggle('private-mode-active',isPublic);
    isPublic?maskNodes():unmaskNodes();
    const btn=document.getElementById('privacy-btn');
    const ind=document.getElementById('privacy-ind');
    if(btn){
      const emojiEl=btn.querySelector('.nmb-emoji');
      const labelEl=btn.querySelector('.nmb-label');
      if(emojiEl) emojiEl.textContent=isPublic?'🔒':'👁';
      if(labelEl) labelEl.textContent=isPublic?'Public':'Private';
      btn.classList.toggle('public-mode',isPublic);
    }
    if(ind) ind.classList.toggle('show',isPublic);
  }
  window.togglePrivacy=function(state){
    isPublic=(state!==undefined)?state:!isPublic;
    LS.set('dune_privacy',isPublic);
    apply();
  };
  document.addEventListener('DOMContentLoaded',apply);
})();

/* ═══════════════════════════════════════════
   GLOBAL SEARCH
   ═══════════════════════════════════════════ */
(function(){
  let idx=[];
  function buildIndex(){
    idx=[];
    document.querySelectorAll('.sec').forEach(sec=>{
      const sid=sec.id;
      const sname=getSectionName(sid);
      // collect all text nodes from cards and titles
      sec.querySelectorAll('.ctitle,.dec-title,.tl-title,.mc-title,.kif-title,.claim-title,.goal-title,.risk-mon-title,.dl-title,.crm-card-company').forEach(el=>{
        const txt=el.textContent.trim();
        if(txt) idx.push({id:sid,label:sname,text:txt,el});
      });
      sec.querySelectorAll('.card p,.tl-body,.mc-body,.rb,.dec-body,.kif-body').forEach(el=>{
        const txt=el.textContent.trim().slice(0,120);
        if(txt) idx.push({id:sid,label:sname,text:txt,el});
      });
    });
  }
  function search(q){
    if(!q||q.length<2) return [];
    const lq=q.toLowerCase();
    const seen=new Set();
    return idx.filter(item=>{
      if(item.text.toLowerCase().includes(lq) && !seen.has(item.text)){
        seen.add(item.text);
        return true;
      }
      return false;
    }).slice(0,12);
  }
  window.toggleSearch=function(){
    const bar=document.getElementById('search-wrap');
    if(!bar) return;
    bar.classList.toggle('open');
    if(bar.classList.contains('open')){
      buildIndex();
      document.getElementById('search-input').focus();
    } else {
      document.getElementById('search-input').value='';
      document.getElementById('search-results').innerHTML='';
    }
  };
  window.doSearch=function(e){
    const q=e && e.target ? String(e.target.value==null?'':e.target.value).trim() : '';
    const res=document.getElementById('search-results');
    if(!res)return;
    while(res.firstChild) res.removeChild(res.firstChild);
    if(!q||q.length<2) return;
    const results=search(q);
    if(!results.length){
      const empty=document.createElement('div');
      empty.className='sr-empty';
      empty.textContent='No results for "'+q+'"';
      res.appendChild(empty);
      return;
    }
    const frag=document.createDocumentFragment();
    results.forEach(function(r){
      if(!r||typeof r!=='object') return;
      const item=document.createElement('div');
      item.className='sr-item';
      item.dataset.sid=String(r.id==null?'':r.id);
      const section=document.createElement('div');
      section.className='sr-section';
      section.textContent=String(r.label==null?'':r.label);
      const text=document.createElement('div');
      text.className='sr-text';
      text.textContent=String(r.text==null?'':r.text);
      item.appendChild(section);
      item.appendChild(text);
      frag.appendChild(item);
    });
    res.appendChild(frag);
    if(res.dataset.b1Bound!=='1'){
      res.dataset.b1Bound='1';
      res.addEventListener('click',function(ev){
        const it=ev.target && ev.target.closest && ev.target.closest('.sr-item');
        if(!it||!res.contains(it)) return;
        const sid=it.dataset.sid;
        if(sid && typeof window.show==='function') window.show(sid);
        if(typeof window.toggleSearch==='function') window.toggleSearch();
      });
    }
  };
})();

/* ═══════════════════════════════════════════
   COLLAPSIBLE CARDS
   ═══════════════════════════════════════════ */
(function(){
  const state=LS.get('dune_cards',{});
  function initCards(){
    document.querySelectorAll('.card.collapsible').forEach(card=>{
      const id=card.dataset.cardId;
      if(!id)return;
      const isCollapsed=state[id]===true;
      if(isCollapsed) card.classList.add('collapsed');
      const ctitle=card.querySelector('.ctitle');
      if(ctitle){
        ctitle.addEventListener('click',()=>{
          card.classList.toggle('collapsed');
          state[id]=card.classList.contains('collapsed');
          LS.set('dune_cards',state);
        });
      }
    });
  }
  document.addEventListener('DOMContentLoaded',initCards);
})();

/* ═══════════════════════════════════════════
   MISSION CONTROL (SB-TASK BOARD — EXISTING)
   ═══════════════════════════════════════════ */
(function(){
  const STORE_KEY='dune_sb_v1';
  function save(id,state,note){
    const d=LS.get(STORE_KEY,{});
    d[id]={state,note:note||''};
    LS.set(STORE_KEY,d);
  }
  function load(){return LS.get(STORE_KEY,{});}
  function updateProgress(){
    const tasks=document.querySelectorAll('.sb-task');
    const done=document.querySelectorAll('.sb-task.state-done,.sb-task.state-noted').length;
    const total=tasks.length;
    const pct=total?Math.round(done/total*100):0;
    const counter=document.getElementById('sb-counter');
    const fill=document.getElementById('sb-fill');
    if(counter) counter.textContent=done+' / '+total+' done ('+pct+'%)';
    if(fill){
      fill.style.transform='scaleX('+(pct/100)+')';
      fill.style.background=pct===100?'var(--green)':pct>50?'var(--amber)':'var(--gold)';
    }
    // per-phase progress
    document.querySelectorAll('.sb-phase').forEach((ph,i)=>{
      const pTasks=ph.querySelectorAll('.sb-task');
      const pDone=ph.querySelectorAll('.sb-task.state-done,.sb-task.state-noted').length;
      const prog=document.getElementById('p'+i+'-prog');
      if(prog) prog.textContent=pDone+'/'+pTasks.length;
    });
  }
  window.cycleTask=function(e,el){
    if(e.target.classList.contains('sb-note')) return;
    const id=el.dataset.id;
    const cur=el.dataset.state||'';
    let next='';
    if(cur==='') next='done';
    else if(cur==='done') next='noted';
    else next='';
    el.dataset.state=next;
    el.className='sb-task'+(next?' state-'+next:'');
    el.querySelector('.sb-state').textContent=next?'✓':'';
    const note=el.querySelector('.sb-note');
    const saved=el.querySelector('.sb-note-saved');
    save(id,next,note?note.value:'');
    updateProgress();
  };
  window.saveNote=function(textarea){
    const task=textarea.closest('.sb-task');
    if(!task)return;
    const id=task.dataset.id;
    const savedEl=document.getElementById('saved-'+id);
    save(id,task.dataset.state||'',textarea.value);
    if(savedEl){savedEl.style.display='block';setTimeout(()=>savedEl.style.display='none',1500);}
  };
  window.resetBoard=function(){
    if(!confirm('Reset all tasks to not done? Notes will be cleared.'))return;
    LS.set(STORE_KEY,{});
    document.querySelectorAll('.sb-task').forEach(el=>{
      el.dataset.state='';
      el.className='sb-task';
      el.querySelector('.sb-state').textContent='';
      const note=el.querySelector('.sb-note');
      if(note) note.value='';
    });
    updateProgress();
  };
  window.openReport=function(){
    const modal=document.getElementById('sb-modal');
    if(!modal) return;
    let txt='DUNE PLAN STATUS REPORT\n';
    txt+='Generated: '+new Date().toLocaleDateString('en-GB')+'\n\n';
    document.querySelectorAll('.sb-phase').forEach(ph=>{
      const pTitle=ph.querySelector('.sb-phase-title');
      if(pTitle) txt+='── '+pTitle.textContent.trim().split('\n')[0]+' ──\n';
      ph.querySelectorAll('.sb-task').forEach(t=>{
        const state=t.dataset.state||'pending';
        const title=t.querySelector('.sb-title').textContent.replace(/\s+/g,' ').trim();
        const note=t.querySelector('.sb-note');
        const noteVal=note&&note.value.trim();
        txt+=(state==='done'||state==='noted'?'✓':'○')+' '+title+'\n';
        if(noteVal) txt+='  → '+noteVal+'\n';
      });
      txt+='\n';
    });
    document.getElementById('sb-report-text').textContent=txt;
    modal.classList.add('open');
  };
  window.closeReport=function(){
    const modal=document.getElementById('sb-modal');
    if(modal) modal.classList.remove('open');
  };
  window.copyReport=function(){
    const txt=document.getElementById('sb-report-text').textContent;
    navigator.clipboard.writeText(txt).then(()=>{
      const btn=document.querySelector('.sb-modal-copy');
      if(btn){btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy to clipboard',1500);}
    });
  };
  // restore on load
  document.addEventListener('DOMContentLoaded',()=>{
    const saved=load();
    document.querySelectorAll('.sb-task').forEach(el=>{
      const id=el.dataset.id;
      const d=saved[id];
      if(d&&d.state){
        el.dataset.state=d.state;
        el.className='sb-task state-'+d.state;
        el.querySelector('.sb-state').textContent='✓';
        const note=el.querySelector('.sb-note');
        if(note&&d.note) note.value=d.note;
      }
    });
    updateProgress();
  });
})();

/* ═══════════════════════════════════════════
   PHASE 3 — SECTION LABELS & GROUP PILLS
   ═══════════════════════════════════════════ */
const SEC_LABELS={
  home:'📅 Today',
  progress:'🎯 All Goals',
  'career-tracker':'✈️ Career Tracker',
  easa:'✈️ EASA Modules',
  logbook:'✈️ Logbook',
  passport:'🛂 Documents',
  claims:'🛂 Claims Register',
  deadlines:'🛂 Deadlines',
  finance:'💰 Money',
  aboutyou:'🧭 About You',
  sync:'☁ Backup & Sync',
  timeline:'🧭 Life Timeline',
  review:'📓 Weekly Review & Decisions',
};

const GROUP_PILLS={
  'career-tracker':[{id:'easa',label:'EASA Modules'},{id:'logbook',label:'Logbook'}],
  passport:[{id:'claims',label:'Claims'},{id:'deadlines',label:'Deadlines'}],
  // aboutyou intentionally omitted — the top sub-nav already exposes Life Timeline,
  // and duplicating the pill inside the dark reading-mode band looks orphaned.
};

function updateSectionLabels(){
  Object.entries(SEC_LABELS).forEach(([id,label])=>{
    const sec=document.getElementById(id);
    if(!sec) return;
    const el=sec.querySelector('.sec-num');
    if(el) el.textContent=label;
  });
}

function addGroupPills(){
  Object.entries(GROUP_PILLS).forEach(([secId,subs])=>{
    const sec=document.getElementById(secId);
    if(!sec||sec.querySelector('.group-pills')) return;
    const hd=sec.querySelector('.sec-hd');
    if(!hd) return;
    const el=document.createElement('div');
    el.className='group-pills';
    el.innerHTML=subs.map(s=>'<button class="group-pill" onclick="show(\''+s.id+'\')">'+s.label+'</button>').join('');
    hd.insertAdjacentElement('afterend',el);
  });
}

function addBreadcrumbs(){
  // for every section that is a sub-section (not a primary), inject a breadcrumb
  const primaries=new Set(Object.values(NAV_GROUPS).map(g=>g.primary));
  primaries.add('home'); // home is always its own primary
  document.querySelectorAll('.sec').forEach(sec=>{
    const id=sec.id;
    if(primaries.has(id)||id==='home') return;
    if(sec.querySelector('.sec-breadcrumb')) return; // already added
    const gk=SEC_TO_GROUP[id];
    if(!gk) return;
    const g=NAV_GROUPS[gk];
    if(!g) return;
    const hd=sec.querySelector('.sec-hd');
    if(!hd) return;
    const bc=document.createElement('button');
    bc.className='sec-breadcrumb';
    bc.textContent=g.primary.charAt(0).toUpperCase()+g.primary.slice(1);
    // use emoji from nav button
    const nmb=document.querySelector('.nmb[data-group="'+gk+'"]');
    const emoji=nmb?nmb.querySelector('.nmb-emoji').textContent:'';
    const label=nmb?nmb.querySelector('.nmb-label').textContent:'';
    bc.textContent=emoji+' '+label;
    bc.onclick=()=>showGroup(gk);
    sec.insertBefore(bc,sec.firstChild);
  });
}

/* ═══════════════════════════════════════════
   HOME — CALENDAR
   ═══════════════════════════════════════════ */
let calYear=new Date().getFullYear();
let calMonth=new Date().getMonth();

// ── UNIFIED CALENDAR EVENTS ──────────────────────────────
// Merges static deadlines (D.deadlines) with live Store events
// (license targets, career milestones) so the
// calendar and upcoming list are one integrated source of truth.
function allCalendarEvents(){
  const events=D.deadlines.map(d=>({date:d.date,title:d.title,cat:d.cat,importance:d.importance,private:d.private}));
  try{
    if(window.Store){
      const s=Store.raw();
      // License / milestone targets
      (s.career.licenses||[]).forEach(l=>{
        if(l.target && l.status!=='done'){
          events.push({date:l.target,title:'🎓 '+l.name,cat:'career',importance:'high'});
        }
      });
      // Career milestones
      (s.career.milestones||[]).forEach(m=>{
        if(m.at) events.push({date:m.at,title:'✈️ '+m.text,cat:'career',importance:'normal'});
      });
    }
  }catch(e){console.warn('allCalendarEvents:',e);}
  return events;
}

function renderCalendar(){
  const gridEl=document.getElementById('cal-grid');
  const labelEl=document.getElementById('cal-month-label');
  if(!gridEl) return;
  const now=new Date();
  const firstDayRaw=new Date(calYear,calMonth,1).getDay(); // 0=Sun
  const startOffset=(firstDayRaw+6)%7; // Mon-first offset
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const monthName=new Date(calYear,calMonth,1).toLocaleDateString('en-GB',{month:'long'});
  if(labelEl) labelEl.textContent=monthName+' '+calYear;
  // build event map
  const ev={};
  allCalendarEvents().forEach(d=>{
    const dt=new Date(d.date);
    if(dt.getFullYear()===calYear&&dt.getMonth()===calMonth){
      const day=dt.getDate();
      if(!ev[day]) ev[day]=[];
      ev[day].push(d);
    }
  });
  let html='';
  for(let i=0;i<startOffset;i++) html+='<div class="cal-day"></div>';
  for(let day=1;day<=daysInMonth;day++){
    const isToday=now.getFullYear()===calYear&&now.getMonth()===calMonth&&now.getDate()===day;
    const events=ev[day]||[];
    const hasCrit=events.some(e=>e.importance==='critical');
    const hasHigh=events.some(e=>e.importance==='high');
    const tip=events.map(e=>e.title).join('\n');
    const dotCls='cal-dot'+(hasCrit?' critical':hasHigh?' high':'');
    html+='<div class="cal-day'+(isToday?' today':'')+(events.length?' has-event':'')+'"'+(tip?' title="'+tip+'"':'')+'>'+
      '<div class="cal-day-num">'+day+'</div>'+
      (events.length?'<div class="'+dotCls+'"></div>':'')+
    '</div>';
  }
  gridEl.innerHTML=html;
}

function calNav(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
}

function renderUpcoming(){
  const el=document.getElementById('home-upcoming-list');
  if(!el) return;
  const now=new Date();
  const items=allCalendarEvents()
    .map(d=>({...d,daysLeft:Math.ceil((new Date(d.date)-now)/864e5)}))
    .filter(d=>d.daysLeft>=-1) // include today
    .sort((a,b)=>a.daysLeft-b.daysLeft)
    .slice(0,9);
  el.innerHTML=items.map(d=>{
    const cls=d.daysLeft<=0?'done':d.daysLeft<=7?'urgent':d.daysLeft<=30?'soon':'ok';
    const dayTxt=d.daysLeft<=0?'done':d.daysLeft+'d';
    const dateStr=new Date(d.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const priv=d.private?' data-private="true"':'';
    return '<div class="home-up-item"'+priv+'>'+
      '<div class="home-up-days '+cls+'">'+dayTxt+'</div>'+
      '<div>'+
        '<div class="home-up-title">'+d.title+'</div>'+
        '<div class="home-up-meta">'+dateStr+' · '+d.cat+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

/* ═══════════════════════════════════════════
   HOME — METRIC CARDS
   ═══════════════════════════════════════════ */
function renderMetricCards(){
  const el=document.getElementById('home-metrics');
  if(!el) return;
  const now=new Date();
  function daysTo(iso){return Math.ceil((new Date(iso)-now)/864e5);}

  // EASA
  const easaSt=LS.get('dune_easa_v1',{});
  const easaDone=D.easa.filter(m=>{const s=easaSt[m.id]||{};return (s.status||m.status)==='done';}).length;

  // Logbook — R7-safe: filter to real object rows so a malformed
  // imported member (null / primitive / hostile toString) cannot
  // throw parseFloat during aggregation and blank the Home page.
  const lbRaw=LS.get('dune_logbook_v1',[]);
  const lb=Array.isArray(lbRaw)?lbRaw.filter(function(e){return _b1SafeObject(e)!==null;}):[];
  const lbHours=lb.reduce(function(a,e){return a+_b1SafeNumber(e.hours);},0);

  // Finance monthly savings
  const fin=LS.get('dune_finance_v1',D.finance);
  const r=fin.russia||D.finance.russia;
  const mSav=(parseFloat(r.salary)||0)-(parseFloat(r.rent)||0)-(parseFloat(r.food)||0)-(parseFloat(r.transport)||0)-(parseFloat(r.utilities)||0)-(parseFloat(r.phone)||0)-(parseFloat(r.family_transfer)||0)-(parseFloat(r.other)||0)-(parseFloat(r.mai)||0);
  const mSavUSD=Math.round(mSav/(parseFloat(r.usd_rate)||88));
  const target=parseFloat(r.save_target)||55000;
  const targetPct=Math.max(0,Math.round(mSav/target*100));

  function card(emoji,label,value,sub,color,priv){
    return '<div class="metric-card"'+(priv?' data-private="true"':'')+'>'+
      '<div class="metric-emoji">'+emoji+'</div>'+
      '<div class="metric-value" style="color:'+color+'">'+value+'</div>'+
      '<div class="metric-label">'+label+'</div>'+
      '<div class="metric-sub">'+sub+'</div>'+
    '</div>';
  }

  const dPass=daysTo('2028-01-21');
  const dMAI=daysTo('2026-07-15');
  const dM15=daysTo('2026-10-01');

  el.innerHTML=[
    card('💼','АэроТраст',
      'Active',
      'CFM56-5B overhaul · 130k ₽ net',
      'var(--green)',true),
    card('💰','Savings vs 55k',
      mSav>0?'₽'+Math.round(mSav/1000)+'k':'₽—',
      mSav>0?targetPct+'% of target · ≈ $'+mSavUSD+'/mo':'Set numbers in Finance tab',
      mSav>=target?'var(--green)':mSav>=target*0.7?'var(--amber)':mSav>0?'var(--red)':'var(--tx3)',true),
    card('📚','EASA B1.1',
      easaDone+'/15',
      easaDone===0?'M15 in progress · exam-ready Oct':easaDone+' done · '+(15-easaDone)+' remaining',
      easaDone>=10?'var(--green)':easaDone>=5?'var(--amber)':'var(--tx3)',false),
    card('⏱','M15 Target',
      dM15<0?'✓':dM15+'d',
      dM15<0?'Done':'Oct 1 · Gas Turbines exam-ready',
      dM15<0?'var(--green)':dM15<=14?'var(--red)':dM15<=45?'var(--amber)':'var(--tx2)',false),
    card('✈️','Logbook',
      lb.length===0?'0h':parseFloat(lbHours.toFixed(1))+'h',
      lb.length===0?'No entries · start day one':lb.length+' entries logged',
      lbHours>500?'var(--green)':lbHours>0?'var(--amber)':'var(--tx3)',false),
    card('🎓','MAI Deadline',
      dMAI<0?'✓':dMAI+'d',
      dMAI<0?'Done':'July 15 · enrollment application',
      dMAI<0?'var(--green)':dMAI<=14?'var(--red)':dMAI<=30?'var(--amber)':'var(--tx2)',false),
    card('🛂','Passport Wall',
      dPass+'d',
      'Jan 21, 2028 · renew before age 28',
      dPass<=90?'var(--red)':dPass<=365?'var(--amber)':'var(--tx2)',false),
  ].join('');
}

/* ═══════════════════════════════════════════
   HOME — MISSION CONTROL WIDGETS
   ═══════════════════════════════════════════ */
function renderHome(){
  // Phase widget
  const now=new Date();
  const foundationEnd=new Date('2026-09-01');
  let phase,phaseSub;
  if(now<foundationEnd){phase='Foundation';phaseSub='АэроТраст start · 55k system live · logbook day one · MAI application';}
  else{phase='Build Mode';phaseSub='CFM56 mastery · EASA modules · certificates · 55k every month';}
  const phEl=document.getElementById('home-phase-name');
  const phSub=document.getElementById('home-phase-sub');
  if(phEl) phEl.textContent=phase;
  if(phSub) phSub.textContent=phaseSub;

  // Next critical deadline
  const upcoming=D.deadlines
    .filter(d=>d.importance==='critical')
    .map(d=>({...d,days:Math.ceil((new Date(d.date)-now)/(864e5))}))
    .filter(d=>d.days>=0)
    .sort((a,b)=>a.days-b.days)[0];
  const ndCount=document.getElementById('home-nd-count');
  const ndTitle=document.getElementById('home-nd-title');
  if(upcoming&&ndCount){
    ndCount.textContent=upcoming.days+'d';
    ndCount.style.color=upcoming.days<=7?'var(--red)':upcoming.days<=30?'var(--amber)':'var(--gold2)';
    if(ndTitle) ndTitle.textContent=upcoming.title;
  }

  // Metric cards are now owned by the reactive wireToday() (Phase 1).
  // This function only handles the non-reactive calendar + upcoming list.
  try{renderCalendar();}catch(e){console.warn('renderCalendar:',e);}
  try{renderUpcoming();}catch(e){console.warn('renderUpcoming:',e);}
}
document.addEventListener('DOMContentLoaded',renderHome);
// Re-render calendar + upcoming whenever Store changes (licenses…)
if(window.Store){
  Store.subscribe('career',()=>{try{renderCalendar();renderUpcoming();}catch(e){}});
}

/* ═══════════════════════════════════════════
   PROGRESS TRACKER
   ═══════════════════════════════════════════ */
(function(){
  // PRV-0.5: goals identity + per-user state now live under Store path
  // `records.goals` (ADR-015). The legacy per-id override key
  // `dune_goals_v1` is no longer written — hydration merged any prior
  // overrides into records.goals exactly once, then the flag is set.
  let curFilter='all';
  function saveGoal(id,pct,status){
    if(!window.Store || typeof window.Store.get!=='function' || typeof window.Store.set!=='function') return;
    const cur = window.Store.get('records.goals');
    if(!Array.isArray(cur)) return;
    let mutated = false;
    const next = cur.map(g => {
      if(!g || g.id !== id) return g;
      mutated = true;
      const patch = {};
      if(pct !== undefined) patch.progress = pct;
      if(status !== undefined) patch.status = status;
      return Object.assign({}, g, patch);
    });
    if(!mutated) return;
    window.Store.set('records.goals', next);
  }
  function statusLabel(s){
    return {active:'Active',planned:'Planned',done:'Done',blocked:'Blocked'}[s]||s;
  }
  // Live reactive goals computed from the Store — always show at top.
  function liveGoalsHTML(){
    if(!window.Store) return '';
    const s=Store.raw(), d=Store.derive;
    const cards=[
      {title:'55k Monthly Savings',pct:Math.min(100,d.saveTargetHitPct(s)),
        sub:d.monthlySurplus(s).toLocaleString()+' ₽ surplus / '+ (s.money.save_target).toLocaleString()+' ₽ target',
        link:'finance'},
      {title:'EASA Part-66 B1.1',pct:d.easaProgress(s).pct,
        sub:d.easaProgress(s).done+' of 15 modules done',link:'easa'}
    ];
    return '<div class="live-goals-banner">⚡ Live goals — computed automatically from your Money &amp; EASA data</div>'+
      cards.map(c=>'<div class="goal-card goal-card-live" onclick="show(\''+c.link+'\')" style="cursor:pointer">'+
        '<div class="goal-status-dot gs-active"></div>'+
        '<div class="goal-main">'+
          '<div class="goal-title">'+c.title+' <span class="live-tag">LIVE</span></div>'+
          '<div class="goal-progress-wrap">'+
            '<div class="goal-pbar"><div class="goal-pfill" style="transform:scaleX('+(Math.min(100,c.pct)/100)+')"></div></div>'+
            '<span class="goal-pct-static">'+c.pct+'%</span>'+
          '</div>'+
          '<div class="goal-note">'+c.sub+'</div>'+
        '</div>'+
      '</div>').join('');
  }
  function renderGoals(filter){
    curFilter=filter||curFilter;
    const container=document.getElementById('goals-list');
    if(!container) return;
    // PRV-0.5: goals authority is Store `records.goals`; D.goals is a
    // read-only accessor that proxies to Store. No per-id override
    // merge (removed with dune_goals_v1 writer).
    const filtered=D.goals.filter(g=>curFilter==='all'||g.cat===curFilter);
    const liveBlock=(curFilter==='all'||curFilter==='finance')?liveGoalsHTML():'';
    container.innerHTML=liveBlock+filtered.map(g=>{
      const pct=g.progress;
      const status=g.status;
      const dotClass={active:'gs-active',planned:'gs-planned',done:'gs-done',blocked:'gs-blocked'}[status]||'gs-planned';
      const deadlineStr=g.deadline?'Due: '+g.deadline:'No fixed deadline';
      const catClass='gt-'+g.cat;
      const isPrivate=g.private?' data-private="true"':'';
      return '<div class="goal-card"'+isPrivate+'>'+
        '<div class="goal-status-dot '+dotClass+'"></div>'+
        '<div class="goal-main">'+
          '<div class="goal-title">'+g.title+'</div>'+
          '<div class="goal-progress-wrap">'+
            '<div class="goal-pbar"><div class="goal-pfill" style="transform:scaleX('+(pct/100)+')"></div></div>'+
            '<input class="goal-pct-input" type="number" min="0" max="100" value="'+pct+'" title="Edit progress %" onchange="updateGoalProgress(\''+g.id+'\',this.value)" />'+
          '</div>'+
          '<div class="goal-meta">'+
            '<span class="goal-tag '+catClass+'">'+g.cat+'</span>'+
            '<span class="goal-deadline">'+deadlineStr+'</span>'+
            '<select class="goal-pct-input" style="width:90px" onchange="updateGoalStatus(\''+g.id+'\',this.value)">'+
              ['active','planned','done','blocked'].map(s=>'<option value="'+s+'"'+(status===s?' selected':'')+'>'+statusLabel(s)+'</option>').join('')+
            '</select>'+
          '</div>'+
          (g.nextAction?'<div class="goal-next">→ '+g.nextAction+'</div>':'')+
          (g.note?'<div class="goal-note">'+g.note+'</div>':'')+
        '</div>'+
      '</div>';
    }).join('');
  }
  window.updateGoalProgress=function(id,val){
    const pct=Math.min(100,Math.max(0,parseInt(val)||0));
    saveGoal(id,pct,undefined);
    renderGoals();
    renderHome();
  };
  window.updateGoalStatus=function(id,val){
    saveGoal(id,undefined,val);
    renderGoals();
  };
  window.filterGoals=function(cat,btn){
    document.querySelectorAll('.pt-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderGoals(cat);
  };
  document.addEventListener('DOMContentLoaded',()=>renderGoals());
  // Live goals recompute when Money / EASA change in the Store
  if(window.Store){
    ['money','easa'].forEach(k=>Store.subscribe(k,()=>{try{renderGoals();}catch(e){}}));
  }
})();

/* ═══════════════════════════════════════════
   EASA MODULE TRACKER
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_easa_v1';
  function getStored(){return LS.get(STORE,{});}
  function renderEasa(){
    const stored=getStored();
    const container=document.getElementById('easa-grid');
    if(!container) return;
    const notDone=D.easa.filter(m=>m.status!=='done'||(stored[m.id]&&stored[m.id].status!=='done'));
    const done=D.easa.filter(m=>{ const s=stored[m.id]||{}; return (s.status||m.status)==='done'; });
    // stats
    const totalDone=D.easa.filter(m=>{ const s=stored[m.id]||{}; return (s.status||m.status)==='done'; }).length;
    const totalStudying=D.easa.filter(m=>{ const s=stored[m.id]||{}; return (s.status||m.status)==='studying'; }).length;
    const totalPct=Math.round(D.easa.reduce((a,m)=>{ const s=stored[m.id]||{}; return a+(s.progress!==undefined?s.progress:m.progress); },0)/D.easa.length);
    const statsEl=document.getElementById('easa-stats');
    if(statsEl) statsEl.innerHTML=
      '<div class="lb-stat"><div class="lb-stat-val">'+totalDone+'/15</div><div class="lb-stat-label">Modules Done</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+totalStudying+'</div><div class="lb-stat-label">Studying</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+totalPct+'%</div><div class="lb-stat-label">Avg Progress</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+(15-totalDone-totalStudying)+'</div><div class="lb-stat-label">Not Started</div></div>';
    container.innerHTML=D.easa.map(m=>{
      const s=stored[m.id]||{};
      const pct=s.progress!==undefined?s.progress:m.progress;
      const status=s.status||m.status;
      const priClass='ep-'+(m.priority||'medium');
      const stClass='ebs-'+status;
      const cardClass='es-'+status;
      return '<div class="easa-card '+cardClass+'">'+
        '<div class="easa-num">'+m.num+'</div>'+
        '<div class="easa-title">'+m.title+'</div>'+
        '<div class="easa-bar-wrap"><div class="easa-bar-fill" style="transform:scaleX('+(pct/100)+')"></div></div>'+
        '<div class="easa-meta">'+
          '<select class="easa-status-select" onchange="updateEasaStatus(\''+m.id+'\',this.value)">'+
            ['not_started','studying','done'].map(st=>'<option value="'+st+'"'+(status===st?' selected':'')+'>'+st.replace('_',' ')+'</option>').join('')+
          '</select>'+
          '<input class="easa-pct-input" type="number" min="0" max="100" value="'+pct+'" title="Progress %" onchange="updateEasaPct(\''+m.id+'\',this.value)" />'+
          '<span class="easa-priority '+priClass+'">'+m.priority+'</span>'+
        '</div>'+
        (m.note?'<div class="easa-note">'+m.note+'</div>':'')+
      '</div>';
    }).join('');
  }
  window.updateEasaPct=function(id,val){
    const d=getStored();
    if(!d[id])d[id]={};
    d[id].progress=Math.min(100,Math.max(0,parseInt(val)||0));
    LS.set('dune_easa_v1',d);
    renderEasa();
  };
  window.updateEasaStatus=function(id,val){
    const d=getStored();
    if(!d[id])d[id]={};
    d[id].status=val;
    if(val==='done') d[id].progress=100;
    LS.set('dune_easa_v1',d);
    renderEasa();
  };
  document.addEventListener('DOMContentLoaded',renderEasa);
})();

/* ═══════════════════════════════════════════
   LOGBOOK — ATA COVERAGE GRID
   ═══════════════════════════════════════════ */
function renderATACoverage(entries){
  const el=document.getElementById('lb-ata-coverage');
  if(!el) return;
  const chapters=[
    {n:'20',l:'Standard'},{n:'21',l:'Air Cond'},{n:'22',l:'AutoFlight'},
    {n:'23',l:'Comms'},{n:'24',l:'Electrical'},{n:'25',l:'Equipment'},
    {n:'26',l:'Fire Prot'},{n:'27',l:'Flt Controls'},{n:'28',l:'Fuel'},
    {n:'29',l:'Hydraulic'},{n:'30',l:'Ice & Rain'},{n:'31',l:'Indicating'},
    {n:'32',l:'Ldg Gear'},{n:'33',l:'Lights'},{n:'34',l:'Navigation'},
    {n:'35',l:'Oxygen'},{n:'36',l:'Pneumatic'},{n:'49',l:'APU'},
    {n:'51',l:'Structures'},{n:'71',l:'Power Plant'},{n:'72',l:'Engine'},
    {n:'73',l:'Eng Fuel'},{n:'74',l:'Ignition'},{n:'75',l:'Air'},
    {n:'76',l:'Eng Controls'},{n:'77',l:'Eng Ind.'},{n:'78',l:'Exhaust'},
    {n:'79',l:'Oil'},{n:'80',l:'Starting'},
  ];
  const counts={};
  const list=Array.isArray(entries)?entries:[];
  list.forEach(function(e){
    if(!_b1SafeObject(e)) return;
    const ch=_b1SafeText(e.ata_chapter).split('.')[0].trim();
    if(ch) counts[ch]=(counts[ch]||0)+1;
  });
  const covered=chapters.filter(c=>counts[c.n]>0).length;
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const isEngine=n=>parseInt(n)>=71&&parseInt(n)<=80;
  el.innerHTML=
    '<div class="ata-coverage-header">'+
      '<span class="ata-cov-title">ATA Chapter Coverage — B1.1</span>'+
      '<span class="ata-cov-stats">'+covered+'/'+chapters.length+' chapters · '+total+' entries</span>'+
    '</div>'+
    '<div class="ata-grid">'+
    chapters.map(c=>{
      const cnt=counts[c.n]||0;
      const cls='ata-cell'+(cnt>=3?' filled':cnt>=1?' partial':'')+(isEngine(c.n)?' ata-engine':'');
      return '<div class="'+cls+'" title="ATA '+c.n+' — '+c.l+(cnt?' ('+cnt+' entr'+( cnt===1?'y':'ies')+')':' — none yet')+'">'+
        '<div class="ata-num">'+c.n+'</div>'+
        '<div class="ata-lbl">'+c.l+'</div>'+
        (cnt?'<div class="ata-count">'+cnt+'×</div>':'')+
      '</div>';
    }).join('')+
    '</div>';
}

/* ═══════════════════════════════════════════
   AVIATION LOGBOOK TRACKER
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_logbook_v1';
  let showForm=false;
  let view='table';
  function getEntries(){return LS.get(STORE,[]);}
  function saveEntries(arr){LS.set(STORE,arr);}
  function renderStats(entries){
    const statsEl=document.getElementById('lb-stats');
    if(!statsEl) return;
    // R7: aggregate only safe object rows. Hostile toString/valueOf
    // must not throw through parseFloat / parseInt / Set membership.
    const list=Array.isArray(entries)?entries.filter(function(e){return _b1SafeObject(e)!==null;}):[];
    const totalHours=list.reduce(function(a,e){return a+_b1SafeNumber(e.hours);},0).toFixed(1);
    const acSet=new Set();
    list.forEach(function(e){
      const t=_b1SafeText(e.aircraft_type);
      if(t) acSet.add(t);
    });
    const types=acSet.size;
    const stamped=list.filter(function(e){return _b1SafeText(e.stamp_status)==='stamped';}).length;
    const ata71_80=list.filter(function(e){
      const c=_b1SafeNumber(e.ata_chapter);
      return c>=71&&c<=80;
    }).length;
    statsEl.innerHTML=
      '<div class="lb-stat"><div class="lb-stat-val">'+entries.length+'</div><div class="lb-stat-label">Total Entries</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+totalHours+'</div><div class="lb-stat-label">Total Hours</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+types+'</div><div class="lb-stat-label">Aircraft Types</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+stamped+'</div><div class="lb-stat-label">Stamped</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+ata71_80+'</div><div class="lb-stat-label">Engine Tasks (71-80)</div></div>';
  }
  function ensureTrackerDelegate(tbody){
    if(tbody.dataset.b1Bound==='1') return;
    tbody.dataset.b1Bound='1';
    tbody.addEventListener('click',function(ev){
      const btn=ev.target && ev.target.closest && ev.target.closest('.lb-row-del');
      if(!btn||!tbody.contains(btn)) return;
      const raw=btn.dataset.idx;
      if(typeof raw!=='string'||!/^\d+$/.test(raw)) return;
      const idx=parseInt(raw,10);
      const entries=getEntries();
      if(!Array.isArray(entries)) return;
      if(idx<0||idx>=entries.length) return;
      if(typeof window.deleteLogEntry==='function') window.deleteLogEntry(idx);
    });
  }
  function renderTable(entries){
    const tbody=document.getElementById('lb-tbody');
    if(!tbody) return;
    ensureTrackerDelegate(tbody);
    while(tbody.firstChild) tbody.removeChild(tbody.firstChild);
    if(!Array.isArray(entries)||!entries.length){
      const tr=document.createElement('tr');
      const td=document.createElement('td');
      td.colSpan=8;
      td.style.textAlign='center';
      td.style.padding='32px';
      td.style.color='var(--tx3)';
      td.style.fontFamily='var(--mono)';
      td.style.fontSize='11px';
      td.textContent='No entries yet. Add your first logbook entry.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    const frag=document.createDocumentFragment();
    const rev=entries.slice().reverse();
    rev.forEach(function(e,ri){
      const i=entries.length-1-ri;
      if(!e||typeof e!=='object') return;
      const tr=document.createElement('tr');
      function td(text,cls){
        const c=document.createElement('td');
        if(cls) c.className=cls;
        c.textContent=_b1SafeText(text);
        return c;
      }
      tr.appendChild(td(e.date));
      tr.appendChild(td(e.company));
      tr.appendChild(td(_b1SafeText(e.aircraft_type)+' '+_b1SafeText(e.registration)));
      const ataTd=document.createElement('td');
      const ataSp=document.createElement('span');
      ataSp.style.fontFamily='var(--mono)';
      ataSp.style.fontSize='10px';
      ataSp.textContent='ATA '+_b1SafeText(e.ata_chapter);
      ataTd.appendChild(ataSp);
      tr.appendChild(ataTd);
      const taskTd=document.createElement('td');
      taskTd.style.maxWidth='200px';
      const desc=_b1SafeText(e.task_description);
      taskTd.textContent=desc.length>60?desc.slice(0,60)+'…':desc;
      tr.appendChild(taskTd);
      const hoursTd=document.createElement('td');
      hoursTd.style.fontFamily='var(--mono)';
      hoursTd.textContent=_b1SafeText(e.hours)+'h';
      tr.appendChild(hoursTd);
      const stampTd=document.createElement('td');
      const stampSp=document.createElement('span');
      stampSp.style.fontFamily='var(--mono)';
      stampSp.style.fontSize='9px';
      stampSp.style.padding='2px 9px';
      stampSp.style.borderRadius='100px';
      const stampText=_b1SafeText(e.stamp_status);
      const isStamped=stampText==='stamped';
      stampSp.style.background=isStamped?'var(--green2)':'var(--amber2)';
      stampSp.style.color=isStamped?'var(--green)':'var(--amber)';
      stampSp.textContent=stampText;
      stampTd.appendChild(stampSp);
      tr.appendChild(stampTd);
      const actionsTd=document.createElement('td');
      const wrap=document.createElement('div');
      wrap.className='lb-row-actions';
      const del=document.createElement('button');
      del.type='button';
      del.className='lb-row-del';
      del.textContent='×';
      del.dataset.idx=String(i);
      wrap.appendChild(del);
      actionsTd.appendChild(wrap);
      tr.appendChild(actionsTd);
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);
  }
  function renderLogbook(){
    const entries=getEntries();
    renderStats(entries);
    renderTable(entries);
    renderATACoverage(entries);
    const form=document.getElementById('lb-form');
    if(form) form.style.display=showForm?'block':'none';
  }
  window.toggleLogForm=function(){
    showForm=!showForm;
    renderLogbook();
  };
  window.submitLogEntry=function(e){
    e.preventDefault();
    const f=e.target;
    const entry={
      id:'lb_'+Date.now(),
      date:f.lb_date.value,
      company:f.lb_company.value,
      aircraft_type:f.lb_aircraft.value,
      registration:f.lb_reg.value,
      engine_type:f.lb_engine.value,
      ata_chapter:f.lb_ata.value,
      system:f.lb_system.value,
      task_description:f.lb_task.value,
      hours:f.lb_hours.value,
      role:f.lb_role.value,
      supervisor:f.lb_supervisor.value,
      stamp_status:f.lb_stamp.value,
      language:f.lb_lang.value,
      b1_relevance:f.lb_b1.value,
    };
    const entries=getEntries();
    entries.push(entry);
    saveEntries(entries);
    if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
      try { window.LOGBOOK.reconcile(); } catch (e) { /* mirror is best-effort */ }
    }
    f.reset();
    f.lb_date.value=new Date().toISOString().split('T')[0];
    showForm=false;
    renderLogbook();
  };
  window.deleteLogEntry=function(idx){
    if(!confirm('Delete this entry?'))return;
    const entries=getEntries();
    entries.splice(idx,1);
    saveEntries(entries);
    if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
      try { window.LOGBOOK.reconcile(); } catch (e) { /* mirror is best-effort */ }
    }
    renderLogbook();
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const dateInput=document.getElementById('lb-date-input');
    if(dateInput) dateInput.value=new Date().toISOString().split('T')[0];
    renderLogbook();
  });
})();

/* ═══════════════════════════════════════════
   DEADLINE TRACKER
   ═══════════════════════════════════════════ */
(function(){
  let dlFilter='all';
  function daysBetween(iso){return Math.ceil((new Date(iso)-new Date())/(864e5));}
  function catBadge(cat){
    return '<span class="dl-cat-badge dcat-'+cat+'">'+cat+'</span>';
  }
  function renderDeadlines(filter){
    dlFilter=filter||dlFilter;
    const container=document.getElementById('deadlines-list');
    if(!container) return;
    let items=D.deadlines;
    const now=new Date();
    if(dlFilter==='7') items=items.filter(d=>{ const days=daysBetween(d.date); return days>=0&&days<=7; });
    else if(dlFilter==='30') items=items.filter(d=>{ const days=daysBetween(d.date); return days>=0&&days<=30; });
    else if(dlFilter==='180') items=items.filter(d=>{ const days=daysBetween(d.date); return days>=0&&days<=180; });
    else if(dlFilter==='legal') items=items.filter(d=>['passport','legal','immigration','licensing'].includes(d.cat));
    else if(dlFilter==='overdue') items=items.filter(d=>daysBetween(d.date)<0);
    container.innerHTML=items.map(d=>{
      const days=daysBetween(d.date);
      let numClass,numText;
      if(days<0){numClass='dc-green';numText='DONE';}
      else if(days<=7){numClass='dc-red';numText=days+'d';}
      else if(days<=60){numClass='dc-amber';numText=days+'d';}
      else{numClass='dc-gray';numText=days+'d';}
      const cardClass=d.importance==='critical'?'dl-critical':d.importance==='high'?'dl-high':'';
      const privAttr=d.private?' data-private="true"':'';
      const dateStr=new Date(d.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      return '<div class="dl-card '+cardClass+'"'+privAttr+'>'+
        '<div class="dl-count '+numClass+'">'+
          '<div class="dl-count-num">'+numText+'</div>'+
          '<div class="dl-count-unit">'+(days<0?'past':'away')+'</div>'+
        '</div>'+
        '<div class="dl-body">'+
          '<div class="dl-title">'+d.title+'</div>'+
          '<div class="dl-meta">'+
            '<span class="dl-date">'+dateStr+'</span>'+
            catBadge(d.cat)+
            '<span class="dl-cat-badge" style="background:var(--bg3);color:var(--tx3)">'+d.importance+'</span>'+
          '</div>'+
          (d.consequence?'<div class="dl-consequence">If missed: '+d.consequence+'</div>':'')+
          (d.note?'<div class="dl-note">'+d.note+'</div>':'')+
          '<button class="dl-ics" onclick="downloadICS(\''+d.id+'\')">+ Add to Calendar</button>'+
        '</div>'+
      '</div>';
    }).join('')||'<div class="lb-empty">No deadlines match this filter.</div>';
  }
  window.filterDeadlines=function(f,btn){
    document.querySelectorAll('.dl-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderDeadlines(f);
  };
  window.downloadICS=function(id){
    const d=D.deadlines.find(x=>x.id===id);
    if(!d) return;
    const dt=d.date.replace(/-/g,'');
    const uid=id+'@dune-life-os';
    const desc=(d.consequence?'If missed: '+d.consequence+'. ':'')+( d.note||'');
    const ics=[
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dune Life OS//EN',
      'BEGIN:VEVENT',
      'UID:'+uid,
      'DTSTART;VALUE=DATE:'+dt,
      'DTEND;VALUE=DATE:'+dt,
      'SUMMARY:'+d.title,
      'DESCRIPTION:'+desc.replace(/\n/g,'\\n'),
      'BEGIN:VALARM','TRIGGER:-P3D','ACTION:DISPLAY','DESCRIPTION:Reminder: '+d.title,'END:VALARM',
      'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY','DESCRIPTION:1 week: '+d.title,'END:VALARM',
      'END:VEVENT','END:VCALENDAR'
    ].join('\r\n');
    const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=id+'.ics';
    a.click();
    URL.revokeObjectURL(url);
  };
  window.downloadAllICS=function(){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dune Life OS//EN'];
    D.deadlines.filter(d=>d.importance==='critical'||d.importance==='high').forEach(d=>{
      const dt=d.date.replace(/-/g,'');
      const desc=(d.consequence?'If missed: '+d.consequence+'. ':'')+( d.note||'');
      lines.push('BEGIN:VEVENT',
        'UID:'+d.id+'@dune-life-os',
        'DTSTART;VALUE=DATE:'+dt,
        'DTEND;VALUE=DATE:'+dt,
        'SUMMARY:'+d.title,
        'DESCRIPTION:'+desc.replace(/\n/g,'\\n'),
        'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY','DESCRIPTION:1 week: '+d.title,'END:VALARM',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob=new Blob([lines.join('\r\n')],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='dune-critical-deadlines.ics'; a.click();
    URL.revokeObjectURL(url);
  };
  document.addEventListener('DOMContentLoaded',()=>renderDeadlines());
})();

/* ═══════════════════════════════════════════
   FINANCE SIMULATOR
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_finance_v1';
  function getInputs(){return LS.get(STORE,D.finance);}
  function saveInputs(v){LS.set(STORE,v);}
  function calcRussia(v){
    const customInc=Array.isArray(v.customIncome)?v.customIncome.reduce((a,c)=>a+(parseFloat(c.amount)||0),0):0;
    const customExp=Array.isArray(v.customExpenses)?v.customExpenses.reduce((a,c)=>a+(parseFloat(c.amount)||0),0):0;
    const gross=(parseFloat(v.salary)||0)+customInc;
    const expenses=(parseFloat(v.rent)||0)+(parseFloat(v.food)||0)+(parseFloat(v.transport)||0)+(parseFloat(v.utilities)||0)+(parseFloat(v.phone)||0)+(parseFloat(v.family_transfer)||0)+(parseFloat(v.other)||0)+(parseFloat(v.mai)||0)+customExp;
    const net=gross-expenses;
    const usd=parseFloat(v.usd_rate)||88;
    return {gross,expenses,net,netUSD:(net/usd).toFixed(0),annualUSD:((net*12)/usd).toFixed(0)};
  }
  function renderOutputs(){
    const v=getInputs();
    const rIn=v.russia||D.finance.russia;
    const r=calcRussia(rIn);
    const target=parseFloat(rIn.save_target)||55000;
    const rOut=document.getElementById('fin-russia-out');
    function headline(value,sub,cls){
      return '<div class="fin-headline">'+
        '<div class="fin-headline-label">Monthly Net Savings</div>'+
        '<div class="fin-headline-value '+cls+'">'+value+'</div>'+
        '<div class="fin-headline-sub">'+sub+'</div>'+
      '</div>';
    }
    const hit=r.net>=target;
    if(rOut) rOut.innerHTML=
      headline(
        (r.net>0?'+':'')+Math.round(r.net).toLocaleString()+' ₽',
        '≈ $'+r.netUSD+'/mo · $'+r.annualUSD+'/yr',
        r.net>0?'positive':'negative')+
      '<div class="fin-section-title">Breakdown</div>'+
      row('Net salary',r.gross.toLocaleString()+' ₽')+
      row('Monthly expenses',r.expenses.toLocaleString()+' ₽')+
      row('Monthly surplus',r.net.toLocaleString()+' ₽',r.net>0?'positive':'negative')+
      row(Math.round(target/1000)+'k target',hit?'✓ HIT — '+Math.round(r.net/target*100)+'%':Math.max(0,Math.round(r.net/target*100))+'% — cut '+Math.max(0,target-r.net).toLocaleString()+' ₽',hit?'positive':'negative')+
      row('Saved per year at '+Math.round(target/1000)+'k',(target*12).toLocaleString()+' ₽ · ≈ $'+Math.round((target*12)/(parseFloat(rIn.usd_rate)||88)).toLocaleString())+
      row('Emergency fund (225k ₽)',r.net>0?Math.ceil(225000/Math.min(r.net,target))+' months':'-');
  }
  function row(label,val,cls){
    return '<div class="fin-result"><span class="fin-result-label">'+label+'</span><span class="fin-result-val'+(cls?' '+cls:'')+'">'+val+'</span></div>';
  }
  function syncInputs(){
    const v=getInputs();
    const rd=D.finance.russia;
    ['salary','rent','food','transport','utilities','phone','family_transfer','other','mai','usd_rate','save_target'].forEach(k=>{
      const el=document.getElementById('fin-r-'+k);
      if(!el) return;
      const val=(v.russia&&v.russia[k]!==undefined)?v.russia[k]:rd[k];
      if(val!==undefined) el.value=val;
    });
  }
  let finIndTimer;
  function flashSavedInd(){
    const ind=document.getElementById('fin-saved-ind');
    if(!ind) return;
    ind.style.opacity='1';
    clearTimeout(finIndTimer);
    finIndTimer=setTimeout(()=>{ind.style.opacity='0';},1600);
  }
  window.finInputChange=function(phase,field,val){
    const v=getInputs();
    if(!v[phase]) v[phase]={};
    v[phase][field]=parseFloat(val)||0;
    saveInputs(v);
    renderOutputs();
    flashSavedInd();
    if(typeof bumpChangeCount==='function') bumpChangeCount();
  };
  window.saveFinanceNow=function(){
    // values are already persisted on every keystroke — this re-writes and confirms
    saveInputs(getInputs());
    renderOutputs();
    flashSavedInd();
    if(typeof showBackupToast==='function') showBackupToast('✓ Numbers saved on this device — use ☁ Gist sync to share across devices');
    if(typeof renderHome==='function') try{renderHome();}catch(e){}
  };
  window.setFinScenario=function(s,btn){
    document.querySelectorAll('.fin-scenario').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    const presets={
      conservative:{russia:{salary:130000,rent:30000,food:20000,transport:6000,utilities:4500,phone:1500,family_transfer:0,other:12000,mai:14000}},
      realistic:{russia:{salary:130000,rent:26000,food:16000,transport:5000,utilities:3500,phone:1500,family_transfer:0,other:8000,mai:14000}},
      upside:{russia:{salary:145000,rent:24000,food:14000,transport:4000,utilities:3000,phone:1200,family_transfer:0,other:6000,mai:0}},
    };
    if(presets[s]){
      const v=getInputs();
      if(presets[s].russia) v.russia=Object.assign(v.russia||{},presets[s].russia);
      saveInputs(v);
      syncInputs();
      renderOutputs();
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{ syncInputs(); renderOutputs(); refreshFinGistStatus(); });
  // Expose hooks so layered modules (e.g. money-custom.js) can drive a re-render
  // and read/write the finance store without re-implementing it.
  window.finRecompute = function(){ try { syncInputs(); renderOutputs(); } catch(e){} };
  window.finGetInputs = getInputs;
  window.finSaveInputs = saveInputs;

  // Reflect Gist sync state in both the Finance pointer and the dedicated Sync section.
  function refreshFinGistStatus(){
    const token=LS.get('dune_github_token_v1','');
    const gistId=LS.get('dune_gist_id_v1','');
    const lastSync=LS.get('dune_last_gist_sync_v1','');

    let cls, html, disabled;
    if(!token){
      cls='fin-gist-status fgs-warn';
      html='⚠ No GitHub token saved yet — open <strong>📦 Backup</strong> in the top-right nav to add one (needs the <code>gist</code> scope).';
      disabled=true;
    } else if(lastSync){
      const when=new Date(lastSync);
      cls='fin-gist-status fgs-ok';
      html='✓ Token saved · Last synced '+when.toLocaleString()+(gistId?' · Gist <code>'+gistId.slice(0,8)+'…</code>':'');
      disabled=false;
    } else {
      cls='fin-gist-status';
      html='Token saved — not synced yet. Click <strong>☁ Save to Gist</strong> to create your first cloud backup.';
      disabled=false;
    }

    // paint every status mirror that exists on the page
    ['fin-gist-status','sync-gist-status'].forEach(id=>{
      const el=document.getElementById(id);
      if(el){ el.className=cls; el.innerHTML=html; }
    });
    ['fin-save-gist-btn','sync-save-gist-btn','fin-load-gist-btn','sync-load-gist-btn'].forEach(id=>{
      const b=document.getElementById(id);
      if(b) b.disabled=disabled;
    });
  }
  // Re-check the status whenever the user enters Finance or Sync
  document.addEventListener('click',e=>{
    const t=e.target.closest('[onclick*="finance"]')||e.target.closest('[onclick*="sync"]')
      ||e.target.closest('.nmb[data-group="money"]')||e.target.closest('.nmb[data-group="sync"]');
    if(t) setTimeout(refreshFinGistStatus,60);
  });
  // Also refresh after any save/load action completes
  window._refreshFinGistStatus=refreshFinGistStatus;
})();

/* ═══════════════════════════════════════════
   CLAIMS REGISTER
   ═══════════════════════════════════════════ */
(function(){
  let clFilter='all';
  function renderClaims(filter){
    clFilter=filter||clFilter;
    const container=document.getElementById('claims-list');
    if(!container) return;
    // PRV-0.5: claims authority is Store `records.claims`; D.claims is
    // a read-only accessor that proxies to Store. No per-id override
    // merge (removed with dune_claims_v1 writer).
    let items=D.claims;
    if(clFilter!=='all') items=items.filter(c=>c.cat===clFilter||c.confidence===clFilter);
    container.innerHTML=items.map(c=>{
      const conf=c.confidence;
      const isPrivate=c.private?' data-private="true"':'';
      const lastCheck=c.lastChecked;
      return '<div class="claim-card conf-'+conf+'"'+isPrivate+'>'+
        '<div class="claim-header">'+
          '<span class="claim-conf-badge">'+conf+'</span>'+
          '<div class="claim-title">'+c.title+'</div>'+
        '</div>'+
        '<div class="claim-text">'+c.text+'</div>'+
        '<div class="claim-meta">'+
          '<span class="claim-meta-item"><strong>Category:</strong> '+c.cat+'</span>'+
          '<span class="claim-meta-item"><strong>Source:</strong> '+c.sourceType+'</span>'+
          '<span class="claim-meta-item"><strong>Checked:</strong> '+lastCheck+'</span>'+
          '<span class="claim-meta-item"><strong>Recheck:</strong> '+c.recheckDate+'</span>'+
        '</div>'+
        '<div class="claim-consequence">'+c.consequence+'</div>'+
        '<div class="claim-next">→ '+c.nextAction+'</div>'+
        '<div style="margin-top:8px;display:flex;gap:8px">'+
          '<select style="font-family:var(--mono);font-size:9px;border:1px solid var(--bdr2);border-radius:2px;padding:3px 6px;background:var(--bg);color:var(--tx);cursor:pointer" onchange="updateClaimConf(\''+c.id+'\',this.value)">'+
            ['verified','likely','uncertain','dangerous'].map(v=>'<option value="'+v+'"'+(conf===v?' selected':'')+'>'+v+'</option>').join('')+
          '</select>'+
          '<button onclick="markClaimChecked(\''+c.id+'\')" style="font-family:var(--mono);font-size:9px;letter-spacing:.5px;text-transform:uppercase;padding:4px 10px;border:1px solid var(--bdr);border-radius:2px;background:none;color:var(--tx3);cursor:pointer">Mark Checked</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  window.filterClaims=function(f,btn){
    document.querySelectorAll('.cl-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderClaims(f);
  };
  // PRV-0.5: claim writers go to Store `records.claims` (ADR-015).
  function patchClaim(id, patch){
    if(!window.Store || typeof window.Store.get!=='function' || typeof window.Store.set!=='function') return;
    const cur = window.Store.get('records.claims');
    if(!Array.isArray(cur)) return;
    let mutated = false;
    const next = cur.map(c => {
      if(!c || c.id !== id) return c;
      mutated = true;
      return Object.assign({}, c, patch);
    });
    if(!mutated) return;
    window.Store.set('records.claims', next);
  }
  window.updateClaimConf=function(id,conf){
    patchClaim(id, { confidence: conf });
    renderClaims();
  };
  window.markClaimChecked=function(id){
    patchClaim(id, { lastChecked: new Date().toISOString().split('T')[0] });
    renderClaims();
  };
  document.addEventListener('DOMContentLoaded',()=>renderClaims());
})();

/* ═══════════════════════════════════════════
   RISK MONITOR (ENHANCED)
   ═══════════════════════════════════════════ */
function renderRiskMonitor(){
  const container=document.getElementById('risk-mon-list');
  if(!container) return;
  const sorted=[...D.risks].sort((a,b)=>b.score-a.score);
  const high=sorted.filter(r=>r.score>=12).length;
  const med=sorted.filter(r=>r.score>=6&&r.score<12).length;
  const low=sorted.filter(r=>r.score<6).length;
  const stats=document.getElementById('risk-mon-stats');
  if(stats) stats.innerHTML=
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--red)">'+high+'</div><div class="risk-stat-label">High Risk (12+)</div></div>'+
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--amber)">'+med+'</div><div class="risk-stat-label">Medium (6-11)</div></div>'+
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--tx3)">'+low+'</div><div class="risk-stat-label">Low (&lt;6)</div></div>'+
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--gold2)">'+D.risks.length+'</div><div class="risk-stat-label">Total Tracked</div></div>';
  container.innerHTML=sorted.map(r=>{
    const cls=r.score>=12?'score-high':r.score>=6?'score-med':'score-low';
    const isPrivate=r.private?' data-private="true"':'';
    return '<div class="risk-mon-card"'+isPrivate+'>'+
      '<div class="risk-score '+cls+'">'+r.score+'</div>'+
      '<div class="risk-mon-body">'+
        '<div class="risk-mon-title">'+r.title+'</div>'+
        '<div class="risk-prob-impact">'+
          '<span class="rpi-badge">Prob: '+r.prob+'/5</span>'+
          '<span class="rpi-badge">Impact: '+r.impact+'/5</span>'+
          '<span class="rpi-badge" style="background:var(--bg3);color:var(--tx2)">'+r.cat+'</span>'+
        '</div>'+
        '<div class="risk-mitigation">→ '+r.mitigation+'</div>'+
        '<div class="risk-review">Review: '+r.nextReview+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
document.addEventListener('DOMContentLoaded',renderRiskMonitor);

/* ═══════════════════════════════════════════
   FIN TABS
   ═══════════════════════════════════════════ */
window.showFinTab=function(tab,btn){
  document.querySelectorAll('.fin-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.fin-tab').forEach(b=>b.classList.remove('active'));
  const panel=document.getElementById('fin-'+tab);
  if(panel) panel.classList.add('active');
  if(btn) btn.classList.add('active');
};

/* ═══════════════════════════════════════════
   INIT — RESTORE LAST SECTION
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  updateSectionLabels();
  addGroupPills();
  addBreadcrumbs();
  const last=LS.get('dune_activesec','home');
  const lastGroup=LS.get('dune_activegroup','home');
  const sub=document.getElementById('nav-sub');
  if(sub&&NAV_GROUPS[lastGroup]){sub.dataset.group=lastGroup;}
  show(last||'home');
  const savedLbTab=LS.get('dune_logbook_tab_v1','tracker');
  if(savedLbTab!=='tracker') showLbTab(savedLbTab,null);
  renderApartments();
  initBackupSystem();
});

/* ═══════════════════════════════════════════
   FEATURE 2 — BACKUP & RESTORE SYSTEM
   ═══════════════════════════════════════════ */
const BACKUP_KEYS=[
  'dune_state_v4',
  'dune_finance_v1','dune_sb_v1',
  'dune_goals_v1','dune_easa_v1',
  'dune_logbook_v1','dune_deadlines_ext_v1',
  'dune_apartments_v1','dune_logbook_entries_v1','dune_logbook_tab_v1',
  'dune_claims_v1'
];

function getAllBackupData(){
  const out={};
  BACKUP_KEYS.forEach(k=>{
    const v=localStorage.getItem(k);
    if(v!==null) try{out[k]=JSON.parse(v);}catch(e){out[k]=v;}
  });
  return out;
}
function bumpChangeCount(){
  const c=(parseInt(localStorage.getItem('dune_change_count_v1')||'0'))+1;
  localStorage.setItem('dune_change_count_v1',c);
  updateBackupPill();
}
function initBackupSystem(){
  updateBackupPill();
  checkBackupReminder();
}
function updateBackupPill(){
  const pill=document.getElementById('backup-pill');
  if(!pill) return;
  const last=LS.get('dune_last_backup_v1',null);
  if(!last){pill.textContent='📦 Backup';pill.className='backup-pill bp-red';return;}
  const days=Math.floor((Date.now()-new Date(last).getTime())/86400000);
  pill.textContent='📦 '+(days===0?'Today':days+'d');
  pill.className='backup-pill '+(days<=6?'bp-green':days<=13?'bp-amber':'bp-red');
}
function checkBackupReminder(){
  const last=LS.get('dune_last_backup_v1',null);
  const dismissed=LS.get('dune_backup_dismissed_v1',null);
  const changes=parseInt(localStorage.getItem('dune_change_count_v1')||'0');
  if(dismissed&&(Date.now()-new Date(dismissed).getTime())<3*86400000) return;
  const daysSince=last?Math.floor((Date.now()-new Date(last).getTime())/86400000):999;
  if(daysSince>7||changes>10){
    const rem=document.getElementById('backup-reminder');
    if(rem){
      rem.textContent=last?`📦 Last backed up ${daysSince}d ago · ${changes} changes — Export?`:'📦 No backup yet — export your data';
      rem.style.display='flex';
    }
  }
}
window.dismissBackupReminder=function(){
  LS.set('dune_backup_dismissed_v1',new Date().toISOString());
  const rem=document.getElementById('backup-reminder');
  if(rem) rem.style.display='none';
};
window.openBackupPanel=function(){
  const panel=document.getElementById('backup-panel');
  if(panel) panel.style.display='flex';
  updateGistUI();
};
window.closeBackupPanel=function(){
  const panel=document.getElementById('backup-panel');
  if(panel) panel.style.display='none';
};
window.exportBackup=function(){
  const data=getAllBackupData();
  const backup={version:'2026.1',exported_at:new Date().toISOString(),data};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='dune-backup-'+new Date().toISOString().slice(0,10)+'.json';
  a.click();URL.revokeObjectURL(url);
  LS.set('dune_last_backup_v1',new Date().toISOString());
  localStorage.setItem('dune_change_count_v1','0');
  updateBackupPill();
  const rem=document.getElementById('backup-reminder');
  if(rem) rem.style.display='none';
  showBackupToast('✓ Backup downloaded');
};
window.copyBackupToClipboard=async function(){
  const data=getAllBackupData();
  const json=JSON.stringify({version:'2026.1',exported_at:new Date().toISOString(),data},null,2);
  try{
    await navigator.clipboard.writeText(json);
    showBackupToast('✓ Backup copied to clipboard — paste into Notes on other device');
    LS.set('dune_last_backup_v1',new Date().toISOString());
    updateBackupPill();
  }catch(e){showBackupToast('⚠ Clipboard failed — use JSON download instead');}
};
window.importFromClipboard=async function(){
  try{
    const text=await navigator.clipboard.readText();
    await processImport(text);
  }catch(e){showBackupToast('⚠ Cannot read clipboard — use file import instead');}
};
window.triggerImportFile=function(){
  document.getElementById('backup-file-input').click();
};
window.handleImportFile=function(input){
  const file=input.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=async e=>{ try{ await processImport(e.target.result); }catch(err){ /* toast already surfaced inside processImport */ } };
  reader.readAsText(file);
  input.value='';
};
// Backup formats accepted on import. Bump when the envelope shape changes.
const SUPPORTED_BACKUP_VERSIONS=['2026.1'];
// Keys that a backup payload is never allowed to write, even if listed.
// Kept as a defence-in-depth check against future BACKUP_KEYS drift.
const PROTECTED_IMPORT_KEYS=['dune_github_token_v1','dune_pre_import_backup_v1'];
// Per-key top-level shape validators for a valid 2026.1 backup payload.
// Verified against current source: writers/readers of each key in app.js and
// core.js migrateFromLegacy. Deep domain validation is deliberately out of
// scope — the goal is to catch shape-level corruption (null, wrong container
// type) before we destructively apply.
function isPlainObj(v){ return v!==null && typeof v==='object' && !Array.isArray(v); }
const BACKUP_KEY_VALIDATORS={
  dune_state_v4:          v => isPlainObj(v) && ('data' in v) && isPlainObj(v.data),
  dune_finance_v1:        v => isPlainObj(v),
  dune_sb_v1:             v => isPlainObj(v),
  dune_goals_v1:          v => isPlainObj(v),
  dune_easa_v1:           v => isPlainObj(v),
  dune_logbook_v1:        v => Array.isArray(v),
  dune_logbook_entries_v1:v => Array.isArray(v),
  dune_logbook_tab_v1:    v => typeof v==='string',
  // No active reader in current source; accept object or array so future
  // domain code can define the shape without breaking existing 2026.1 backups.
  dune_deadlines_ext_v1:  v => isPlainObj(v) || Array.isArray(v),
  dune_apartments_v1:     v => Array.isArray(v),
  dune_claims_v1:         v => isPlainObj(v)
};

function preflightBackup(backup){
  if(!backup||typeof backup!=='object'||Array.isArray(backup)) return 'Envelope must be an object';
  if(SUPPORTED_BACKUP_VERSIONS.indexOf(backup.version)===-1) return 'Unsupported backup version';
  const d=backup.data;
  if(!d||typeof d!=='object'||Array.isArray(d)) return 'Backup data must be an object';
  const keys=Object.keys(d);
  const allowed=new Set(BACKUP_KEYS);
  const protectedSet=new Set(PROTECTED_IMPORT_KEYS);
  const unknown=[];
  for(const k of keys){
    if(protectedSet.has(k)) return 'Payload contains protected key: '+k;
    if(!allowed.has(k)) unknown.push(k);
  }
  if(unknown.length) return 'Payload contains unknown keys: '+unknown.slice(0,3).join(', ')+(unknown.length>3?' (+more)':'');
  // Require at least one recognised key so an empty {data:{}} is not a valid restore.
  let knownPresent=false;
  for(const k of BACKUP_KEYS){ if(k in d){ knownPresent=true; break; } }
  if(!knownPresent) return 'Payload has no recognised backup keys';
  // Per-key top-level shape check against the 2026.1 export contract.
  for(const k of keys){
    const check=BACKUP_KEY_VALIDATORS[k];
    if(check && !check(d[k])) return 'Invalid shape for '+k;
  }
  return null;
}
// B0-coordinated import (ADR-010). Async; every caller must await.
// Full-state transaction owns the entire import window: freezes ordinary
// Store writes, defers storage events, writes STATE_KEY LAST as a schema-13
// wrapper with revision = latest validated disk revision + 1, and
// byte-exact rollbacks on any apply failure. Recovery capsule
// (`dune_pre_import_backup_v1`) is written before any destructive change
// and survives both success and failure (per b4083a8).
const STATE_KEY_NAME='dune_state_v4';
async function processImport(text){
  let backup;
  try{backup=JSON.parse(text);}catch(e){showBackupToast('⚠ Invalid file — cannot parse JSON');return false;}
  const err=preflightBackup(backup);
  if(err){showBackupToast('⚠ '+err);return false;}
  const counts=summarizeBackup(backup.data);
  const preview=counts.map(c=>c[0]+': '+c[1]).join(' · ');
  const confirmed=confirm('Restore backup from '+backup.exported_at+'?\n\n'+preview+'\n\n⚠ Overwrites current data. Current data saved as pre-restore backup.');
  if(!confirmed) return false;

  if(!window.Store
     ||typeof window.Store.beginFullStateTransaction!=='function'
     ||typeof window.Store.commitFullStateWrapper!=='function'
     ||typeof window.Store.endFullStateTransaction!=='function'){
    showBackupToast('⚠ Store durability API unavailable — aborting');
    return false;
  }

  // Freeze BEFORE any destructive write. `force:true` so a user with pending
  // edits can still explicitly confirm the destructive import (the confirm()
  // above serves as the destructive confirmation).
  const gate=window.Store.beginFullStateTransaction({force:true,reason:'import'});
  if(!gate.ok){
    if(gate.error==='FULL_STATE_TRANSACTION_IN_PROGRESS'){ showBackupToast('⚠ Another restore is in progress — try again'); }
    else if(gate.error==='PENDING_CHANGES'){ showBackupToast('⚠ Unsaved edits present — aborting'); }
    else{ showBackupToast('⚠ Cannot enter restore mode: '+gate.error); }
    return false;
  }
  const token=gate.token;

  // Everything after this point MUST run inside try/finally so
  // endFullStateTransaction(token) fires exactly once even if rawBefore
  // capture, capsule write, or any other step throws.
  let succeeded=false;
  let rollbackFailures=[];
  let toastMsg=null;
  try{
    // Snapshot byte-exact BACKUP_KEYS state for rollback. Wrapped so a
    // failing localStorage.getItem cannot strand Store frozen.
    const rawBefore={};
    let rawBeforeReadFailed=false;
    for(const k of BACKUP_KEYS){
      try{ rawBefore[k]=localStorage.getItem(k); }
      catch(e){ rawBeforeReadFailed=true; rawBefore[k]=null; }
    }
    if(rawBeforeReadFailed){ throw new Error('RAWBEFORE_READ_FAILED'); }

    // Write recovery capsule BEFORE any destructive change. Kept after success
    // and after apply failure (b4083a8 semantics).
    try{
      const recovery=JSON.stringify({version:'2026.1',exported_at:new Date().toISOString(),data:getAllBackupData()});
      localStorage.setItem('dune_pre_import_backup_v1',recovery);
    }catch(e){ throw new Error('CAPSULE_WRITE_FAILED'); }

    const applied=[];
    try{
      // 1. Stage/apply NON-STATE backup keys first. STATE_KEY is written LAST
      //    as part of commitFullStateWrapper.
      for(const k of BACKUP_KEYS){
        if(k===STATE_KEY_NAME) continue;
        if(k in backup.data){
          localStorage.setItem(k,JSON.stringify(backup.data[k]));
          applied.push(k);
        } else if(rawBefore[k]!==null){
          localStorage.removeItem(k);
          applied.push(k);
        }
      }

      // 2. Derive candidate data. Legacy-only backups (no dune_state_v4) use
      //    the pure Store.deriveStateFromLegacy(reader) reading ONLY from the
      //    just-staged auxiliary keys.
      let candidate;
      if(STATE_KEY_NAME in backup.data){
        const wrapperOrBare=backup.data[STATE_KEY_NAME];
        // Reject malformed schema-13+ source wrappers up front. Any wrapper
        // claiming schema-13 or newer MUST carry a valid revision — a
        // negative / non-integer / out-of-range revision is a hard
        // corruption signal, not something to fall back to zero on.
        // (Codex Round-3 P1-A: revision=-1 fast-pathed as migrated.)
        if(wrapperOrBare && typeof wrapperOrBare === 'object'
           && typeof wrapperOrBare.version === 'number'
           && wrapperOrBare.version >= 13){
          const rev=wrapperOrBare.revision;
          if(!(typeof rev==='number' && Number.isFinite(rev) && Number.isInteger(rev) && rev>=0 && rev<=Number.MAX_SAFE_INTEGER)){
            throw new Error('IMPORT_SOURCE_WRAPPER_INVALID_REVISION');
          }
        }
        const ver=(wrapperOrBare&&typeof wrapperOrBare.version==='number')?wrapperOrBare.version:0;
        const rawData=(wrapperOrBare&&'data' in wrapperOrBare)?wrapperOrBare.data:wrapperOrBare;
        candidate=window.Store.migrateData(rawData,ver);
      } else {
        const stagedReader=(k)=>{ try{ return JSON.parse(localStorage.getItem(k)||'null'); }catch(e){ return null; } };
        candidate=window.Store.deriveStateFromLegacy(stagedReader);
      }
      if(typeof window.Store.normalizeLogbookDomain==='function') window.Store.normalizeLogbookDomain(candidate);
      if(typeof window.Store.validateData==='function' && !window.Store.validateData(candidate)){
        throw new Error('IMPORT_VALIDATION_FAILED');
      }

      // PRV-0.5 R4 (Codex Round-3 P1-B): DESTRUCTIVE-boundary shape guard
      // for EVERY schema-14 import candidate — regardless of marker
      // status. R3 gated only on `status === 'migrated'`; Codex R3 then
      // bypassed the guard with (a) a missing marker + four empty
      // records arrays, (b) a bogus marker status, and (c) missing
      // records + missing marker. All three were accepted, replaced
      // good current state, and hydration then re-seeded from
      // LEGACY_RECORDS — inventing user intent. Reject any schema-14
      // candidate whose migration marker is missing/invalid/unknown-
      // status OR whose records shape lacks the four canonical arrays,
      // BEFORE commitFullStateWrapper touches disk.
      if (typeof window._isSchema14CanonicalDestructiveShape === 'function'
          ? !window._isSchema14CanonicalDestructiveShape(candidate)
          : !isSchema14CanonicalDestructiveShape(candidate)) {
        throw new Error('IMPORT_SCHEMA14_CANONICAL_SHAPE_INVALID');
      }

      // 3. Commit under coordinator — writes STATE_KEY LAST as schema-14.
      const res=await window.Store.commitFullStateWrapper(token,candidate,'import');
      if(!res||!res.ok){ throw new Error(res&&res.error?res.error:'COMMIT_FAILED'); }
      applied.push(STATE_KEY_NAME);
      succeeded=true;
    }catch(applyErr){
      // Byte-exact rollback of every touched auxiliary key.
      for(const k of applied){
        try{
          if(rawBefore[k]===null) localStorage.removeItem(k);
          else localStorage.setItem(k,rawBefore[k]);
        }catch(rbErr){ rollbackFailures.push(k); }
      }
      throw applyErr;
    }
  }catch(topErr){
    // Any pre-apply throw (capsule, raw read) lands here without a rollback
    // to run — no auxiliary was written yet.
    if(topErr && topErr.message==='CAPSULE_WRITE_FAILED'){ toastMsg='⚠ Could not save pre-import backup — aborting'; }
    else if(topErr && topErr.message==='RAWBEFORE_READ_FAILED'){ toastMsg='⚠ Cannot read current storage — aborting'; }
    else if(topErr && topErr.message==='IMPORT_SOURCE_WRAPPER_INVALID_REVISION'){ toastMsg='⚠ Backup source wrapper has an invalid revision — aborting'; }
    else if(topErr && topErr.message==='IMPORT_SCHEMA14_CANONICAL_SHAPE_INVALID'){ toastMsg='⚠ Backup is malformed (missing records or migration marker) — aborting'; }
    else if(rollbackFailures.length){ toastMsg='⚠ Restore failed and rollback incomplete: '+rollbackFailures.join(', '); }
    else{ toastMsg='⚠ Restore failed — '+((topErr&&topErr.message)||'unknown'); }
  }finally{
    // Always end the transaction. If end reports a durability blocker, the
    // banner remains visible via the freeze-end event's detail.
    try{ window.Store.endFullStateTransaction(token); }catch(e){ /* best-effort */ }
  }
  if(!succeeded){
    if(toastMsg) showBackupToast(toastMsg);
    return false;
  }
  try{ localStorage.setItem('dune_change_count_v1','0'); }catch(e){ /* non-fatal */ }
  showBackupToast('✓ Restored — '+preview);
  setTimeout(()=>location.reload(),1200);
  return true;
}
function summarizeBackup(data){
  const out=[];
  if(data.dune_logbook_entries_v1) out.push(['Logbook',(data.dune_logbook_entries_v1||[]).length+' entries']);
  if(data.dune_apartments_v1) out.push(['Apartments',(data.dune_apartments_v1||[]).length]);
  if(data.dune_goals_v1) out.push(['Goals',Object.keys(data.dune_goals_v1||{}).length]);
  return out;
}
function showBackupToast(msg){
  let t=document.getElementById('backup-toast');
  if(!t){t=document.createElement('div');t.id='backup-toast';t.className='backup-toast';document.body.appendChild(t);}
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}

/* ── GITHUB GIST SYNC ── */
const GIST_BACKUP_DESCRIPTION='Dune Life OS — Auto Backup';

function setGistStatus(message,state){
  ['gist-status','sync-gist-operation-status'].forEach(id=>{
    const status=document.getElementById(id);
    if(!status) return;
    status.textContent=message||'';
    status.className='gist-status'+(state?' is-'+state:'');
  });
}

async function findBackupGists(token){
  const res=await fetch('https://api.github.com/gists?per_page=100',{
    headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}
  });
  if(!res.ok) throw new Error('Cannot list Gists: '+res.status);
  const gists=await res.json();
  return gists
    .filter(g=>g.description===GIST_BACKUP_DESCRIPTION&&g.files&&g.files['dune-backup.json'])
    .sort((a,b)=>new Date(b.updated_at)-new Date(a.updated_at));
}

function gistUpdatedLabel(gist){
  return gist&&gist.updated_at?new Date(gist.updated_at).toLocaleString():'unknown time';
}

function updateGistUI(){
  const sec=document.getElementById('gist-token-section');
  const btns=document.getElementById('gist-action-btns');
  if(!sec) return;
  const token=LS.get('dune_github_token_v1','');
  const gistId=LS.get('dune_gist_id_v1','');
  const lastSync=LS.get('dune_last_gist_sync_v1','');

  if(token){
    sec.innerHTML=`<div class="gist-token-saved">
      <span>🔑 Token saved</span>
      <button class="icl-small-btn icl-del-btn" onclick="clearGistToken()">✕ Remove</button>
    </div>
    ${gistId?`<div class="gist-id-display">Connected backup: <code>${gistId.slice(0,12)}…</code></div>`:''}
    ${lastSync?`<div class="gist-sync-time">Last synced: ${new Date(lastSync).toLocaleString()}</div>`:''}`;
    if(btns) btns.style.display='flex';
  } else {
    sec.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <input id="gist-token-input" type="password" class="gist-token-input" placeholder="Paste GitHub token here…">
      <button class="icl-small-btn" onclick="saveGistToken()">Save</button>
    </div>`;
    if(btns) btns.style.display='none';
  }
  // Mirror the same status into the inline Finance save panel.
  if(typeof window._refreshFinGistStatus==='function') try{window._refreshFinGistStatus();}catch(e){}
}

window.saveGistToken=function(){
  const el=document.getElementById('gist-token-input');
  if(!el||!el.value.trim()){showBackupToast('⚠ Paste your token first');return;}
  LS.set('dune_github_token_v1',el.value.trim());
  updateGistUI();
  showBackupToast('✓ Token saved');
};
window.clearGistToken=function(){
  if(!confirm('Remove saved GitHub token?')) return;
  localStorage.removeItem('dune_github_token_v1');
  updateGistUI();
  showBackupToast('Token removed');
};

// ── In-app "check for updates" — for iOS home-screen PWA users who can't
//    easily clear cache. Forces a no-store fetch of the page, then reloads.
window.checkForUpdates = async function(){
  const status = document.getElementById('sync-check-updates-status');
  const btn = document.getElementById('sync-check-updates-btn');
  if (status) status.textContent = 'Fetching latest…';
  if (btn) btn.disabled = true;
  try {
    // Fetch the page with cache:'no-store' to bypass any HTTP cache
    const url = window.location.pathname + '?_cb=' + Date.now();
    await fetch(url, { cache: 'no-store' });
    if (status) status.textContent = '✓ Reloading…';
    // Force a hard reload — appending the cache-buster query bypasses Service Worker / disk cache
    setTimeout(() => { window.location.replace(url); }, 250);
  } catch (e) {
    if (status) status.textContent = '⚠ ' + (e.message || 'fetch failed');
    if (btn) btn.disabled = false;
  }
};

window.saveToGist=async function(isRetry){
  const token=LS.get('dune_github_token_v1','');
  if(!token){showBackupToast('⚠ No token saved');return;}
  setGistStatus('Checking for a newer backup…');
  try{
    const gistId=LS.get('dune_gist_id_v1','');
    const knownRemoteUpdated=LS.get('dune_gist_remote_updated_v1','');
    const backups=await findBackupGists(token);
    const latest=backups[0];

    if(latest&&gistId!==latest.id){
      setGistStatus('A newer backup exists ('+gistUpdatedLabel(latest)+'). Load it before saving from this device.','warn');
      showBackupToast('⚠ Load the newest backup before saving');
      return;
    }
    if(latest&&knownRemoteUpdated&&latest.updated_at!==knownRemoteUpdated){
      setGistStatus('This backup changed on another device ('+gistUpdatedLabel(latest)+'). Load it before saving.','warn');
      showBackupToast('⚠ Another device saved newer data');
      return;
    }

    setGistStatus('Saving…');
    const data=getAllBackupData();
    const backup={version:'2026.1',exported_at:new Date().toISOString(),data};
    const content=JSON.stringify(backup,null,2);
    const url=gistId?`https://api.github.com/gists/${gistId}`:'https://api.github.com/gists';
    const method=gistId?'PATCH':'POST';
    const res=await fetch(url,{
      method,
      headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json'},
      body:JSON.stringify({description:GIST_BACKUP_DESCRIPTION,public:false,files:{'dune-backup.json':{content}}})
    });
    if(!res.ok){
      // 404 with a saved gist id = stale id → clear it and retry ONCE as a create.
      // 404 on create (or on the retry) = token lacks the gist scope — do NOT loop.
      if(res.status===404&&gistId&&!isRetry){LS.set('dune_gist_id_v1','');return window.saveToGist(true);}
      const err=await res.json().catch(()=>({}));
      const msg=(res.status===401||res.status===403||res.status===404)
        ?'Token can\'t access Gists — generate a new token (classic) with the "gist" scope ticked'
        :(err.message||'HTTP '+res.status);
      setGistStatus('⚠ '+msg,'error');
      showBackupToast('⚠ '+msg);return;
    }
    const gist=await res.json();
    LS.set('dune_gist_id_v1',gist.id);
    if(gist.updated_at) LS.set('dune_gist_remote_updated_v1',gist.updated_at);
    LS.set('dune_last_backup_v1',new Date().toISOString());
    LS.set('dune_last_gist_sync_v1',new Date().toISOString());
    localStorage.setItem('dune_change_count_v1','0');
    updateBackupPill();
    updateGistUI();
    setGistStatus('✓ Saved to the connected backup','ok');
    showBackupToast('✓ Saved to GitHub Gist');
  }catch(e){
    const msg=e.message||'Network error';
    setGistStatus('⚠ '+msg,'error');
    showBackupToast('⚠ '+msg);
  }
};

window.loadFromGist=async function(){
  const token=LS.get('dune_github_token_v1','');
  if(!token){showBackupToast('⚠ No token saved');return;}
  setGistStatus('Finding the newest backup…');
  try{
    let gistId=LS.get('dune_gist_id_v1','');
    const backups=await findBackupGists(token);
    const latest=backups[0];
    if(latest){
      gistId=latest.id;
      setGistStatus('Newest backup found: '+gistUpdatedLabel(latest)+'.');
    }
    if(!gistId){
      setGistStatus('No backup found. Connect with a Gist ID below.','warn');
      showBackupToast('No backup Gist found');
      return;
    }
    await loadFromGistId(gistId,latest&&latest.id===gistId?latest.updated_at:'');
  }catch(e){
    setGistStatus('⚠ '+(e.message||'Network error'),'error');
    showBackupToast('⚠ '+(e.message||'Network error'));
  }
};

window.loadFromGistId=async function(gistId,remoteUpdatedAt){
  const token=LS.get('dune_github_token_v1','');
  if(!gistId){showBackupToast('⚠ Enter a Gist ID');return;}
  if(!token){showBackupToast('⚠ No token saved');return;}
  setGistStatus('Loading backup…');
  try{
    const res=await fetch('https://api.github.com/gists/'+gistId.trim(),{
      headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}
    });
    if(!res.ok){setGistStatus('⚠ Gist not found: '+res.status,'error');showBackupToast('⚠ Gist not found');return;}
    const gist=await res.json();
    const content=gist.files['dune-backup.json']?.content;
    if(!content){showBackupToast('⚠ dune-backup.json not found in this Gist');return;}
    const imported=await processImport(content);
    if(!imported){setGistStatus('Load cancelled. Nothing changed.');return;}
    LS.set('dune_gist_id_v1',gistId.trim());
    const resolvedRemoteUpdated=remoteUpdatedAt||gist.updated_at||'';
    if(resolvedRemoteUpdated) LS.set('dune_gist_remote_updated_v1',resolvedRemoteUpdated);
    LS.set('dune_last_gist_sync_v1',new Date().toISOString());
    updateGistUI();
    setGistStatus('✓ Connected to this backup','ok');
  }catch(e){
    setGistStatus('⚠ '+(e.message||'Network error'),'error');
    showBackupToast('⚠ '+(e.message||'Network error'));
  }
};

/* ═══════════════════════════════════════════
   FEATURE 3 — LOGBOOK ENTRY BUILDER
   ═══════════════════════════════════════════ */
const LB_ATA=[
  {val:'05',label:'05 — Time Limits'},
  {val:'12',label:'12 — Servicing'},
  {val:'21',label:'21 — Air Conditioning'},
  {val:'24',label:'24 — Electrical Power'},
  {val:'27',label:'27 — Flight Controls'},
  {val:'28',label:'28 — Fuel'},
  {val:'29',label:'29 — Hydraulic Power'},
  {val:'32',label:'32 — Landing Gear'},
  {val:'36',label:'36 — Pneumatic'},
  {val:'71',label:'71 — Powerplant'},
  {val:'72',label:'72 — Engine'},
  {val:'73',label:'73 — Engine Fuel & Control'},
  {val:'74',label:'74 — Ignition'},
  {val:'79',label:'79 — Oil'},
  {val:'80',label:'80 — Starting'},
  {val:'other',label:'Other (specify)'}
];

window.showLbTab=function(tab,btn){
  document.querySelectorAll('.lb-tab-btn').forEach(b=>b.classList.remove('active'));
  const activeBtn=btn||Array.from(document.querySelectorAll('.lb-tab-btn')).find(b=>(b.getAttribute('onclick')||'').includes("'"+tab+"'"));
  if(activeBtn) activeBtn.classList.add('active');
  const t1=document.getElementById('lb-tab-tracker');
  const t2=document.getElementById('lb-tab-builder');
  if(t1) t1.hidden=(tab!=='tracker');
  if(t2) t2.hidden=(tab!=='builder');
  if(tab==='builder') renderLogbookBuilder();
  LS.set('dune_logbook_tab_v1',tab);
};

function renderLogbookBuilder(){
  const root=document.getElementById('lb-builder-root');
  if(!root||root.dataset.rendered==='1') return;
  root.dataset.rendered='1';
  const raw=LS.get('dune_logbook_entries_v1',[]);
  // B1 R7: malformed-but-import-accepted rows must not throw the
  // aggregation. Filter to safe objects before deref.
  const entries=Array.isArray(raw)?raw.filter(function(e){return _b1SafeObject(e)!==null;}):[];
  const today=new Date().toISOString().slice(0,10);
  const ataOpts=LB_ATA.map(a=>`<option value="${a.val}">${a.label}</option>`).join('');

  // stats — hostile toString/valueOf are neutralised via _b1Safe*.
  const totalHrs=entries.reduce(function(s,e){return s+_b1SafeNumber(e.hours);},0);
  const now=new Date();
  const monthHrs=entries.filter(function(e){
    const t=_b1SafeDateValue(e.date);
    if(!t) return false;
    const d=new Date(t);
    return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
  }).reduce(function(s,e){return s+_b1SafeNumber(e.hours);},0);
  const ataSet=new Set();
  entries.forEach(function(e){
    const a=_b1SafeText(e.ata);
    if(a) ataSet.add(a);
  });

  root.innerHTML=`
  <div class="lbb-stats">
    <div class="lbb-stat"><div class="lbb-stat-val">${entries.length}</div><div class="lbb-stat-lbl">Entries</div></div>
    <div class="lbb-stat"><div class="lbb-stat-val">${totalHrs.toFixed(1)}</div><div class="lbb-stat-lbl">Total hrs</div></div>
    <div class="lbb-stat"><div class="lbb-stat-val">${monthHrs.toFixed(1)}</div><div class="lbb-stat-lbl">This month</div></div>
    <div class="lbb-stat"><div class="lbb-stat-val">${ataSet.size}</div><div class="lbb-stat-lbl">ATA chapters</div></div>
  </div>
  <div class="lbb-form card">
    <div class="ctitle">New Entry</div>
    <div class="lbb-form-grid">
      <div class="lb-field"><label>Date</label><input id="lbb-date" type="date" value="${today}"></div>
      <div class="lb-field"><label>Aircraft Type</label><input id="lbb-aircraft" type="text" placeholder="Airbus A320-200"></div>
      <div class="lb-field"><label>Registration</label><input id="lbb-reg" type="text" placeholder="VP-BQP"></div>
      <div class="lb-field"><label>ATA Chapter</label>
        <select id="lbb-ata" onchange="lbbAtaChange(this)">${ataOpts}</select>
      </div>
      <div class="lb-field" id="lbb-ata-other-wrap" style="display:none"><label>Custom ATA</label><input id="lbb-ata-other" type="text" placeholder="e.g. 30 — Ice & Rain"></div>
      <div class="lb-field"><label>Work Hours</label><input id="lbb-hours" type="number" step="0.5" min="0.5" placeholder="2.5"></div>
      <div class="lb-field"><label>Supervisor</label><input id="lbb-supervisor" type="text" placeholder="Ivan Petrov"></div>
      <div class="lb-field"><label>Task Reference</label><input id="lbb-ref" type="text" placeholder="AMM 72-00-00-200"></div>
      <div class="lb-field" style="grid-column:1/-1"><label>Task Description (English)</label><textarea id="lbb-desc" rows="3" placeholder="Describe what you did — be specific, use ATA language"></textarea></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="lb-btn lb-btn-add" onclick="lbbSaveEntry()">+ Add to Logbook</button>
      <button class="lb-btn lb-btn-view" onclick="lbbClearForm()">Clear</button>
    </div>
  </div>
  <div class="lbb-search-wrap">
    <input class="lbb-search" id="lbb-search" type="text" placeholder="Search entries — aircraft, ATA, description…" oninput="lbbSearch(this.value)">
    <button class="lb-btn lb-btn-view" onclick="lbbExportCSV()" style="white-space:nowrap">⬇ Export CSV</button>
  </div>
  <div id="lbb-entries"></div>`;
  lbbRenderEntries(entries);
}

window.lbbAtaChange=function(sel){
  const wrap=document.getElementById('lbb-ata-other-wrap');
  if(wrap) wrap.style.display=sel.value==='other'?'':'none';
};
window.lbbClearForm=function(){
  ['lbb-aircraft','lbb-reg','lbb-hours','lbb-supervisor','lbb-ref','lbb-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const ata=document.getElementById('lbb-ata');
  if(ata){ata.value='05';lbbAtaChange(ata);}
};
window.lbbSaveEntry=function(){
  const date=document.getElementById('lbb-date')?.value;
  const aircraft=document.getElementById('lbb-aircraft')?.value.trim();
  const reg=document.getElementById('lbb-reg')?.value.trim();
  const ataEl=document.getElementById('lbb-ata');
  const ataOther=document.getElementById('lbb-ata-other')?.value.trim();
  const ata=ataEl?.value==='other'?ataOther:ataEl?.value;
  const ataLabel=ataEl?.value==='other'?ataOther:(LB_ATA.find(a=>a.val===ataEl?.value)?.label||ata);
  const hours=document.getElementById('lbb-hours')?.value;
  const supervisor=document.getElementById('lbb-supervisor')?.value.trim();
  const ref=document.getElementById('lbb-ref')?.value.trim();
  const desc=document.getElementById('lbb-desc')?.value.trim();
  if(!date||!aircraft||!ata||!hours||!desc){alert('Fill in: Date, Aircraft, ATA, Hours, Task Description');return;}
  const entry={id:'lbe_'+Date.now(),date,aircraft,reg,ata,ataLabel,hours:parseFloat(hours),supervisor,ref,desc};
  const entries=LS.get('dune_logbook_entries_v1',[]);
  entries.unshift(entry);
  // Phase A: destructive 50-entry cap removed. Every builder record now
  // survives so the Gen-2 canonical mirror can be complete. Presentation
  // pagination, if needed later, is a UI concern — not a storage one.
  LS.set('dune_logbook_entries_v1',entries);
  if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
    try { window.LOGBOOK.reconcile(); } catch (e) { /* mirror is best-effort in Phase A */ }
  }
  bumpChangeCount();
  // update stats
  document.getElementById('lb-builder-root').dataset.rendered='0';
  renderLogbookBuilder();
};
window.lbbDeleteEntry=function(id){
  if(!confirm('Delete this logbook entry? Cannot undo.')) return;
  const raw=LS.get('dune_logbook_entries_v1',[]);
  // R7: keep malformed rows in storage (round-trip faithful) but
  // guard the .id read on each candidate.
  const arr=Array.isArray(raw)?raw:[];
  const entries=arr.filter(function(e){
    if(!_b1SafeObject(e)) return true; // preserve malformed rows
    return e.id!==id;
  });
  LS.set('dune_logbook_entries_v1',entries);
  if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
    try { window.LOGBOOK.reconcile(); } catch (e) { /* mirror is best-effort */ }
  }
  document.getElementById('lb-builder-root').dataset.rendered='0';
  renderLogbookBuilder();
};
window.lbbReuseEntry=function(id){
  const raw=LS.get('dune_logbook_entries_v1',[]);
  const arr=Array.isArray(raw)?raw:[];
  const e=arr.find(function(x){ return _b1SafeObject(x) && x.id===id; });
  if(!e) return;
  const set=function(id,val){const el=document.getElementById(id); if(el) el.value=_b1SafeText(val);};
  set('lbb-aircraft', e.aircraft);
  set('lbb-reg', e.reg);
  const ataEl=document.getElementById('lbb-ata');
  if(ataEl){
    const ataText=_b1SafeText(e.ata);
    const found=LB_ATA.find(function(a){return a.val===ataText;});
    ataEl.value=found?ataText:'other';
    lbbAtaChange(ataEl);
    if(!found){const ow=document.getElementById('lbb-ata-other'); if(ow) ow.value=_b1SafeText(e.ataLabel)||ataText;}
  }
  set('lbb-hours', e.hours);
  set('lbb-supervisor', e.supervisor);
  set('lbb-ref', e.ref);
  set('lbb-desc', e.desc);
  window.scrollTo({top:document.getElementById('lb-builder-root').offsetTop-100,behavior:'smooth'});
};
window.lbbCopyEntry=async function(id){
  const raw=LS.get('dune_logbook_entries_v1',[]);
  const arr=Array.isArray(raw)?raw:[];
  const e=arr.find(function(x){ return _b1SafeObject(x) && x.id===id; });
  if(!e) return;
  const date=_b1SafeText(e.date);
  const aircraft=_b1SafeText(e.aircraft);
  const reg=_b1SafeText(e.reg);
  const ata=_b1SafeText(e.ata);
  const ataLabel=_b1SafeText(e.ataLabel);
  const desc=_b1SafeText(e.desc);
  const ref=_b1SafeText(e.ref);
  const hours=_b1SafeText(e.hours);
  const supervisor=_b1SafeText(e.supervisor);
  const text=date+' | '+aircraft+(reg?' | REG: '+reg:'')+'\n'+
             'ATA '+ata+' — '+ataLabel+'\n'+
             'Task: '+desc+'\n'+
             'Ref: '+(ref||'—')+' | Hours: '+hours+' hrs | Supervised by: '+(supervisor||'—');
  try{await navigator.clipboard.writeText(text);showBackupToast('✓ Entry copied to clipboard');}
  catch(err){alert(text);}
};
function lbbRenderEntries(entries){
  const container=document.getElementById('lbb-entries');
  if(!container) return;
  while(container.firstChild) container.removeChild(container.firstChild);
  const list=Array.isArray(entries)?entries:[];
  if(!list.length){
    const empty=document.createElement('div');
    empty.className='lb-empty';
    empty.textContent='No entries yet. Add your first logbook entry above.';
    container.appendChild(empty);
  } else {
    const frag=document.createDocumentFragment();
    list.forEach(function(e){
      if(!_b1SafeObject(e)) return;
      const row=document.createElement('div');
      row.className='lbb-entry';
      row.dataset.id=_b1SafeText(e.id);
      const meta=document.createElement('div');
      meta.className='lbb-entry-meta';
      const dateSp=document.createElement('span');
      dateSp.className='lbb-entry-date';
      dateSp.textContent=_b1SafeText(e.date);
      const acSp=document.createElement('span');
      acSp.className='lbb-entry-aircraft';
      const acText=_b1SafeText(e.aircraft);
      const regText=_b1SafeText(e.reg);
      acSp.textContent=acText+(regText?' · '+regText:'');
      const ataSp=document.createElement('span');
      ataSp.className='iqa-tag';
      ataSp.style.fontSize='8px';
      ataSp.textContent='ATA '+_b1SafeText(e.ata);
      const hrsSp=document.createElement('span');
      hrsSp.className='lbb-entry-hrs';
      hrsSp.textContent=_b1SafeText(e.hours)+' hrs';
      meta.appendChild(dateSp);
      meta.appendChild(acSp);
      meta.appendChild(ataSp);
      meta.appendChild(hrsSp);
      row.appendChild(meta);
      const desc=document.createElement('div');
      desc.className='lbb-entry-desc';
      desc.textContent=_b1SafeText(e.desc);
      row.appendChild(desc);
      const supText=_b1SafeText(e.supervisor);
      if(supText){
        const sup=document.createElement('div');
        sup.className='lbb-entry-sup';
        const refText=_b1SafeText(e.ref);
        sup.textContent='Supervised by: '+supText+(refText?' · '+refText:'');
        row.appendChild(sup);
      }
      const actions=document.createElement('div');
      actions.className='lbb-entry-actions';
      [
        {a:'copy',t:'📋 Copy',c:'icl-small-btn'},
        {a:'reuse',t:'♻ Reuse',c:'icl-small-btn'},
        {a:'delete',t:'✕ Delete',c:'icl-small-btn icl-del-btn'},
      ].forEach(function(spec){
        const b=document.createElement('button');
        b.type='button';
        b.className=spec.c;
        b.dataset.lbbAction=spec.a;
        b.textContent=spec.t;
        actions.appendChild(b);
      });
      row.appendChild(actions);
      frag.appendChild(row);
    });
    container.appendChild(frag);
  }
  if(container.dataset.b1Bound!=='1'){
    container.dataset.b1Bound='1';
    container.addEventListener('click',function(ev){
      const btn=ev.target && ev.target.closest && ev.target.closest('[data-lbb-action]');
      if(!btn||!container.contains(btn)) return;
      const row=btn.closest('[data-id]');
      if(!row) return;
      const id=row.dataset.id;
      if(id==null) return;
      const action=btn.dataset.lbbAction;
      if(action==='copy' && typeof window.lbbCopyEntry==='function') window.lbbCopyEntry(id);
      else if(action==='reuse' && typeof window.lbbReuseEntry==='function') window.lbbReuseEntry(id);
      else if(action==='delete' && typeof window.lbbDeleteEntry==='function') window.lbbDeleteEntry(id);
    });
  }
}
window.lbbSearch=function(q){
  const raw=LS.get('dune_logbook_entries_v1',[]);
  const list=Array.isArray(raw)?raw:[];
  const query=_b1SafeText(q).trim().toLowerCase();
  const filtered=query?list.filter(function(e){
    if(!_b1SafeObject(e)) return false;
    const hay=[e.aircraft,e.reg,e.ata,e.desc,e.supervisor].map(_b1SafeText).join(' ').toLowerCase();
    return hay.indexOf(query)>=0;
  }):list;
  lbbRenderEntries(filtered);
};
// B1: CSV formula/structure neutralization. Local to Logbook export.
// Policy (ADR-011 R5):
//   - Text cells: quote-and-escape; if the first character is one of
//     = + - @ TAB CR LF, or the full-width forms of = + - @, prepend
//     an apostrophe so spreadsheets do not evaluate the cell as a
//     formula. Neutralization is output-only; stored data is unchanged.
//   - Numeric cells: only actual finite JS numbers use the numeric path.
//     Numeric-looking strings fall through to the text path.
//   - Date cells: only strictly valid YYYY-MM-DD calendar dates use the
//     date path. Malformed values fall through to the text path.
//   - Output uses CRLF line endings and a UTF-8 BOM.
function _csvText(v){
  // R7: v may be a hostile-coercion object. _b1SafeText catches the throw.
  var s=_b1SafeText(v);
  if(s.length){
    var c=s.charAt(0);
    // ASCII: = + - @ TAB CR LF ; full-width: ＝ ＋ － ＠
    if('=+-@\t\r\n＝＋－＠'.indexOf(c)>=0) s="'"+s;
  }
  return '"'+s.replace(/"/g,'""')+'"';
}
function _csvNumber(v){
  return (typeof v==='number' && Number.isFinite(v)) ? String(v) : _csvText(v);
}
function _csvDate(v){
  if(typeof v!=='string') return _csvText(v);
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if(!m) return _csvText(v);
  var y=+m[1], mo=+m[2], d=+m[3];
  if(mo<1||mo>12||d<1||d>31) return _csvText(v);
  var dt=new Date(Date.UTC(y,mo-1,d));
  if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d) return _csvText(v);
  return v;
}
window.lbbExportCSV=function(){
  const raw=LS.get('dune_logbook_entries_v1',[]);
  const entries=Array.isArray(raw)?raw:[];
  if(!entries.length){alert('No entries to export.');return;}
  const BOM='﻿';
  const CRLF='\r\n';
  const headers=['Date','Aircraft Type','Registration','ATA Chapter','Task Description','Hours','Supervisor','Task Reference'];
  const headerLine=headers.map(_csvText).join(',');
  const rows=entries.map(function(e){
    if(!e||typeof e!=='object') e={};
    return [
      _csvDate(e.date),
      _csvText(e.aircraft),
      _csvText(e.reg),
      _csvText(e.ataLabel!=null?e.ataLabel:e.ata),
      _csvText(e.desc),
      _csvNumber(e.hours),
      _csvText(e.supervisor),
      _csvText(e.ref),
    ].join(',');
  }).join(CRLF);
  const blob=new Blob([BOM+headerLine+CRLF+rows+CRLF],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='logbook-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
};

/* ═══════════════════════════════════════════
   FEATURE 4 — APARTMENT TRACKER
   ═══════════════════════════════════════════ */
function renderApartments(){
  const root=document.getElementById('apartments-root');
  if(!root) return;
  const rawApts=LS.get('dune_apartments_v1',[]);
  const apts=Array.isArray(rawApts)?rawApts.filter(function(a){return a && typeof a==='object';}):[];
  const filter=root.dataset.filter||'all';
  const sort=root.dataset.sort||'rent_asc';
  const winner=apts.find(function(a){return a.winner;});

  const STATUS_CLASS={viewing:'apt-s-viewing',applied:'apt-s-applied',rejected:'apt-s-rejected',signed:'apt-s-signed'};

  function commuteClass(m){return m<40?'apt-commute-green':m<=60?'apt-commute-amber':'apt-commute-red';}
  function makeRegBadge(r){
    const s=document.createElement('span');
    s.className='apt-reg '+(r==='yes'?'apt-reg-yes':r==='no'?'apt-reg-no':'apt-reg-uk');
    s.textContent=r==='yes'?'✓ Reg OK':r==='no'?'✗ No Reg':'? Reg Unknown';
    return s;
  }
  function makeStatusPill(s){
    const cls=(typeof s==='string' && Object.prototype.hasOwnProperty.call(STATUS_CLASS,s))?STATUS_CLASS[s]:'';
    const el=document.createElement('span');
    el.className='apt-status'+(cls?' '+cls:'');
    el.textContent=_b1SafeText(s);
    return el;
  }

  let filtered=apts.filter(function(a){
    if(filter==='all'||filter===a.status) return true;
    if(filter==='reg-yes') return a.registration==='yes';
    if(filter==='reg-no') return a.registration==='no';
    return false;
  });
  filtered=filtered.slice().sort(function(a,b){
    if(sort==='rent_asc')    return _b1SafeNumber(a.rent)        - _b1SafeNumber(b.rent);
    if(sort==='commute_asc') return _b1SafeNumber(a.commute_min) - _b1SafeNumber(b.commute_min);
    return _b1SafeDateValue(b.added) - _b1SafeDateValue(a.added);
  });

  const counts={all:apts.length,viewing:0,applied:0,signed:0,rejected:0,'reg-yes':0,'reg-no':0};
  apts.forEach(function(a){
    const status=_b1SafeText(a.status);
    if(counts[status]!==undefined) counts[status]++;
    const reg=_b1SafeText(a.registration);
    if(reg==='yes') counts['reg-yes']++;
    else if(reg==='no') counts['reg-no']++;
  });

  while(root.firstChild) root.removeChild(root.firstChild);

  const title=document.createElement('div');
  title.className='ctitle';
  title.style.marginBottom='16px';
  title.textContent='🏠 Apartment Hunt — Moscow';
  root.appendChild(title);

  if(winner){
    const bar=document.createElement('div');
    bar.className='apt-winner-bar';
    bar.appendChild(document.createTextNode('⭐ Top choice: '));
    const strong=document.createElement('strong');
    strong.textContent=_b1SafeText(winner.address);
    bar.appendChild(strong);
    const winRent=(typeof winner.rent==='number' && Number.isFinite(winner.rent))?winner.rent.toLocaleString()+' ₽':'?';
    const winCommute=(typeof winner.commute_min==='number' && Number.isFinite(winner.commute_min))?winner.commute_min+' min':'?';
    bar.appendChild(document.createTextNode(' · '+winRent+' · '+winCommute+' · '));
    bar.appendChild(makeRegBadge(winner.registration));
    root.appendChild(bar);
  }

  const toolbar=document.createElement('div');
  toolbar.className='apt-toolbar';
  const filters=document.createElement('div');
  filters.className='apt-filters';
  ['all','viewing','applied','signed','reg-yes','reg-no'].forEach(function(f){
    const b=document.createElement('button');
    b.type='button';
    b.className='apt-filter-btn'+(filter===f?' active':'');
    b.dataset.aptAction='filter';
    b.dataset.aptFilter=f;
    const label=f==='all'?'All':f==='reg-yes'?'✓ Reg OK':f==='reg-no'?'✗ No Reg':f.charAt(0).toUpperCase()+f.slice(1);
    b.appendChild(document.createTextNode(label+' '));
    const cnt=document.createElement('span');
    cnt.className='iqa-filter-count';
    cnt.textContent=String(counts[f]||0);
    b.appendChild(cnt);
    filters.appendChild(b);
  });
  toolbar.appendChild(filters);
  const sortSel=document.createElement('select');
  sortSel.className='apt-sort-sel';
  sortSel.dataset.aptAction='sort';
  [['rent_asc','Cheapest first'],['commute_asc','Shortest commute'],['added_desc','Newest added']].forEach(function(pair){
    const opt=document.createElement('option');
    opt.value=pair[0];
    opt.textContent=pair[1];
    if(sort===pair[0]) opt.selected=true;
    sortSel.appendChild(opt);
  });
  toolbar.appendChild(sortSel);
  root.appendChild(toolbar);

  const addBtn=document.createElement('button');
  addBtn.type='button';
  addBtn.className='lb-btn lb-btn-add';
  addBtn.style.marginBottom='16px';
  addBtn.dataset.aptAction='openForm';
  addBtn.textContent='+ Add Apartment';
  root.appendChild(addBtn);

  // Author-controlled static form scaffold — no persisted-content interpolation.
  const formWrap=document.createElement('div');
  formWrap.id='apt-form-wrap';
  formWrap.hidden=true;
  formWrap.innerHTML=
    '<div class="card apt-form">'+
      '<div class="ctitle">New Apartment</div>'+
      '<div class="lbb-form-grid">'+
        '<div class="lb-field" style="grid-column:1/-1"><label>Address</label><input id="apt-address" type="text" placeholder="Химки, ул. Панфилова 12, кв. 34"></div>'+
        '<div class="lb-field"><label>Area</label><select id="apt-area"><option value="lobnya">Лобня</option><option value="khimki">Химки</option><option value="mytishchi">Мытищи</option><option value="other">Other</option></select></div>'+
        '<div class="lb-field"><label>Rent (₽/month)</label><input id="apt-rent" type="number" placeholder="26000"></div>'+
        '<div class="lb-field"><label>Rooms</label><select id="apt-rooms"><option value="studio">Studio</option><option value="1">1-room</option><option value="2">2-room</option></select></div>'+
        '<div class="lb-field"><label>Commute to Шереметьево (min)</label><input id="apt-commute" type="number" placeholder="45"></div>'+
        '<div class="lb-field"><label>Migration Registration</label><select id="apt-reg"><option value="unknown">Unknown</option><option value="yes">YES — landlord agrees</option><option value="no">NO — refuses</option></select></div>'+
        '<div class="lb-field"><label>Status</label><select id="apt-status"><option value="viewing">Viewing</option><option value="applied">Applied</option><option value="signed">Signed</option><option value="rejected">Rejected</option></select></div>'+
        '<div class="lb-field" style="grid-column:1/-1"><label>Notes</label><textarea id="apt-notes" rows="2" placeholder="Landlord contact, flexibility on lease, anything important…"></textarea></div>'+
      '</div>'+
      '<div style="display:flex;gap:10px;margin-top:8px">'+
        '<button type="button" class="lb-btn lb-btn-add" data-apt-action="save">Save</button>'+
        '<button type="button" class="lb-btn lb-btn-view" data-apt-action="closeForm">Cancel</button>'+
      '</div>'+
    '</div>';
  root.appendChild(formWrap);

  const grid=document.createElement('div');
  grid.className='apt-grid';
  if(!filtered.length){
    const empty=document.createElement('div');
    empty.className='lb-empty';
    empty.textContent='No apartments yet. Add your first listing above.';
    grid.appendChild(empty);
  } else {
    filtered.forEach(function(a){
      // B1 R7: an Apartment card exposes operative winner / delete
      // controls (and a dataset.aptId that the DOM delegate reads)
      // ONLY when the row is actionable. `dataset.aptId` is always a
      // string, so a numeric-id or ambiguous-id row that renders it
      // could collide with a legitimate string-id row and target it
      // instead. Non-actionable rows render read-only: status, address,
      // meta, numbers, reg badge, notes, and the map link — but no
      // toggleWinner button, no delete button, and no dataset.aptId.
      const actionable = _isActionableApartment(a);
      const card=document.createElement('div');
      card.className='apt-card'+(a.winner?' apt-card-winner':'')+(a.registration==='no'?' apt-card-noreg':'')+(actionable?'':' apt-card-readonly');
      if (actionable) card.dataset.aptId=_b1SafeText(a.id);
      const head=document.createElement('div');
      head.className='apt-card-head';
      head.appendChild(makeStatusPill(a.status));
      if (actionable) {
        const star=document.createElement('button');
        star.type='button';
        star.className='apt-star'+(a.winner?' apt-star-on':'');
        star.dataset.aptAction='toggleWinner';
        star.title='Mark as top choice';
        star.textContent='⭐';
        head.appendChild(star);
      }
      card.appendChild(head);
      const addr=document.createElement('div');
      addr.className='apt-address';
      addr.textContent=_b1SafeText(a.address);
      card.appendChild(addr);
      const meta=document.createElement('div');
      meta.className='apt-meta';
      const areaTag=document.createElement('span');
      areaTag.className='apt-area-tag';
      areaTag.textContent=_b1SafeText(a.area);
      const rooms=document.createElement('span');
      rooms.className='apt-rooms';
      rooms.textContent=_b1SafeText(a.rooms)+'-room';
      meta.appendChild(areaTag);
      meta.appendChild(rooms);
      card.appendChild(meta);
      const numbers=document.createElement('div');
      numbers.className='apt-numbers';
      const rentSp=document.createElement('span');
      rentSp.className='apt-rent';
      const rentNum=(typeof a.rent==='number' && Number.isFinite(a.rent))?a.rent:null;
      if(rentNum!==null){
        if(rentNum>37000){rentSp.style.color='var(--red)';rentSp.style.fontWeight='700';}
        else if(rentNum>28000){rentSp.style.color='var(--red)';}
        else{rentSp.style.color='var(--tx)';}
        rentSp.textContent=rentNum.toLocaleString()+' ₽';
      } else {
        rentSp.textContent='-';
      }
      if(rentNum!==null && rentNum>37000){
        const warn=document.createElement('span');
        warn.style.color='var(--red)';
        warn.textContent=' ⚠ Savings collapse';
        rentSp.appendChild(warn);
      } else if(rentNum!==null && rentNum>28000){
        const warn=document.createElement('span');
        warn.style.color='var(--amber)';
        warn.textContent=' ⚠ Over budget';
        rentSp.appendChild(warn);
      }
      numbers.appendChild(rentSp);
      const commuteSp=document.createElement('span');
      const cm=(typeof a.commute_min==='number' && Number.isFinite(a.commute_min))?a.commute_min:99;
      commuteSp.className='apt-commute '+commuteClass(cm);
      commuteSp.textContent=((typeof a.commute_min==='number' && Number.isFinite(a.commute_min))?a.commute_min+' min':'? min')+' to SVO';
      numbers.appendChild(commuteSp);
      card.appendChild(numbers);
      card.appendChild(makeRegBadge(a.registration));
      const notesText=_b1SafeText(a.notes);
      if(notesText){
        const notes=document.createElement('div');
        notes.className='apt-notes';
        notes.textContent=notesText;
        card.appendChild(notes);
      }
      const actions=document.createElement('div');
      actions.className='apt-actions';
      const mapsUrl='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(_b1SafeText(a.address)+' Moscow');
      const mapsLink=document.createElement('a');
      mapsLink.href=mapsUrl;
      mapsLink.target='_blank';
      mapsLink.rel='noopener noreferrer';
      mapsLink.className='icl-small-btn';
      mapsLink.textContent='🗺 Maps';
      actions.appendChild(mapsLink);
      if (actionable) {
        const del=document.createElement('button');
        del.type='button';
        del.className='icl-small-btn icl-del-btn';
        del.dataset.aptAction='delete';
        del.textContent='✕ Delete';
        actions.appendChild(del);
      }
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }
  root.appendChild(grid);

  if(root.dataset.b1Bound!=='1'){
    root.dataset.b1Bound='1';
    root.addEventListener('click',function(ev){
      const el=ev.target && ev.target.closest && ev.target.closest('[data-apt-action]');
      if(!el||!root.contains(el)) return;
      const action=el.dataset.aptAction;
      if(action==='openForm'){ if(typeof window.aptOpenForm==='function') window.aptOpenForm(); return; }
      if(action==='closeForm'){ if(typeof window.aptCloseForm==='function') window.aptCloseForm(); return; }
      if(action==='save'){ if(typeof window.aptSave==='function') window.aptSave(); return; }
      if(action==='filter'){
        const f=el.dataset.aptFilter;
        if(typeof f==='string' && typeof window.aptFilter==='function') window.aptFilter(f,el);
        return;
      }
      if(action==='toggleWinner'||action==='delete'){
        const card=el.closest('[data-apt-id]');
        if(!card) return;
        const id=card.dataset.aptId;
        if(!id) return;
        if(action==='toggleWinner' && typeof window.aptToggleWinner==='function') window.aptToggleWinner(id);
        else if(action==='delete' && typeof window.aptDelete==='function') window.aptDelete(id);
      }
    });
    root.addEventListener('change',function(ev){
      const el=ev.target && ev.target.closest && ev.target.closest('[data-apt-action="sort"]');
      if(!el) return;
      if(typeof window.aptSort==='function') window.aptSort(el.value);
    });
  }
}

window.aptFilter=function(f,btn){
  const root=document.getElementById('apartments-root');
  if(root){root.dataset.filter=f;renderApartments();}
};
window.aptSort=function(s){
  const root=document.getElementById('apartments-root');
  if(root){root.dataset.sort=s;renderApartments();}
};
window.aptOpenForm=function(){const w=document.getElementById('apt-form-wrap');if(w)w.hidden=false;};
window.aptCloseForm=function(){const w=document.getElementById('apt-form-wrap');if(w)w.hidden=true;};
window.aptSave=function(){
  const address=document.getElementById('apt-address')?.value.trim();
  if(!address){alert('Address is required');return;}
  const apts=LS.get('dune_apartments_v1',[]);
  apts.push({
    id:'apt_'+Date.now(),
    address,
    area:document.getElementById('apt-area')?.value||'other',
    rent:parseFloat(document.getElementById('apt-rent')?.value)||0,
    rooms:document.getElementById('apt-rooms')?.value||'1',
    commute_min:parseInt(document.getElementById('apt-commute')?.value)||0,
    registration:document.getElementById('apt-reg')?.value||'unknown',
    status:document.getElementById('apt-status')?.value||'viewing',
    winner:false,
    notes:document.getElementById('apt-notes')?.value.trim()||'',
    added:new Date().toISOString().slice(0,10)
  });
  LS.set('dune_apartments_v1',apts);
  bumpChangeCount();
  aptCloseForm();
  renderApartments();
};
// B1 R7 — apartment action predicate. `_b1SafeObject` was too loose
// for actions: {} and [] pass typeof-object and would be cloned with
// winner:false, silently rewriting import-preserved malformed rows.
// The production Apartment ID contract is a non-empty string (`aptSave`
// writes 'apt_' + Date.now() at [app.js:2857]), and delegated DOM
// actions dispatch through `element.dataset.aptId` which is always a
// string. Numeric or otherwise-typed ids therefore cannot round-trip
// through the DOM action channel safely, and are treated as
// non-actionable so they are left exactly as imported.
function _isActionableApartment(a){
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  if (!Object.prototype.hasOwnProperty.call(a, 'id')) return false;
  return typeof a.id === 'string' && a.id.length > 0;
}
// Copy an Apartment while preserving all own property descriptors —
// including an own `__proto__` data property that a JSON import may
// legitimately create. Object.assign / spread use [[Set]] and would
// route `__proto__` through the setter, dropping the own key.
function _cloneApartmentWithWinner(a, winnerVal){
  const copy = Object.defineProperties(
    Object.create(Object.getPrototypeOf(a)),
    Object.getOwnPropertyDescriptors(a)
  );
  Object.defineProperty(copy, 'winner', {
    value: winnerVal, writable: true, enumerable: true, configurable: true
  });
  return copy;
}
window.aptDelete=function(id){
  if(!confirm('Delete this apartment listing?')) return;
  const raw=LS.get('dune_apartments_v1',[]);
  const arr=Array.isArray(raw)?raw:[];
  // Preserve malformed rows exactly; only remove the matching valid row.
  const apts=arr.filter(function(a){
    if(!_isActionableApartment(a)) return true;
    return a.id!==id;
  });
  LS.set('dune_apartments_v1',apts);
  renderApartments();
};
window.aptToggleWinner=function(id){
  const raw=LS.get('dune_apartments_v1',[]);
  const arr=Array.isArray(raw)?raw:[];
  const apts=arr.map(function(a){
    // Non-actionable members (null, primitives, {}, [], objects
    // without a primitive id) are returned by reference — never cloned,
    // never rewritten. Only real Apartments participate in the toggle.
    if(!_isActionableApartment(a)) return a;
    const winnerVal = a.id===id ? !a.winner : false;
    return _cloneApartmentWithWinner(a, winnerVal);
  });
  LS.set('dune_apartments_v1',apts);
  renderApartments();
};

/* ════════════════════════════════════════════════════════════
   PHASE 1 — REACTIVE MODULES
   Built on top of Store (core.js). Each module subscribes to a
   slice of state and re-renders. No imperative cross-module calls.
   ════════════════════════════════════════════════════════════ */
(function () {
  if (!window.Store) {
    console.error('[Phase1] Store not loaded — core.js missing');
    return;
  }

  // ─── Utilities ─────────────────────────────────────────────
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function escapeHTML(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function daysTo(iso) { return Math.ceil((new Date(iso) - new Date()) / 864e5); }
  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
    catch (e) { return iso; }
  }
  function formatMonth(d) {
    try { return d.toLocaleDateString('en-GB', { month:'short', year:'numeric' }); }
    catch (e) { return ''; }
  }
  function flashInd(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 1400);
  }

  // ─── DAILY FOCUS ───────────────────────────────────────────
  function wireFocus() {
    document.querySelectorAll('input[data-focus-idx]').forEach(inp => {
      const idx = parseInt(inp.dataset.focusIdx, 10);
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const cur = (Store.get('todayFocus') || ['','','']).slice();
          while (cur.length < 3) cur.push('');
          cur[idx] = inp.value;
          Store.set('todayFocus', cur);
        }, 200);
      });
    });
    Store.subscribe('todayFocus', s => {
      const focus = s.todayFocus || ['','',''];
      document.querySelectorAll('input[data-focus-idx]').forEach(inp => {
        const idx = parseInt(inp.dataset.focusIdx, 10);
        if (document.activeElement !== inp) inp.value = focus[idx] || '';
      });
    });
  }

  // ─── CAREER TRACKER ────────────────────────────────────────
  function wireCareer() {
    ['company','position','started'].forEach(field => {
      const inp = document.getElementById('c-' + field);
      if (!inp) return;
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => Store.set('career.' + field, inp.value), 200);
      });
    });
    function syncInputs(s) {
      ['company','position','started'].forEach(field => {
        const inp = document.getElementById('c-' + field);
        if (!inp) return;
        const val = s.career[field] || '';
        if (document.activeElement !== inp) inp.value = val;
      });
    }
    function renderChips(s, kind) {
      const list = s.career[kind] || [];
      const el = document.getElementById('c-' + kind + '-chips');
      if (!el) return;
      el.innerHTML = list.length === 0
        ? '<span style="font-size:11px;color:var(--tx3);font-family:var(--mono)">none yet</span>'
        : list.map((item, i) =>
          '<span class="chip">' + escapeHTML(item) +
          '<button class="chip-x" onclick="removeCareerChip(\'' + kind + '\',' + i + ')">✕</button></span>'
        ).join('');
    }
    function renderLicenses(s) {
      const list = s.career.licenses || [];
      const el = document.getElementById('c-licenses-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<div class="lb-empty">No licenses or milestones yet. Add one below.</div>';
        return;
      }
      el.innerHTML = list.map((l, i) => {
        const days = l.target ? daysTo(l.target) : null;
        const dateBit = l.target ? formatDate(l.target) + (days !== null ? ' · ' + (days >= 0 ? days + 'd' : 'past') : '') : '—';
        const statusCls = 'lic-status-' + (l.status || 'planned');
        return '<div class="license-row ' + statusCls + '">' +
          '<div class="license-name">' + escapeHTML(l.name) + '</div>' +
          '<div class="license-meta">' + dateBit + '</div>' +
          '<select class="license-sel" onchange="updateLicenseStatus(' + i + ',this.value)">' +
            ['planned','in_progress','done'].map(s2 =>
              '<option value="' + s2 + '"' + (l.status === s2 ? ' selected' : '') + '>' +
              ({planned:'Planned','in_progress':'In progress',done:'Done ✓'}[s2]) + '</option>'
            ).join('') +
          '</select>' +
          '<button class="chip-x" onclick="removeLicense(' + i + ')">✕</button>' +
        '</div>';
      }).join('');
    }
    function render(s) {
      syncInputs(s);
      renderChips(s, 'aircraft');
      renderChips(s, 'engines');
      renderLicenses(s);
      const monthsEl = document.getElementById('c-months');
      if (monthsEl) {
        const m = Store.derive.careerMonths(s);
        monthsEl.textContent = m + ' months · ' + (m/12).toFixed(1) + ' years';
      }
    }
    Store.subscribe('career', render);
  }
  window.addCareerChip = function (kind, value) {
    value = String(value || '').trim();
    if (!value) return;
    const cur = Store.get('career.' + kind) || [];
    if (cur.includes(value)) return;
    Store.set('career.' + kind, cur.concat([value]));
  };
  window.removeCareerChip = function (kind, idx) {
    const cur = Store.get('career.' + kind) || [];
    Store.set('career.' + kind, cur.filter((_, i) => i !== idx));
  };
  window.addCareerLicense = function () {
    const name = document.getElementById('lic-name').value.trim();
    if (!name) return;
    const target = document.getElementById('lic-target').value || null;
    const status = document.getElementById('lic-status').value;
    const cur = Store.get('career.licenses') || [];
    Store.set('career.licenses', cur.concat([{ id: 'l_' + Date.now(), name, target, status }]));
    document.getElementById('lic-name').value = '';
    document.getElementById('lic-target').value = '';
  };
  window.updateLicenseStatus = function (i, status) {
    const cur = (Store.get('career.licenses') || []).slice();
    if (!cur[i]) return;
    cur[i] = Object.assign({}, cur[i], { status });
    Store.set('career.licenses', cur);
  };
  window.removeLicense = function (i) {
    const cur = Store.get('career.licenses') || [];
    Store.set('career.licenses', cur.filter((_, idx) => idx !== i));
  };

  // ─── WEEKLY REVIEW + DECISION JOURNAL ──────────────────────
  function wireReview() {
    const wk = document.getElementById('rev-week');
    if (wk && !wk.value) wk.value = new Date().toISOString().slice(0,10);
    function renderReviews(s) {
      const list = (s.reviews || []).slice().reverse();
      const el = document.getElementById('reviews-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<div class="lb-empty">No weekly reviews yet. Try one this Sunday.</div>';
        return;
      }
      el.innerHTML = list.map((r, displayIdx) => {
        const realIdx = (s.reviews.length - 1) - displayIdx;
        const dt = r.week ? formatDate(r.week) : (r.at ? formatDate(r.at) : '');
        return '<div class="review-entry">' +
          '<div class="review-entry-head">' +
            '<span class="review-date">Week of ' + dt + '</span>' +
            '<button class="chip-x" onclick="deleteReview(' + realIdx + ')">✕</button>' +
          '</div>' +
          (r.wins ? '<div class="review-block"><strong>Wins</strong><p>' + escapeHTML(r.wins) + '</p></div>' : '') +
          (r.problems ? '<div class="review-block"><strong>Problems</strong><p>' + escapeHTML(r.problems) + '</p></div>' : '') +
          (r.lessons ? '<div class="review-block"><strong>Lessons</strong><p>' + escapeHTML(r.lessons) + '</p></div>' : '') +
          (r.next ? '<div class="review-block"><strong>Next Week</strong><p>' + escapeHTML(r.next) + '</p></div>' : '') +
        '</div>';
      }).join('');
    }
    function renderDecisions(s) {
      const list = (s.decisions || []).slice().reverse();
      const el = document.getElementById('decisions-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<div class="lb-empty">No decisions journaled yet.</div>';
        return;
      }
      el.innerHTML = list.map((d, displayIdx) => {
        const realIdx = (s.decisions.length - 1) - displayIdx;
        return '<div class="review-entry">' +
          '<div class="review-entry-head">' +
            '<span class="review-date">' + (d.at ? formatDate(d.at) : '') + '</span>' +
            '<span class="review-title">' + escapeHTML(d.title) + '</span>' +
            '<button class="chip-x" onclick="deleteDecision(' + realIdx + ')">✕</button>' +
          '</div>' +
          (d.reasoning ? '<div class="review-block"><strong>Reasoning</strong><p>' + escapeHTML(d.reasoning) + '</p></div>' : '') +
          (d.expected ? '<div class="review-block"><strong>Expected outcome</strong><p>' + escapeHTML(d.expected) + '</p></div>' : '') +
          (d.success ? '<div class="review-block"><strong>Success criteria</strong><p>' + escapeHTML(d.success) + '</p></div>' : '') +
        '</div>';
      }).join('');
    }
    Store.subscribe('reviews', renderReviews);
    Store.subscribe('decisions', renderDecisions);
  }
  window.showReviewTab = function (tab, btn) {
    document.querySelectorAll('.review-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const w = document.getElementById('review-weekly');
    const d = document.getElementById('review-decisions');
    if (w) w.hidden = tab !== 'weekly';
    if (d) d.hidden = tab !== 'decisions';
  };
  window.saveReview = function () {
    const r = {
      at: new Date().toISOString(),
      week: document.getElementById('rev-week').value,
      wins: document.getElementById('rev-wins').value.trim(),
      problems: document.getElementById('rev-problems').value.trim(),
      lessons: document.getElementById('rev-lessons').value.trim(),
      next: document.getElementById('rev-next').value.trim()
    };
    if (!r.wins && !r.problems && !r.lessons && !r.next) {
      alert('Add at least one note before saving.');
      return;
    }
    const cur = Store.get('reviews') || [];
    Store.set('reviews', cur.concat([r]));
    ['rev-wins','rev-problems','rev-lessons','rev-next'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    flashInd('review-saved-ind');
  };
  window.saveDecision = function () {
    const d = {
      at: new Date().toISOString(),
      title: document.getElementById('dec-title').value.trim(),
      reasoning: document.getElementById('dec-reasoning').value.trim(),
      expected: document.getElementById('dec-expected').value.trim(),
      success: document.getElementById('dec-success').value.trim()
    };
    if (!d.title) { alert('Add a title for the decision.'); return; }
    const cur = Store.get('decisions') || [];
    Store.set('decisions', cur.concat([d]));
    ['dec-title','dec-reasoning','dec-expected','dec-success'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    flashInd('decision-saved-ind');
  };
  window.deleteReview = function (i) {
    if (!confirm('Delete this review?')) return;
    const cur = Store.get('reviews') || [];
    Store.set('reviews', cur.filter((_, idx) => idx !== i));
  };
  window.deleteDecision = function (i) {
    if (!confirm('Delete this decision?')) return;
    const cur = Store.get('decisions') || [];
    Store.set('decisions', cur.filter((_, idx) => idx !== i));
  };

  // ─── LIFE TIMELINE ─────────────────────────────────────────
  function wireTimeline() {
    const TL_KIND_ALLOW = ['past','current','future'];
    function safeKind(k){ return TL_KIND_ALLOW.indexOf(k) >= 0 ? k : 'past'; }
    function render(s) {
      const raw = (s && Array.isArray(s.timeline)) ? s.timeline : [];
      const list = raw.filter(function(t){ return _b1SafeObject(t) !== null; })
                      .slice()
                      .sort(function(a,b){ return _b1SafeDateValue(a.at) - _b1SafeDateValue(b.at); });
      const el = document.getElementById('timeline-list');
      if (!el) return;
      while(el.firstChild) el.removeChild(el.firstChild);
      if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'lb-empty';
        empty.textContent = 'Empty timeline.';
        el.appendChild(empty);
      } else {
        const frag = document.createDocumentFragment();
        list.forEach(function(t){
          const k = safeKind(t.kind);
          const row = document.createElement('div');
          row.className = 'tl-row tl-' + k;
          row.dataset.tlId = _b1SafeText(t.id);
          const dot = document.createElement('div');
          dot.className = 'tl-dot tl-' + k + '-dot';
          row.appendChild(dot);
          const when = document.createElement('div');
          when.className = 'tl-when';
          when.textContent = formatDate(_b1SafeText(t.at));
          row.appendChild(when);
          const what = document.createElement('div');
          what.className = 'tl-what';
          what.textContent = _b1SafeText(t.text);
          row.appendChild(what);
          const x = document.createElement('button');
          x.type = 'button';
          x.className = 'chip-x';
          x.dataset.tlAction = 'delete';
          x.textContent = '✕';
          row.appendChild(x);
          frag.appendChild(row);
        });
        el.appendChild(frag);
      }
      if (el.dataset.b1Bound !== '1') {
        el.dataset.b1Bound = '1';
        el.addEventListener('click', function(ev){
          const btn = ev.target && ev.target.closest && ev.target.closest('[data-tl-action="delete"]');
          if (!btn || !el.contains(btn)) return;
          const row = btn.closest('[data-tl-id]');
          if (!row) return;
          const id = row.dataset.tlId;
          if (id && typeof window.deleteTimeline === 'function') window.deleteTimeline(id);
        });
      }
    }
    Store.subscribe('timeline', render);
  }
  window.addTimelineEntry = function () {
    const at = document.getElementById('tl-date').value;
    const kind = document.getElementById('tl-kind').value;
    const text = document.getElementById('tl-text').value.trim();
    if (!at || !text) { alert('Date and description required.'); return; }
    const cur = Store.get('timeline') || [];
    Store.set('timeline', cur.concat([{ id: 'tl_' + Date.now(), at, kind, text }]));
    document.getElementById('tl-text').value = '';
  };
  window.deleteTimeline = function (id) {
    if (!confirm('Delete?')) return;
    const cur = Store.get('timeline') || [];
    const arr = Array.isArray(cur) ? cur : [];
    // Preserve malformed rows in storage; only remove the matching valid row.
    Store.set('timeline', arr.filter(function(t){
      if (!_b1SafeObject(t)) return true;
      return t.id !== id;
    }));
  };

  // ─── TODAY — REACTIVE COMMAND CENTER ───────────────────────
  function wireToday() {
    function renderMetrics(s) {
      const el = document.getElementById('home-metrics');
      if (!el) return;
      const d = Store.derive;
      const surplus = d.monthlySurplus(s);
      const target = s.money.save_target || 55000;
      const targetPct = d.saveTargetHitPct(s);
      const easa = d.easaProgress(s);
      const careerM = d.careerMonths(s);
      const dPass = daysTo('2028-01-21');
      const dMAI = daysTo('2026-07-15');
      const cards = [
        {emoji:'💰', label:'Monthly Surplus', value: (surplus >= 0 ? '+' : '') + surplus.toLocaleString() + ' ₽',
          sub: targetPct + '% of 55k target',
          color: surplus >= target ? 'var(--green)' : surplus >= target*0.7 ? 'var(--amber)' : 'var(--red)'},
        {emoji:'📚', label:'EASA B1.1', value: easa.done + '/15',
          sub: easa.pct + '% average progress',
          color: easa.done >= 10 ? 'var(--green)' : easa.done >= 5 ? 'var(--amber)' : 'var(--tx3)'},
        {emoji:'✈️', label:'Career', value: careerM + ' mo',
          sub: (s.career.aircraft||[]).length + ' aircraft · ' + (s.career.engines||[]).length + ' engines',
          color: 'var(--gold2)'},
        {emoji:'🛂', label:'Passport Wall', value: dPass + 'd',
          sub: 'Jan 21 2028 · renew before age 28',
          color: dPass <= 90 ? 'var(--red)' : dPass <= 365 ? 'var(--amber)' : 'var(--tx2)'},
        {emoji:'🎓', label:'MAI Deadline', value: dMAI < 0 ? '✓' : (dMAI + 'd'),
          sub: dMAI < 0 ? 'past · enroll if not yet' : 'July 15 · enrollment app',
          color: dMAI < 0 ? 'var(--green)' : dMAI <= 30 ? 'var(--red)' : 'var(--tx2)'},
      ];
      el.innerHTML = cards.map(c =>
        '<div class="metric-card">' +
          '<div class="metric-emoji">' + c.emoji + '</div>' +
          '<div class="metric-value" style="color:' + c.color + '">' + c.value + '</div>' +
          '<div class="metric-label">' + c.label + '</div>' +
          '<div class="metric-sub">' + c.sub + '</div>' +
        '</div>'
      ).join('');
    }
    function renderGoalsStrip(s) {
      const el = document.getElementById('today-goals-strip');
      if (!el) return;
      const d = Store.derive;
      const easa = d.easaProgress(s);
      const surplusPct = Math.min(100, d.saveTargetHitPct(s));
      const surplus = d.monthlySurplus(s);
      const target = s.money.save_target || 55000;
      const items = [
        { name: '55k Monthly Savings', pct: surplusPct,
          sub: surplus.toLocaleString() + ' ₽ surplus · target ' + target.toLocaleString() + ' ₽' },
        { name: 'EASA Part-66 B1.1', pct: easa.pct,
          sub: easa.done + ' of 15 modules done · ' + (15 - easa.done) + ' to go' },
      ];
      el.innerHTML = items.map(g =>
        '<div class="today-goal-row">' +
          '<div class="tg-name">' + g.name + '</div>' +
          '<div class="tg-bar"><div class="tg-fill" style="transform:scaleX(' + (Math.min(100, g.pct) / 100) + ')"></div></div>' +
          '<div class="tg-pct">' + g.pct + '%</div>' +
          '<div class="tg-sub">' + g.sub + '</div>' +
        '</div>'
      ).join('');
    }
    function renderPhase(s) {
      const now = new Date();
      const foundationEnd = new Date('2026-09-01');
      const phEl = document.getElementById('home-phase-name');
      const subEl = document.getElementById('home-phase-sub');
      if (phEl) phEl.textContent = now < foundationEnd ? 'Foundation' : 'Build Mode';
      if (subEl) subEl.textContent = now < foundationEnd
        ? 'АэроТраст start · 55k system live · logbook day one · MAI application'
        : 'CFM56 mastery · EASA modules · certificates · 55k every month';
    }
    Store.subscribe('*', s => {
      try { renderMetrics(s); renderGoalsStrip(s); renderPhase(s); }
      catch (e) { console.warn('[Today] render:', e); }
    });
  }

  // ─── FINANCE ↔ STORE BRIDGE ────────────────────────────────
  // Gen-1 (`dune_finance_v1.russia`) is the authoritative Russia finance
  // writer today (see docs/lifeos/STORAGE_MAP.md and the storage audit).
  // This bridge is one-way: Gen-1 → Gen-2 shadow. We do NOT write Gen-2
  // values back into Gen-1 — a Store-side stale value must never be able
  // to overwrite a current Gen-1 edit. Full canonicalisation into Gen-2
  // is a later slice.
  function bridgeFinance() {
    // Gen-1 field name → Gen-2 Store path. save_target is included so
    // Gen-1 edits to it propagate into the Store shadow that
    // dashboard/derived metrics consume.
    const fieldMap = {
      salary: 'money.salary_net',
      rent: 'money.expenses.rent',
      food: 'money.expenses.food',
      transport: 'money.expenses.transport',
      utilities: 'money.expenses.utilities',
      phone: 'money.expenses.phone',
      family_transfer: 'money.expenses.family_transfer',
      other: 'money.expenses.other',
      mai: 'money.expenses.mai',
      usd_rate: 'money.usd_rate',
      save_target: 'money.save_target'
    };
    const orig = window.finInputChange;
    window.finInputChange = function (phase, field, val) {
      if (typeof orig === 'function') orig.call(this, phase, field, val);
      if (phase === 'russia' && fieldMap[field]) {
        Store.set(fieldMap[field], parseFloat(val) || 0);
      }
    };

    // Narrow one-time bootstrap: if the canonical Gen-1 key is genuinely
    // absent (not partial, not zero, not just empty custom arrays) AND
    // Store already holds valid mapped Russia money, write those Store
    // values into Gen-1 once before any other module (notably
    // money-custom.js's seedFromIdeas) creates a Gen-1 skeleton without
    // salary/save_target. Without this bootstrap, a valid state-only
    // finance from a restored dune_state_v4 gets shadowed by defaults on
    // the next reload. Bootstrap runs BEFORE seedGen2FromGen1 so a
    // successful bootstrap makes the subsequent seed a no-op.
    function bootstrapGen1FromGen2IfAbsent() {
      // Exact-absence check: partial/malformed/zero Gen-1 → do NOT bootstrap.
      if (localStorage.getItem('dune_finance_v1') !== null) return;
      const russia = {};
      for (const [gen1Field, gen2Path] of Object.entries(fieldMap)) {
        const v = Store.get(gen2Path);
        // typeof === 'number' preserves a legitimate 0; skips undefined/NaN.
        if (typeof v === 'number' && isFinite(v)) russia[gen1Field] = v;
      }
      // Refuse to invent finance from nothing — bootstrap only when Store
      // actually holds at least one meaningful mapped Russia field.
      if (Object.keys(russia).length === 0) return;
      try {
        localStorage.setItem('dune_finance_v1', JSON.stringify({ russia }));
      } catch (e) { /* quota — accept and continue; seed will still run */ }
    }
    bootstrapGen1FromGen2IfAbsent();

    // Initial reconciliation: pull every mapped Gen-1 Russia field into
    // the Gen-2 shadow so a value the user edited via a Gen-1-only path
    // in a previous session (e.g. save_target before this fix landed) is
    // reflected in Store consumers on this session's first paint.
    // Uses `typeof === 'number'` so a legitimate `0` is not treated as
    // missing and is copied through byte-exact.
    function seedGen2FromGen1() {
      let legacy;
      try { legacy = JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'); }
      catch (e) { return; }
      const r = legacy && legacy.russia;
      if (!r || typeof r !== 'object') return;
      for (const [gen1Field, gen2Path] of Object.entries(fieldMap)) {
        const v = r[gen1Field];
        if (typeof v === 'number') Store.set(gen2Path, v);
      }
    }
    seedGen2FromGen1();

    // Push Store changes into the Russia input elements only. The prior
    // implementation also wrote back to dune_finance_v1 — that is the
    // exact path that lost user edits when Gen-2 held a stale value
    // (e.g. save_target). Removed.
    function pushStoreToInputs(s) {
      const m = s.money;
      const map = [
        ['fin-r-salary', m.salary_net],
        ['fin-r-rent', m.expenses.rent],
        ['fin-r-food', m.expenses.food],
        ['fin-r-transport', m.expenses.transport],
        ['fin-r-utilities', m.expenses.utilities],
        ['fin-r-phone', m.expenses.phone],
        ['fin-r-family_transfer', m.expenses.family_transfer],
        ['fin-r-other', m.expenses.other],
        ['fin-r-mai', m.expenses.mai],
        ['fin-r-usd_rate', m.usd_rate],
        ['fin-r-save_target', m.save_target]
      ];
      map.forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el && val != null) el.value = val;
      });
    }
    Store.subscribe('money', pushStoreToInputs);
  }

  // ─── ABOUT — META DATA STRIP ───────────────────────────────
  function wireAboutMeta() {
    function inject(s) {
      const sec = document.getElementById('aboutyou');
      if (!sec) return;
      let meta = sec.querySelector('.about-meta-strip');
      const a = s.about || {};
      // Derive "Last updated" from the auto-stamped meta.lastUpdated so the
      // date follows reality instead of needing manual schema bumps. Fall
      // back to the legacy hardcoded string if meta is missing or invalid.
      let lastUpdatedLabel = a.lastUpdated || '—';
      try {
        if (s.meta && s.meta.lastUpdated) {
          const d = new Date(s.meta.lastUpdated);
          if (!isNaN(d.getTime())) {
            lastUpdatedLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
          }
        }
      } catch (e) { /* keep legacy label */ }
      const html = '<span class="amm-pill">v' + (a.version || 1) + '</span>' +
        '<span class="amm-sep">·</span>' +
        '<span>Created ' + (a.createdAt || '—') + '</span>' +
        '<span class="amm-sep">·</span>' +
        '<span>Last updated ' + lastUpdatedLabel + '</span>';
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'about-meta-strip';
        const hd = sec.querySelector('.sec-hd');
        if (hd) hd.appendChild(meta);
      }
      meta.innerHTML = html;
    }
    Store.subscribe('about', inject);
  }

  // ─── INIT ──────────────────────────────────────────────────
  function init() {
    try { wireFocus(); } catch (e) { console.error(e); }
    try { wireCareer(); } catch (e) { console.error(e); }
    try { wireReview(); } catch (e) { console.error(e); }
    try { wireTimeline(); } catch (e) { console.error(e); }
    try { wireToday(); } catch (e) { console.error(e); }
    try { bridgeFinance(); } catch (e) { console.error(e); }
    try { if (window.LOGBOOK && window.LOGBOOK.reconcile) window.LOGBOOK.reconcile(); } catch (e) { console.error(e); }
    try { wireAboutMeta(); } catch (e) { console.error(e); }
    console.log('[Phase1] reactive modules wired. Schema v' + Store.SCHEMA_VERSION);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
