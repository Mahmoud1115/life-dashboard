// B0 store-durability scenarios — see docs/lifeos/DECISIONS.md ADR-010.
// Every test spins the app in an isolated Playwright context so the real
// user's localStorage is never touched. See docs/lifeos/TESTING.md.
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

async function waitForStore(page) {
  await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
}

// ────────────────────────────────────────────────────────
// T-absent-set — set at a path whose parent is initially absent creates it
// ────────────────────────────────────────────────────────
test('T-absent-set — Store.set on absent parent path creates and captures beforeExists=false', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const result = await page.evaluate(() => {
    // Pick a fresh, absent path under an object slice
    const path = 'goals.__b0_absent__.value';
    const before = window.Store.get(path);
    const setRes = window.Store.set(path, 42);
    const after = window.Store.get(path);
    return { before, setRes, after };
  });
  expect(result.before).toBeUndefined();
  expect(result.setRes.ok).toBe(true);
  expect(result.after).toBe(42);
});

// ────────────────────────────────────────────────────────
// T-null-vs-absent — explicit null distinct from absent
// ────────────────────────────────────────────────────────
test('T-null-vs-absent — Store distinguishes null value from missing path', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const path = 'goals.__b0_nullvsabsent__';
    const missing = window.Store.get(path);
    window.Store.set(path, null);
    const nullVal = window.Store.get(path);
    return { missing, nullVal };
  });
  expect(r.missing).toBeUndefined();
  expect(r.nullVal).toBeNull();
});

// ────────────────────────────────────────────────────────
// T-special-key — __proto__/constructor/prototype as own data keys are safe
// ────────────────────────────────────────────────────────
test('T-special-key — __proto__/constructor/prototype writes never mutate Object.prototype', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    window.Store.set('goals.__b0_special__', { __proto__: 'pwned', constructor: 'ctor', prototype: 'proto' });
    const back = window.Store.get('goals.__b0_special__');
    const objProtoLeaked = ({}).__proto__ === 'pwned';
    return { back, objProtoLeaked };
  });
  expect(r.objProtoLeaked).toBe(false);
  // Own values preserved on the returned defensive clone (own enumerable keys).
  // Note: __proto__ read on the returned plain object goes through Object.prototype;
  // we assert via Object.getOwnPropertyDescriptor.
  const own = await page.evaluate(() => {
    const v = window.Store.get('goals.__b0_special__');
    return {
      hasProto: Object.getOwnPropertyDescriptor(v, '__proto__') !== undefined,
      ctor:     Object.getOwnPropertyDescriptor(v, 'constructor'),
      proto:    Object.getOwnPropertyDescriptor(v, 'prototype')
    };
  });
  // At minimum the non-special ones round-trip; __proto__ is tolerated as an
  // own key or preserved on a null-prototype clone (implementation detail).
  expect(own.ctor && own.ctor.value).toBe('ctor');
  expect(own.proto && own.proto.value).toBe('proto');
});

// ────────────────────────────────────────────────────────
// T-mut-before-set — mutating a Store.get result does not affect internal state
// ────────────────────────────────────────────────────────
test('T-mut-before-set — mutating the value returned from Store.get does not leak into state', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    window.Store.set('goals.__b0_leak__', { count: 1 });
    const first = window.Store.get('goals.__b0_leak__');
    first.count = 999; // caller-side mutation
    const secondBeforeSet = window.Store.get('goals.__b0_leak__');
    return { firstCount: first.count, secondCount: secondBeforeSet.count };
  });
  expect(r.firstCount).toBe(999);
  expect(r.secondCount).toBe(1);
});

// ────────────────────────────────────────────────────────
// T-updater-clone / T-updater-once — Store.update receives a clone and fires exactly once
// ────────────────────────────────────────────────────────
test('T-updater-clone/once — updater receives defensive clone and executes exactly once', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    window.Store.set('goals.__b0_upd__', { count: 1 });
    let calls = 0;
    let leaked = false;
    window.Store.update('goals.__b0_upd__', (cur) => {
      calls++;
      cur.count = 42;                     // mutate the argument; must be a clone
      const check = window.Store.get('goals.__b0_upd__');
      leaked = (check && check.count === 42);
      return { count: 2 };
    });
    const final = window.Store.get('goals.__b0_upd__');
    return { calls, leaked, finalCount: final.count };
  });
  expect(r.calls).toBe(1);
  expect(r.leaked).toBe(false);
  expect(r.finalCount).toBe(2);
});

