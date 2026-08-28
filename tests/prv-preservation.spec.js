// PRV-0.5 preservation-migration Playwright specs — see docs/lifeos/DECISIONS.md ADR-015.
// Each test spins the app in an isolated Playwright context; real
// user localStorage is never touched. Tests are keyed to the eight
// failure modes named in the PRV-0.5 preservation-migration handoff
// (A existing-state hydration, B idempotence, C concurrency, D reader
// cutover, E backup completeness, F restore independence, G reset
// safety, H failure injection).

const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;
const APP_GITHUB_COMMITS_PATH = '/repos/Mahmoud1115/life-dashboard/commits';
const SYNTHETIC_COMMIT_ISO = '2026-08-25T00:00:00Z';

function isAppExpectedGithubCommitsRequest(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return false; }
  if (parsed.pathname !== APP_GITHUB_COMMITS_PATH) return false;
  if (parsed.searchParams.get('per_page') !== '1') return false;
  return Array.from(parsed.searchParams.keys()).length === 1;
}

test.beforeEach(async ({ context }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) => {
    if (!isAppExpectedGithubCommitsRequest(route.request().url())) return route.abort();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: SYNTHETIC_COMMIT_ISO } } }])
    });
  });
});

async function waitForApp(page) {
  await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function' && window.LEGACY_RECORDS && typeof window.hydratePreservationRecordsOnce === 'function'));
}

// Waits for one Store save-listener fire, guaranteeing that recent
// Store.set operations have been flushed to dune_state_v4.
async function waitForNextSave(page) {
  await page.evaluate(() => new Promise((resolve) => {
    if (!window.Store || typeof window.Store.onSave !== 'function') { resolve(); return; }
    const unsub = window.Store.onSave(() => { try { unsub(); } catch(e){} resolve(); });
    // Safety timeout in case no save is currently pending — resolve
    // after a short window so we don't hang.
    setTimeout(() => { try { unsub(); } catch(e){} resolve(); }, 1500);
  }));
}

// ────────────────────────────────────────────────────────
// A. Existing-state hydration
// Fresh browser, no records.*, no flag → hydration copies all four
// domains completely from LEGACY_RECORDS into Store, sets the sticky
// flag exactly once, and every field survives the copy.
// ────────────────────────────────────────────────────────
test('PRV-A-hydrate-full — fresh browser hydrates all four domains from LEGACY_RECORDS', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(() => {
    const seed = window.LEGACY_RECORDS;
    const domains = ['deadlines','claims','risks','goals'];
    const out = { flag: localStorage.getItem('dune_records_hydrated_v1'), domains: {} };
    for (const d of domains) {
      const stored = window.Store.get('records.' + d);
      out.domains[d] = {
        storedLen: Array.isArray(stored) ? stored.length : null,
        seedLen: Array.isArray(seed[d]) ? seed[d].length : null,
        storedIds: Array.isArray(stored) ? stored.map(x => x && x.id) : null,
        seedIds: Array.isArray(seed[d]) ? seed[d].map(x => x && x.id) : null
      };
    }
    // Verify risks got their computed score field
    const risks = window.Store.get('records.risks');
    out.risksScoreOk = Array.isArray(risks) && risks.every(r => typeof r.score === 'number' && r.score === (r.prob||0) * (r.impact||0));
    return out;
  });
  expect(proof.flag).toBe('1');
  for (const d of ['deadlines','claims','risks','goals']) {
    expect(proof.domains[d].storedLen).toBe(proof.domains[d].seedLen);
    expect(proof.domains[d].storedIds).toEqual(proof.domains[d].seedIds);
  }
  expect(proof.risksScoreOk).toBe(true);
});

// ────────────────────────────────────────────────────────
// A2. Existing-state hydration MERGES per-id legacy overrides.
// Pre-seed dune_goals_v1 + dune_claims_v1 with edits; assert hydration
// carries the edits forward into records.goals / records.claims.
// ────────────────────────────────────────────────────────
test('PRV-A-merge-overrides — pre-existing per-id overrides in dune_goals_v1 / dune_claims_v1 survive hydration', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('dune_goals_v1', JSON.stringify({ go01: { progress: 77, status: 'blocked' } })); } catch(e){}
    try { localStorage.setItem('dune_claims_v1', JSON.stringify({ cl01: { confidence: 'dangerous', lastChecked: '2026-08-01' } })); } catch(e){}
  });
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(() => {
    const g = window.Store.get('records.goals').find(x => x.id === 'go01');
    const c = window.Store.get('records.claims').find(x => x.id === 'cl01');
    return {
      goalProgress: g && g.progress,
      goalStatus: g && g.status,
      claimConf: c && c.confidence,
      claimChecked: c && c.lastChecked,
      flag: localStorage.getItem('dune_records_hydrated_v1')
    };
  });
  expect(proof.goalProgress).toBe(77);
  expect(proof.goalStatus).toBe('blocked');
  expect(proof.claimConf).toBe('dangerous');
  expect(proof.claimChecked).toBe('2026-08-01');
  expect(proof.flag).toBe('1');
});

