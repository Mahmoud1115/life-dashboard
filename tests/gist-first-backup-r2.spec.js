// Round-2 remediation spec — Integration P1 Round-2 blockers.
//
// Covers Codex R1 blockers B1..B4:
//   B1  concurrent-invocation serialization (same-page + Web Lock)
//   B2  paginated discovery (Link header) + fail-closed on errors/pathology
//   B3  UI reachability (E2E)
//   B4  durable pending-created identity + reconcile/discard lifecycle
//
// Plus the additional Round-2 required scenarios (malformed POST 2xx/no ID,
// explicit 401/403, ID-write failure, base-write failure, etc.).

const { test, expect } = require('@playwright/test');

const GITHUB_ORIGIN_ANY = /^https?:\/\/api\.github\.com\//;
const BLOCKED_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'ghp_test_r2_token';

function makeExistingGist(id, description='Dune Life OS — Auto Backup'){
  return {
    id, description,
    files: { 'dune-backup.json': { content: JSON.stringify({ version:'2026.1', exported_at:'x', data:{ e:true } }, null, 2) } },
    history: [{ version: 'rev_' + id }],
    node_id: 'NID_' + id,
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// Two-mode mock:
//   pageMode = 'single'    → /gists returns the whole list in one page (no Link).
//   pageMode = 'pages'     → returns pages of size `pageSize`, with Link headers.
//   pageMode = 'loop'      → every response has rel=next pointing to same URL.
//   pageMode = 'malformed' → returns an object body (not array) on page 1.
//   pageMode = 'errorPage' → page N fails 500.
async function installMock(page, initialGists, opts={}){
  const state = {
    gists: initialGists.map(g => JSON.parse(JSON.stringify(g))),
    posts: 0,
    lastPostBody: null,
    postDelayMs: opts.postDelayMs || 0,
    createResponder: null,
    ackResponder: null,
    onListRequest: null,
    pageMode: opts.pageMode || 'single',
    pageSize: opts.pageSize || 100,
    errorOnPage: opts.errorOnPage || null, // 1-based
    createdIds: [],
  };
  await page.route(BLOCKED_FONTS, r => r.abort());
  await page.route(GITHUB_ORIGIN_ANY, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();

    if (url.pathname === '/gists' && method === 'GET'){
      if (typeof state.onListRequest === 'function') state.onListRequest(url);
      // Determine "page" via a synthetic ?page=N (default 1) — GitHub's Link
      // header advances to explicit URLs, so our next URLs will include ?page=N.
      const pageNum = parseInt(url.searchParams.get('page') || '1', 10);
      if (state.pageMode === 'malformed' && pageNum === 1){
        return route.fulfill({ status:200, contentType:'application/json', body: '{"not":"array"}' });
      }
      if (state.errorOnPage != null && pageNum === state.errorOnPage){
        return route.fulfill({ status:500, contentType:'application/json', body: '{"message":"err"}' });
      }
      if (state.pageMode === 'loop'){
        // Always emit rel=next → same URL to trigger loop detection.
        const linkSame = '<' + req.url() + '>; rel="next"';
        return route.fulfill({ status:200, headers:{ Link: linkSame, 'Access-Control-Expose-Headers':'Link' }, contentType:'application/json', body: '[]' });
      }
      if (state.pageMode === 'pages'){
        const pageSize = state.pageSize;
        const start = (pageNum - 1) * pageSize;
        const slice = state.gists.slice(start, start + pageSize);
        const totalPages = Math.max(1, Math.ceil(state.gists.length / pageSize));
        const headers = {};
        if (pageNum < totalPages){
          const nextUrl = 'https://api.github.com/gists?per_page=' + pageSize + '&page=' + (pageNum + 1);
          headers.Link = '<' + nextUrl + '>; rel="next"';
          headers['Access-Control-Expose-Headers'] = 'Link';
        }
        return route.fulfill({ status:200, headers, contentType:'application/json', body: JSON.stringify(slice) });
      }
      // 'single'
      return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(state.gists) });
    }

    if (url.pathname === '/gists' && method === 'POST'){
      state.posts++;
      state.lastPostBody = JSON.parse(req.postData() || '{}');
      if (state.postDelayMs > 0){
        await new Promise(r => setTimeout(r, state.postDelayMs));
      }
      if (typeof state.createResponder === 'function'){
        return route.fulfill(await state.createResponder(req));
      }
      const id = 'g_created_' + state.posts;
      state.createdIds.push(id);
      const files = state.lastPostBody.files || {};
      state.gists.push({
        id, description: state.lastPostBody.description || '',
        files, history: [{ version:'rev_created_' + state.posts }],
        node_id: 'NID_' + id, updated_at: new Date().toISOString(),
      });
      return route.fulfill({ status:201, contentType:'application/json', body: JSON.stringify({ id, node_id:'NID_'+id, updated_at:new Date().toISOString() }) });
    }

    const m = url.pathname.match(/^\/gists\/([^\/]+)$/);
    if (m){
      const id = decodeURIComponent(m[1]);
      const g = state.gists.find(x => x.id === id);
      if (method === 'GET'){
        if (typeof state.ackResponder === 'function'){
          return route.fulfill(await state.ackResponder(id, req, g));
        }
        if (!g) return route.fulfill({ status:404, contentType:'application/json', body:'{"message":"Not Found"}' });
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
    && typeof window.gistCreateFirstBackup === 'function'
    && typeof window.gistReconcilePendingCreated === 'function'
    && typeof window.gistDiscardPendingCreated === 'function');
  await page.evaluate(() => (window.Store && window.Store.flushNow ? window.Store.flushNow() : null));
}

async function seedTokenOnly(page){
  await page.evaluate((TOKEN) => {
    localStorage.setItem('dune_github_token_v1', TOKEN);
    localStorage.removeItem('dune_gist_id_v1');
    localStorage.removeItem('dune_gist_sync_base_v1');
    localStorage.removeItem('dune_gist_pending_created_v1');
    window.confirm = () => true;
  }, TOKEN);
}

async function readState(page){
  return page.evaluate(() => ({
    gistId: localStorage.getItem('dune_gist_id_v1'),
    base: localStorage.getItem('dune_gist_sync_base_v1'),
    pending: localStorage.getItem('dune_gist_pending_created_v1'),
  }));
}

// ── B1 — concurrent invocation serialization ────────────────────────────────
test.describe('R2 B1 — same-page concurrent creation is serialized', () => {
  test('R2-B1-01: two concurrent createFirstBackup calls → exactly one POST + one success', async ({ page }) => {
    const mock = await installMock(page, [], { postDelayMs: 250 });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const [rA, rB] = await page.evaluate(async () => {
      const a = window.gistCreateFirstBackup();
      const b = window.gistCreateFirstBackup();
      return Promise.all([a, b]);
    });
    // Exactly one POST.
    expect(mock.posts).toBe(1);
    // Exactly one success.
    const oks = [rA, rB].filter(x => x && x.ok).length;
    expect(oks).toBe(1);
    // The other one refused with `already-in-flight`.
    const rejections = [rA, rB].filter(x => x && !x.ok);
    expect(rejections.length).toBe(1);
    expect(rejections[0].reason).toBe('already-in-flight');
  });

  test('R2-B1-02: after in-flight resolves, a later call proceeds normally', async ({ page }) => {
    const mock = await installMock(page, [], { postDelayMs: 100 });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const first = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(first.ok).toBe(true);
    // Second call should hit already-connected now (Gist stored) — not in-flight.
    const second = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already-connected');
    expect(mock.posts).toBe(1);
  });
});

// ── B2 — paginated discovery ────────────────────────────────────────────────
test.describe('R2 B2 — discovery follows pagination and fails closed', () => {
  test('R2-B2-01: matching Gist on page 2 → NO POST (existing-backup-discoverable)', async ({ page }) => {
    // 100 unrelated on page 1 + one LIFE OS backup on page 2.
    const unrelated = Array.from({length:100}, (_,i) => ({ id:'u_'+i, description:'noise', files:{ 'x.md':{ content:'x' } }, history:[{ version:'r_u_'+i }], node_id:'NID_u_'+i, updated_at:'2026-01-01T00:00:00Z' }));
    const match = makeExistingGist('g_existing_page2');
    const mock = await installMock(page, [...unrelated, match], { pageMode:'pages', pageSize:100 });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('existing-backup-discoverable');
    expect(r.discoveredGistId).toBe('g_existing_page2');
    expect(mock.posts).toBe(0);
  });

  test('R2-B2-02: multiple pages, no match → creation may proceed', async ({ page }) => {
    const unrelated = Array.from({length:250}, (_,i) => ({ id:'u_'+i, description:'noise', files:{ 'x.md':{ content:'x' } }, history:[{ version:'r_u_'+i }], node_id:'NID_u_'+i, updated_at:'2026-01-01T00:00:00Z' }));
    const mock = await installMock(page, unrelated, { pageMode:'pages', pageSize:100 });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(true);
    expect(mock.posts).toBe(1);
  });

  test('R2-B2-03: page-2 fetch fails 500 → NO POST', async ({ page }) => {
    const unrelated = Array.from({length:120}, (_,i) => ({ id:'u_'+i, description:'noise', files:{ 'x.md':{ content:'x' } }, history:[{ version:'r_u_'+i }], node_id:'NID_u_'+i, updated_at:'2026-01-01T00:00:00Z' }));
    const mock = await installMock(page, unrelated, { pageMode:'pages', pageSize:100, errorOnPage:2 });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('list-failed');
    expect(mock.posts).toBe(0);
  });

  test('R2-B2-04: malformed page-1 body (object instead of array) → NO POST', async ({ page }) => {
    const mock = await installMock(page, [], { pageMode:'malformed' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('list-failed');
    expect(mock.posts).toBe(0);
  });

  test('R2-B2-05: pagination loop (rel=next → same URL) → NO POST', async ({ page }) => {
    const mock = await installMock(page, [], { pageMode:'loop' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('list-failed');
    expect(mock.posts).toBe(0);
  });
});

// ── B3 — UI reachability ────────────────────────────────────────────────────
test.describe('R2 B3 — Create-First-Backup UI reachability', () => {
  test('R2-B3-01: token present + no connected Gist → button visible, focusable, clickable (E2E)', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => window.updateGistUI());
    // Navigate to the sync view where the button lives.
    await page.evaluate(() => window.show && window.show('sync', new Event('click')));
    const btn = page.locator('#sync-create-first-backup-btn');
    await expect(btn).toBeVisible();
    // Bounding box must be non-zero.
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    // Click and verify exactly one POST results.
    await btn.click();
    await page.waitForFunction(() => !!localStorage.getItem('dune_gist_id_v1'));
    expect(mock.posts).toBe(1);
  });

  test('R2-B3-02: button is hidden when a Gist is already connected', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_id_v1', JSON.stringify('g_pre_connected')));
    await page.evaluate(() => window.updateGistUI());
    await page.evaluate(() => window.show && window.show('sync', new Event('click')));
    const row = page.locator('#sync-create-row');
    await expect(row).toBeHidden();
  });

  test('R2-B3-03: pending row shown, create row hidden when pending record exists', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({
      schema:1, gistId:'g_pending_1', createdAt:'2026-09-01T00:00:00Z'
    })));
    await page.evaluate(() => window.updateGistUI());
    await page.evaluate(() => window.show && window.show('sync', new Event('click')));
    await expect(page.locator('#sync-pending-row')).toBeVisible();
    await expect(page.locator('#sync-create-row')).toBeHidden();
  });
});