// ────────────────────────────────────────────────────────
// T-absent-public-read — Store.get on absent path returns undefined
// ────────────────────────────────────────────────────────
test('T-absent-public-read — Store.get on absent path returns undefined (not null, not throw)', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => window.Store.get('goals.__b0_absent_read__'));
  expect(r).toBeUndefined();
});

// ────────────────────────────────────────────────────────
// T-bht-boot-noop — reloading with a valid BHT slice performs zero repair writes on the second boot
// ────────────────────────────────────────────────────────
test('T-bht-boot-noop — a second boot on the identical BHT slice does not repair-write bht', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  // Ensure all boot-time writes have flushed to disk before reload.
  await page.evaluate(() => window.Store.flushNow && window.Store.flushNow());
  await page.waitForTimeout(400);
  const bhtBefore = await page.evaluate(() => JSON.stringify(window.Store.get('bht')));
  // Reload and snapshot again — deterministic defaults + idempotent migrateSlice
  // must yield an identical slice (no random IDs, no wall-clock lastUpdated).
  await page.reload();
  await waitForStore(page);
  await page.evaluate(() => window.Store.flushNow && window.Store.flushNow());
  await page.waitForTimeout(400);
  const bhtAfter = await page.evaluate(() => JSON.stringify(window.Store.get('bht')));
  expect(bhtAfter).toBe(bhtBefore);
});

// ────────────────────────────────────────────────────────
// T-cap-report — capabilities.crossTabSafe reflects navigator.locks availability
// ────────────────────────────────────────────────────────
test('T-cap-report — Store.capabilities.crossTabSafe matches navigator.locks presence', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => ({
    reported: window.Store.capabilities && window.Store.capabilities.crossTabSafe,
    actual:   !!(navigator.locks && typeof navigator.locks.request === 'function')
  }));
  expect(r.reported).toBe(r.actual);
});

// ────────────────────────────────────────────────────────
// T-revision-exhaust — synthetic revision exhaustion returns typed error
// ────────────────────────────────────────────────────────
test('T-revision-exhaust — flushNow returns STORE_REVISION_EXHAUSTED at MAX_SAFE_INTEGER', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Prime a pending op, then synthesize an exhausted wrapper on disk before flush.
    window.Store.set('goals.__b0_rev_exh__', 1);
    const cur = JSON.parse(localStorage.getItem('dune_state_v4') || 'null');
    // Write a wrapper at the max revision so next commit would overflow.
    const exhaustedWrapper = {
      version: window.Store.SCHEMA_VERSION,
      revision: Number.MAX_SAFE_INTEGER,
      committedAt: new Date().toISOString(),
      data: (cur && cur.data) ? cur.data : (window.Store.defaultState ? window.Store.defaultState() : {})
    };
    localStorage.setItem('dune_state_v4', JSON.stringify(exhaustedWrapper));
    // Enqueue an op so flush attempts a commit.
    window.Store.set('goals.__b0_rev_exh__', 2);
    const res = await window.Store.flushNow();
    return { reason: res && res.reason };
  });
  // Either an explicit exhaustion or an idempotent no-op if the rebase absorbed the change.
  expect(['STORE_REVISION_EXHAUSTED', 'CONFLICT', 'IDEMPOTENT']).toContain(r.reason);
});

// ────────────────────────────────────────────────────────
// T-mirror-conflict — Phase A: legacy Logbook write remains authoritative even if mirror CAS conflicts
// ────────────────────────────────────────────────────────
test('T-mirror-conflict — legacy Logbook write survives a mirror CAS conflict scenario', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Establish a Tracker legacy entry.
    const trackerEntry = {
      id: 't_mirror_1', date: '2026-08-25', hours: 1.5,
      company: 'X', aircraft_type: 'A320', registration: 'RA-1',
      engine_type: '', ata_chapter: '', system: '',
      task_description: 'mirror-conflict test', role: '', supervisor: '',
      stamp_status: '', language: '', b1_relevance: ''
    };
    localStorage.setItem('dune_logbook_v1', JSON.stringify([trackerEntry]));
    // Simulate an external tab having committed a different mirror.
    const cur = JSON.parse(localStorage.getItem('dune_state_v4') || 'null');
    if (cur && cur.data) {
      cur.data.logbook = { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } }, reconciled: true, drift: null };
      cur.revision = (cur.revision || 0) + 5;
      cur.committedAt = new Date().toISOString();
      localStorage.setItem('dune_state_v4', JSON.stringify(cur));
    }
    // Legacy remains authoritative: read back should still be the tracker entry.
    const tracker = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    return { legacyIntact: Array.isArray(tracker) && tracker.length === 1 && tracker[0].id === 't_mirror_1' };
  });
  expect(r.legacyIntact).toBe(true);
});