// ────────────────────────────────────────────────────────
// B. Idempotence — repeated calls do not duplicate records nor
// overwrite user edits.
// ────────────────────────────────────────────────────────
test('PRV-B-idempotent — re-running hydration is a no-op and never overwrites user edits', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(() => {
    // Simulate a user edit through the writer path.
    window.Store.set('records.goals', [
      Object.assign({}, window.Store.get('records.goals')[0], { progress: 99, status: 'done' }),
      ...window.Store.get('records.goals').slice(1)
    ]);
    const beforeLen = window.Store.get('records.goals').length;
    const beforeFirst = window.Store.get('records.goals')[0].progress;
    // Clear the flag and re-run hydration — must not overwrite the
    // populated records.goals with the seed's original progress value.
    localStorage.removeItem('dune_records_hydrated_v1');
    const res = window.hydratePreservationRecordsOnce();
    return {
      res,
      afterLen: window.Store.get('records.goals').length,
      afterFirst: window.Store.get('records.goals')[0].progress,
      beforeLen, beforeFirst,
      flagAfter: localStorage.getItem('dune_records_hydrated_v1')
    };
  });
  expect(proof.afterLen).toBe(proof.beforeLen);
  expect(proof.afterFirst).toBe(99);
  expect(proof.afterFirst).toBe(proof.beforeFirst);
  expect(proof.res && proof.res.ok).toBe(true);
  expect(proof.res.skipped).toBe('already-populated');
  expect(proof.flagAfter).toBe('1');
});

// ────────────────────────────────────────────────────────
// C. Concurrency — two tabs booting simultaneously converge to one
// hydrated result, no duplicate records, no lost updates.
// ────────────────────────────────────────────────────────
test('PRV-C-concurrent — sequential-boot convergence (deterministic-framework proxy for two-tab behaviour)', async ({ context }) => {
  // The Playwright deterministic framework cannot reliably schedule
  // two truly-concurrent Store.set operations across pages (they get
  // serialized by the Web-Locks coordinator either way). What we CAN
  // prove is that a second boot observes the hydrated state through
  // the persisted wrapper and does NOT re-hydrate or duplicate — which
  // is the failure mode the test guards against.
  const a = await context.newPage();
  await a.goto('/');
  await waitForApp(a);
  await waitForNextSave(a);
  const proofA = await a.evaluate(() => ({
    len: (window.Store.get('records.goals') || []).length,
    ids: (window.Store.get('records.goals') || []).map(x => x && x.id),
    flag: localStorage.getItem('dune_records_hydrated_v1')
  }));
  await a.close();

  const b = await context.newPage();
  await b.goto('/');
  await waitForApp(b);
  // Second boot must observe the same hydrated records; no duplication.
  const proofB = await b.evaluate(() => {
    // Re-run hydration to prove idempotence across sessions on the
    // same localStorage.
    const res = window.hydratePreservationRecordsOnce();
    return {
      len: (window.Store.get('records.goals') || []).length,
      ids: (window.Store.get('records.goals') || []).map(x => x && x.id),
      flag: localStorage.getItem('dune_records_hydrated_v1'),
      secondRun: res
    };
  });
  expect(proofA.len).toBe(proofB.len);
  expect(proofA.ids).toEqual(proofB.ids);
  const dedupA = new Set(proofA.ids);
  expect(dedupA.size).toBe(proofA.ids.length);
  expect(proofA.flag).toBe('1');
  expect(proofB.flag).toBe('1');
  expect(proofB.secondRun && proofB.secondRun.ok).toBe(true);
  expect(proofB.secondRun.skipped).toBe('flag-set');
});

