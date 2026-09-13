/* ═══════════════════════════════════════════════════════════════════════════
   GIST SYNC — base-aware concurrency (schema 1)

   P1 remediation for the timestamp-equality Gist sync defect
   (regression commit ca6bc556). Replaces
     `latest.updated_at !== knownRemoteUpdated`
   with a canonical-hash-plus-revision sync base, four-state classifier,
   verified recovery rotation, and an acknowledged sync-base write-back.

   Public surface: window.GistSync

   The module is loaded AFTER app.js (see index.html) and overwrites
   window.saveToGist / window.loadFromGist so existing callers keep working.

   Recovery rotation is orchestrated HERE (not inside processImport):
   destructive Gist Load requires a verified rotation of
   `dune_pre_import_backup_v1` → `dune_pre_import_backup_prev_v1` before
   processImport is ever invoked. If rotation cannot be verified, the
   destructive path is refused.
   ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';

  // ── constants ────────────────────────────────────────────────────────────
  const SYNC_BASE_KEY      = 'dune_gist_sync_base_v1';
  const SYNC_BASE_SCHEMA   = 1;
  const CAPSULE_KEY        = 'dune_pre_import_backup_v1';
  const CAPSULE_PREV_KEY   = 'dune_pre_import_backup_prev_v1';
  const GIST_ID_KEY        = 'dune_gist_id_v1';
  const TOKEN_KEY          = 'dune_github_token_v1';
  const LAST_SYNC_KEY      = 'dune_last_gist_sync_v1';
  const LAST_BACKUP_KEY    = 'dune_last_backup_v1';
  const CHANGE_COUNT_KEY   = 'dune_change_count_v1';
  const LEGACY_REMOTE_KEY  = 'dune_gist_remote_updated_v1'; // display-only
  const PRIOR_REMOTE_KEY   = 'dune_gist_prior_remote_revision_v1'; // audit evidence for Keep-Local resolution
  const CONFLICT_EXPORT_KEY = 'dune_gist_conflict_export_v1';       // local snapshot before destructive Load Remote resolution
  const PENDING_CREATED_KEY = 'dune_gist_pending_created_v1'; // narrowly-scoped pending-created-Gist identity (R2 B4)
  const CREATE_LOCK_NAME    = 'lifeos-gist-create-first-v1'; // cross-tab exclusive lock for first-backup creation (R2 B1)
  const MAX_DISCOVERY_PAGES = 20;                              // defensive cap on GitHub Gist listing pages (R2 B2)

  const GIST_BACKUP_DESCRIPTION = 'Dune Life OS — Auto Backup';
  const BACKUP_FILE = 'dune-backup.json';
  const BACKUP_WRAPPER_VERSION = '2026.1';

  // ── injection points (tests use these) ───────────────────────────────────
  let _fetch = (typeof fetch === 'function') ? fetch.bind(globalThis) : null;
  let _now   = () => new Date().toISOString();
  let _syncBaseInvalidated = false;

  // ── SHA-256 availability (single stable hash identity; no FNV fallback) ──
  function sha256Available(){
    return typeof crypto !== 'undefined'
        && crypto !== null
        && typeof crypto.subtle !== 'undefined'
        && crypto.subtle !== null
        && typeof crypto.subtle.digest === 'function';
  }

  // ── canonical JSON (deterministic key-sorted; no volatile metadata) ──────
  function canonicalStringify(v){
    if (v === undefined || v === null) return 'null';
    const t = typeof v;
    if (t === 'number'){
      if (!isFinite(v)) throw new Error('CANONICAL_NON_FINITE_NUMBER');
      return JSON.stringify(v);
    }
    if (t === 'boolean' || t === 'string') return JSON.stringify(v);
    if (Array.isArray(v)){
      let out = '[';
      for (let i = 0; i < v.length; i++){
        if (i) out += ',';
        out += canonicalStringify(v[i]);
      }
      return out + ']';
    }
    if (t === 'object'){
      const keys = Object.keys(v).sort();
      let out = '{';
      for (let i = 0; i < keys.length; i++){
        if (i) out += ',';
        out += JSON.stringify(keys[i]) + ':' + canonicalStringify(v[keys[i]]);
      }
      return out + '}';
    }
    throw new Error('CANONICAL_UNSUPPORTED_TYPE:' + t);
  }

  async function canonicalHash(dataObject){
    if (!sha256Available()){
      const err = new Error('SHA256_UNAVAILABLE');
      err.code = 'SHA256_UNAVAILABLE';
      throw err;
    }
    const canonical = canonicalStringify(dataObject === undefined ? null : dataObject);
    const bytes = new TextEncoder().encode(canonical);
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    const arr = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < arr.length; i++){
      hex += arr[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  // `dune_state_v4` is a durable transaction wrapper. Its revision,
  // committedAt, and data.meta.lastUpdated fields necessarily change when
  // processImport migrates and commits the same domain state, so they are
  // transaction metadata rather than sync semantics.
  // Keep canonicalHash generic; normalize only complete backup data here.
  function semanticBackupData(dataObject){
    if (!dataObject || typeof dataObject !== 'object' || Array.isArray(dataObject)) return dataObject;
    const normalized = { ...dataObject };
    const stateWrapper = normalized.dune_state_v4;
    if (stateWrapper && typeof stateWrapper === 'object' && !Array.isArray(stateWrapper)){
      const semanticState = { ...stateWrapper };
      delete semanticState.revision;
      delete semanticState.committedAt;
      if (semanticState.data && typeof semanticState.data === 'object' && !Array.isArray(semanticState.data)){
        const semanticData = { ...semanticState.data };
        if (semanticData.meta && typeof semanticData.meta === 'object' && !Array.isArray(semanticData.meta)){
          const semanticMeta = { ...semanticData.meta };
          delete semanticMeta.lastUpdated;
          semanticData.meta = semanticMeta;
        }
        semanticState.data = semanticData;
      }
      normalized.dune_state_v4 = semanticState;
    }
    return normalized;
  }

  function backupDataHash(dataObject){
    return canonicalHash(semanticBackupData(dataObject));
  }

  // ── sync-base persistence ────────────────────────────────────────────────
  function isValidIdentifier(value, maxLength){
    return typeof value === 'string'
      && value.length > 0
      && value.length <= (maxLength || 512)
      && value.trim() === value
      && !/[\u0000-\u001f\u007f\s]/.test(value);
  }

  function validateSyncBaseRecord(value){
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok:false, reason:'not-object' };
    const required = ['schema','gistId','remoteVersion','baseDataHash','acceptedAt'];
    for (const field of required){
      if (!Object.prototype.hasOwnProperty.call(value, field)) return { ok:false, reason:'missing-' + field };
    }
    if (value.schema !== SYNC_BASE_SCHEMA) return { ok:false, reason:'wrong-schema' };
    if (!isValidIdentifier(value.gistId, 256)) return { ok:false, reason:'invalid-gistId' };
    if (!isValidIdentifier(value.remoteVersion, 512)) return { ok:false, reason:'invalid-remoteVersion' };
    if (typeof value.baseDataHash !== 'string' || !/^[0-9a-f]{64}$/i.test(value.baseDataHash)){
      return { ok:false, reason:'invalid-baseDataHash' };
    }
    if (typeof value.acceptedAt !== 'string'
        || value.acceptedAt.trim() !== value.acceptedAt
        || !value.acceptedAt
        || !Number.isFinite(Date.parse(value.acceptedAt))){
      return { ok:false, reason:'invalid-acceptedAt' };
    }
    return {
      ok:true,
      base: {
        schema: value.schema,
        gistId: value.gistId,
        remoteVersion: value.remoteVersion,
        baseDataHash: value.baseDataHash,
        acceptedAt: value.acceptedAt,
      }
    };
  }

  function parseSyncBase(raw){
    if (typeof raw !== 'string' || !raw) return { ok:false, reason:'empty' };
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch(_) { return { ok:false, reason:'parse-failed' }; }
    return validateSyncBaseRecord(parsed);
  }

  function readSyncBase(){
    if (_syncBaseInvalidated) return null;
    let raw;
    try { raw = localStorage.getItem(SYNC_BASE_KEY); }
    catch(_) { return null; }
    const parsed = parseSyncBase(raw);
    return parsed.ok ? parsed.base : null;
  }

  function clearSyncBase(){
    _syncBaseInvalidated = true;
    try { localStorage.removeItem(SYNC_BASE_KEY); } catch(_){}
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-sync-base-cleared')); } catch(_){}
  }

  function failedSyncBaseWrite(reason, error){
    clearSyncBase();
    const result = { ok:false, reason };
    if (error !== undefined) result.error = String(error && error.message || error);
    return result;
  }

  function writeSyncBase(base){
    _syncBaseInvalidated = true;
    const payload = {
      schema: SYNC_BASE_SCHEMA,
      gistId: base && base.gistId,
      remoteVersion: base && base.remoteVersion,
      baseDataHash: base && base.baseDataHash,
      acceptedAt: (base && base.acceptedAt) || _now(),
    };
    const valid = validateSyncBaseRecord(payload);
    if (!valid.ok) return failedSyncBaseWrite('invalid-base-' + valid.reason);

    let serialized;
    try { serialized = JSON.stringify(valid.base); }
    catch(e){ return failedSyncBaseWrite('serialize-failed', e); }
    try { localStorage.setItem(SYNC_BASE_KEY, serialized); }
    catch(e){ return failedSyncBaseWrite('setItem-failed', e); }

    let readback;
    try { readback = localStorage.getItem(SYNC_BASE_KEY); }
    catch(e){ return failedSyncBaseWrite('readback-getItem-failed', e); }
    if (readback !== serialized) return failedSyncBaseWrite(readback === null ? 'readback-empty' : 'readback-byte-mismatch');

    const reparsed = parseSyncBase(readback);
    if (!reparsed.ok) return failedSyncBaseWrite('readback-invalid-' + reparsed.reason);
    _syncBaseInvalidated = false;
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-sync-base-updated', { detail: reparsed.base })); } catch(_){}
    return { ok:true, base: reparsed.base };
  }

  // Ownership requires one strict record and the active stored Gist ID.
  function effectiveBaseFor(gistId){
    if (!isValidIdentifier(gistId, 256)) return null;
    const connectedId = safeGet(GIST_ID_KEY, '');
    if (connectedId !== gistId) return null;
    const b = readSyncBase();
    if (!b || b.gistId !== connectedId) return null;
    return b;
  }

  function writeConnectedGistId(gistId){
    if (!isValidIdentifier(gistId, 256)){
      clearSyncBase();
      return { ok:false, reason:'invalid-gist-id' };
    }
    const serialized = JSON.stringify(gistId);
    try { localStorage.setItem(GIST_ID_KEY, serialized); }
    catch(e){ clearSyncBase(); return { ok:false, reason:'gist-id-write-failed', error:String(e && e.message || e) }; }
    let readback;
    try { readback = localStorage.getItem(GIST_ID_KEY); }
    catch(e){ clearSyncBase(); return { ok:false, reason:'gist-id-readback-failed', error:String(e && e.message || e) }; }
    if (readback !== serialized || safeGet(GIST_ID_KEY, '') !== gistId){
      clearSyncBase();
      return { ok:false, reason:'gist-id-readback-mismatch' };
    }
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-id-updated', { detail:{ gistId } })); } catch(_){}
    return { ok:true, gistId };
  }

  // ── four-state classifier ────────────────────────────────────────────────
  function classifyState(input){
    if (!input || typeof input !== 'object') return { kind: 'invalid' };
    const { localHash, remoteHash, remoteVersion, base } = input;
    if (typeof localHash !== 'string' || !localHash) return { kind: 'invalid' };
    if (typeof remoteHash !== 'string' || !remoteHash) return { kind: 'invalid' };
    if (typeof remoteVersion !== 'string' || !remoteVersion) return { kind: 'invalid' };
    if (!base) return { kind: 'no-base' };
    const localMatchesBase  = (localHash === base.baseDataHash);
    const remoteMatchesBase = (remoteHash === base.baseDataHash);
    const versionMatchesBase = (remoteVersion === base.remoteVersion);
    if (localMatchesBase && remoteMatchesBase && versionMatchesBase)
      return { kind: 'synced' };
    if (localMatchesBase && remoteMatchesBase && !versionMatchesBase)
      return { kind: 'synced-revision-drift' };  // revision advanced but data equal
    if (localMatchesBase && !remoteMatchesBase)
      return { kind: 'remote-only' };
    if (!localMatchesBase && remoteMatchesBase)
      return { kind: 'local-only' };
    // both differ from base
    if (localHash === remoteHash)
      return { kind: 'converged' };              // both drifted to identical content
    return { kind: 'conflict' };
  }

  // ── recovery rotation (hard gate for destructive Load) ───────────────────
  //
  // Rotates the existing dune_pre_import_backup_v1 (if any) into
  // dune_pre_import_backup_prev_v1 BEFORE processImport overwrites the
  // former. Verified: reads back the destination and asserts byte-equality.
  // Never treats rotation as best-effort.
  //
  // Returns:
  //   { ok:true,  rotated:false, reason:'no-prior-capsule' }  — safe to proceed
  //   { ok:true,  rotated:true }                              — safe to proceed
  //   { ok:false, reason:'...' }                              — REFUSE destructive Load
  function rotatePreLoadCapsule(){
    let current;
    try { current = localStorage.getItem(CAPSULE_KEY); }
    catch(e){ return { ok:false, reason:'read-current-failed', error:String(e && e.message || e) }; }
    if (current === null){
      return { ok:true, rotated:false, reason:'no-prior-capsule' };
    }
    try { localStorage.setItem(CAPSULE_PREV_KEY, current); }
    catch(e){ return { ok:false, reason:'write-prev-failed', error:String(e && e.message || e) }; }
    let verify;
    try { verify = localStorage.getItem(CAPSULE_PREV_KEY); }
    catch(e){ return { ok:false, reason:'read-prev-failed', error:String(e && e.message || e) }; }
    if (verify !== current){
      return { ok:false, reason:'prev-readback-mismatch' };
    }
    return { ok:true, rotated:true };
  }

  // ── UI helpers (delegated to app.js where present) ───────────────────────
  function setStatus(msg, state){
    if (typeof window.setGistStatus === 'function'){
      try { window.setGistStatus(msg, state); return; } catch(_){}
    }
  }
  function toast(msg){
    if (typeof window.showBackupToast === 'function'){
      try { window.showBackupToast(msg); return; } catch(_){}
    }
  }
  function refreshUI(){
    if (typeof window.updateGistUI === 'function'){ try { window.updateGistUI(); } catch(_){} }
    if (typeof window.updateBackupPill === 'function'){ try { window.updateBackupPill(); } catch(_){} }
  }

  // ── network helpers ──────────────────────────────────────────────────────
  async function fetchConnectedGist(token, gistId){
    if (!_fetch) throw new Error('FETCH_UNAVAILABLE');
    const res = await _fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok){
      const err = new Error('GIST_FETCH_FAILED');
      err.status = res.status;
      throw err;
    }
    const gist = await res.json();
    if (!gist || !isValidIdentifier(gist.id, 256) || gist.id !== gistId){
      const err = new Error('GIST_ID_MISMATCH'); err.status = 200; throw err;
    }
    const file = gist.files && gist.files[BACKUP_FILE];
    if (!file || typeof file.content !== 'string'){
      const err = new Error('GIST_BACKUP_FILE_MISSING');
      err.status = 200;
      throw err;
    }
    let parsed;
    try { parsed = JSON.parse(file.content); }
    catch(e){ const err = new Error('GIST_BACKUP_MALFORMED'); err.status = 200; throw err; }
    const data = (parsed && typeof parsed === 'object' && 'data' in parsed) ? parsed.data : null;
    if (data === null || typeof data !== 'object'){
      const err = new Error('GIST_BACKUP_NO_DATA'); err.status = 200; throw err;
    }
    const remoteHash = await backupDataHash(data);
    // Revision identity: prefer history[0].version; fall back to gist.node_id + updated_at
    // when history is absent (tests using a minimal fixture).
    let revision = null;
    if (Array.isArray(gist.history) && gist.history.length && typeof gist.history[0].version === 'string'){
      revision = gist.history[0].version;
    } else if (typeof gist.node_id === 'string' && gist.updated_at){
      revision = gist.node_id + '@' + gist.updated_at;
    } else if (gist.updated_at){
      revision = 'ua@' + gist.updated_at;
    } else {
      const err = new Error('GIST_REVISION_UNKNOWN'); err.status = 200; throw err;
    }
    if (!isValidIdentifier(revision, 512)){
      const err = new Error('GIST_REVISION_INVALID'); err.status = 200; throw err;
    }
    return {
      revision,
      remoteHash,
      remoteData: data,
      remoteContentText: file.content,
      gistUpdatedAt: gist.updated_at || null,
      gistId: gist.id || gistId,
    };
  }

  async function patchConnectedGist(token, gistId, backupObject){
    if (!_fetch) throw new Error('FETCH_UNAVAILABLE');
    const content = JSON.stringify(backupObject, null, 2);
    const res = await _fetch('https://api.github.com/gists/' + encodeURIComponent(gistId), {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: GIST_BACKUP_DESCRIPTION,
        files: { [BACKUP_FILE]: { content } }
      })
    });
    if (!res.ok){
      const err = new Error('GIST_PATCH_FAILED');
      err.status = res.status;
      try { const body = await res.json(); if (body && body.message) err.message = body.message; } catch(_){}
      throw err;
    }
    // We don't trust the PATCH response alone; caller re-fetches for acknowledgement.
    return { ok:true };
  }

  // Parse a GitHub `Link` header. Returns { next: url|null }. Ignores
  // other rels (prev, first, last).
  function parseLinkHeader(header){
    if (typeof header !== 'string' || !header) return { next: null };
    // Match: <URL>; rel="next"
    const re = /<([^>]+)>\s*;\s*rel\s*=\s*"([^"]+)"/g;
    let m; let nextUrl = null;
    while ((m = re.exec(header)) !== null){
      const url = m[1]; const rel = m[2];
      if (rel === 'next'){ nextUrl = url; break; }
    }
    return { next: nextUrl };
  }

  // Fetch every page of the caller's Gists until pagination ends, or a
  // defensive cap is hit. Returns { ok, pages, gists } or { ok:false, reason }.
  // Fails closed on: HTTP non-2xx, malformed JSON, non-array page body,
  // pagination loop (same next URL twice), or exceeding MAX_DISCOVERY_PAGES
  // without terminating.
  async function listAllGistsPaginated(token, options){
    options = options || {};
    const maxPages = Number.isInteger(options.maxPages) && options.maxPages > 0 ? options.maxPages : MAX_DISCOVERY_PAGES;
    if (!_fetch) return { ok:false, reason:'FETCH_UNAVAILABLE' };
    const visited = new Set();
    let url = 'https://api.github.com/gists?per_page=100';
    let pages = 0;
    const all = [];
    while (url){
      if (visited.has(url)) return { ok:false, reason:'pagination-loop', pages, atUrl:url };
      visited.add(url);
      if (pages >= maxPages) return { ok:false, reason:'pagination-cap-exceeded', pages };
      let res;
      try { res = await _fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' } }); }
      catch(e){ return { ok:false, reason:'page-fetch-throw', pages, atUrl:url, error:String(e && e.message || e) }; }
      if (!res.ok) return { ok:false, reason:'page-fetch-failed', pages, atUrl:url, status:res.status };
      let body;
      try { body = await res.json(); }
      catch(e){ return { ok:false, reason:'page-body-malformed', pages, atUrl:url, error:String(e && e.message || e) }; }
      if (!Array.isArray(body)) return { ok:false, reason:'page-body-not-array', pages, atUrl:url };
      all.push(...body);
      pages++;
      const linkHeader = (typeof res.headers === 'object' && res.headers && typeof res.headers.get === 'function')
        ? res.headers.get('Link')
        : null;
      const parsed = parseLinkHeader(linkHeader);
      url = parsed.next;
    }
    return { ok:true, pages, gists: all };
  }

  // Public discovery — paginated. Fails closed on any pagination error;
  // callers MUST NOT treat a fail-closed result as "no matching gists".
  async function findBackupGistsForBootstrap(token){
    if (!_fetch) throw new Error('FETCH_UNAVAILABLE');
    const listing = await listAllGistsPaginated(token, {});
    if (!listing.ok){
      const err = new Error('GIST_LIST_FAILED');
      err.status = listing.status || 0;
      err.reason = listing.reason;
      err.pages = listing.pages || 0;
      throw err;
    }
    return (listing.gists || [])
      .filter(g => g && g.description === GIST_BACKUP_DESCRIPTION && g.files && g.files[BACKUP_FILE])
      .sort((a,b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  // ── orchestrated flows ───────────────────────────────────────────────────
  async function preflightSyncEnvironment(){
    const token = safeGet(TOKEN_KEY, '');
    if (!token){ toast('⚠ No token saved'); return { ok:false, reason:'no-token' }; }
    if (!sha256Available()){
      setStatus('⚠ Sync unavailable — SHA-256 not supported in this browser. No destructive sync operation will proceed.', 'error');
      toast('⚠ Sync unavailable — SHA-256 not supported');
      return { ok:false, reason:'sha256-unavailable' };
    }
    if (typeof window.getAllBackupData !== 'function'){
      toast('⚠ Sync unavailable — app not fully loaded');
      return { ok:false, reason:'app-not-ready' };
    }
    return { ok:true, token };
  }

  // Settle the real Store queue before reading the persisted backup. A failed
  // flush or remaining work must never be mistaken for a synced snapshot.
  async function captureLocalBackup(){
    const store = window.Store;
    if (!store || typeof store.flushNow !== 'function' || typeof store.hasUnsavedWork !== 'function'){
      const error = new Error('Store persistence is unavailable — sync refused.');
      error.code = 'local-persistence-unsettled'; throw error;
    }
    let result;
    try { result = await store.flushNow(); }
    catch(_){
      const error = new Error('Local changes could not be saved — sync refused.');
      error.code = 'local-persistence-unsettled'; throw error;
    }
    if (!result || (result.committed !== true && result.reason !== 'NOOP') || store.hasUnsavedWork()){
      const error = new Error('Local changes remain unsaved or blocked — resolve local persistence before syncing.');
      error.code = 'local-persistence-unsettled'; throw error;
    }
    return window.getAllBackupData();
  }

  // Synchronous final check: do not flush edits that arrived after capture
  // into a previously classified operation or acknowledge them as backed up.
  function localSnapshotFailure(gistId, localData){
    try {
      if (readConnectedGistId() === gistId
          && !window.Store.hasUnsavedWork()
          && canonicalStringify(semanticBackupData(window.getAllBackupData()))
            === canonicalStringify(semanticBackupData(localData))) return null;
    } catch(_) { /* fail closed */ }
    const error = 'Local data or the connection changed during sync. Review and sync again; newer edits were not acknowledged.';
    setStatus('⚠ ' + error, 'warn');
    return { ok:false, reason:'local-changed-during-sync', error };
  }

  function safeGet(key, dflt){
    try {
      const v = localStorage.getItem(key);
      if (v === null) return dflt;
      try {
        const parsed = JSON.parse(v);
        if (typeof parsed === 'string') return parsed;
      } catch(_){}
      return v;
    }
    catch(_){ return dflt; }
  }
  function safeSet(key, val){
    try { localStorage.setItem(key, val); return true; } catch(_){ return false; }
  }

  function readConnectedGistId(){ return safeGet(GIST_ID_KEY, ''); }
  function hasStoredToken(){ return !!safeGet(TOKEN_KEY, ''); }

  function sameRemoteGeneration(a, b){
    return !!a && !!b
      && a.gistId === b.gistId
      && a.revision === b.revision
      && a.remoteHash === b.remoteHash;
  }

  function markConnectedGistUnavailable(gistId){
    clearSyncBase();
    refreshUI();
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-reconnect-required', { detail:{ gistId } })); } catch(_){}
  }

  async function refetchBeforeOverwrite(token, gistId, observedRemote){
    let current;
    try { current = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      return { ok:false, reason:e.status === 404 ? 'connected-gist-not-found' : 'remote-revalidation-failed', error:e.message };
    }
    if (!sameRemoteGeneration(observedRemote, current)){
      return { ok:false, reason:'remote-changed-before-write', remote:current };
    }
    return { ok:true, remote:current };
  }

  // GitHub does not document conditional PATCH for Gists. This helper uses
  // the strongest truthful browser-side guard available: an immediate second
  // exact-Gist GET must match the classified generation and semantic hash.
  // A residual race remains between that final GET and PATCH.
  async function overwriteConnectedGist({ token, gistId, observedRemote, localData, localHash }){
    const guard = await refetchBeforeOverwrite(token, gistId, observedRemote);
    if (!guard.ok) return guard;
    const changed = localSnapshotFailure(gistId, localData);
    if (changed) return changed;

    const backup = { version: BACKUP_WRAPPER_VERSION, exported_at: _now(), data: localData };
    try { await patchConnectedGist(token, gistId, backup); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      return { ok:false, reason:e.status === 404 ? 'connected-gist-not-found' : 'patch-failed', error:e.message, status:e.status };
    }

    let reread;
    try { reread = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      return { ok:false, reason:'reread-failed', error:e.message };
    }
    if (reread.remoteHash !== localHash){
      clearSyncBase();
      return { ok:false, reason:'reread-hash-mismatch', reread };
    }
    if (reread.revision === guard.remote.revision){
      clearSyncBase();
      return { ok:false, reason:'reread-revision-not-advanced', reread };
    }
    const changedAfterWrite = localSnapshotFailure(gistId, localData);
    if (changedAfterWrite) return changedAfterWrite;
    const w = writeSyncBase({ gistId, remoteVersion:reread.revision, baseDataHash:localHash });
    if (!w.ok) return { ok:false, reason:'unacknowledged', detail:w };
    return { ok:true, kind:'saved', base:w.base, remote:reread };
  }

  function writePriorRemoteAudit(gistId, remote){
    const payload = {
      gistId,
      remoteVersion: remote && remote.revision,
      remoteHashBefore: remote && remote.remoteHash,
      capturedAt: _now(),
    };
    if (!isValidIdentifier(payload.gistId, 256)
        || !isValidIdentifier(payload.remoteVersion, 512)
        || typeof payload.remoteHashBefore !== 'string'
        || !/^[0-9a-f]{64}$/i.test(payload.remoteHashBefore)
        || typeof payload.capturedAt !== 'string'
        || !Number.isFinite(Date.parse(payload.capturedAt))){
      return { ok:false, reason:'audit-invalid' };
    }
    let serialized;
    try { serialized = JSON.stringify(payload); }
    catch(e){ return { ok:false, reason:'audit-serialize-failed', error:String(e && e.message || e) }; }
    try { localStorage.setItem(PRIOR_REMOTE_KEY, serialized); }
    catch(e){ return { ok:false, reason:'audit-write-failed', error:String(e && e.message || e) }; }
    let readback;
    try { readback = localStorage.getItem(PRIOR_REMOTE_KEY); }
    catch(e){ return { ok:false, reason:'audit-readback-failed', error:String(e && e.message || e) }; }
    if (readback !== serialized) return { ok:false, reason:'audit-readback-mismatch' };
    return { ok:true, audit:payload };
  }

  function preserveLocalExport(gistId, remote, localData, localHash, context){
    let serialized;
    try {
      serialized = JSON.stringify({
        version: BACKUP_WRAPPER_VERSION,
        exported_at: _now(),
        data: localData,
        conflictContext: {
          kind: context || 'conflict',
          gistId,
          priorRemoteVersion: remote.revision,
          priorRemoteHash: remote.remoteHash,
          priorLocalHash: localHash,
        },
      });
    } catch(e){ return { ok:false, reason:'preservation-serialize-failed', error:String(e && e.message || e) }; }
    try { localStorage.setItem(CONFLICT_EXPORT_KEY, serialized); }
    catch(e){ return { ok:false, reason:'preservation-write-failed', error:e.message }; }
    let readback;
    try { readback = localStorage.getItem(CONFLICT_EXPORT_KEY); }
    catch(e){ return { ok:false, reason:'preservation-read-failed', error:e.message }; }
    if (readback !== serialized) return { ok:false, reason:'preservation-readback-mismatch' };
    return { ok:true, serialized };
  }

  // Small copy helper for status messages.
  function labelFor(state){
    switch (state.kind){
      case 'synced': return 'Already in sync.';
      case 'synced-revision-drift': return 'Sync base intact — remote revision advanced without content change.';
      case 'local-only': return 'This device has unsynced changes.';
      case 'remote-only': return 'The connected backup has changed since your last sync.';
      case 'conflict': return 'Local and remote backup data both changed since your last sync.';
      case 'converged': return 'Both sides drifted to the same content — nothing to reconcile.';
      case 'no-base': return 'Sync history has not been established for this backup.';
      default: return 'Sync state unknown.';
    }
  }

  async function saveConnected(){
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;
    const gistId = safeGet(GIST_ID_KEY, '');
    if (!gistId){
      setStatus('No connected backup yet. Use Create First Backup, or Bootstrap/Connect to reuse an existing one.', 'warn');
      toast('⚠ Not connected to a backup — create or bootstrap first');
      return { ok:false, reason:'no-connected-gist' };
    }
    setStatus('Checking the connected backup…');

    // Compute local semantic identity
    let localData, localHash;
    try {
      localData = await captureLocalBackup();
      localHash = await backupDataHash(localData);
    } catch(e){
      setStatus('⚠ Cannot hash local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:e.code || 'local-hash-failed' };
    }

    // Fetch remote for the EXACT connected gist — no discovery retargeting
    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404){
        markConnectedGistUnavailable(gistId);
        setStatus('⚠ Connected backup not found — reconnect required. No data changed.', 'error');
        toast('⚠ Connected backup not found');
        return { ok:false, reason:'connected-gist-not-found' };
      }
      setStatus('⚠ ' + (e.message || 'Network error'), 'error');
      return { ok:false, reason:'remote-fetch-failed', error: e.message };
    }

    const changed = localSnapshotFailure(gistId, localData);
    if (changed) return changed;
    const base = effectiveBaseFor(gistId);
    const state = classifyState({ localHash, remoteHash: remote.remoteHash, remoteVersion: remote.revision, base });

    switch (state.kind){
      case 'synced':
        setStatus('✓ Already in sync — nothing to save.', 'ok');
        return { ok:true, kind:'noop' };

      case 'synced-revision-drift': {
        // Remote revision moved but data identical (e.g., a second file was added
        // to the same Gist). Refresh base to the new revision. Non-destructive.
        const w = writeSyncBase({ gistId, remoteVersion: remote.revision, baseDataHash: base.baseDataHash });
        if (!w.ok){
          setStatus('Save completed check succeeded, but sync status could not be confirmed (' + w.reason + ').', 'warn');
          return { ok:false, reason:'unacknowledged', detail:w };
        }
        setStatus('✓ Sync base refreshed (remote revision advanced without content change).', 'ok');
        return { ok:true, kind:'revision-refresh' };
      }

      case 'remote-only':
        setStatus('⚠ ' + labelFor(state) + ' Load to sync — Save is blocked to protect remote.', 'warn');
        toast('⚠ Remote changed — Load before Save');
        return { ok:false, reason:'remote-only', state };

      case 'conflict':
        setStatus('⚠ ' + labelFor(state) + ' Save blocked. Choose Keep Local, Load Remote, or Export Local first.', 'warn');
        toast('⚠ Genuine conflict — choose an action');
        try { window.dispatchEvent(new CustomEvent('lifeos:gist-conflict', { detail:{ from:'save', localHash, remoteHash:remote.remoteHash, remoteVersion:remote.revision } })); } catch(_){}
        return { ok:false, reason:'conflict', state, remote, localHash };

      case 'no-base':
        setStatus('⚠ ' + labelFor(state) + ' Bootstrap required before Save.', 'warn');
        toast('⚠ Sync history missing — reconnect');
        return { ok:false, reason:'no-base', remote, localHash };

      case 'converged': {
        const w = writeSyncBase({ gistId, remoteVersion:remote.revision, baseDataHash:remote.remoteHash });
        if (!w.ok){
          setStatus('Converged content found, but sync status could not be confirmed (' + w.reason + ').', 'warn');
          return { ok:false, reason:'unacknowledged', detail:w };
        }
        setStatus('✓ Local and remote content converged — sync base accepted.', 'ok');
        return { ok:true, kind:'converged', base:w.base };
      }

      case 'local-only': {
        setStatus('Saving to the connected backup…');
        const saved = await overwriteConnectedGist({ token, gistId, observedRemote:remote, localData, localHash });
        if (!saved.ok){
          if (saved.reason === 'remote-changed-before-write'){
            const currentBase = effectiveBaseFor(gistId);
            const currentState = classifyState({ localHash, remoteHash:saved.remote.remoteHash, remoteVersion:saved.remote.revision, base:currentBase });
            setStatus('⚠ Connected backup changed during Save. Nothing was overwritten; review the new sync state and retry.', 'warn');
            return { ok:false, reason:'remote-changed-before-write', state:currentState, remote:saved.remote };
          }
          if (saved.reason === 'reread-hash-mismatch'){
            setStatus('⚠ Save uploaded but remote content does not match what was sent — sync trust cleared, reconnect required.', 'error');
            return saved;
          }
          if (saved.reason === 'reread-revision-not-advanced'){
            setStatus('⚠ Save response did not prove a new remote generation — sync trust cleared.', 'error');
            return saved;
          }
          if (saved.reason === 'reread-failed'){
            setStatus('Save uploaded, but sync status could not be confirmed (reread failed).', 'warn');
            return saved;
          }
          if (saved.reason === 'unacknowledged'){
            setStatus('Save completed, but sync status could not be confirmed (' + saved.detail.reason + '). Reconnect to refresh sync history.', 'warn');
            return saved;
          }
          const msg = saved.status === 401 || saved.status === 403
            ? 'Token can\'t access this Gist — check the "gist" scope.'
            : (saved.error || 'Save could not be completed safely');
          setStatus('⚠ ' + msg, 'error');
          return saved;
        }
        // Display metadata (never authoritative)
        safeSet(LAST_SYNC_KEY, new Date().toISOString());
        safeSet(LAST_BACKUP_KEY, new Date().toISOString());
        safeSet(CHANGE_COUNT_KEY, '0');
        refreshUI();
        setStatus('✓ Saved to the connected backup.', 'ok');
        toast('✓ Saved to GitHub Gist');
        return saved;
      }

      default:
        setStatus('⚠ Sync state unknown — refusing Save.', 'error');
        return { ok:false, reason:'unknown-state', state };
    }
  }

  async function loadConnected(){
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;
    const gistId = safeGet(GIST_ID_KEY, '');
    if (!gistId){
      setStatus('No connected backup yet. Use Create First Backup, or Bootstrap/Connect to reuse an existing one.', 'warn');
      toast('⚠ Not connected to a backup — create or bootstrap first');
      return { ok:false, reason:'no-connected-gist' };
    }
    setStatus('Checking the connected backup…');

    let localData, localHash;
    try {
      localData = await captureLocalBackup();
      localHash = await backupDataHash(localData);
    } catch(e){
      setStatus('⚠ Cannot hash local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:e.code || 'local-hash-failed' };
    }

    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404){
        markConnectedGistUnavailable(gistId);
        setStatus('⚠ Connected backup not found — reconnect required. No data changed.', 'error');
        toast('⚠ Connected backup not found');
        return { ok:false, reason:'connected-gist-not-found' };
      }
      setStatus('⚠ ' + (e.message || 'Network error'), 'error');
      return { ok:false, reason:'remote-fetch-failed', error:e.message };
    }

    const changed = localSnapshotFailure(gistId, localData);
    if (changed) return changed;
    const base = effectiveBaseFor(gistId);
    const state = classifyState({ localHash, remoteHash: remote.remoteHash, remoteVersion: remote.revision, base });

    switch (state.kind){
      case 'synced':
        setStatus('✓ Already in sync — nothing to load.', 'ok');
        return { ok:true, kind:'noop' };

      case 'converged': {
        const w = writeSyncBase({ gistId, remoteVersion:remote.revision, baseDataHash:remote.remoteHash });
        if (!w.ok){
          setStatus('Converged content found, but sync status could not be confirmed (' + w.reason + ').', 'warn');
          return { ok:false, reason:'unacknowledged', detail:w };
        }
        setStatus('✓ Local and remote content converged — sync base accepted.', 'ok');
        return { ok:true, kind:'converged', base:w.base };
      }

      case 'synced-revision-drift': {
        const w = writeSyncBase({ gistId, remoteVersion: remote.revision, baseDataHash: base.baseDataHash });
        if (!w.ok){ setStatus('Sync base could not be refreshed (' + w.reason + ').', 'warn'); return { ok:false, reason:'unacknowledged', detail:w }; }
        setStatus('✓ In sync — remote revision advanced without content change.', 'ok');
        return { ok:true, kind:'revision-refresh' };
      }

      case 'local-only':
        setStatus('⚠ ' + labelFor(state) + ' Load would replace local changes. Save Local first, or explicitly discard.', 'warn');
        toast('⚠ Local has unsynced changes — Save first or discard explicitly');
        return { ok:false, reason:'local-only', state };

      case 'conflict':
        setStatus('⚠ ' + labelFor(state) + ' Load blocked. Choose Keep Local, Load Remote (Discard Local), or Export Local first.', 'warn');
        toast('⚠ Genuine conflict — choose an action');
        try { window.dispatchEvent(new CustomEvent('lifeos:gist-conflict', { detail:{ from:'load', localHash, remoteHash:remote.remoteHash, remoteVersion:remote.revision } })); } catch(_){}
        return { ok:false, reason:'conflict', state, remote, localHash };

      case 'no-base':
        setStatus('⚠ ' + labelFor(state) + ' Bootstrap required before Load.', 'warn');
        toast('⚠ Sync history missing — reconnect');
        return { ok:false, reason:'no-base', remote, localHash };

      case 'remote-only':
        return performDestructiveLoad({ token, gistId, remote, localData, base });

      default:
        setStatus('⚠ Sync state unknown — refusing Load.', 'error');
        return { ok:false, reason:'unknown-state', state };
    }
  }

  // Destructive Load. Required invariant order:
  //   confirm → capture current local backup (already done via getAllBackupData)
  //   → rotate recovery capsule (verified)
  //   → invoke processImport
  //   → verify imported semantic hash matches remote.remoteHash
  //   → persist + read-back accepted sync base
  //   → report success
  //
  // Preflight refusal/cancellation happens before any recovery-slot mutation.
  async function performDestructiveLoad({ token, gistId, remote, localData, base, alreadyConfirmed }){
    // Preflight and explicit confirmation precede any recovery-slot write.
    // processImport repeats preflight, but acknowledges this same confirmation.
    if (typeof window.prepareBackupImport !== 'function'){
      return { ok:false, reason:'import-preflight-unavailable' };
    }
    const prepared = window.prepareBackupImport(remote.remoteContentText, { confirmed:alreadyConfirmed === true });
    if (!prepared){
      setStatus('Load cancelled or invalid — nothing changed.', 'warn');
      return { ok:false, reason:'cancelled-or-invalid' };
    }
    const changed = localSnapshotFailure(gistId, localData);
    if (changed) return changed;
    // Rotation remains a verified hard gate before the actual import.
    const rot = rotatePreLoadCapsule();
    if (!rot.ok){
      setStatus('⚠ Cannot begin Load — recovery generation could not be preserved (' + rot.reason + '). No data changed.', 'error');
      toast('⚠ Recovery preservation failed — Load refused');
      return { ok:false, reason:'recovery-rotation-failed', detail: rot };
    }

    // 2. Invoke processImport with the exact remote content text.
    let imported;
    try { imported = await window.processImport(remote.remoteContentText, { confirmed:true }); }
    catch(e){
      setStatus('⚠ Import failed — ' + (e.message || 'unknown'), 'error');
      return { ok:false, reason:'processImport-threw', error: e.message };
    }
    if (!imported){
      // Confirmation already happened. Deeper import validation or apply may
      // still refuse, after the explicitly approved recovery rotation.
      setStatus('Load did not complete — sync was not acknowledged. Recovery history may have rotated.', 'warn');
      return { ok:false, reason:'cancelled-or-invalid' };
    }

    // 3. Verify imported semantic hash matches what we thought we were loading.
    let importedHash;
    try { importedHash = await backupDataHash(window.getAllBackupData()); }
    catch(e){
      setStatus('⚠ Import completed but post-load hash unavailable (' + (e.message || 'error') + ') — do not trust sync.', 'error');
      return { ok:false, reason:'post-load-hash-failed' };
    }
    if (importedHash !== remote.remoteHash){
      clearSyncBase();
      setStatus('⚠ Import completed but semantic hash mismatch — do not trust sync. Restore recovery capsule if needed.', 'error');
      return { ok:false, reason:'post-load-hash-mismatch' };
    }

    // 4. Persist sync base with read-back verification.
    const w = writeSyncBase({ gistId, remoteVersion: remote.revision, baseDataHash: remote.remoteHash });
    if (!w.ok){
      setStatus('Load completed, but sync status could not be confirmed (' + w.reason + '). Reconnect to refresh sync history.', 'warn');
      return { ok:false, reason:'unacknowledged', detail:w };
    }

    safeSet(LAST_SYNC_KEY, new Date().toISOString());
    refreshUI();
    setStatus('✓ Loaded from the connected backup.', 'ok');
    return { ok:true, kind:'loaded', base:w.base };
  }

  // ── conflict resolvers (genuine-conflict Save/Load; §A1/A2 of the P1 amendment) ─
  //
  // Both resolvers refetch the connected remote and re-classify BEFORE
  // acting: a conflict that has silently resolved (converged or been
  // resolved on the other side) must not become an accidental overwrite.
  // Explicit second confirmation is required after the classifier still
  // reports 'conflict' — tests inject `{ confirmed: true }` to skip the
  // browser dialog while still exercising the same code path.

  async function resolveConflictKeepLocal(options){
    options = options || {};
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;
    const gistId = safeGet(GIST_ID_KEY, '');
    if (!gistId){
      setStatus('No connected backup — cannot resolve.', 'warn');
      return { ok:false, reason:'no-connected-gist' };
    }
    // Refetch and re-classify. Never PATCH based on a stale classification.
    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      setStatus('⚠ Cannot re-read remote before resolution: ' + (e.message || 'error'), 'error');
      return { ok:false, reason:e.status === 404 ? 'connected-gist-not-found' : 'remote-fetch-failed', error: e.message };
    }
    let localData, localHash;
    try {
      localData = await captureLocalBackup();
      localHash = await backupDataHash(localData);
    } catch(e){
      setStatus('⚠ Cannot hash local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:e.code || 'local-hash-failed' };
    }
    const changed = localSnapshotFailure(gistId, localData);
    if (changed) return changed;
    const base = effectiveBaseFor(gistId);
    const state = classifyState({ localHash, remoteHash: remote.remoteHash, remoteVersion: remote.revision, base });
    if (state.kind !== 'conflict'){
      setStatus('Conflict no longer present (' + state.kind + ') — no action taken.', 'warn');
      return { ok:false, reason:'no-longer-conflict', state };
    }

    // Explicit second confirmation.
    const proceed = (options.confirmed === true)
      || (typeof window.confirm === 'function' && window.confirm(
        'Keep Local?\n\nThis overwrites the remote backup with this device\'s data. The current remote revision will be preserved as audit evidence.'
      ));
    if (!proceed){
      setStatus('Conflict resolution cancelled — no data changed.', 'warn');
      return { ok:false, reason:'cancelled-by-user' };
    }

    // Prior-remote audit evidence is a verified hard gate for this destructive
    // overwrite. If it cannot be proven durable, nothing is patched.
    const audit = writePriorRemoteAudit(gistId, remote);
    if (!audit.ok){
      setStatus('⚠ Cannot preserve the prior remote revision (' + audit.reason + '). Keep Local refused; nothing overwritten.', 'error');
      return { ok:false, reason:audit.reason, detail:audit };
    }

    // GitHub does not expose atomic conditional PATCH for Gists. Re-fetch the
    // exact Gist immediately before PATCH and require the generation/hash used
    // for the decision to remain unchanged.
    const saved = await overwriteConnectedGist({ token, gistId, observedRemote:remote, localData, localHash });
    if (!saved.ok){
      if (saved.reason === 'remote-changed-before-write'){
        setStatus('⚠ Remote changed again before Keep Local could write. Nothing was overwritten; review and retry.', 'warn');
      } else if (saved.reason === 'reread-hash-mismatch' || saved.reason === 'reread-revision-not-advanced'){
        setStatus('⚠ Keep Local could not verify the remote result — sync trust cleared.', 'error');
      } else if (saved.reason === 'unacknowledged'){
        setStatus('Keep Local completed, but sync status could not be confirmed (' + saved.detail.reason + ').', 'warn');
      } else {
        setStatus('⚠ Keep Local failed safely: ' + (saved.error || saved.reason), 'error');
      }
      return saved;
    }
    safeSet(LAST_SYNC_KEY, new Date().toISOString());
    safeSet(LAST_BACKUP_KEY, new Date().toISOString());
    refreshUI();
    setStatus('✓ Keep Local resolved conflict — remote overwritten. Prior remote revision preserved for audit.', 'ok');
    return { ok:true, kind:'keep-local-resolved', priorRemoteVersion: remote.revision, base:saved.base };
  }

  async function resolveConflictLoadRemote(options){
    options = options || {};
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;
    const gistId = safeGet(GIST_ID_KEY, '');
    if (!gistId){
      setStatus('No connected backup — cannot resolve.', 'warn');
      return { ok:false, reason:'no-connected-gist' };
    }
    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      setStatus('⚠ Cannot re-read remote before resolution: ' + (e.message || 'error'), 'error');
      return { ok:false, reason:e.status === 404 ? 'connected-gist-not-found' : 'remote-fetch-failed', error: e.message };
    }
    let localData, localHash;
    try {
      localData = await captureLocalBackup();
      localHash = await backupDataHash(localData);
    } catch(e){
      setStatus('⚠ Cannot hash local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:e.code || 'local-hash-failed' };
    }
    const changed = localSnapshotFailure(gistId, localData);
    if (changed) return changed;
    const base = effectiveBaseFor(gistId);
    const state = classifyState({ localHash, remoteHash: remote.remoteHash, remoteVersion: remote.revision, base });
    if (state.kind !== 'conflict'){
      setStatus('Conflict no longer present (' + state.kind + ') — no action taken.', 'warn');
      return { ok:false, reason:'no-longer-conflict', state };
    }

    // Preservation/export gate BEFORE the destructive confirmation. Writes a
    // byte-exact local backup wrapper to CONFLICT_EXPORT_KEY and read-back
    // verifies. If preservation cannot be verified, the destructive path is
    // refused — this is the §A2 mandatory ordering ("BEFORE destructive
    // import"). Rotation of the ordinary capsule remains a separate hard gate
    // inside performDestructiveLoad, so the recovery generation is protected
    // independently of the conflict-export.
    const preservation = preserveLocalExport(gistId, remote, localData, localHash, 'conflict');
    if (!preservation.ok && preservation.reason === 'preservation-write-failed'){
      setStatus('⚠ Cannot preserve local backup before Load — Load refused. No data changed.', 'error');
      return preservation;
    }
    if (!preservation.ok && preservation.reason === 'preservation-read-failed'){
      setStatus('⚠ Cannot read back preserved local backup — Load refused. No data changed.', 'error');
      return preservation;
    }
    if (!preservation.ok){
      setStatus('⚠ Preserved local backup readback mismatch — Load refused. No data changed.', 'error');
      return preservation;
    }

    // Explicit destructive confirmation AFTER preservation is verified.
    const proceed = (options.confirmed === true)
      || (typeof window.confirm === 'function' && window.confirm(
        'Load Remote and discard this device\'s unsynced changes?\n\nYour local data has already been saved as a preserved backup (audit + recovery snapshot). Restore actions can bring it back.'
      ));
    if (!proceed){
      setStatus('Conflict resolution cancelled — local preserved as audit snapshot; no destructive change.', 'warn');
      return { ok:false, reason:'cancelled-by-user' };
    }

    // Delegate to the same destructive path Load uses; rotation + hash-verify
    // + sync-base gates all apply.
    return performDestructiveLoad({ token, gistId, remote, localData, base, alreadyConfirmed:true });
  }

  function readConflictExport(){
    try { return localStorage.getItem(CONFLICT_EXPORT_KEY); }
    catch(_){ return null; }
  }
  function readPriorRemoteRevision(){
    try {
      const raw = localStorage.getItem(PRIOR_REMOTE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(_){ return null; }
  }

  // ── pending-created-Gist identity (R2 B4) ──────────────────────────────
  // Written ONLY after the provider returns a syntactically valid created ID
  // and BEFORE any acknowledgement-based trust step. This is not a
  // connected-Gist ID and not a sync base; it exists so that a POST-succeeds
  // failure cannot silently strand a real remote Gist on the user's account.
  function isValidPendingRecord(v){
    return !!v
      && typeof v === 'object'
      && !Array.isArray(v)
      && v.schema === 1
      && isValidIdentifier(v.gistId, 256)
      && typeof v.createdAt === 'string'
      && Number.isFinite(Date.parse(v.createdAt));
  }
  function readPendingCreatedGist(){
    let raw;
    try { raw = localStorage.getItem(PENDING_CREATED_KEY); }
    catch(_){ return null; }
    if (typeof raw !== 'string' || !raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch(_){ return null; }
    return isValidPendingRecord(parsed) ? parsed : null;
  }
  function writePendingCreatedGist(gistId){
    if (!isValidIdentifier(gistId, 256)) return { ok:false, reason:'invalid-gist-id' };
    const rec = { schema:1, gistId, createdAt: _now() };
    let ser;
    try { ser = JSON.stringify(rec); }
    catch(e){ return { ok:false, reason:'serialize-failed', error:String(e && e.message || e) }; }
    try { localStorage.setItem(PENDING_CREATED_KEY, ser); }
    catch(e){ return { ok:false, reason:'setItem-failed', error:String(e && e.message || e) }; }
    let readback;
    try { readback = localStorage.getItem(PENDING_CREATED_KEY); }
    catch(e){ return { ok:false, reason:'readback-failed', error:String(e && e.message || e) }; }
    if (readback !== ser) return { ok:false, reason:'readback-mismatch' };
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-pending-created-updated', { detail:{ gistId, present:true } })); } catch(_){}
    return { ok:true, record: rec };
  }
  function clearPendingCreatedGist(){
    try { localStorage.removeItem(PENDING_CREATED_KEY); } catch(_){}
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-pending-created-updated', { detail:{ present:false } })); } catch(_){}
  }

  // POST a new private Gist. Response is NOT trusted alone — caller must
  // re-fetch and semantically acknowledge before persisting the ID or a base.
  async function createBackupGistOnce(token, backupObject){
    if (!_fetch) throw new Error('FETCH_UNAVAILABLE');
    const content = JSON.stringify(backupObject, null, 2);
    const res = await _fetch('https://api.github.com/gists', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: GIST_BACKUP_DESCRIPTION,
        public: false,
        files: { [BACKUP_FILE]: { content } }
      })
    });
    if (!res.ok){
      const err = new Error('GIST_CREATE_FAILED');
      err.status = res.status;
      try { const body = await res.json(); if (body && body.message) err.message = body.message; } catch(_){}
      throw err;
    }
    let created;
    try { created = await res.json(); }
    catch(e){ const err = new Error('GIST_CREATE_RESPONSE_MALFORMED'); err.status = res.status; throw err; }
    if (!created || !isValidIdentifier(created.id, 256)){
      const err = new Error('GIST_CREATE_NO_ID'); err.status = res.status; throw err;
    }
    return { newGistId: created.id };
  }

  // ── same-page serialization (R2 B1) ────────────────────────────────────
  let _createInFlight = false;
  async function _withCreateLock(fn){
    // Same-page rejection: refuse concurrent create attempts inside one page.
    if (_createInFlight) return { ok:false, reason:'already-in-flight' };
    _createInFlight = true;
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-create-in-flight-changed', { detail:{ inFlight:true } })); } catch(_){}
    try {
      // Cross-tab: prefer Web Locks when available. On environments without
      // navigator.locks the same-page flag remains the only guard; declare
      // that limitation truthfully — we never claim cross-device uniqueness.
      const canWebLock = typeof navigator !== 'undefined'
        && navigator.locks
        && typeof navigator.locks.request === 'function';
      if (canWebLock){
        return await navigator.locks.request(CREATE_LOCK_NAME, { mode:'exclusive' }, async () => fn());
      }
      return await fn();
    } finally {
      _createInFlight = false;
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-create-in-flight-changed', { detail:{ inFlight:false } })); } catch(_){}
    }
  }

  // First-backup creation: discovery-guarded, POST-once, then acknowledge
  // via a fresh exact-Gist GET before any local trust state is written.
  // Never called automatically on page load; only via explicit user intent.
  //
  // Round-2 semantics:
  //   - Serialized via in-memory flag + Web Lock (§B1).
  //   - Discovery is paginated and fail-closed on any list error (§B2).
  //   - A pending-created identity is persisted the moment the provider
  //     returns a valid created ID, BEFORE acknowledgement (§B4). It is
  //     narrowly-scoped, not a connected-Gist ID, not a sync base. On any
  //     post-POST failure, this pending record is preserved and blocks any
  //     new POST until reconcilePendingCreated() resolves it.
  async function createFirstBackup(options){
    return _withCreateLock(() => _createFirstBackupInner(options));
  }

  async function _createFirstBackupInner(options){
    options = options || {};
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;

    const existingId = safeGet(GIST_ID_KEY, '');
    if (existingId){
      setStatus('A connected backup already exists (' + existingId.slice(0,12) + '…). Create-first refused; use Save or Bootstrap.', 'warn');
      return { ok:false, reason:'already-connected' };
    }

    // Round-2 §B4: any unresolved pending-created identity must be reconciled
    // before a new POST is allowed. This prevents a second orphan Gist after
    // an earlier POST-then-failure.
    const pending = readPendingCreatedGist();
    if (pending){
      setStatus('A previous backup Gist was created but not fully acknowledged. Reconcile before creating another.', 'warn');
      toast('⚠ Pending backup exists — reconcile first');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-first-backup-unacknowledged', { detail:{ createdGistId: pending.gistId, reason:'pending-blocks-new-create' } })); } catch(_){}
      return { ok:false, reason:'pending-created-present', pendingGistId: pending.gistId };
    }

    setStatus('Checking whether a backup Gist already exists for this token…');
    let gists;
    try { gists = await findBackupGistsForBootstrap(token); }
    catch(e){
      setStatus('⚠ Cannot verify existing backups (' + (e.message || 'error') + ') — create refused.', 'error');
      return { ok:false, reason:'list-failed', error:e.message, discoveryReason: e.reason || null };
    }
    if (gists && gists.length){
      setStatus('An existing backup Gist was discovered (' + gists[0].id.slice(0,12) + '…). Create-first refused; use Bootstrap/Connect to reuse it.', 'warn');
      toast('⚠ Existing backup discovered — Bootstrap instead');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-existing-backup-discoverable', { detail:{ gistId: gists[0].id } })); } catch(_){}
      return { ok:false, reason:'existing-backup-discoverable', discoveredGistId: gists[0].id };
    }

    let localData, localHash;
    try {
      localData = await captureLocalBackup();
      localHash = await backupDataHash(localData);
    } catch(e){
      setStatus('⚠ Cannot capture local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:e.code || 'local-hash-failed', error:e.message };
    }

    const proceed = options.confirmed === true
      || (typeof window.confirm === 'function' && window.confirm(
        'Create the first private Gist backup for LIFE OS?\n\nA new private Gist will be created with this device\'s current backup data. Nothing is overwritten. You can cancel.'
      ));
    if (!proceed){
      setStatus('Create first backup cancelled — no Gist was created.', 'warn');
      return { ok:false, reason:'cancelled-by-user' };
    }

    // Immediately-before-POST re-verification: local authority state must
    // still equal the captured snapshot, and discovery must still be empty.
    let recheckLocal;
    try { recheckLocal = window.getAllBackupData(); }
    catch(e){ return { ok:false, reason:'prepost-local-read-failed', error:e.message }; }
    if (canonicalStringify(semanticBackupData(recheckLocal)) !== canonicalStringify(semanticBackupData(localData))){
      setStatus('⚠ Local data changed between capture and POST — refusing to create with a mismatched snapshot.', 'warn');
      return { ok:false, reason:'local-changed-before-post' };
    }
    let finalGists;
    try { finalGists = await findBackupGistsForBootstrap(token); }
    catch(e){
      setStatus('⚠ Final discovery check failed (' + (e.message || 'error') + ') — create refused.', 'error');
      return { ok:false, reason:'final-list-failed', error:e.message };
    }
    if (finalGists && finalGists.length){
      setStatus('A matching backup Gist appeared just before create — refusing to POST.', 'warn');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-existing-backup-discoverable', { detail:{ gistId: finalGists[0].id } })); } catch(_){}
      return { ok:false, reason:'existing-backup-discoverable', discoveredGistId: finalGists[0].id };
    }
    // Pending identity might have been persisted by a *cross-tab* attempt
    // during the discovery window; re-check.
    const pendingAfterFinal = readPendingCreatedGist();
    if (pendingAfterFinal){
      setStatus('Another tab persisted a pending backup identity — reconcile before creating another.', 'warn');
      return { ok:false, reason:'pending-created-present', pendingGistId: pendingAfterFinal.gistId };
    }

    const backup = { version: BACKUP_WRAPPER_VERSION, exported_at: _now(), data: localData };
    let created;
    try { created = await createBackupGistOnce(token, backup); }
    catch(e){
      setStatus('⚠ Backup Gist could not be created (' + (e.message || 'error') + '). Nothing local changed.', 'error');
      return { ok:false, reason: (e.status === 401 || e.status === 403) ? 'unauthorized' : 'create-failed', error:e.message, status:e.status };
    }
    const newGistId = created.newGistId;

    // R2 §B4: persist pending-created identity IMMEDIATELY after POST returns
    // a valid ID, BEFORE any acknowledgement step. Any later failure keeps
    // this record so recovery can locate the real remote object.
    const pendWrite = writePendingCreatedGist(newGistId);
    if (!pendWrite.ok){
      // The Gist exists remotely but we cannot durably record it — surface
      // this truthfully. Do NOT proceed to base persistence; do NOT clear
      // pending (it never wrote).
      setStatus('⚠ Backup Gist was created but the pending identity could not be persisted (' + pendWrite.reason + '). Local storage may be full or blocked.', 'error');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-first-backup-unacknowledged', { detail:{ createdGistId: newGistId, reason:'pending-write-failed' } })); } catch(_){}
      return { ok:false, reason:'pending-write-failed', createdGistId:newGistId, detail:pendWrite };
    }

    let ack;
    try { ack = await fetchConnectedGist(token, newGistId); }
    catch(e){
      setStatus('⚠ Backup Gist was created but could not be re-read for acknowledgement — sync uncertain. Local preserved. A pending identity was recorded for recovery.', 'error');
      toast('⚠ Backup created but unacknowledged — retry via Reconcile');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-first-backup-unacknowledged', { detail:{ createdGistId: newGistId, reason:'ack-fetch-failed' } })); } catch(_){}
      return { ok:false, reason:'ack-fetch-failed', createdGistId:newGistId, error:e.message };
    }
    if (ack.remoteHash !== localHash){
      setStatus('⚠ Created backup content does not match local — sync uncertain. A pending identity was recorded for recovery.', 'error');
      toast('⚠ Backup created but content mismatch');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-first-backup-unacknowledged', { detail:{ createdGistId: newGistId, reason:'ack-hash-mismatch' } })); } catch(_){}
      return { ok:false, reason:'ack-hash-mismatch', createdGistId:newGistId, ack };
    }

    let postLocal;
    try { postLocal = window.getAllBackupData(); }
    catch(e){
      setStatus('⚠ Cannot re-read local backup for post-create verification. Sync uncertain. A pending identity was recorded for recovery.', 'error');
      return { ok:false, reason:'post-local-read-failed', createdGistId:newGistId, error:e.message };
    }
    if (canonicalStringify(semanticBackupData(postLocal)) !== canonicalStringify(semanticBackupData(localData))){
      setStatus('⚠ Local data changed during backup creation — the created Gist reflects an earlier state. A pending identity was recorded for recovery.', 'warn');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-first-backup-unacknowledged', { detail:{ createdGistId: newGistId, reason:'local-changed-during-creation' } })); } catch(_){}
      return { ok:false, reason:'local-changed-during-creation', createdGistId:newGistId };
    }

    const idWrite = writeConnectedGistId(newGistId);
    if (!idWrite.ok){
      setStatus('⚠ Backup created but the connected ID could not be persisted (' + idWrite.reason + '). Pending identity kept for recovery.', 'error');
      return { ok:false, reason:idWrite.reason, createdGistId:newGistId, detail:idWrite };
    }
    const w = writeSyncBase({ gistId:newGistId, remoteVersion: ack.revision, baseDataHash: localHash });
    if (!w.ok){
      setStatus('Backup created and connected, but sync base could not be confirmed (' + w.reason + '). Pending identity kept for recovery.', 'warn');
      // ID-written-but-base-failed is intentionally fail-closed for overwrite
      // safety (Codex-confirmed). We DO NOT clear pending here.
      return { ok:false, reason:'unacknowledged', createdGistId:newGistId, detail:w };
    }
    // Only on full success: clear pending identity — it has been promoted.
    clearPendingCreatedGist();
    safeSet(LAST_SYNC_KEY, new Date().toISOString());
    safeSet(LAST_BACKUP_KEY, new Date().toISOString());
    safeSet(CHANGE_COUNT_KEY, '0');
    refreshUI();
    setStatus('✓ First backup Gist created and acknowledged.', 'ok');
    toast('✓ First backup created');
    return { ok:true, kind:'created-first-backup', gistId:newGistId, base:w.base };
  }

  // Recover a pending-created identity via an EXACT-ID GET. If the remote
  // Gist exists and its semantic content equals the caller's local backup,
  // promote it into connected + sync base. If it exists but content differs,
  // leave pending in place and expose an uncertain state (the user must
  // decide via existing Bootstrap Load/Use flows). If the exact-ID GET is
  // 404, the pending identity is stale (Gist deleted or never persisted
  // outside our scope) — remove it and permit a new POST.
  async function reconcilePendingCreated(){
    return _withCreateLock(() => _reconcilePendingCreatedInner());
  }
  async function _reconcilePendingCreatedInner(){
    const pending = readPendingCreatedGist();
    if (!pending) return { ok:true, kind:'no-pending' };
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;
    // Refuse if the user is already connected to a different Gist — that
    // combination is inconsistent and needs human resolution.
    const connectedId = safeGet(GIST_ID_KEY, '');
    if (connectedId && connectedId !== pending.gistId){
      return { ok:false, reason:'connected-elsewhere', pendingGistId: pending.gistId, connectedGistId: connectedId };
    }
    let remote;
    try { remote = await fetchConnectedGist(token, pending.gistId); }
    catch(e){
      if (e.status === 404){
        // Stale pending — safe to remove.
        clearPendingCreatedGist();
        return { ok:true, kind:'pending-cleared-404', priorPendingGistId: pending.gistId };
      }
      setStatus('⚠ Pending backup could not be re-read (' + (e.message || 'error') + ') — pending kept.', 'error');
      return { ok:false, reason:'reconcile-fetch-failed', pendingGistId: pending.gistId, error:e.message };
    }
    let localData, localHash;
    try {
      localData = await captureLocalBackup();
      localHash = await backupDataHash(localData);
    } catch(e){
      return { ok:false, reason:e.code || 'local-hash-failed', pendingGistId: pending.gistId, error:e.message };
    }
    if (remote.remoteHash !== localHash){
      // Real remote exists but content differs from local. Do NOT promote
      // silently. Keep pending; user should use Bootstrap flow to resolve.
      setStatus('The pending backup exists remotely but its content differs from local. Use Bootstrap to resolve.', 'warn');
      try { window.dispatchEvent(new CustomEvent('lifeos:gist-pending-created-diverged', { detail:{ gistId: pending.gistId } })); } catch(_){}
      return { ok:false, reason:'reconcile-diverged', pendingGistId: pending.gistId, remote };
    }
    // Content matches — safe to promote.
    const idWrite = writeConnectedGistId(pending.gistId);
    if (!idWrite.ok){
      setStatus('⚠ Pending backup content matches local, but the connected ID could not be persisted (' + idWrite.reason + ').', 'error');
      return { ok:false, reason:idWrite.reason, pendingGistId: pending.gistId, detail:idWrite };
    }
    const w = writeSyncBase({ gistId: pending.gistId, remoteVersion: remote.revision, baseDataHash: localHash });
    if (!w.ok){
      setStatus('Pending backup promoted, but sync base could not be confirmed (' + w.reason + '). Pending kept.', 'warn');
      return { ok:false, reason:'unacknowledged', pendingGistId: pending.gistId, detail:w };
    }
    clearPendingCreatedGist();
    safeSet(LAST_SYNC_KEY, new Date().toISOString());
    safeSet(LAST_BACKUP_KEY, new Date().toISOString());
    safeSet(CHANGE_COUNT_KEY, '0');
    refreshUI();
    setStatus('✓ Pending backup reconciled into connected sync state.', 'ok');
    toast('✓ Pending backup reconciled');
    return { ok:true, kind:'reconciled', gistId: pending.gistId, base:w.base };
  }

  // Explicit safe discard for the pending identity — used when the user
  // knowingly abandons the remote Gist (they will delete it externally).
  // Requires an in-memory confirm; NEVER clears silently.
  async function discardPendingCreated(options){
    options = options || {};
    const pending = readPendingCreatedGist();
    if (!pending) return { ok:true, kind:'no-pending' };
    const proceed = options.confirmed === true
      || (typeof window.confirm === 'function' && window.confirm(
        'Discard the pending backup Gist (' + pending.gistId.slice(0,12) + '…)?\n\nThis does not delete the Gist on GitHub — it only clears the local pending record.'
      ));
    if (!proceed) return { ok:false, reason:'cancelled-by-user' };
    clearPendingCreatedGist();
    return { ok:true, kind:'discarded', priorPendingGistId: pending.gistId };
  }

  // Bootstrap / reconnect: intentional discovery. Only path that may retarget
  // the connected gist. Not called by the ordinary Save/Load buttons.
  async function bootstrapOrReconnect(intent){
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason: pre.reason };
    const token = pre.token;
    const gists = await findBackupGistsForBootstrap(token).catch(e => ({ error:e }));
    if (gists && gists.error){
      setStatus('⚠ Cannot list Gists: ' + (gists.error.message || gists.error), 'error');
      return { ok:false, reason:'list-failed', error: gists.error.message };
    }
    if (!gists.length){
      setStatus('No backup Gist found for this token.', 'warn');
      return { ok:false, reason:'no-backup-gists' };
    }
    // Bootstrap chooses the newest matching Gist by updated_at. This is the
    // ONLY code path allowed to retarget the connected Gist automatically,
    // and it is only entered on explicit user intent.
    const picked = gists[0];
    let remote;
    try { remote = await fetchConnectedGist(token, picked.id); }
    catch(e){
      setStatus('⚠ Cannot read newest backup: ' + (e.message || 'error'), 'error');
      return { ok:false, reason:'bootstrap-fetch-failed', error: e.message };
    }
    // Persist and read back the chosen exact identity before it can own a base
    // or be reported connected.
    const idWrite = writeConnectedGistId(picked.id);
    if (!idWrite.ok){
      setStatus('⚠ Could not verify the connected backup ID (' + idWrite.reason + '). Nothing connected.', 'error');
      return { ok:false, reason:idWrite.reason, detail:idWrite };
    }
    // A prior base belongs to the previous connection. Diverged bootstrap
    // intentionally remains no-base until a dedicated resolver succeeds.
    clearSyncBase();
    let localData, localHash;
    try { localData = await captureLocalBackup(); localHash = await backupDataHash(localData); }
    catch(e){ setStatus('⚠ ' + e.message, 'error'); return { ok:false, reason:e.code || 'local-hash-failed', error: e.message }; }
    const changed = localSnapshotFailure(picked.id, localData);
    if (changed) return changed;
    if (localHash === remote.remoteHash){
      // Local already matches remote; write base and we're done.
      const w = writeSyncBase({ gistId: picked.id, remoteVersion: remote.revision, baseDataHash: remote.remoteHash });
      if (!w.ok){ setStatus('Connected, but sync status could not be confirmed (' + w.reason + ').', 'warn'); return { ok:false, reason:'unacknowledged', detail:w }; }
      setStatus('✓ Connected to backup — local already matches remote.', 'ok');
      refreshUI();
      return { ok:true, kind:'connected-identical' };
    }
    setStatus('Connected to backup ' + picked.id.slice(0,12) + '…. Local differs from remote — choose Load Remote or Use Local explicitly.', 'warn');
    refreshUI();
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-bootstrap-diverged', { detail:{ gistId:picked.id } })); } catch(_){}
    return { ok:true, kind:'connected-diverged', remote };
  }

  async function resolveBootstrapUseLocal(options){
    options = options || {};
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason:pre.reason };
    const token = pre.token;
    const gistId = safeGet(GIST_ID_KEY, '');
    if (!isValidIdentifier(gistId, 256)) return { ok:false, reason:'no-connected-gist' };
    if (effectiveBaseFor(gistId)) return { ok:false, reason:'bootstrap-base-already-present' };

    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      setStatus('⚠ Cannot read the selected backup before Use Local.', 'error');
      return { ok:false, reason:e.status === 404 ? 'connected-gist-not-found' : 'remote-fetch-failed', error:e.message };
    }
    let localData, localHash;
    try { localData = await captureLocalBackup(); localHash = await backupDataHash(localData); }
    catch(e){ return { ok:false, reason:e.code || 'local-hash-failed', error:e.message }; }

    const proceed = options.confirmed === true
      || (typeof window.confirm === 'function' && window.confirm(
        'Use Local for this newly connected backup?\n\nThis overwrites its current remote backup data after one final generation check.'
      ));
    if (!proceed){
      setStatus('Bootstrap Use Local cancelled — nothing overwritten.', 'warn');
      return { ok:false, reason:'cancelled-by-user' };
    }

    const audit = writePriorRemoteAudit(gistId, remote);
    if (!audit.ok){
      setStatus('⚠ Cannot preserve the prior remote revision (' + audit.reason + '). Use Local refused.', 'error');
      return { ok:false, reason:audit.reason, detail:audit };
    }
    const saved = await overwriteConnectedGist({ token, gistId, observedRemote:remote, localData, localHash });
    if (!saved.ok){
      setStatus(saved.reason === 'remote-changed-before-write'
        ? '⚠ Remote changed before Use Local could write. Nothing was overwritten; review and retry.'
        : '⚠ Bootstrap Use Local failed safely: ' + (saved.error || saved.reason),
      saved.reason === 'remote-changed-before-write' ? 'warn' : 'error');
      return saved;
    }
    safeSet(LAST_SYNC_KEY, new Date().toISOString());
    safeSet(LAST_BACKUP_KEY, new Date().toISOString());
    safeSet(CHANGE_COUNT_KEY, '0');
    refreshUI();
    setStatus('✓ Connected using local data; remote result verified.', 'ok');
    return { ok:true, kind:'bootstrap-use-local', base:saved.base };
  }

  async function resolveBootstrapLoadRemote(options){
    options = options || {};
    const pre = await preflightSyncEnvironment();
    if (!pre.ok) return { ok:false, reason:pre.reason };
    const token = pre.token;
    const gistId = safeGet(GIST_ID_KEY, '');
    if (!isValidIdentifier(gistId, 256)) return { ok:false, reason:'no-connected-gist' };
    if (effectiveBaseFor(gistId)) return { ok:false, reason:'bootstrap-base-already-present' };

    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404) markConnectedGistUnavailable(gistId);
      setStatus('⚠ Cannot read the selected backup before Load Remote.', 'error');
      return { ok:false, reason:e.status === 404 ? 'connected-gist-not-found' : 'remote-fetch-failed', error:e.message };
    }
    let localData, localHash;
    try { localData = await captureLocalBackup(); localHash = await backupDataHash(localData); }
    catch(e){ return { ok:false, reason:e.code || 'local-hash-failed', error:e.message }; }

    const preservation = preserveLocalExport(gistId, remote, localData, localHash, 'bootstrap-diverged');
    if (!preservation.ok){
      setStatus('⚠ Cannot preserve local recovery evidence (' + preservation.reason + '). Load Remote refused.', 'error');
      return preservation;
    }
    const proceed = options.confirmed === true
      || (typeof window.confirm === 'function' && window.confirm(
        'Load Remote for this newly connected backup?\n\nYour current local data has been preserved and will be replaced.'
      ));
    if (!proceed){
      setStatus('Bootstrap Load Remote cancelled — local data unchanged.', 'warn');
      return { ok:false, reason:'cancelled-by-user' };
    }

    const guard = await refetchBeforeOverwrite(token, gistId, remote);
    if (!guard.ok){
      const reason = guard.reason === 'remote-changed-before-write' ? 'remote-changed-before-load' : guard.reason;
      setStatus('⚠ Remote changed before Load Remote could begin. Local data was not imported; review and retry.', 'warn');
      return { ...guard, reason };
    }
    const loaded = await performDestructiveLoad({
      token, gistId, remote:guard.remote, localData, base:null, alreadyConfirmed:true
    });
    if (loaded.ok) setStatus('✓ Connected by loading the verified remote backup.', 'ok');
    return loaded.ok ? { ...loaded, kind:'bootstrap-load-remote' } : loaded;
  }

  // Restore UX: hand a capsule (current or _prev) through the safe
  // processImport path. Never writes bytes directly into Store.
  async function restorePreLoadRecovery(which){
    const key = which === 'prev' ? CAPSULE_PREV_KEY : CAPSULE_KEY;
    let raw;
    try { raw = localStorage.getItem(key); }
    catch(e){ toast('⚠ Cannot read recovery capsule'); return { ok:false, reason:'read-failed' }; }
    if (!raw){ toast('⚠ No recovery capsule available'); return { ok:false, reason:'absent' }; }
    // Ask processImport to run its own confirm dialog and full-state
    // transaction. It replaces the current capsule with the state that is
    // about to be overwritten; that fresh capsule is the immediate undo.
    let ok;
    try { ok = await window.processImport(raw); }
    catch(e){ toast('⚠ Restore failed: ' + (e.message || 'error')); return { ok:false, reason:'processImport-threw', error:e.message }; }
    if (!ok){ return { ok:false, reason:'cancelled-or-invalid' }; }
    if (which === 'prev'){
      try { localStorage.removeItem(CAPSULE_PREV_KEY); } catch(_){}
    }
    // After restore, sync base no longer reflects reality — clear it so the
    // next Sync operation goes through classification honestly.
    clearSyncBase();
    return { ok:true };
  }

  // ── public surface ───────────────────────────────────────────────────────
  const publicAPI = {
    // pure helpers
    canonicalStringify, canonicalHash, semanticBackupData, backupDataHash, sha256Available,
    validateSyncBaseRecord, parseSyncBase,
    readSyncBase, writeSyncBase, clearSyncBase, effectiveBaseFor, writeConnectedGistId,
    readConnectedGistId, hasStoredToken,
    classifyState, rotatePreLoadCapsule,
    // network
    fetchConnectedGist, patchConnectedGist, findBackupGistsForBootstrap, createBackupGistOnce,
    // discovery internals (tests)
    listAllGistsPaginated, parseLinkHeader,
    // pending-created identity (R2 B4)
    readPendingCreatedGist, writePendingCreatedGist, clearPendingCreatedGist,
    // orchestrators
    saveConnected, loadConnected, bootstrapOrReconnect, createFirstBackup, reconcilePendingCreated, discardPendingCreated,
    resolveBootstrapUseLocal, resolveBootstrapLoadRemote, restorePreLoadRecovery,
    // conflict resolvers (§A1 / §A2)
    resolveConflictKeepLocal, resolveConflictLoadRemote,
    readConflictExport, readPriorRemoteRevision,
    // constants (tests)
    _constants: Object.freeze({
      SYNC_BASE_KEY, SYNC_BASE_SCHEMA,
      CAPSULE_KEY, CAPSULE_PREV_KEY,
      GIST_ID_KEY, TOKEN_KEY, LAST_SYNC_KEY, LAST_BACKUP_KEY, CHANGE_COUNT_KEY, LEGACY_REMOTE_KEY,
      PRIOR_REMOTE_KEY, CONFLICT_EXPORT_KEY, PENDING_CREATED_KEY,
      CREATE_LOCK_NAME, MAX_DISCOVERY_PAGES,
      GIST_BACKUP_DESCRIPTION, BACKUP_FILE, BACKUP_WRAPPER_VERSION,
    }),
    // injection points
    _setFetch(fn){ _fetch = fn; },
    _setNow(fn){ _now = fn; },
    _resetInjections(){
      _fetch = (typeof fetch === 'function') ? fetch.bind(globalThis) : null;
      _now = () => new Date().toISOString();
    },
  };

  window.GistSync = publicAPI;

  // Overwrite the app.js window.saveToGist / window.loadFromGist so existing
  // callers (backup pill, Finance panel) route through the base-aware flow.
  // Retain the legacy Bootstrap-by-Gist-ID entry point as an explicit action.
  window.saveToGist = function(){ return saveConnected(); };
  window.loadFromGist = function(){ return loadConnected(); };
  window.gistBootstrap = function(){ return bootstrapOrReconnect('reconnect'); };
  window.gistCreateFirstBackup = function(){ return createFirstBackup(); };
  window.gistReconcilePendingCreated = function(){ return reconcilePendingCreated(); };
  window.gistDiscardPendingCreated = function(){ return discardPendingCreated(); };
  window.gistReadPendingCreated = function(){ return readPendingCreatedGist(); };
  window.gistBootstrapUseLocal = function(){ return resolveBootstrapUseLocal(); };
  window.gistBootstrapLoadRemote = function(){ return resolveBootstrapLoadRemote(); };
  window.restorePreLoadRecovery = function(which){ return restorePreLoadRecovery(which); };
  window.gistResolveKeepLocal = function(){ return resolveConflictKeepLocal(); };
  window.gistResolveLoadRemote = function(){ return resolveConflictLoadRemote(); };
})();
