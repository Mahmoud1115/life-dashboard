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

  const GIST_BACKUP_DESCRIPTION = 'Dune Life OS — Auto Backup';
  const BACKUP_FILE = 'dune-backup.json';
  const BACKUP_WRAPPER_VERSION = '2026.1';

  // ── injection points (tests use these) ───────────────────────────────────
  let _fetch = (typeof fetch === 'function') ? fetch.bind(globalThis) : null;
  let _now   = () => new Date().toISOString();

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

  // ── sync-base persistence ────────────────────────────────────────────────
  function readSyncBase(){
    let raw;
    try { raw = localStorage.getItem(SYNC_BASE_KEY); }
    catch(_) { return null; }
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch(_) { return null; }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.schema !== SYNC_BASE_SCHEMA) return null;
    if (typeof parsed.gistId !== 'string' || !parsed.gistId) return null;
    if (typeof parsed.remoteVersion !== 'string' || !parsed.remoteVersion) return null;
    if (typeof parsed.baseDataHash !== 'string' || !parsed.baseDataHash) return null;
    if (typeof parsed.acceptedAt !== 'string' || !parsed.acceptedAt) return null;
    return parsed;
  }

  function writeSyncBase(base){
    if (!base || typeof base !== 'object') return { ok:false, reason:'invalid-input' };
    if (typeof base.gistId !== 'string' || !base.gistId) return { ok:false, reason:'missing-gistId' };
    if (typeof base.remoteVersion !== 'string' || !base.remoteVersion) return { ok:false, reason:'missing-remoteVersion' };
    if (typeof base.baseDataHash !== 'string' || !base.baseDataHash) return { ok:false, reason:'missing-baseDataHash' };
    const payload = {
      schema: SYNC_BASE_SCHEMA,
      gistId: base.gistId,
      remoteVersion: base.remoteVersion,
      baseDataHash: base.baseDataHash,
      acceptedAt: base.acceptedAt || _now(),
    };
    let serialized;
    try { serialized = JSON.stringify(payload); }
    catch(e){ return { ok:false, reason:'serialize-failed', error:String(e && e.message || e) }; }
    try { localStorage.setItem(SYNC_BASE_KEY, serialized); }
    catch(e){ return { ok:false, reason:'setItem-failed', error:String(e && e.message || e) }; }
    // Read-back verification — do not report synced if we cannot prove persistence.
    let readback;
    try { readback = localStorage.getItem(SYNC_BASE_KEY); }
    catch(e){ return { ok:false, reason:'readback-getItem-failed', error:String(e && e.message || e) }; }
    if (!readback) return { ok:false, reason:'readback-empty' };
    let parsed;
    try { parsed = JSON.parse(readback); } catch(_){ return { ok:false, reason:'readback-parse-failed' }; }
    if (!parsed
        || parsed.gistId !== payload.gistId
        || parsed.remoteVersion !== payload.remoteVersion
        || parsed.baseDataHash !== payload.baseDataHash
        || parsed.schema !== SYNC_BASE_SCHEMA){
      return { ok:false, reason:'readback-mismatch' };
    }
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-sync-base-updated', { detail: parsed })); } catch(_){}
    return { ok:true, base: parsed };
  }

  function clearSyncBase(){
    try { localStorage.removeItem(SYNC_BASE_KEY); } catch(_){}
    try { window.dispatchEvent(new CustomEvent('lifeos:gist-sync-base-cleared')); } catch(_){}
  }

  // Ownership: the base must belong to the currently connected Gist.
  function effectiveBaseFor(gistId){
    const b = readSyncBase();
    if (!b) return null;
    if (b.gistId !== gistId) return null;
    return b;
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
    const remoteHash = await canonicalHash(data);
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

  async function findBackupGistsForBootstrap(token){
    if (!_fetch) throw new Error('FETCH_UNAVAILABLE');
    const res = await _fetch('https://api.github.com/gists?per_page=100', {
      headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' }
    });
    if (!res.ok){
      const err = new Error('GIST_LIST_FAILED'); err.status = res.status; throw err;
    }
    const gists = await res.json();
    return (gists || [])
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

  function safeGet(key, dflt){
    try { const v = localStorage.getItem(key); return v === null ? dflt : v; }
    catch(_){ return dflt; }
  }
  function safeSet(key, val){
    try { localStorage.setItem(key, val); return true; } catch(_){ return false; }
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
      setStatus('No connected backup yet. Use Bootstrap/Connect to establish one.', 'warn');
      toast('⚠ Not connected to a backup — connect first');
      return { ok:false, reason:'no-connected-gist' };
    }
    setStatus('Checking the connected backup…');

    // Compute local semantic identity
    let localData, localHash;
    try {
      localData = window.getAllBackupData();
      localHash = await canonicalHash(localData);
    } catch(e){
      setStatus('⚠ Cannot hash local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:'local-hash-failed' };
    }

    // Fetch remote for the EXACT connected gist — no discovery retargeting
    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404){
        setStatus('⚠ Connected backup not found — reconnect required. No data changed.', 'error');
        toast('⚠ Connected backup not found');
        return { ok:false, reason:'connected-gist-not-found' };
      }
      setStatus('⚠ ' + (e.message || 'Network error'), 'error');
      return { ok:false, reason:'remote-fetch-failed', error: e.message };
    }

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
        return { ok:false, reason:'conflict', state, remote, localHash };

      case 'no-base':
        setStatus('⚠ ' + labelFor(state) + ' Bootstrap required before Save.', 'warn');
        toast('⚠ Sync history missing — reconnect');
        return { ok:false, reason:'no-base', remote, localHash };

      case 'local-only':
      case 'converged': {
        setStatus('Saving to the connected backup…');
        const backup = { version: BACKUP_WRAPPER_VERSION, exported_at: _now(), data: localData };
        try { await patchConnectedGist(token, gistId, backup); }
        catch(e){
          const msg = e.status === 401 || e.status === 403 || e.status === 404
            ? 'Token can\'t access this Gist — check the "gist" scope.'
            : (e.message || 'PATCH failed');
          setStatus('⚠ ' + msg, 'error');
          return { ok:false, reason:'patch-failed', error: e.message };
        }
        // Reread for acknowledgement — semantic hash + revision.
        let reread;
        try { reread = await fetchConnectedGist(token, gistId); }
        catch(e){
          setStatus('Save uploaded, but sync status could not be confirmed (reread failed).', 'warn');
          return { ok:false, reason:'reread-failed', error: e.message };
        }
        if (reread.remoteHash !== localHash){
          clearSyncBase();
          setStatus('⚠ Save uploaded but remote content does not match what was sent — sync trust cleared, reconnect required.', 'error');
          return { ok:false, reason:'reread-hash-mismatch', reread };
        }
        const w = writeSyncBase({ gistId, remoteVersion: reread.revision, baseDataHash: localHash });
        if (!w.ok){
          setStatus('Save completed, but sync status could not be confirmed (' + w.reason + '). Reconnect to refresh sync history.', 'warn');
          return { ok:false, reason:'unacknowledged', detail:w };
        }
        // Display metadata (never authoritative)
        safeSet(LAST_SYNC_KEY, new Date().toISOString());
        safeSet(LAST_BACKUP_KEY, new Date().toISOString());
        safeSet(CHANGE_COUNT_KEY, '0');
        refreshUI();
        setStatus('✓ Saved to the connected backup.', 'ok');
        toast('✓ Saved to GitHub Gist');
        return { ok:true, kind:'saved', base:w.base };
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
      setStatus('No connected backup yet. Use Bootstrap/Connect to establish one.', 'warn');
      toast('⚠ Not connected to a backup — connect first');
      return { ok:false, reason:'no-connected-gist' };
    }
    setStatus('Checking the connected backup…');

    let localData, localHash;
    try {
      localData = window.getAllBackupData();
      localHash = await canonicalHash(localData);
    } catch(e){
      setStatus('⚠ Cannot hash local backup: ' + (e.message || e), 'error');
      return { ok:false, reason:'local-hash-failed' };
    }

    let remote;
    try { remote = await fetchConnectedGist(token, gistId); }
    catch(e){
      if (e.status === 404){
        setStatus('⚠ Connected backup not found — reconnect required. No data changed.', 'error');
        toast('⚠ Connected backup not found');
        return { ok:false, reason:'connected-gist-not-found' };
      }
      setStatus('⚠ ' + (e.message || 'Network error'), 'error');
      return { ok:false, reason:'remote-fetch-failed', error:e.message };
    }

    const base = effectiveBaseFor(gistId);
    const state = classifyState({ localHash, remoteHash: remote.remoteHash, remoteVersion: remote.revision, base });

    switch (state.kind){
      case 'synced':
      case 'converged':
        setStatus('✓ Already in sync — nothing to load.', 'ok');
        return { ok:true, kind:'noop' };

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
  // Failure BEFORE processImport → zero destructive mutation.
  async function performDestructiveLoad({ token, gistId, remote, localData, base }){
    // 1. Rotate recovery generation. Hard gate — refuse Load on any failure.
    const rot = rotatePreLoadCapsule();
    if (!rot.ok){
      setStatus('⚠ Cannot begin Load — recovery generation could not be preserved (' + rot.reason + '). No data changed.', 'error');
      toast('⚠ Recovery preservation failed — Load refused');
      return { ok:false, reason:'recovery-rotation-failed', detail: rot };
    }

    // 2. Invoke processImport with the exact remote content text.
    let imported;
    try { imported = await window.processImport(remote.remoteContentText); }
    catch(e){
      setStatus('⚠ Import failed — ' + (e.message || 'unknown'), 'error');
      return { ok:false, reason:'processImport-threw', error: e.message };
    }
    if (!imported){
      // User cancelled inside processImport, or validation refused. No mutation
      // per processImport's own contract.
      setStatus('Load cancelled — nothing changed.', 'warn');
      return { ok:false, reason:'cancelled-or-invalid' };
    }

    // 3. Verify imported semantic hash matches what we thought we were loading.
    let importedHash;
    try { importedHash = await canonicalHash(window.getAllBackupData()); }
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
    // Adopt remote's identity but do NOT overwrite local data — user still
    // needs to explicitly Load if they want to replace local state.
    safeSet(GIST_ID_KEY, picked.id);
    const localData = window.getAllBackupData();
    let localHash;
    try { localHash = await canonicalHash(localData); }
    catch(e){ return { ok:false, reason:'local-hash-failed', error: e.message }; }
    if (localHash === remote.remoteHash){
      // Local already matches remote; write base and we're done.
      const w = writeSyncBase({ gistId: picked.id, remoteVersion: remote.revision, baseDataHash: remote.remoteHash });
      if (!w.ok){ setStatus('Connected, but sync status could not be confirmed (' + w.reason + ').', 'warn'); return { ok:false, reason:'unacknowledged', detail:w }; }
      setStatus('✓ Connected to backup — local already matches remote.', 'ok');
      refreshUI();
      return { ok:true, kind:'connected-identical' };
    }
    setStatus('Connected to backup ' + picked.id.slice(0,12) + '…. Local differs from remote — choose Load Remote or Save Local explicitly.', 'warn');
    refreshUI();
    return { ok:true, kind:'connected-diverged', remote };
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
    // transaction. On success, we clear the just-used capsule but retain
    // the other generation.
    let ok;
    try { ok = await window.processImport(raw); }
    catch(e){ toast('⚠ Restore failed: ' + (e.message || 'error')); return { ok:false, reason:'processImport-threw', error:e.message }; }
    if (!ok){ return { ok:false, reason:'cancelled-or-invalid' }; }
    try { localStorage.removeItem(key); } catch(_){}
    // After restore, sync base no longer reflects reality — clear it so the
    // next Sync operation goes through classification honestly.
    clearSyncBase();
    return { ok:true };
  }

  // ── public surface ───────────────────────────────────────────────────────
  const publicAPI = {
    // pure helpers
    canonicalStringify, canonicalHash, sha256Available,
    readSyncBase, writeSyncBase, clearSyncBase, effectiveBaseFor,
    classifyState, rotatePreLoadCapsule,
    // network
    fetchConnectedGist, patchConnectedGist, findBackupGistsForBootstrap,
    // orchestrators
    saveConnected, loadConnected, bootstrapOrReconnect, restorePreLoadRecovery,
    // constants (tests)
    _constants: Object.freeze({
      SYNC_BASE_KEY, SYNC_BASE_SCHEMA,
      CAPSULE_KEY, CAPSULE_PREV_KEY,
      GIST_ID_KEY, TOKEN_KEY, LAST_SYNC_KEY, LAST_BACKUP_KEY, CHANGE_COUNT_KEY, LEGACY_REMOTE_KEY,
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
  window.restorePreLoadRecovery = function(which){ return restorePreLoadRecovery(which); };
})();
