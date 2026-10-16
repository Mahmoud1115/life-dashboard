// Gist Save transport/hash hardening regressions.
//
// All fixtures are synthetic. The first four tests are expected to FAIL on
// main@f133b5b: three exercise JSON transformations between the pre-PATCH hash
// and the uploaded bytes, and one models a cached pre-PATCH GET being returned
// for the immediate acknowledgement read.

const { test, expect } = require('@playwright/test');

const GITHUB_ORIGIN_ANY = /^https?:\/\/api\.github\.com\//;
const BLOCKED_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'synthetic_gist_token';

function makeBackupWrapper(data){
  return { version:'2026.1', exported_at:'2026-10-16T00:00:00Z', data };
}

function makeGistFixture({ id, backupData, revision }){
  return {
    id,
    description:'Dune Life OS — Auto Backup',
    files:{ 'dune-backup.json':{ content:JSON.stringify(makeBackupWrapper(backupData), null, 2) } },
    history:[{ version:revision }],
    updated_at:'2026-10-16T00:00:00Z',
    node_id:'NID_' + id,
  };
}

// Same in-memory GitHub shape as tests/gist-sync.spec.js:installGitHubMock,
// with one opt-in cache simulation. A cached response is returned only when
// the post-PATCH request has neither the hardening nonce nor cache-control.
async function installGitHubMock(page, initialGists, options={}){
  const state = {
    gists:initialGists.map(g => JSON.parse(JSON.stringify(g))),
    patches:0,
    gets:0,
    lastPatchBody:null,
    staleAfterPatch:null,
    servedStaleReads:0,
  };
  await page.route(BLOCKED_FONTS, route => route.abort());
  await page.route(GITHUB_ORIGIN_ANY, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.pathname === '/gists' && method === 'GET'){
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(state.gists) });
    }
    const match = url.pathname.match(/^\/gists\/([^/]+)$/);
    if (!match) return route.fulfill({ status:200, contentType:'application/json', body:'[]' });

    const id = decodeURIComponent(match[1]);
    const gist = state.gists.find(item => item.id === id);
    if (!gist) return route.fulfill({ status:404, contentType:'application/json', body:'{"message":"Not Found"}' });

    if (method === 'GET'){
      state.gets++;
      const headers = req.headers();
      const isFreshRead = url.searchParams.has('_lifeos_sync_read')
        || /no-cache|no-store/i.test(headers['cache-control'] || '');
      if (options.cachePrePatchReread && state.staleAfterPatch && !isFreshRead){
        state.servedStaleReads++;
        return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(state.staleAfterPatch) });
      }
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(gist) });
    }

    if (method === 'PATCH'){
      const body = JSON.parse(req.postData() || '{}');
      state.patches++;
      state.lastPatchBody = body;
      if (options.cachePrePatchReread) state.staleAfterPatch = JSON.parse(JSON.stringify(gist));
      for (const [name, value] of Object.entries(body.files || {})){
        gist.files[name] = { content:value.content };
      }
      gist.history.unshift({ version:'rev_after_' + state.patches });
      gist.updated_at = '2026-10-16T00:00:0' + state.patches + 'Z';
      return route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(gist) });
    }

    return route.fulfill({ status:405, contentType:'application/json', body:'{}' });
  });
  return state;
}

async function waitReady(page){
  await page.waitForFunction(() => window.GistSync && window.Store && window.getAllBackupData);
  await page.evaluate(() => window.Store.flushNow());
}

async function primeSynced(page, options={}){
  const gistId = options.gistId || 'g_roundtrip';
  const mock = await installGitHubMock(page, [
    makeGistFixture({ id:gistId, backupData:{ placeholder:true }, revision:'rev_base' })
  ], options);
  await page.goto('/');
  await waitReady(page);
  const baseline = await page.evaluate(async () => {
    const data = window.getAllBackupData();
    return { data, hash:await window.GistSync.backupDataHash(data) };
  });
  mock.gists[0].files['dune-backup.json'].content = JSON.stringify(makeBackupWrapper(baseline.data), null, 2);
  await page.evaluate(({ gistId, hash, token }) => {
    localStorage.setItem('dune_github_token_v1', token);
    localStorage.setItem('dune_gist_id_v1', gistId);
    localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify({
      schema:1,
      gistId,
      remoteVersion:'rev_base',
      baseDataHash:hash,
      acceptedAt:'2026-10-16T00:00:00.000Z',
    }));
  }, { gistId, hash:baseline.hash, token:TOKEN });
  return { mock, gistId, baseline };
}

