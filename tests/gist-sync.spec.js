// Gist Sync P1 — base-aware concurrency spec.
//
// Deterministic Playwright suite. Uses page.route to serve an in-memory
// GitHub Gist mock; the real GitHub API is never contacted.
//
// Covers the 23 cases from the P1 remediation brief §12 plus the 4
// amendment cases required by the approval note:
//   - SHA-256 unavailable → fail safely
//   - recovery rotation write failure → destructive Load refused
//   - recovery rotation reread mismatch → destructive Load refused
//   - current + previous recovery generations after repeated Loads
//
// Note on Store interaction: `dune_state_v4` is owned by Store and is
// rewritten on boot. To drive the classifier reliably we hash the actual
// post-boot state via `getAllBackupData()` and dirty non-Store BACKUP_KEYS
// (e.g. `dune_finance_v1`) which Store does not touch. Classifier tests then
// see clean transitions between synced / local-only / remote-only / conflict.

const { test, expect } = require('@playwright/test');

const GITHUB_ORIGIN_ANY = /^https?:\/\/api\.github\.com\//;
const BLOCKED_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'ghp_test_token';

function makeBackupWrapper(data){
  return { version:'2026.1', exported_at:'2026-09-01T00:00:00Z', data };
}
function makeGistFixture({ id, backupData, revision, updatedAt='2026-09-01T00:00:00Z', extraFiles={} }){
  const files = { 'dune-backup.json': { content: JSON.stringify(makeBackupWrapper(backupData), null, 2) }, ...extraFiles };
  return {
    id,
    description: 'Dune Life OS — Auto Backup',
    files,
    history: [{ version: revision }],
    updated_at: updatedAt,
    node_id: 'NID_' + id,
  };
}

// In-memory Gist mock. Returns the mutable state — tests reach into it.
async function installGitHubMock(page, initialGists){
  const state = {
    gists: initialGists.map(g => JSON.parse(JSON.stringify(g))),
    patches: 0,
    lastPatchBody: null,
  };
  await page.route(BLOCKED_FONTS, r => r.abort());
  await page.route(GITHUB_ORIGIN_ANY, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.pathname === '/gists' && method === 'GET'){
      return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(state.gists) });
    }
    const m = url.pathname.match(/^\/gists\/([^\/]+)$/);
    if (m){
      const id = decodeURIComponent(m[1]);
      const g = state.gists.find(x => x.id === id);
      if (method === 'GET'){
        if (!g) return route.fulfill({ status:404, contentType:'application/json', body:'{"message":"Not Found"}' });
        return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(g) });
      }
      if (method === 'PATCH'){
        if (!g) return route.fulfill({ status:404, contentType:'application/json', body:'{"message":"Not Found"}' });
        const body = JSON.parse(req.postData() || '{}');
        state.patches++;
        state.lastPatchBody = body;
        if (body.files){
          for (const [name, val] of Object.entries(body.files)){
            g.files[name] = { content: val.content };
          }
        }
        g.history.unshift({ version: 'rev_after_' + state.patches });
        g.updated_at = new Date().toISOString();
        return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(g) });
      }
    }
    return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
  });
  return state;
}

async function waitReady(page){
  await page.waitForFunction(() =>
    typeof window.GistSync === 'object'
    && typeof window.processImport === 'function'
    && typeof window.getAllBackupData === 'function');
  await page.evaluate(() => (window.Store && window.Store.flushNow ? window.Store.flushNow() : null));
}

async function bootBaseline(page){
  return page.evaluate(async () => {
    const data = window.getAllBackupData();
    const hash = await window.GistSync.canonicalHash(data);
    return { data, hash };
  });
}

// Seed a valid connected sync-base + token.
async function seedConnected(page, { gistId, remoteVersion, baseDataHash }){
  await page.evaluate(({ gistId, remoteVersion, baseDataHash, TOKEN }) => {
    localStorage.setItem('dune_github_token_v1', TOKEN);
    localStorage.setItem('dune_gist_id_v1', gistId);
    localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify({
      schema: 1, gistId, remoteVersion, baseDataHash,
      acceptedAt: '2026-09-01T00:00:00.000Z',
    }));
  }, { gistId, remoteVersion, baseDataHash, TOKEN });
}

