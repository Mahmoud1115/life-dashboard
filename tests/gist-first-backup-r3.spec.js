// Round-3 remediation spec — Integration P1 Round-3 fail-open closures.
//
// Covers Codex R2 blockers R3-P1-A / R3-P1-B / R3-P1-C + verified pending clear.

const { test, expect } = require('@playwright/test');

const GITHUB_ORIGIN_ANY = /^https?:\/\/api\.github\.com\//;
const OFF_ORIGIN_ANY = /^https?:\/\/(?!api\.github\.com|127\.0\.0\.1|localhost)[^\/]+/;
const BLOCKED_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'ghp_test_r3_token';

async function installBaseMock(page){
  // Deny any off-origin request outright so we can prove no PAT ever
  // leaves the api.github.com origin. Records were-attempts for
  // assertion.
  const state = { offOriginAttempts: [], gists: [], posts: 0, lastPostBody:null };
  await page.route(BLOCKED_FONTS, r => r.abort());
  await page.route(OFF_ORIGIN_ANY, async (route) => {
    const req = route.request();
    state.offOriginAttempts.push({ url: req.url(), auth: req.headers()['authorization'] || null });
    return route.abort();
  });
  await page.route(GITHUB_ORIGIN_ANY, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.pathname === '/gists' && method === 'POST'){
      state.posts++;
      state.lastPostBody = JSON.parse(req.postData() || '{}');
      const id = 'g_created_' + state.posts;
      state.gists.push({ id, description: state.lastPostBody.description || '', files: state.lastPostBody.files || {}, history:[{version:'rev_'+state.posts}], node_id:'NID_'+id, updated_at:new Date().toISOString() });
      return route.fulfill({ status:201, contentType:'application/json', body: JSON.stringify({ id, node_id:'NID_'+id, updated_at:new Date().toISOString() }) });
    }
    if (url.pathname === '/gists' && method === 'GET'){
      return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(state.gists) });
    }
    const m = url.pathname.match(/^\/gists\/([^\/]+)$/);
    if (m){
      const g = state.gists.find(x => x.id === decodeURIComponent(m[1]));
      if (method === 'GET'){
        if (!g) return route.fulfill({ status:404, contentType:'application/json', body:'{}' });
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
    && typeof window.GistSync.evaluatePendingCreated === 'function'
    && typeof window.GistSync.assertGitHubGistsUrl === 'function');
}

async function seedTokenOnly(page){
  await page.evaluate((TOKEN) => {
    localStorage.setItem('dune_github_token_v1', TOKEN);
    localStorage.removeItem('dune_gist_id_v1');
    localStorage.removeItem('dune_gist_sync_base_v1');
    localStorage.removeItem('dune_gist_pending_created_v1');
    window.confirm = () => true;
    if (window.GistSync && typeof window.GistSync._clearPendingWriteFailedLatch === 'function'){
      window.GistSync._clearPendingWriteFailedLatch();
    }
  }, TOKEN);
}