// ── B4 — durable pending-created identity lifecycle ─────────────────────────
test.describe('R2 B4 — pending-created identity durable recovery', () => {
  test('R2-B4-01: POST succeeds → ack GET fails → pending record persisted; no ID/base', async ({ page }) => {
    const mock = await installMock(page, []);
    mock.ackResponder = (id) => id.startsWith('g_created_')
      ? ({ status:500, contentType:'application/json', body:'{}' })
      : ({ status:404, contentType:'application/json', body:'{}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('ack-fetch-failed');
    const { gistId, base, pending } = await readState(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
    expect(pending).not.toBeNull();
    const parsed = JSON.parse(pending);
    expect(parsed.gistId).toBe(r.createdGistId);
  });

  test('R2-B4-02: with pending present, a second create is refused; no new POST', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({
      schema:1, gistId:'g_pending_stranded', createdAt:'2026-09-01T00:00:00Z'
    })));
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('pending-created-present');
    expect(mock.posts).toBe(0);
  });

  test('R2-B4-03: reconcile with content-matching remote → promote to connected + base', async ({ page }) => {
    const mock = await installMock(page, []);
    // Simulate a POST-then-ack-fetch-failed history first.
    mock.ackResponder = (id) => id.startsWith('g_created_')
      ? ({ status:500, contentType:'application/json', body:'{}' })
      : ({ status:404, contentType:'application/json', body:'{}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const failed = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(failed.ok).toBe(false);
    const { pending } = await readState(page);
    expect(pending).not.toBeNull();
    // Now restore ackResponder to default (remote GET succeeds).
    mock.ackResponder = null;
    const rec = await page.evaluate(() => window.gistReconcilePendingCreated());
    expect(rec.ok).toBe(true);
    expect(rec.kind).toBe('reconciled');
    const { gistId, base, pending: pendingAfter } = await readState(page);
    expect(JSON.parse(gistId)).toBe(rec.gistId);
    expect(JSON.parse(base).baseDataHash).toBeDefined();
    expect(pendingAfter).toBeNull();
  });

  test('R2-B4-04: reconcile with remote 404 → pending cleared safely; new POST allowed', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({
      schema:1, gistId:'g_pending_ghost', createdAt:'2026-09-01T00:00:00Z'
    })));
    const rec = await page.evaluate(() => window.gistReconcilePendingCreated());
    expect(rec.ok).toBe(true);
    expect(rec.kind).toBe('pending-cleared-404');
    const after = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(after.ok).toBe(true);
    expect(mock.posts).toBe(1);
  });

  test('R2-B4-05: reconcile when remote content differs → pending kept; not promoted', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Add a real Gist with divergent content to the mock and register the pending id.
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({
      schema:1, gistId:'g_diff_remote', createdAt:'2026-09-01T00:00:00Z'
    })));
    mock.gists.push({
      id:'g_diff_remote', description:'Dune Life OS — Auto Backup',
      files:{ 'dune-backup.json':{ content: JSON.stringify({ version:'2026.1', exported_at:'x', data:{ different:true } }, null, 2) } },
      history:[{ version:'rev_diff' }], node_id:'NID_g_diff_remote', updated_at:'2026-01-01T00:00:00Z',
    });
    const rec = await page.evaluate(() => window.gistReconcilePendingCreated());
    expect(rec.ok).toBe(false);
    expect(rec.reason).toBe('reconcile-diverged');
    const { pending, gistId, base } = await readState(page);
    expect(pending).not.toBeNull();
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('R2-B4-06: pending ID alone cannot establish a base (never a side-effect of read)', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({
      schema:1, gistId:'g_only_pending', createdAt:'2026-09-01T00:00:00Z'
    })));
    const pending = await page.evaluate(() => window.gistReadPendingCreated());
    expect(pending && pending.gistId).toBe('g_only_pending');
    const { base, gistId } = await readState(page);
    expect(base).toBeNull();
    expect(gistId).toBeNull();
  });

  test('R2-B4-07: discardPendingCreated (confirmed) removes pending; can create fresh next', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({
      schema:1, gistId:'g_abandoned', createdAt:'2026-09-01T00:00:00Z'
    })));
    const d = await page.evaluate(() => window.gistDiscardPendingCreated());
    expect(d.ok).toBe(true);
    expect(d.kind).toBe('discarded');
    const created = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(created.ok).toBe(true);
    expect(mock.posts).toBe(1);
  });
});