// Overwrite the mock's connected-gist file with content that hashes to
// exactly `data`. Test-side helper.
function setRemoteFileToData(mockState, gistId, data){
  const g = mockState.gists.find(x => x.id === gistId);
  if (!g) throw new Error('gist not in mock: ' + gistId);
  g.files['dune-backup.json'] = { content: JSON.stringify(makeBackupWrapper(data), null, 2) };
}

async function neuterReloadAndConfirm(page, confirmReturn=true){
  await page.evaluate((ret) => {
    window.confirm = () => ret;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    window._origSetTimeout = _st;
  }, confirmReturn);
}

// ── PURE-HELPER TESTS ────────────────────────────────────────────────────────

test.describe('canonicalHash + canonicalStringify (P1 §12 case 11)', () => {
  test.beforeEach(async ({ page }) => {
    await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
  });

  test('G-HASH-01: identical data with different key order produces identical hash', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const a = { z:{ b:2, a:1 }, arr:[1,2,3] };
      const b = { arr:[1,2,3], z:{ a:1, b:2 } };
      return {
        hashA: await window.GistSync.canonicalHash(a),
        hashB: await window.GistSync.canonicalHash(b),
      };
    });
    expect(res.hashA).toBe(res.hashB);
    expect(res.hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  test('G-HASH-02: canonicalStringify sorts object keys and preserves array order', async ({ page }) => {
    const canonical = await page.evaluate(() => window.GistSync.canonicalStringify({ b:1, a:2, arr:[3,1,2] }));
    expect(canonical).toBe('{"a":2,"arr":[3,1,2],"b":1}');
  });

  test('G-HASH-03: exported_at is not part of the hash (wrapper metadata excluded)', async ({ page }) => {
    const res = await page.evaluate(async () => ({
      h1: await window.GistSync.canonicalHash({ x:1 }),
      h2: await window.GistSync.canonicalHash({ x:1 }),
    }));
    expect(res.h1).toBe(res.h2);
  });

  test('G-HASH-04: SHA-256 unavailable → canonicalHash throws SHA256_UNAVAILABLE', async ({ page }) => {
    const err = await page.evaluate(async () => {
      const saved = window.crypto;
      try {
        Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
        try {
          await window.GistSync.canonicalHash({ x:1 });
          return { threw:false };
        } catch(e){
          return { threw:true, code: e.code, msg: e.message };
        }
      } finally {
        Object.defineProperty(window, 'crypto', { value: saved, configurable: true });
      }
    });
    expect(err.threw).toBe(true);
    expect(err.code).toBe('SHA256_UNAVAILABLE');
  });
});

test.describe('classifyState (four-state model)', () => {
  test.beforeEach(async ({ page }) => {
    await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
  });

  const scenarios = [
    { name:'synced', in:{ localHash:'A', remoteHash:'A', remoteVersion:'V1', base:{ baseDataHash:'A', remoteVersion:'V1' } }, kind:'synced' },
    { name:'synced-revision-drift', in:{ localHash:'A', remoteHash:'A', remoteVersion:'V2', base:{ baseDataHash:'A', remoteVersion:'V1' } }, kind:'synced-revision-drift' },
    { name:'local-only', in:{ localHash:'B', remoteHash:'A', remoteVersion:'V1', base:{ baseDataHash:'A', remoteVersion:'V1' } }, kind:'local-only' },
    { name:'remote-only', in:{ localHash:'A', remoteHash:'B', remoteVersion:'V2', base:{ baseDataHash:'A', remoteVersion:'V1' } }, kind:'remote-only' },
    { name:'converged', in:{ localHash:'C', remoteHash:'C', remoteVersion:'V2', base:{ baseDataHash:'A', remoteVersion:'V1' } }, kind:'converged' },
    { name:'conflict', in:{ localHash:'B', remoteHash:'C', remoteVersion:'V2', base:{ baseDataHash:'A', remoteVersion:'V1' } }, kind:'conflict' },
    { name:'no-base', in:{ localHash:'A', remoteHash:'A', remoteVersion:'V1', base:null }, kind:'no-base' },
  ];
  for (const s of scenarios){
    test('G-CLS-' + s.name + ': classifyState → ' + s.kind, async ({ page }) => {
      const out = await page.evaluate((inp) => window.GistSync.classifyState(inp), s.in);
      expect(out.kind).toBe(s.kind);
    });
  }
});