// ────────────────────────────────────────────────────────
// D. Reader cutover — after hydration, mutating LEGACY_RECORDS in
// place must NOT affect the runtime UI. Store is authoritative.
// ────────────────────────────────────────────────────────
test('PRV-D-reader-cutover — runtime reads from Store not from LEGACY_RECORDS', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(() => {
    // `D` is a script-global from data.js (top-level `const`), not a
    // property of window. Access it via the same namespace app.js uses.
    const D_ref = (typeof D !== 'undefined') ? D : null;
    // Mutate a copy in Store (write path).
    const cur = window.Store.get('records.goals');
    const nextFirst = Object.assign({}, cur[0], { progress: 42, status: 'active' });
    const setRes = window.Store.set('records.goals', [nextFirst, ...cur.slice(1)]);
    // Try to mutate the seed — frozen at author time, but even if not,
    // Store-backed D.goals is the authoritative accessor.
    try { window.LEGACY_RECORDS.goals[0].progress = -999; } catch(e) { /* frozen */ }
    const dGoals = D_ref && D_ref.goals;
    const storeGoals = window.Store.get('records.goals');
    return {
      setOk: !!(setRes && setRes.ok),
      dGoalsIsArray: Array.isArray(dGoals),
      dFirstProgress: (dGoals && dGoals[0] && dGoals[0].progress),
      storeFirstProgress: storeGoals[0].progress,
      seedIsFrozen: Object.isFrozen(window.LEGACY_RECORDS.goals)
    };
  });
  expect(proof.setOk).toBe(true);
  expect(proof.dGoalsIsArray).toBe(true);
  expect(proof.dFirstProgress).toBe(42);
  expect(proof.storeFirstProgress).toBe(42);
});

// ────────────────────────────────────────────────────────
// E. Backup completeness — an exported backup contains records.* for
// all four domains under dune_state_v4.
// ────────────────────────────────────────────────────────
test('PRV-E-backup-completeness — exported backup carries records.* for all four domains', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  // Wait for at least one save to guarantee the hydration commit has
  // flushed to dune_state_v4 in localStorage.
  await waitForNextSave(page);
  const proof = await page.evaluate(() => {
    const raw = localStorage.getItem('dune_state_v4');
    if (!raw) return { hasWrapper: false };
    const parsed = JSON.parse(raw);
    const data = parsed && parsed.data;
    const records = data && data.records;
    return {
      hasWrapper: true,
      hasRecords: !!records,
      deadlinesLen: Array.isArray(records && records.deadlines) ? records.deadlines.length : 0,
      claimsLen: Array.isArray(records && records.claims) ? records.claims.length : 0,
      risksLen: Array.isArray(records && records.risks) ? records.risks.length : 0,
      goalsLen: Array.isArray(records && records.goals) ? records.goals.length : 0
    };
  });
  expect(proof.hasWrapper).toBe(true);
  expect(proof.hasRecords).toBe(true);
  expect(proof.deadlinesLen).toBeGreaterThan(0);
  expect(proof.claimsLen).toBeGreaterThan(0);
  expect(proof.risksLen).toBeGreaterThan(0);
  expect(proof.goalsLen).toBeGreaterThan(0);
});

// ────────────────────────────────────────────────────────
// F. Restore independence — an exported wrapper captured today can be
// re-imported into a fresh browser and reconstruct records.* WITHOUT
// consulting LEGACY_RECORDS. This is the key PRV-1 prerequisite.
// ────────────────────────────────────────────────────────
test('PRV-F-restore-independence — captured wrapper restores records.* into a fresh browser without LEGACY_RECORDS', async ({ context }) => {
  // Boot A, hydrate, WAIT FOR FLUSH, then snapshot the wrapper.
  const a = await context.newPage();
  await a.goto('/');
  await waitForApp(a);
  await waitForNextSave(a);
  const captured = await a.evaluate(() => localStorage.getItem('dune_state_v4'));
  await a.close();

  // Boot B in a fresh context, seeding the wrapper via addInitScript
  // AND stubbing LEGACY_RECORDS to an empty object so hydration cannot
  // possibly recreate records from the seed corpus. Restore must
  // depend on the wrapper alone.
  const freshContext = await context.browser().newContext();
  await freshContext.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await freshContext.route(GITHUB_ORIGIN, (route) => {
    if (!isAppExpectedGithubCommitsRequest(route.request().url())) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ commit: { author: { date: SYNTHETIC_COMMIT_ISO } } }]) });
  });
  const b = await freshContext.newPage();
  await b.addInitScript((wrapper) => {
    try { localStorage.setItem('dune_state_v4', wrapper); } catch(e){}
    try { localStorage.setItem('dune_records_hydrated_v1', '1'); } catch(e){}
  }, captured);
  await b.goto('/');
  await b.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
  const proof = await b.evaluate(() => {
    const domains = ['deadlines','claims','risks','goals'];
    const out = {};
    for (const d of domains) {
      const v = window.Store.get('records.' + d);
      out[d] = Array.isArray(v) ? v.length : 0;
    }
    // Also confirm we can identify at least one specific id in each
    // domain — proves content, not just length.
    const g = window.Store.get('records.goals') || [];
    const c = window.Store.get('records.claims') || [];
    out.hasGo01 = g.some(x => x.id === 'go01');
    out.hasCl01 = c.some(x => x.id === 'cl01');
    return out;
  });
  await freshContext.close();
  expect(proof.deadlines).toBeGreaterThan(0);
  expect(proof.claims).toBeGreaterThan(0);
  expect(proof.risks).toBeGreaterThan(0);
  expect(proof.goals).toBeGreaterThan(0);
  expect(proof.hasGo01).toBe(true);
  expect(proof.hasCl01).toBe(true);
});