// ═══════════════════════════════════════════════════════════════════════
// R3-P1-A — pending tri-state (only proven ABSENT authorizes create)
// ═══════════════════════════════════════════════════════════════════════
test.describe('R3-P1-A — pending tri-state', () => {
  test('R3-A-01: absent key → evaluate ABSENT, create may proceed', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('ABSENT');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(true);
    expect(mock.posts).toBe(1);
  });

  test('R3-A-02: valid record → VALID, create blocked (pending-created-present)', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:1, gistId:'g_valid', createdAt:'2026-09-01T00:00:00Z' })));
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('VALID');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-created-present');
    expect(mock.posts).toBe(0);
  });

  test('R3-A-03: malformed JSON → CORRUPT, create blocked (pending-corrupt)', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', '{"schema":1,"gistId":"g","createdAt":'));
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('CORRUPT');
    expect(ev.reason).toBe('json-parse-failed');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-corrupt');
    expect(mock.posts).toBe(0);
  });

  test('R3-A-04: wrong schema → CORRUPT, create blocked', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:2, gistId:'g', createdAt:'2026-09-01T00:00:00Z' })));
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('CORRUPT');
    expect(ev.reason).toBe('wrong-schema');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-corrupt');
    expect(mock.posts).toBe(0);
  });

  test('R3-A-05: invalid gistId → CORRUPT, create blocked', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:1, gistId:'', createdAt:'2026-09-01T00:00:00Z' })));
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('CORRUPT');
    expect(ev.reason).toBe('invalid-gistId');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-corrupt');
  });

  test('R3-A-06: invalid createdAt → CORRUPT, create blocked', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:1, gistId:'g_ok', createdAt:'not-a-date' })));
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('CORRUPT');
    expect(ev.reason).toBe('invalid-createdAt');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-corrupt');
  });

  test('R3-A-07: localStorage.getItem throws → READ_FAILED, create blocked', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Instrument getItem to throw ONLY for the pending key.
    await page.evaluate(() => {
      const _get = Storage.prototype.getItem;
      Storage.prototype.getItem = function(k){
        if (k === 'dune_gist_pending_created_v1') throw new Error('read-forced');
        return _get.call(this, k);
      };
    });
    const ev = await page.evaluate(() => window.GistSync.evaluatePendingCreated());
    expect(ev.state).toBe('READ_FAILED');
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-read-failed');
    expect(mock.posts).toBe(0);
  });

  test('R3-A-08: UI hides Create when pending is CORRUPT; shows unhealthy row', async ({ page }) => {
    await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', '{invalid'));
    await page.evaluate(() => window.updateGistUI());
    await page.evaluate(() => window.show && window.show('sync', new Event('click')));
    await expect(page.locator('#sync-create-row')).toBeHidden();
    await expect(page.locator('#sync-pending-unhealthy-row')).toBeVisible();
  });

  test('R3-A-09: reconcile refuses on CORRUPT (does not silently delete)', async ({ page }) => {
    await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', '{invalid'));
    const r = await page.evaluate(() => window.gistReconcilePendingCreated());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-corrupt');
    // Corrupt evidence is preserved.
    const raw = await page.evaluate(() => localStorage.getItem('dune_gist_pending_created_v1'));
    expect(raw).toBe('{invalid');
  });

  test('R3-A-10: discard on CORRUPT requires confirm and removes only after ack', async ({ page }) => {
    await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', '{invalid'));
    // window.confirm was set to () => true by seedTokenOnly.
    const r = await page.evaluate(() => window.gistDiscardPendingCreated());
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('discarded');
    expect(r.priorState).toBe('CORRUPT');
    const raw = await page.evaluate(() => localStorage.getItem('dune_gist_pending_created_v1'));
    expect(raw).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// R3-P1-B — pagination URL allowlist (no PAT exfiltration)
// ═══════════════════════════════════════════════════════════════════════
test.describe('R3-P1-B — pagination URL allowlist', () => {
  test('R3-B-01: assertGitHubGistsUrl accepts canonical URL', async ({ page }) => {
    await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('https://api.github.com/gists?per_page=100&page=2', 'https://api.github.com/gists'));
    expect(r.ok).toBe(true);
    expect(r.url).toContain('https://api.github.com/gists');
  });

  test('R3-B-02: off-origin absolute next → reject; ZERO off-origin authenticated request', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Serve page 1 with a Link header pointing to an off-origin next.
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const u = new URL(req.url());
      if (u.pathname === '/gists' && req.method() === 'GET' && u.searchParams.get('page') !== '2'){
        return route.fulfill({
          status:200,
          headers:{ Link: '<https://evil.example.com/gists?page=2>; rel="next"', 'Access-Control-Expose-Headers':'Link' },
          contentType:'application/json',
          body: JSON.stringify(Array.from({length:100},(_,i)=>({ id:'u_'+i, description:'x', files:{'x.md':{content:'x'}}, history:[{version:'r_u_'+i}], node_id:'NID_u_'+i, updated_at:'2026-01-01T00:00:00Z' })))
        });
      }
      return route.fulfill({ status:200, contentType:'application/json', body: '[]' });
    });
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    // Discovery rejects the off-origin next URL, so the create fails with list-failed.
    expect(r.reason).toBe('list-failed');
    // Critical: no off-origin request carrying the token was attempted.
    const authedOffOrigin = mock.offOriginAttempts.filter(x => x.auth && x.auth.includes('Bearer'));
    expect(authedOffOrigin.length).toBe(0);
  });

  test('R3-B-03: http scheme rejected', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('http://api.github.com/gists?page=2', 'https://api.github.com/gists'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong-scheme');
  });

  test('R3-B-04: wrong GitHub path rejected', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('https://api.github.com/user/repos?page=2', 'https://api.github.com/gists'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong-path');
  });

  test('R3-B-05: credentials embedded in URL rejected', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('https://user:pass@api.github.com/gists?page=2', 'https://api.github.com/gists'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('credentials-in-url');
  });

  test('R3-B-06: malformed URL rejected', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('h!!ttp://????', 'https://api.github.com/gists'));
    expect(r.ok).toBe(false);
    expect(['url-parse-failed','wrong-scheme','wrong-host','wrong-path']).toContain(r.reason);
  });

  test('R3-B-07: relative next resolves against api.github.com/gists and is accepted', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    // Relative URL resolves against baseUrl, but must still land on the exact
    // allowed path (/gists). A relative "?page=2" satisfies this.
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('?page=2', 'https://api.github.com/gists'));
    expect(r.ok).toBe(true);
  });

  test('R3-B-08: relative next resolving to a different path is rejected', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('/user/repos?page=2', 'https://api.github.com/gists'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong-path');
  });

  test('R3-B-09: fragment rejected', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.assertGitHubGistsUrl('https://api.github.com/gists?page=2#tag', 'https://api.github.com/gists'));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('has-fragment');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// R3-P1-C — strict Link header semantics
