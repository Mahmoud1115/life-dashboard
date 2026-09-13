// Round-4 remediation spec — Integration P1 Round-4 blockers.
//
// Covers Codex R3 findings:
//   P1-A  Strict Link-header grammar — non-empty ambiguous headers fail closed.
//   P1-B  Authenticated redirect credential boundary — native-browser evidence
//         that rejected redirect destinations receive zero bearer credential.

const { test, expect } = require('@playwright/test');

const GITHUB_ORIGIN_ANY = /^https?:\/\/api\.github\.com\//;
const OFF_ORIGIN_ANY = /^https?:\/\/(?!api\.github\.com|127\.0\.0\.1|localhost)[^\/]+/;
const BLOCKED_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'ghp_test_r4_token';

async function waitReady(page){
  await page.waitForFunction(() =>
    typeof window.GistSync === 'object'
    && typeof window.GistSync.parseLinkHeader === 'function'
    && typeof window.GistSync.assertAllowedAuthenticatedUrl === 'function'
    && typeof window.GistSync.authenticatedGitHubFetch === 'function');
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
// R4 P1-A — strengthened Link parser
// ═══════════════════════════════════════════════════════════════════════
test.describe('R4 P1-A — Link grammar fails closed on ambiguity', () => {
  const cases = [
    { name:'unterminated-quote',          header: '<https://api.github.com/gists?page=2>; rel="next',                          reason:'unterminated-quote' },
    { name:'empty-list-member',           header: '<https://api.github.com/gists?page=2>; rel="next", ,',                     reason:'empty-list-member' },
    { name:'trailing-comma-empty-member', header: '<https://api.github.com/gists?page=2>; rel="next",',                       reason:'empty-list-member' },
    { name:'leading-comma-empty-member',  header: ',<https://api.github.com/gists?page=2>; rel="next"',                       reason:'empty-list-member' },
    { name:'empty-param',                 header: '<https://api.github.com/gists?page=2>; ; rel="next"',                      reason:'empty-parameter' },
    { name:'empty-param-name',            header: '<https://api.github.com/gists?page=2>; ="next"',                           reason:'empty-parameter-name' },
    { name:'empty-rel-value',             header: '<https://api.github.com/gists?page=2>; rel=""',                            reason:'empty-rel-value' },
    { name:'rel-next-with-other-tokens',  header: '<https://api.github.com/gists?page=2>; rel="next last"',                   reason:'rel-next-with-other-tokens' },
    { name:'duplicate-rel-param',         header: '<https://api.github.com/gists?page=2>; rel="next"; rel="prev"',            reason:'duplicate-rel-param' },
    { name:'angle-bracket-unbalanced',    header: '<<https://api.github.com/gists?page=2>>; rel="next"',                      reason:'angle-bracket-unbalanced' },
  ];
  for (const c of cases){
    test('R4-A-parse:' + c.name + ' → MALFORMED', async ({ page }) => {
      await page.goto('/');
      await waitReady(page);
      const r = await page.evaluate((h) => window.GistSync.parseLinkHeader(h), c.header);
      expect(r.state, JSON.stringify(r)).toBe('MALFORMED');
      expect(r.reason).toBe(c.reason);
    });
  }

  test('R4-A-valid-01: rel="next" on its own → VALID', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const r = await page.evaluate(() => window.GistSync.parseLinkHeader('<https://api.github.com/gists?page=2>; rel="next"'));
    expect(r.state).toBe('VALID');
    expect(r.next).toBe('https://api.github.com/gists?page=2');
  });

  test('R4-A-valid-02: valid pagination is preserved end-to-end', async ({ page }) => {
    // Two full pages, second page with rel="prev" only (no next). Discovery
    // must scan both pages and return no matches, and creation proceeds.
    const state = { posts: 0, gists: [], created: [] };
    await page.route(BLOCKED_FONTS, r => r.abort());
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.pathname === '/gists' && req.method() === 'GET'){
        const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
        if (pageNum === 1){
          return route.fulfill({ status:200, headers:{ Link:'<https://api.github.com/gists?per_page=100&page=2>; rel="next"', 'Access-Control-Expose-Headers':'Link' }, contentType:'application/json', body: JSON.stringify(Array.from({length:100},(_,i)=>({id:'p1_'+i, description:'x', files:{'x.md':{content:'x'}}, history:[{version:'r_'+i}], node_id:'NID_'+i, updated_at:'2026-01-01T00:00:00Z'}))) });
        }
        return route.fulfill({ status:200, headers:{ Link:'<https://api.github.com/gists?per_page=100&page=1>; rel="prev"', 'Access-Control-Expose-Headers':'Link' }, contentType:'application/json', body: JSON.stringify([]) });
      }
      if (url.pathname === '/gists' && req.method() === 'POST'){
        state.posts++;
        const body = JSON.parse(req.postData()||'{}');
        const id = 'g_new_'+state.posts;
        state.gists.push({ id, description: body.description, files: body.files, history:[{version:'rev_'+state.posts}], node_id:'NID_'+id, updated_at:new Date().toISOString() });
        return route.fulfill({ status:201, contentType:'application/json', body: JSON.stringify({ id, node_id:'NID_'+id, updated_at:new Date().toISOString() }) });
      }
      const m = url.pathname.match(/^\/gists\/([^\/]+)$/);
      if (m){
        const g = state.gists.find(x => x.id === decodeURIComponent(m[1]));
        return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(g) });
      }
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(true);
    expect(state.posts).toBe(1);
  });

  test('R4-A-integration-01: unterminated-quote on full page → zero POST', async ({ page }) => {
    const state = { posts: 0 };
    await page.route(BLOCKED_FONTS, r => r.abort());
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.pathname === '/gists' && req.method() === 'GET'){
        return route.fulfill({ status:200, headers:{ Link:'<https://api.github.com/gists?page=2>; rel="next', 'Access-Control-Expose-Headers':'Link' }, contentType:'application/json', body: JSON.stringify(Array.from({length:100},(_,i)=>({id:'p_'+i,description:'x',files:{'x.md':{content:'x'}},history:[{version:'r_'+i}],node_id:'NID_'+i,updated_at:'2026-01-01T00:00:00Z'}))) });
      }
      if (url.pathname === '/gists' && req.method() === 'POST'){ state.posts++; return route.fulfill({ status:201, contentType:'application/json', body:'{"id":"unexpected"}' }); }
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('list-failed');
    expect(state.posts).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// R4 P1-B — Authenticated redirect credential boundary
// ═══════════════════════════════════════════════════════════════════════
test.describe('R4 P1-B — redirect credential boundary (native browser evidence)', () => {
  // Helper: install a route set where /gists (first, unauth-redirect) returns
  // 301 to a chosen target; also install a "victim" catch-all recording
  // every request (URL + Authorization header) that reaches it.
  async function installRedirectMock(page, {redirectStatus=301, target, allowGithub302AllowedToAllowed=false}){
    const record = { victimHits: [], githubHits: [], redirected: false };
    await page.route(BLOCKED_FONTS, r => r.abort());
    // Record traffic to the specific known victim host used by this test.
    // Narrow route so we don't accidentally match Playwright's page.goto
    // or blocked-font requests as off-origin.
    try {
      const targetOrigin = new URL(target).origin;
      await page.route(targetOrigin + '/**', async (route) => {
        const req = route.request();
        record.victimHits.push({ url: req.url(), authorization: req.headers()['authorization'] || null });
        return route.fulfill({ status:200, contentType:'application/json', body: '{"leaked":true}' });
      });
    } catch(_){ /* if target URL is malformed, no victim route registered */ }
    let githubGetCount = 0;
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const url = new URL(req.url());
      record.githubHits.push({ url: req.url(), method: req.method(), authorization: req.headers()['authorization'] || null });
      if (url.pathname === '/gists' && req.method() === 'GET'){
        githubGetCount++;
        if (githubGetCount === 1){
          record.redirected = true;
          return route.fulfill({ status: redirectStatus, headers: { Location: target, 'Access-Control-Expose-Headers':'Location' }, contentType:'text/html', body: '' });
        }
        if (allowGithub302AllowedToAllowed){
          return route.fulfill({ status:200, contentType:'application/json', body: '[]' });
        }
      }
      return route.fulfill({ status:200, contentType:'application/json', body:'[]' });
    });
    return record;
  }

  test('R4-B-01: allowed → off-origin redirect → native browser must NOT send bearer to off-origin', async ({ page }) => {
    const rec = await installRedirectMock(page, { target: 'https://evil.example.com/steal' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    // No off-origin request carrying Authorization: Bearer.
    const authedOffOrigin = rec.victimHits.filter(x => x.authorization && x.authorization.startsWith('Bearer'));
    expect(authedOffOrigin.length).toBe(0);
    // If any off-origin request was attempted at all it MUST NOT carry the token.
    // Additionally, our client must refuse the create (list-failed).
    expect(r.reason).toBe('list-failed');
  });

  test('R4-B-02: allowed → HTTP downgrade redirect → refused; no bearer leak', async ({ page }) => {
    const rec = await installRedirectMock(page, { target: 'http://api.github.com/gists?page=2' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    // Any off-origin/downgrade destination must not receive the bearer.
    const authedLeaks = rec.victimHits.filter(x => x.authorization && x.authorization.startsWith('Bearer'));
    expect(authedLeaks.length).toBe(0);
  });

  test('R4-B-03: allowed → wrong-path redirect → refused; no bearer leak', async ({ page }) => {
    // Same-host but wrong path: /user/repos. redirect:'error' aborts at the
    // first 3xx regardless of destination, so the second request never happens
    // and no bearer reaches the wrong-path endpoint.
    const rec = await installRedirectMock(page, { target: 'https://api.github.com/user/repos' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    // No request should have been sent to /user/repos.
    const wrongPathHits = rec.githubHits.filter(x => new URL(x.url).pathname === '/user/repos');
    expect(wrongPathHits.length).toBe(0);
  });

  test('R4-B-04: authenticatedGitHubFetch native — rejection primitive is redirect:"error"', async ({ page }) => {
    // Direct unit test of the primitive: any 3xx from api.github.com/gists
    // must throw AUTH_REDIRECT_REFUSED without following.
    let saw302Request = false;
    let saw302Auth = null;
    let sawFollowRequest = false;
    let sawFollowAuth = null;
    await page.route(BLOCKED_FONTS, r => r.abort());
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const url = new URL(req.url());
      const auth = req.headers()['authorization'] || null;
      if (url.pathname === '/gists' && req.method() === 'GET' && url.searchParams.get('probe') === '1'){
        saw302Request = true; saw302Auth = auth;
        return route.fulfill({ status:302, headers:{ Location:'https://api.github.com/gists?page=next' }, contentType:'text/html', body:'' });
      }
      if (url.pathname === '/gists' && url.searchParams.get('page') === 'next'){
        sawFollowRequest = true; sawFollowAuth = auth;
        return route.fulfill({ status:200, contentType:'application/json', body: '[]' });
      }
      return route.fulfill({ status:200, contentType:'application/json', body: '[]' });
    });
    await page.goto('/');
    await waitReady(page);
    const outcome = await page.evaluate(async () => {
      try {
        const res = await window.GistSync.authenticatedGitHubFetch('https://api.github.com/gists?probe=1', { headers:{ 'Authorization':'Bearer test_token' } });
        return { ok:true, status: res.status };
      } catch(e){
        return { ok:false, message: String(e && e.message || e) };
      }
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('AUTH_REDIRECT_REFUSED');
    // Primary request was made once with the bearer.
    expect(saw302Request).toBe(true);
    expect(saw302Auth).toBe('Bearer test_token');
    // The redirect target must NEVER have been requested.
    expect(sawFollowRequest).toBe(false);
    expect(sawFollowAuth).toBeNull();
  });

  test('R4-B-05: authenticatedGitHubFetch URL allowlist rejects off-origin BEFORE fetch', async ({ page }) => {
    let evilFetched = false;
    await page.route(BLOCKED_FONTS, r => r.abort());
    await page.route('https://evil.example.com/**', async (route) => { evilFetched = true; return route.fulfill({ status:200, body:'ok' }); });
    await page.goto('/');
    await waitReady(page);
    const outcome = await page.evaluate(async () => {
      try {
        await window.GistSync.authenticatedGitHubFetch('https://evil.example.com/gists', { headers:{ 'Authorization':'Bearer test_token' } });
        return { ok:true };
      } catch(e){
        return { ok:false, message: String(e && e.message || e), reason: e && e.reason };
      }
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('wrong-host');
    expect(evilFetched).toBe(false);
  });

  test('R4-B-06: assertAllowedAuthenticatedUrl accepts /gists and /gists/:id but rejects other paths', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const ok1 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('https://api.github.com/gists'));
    expect(ok1.ok).toBe(true);
    const ok2 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('https://api.github.com/gists/abc123'));
    expect(ok2.ok).toBe(true);
    const bad1 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('https://api.github.com/user'));
    expect(bad1.ok).toBe(false);
    expect(bad1.reason).toBe('wrong-path');
    const bad2 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('http://api.github.com/gists'));
    expect(bad2.ok).toBe(false);
    expect(bad2.reason).toBe('wrong-scheme');
    const bad3 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('https://user:pw@api.github.com/gists'));
    expect(bad3.ok).toBe(false);
    expect(bad3.reason).toBe('credentials-in-url');
    const bad4 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('https://api.github.com/gists#tag'));
    expect(bad4.ok).toBe(false);
    expect(bad4.reason).toBe('has-fragment');
    const bad5 = await page.evaluate(() => window.GistSync.assertAllowedAuthenticatedUrl('https://api.github.com/gists/'));
    expect(bad5.ok).toBe(false);
    // Trailing slash → pathname is /gists/, no match, no id, reject.
  });

  test('R4-B-07: fetchConnectedGist redirect is refused; no leak to redirect target', async ({ page }) => {
    let firstHitAuth = null;
    let redirectTargetHit = false;
    let redirectTargetAuth = null;
    await page.route(BLOCKED_FONTS, r => r.abort());
    await page.route('https://evil.example.com/**', async (route) => {
      const req = route.request();
      redirectTargetHit = true;
      redirectTargetAuth = req.headers()['authorization'] || null;
      return route.fulfill({ status:200, contentType:'application/json', body:'{}' });
    });
    await page.route(GITHUB_ORIGIN_ANY, async (route) => {
      const req = route.request(); const url = new URL(req.url());
      const auth = req.headers()['authorization'] || null;
      if (url.pathname === '/gists/abc123'){
        firstHitAuth = auth;
        return route.fulfill({ status:302, headers:{ Location: 'https://evil.example.com/gists/abc123' }, contentType:'text/html', body:'' });
      }
      return route.fulfill({ status:200, contentType:'application/json', body:'{}' });
    });
    await page.goto('/');
    await waitReady(page);
    const outcome = await page.evaluate(async () => {
      try {
        const g = await window.GistSync.fetchConnectedGist('ghp_test', 'abc123');
        return { ok:true, gistId: g && g.gistId };
      } catch(e){
        return { ok:false, message: String(e && e.message || e) };
      }
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/AUTH_REDIRECT_REFUSED|GIST_FETCH_FAILED/);
    expect(firstHitAuth).toBe('Bearer ghp_test');
    // Critical native-browser evidence: redirect target NEVER received the bearer.
    expect(redirectTargetHit).toBe(false);
    expect(redirectTargetAuth).toBeNull();
  });
});