async function saveWithInjectedProbe(page, kind){
  return page.evaluate(async kind => {
    const original = window.getAllBackupData;
    const base = original();
    let probe;
    if (kind === 'object-undefined'){
      probe = { retained:'synthetic', dropped:undefined };
    } else if (kind === 'date'){
      probe = new Date('2026-10-16T00:00:00.000Z');
    } else if (kind === 'custom-toJSON'){
      class SyntheticRecord {
        constructor(){ this.retained = 'before-toJSON'; }
        toJSON(){ return { retained:'after-toJSON' }; }
      }
      probe = new SyntheticRecord();
    } else {
      throw new Error('unknown probe');
    }
    const injected = { ...base, dune_roundtrip_probe:probe };
    window.getAllBackupData = () => injected;
    try { return await window.GistSync.saveConnected(); }
    finally { window.getAllBackupData = original; }
  }, kind);
}

test.describe('Gist transport/hash round trip', () => {
  for (const [id, kind] of [
    ['G-RT-01', 'object-undefined'],
    ['G-RT-02', 'date'],
    ['G-RT-03', 'custom-toJSON'],
  ]){
    test(`${id}: hash is computed from the JSON transport value [fails on main@f133b5b]`, async ({ page }) => {
      const { mock } = await primeSynced(page, { gistId:'g_' + kind });
      const result = await saveWithInjectedProbe(page, kind);
      expect(result.ok).toBe(true);
      expect(result.kind).toBe('saved');
      expect(mock.patches).toBe(1);
      expect(JSON.parse(mock.lastPatchBody.files['dune-backup.json'].content).data)
        .toHaveProperty('dune_roundtrip_probe');
    });
  }

  test('G-RT-04: cached pre-PATCH GET cannot satisfy acknowledgement [fails on main@f133b5b]', async ({ page }) => {
    const { mock } = await primeSynced(page, { gistId:'g_cached_reread', cachePrePatchReread:true });
    await page.evaluate(() => localStorage.setItem('dune_finance_v1', JSON.stringify({ syntheticChange:true })));
    const result = await page.evaluate(() => window.GistSync.saveConnected());
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('saved');
    expect(mock.patches).toBe(1);
    expect(mock.servedStaleReads).toBe(0);
  });

  test('G-RT-05: persisted JSON edge cases retain the same semantic hash after stringify/parse', async ({ page }) => {
    await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    const checks = await page.evaluate(async () => {
      const ownProto = JSON.parse('{"__proto__":{"synthetic":true},"safe":1}');
      const sparse = [];
      sparse.length = 3;
      sparse[1] = 'middle';
      const cases = {
        negativeZero:{ value:-0 },
        largeAndFloat:{ large:1e21, small:1e-7, decimal:0.1 + 0.2 },
        loneSurrogates:{ high:'\ud800', low:'\udc00' },
        ownProto,
        undefinedInArray:[undefined, 1],
        sparseArray:sparse,
      };
      const out = {};
      for (const [name, value] of Object.entries(cases)){
        const transported = JSON.parse(JSON.stringify(value));
        out[name] = (await GistSync.backupDataHash(value)) === (await GistSync.backupDataHash(transported));
      }
      return out;
    });
    expect(Object.values(checks).every(Boolean)).toBe(true);
  });

  test('G-RT-06: non-finite numbers fail before any PATCH', async ({ page }) => {
    const { mock } = await primeSynced(page, { gistId:'g_non_finite' });
    const result = await page.evaluate(async () => {
      const original = window.getAllBackupData;
      const injected = { ...original(), dune_roundtrip_probe:{ value:NaN } };
      window.getAllBackupData = () => injected;
      try { return await GistSync.saveConnected(); }
      finally { window.getAllBackupData = original; }
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('local-hash-failed');
    expect(mock.patches).toBe(0);
  });
});