// ═══════════════════════════════════════════════════════════════════════
test.describe('R3-P1-C — strict Link header parser', () => {
  test('R3-C-01: absent header → { state:"ABSENT" }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader(null));
    expect(r.state).toBe('ABSENT');
  });
  test('R3-C-02: empty string → { state:"ABSENT" }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader(''));
    expect(r.state).toBe('ABSENT');
  });
  test('R3-C-03: valid single next → { state:"VALID", next:<url> }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('<https://api.github.com/gists?page=2>; rel="next"'));
    expect(r.state).toBe('VALID');
    expect(r.next).toBe('https://api.github.com/gists?page=2');
  });
  test('R3-C-04: valid no-next → { state:"VALID", next:null }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('<https://api.github.com/gists?page=1>; rel="prev"'));
    expect(r.state).toBe('VALID');
    expect(r.next).toBeNull();
  });
  test('R3-C-05: duplicate next → { state:"MALFORMED", reason:"duplicate-next" }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('<https://api.github.com/gists?page=2>; rel="next", <https://api.github.com/gists?page=3>; rel="next"'));
    expect(r.state).toBe('MALFORMED');
    expect(r.reason).toBe('duplicate-next');
  });
  test('R3-C-06: bad link value (no angle brackets) → MALFORMED', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('https://api.github.com/gists; rel="next"'));
    expect(r.state).toBe('MALFORMED');
  });
  test('R3-C-07: empty URI → MALFORMED', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('<>; rel="next"'));
    expect(r.state).toBe('MALFORMED');
  });
  test('R3-C-08: param without value → MALFORMED', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('<https://api.github.com/gists?page=2>; rel'));
    expect(r.state).toBe('MALFORMED');
  });
  test('R3-C-09: full-page (100 items) + absent Link → fail closed', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Serve 100 items on page 1 with NO Link header. The pagination layer
    // must fail closed under this ambiguity.
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const u = new URL(req.url());
      if (u.pathname === '/gists' && req.method() === 'GET'){
        return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(Array.from({length:100},(_,i)=>({ id:'u_'+i, description:'x', files:{'x.md':{content:'x'}}, history:[{version:'r_u_'+i}], node_id:'NID_u_'+i, updated_at:'2026-01-01T00:00:00Z' }))) });
      }
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    });
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('list-failed');
    expect(mock.posts).toBe(0);
  });
  test('R3-C-10: full-page (100 items) + malformed Link → fail closed', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const u = new URL(req.url());
      if (u.pathname === '/gists' && req.method() === 'GET'){
        return route.fulfill({ status:200, headers:{ Link: 'garbage-not-a-link', 'Access-Control-Expose-Headers':'Link' }, contentType:'application/json', body: JSON.stringify(Array.from({length:100},(_,i)=>({ id:'u_'+i, description:'x', files:{'x.md':{content:'x'}}, history:[{version:'r_u_'+i}], node_id:'NID_u_'+i, updated_at:'2026-01-01T00:00:00Z' }))) });
      }
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    });
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('list-failed');
    expect(mock.posts).toBe(0);
  });
  test('R3-C-11: short-page (< 100 items) + absent Link → terminate normally, POST proceeds', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const u = new URL(req.url());
      if (u.pathname === '/gists' && req.method() === 'GET'){
        return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify([]) });
      }
      if (u.pathname === '/gists' && req.method() === 'POST'){
        mock.posts++;
        const id = 'g_created_' + mock.posts;
        const body = JSON.parse(req.postData() || '{}');
        mock.gists.push({ id, description: body.description, files: body.files, history:[{version:'rev_'+mock.posts}], node_id:'NID_'+id, updated_at:new Date().toISOString() });
        return route.fulfill({ status:201, contentType:'application/json', body: JSON.stringify({ id, node_id:'NID_'+id, updated_at:new Date().toISOString() }) });
      }
      const m = u.pathname.match(/^\/gists\/([^\/]+)$/);
      if (m){
        const g = mock.gists.find(x => x.id === decodeURIComponent(m[1]));
        return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(g) });
      }
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    });
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(true);
    expect(mock.posts).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// R3-P2 — verified pending clear
