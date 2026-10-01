// Value-free Gist live-E2E probe (tools/gist-live-probe.js): synthetic data and an in-memory Gist mock only; the real GitHub API is never contacted.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const GITHUB = /^https?:\/\/api\.github\.com\//;
const FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'ghp_SYNTHETIC_PROBE_TOKEN_0000';
const SENTINEL = 'SENTINEL-PRIVATE-VALUE-9f3a';
const PROBE = path.join(__dirname, '..', 'tools', 'gist-live-probe.js');

function wrapper(data) { return { version: '2026.1', exported_at: '2026-09-01T00:00:00Z', data }; }
function gistFixture(id, data, revision) {
  return { id, description: 'Dune Life OS — Auto Backup', files: { 'dune-backup.json': { content: JSON.stringify(wrapper(data), null, 2) } },
           history: [{ version: revision }], updated_at: '2026-09-01T00:00:00Z', node_id: 'NID_' + id };
}
async function installMock(page, gists) {
  const state = { gists: gists.map(g => JSON.parse(JSON.stringify(g))), patches: 0, tokens: [] };
  await page.route(FONTS, r => r.abort());
  await page.route(GITHUB, async (route) => {
    const req = route.request(); const url = new URL(req.url()); const method = req.method();
    const auth = req.headers()['authorization']; if (auth) state.tokens.push(auth);
    if (url.pathname === '/gists' && method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.gists) });
    const m = url.pathname.match(/^\/gists\/([^/]+)$/);
    if (m) {
      const g = state.gists.find(x => x.id === decodeURIComponent(m[1]));
      if (!g) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
      if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(g) });
      if (method === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}'); state.patches++;
        for (const [n, v] of Object.entries(body.files || {})) g.files[n] = { content: v.content };
        g.history.unshift({ version: 'rev_after_' + state.patches }); g.updated_at = new Date().toISOString();
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(g) });
      }
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  return state;
}
async function ready(page) {
  await page.waitForFunction(() => typeof window.GistSync === 'object' && typeof window.processImport === 'function' && typeof window.getAllBackupData === 'function');
  await page.evaluate(() => (window.Store && window.Store.flushNow ? window.Store.flushNow() : null));
}
async function load(page, mock) {
  await page.goto('/'); await ready(page); await page.addScriptTag({ path: PROBE });
}
async function setBase(page, gistId, remoteVersion) {
  await page.evaluate(async ({ gistId, remoteVersion, TOKEN }) => {
    const h = await window.GistSync.backupDataHash(window.getAllBackupData());
    localStorage.setItem('dune_github_token_v1', TOKEN);
    localStorage.setItem('dune_gist_id_v1', gistId);
    localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify({ schema: 1, gistId, remoteVersion, baseDataHash: h, acceptedAt: '2026-09-01T00:00:00.000Z' }));
  }, { gistId, remoteVersion, TOKEN });
}
function assertValueFree(...outputs) {
  const text = JSON.stringify(outputs);
  for (const forbidden of [SENTINEL, TOKEN, 'ghp_', 'Authorization', 'dune-backup.json', 'g_probe', 'rev_after_', 'rev_base']) {
    expect(text.includes(forbidden), 'leaked: ' + forbidden).toBe(false);
  }
}