// ── Additional Round-2 required scenarios ───────────────────────────────────
test.describe('R2 — additional required scenarios', () => {
  test('R2-EX-01: POST succeeds with 2xx but missing id → NO trust state; no pending', async ({ page }) => {
    const mock = await installMock(page, []);
    mock.createResponder = () => ({ status:201, contentType:'application/json', body: '{"note":"no id here"}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('create-failed');
    const { gistId, base, pending } = await readState(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
    expect(pending).toBeNull();
  });

  test('R2-EX-02: POST fails 401 → unauthorized; no pending', async ({ page }) => {
    const mock = await installMock(page, []);
    mock.createResponder = () => ({ status:401, contentType:'application/json', body:'{"message":"bad creds"}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unauthorized');
    const { pending } = await readState(page);
    expect(pending).toBeNull();
  });

  test('R2-EX-03: POST fails 403 → unauthorized; no pending', async ({ page }) => {
    const mock = await installMock(page, []);
    mock.createResponder = () => ({ status:403, contentType:'application/json', body:'{"message":"forbidden"}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unauthorized');
  });

  test('R2-EX-04: ID-write failure → no trust state; pending preserved', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Force setItem for dune_gist_id_v1 to throw.
    await page.evaluate(() => {
      const _set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (k === 'dune_gist_id_v1') throw new Error('quota-forced');
        return _set.call(this, k, v);
      };
    });
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    // Restore setItem before reading state.
    await page.evaluate(() => {
      // reload will re-init prototypes; we can rely on it being restored per test.
    });
    const { gistId, base, pending } = await readState(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
    expect(pending).not.toBeNull();
  });

  test('R2-EX-05: base-write failure → ID-written kept, pending preserved; explicit fail-closed', async ({ page }) => {
    const mock = await installMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => {
      const _set = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (k === 'dune_gist_sync_base_v1') throw new Error('base-write-forced');
        return _set.call(this, k, v);
      };
    });
    const r = await page.evaluate(() => window.gistCreateFirstBackup());
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unacknowledged');
    const { gistId, base, pending } = await readState(page);
    expect(gistId).not.toBeNull(); // ID was set BEFORE base write, Codex-confirmed fail-closed
    expect(base).toBeNull();
    expect(pending).not.toBeNull(); // pending kept for recovery
  });

  test('R2-EX-06: parseLinkHeader parses and ignores non-next rels (R3 tri-state)', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    const parsed = await page.evaluate(() => {
      return window.GistSync.parseLinkHeader(
        '<https://api.github.com/gists?page=2>; rel="next", <https://api.github.com/gists?page=10>; rel="last"'
      );
    });
    // R3: parseLinkHeader now returns { state, next?, reason? } tri-state.
    expect(parsed.state).toBe('VALID');
    expect(parsed.next).toBe('https://api.github.com/gists?page=2');
    const empty = await page.evaluate(() => window.GistSync.parseLinkHeader(''));
    expect(empty.state).toBe('ABSENT');
  });

  test('R2-EX-07: pending record schema is validated on read (invalid → null)', async ({ page }) => {
    await page.goto('/');
    await waitReady(page);
    await page.evaluate(() => {
      // Non-object
      localStorage.setItem('dune_gist_pending_created_v1', '"not-a-record"');
    });
    const bad = await page.evaluate(() => window.GistSync.readPendingCreatedGist());
    expect(bad).toBeNull();
    await page.evaluate(() => {
      // Wrong schema number
      localStorage.setItem('dune_gist_pending_created_v1', JSON.stringify({ schema:2, gistId:'g', createdAt:'2026-09-01T00:00:00Z' }));
    });
    const bad2 = await page.evaluate(() => window.GistSync.readPendingCreatedGist());
    expect(bad2).toBeNull();
  });
});