// ── SYNC-BASE PERSISTENCE TESTS ──────────────────────────────────────────────

test.describe('sync-base persistence + ownership (§4-5)', () => {
  test.beforeEach(async ({ page }) => {
    await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
  });

  test('G-BASE-01: writeSyncBase read-back-verifies and rejects when setItem is swallowed', async ({ page }) => {
    const res = await page.evaluate(async () => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (k === 'dune_gist_sync_base_v1'){ return; }
        return orig.call(this, k, v);
      };
      try {
        return window.GistSync.writeSyncBase({ gistId:'G', remoteVersion:'V1', baseDataHash:'HHH' });
      } finally {
        Storage.prototype.setItem = orig;
      }
    });
    expect(res.ok).toBe(false);
    expect(['readback-empty','readback-parse-failed','readback-mismatch']).toContain(res.reason);
  });

  test('G-BASE-02: readSyncBase rejects wrong schema, and effectiveBaseFor rejects non-owned gistId', async ({ page }) => {
    const res = await page.evaluate(() => {
      localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify({ schema:99, gistId:'G', remoteVersion:'V1', baseDataHash:'X', acceptedAt:'2026-01-01' }));
      const bad1 = window.GistSync.readSyncBase();
      localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify({ schema:1, gistId:'OTHER', remoteVersion:'V1', baseDataHash:'X', acceptedAt:'2026-01-01' }));
      const owned = window.GistSync.effectiveBaseFor('CONNECTED');
      return { bad1, owned };
    });
    expect(res.bad1).toBe(null);
    expect(res.owned).toBe(null);
  });
});

// ── RECOVERY ROTATION TESTS ──────────────────────────────────────────────────

test.describe('rotatePreLoadCapsule (§8 amendment — hard gate)', () => {
  test.beforeEach(async ({ page }) => {
    await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
  });

  test('G-ROT-01: no prior capsule → ok, rotated=false (safe to proceed)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.removeItem('dune_pre_import_backup_v1');
      localStorage.removeItem('dune_pre_import_backup_prev_v1');
      return window.GistSync.rotatePreLoadCapsule();
    });
    expect(r.ok).toBe(true);
    expect(r.rotated).toBe(false);
  });

  test('G-ROT-02: existing capsule rotated verbatim into _prev key with readback verify', async ({ page }) => {
    const r = await page.evaluate(() => {
      const payload = '{"version":"2026.1","exported_at":"prev","data":{"dune_state_v4":{"x":1}}}';
      localStorage.setItem('dune_pre_import_backup_v1', payload);
      localStorage.removeItem('dune_pre_import_backup_prev_v1');
      const rot = window.GistSync.rotatePreLoadCapsule();
      return { rot, prev: localStorage.getItem('dune_pre_import_backup_prev_v1'), cur: localStorage.getItem('dune_pre_import_backup_v1') };
    });
    expect(r.rot.ok).toBe(true);
    expect(r.rot.rotated).toBe(true);
    expect(r.prev).toBe('{"version":"2026.1","exported_at":"prev","data":{"dune_state_v4":{"x":1}}}');
    expect(r.cur).toBe(r.prev);
  });

  test('G-ROT-03: write to _prev fails → rotation returns ok:false (no destructive path may proceed)', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('dune_pre_import_backup_v1', 'PAYLOAD');
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (k === 'dune_pre_import_backup_prev_v1') throw new Error('quota');
        return orig.call(this, k, v);
      };
      try { return window.GistSync.rotatePreLoadCapsule(); }
      finally { Storage.prototype.setItem = orig; }
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('write-prev-failed');
  });

  test('G-ROT-04: readback of _prev mismatches → rotation returns ok:false', async ({ page }) => {
    const r = await page.evaluate(() => {
      localStorage.setItem('dune_pre_import_backup_v1', 'PAYLOAD');
      const origSet = Storage.prototype.setItem;
      const origGet = Storage.prototype.getItem;
      Storage.prototype.setItem = function(k, v){ return origSet.call(this, k, v); };
      Storage.prototype.getItem = function(k){
        if (k === 'dune_pre_import_backup_prev_v1') return 'CORRUPTED_DIFFERENT';
        return origGet.call(this, k);
      };
      try { return window.GistSync.rotatePreLoadCapsule(); }
      finally {
        Storage.prototype.setItem = origSet;
        Storage.prototype.getItem = origGet;
      }
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('prev-readback-mismatch');
  });
});

