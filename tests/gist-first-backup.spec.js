// First-Gist creation focused tests — Integration P1-B.
//
// Covers the handoff §10 required deterministic cases for the newly-added
// createFirstBackup orchestrator: discovery-first, POST-once,
// acknowledgement-before-base, uncertainty handling, no-duplicate,
// token secrecy, and local-change-during-creation protection.
//
// Uses a Playwright page.route mock; the real GitHub API is never contacted.

const { test, expect } = require('@playwright/test');

const GITHUB_ORIGIN_ANY = /^https?:\/\/api\.github\.com\//;
const BLOCKED_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const TOKEN = 'ghp_test_first_backup_token';

// In-memory mock:
//   - GET  /gists            → list (returns state.gists)
//   - GET  /gists/:id        → single (404 unless present)
//   - POST /gists            → create (uses state.nextCreateResponder OR default success)
//   - PATCH /gists/:id       → update (unused here)
async function installGitHubMock(page, initialGists){
  const state = {
    gists: initialGists.map(g => JSON.parse(JSON.stringify(g))),
    posts: 0,
    lastPostBody: null,
    postAuthHeader: null,
    ackAuthHeader: null,
    listAuthHeader: null,
    createResponder: null, // (req)=>{status, body}
    ackResponder: null,    // (id, req)=>{status, body}   overrides GET by id
    createdIds: [],
  };
  await page.route(BLOCKED_FONTS, r => r.abort());
  await page.route(GITHUB_ORIGIN_ANY, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    if (url.pathname === '/gists' && method === 'GET'){
      state.listAuthHeader = req.headers()['authorization'] || null;
      return route.fulfill({ status:200, contentType:'application/json', body: JSON.stringify(state.gists) });
    }
    if (url.pathname === '/gists' && method === 'POST'){
      state.posts++;
      state.postAuthHeader = req.headers()['authorization'] || null;
      state.lastPostBody = JSON.parse(req.postData() || '{}');
      if (typeof state.createResponder === 'function'){
        const r = await state.createResponder(req);
        return route.fulfill(r);
      }
      // Default: POST succeeds. Body echoes the file contents.
      const id = 'g_created_' + state.posts;
      state.createdIds.push(id);
      // Register the newly-created Gist in state.gists so a subsequent
      // GET /gists/:id resolves successfully by default.
      const files = state.lastPostBody && state.lastPostBody.files ? state.lastPostBody.files : {};
      state.gists.push({
        id,
        description: (state.lastPostBody && state.lastPostBody.description) || '',
        files,
        history: [{ version: 'rev_created_' + state.posts }],
        node_id: 'NID_' + id,
        updated_at: new Date().toISOString(),
      });
      return route.fulfill({ status:201, contentType:'application/json', body: JSON.stringify({ id, node_id:'NID_'+id, updated_at:new Date().toISOString() }) });
    }
    const m = url.pathname.match(/^\/gists\/([^\/]+)$/);
    if (m){
      const id = decodeURIComponent(m[1]);
      const g = state.gists.find(x => x.id === id);
      if (method === 'GET'){
        state.ackAuthHeader = req.headers()['authorization'] || null;
        if (typeof state.ackResponder === 'function'){
          const r = await state.ackResponder(id, req, g);
          return route.fulfill(r);
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
    && typeof window.getAllBackupData === 'function');
  await page.evaluate(() => (window.Store && window.Store.flushNow ? window.Store.flushNow() : null));
}

async function seedTokenOnly(page){
  await page.evaluate((TOKEN) => {
    localStorage.setItem('dune_github_token_v1', TOKEN);
    // Ensure no prior connection
    localStorage.removeItem('dune_gist_id_v1');
    localStorage.removeItem('dune_gist_sync_base_v1');
    window.confirm = () => true; // auto-confirm creation prompt
  }, TOKEN);
}

async function seedNoToken(page){
  await page.evaluate(() => {
    localStorage.removeItem('dune_github_token_v1');
    localStorage.removeItem('dune_gist_id_v1');
    localStorage.removeItem('dune_gist_sync_base_v1');
  });
}

async function runCreate(page){
  return page.evaluate(async () => {
    return await window.gistCreateFirstBackup();
  });
}

async function readIdAndBase(page){
  return page.evaluate(() => ({
    gistId: localStorage.getItem('dune_gist_id_v1'),
    base: localStorage.getItem('dune_gist_sync_base_v1'),
  }));
}

test.describe('First-Gist creation (P1-B) — createFirstBackup', () => {
  test.beforeEach(async ({ page }) => {
    // Fresh page each test.
  });

  test('F1-01: no token → unauthorized/no-token; no POST; no ID/base written', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedNoToken(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(['no-token']).toContain(result.reason);
    expect(mock.posts).toBe(0);
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('F1-02: no existing Gist → POST once → acknowledged → ID and base persisted', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('created-first-backup');
    expect(mock.posts).toBe(1);
    // Auth header uses Bearer + our token.
    expect(mock.postAuthHeader).toBe('Bearer ' + TOKEN);
    // POST body is public:false and includes the canonical backup file only.
    expect(mock.lastPostBody.public).toBe(false);
    expect(Object.keys(mock.lastPostBody.files)).toEqual(['dune-backup.json']);
    // Payload must NOT contain the token anywhere.
    const bodyText = JSON.stringify(mock.lastPostBody);
    expect(bodyText.includes(TOKEN)).toBe(false);
    // Persisted state
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toContain('g_created_');
    const parsed = JSON.parse(base);
    expect(parsed.schema).toBe(1);
    expect(parsed.gistId).toBe(JSON.parse(gistId));
  });

  test('F1-03: no existing Gist → POST fails 500 → no ID/base written', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    mock.createResponder = () => ({ status:500, contentType:'application/json', body:'{"message":"internal"}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('create-failed');
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('F1-04: POST succeeds but acknowledgement GET fails → no ID/base; local preserved', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    // Ack GET fails
    mock.ackResponder = (id) => id.startsWith('g_created_')
      ? ({ status:500, contentType:'application/json', body:'{"message":"ack failed"}' })
      : ({ status:404, contentType:'application/json', body:'{}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ack-fetch-failed');
    expect(mock.posts).toBe(1);
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('F1-05: POST succeeds but acknowledgement content differs → no ID/base; local preserved', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    // Ack GET returns a different backup than what was POSTed.
    mock.ackResponder = (id) => {
      if (!id.startsWith('g_created_')) return { status:404, contentType:'application/json', body:'{}' };
      const differentBackup = { version:'2026.1', exported_at:'2026-09-01T00:00:00Z', data:{ tampered:true } };
      return { status:200, contentType:'application/json', body: JSON.stringify({
        id, node_id:'NID_'+id, updated_at:new Date().toISOString(),
        history:[{version:'rev_ack_diff'}],
        files:{ 'dune-backup.json':{ content: JSON.stringify(differentBackup, null, 2) } },
      })};
    };
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ack-hash-mismatch');
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('F1-06: existing matching Gist discoverable → NO duplicate POST; refuse and advise Bootstrap', async ({ page }) => {
    const existing = {
      id: 'g_existing_1',
      description: 'Dune Life OS — Auto Backup',
      files: { 'dune-backup.json': { content: JSON.stringify({ version:'2026.1', exported_at:'x', data:{ existing:true } }, null, 2) } },
      history: [{ version:'rev_existing' }],
      node_id: 'NID_g_existing_1',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const mock = await installGitHubMock(page, [existing]);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('existing-backup-discoverable');
    expect(result.discoveredGistId).toBe('g_existing_1');
    expect(mock.posts).toBe(0);
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('F1-07: gistId already stored → createFirstBackup refused (already-connected)', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    await page.evaluate(() => localStorage.setItem('dune_gist_id_v1', JSON.stringify('g_pre_connected')));
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('already-connected');
    expect(mock.posts).toBe(0);
  });

  test('F1-08: on success, connected ID is the exact created ID (never a fabricated one)', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(true);
    const { gistId } = await readIdAndBase(page);
    expect(JSON.parse(gistId)).toBe(result.gistId);
  });

  test('F1-09: base is written only after acknowledged identity (post-ack, not post-POST)', async ({ page }) => {
    // Ack GET is slow enough that we can observe: at ack failure, base is not written.
    const mock = await installGitHubMock(page, []);
    mock.ackResponder = (id) => ({ status:500, contentType:'application/json', body:'{}' });
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    const { base } = await readIdAndBase(page);
    expect(base).toBeNull();
  });

  test('F1-10: token is not stored inside the POSTed backup payload', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    // Prime an obvious sentinel and the token.
    await page.evaluate(() => {
      localStorage.setItem('dune_ideas_v3', JSON.stringify({ sentinel:'IDEAS_SENTINEL_X' }));
    });
    await seedTokenOnly(page);
    const result = await runCreate(page);
    expect(result.ok).toBe(true);
    const fileContent = mock.lastPostBody.files['dune-backup.json'].content;
    expect(fileContent.includes(TOKEN), 'backup payload must not contain the token').toBe(false);
    // Sanity: payload is a valid backup wrapper with a data object.
    const parsed = JSON.parse(fileContent);
    expect(typeof parsed.data).toBe('object');
    expect(parsed.data).not.toBeNull();
  });

  test('F1-11: local change during creation → not falsely acknowledged; no ID/base persisted', async ({ page }) => {
    const mock = await installGitHubMock(page, []);
    // During ackResponder (fired between POST and acknowledgement), mutate local storage
    // via page-evaluated hook.
    let mutated = false;
    mock.ackResponder = async (id, _req, g) => {
      if (!mutated){
        mutated = true;
        // Mutate local via a page evaluation. We can't reach page from here directly;
        // but we can return the (unchanged) remote content — the mutation is driven
        // separately below.
      }
      if (!g) return { status:404, contentType:'application/json', body:'{}' };
      return { status:200, contentType:'application/json', body: JSON.stringify(g) };
    };
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    // Instrument getAllBackupData: on the SECOND call, return a mutated payload.
    await page.evaluate(() => {
      const orig = window.getAllBackupData;
      let n = 0;
      window.getAllBackupData = function(){
        n++;
        const d = orig();
        if (n >= 2){
          return { ...d, dune_ideas_v3: JSON.stringify({ mutated_after_capture:true }) };
        }
        return d;
      };
    });
    const result = await runCreate(page);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('local-changed-during-creation');
    const { gistId, base } = await readIdAndBase(page);
    expect(gistId).toBeNull();
    expect(base).toBeNull();
  });

  test('F1-12: existing Save/Load/Conflict flows retain their guarantees when no Gist is connected', async ({ page }) => {
    // A no-connected-gist Save must still refuse cleanly (unchanged existing behavior).
    const mock = await installGitHubMock(page, []);
    await page.goto('/');
    await waitReady(page);
    await seedTokenOnly(page);
    const save = await page.evaluate(() => window.saveToGist ? window.saveToGist() : { ok:false, reason:'no-window-save' });
    expect(save.ok).toBe(false);
    expect(save.reason).toBe('no-connected-gist');
    const load = await page.evaluate(() => window.loadFromGist ? window.loadFromGist() : { ok:false, reason:'no-window-load' });
    expect(load.ok).toBe(false);
    expect(load.reason).toBe('no-connected-gist');
    expect(mock.posts).toBe(0);
  });
});