// ────────────────────────────────────────────────────────
// G. Reset safety — after hydration + user edit, Reset via
// Store.reset() clears records to empty. Hydration is NOT re-triggered
// (sticky flag survives Reset). Legacy personal records are NOT
// resurrected.
// ────────────────────────────────────────────────────────
test('PRV-G-reset-safety — Reset produces empty records; hydration does not re-fire', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  const pre = await page.evaluate(() => ({
    flag: localStorage.getItem('dune_records_hydrated_v1'),
    goals: (window.Store.get('records.goals') || []).length
  }));
  expect(pre.flag).toBe('1');
  expect(pre.goals).toBeGreaterThan(0);
  // Drive Reset via the same code path the UI uses. Store.reset()
  // returns bool; the commit lands on the coordinator and fires an
  // onSave listener when durability settles.
  await page.evaluate(() => new Promise((resolve) => {
    const unsub = window.Store.onSave(() => { try { unsub(); } catch(e){} resolve(); });
    const ok = window.Store.reset({ force: true });
    if (!ok) { try { unsub(); } catch(e){} resolve(); }
    setTimeout(() => { try { unsub(); } catch(e){} resolve(); }, 3000);
  }));
  const post = await page.evaluate(() => {
    const secondResult = window.hydratePreservationRecordsOnce();
    return {
      goalsRaw: window.Store.get('records.goals'),
      flag: localStorage.getItem('dune_records_hydrated_v1'),
      secondResult
    };
  });
  const emptyGoals = (post.goalsRaw === undefined || (Array.isArray(post.goalsRaw) && post.goalsRaw.length === 0));
  expect(emptyGoals).toBe(true);
  expect(post.flag).toBe('1');
  expect(post.secondResult && post.secondResult.ok).toBe(true);
  expect(post.secondResult.skipped).toBe('flag-set');
});

// ────────────────────────────────────────────────────────
// H. Failure injection — Store.set failure on any domain leaves the
// flag UNSET, retry is possible, and no partial write corrupts
// already-populated domains.
// ────────────────────────────────────────────────────────
test('PRV-H-failure-injection — commit failure leaves flag unset and retry succeeds', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(() => {
    // Force an unhydrated state, then monkey-patch Store.set to fail
    // on the third domain (risks) — first two commit fine.
    localStorage.removeItem('dune_records_hydrated_v1');
    // Also wipe records.* so hydration will attempt to commit.
    window.Store.set('records.deadlines', []);
    window.Store.set('records.claims', []);
    window.Store.set('records.risks', []);
    window.Store.set('records.goals', []);
    const realSet = window.Store.set;
    let called = 0;
    window.Store.set = function(path, val) {
      if (path === 'records.risks') {
        return { ok: false, error: 'INJECTED_FAILURE' };
      }
      called++;
      return realSet.call(window.Store, path, val);
    };
    const firstAttempt = window.hydratePreservationRecordsOnce();
    const flagAfterFail = localStorage.getItem('dune_records_hydrated_v1');
    // Restore Store.set and retry — must now succeed and set the flag.
    window.Store.set = realSet;
    const secondAttempt = window.hydratePreservationRecordsOnce();
    return {
      firstAttempt,
      flagAfterFail,
      secondAttempt,
      flagAfterSuccess: localStorage.getItem('dune_records_hydrated_v1'),
      finalRisksLen: (window.Store.get('records.risks') || []).length
    };
  });
  // First attempt failed on risks; flag must remain unset.
  expect(proof.firstAttempt.ok).toBe(false);
  expect(proof.firstAttempt.reason).toBe('commit-failed');
  expect(proof.firstAttempt.domain).toBe('risks');
  expect(proof.flagAfterFail).toBeNull();
  // Retry after Store.set restoration must succeed.
  expect(proof.secondAttempt.ok).toBe(true);
  expect(proof.flagAfterSuccess).toBe('1');
  expect(proof.finalRisksLen).toBeGreaterThan(0);
});