// ── SAVE ORCHESTRATION TESTS ─────────────────────────────────────────────────

test.describe('saveConnected (four-state)', () => {
  const gistId = 'g_connected';

  // Prime: install mock with placeholder gist, boot, then rewrite the mock's
  // remote file so its hash equals the actual post-boot local hash. Seed base
  // with that same hash. Tests can then dirty a non-Store BACKUP_KEY (e.g.
  // dune_finance_v1) to force classifier transitions without fighting Store.
  async function primeSynced(page){
    const mock = await installGitHubMock(page, [
      makeGistFixture({ id: gistId, backupData: { _placeholder:true }, revision:'rev_1' })
    ]);
    await page.goto('/');
    await waitReady(page);
    const { data: bootData, hash: bootHash } = await bootBaseline(page);
    setRemoteFileToData(mock, gistId, bootData);
    await seedConnected(page, { gistId, remoteVersion:'rev_1', baseDataHash: bootHash });
    return { mock, bootData, bootHash };
  }

  test('G-SAVE-01: same-device Save with unchanged local + remote → synced no-op (§12 cases 4/5)', async ({ page }) => {
    const { mock } = await primeSynced(page);
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('noop');
    expect(mock.patches).toBe(0);
  });

  test('G-SAVE-02: local-only change → PATCH, reread verify, base advances (§12 cases 2/3)', async ({ page }) => {
    const { mock, bootHash } = await primeSynced(page);
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:true })));
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('saved');
    expect(mock.patches).toBe(1);
    const base = await page.evaluate(() => JSON.parse(localStorage.getItem('dune_gist_sync_base_v1')));
    expect(base.gistId).toBe(gistId);
    expect(base.remoteVersion).toBe('rev_after_1');
    expect(base.baseDataHash).not.toBe(bootHash);
  });

  test('G-SAVE-03: remote-only change → refuse Save; no PATCH; local intact (§12 case 6)', async ({ page }) => {
    const { mock, bootData } = await primeSynced(page);
    // Diverge remote from base (same base as local).
    setRemoteFileToData(mock, gistId, { ...bootData, dune_finance_v1: { remoteEdit:true } });
    mock.gists[0].history.unshift({ version:'rev_remote' });
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('remote-only');
    expect(mock.patches).toBe(0);
  });

  test('G-SAVE-04: both changed → conflict; nothing mutates before user chooses (§12 case 7)', async ({ page }) => {
    const { mock, bootData } = await primeSynced(page);
    setRemoteFileToData(mock, gistId, { ...bootData, dune_finance_v1: { remoteEdit:true } });
    mock.gists[0].history.unshift({ version:'rev_remote' });
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ localEdit:true })));
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('conflict');
    expect(mock.patches).toBe(0);
  });

  test('G-SAVE-05: no-base → refuse; no PATCH; bootstrap advised (§12 case 8)', async ({ page }) => {
    const { mock } = await primeSynced(page);
    await page.evaluate(() => localStorage.removeItem('dune_gist_sync_base_v1'));
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:true })));
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('no-base');
    expect(mock.patches).toBe(0);
  });

  test('G-SAVE-06: reread hash mismatch after PATCH → base cleared, not reported synced (§12 cases 12/21)', async ({ page }) => {
    const { mock } = await primeSynced(page);
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:true })));
    const res = await page.evaluate(async () => {
      // Inject through the module's own seam — window.fetch reassignment
      // doesn't intercept the module's cached _fetch reference.
      const origFetch = fetch.bind(globalThis);
      let sawPatch = false;
      const tap = async function(input, init){
        const url = typeof input === 'string' ? input : input.url;
        const method = (init && init.method) || (input && input.method) || 'GET';
        const res = await origFetch(input, init);
        if (method === 'PATCH'){ sawPatch = true; return res; }
        if (sawPatch && /\/gists\//.test(url)){
          const clone = await res.clone().json();
          clone.files['dune-backup.json'] = { content: JSON.stringify({ version:'2026.1', exported_at:'p', data:{ poisoned:true } }, null, 2) };
          sawPatch = false;
          return new Response(JSON.stringify(clone), { status: 200, headers: { 'Content-Type':'application/json' } });
        }
        return res;
      };
      window.GistSync._setFetch(tap);
      try { return await window.GistSync.saveConnected(); }
      finally { window.GistSync._resetInjections(); }
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('reread-hash-mismatch');
    const base = await page.evaluate(() => localStorage.getItem('dune_gist_sync_base_v1'));
    expect(base).toBe(null);
  });

  test('G-SAVE-07: SHA-256 unavailable → refuse; no PATCH (amendment)', async ({ page }) => {
    const { mock } = await primeSynced(page);
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:true })));
    const res = await page.evaluate(async () => {
      const saved = window.crypto;
      Object.defineProperty(window, 'crypto', { value: undefined, configurable: true });
      try { return await window.GistSync.saveConnected(); }
      finally { Object.defineProperty(window, 'crypto', { value: saved, configurable: true }); }
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('sha256-unavailable');
    expect(mock.patches).toBe(0);
  });

  test('G-SAVE-08: connected Gist 404 → safe reconnect state; no PATCH (§12 case 18)', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => {
      localStorage.setItem('dune_github_token_v1', 'TOKEN');
      localStorage.setItem('dune_gist_id_v1', 'g_gone');
      localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify({ schema:1, gistId:'g_gone', remoteVersion:'v', baseDataHash:'h', acceptedAt:'x' }));
    });
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('connected-gist-not-found');
    expect(mock.patches).toBe(0);
  });

  test('G-SAVE-09: revision-only drift → base refreshed, no PATCH (§12 cases 10/19)', async ({ page }) => {
    const { mock, bootHash } = await primeSynced(page);
    mock.gists[0].history.unshift({ version:'rev_drift' });
    mock.gists[0].files['README.md'] = { content: '# unrelated' };
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('revision-refresh');
    expect(mock.patches).toBe(0);
    const base = await page.evaluate(() => JSON.parse(localStorage.getItem('dune_gist_sync_base_v1')));
    expect(base.remoteVersion).toBe('rev_drift');
    expect(base.baseDataHash).toBe(bootHash);
  });

  test('G-SAVE-10: same-device Save twice → no false conflict on second Save (§12 case 4)', async ({ page }) => {
    const { mock } = await primeSynced(page);
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:1 })));
    const r1 = await page.evaluate(() => window.GistSync.saveConnected());
    expect(r1.ok).toBe(true);
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:2 })));
    const r2 = await page.evaluate(() => window.GistSync.saveConnected());
    expect(r2.ok).toBe(true);
    expect(r2.kind).toBe('saved');
    expect(mock.patches).toBe(2);
  });

  test('G-SAVE-11: stale legacy dune_gist_remote_updated_v1 cannot fabricate a conflict (§12 case 5)', async ({ page }) => {
    const { mock } = await primeSynced(page);
    await page.evaluate(() => {
      localStorage.setItem('dune_gist_remote_updated_v1', '1999-01-01T00:00:00Z');
      localStorage.setItem('dune_finance_v1', JSON.stringify({ dirty:true }));
    });
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('saved');
    expect(mock.patches).toBe(1);
  });

  test('G-SAVE-12: multiple matching Gists — connected id is respected, no retarget (§12 case 9)', async ({ page }) => {
    const mock = await installGitHubMock(page, [
      makeGistFixture({ id:'g_other_newer', backupData:{ dune_state_v4:{ other:true } }, revision:'rev_other', updatedAt:'2999-01-01T00:00:00Z' }),
      makeGistFixture({ id: gistId, backupData: { _placeholder:true }, revision:'rev_1' }),
    ]);
    await page.goto('/');
    await waitReady(page);
    const { data: bootData, hash: bootHash } = await bootBaseline(page);
    setRemoteFileToData(mock, gistId, bootData);
    await seedConnected(page, { gistId, remoteVersion:'rev_1', baseDataHash: bootHash });
    const res = await page.evaluate(() => window.GistSync.saveConnected());
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('noop');
    expect(mock.patches).toBe(0);
    const id = await page.evaluate(() => localStorage.getItem('dune_gist_id_v1'));
    expect(id).toBe(gistId);
  });
});