test.describe('tools/gist-live-probe.js', () => {
  test('source never touches the token, network or a restore path', () => {
    const src = fs.readFileSync(PROBE, 'utf8').replace(/\/\*[\s\S]*?\*\//, '');       // ignore the header comment that states the rules
    for (const bad of ['github_token', 'TOKEN', 'Authorization', 'fetch(', 'XMLHttpRequest', 'loadConnected', 'processImport', 'bootstrapOrReconnect', 'resolveBootstrap',
                       'resolveConflict', 'restorePreLoadRecovery', 'localStorage.setItem', 'localStorage.removeItem', 'localStorage.getItem', '.setItem(', '.removeItem(']) {
      expect(src.includes(bad), 'forbidden token in probe: ' + bad).toBe(false);
    }
  });

  test('save then isolated restore: hashes and counts match, nothing private or secret is ever returned', async ({ page, browser }) => {
    const mock = await installMock(page, [gistFixture('g_probe', { _placeholder: true }, 'rev_base')]);
    await load(page, mock);
    await page.evaluate((S) => localStorage.setItem('dune_finance_v1', JSON.stringify({ rows: [{ note: S }, { note: 'b' }], total: 3 })), SENTINEL);
    await page.evaluate(() => window.Store && window.Store.flushNow && window.Store.flushNow());
    // production-like profile: a connected Gist whose base differs only because local changed -> local-only
    const g0 = await page.evaluate(() => window.getAllBackupData());
    mock.gists[0].files['dune-backup.json'] = { content: JSON.stringify(wrapper({ ...g0, dune_finance_v1: { rows: [] } }), null, 2) };
    await setBase(page, 'g_probe', 'rev_base');
    // the base above hashes the CURRENT local data, so make the remote equal an older state first: remote older + base = remote hash
    const olderHash = await page.evaluate(async (d) => window.GistSync.backupDataHash(d), { ...g0, dune_finance_v1: { rows: [] } });
    await page.evaluate((h) => { const b = JSON.parse(localStorage.getItem('dune_gist_sync_base_v1')); b.baseDataHash = h; localStorage.setItem('dune_gist_sync_base_v1', JSON.stringify(b)); }, olderHash);

    const before = await page.evaluate(() => window.__gistProbe.local());
    const baseBefore = await page.evaluate(() => window.__gistProbe.syncBase());
    expect(baseBefore.present).toBe(true);
    const saved = await page.evaluate(() => window.__gistProbe.save());
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    expect(saved.kind).toBe('saved');
    expect(mock.patches).toBe(1);
    expect(saved.baseMatchesLocal).toBe(true);
    expect(saved.localAfter.semanticHash).toBe(before.semanticHash);                 // Save did not change local data
    const again = await page.evaluate(() => window.__gistProbe.save());
    expect([again.ok, again.kind, mock.patches]).toEqual([true, 'noop', 1]);          // second Save is a no-op: remote already identical

    // isolated fresh profile: new context, no data, PAT set only by the (synthetic) owner step; restore via the app's own confirm-gated resolver
    const context = await browser.newContext();
    const page2 = await context.newPage();
    const mock2 = await installMock(page2, mock.gists);
    await load(page2, mock2);
    const fresh = await page2.evaluate(() => window.__gistProbe.local());
    expect(fresh.semanticHash).not.toBe(before.semanticHash);                         // the fresh profile really starts different
    await page2.evaluate((T) => { window.confirm = () => true; const st = window.setTimeout; window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : st(fn, d);
                                  localStorage.removeItem('dune_gist_id_v1'); localStorage.removeItem('dune_gist_sync_base_v1'); localStorage.setItem('dune_github_token_v1', T); }, TOKEN);
    const boot = await page2.evaluate(() => window.GistSync.bootstrapOrReconnect('reconnect'));
    expect(boot.ok).toBe(true);
    const restored = await page2.evaluate(() => window.GistSync.resolveBootstrapLoadRemote({ confirmed: true }));
    expect(restored.ok, JSON.stringify({ ok: restored.ok, reason: restored.reason })).toBe(true);
    const after = await page2.evaluate(() => window.__gistProbe.local());
    const verdict = await page2.evaluate(([a, b]) => window.__gistProbe.compare(a, b), [before, after]);
    expect(verdict).toEqual({ pass: true, problems: [] });
    // the production-like page was never restored over
    expect((await page.evaluate(() => window.__gistProbe.local())).semanticHash).toBe(before.semanticHash);
    assertValueFree(before, baseBefore, saved, again, fresh, after, verdict, boot.ok);
    await context.close();
  });

  test('the exposed probe API is frozen and has no restore function', async ({ page }) => {
    await installMock(page, []);
    await load(page, null);
    expect(await page.evaluate(() => [Object.isFrozen(window.__gistProbe), Object.keys(window.__gistProbe).sort()])).toEqual([true, ['compare', 'local', 'save', 'syncBase']]);
  });

  test('compare detects any hash or count difference', async ({ page }) => {
    await installMock(page, []);
    await load(page, null);
    const a = await page.evaluate(() => window.__gistProbe.local());
    const same = await page.evaluate((x) => window.__gistProbe.compare(x, x), a);
    expect(same.pass).toBe(true);
    const hashDiff = await page.evaluate((x) => window.__gistProbe.compare(x, { ...x, semanticHash: 'f'.repeat(24) }), a);
    expect(hashDiff.pass).toBe(false);
    const name = Object.keys(a.collections)[0];
    const countDiff = await page.evaluate(([x, n]) => { const y = JSON.parse(JSON.stringify(x)); y.collections[n].count += 1; return window.__gistProbe.compare(x, y); }, [a, name]);
    expect(countDiff.pass).toBe(false);
    expect((await page.evaluate(() => window.__gistProbe.compare(null, null))).pass).toBe(false);
  });

  test('a conflict or remote-only state refuses Save: zero PATCH and still value-free', async ({ page }) => {
    const mock = await installMock(page, [gistFixture('g_probe', { _placeholder: true }, 'rev_base')]);
    await load(page, mock);
    const g0 = await page.evaluate(() => window.getAllBackupData());
    mock.gists[0].files['dune-backup.json'] = { content: JSON.stringify(wrapper(g0), null, 2) };
    await setBase(page, 'g_probe', 'rev_base');
    await page.evaluate((S) => localStorage.setItem('dune_finance_v1', JSON.stringify({ local: S })), SENTINEL);   // local drifts
    mock.gists[0].files['dune-backup.json'] = { content: JSON.stringify(wrapper({ ...g0, dune_finance_v1: { remote: SENTINEL } }), null, 2) };   // remote drifts differently
    mock.gists[0].history.unshift({ version: 'rev_remote_changed' });
    const out = await page.evaluate(() => window.__gistProbe.save());
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('conflict');
    expect(mock.patches).toBe(0);
    expect(out.baseMatchesLocal).toBe(false);          // a refused Save must never claim local == remote
    assertValueFree(out);
  });

  test('local() and syncBase() make no network request at all', async ({ page }) => {
    const mock = await installMock(page, [gistFixture('g_probe', { _placeholder: true }, 'rev_base')]);
    await load(page, mock);
    await page.evaluate(async () => { await window.__gistProbe.local(); await window.__gistProbe.syncBase(); });
    expect(mock.tokens).toEqual([]);                                                    // local()/syncBase() make no request at all
  });
});