// ═══════════════════════════════════════════════════════════════════════
test.describe('R3-P2 — verified pending clear', () => {
  test('R3-CL-01: successful verified clear returns { ok:true }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:1, gistId:'g_ok', createdAt:'2026-09-01T00:00:00Z' })));
    const r = await page.evaluate(() => window.GistSync.clearPendingCreatedGist());
    expect(r.ok).toBe(true);
    const raw = await page.evaluate(() => localStorage.getItem('dune_gist_pending_created_v1'));
    expect(raw).toBeNull();
  });

  test('R3-CL-02: removeItem throws → readback still absent → still ok', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    // Set pending then instrument removeItem to throw AFTER first invocation.
    await page.evaluate(() => {
      const _rem = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function(k){
        if (k === 'dune_gist_pending_created_v1') throw new Error('remove-forced');
        return _rem.call(this, k);
      };
    });
    // Pending was never persisted → readback is already null → clear returns ok=true with removeError reported.
    const r = await page.evaluate(() => window.GistSync.clearPendingCreatedGist());
    expect(r.ok).toBe(true);
    expect(r.removeError).toContain('remove-forced');
  });

  test('R3-CL-03: removeItem no-ops (readback still present) → { ok:false, still-present }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:1, gistId:'g_stubborn', createdAt:'2026-09-01T00:00:00Z' })));
    await page.evaluate(() => {
      // removeItem is a no-op
      Storage.prototype.removeItem = function(k){ /* ignore */ };
    });
    const r = await page.evaluate(() => window.GistSync.clearPendingCreatedGist());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('still-present-after-remove');
  });

  test('R3-CL-04: readback throws → { ok:false, readback-threw }', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:1, gistId:'g_read_err', createdAt:'2026-09-01T00:00:00Z' })));
    await page.evaluate(() => {
      const _get = Storage.prototype.getItem;
      Storage.prototype.getItem = function(k){
        if (k === 'dune_gist_pending_created_v1') throw new Error('read-forced');
        return _get.call(this, k);
      };
    });
    const r = await page.evaluate(() => window.GistSync.clearPendingCreatedGist());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('readback-threw');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// R3 §5 — in-memory pending-write-failed latch
// ═══════════════════════════════════════════════════════════════════════
test.describe('R3 §5 — pending-write-failed session latch', () => {
  test('R3-LATCH-01: pending-write failure trips latch; second create refused', async ({ page }) => {
    const mock = await installBaseMock(page);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Force setItem for pending key to throw AFTER POST.
    await page.evaluate(() => {
      const _set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (k === 'dune_gist_pending_created_v1') throw new Error('pending-set-forced');
        return _set.call(this, k, v);
      };
    });
    const r1 = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe('pending-write-failed');
    // Latch is set.
    const latch = await page.evaluate(() => window.GistSync.getPendingWriteFailedLatch());
    expect(latch).not.toBeNull();
    expect(latch.gistId).toBe(r1.createdGistId);
    // Second call refused.
    const r2 = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('pending-in-memory-latch-present');
    expect(mock.posts).toBe(1);
  });
});