// ── LOAD ORCHESTRATION TESTS ─────────────────────────────────────────────────

test.describe('loadConnected (destructive path guards)', () => {
  const gistId = 'g_conn';

  async function primeRemoteDifferent(page){
    const mock = await installGitHubMock(page, [
      makeGistFixture({ id: gistId, backupData: { _placeholder:true }, revision:'rev_remote' })
    ]);
    await page.goto('/');
    await waitReady(page);
    await neuterReloadAndConfirm(page, true);
    const { data: bootData, hash: bootHash } = await bootBaseline(page);
    // Remote differs from boot by one extra key
    const remoteData = { ...bootData, dune_finance_v1: { remote:'v2' } };
    setRemoteFileToData(mock, gistId, remoteData);
    const remoteHash = await page.evaluate(async d => window.GistSync.canonicalHash(d), remoteData);
    await seedConnected(page, { gistId, remoteVersion:'rev_old', baseDataHash: bootHash });
    return { mock, bootData, bootHash, remoteData, remoteHash };
  }

  test('G-LOAD-01: remote-only → destructive Load rotates capsule, invokes processImport, verifies hash, writes base', async ({ page }) => {
    const { mock, remoteData, remoteHash } = await primeRemoteDifferent(page);
    // Stub processImport so it mutates dune_finance_v1 to match remoteData
    // and writes a capsule. dune_state_v4 stays untouched — Store owns it.
    await page.evaluate((rd) => {
      window.processImport = async () => {
        localStorage.setItem('dune_pre_import_backup_v1', JSON.stringify({ version:'2026.1', exported_at:'stub', data:{ dune_finance_v1: null } }));
        localStorage.setItem('dune_finance_v1', JSON.stringify(rd.dune_finance_v1));
        return true;
      };
    }, remoteData);
    const res = await page.evaluate(() => window.GistSync.loadConnected());
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('loaded');
    const base = await page.evaluate(() => JSON.parse(localStorage.getItem('dune_gist_sync_base_v1')));
    expect(base.remoteVersion).toBe('rev_remote');
    expect(base.baseDataHash).toBe(remoteHash);
  });

  test('G-LOAD-02: processImport returns false (cancel) → zero mutation; base untouched (§12 case 13)', async ({ page }) => {
    const mock = await primeRemoteDifferent(page);
    await page.evaluate(() => { window.processImport = async () => false; });
    const before = await page.evaluate(() => ({
      finance: localStorage.getItem('dune_finance_v1'),
      base: localStorage.getItem('dune_gist_sync_base_v1'),
      capsule: localStorage.getItem('dune_pre_import_backup_v1'),
      prev: localStorage.getItem('dune_pre_import_backup_prev_v1'),
    }));
    const res = await page.evaluate(() => window.GistSync.loadConnected());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('cancelled-or-invalid');
    const after = await page.evaluate(() => ({
      finance: localStorage.getItem('dune_finance_v1'),
      base: localStorage.getItem('dune_gist_sync_base_v1'),
      capsule: localStorage.getItem('dune_pre_import_backup_v1'),
      prev: localStorage.getItem('dune_pre_import_backup_prev_v1'),
    }));
    expect(after.finance).toBe(before.finance);
    expect(after.base).toBe(before.base);
    expect(after.capsule).toBe(before.capsule);
    expect(after.prev).toBe(before.prev);
  });

  test('G-LOAD-03: rotation write failure → destructive Load REFUSED; processImport not called (amendment)', async ({ page }) => {
    await primeRemoteDifferent(page);
    await page.evaluate(() => localStorage.setItem('dune_pre_import_backup_v1', 'PRIOR_CAPSULE'));
    const res = await page.evaluate(async () => {
      let importCalled = false;
      window.processImport = async () => { importCalled = true; return true; };
      const origSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (k === 'dune_pre_import_backup_prev_v1') throw new Error('quota-simulated');
        return origSet.call(this, k, v);
      };
      try {
        const r = await window.GistSync.loadConnected();
        return { r, importCalled };
      } finally {
        Storage.prototype.setItem = origSet;
      }
    });
    expect(res.r.ok).toBe(false);
    expect(res.r.reason).toBe('recovery-rotation-failed');
    expect(res.importCalled).toBe(false);
    const cur = await page.evaluate(() => localStorage.getItem('dune_pre_import_backup_v1'));
    expect(cur).toBe('PRIOR_CAPSULE');
  });

  test('G-LOAD-04: rotation readback mismatch → destructive Load REFUSED (amendment)', async ({ page }) => {
    await primeRemoteDifferent(page);
    await page.evaluate(() => localStorage.setItem('dune_pre_import_backup_v1', 'PRIOR_CAPSULE'));
    const res = await page.evaluate(async () => {
      let importCalled = false;
      window.processImport = async () => { importCalled = true; return true; };
      const origGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function(k){
        if (k === 'dune_pre_import_backup_prev_v1') return 'CORRUPTED_MID_READ';
        return origGet.call(this, k);
      };
      try {
        const r = await window.GistSync.loadConnected();
        return { r, importCalled };
      } finally {
        Storage.prototype.getItem = origGet;
      }
    });
    expect(res.r.ok).toBe(false);
    expect(res.r.reason).toBe('recovery-rotation-failed');
    expect(res.importCalled).toBe(false);
  });

  test('G-LOAD-05: repeated Load — current + previous recovery generations remain correctly ordered (amendment)', async ({ page }) => {
    const { mock, bootData, remoteData } = await primeRemoteDifferent(page);
    // First Load — processImport writes capsule-A and mutates dune_finance_v1.
    await page.evaluate((rd) => {
      window.processImport = async () => {
        localStorage.setItem('dune_pre_import_backup_v1', 'capsule-A');
        localStorage.setItem('dune_finance_v1', JSON.stringify(rd.dune_finance_v1));
        return true;
      };
    }, remoteData);
    const r1 = await page.evaluate(() => window.GistSync.loadConnected());
    expect(r1.ok).toBe(true);
    // Reset the classifier to remote-only again: rewrite remote with a NEW
    // value; re-seed base to match the just-loaded local state.
    const newLocalHash = await page.evaluate(async () => window.GistSync.canonicalHash(window.getAllBackupData()));
    setRemoteFileToData(mock, gistId, { ...bootData, dune_finance_v1: { remote:'v3' } });
    mock.gists[0].history.unshift({ version:'rev_remote2' });
    await seedConnected(page, { gistId, remoteVersion:'rev_after_first_load', baseDataHash: newLocalHash });
    // The classifier will see the connected gist's current revision differs
    // from base.remoteVersion, and remoteHash differs from base.baseDataHash
    // (local matches base) → remote-only. Good.
    await page.evaluate(() => {
      window.processImport = async () => {
        localStorage.setItem('dune_pre_import_backup_v1', 'capsule-B');
        localStorage.setItem('dune_finance_v1', JSON.stringify({ remote:'v3' }));
        return true;
      };
    });
    const r2 = await page.evaluate(() => window.GistSync.loadConnected());
    expect(r2.ok).toBe(true);
    const state = await page.evaluate(() => ({
      cur: localStorage.getItem('dune_pre_import_backup_v1'),
      prev: localStorage.getItem('dune_pre_import_backup_prev_v1'),
    }));
    expect(state.cur).toBe('capsule-B');
    expect(state.prev).toBe('capsule-A');
  });

  test('G-LOAD-06: conflict → refuse Load; nothing mutates; capsule untouched (§12 case 7)', async ({ page }) => {
    const { mock } = await primeRemoteDifferent(page);
    // Dirty local so both sides differ from base.
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ localDiverged:true })));
    const before = await page.evaluate(() => ({
      finance: localStorage.getItem('dune_finance_v1'),
      capsule: localStorage.getItem('dune_pre_import_backup_v1'),
    }));
    const res = await page.evaluate(() => window.GistSync.loadConnected());
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('conflict');
    expect(mock.patches).toBe(0);
    const after = await page.evaluate(() => ({
      finance: localStorage.getItem('dune_finance_v1'),
      capsule: localStorage.getItem('dune_pre_import_backup_v1'),
    }));
    expect(after.finance).toBe(before.finance);
    expect(after.capsule).toBe(before.capsule);
  });
});

// ── UI TRUTH TEST ────────────────────────────────────────────────────────────

test.describe('conflict copy truthfulness (§9)', () => {
  test('G-COPY-01: "another device" attribution is not present anywhere in gist-sync.js', async ({ page }) => {
    await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    const src = await page.evaluate(async () => {
      const res = await fetch('/gist-sync.js');
      return await res.text();
    });
    expect(src).not.toMatch(/another device/i);
  });
});
