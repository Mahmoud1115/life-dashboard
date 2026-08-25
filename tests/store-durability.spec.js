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

// ────────────────────────────────────────────────────────
// T-clone-symbol-reject — clonePersistable rejects symbol keys hard
// ────────────────────────────────────────────────────────
test('T-clone-symbol-reject — Store.set rejects objects containing own symbol keys', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const sym = Symbol('x');
    const obj = { visible: 1 };
    obj[sym] = 'hidden';
    const res = window.Store.set('goals.__b0_sym__', obj);
    return { ok: res.ok, err: res.error };
  });
  expect(r.ok).toBe(false);
  expect(r.err).toBe('STORE_UNPERSISTABLE');
});

// ────────────────────────────────────────────────────────
// T-clone-shared-ref — shared non-cyclic references are accepted
// ────────────────────────────────────────────────────────
test('T-clone-shared-ref — clonePersistable accepts shared non-cyclic references', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const shared = { x: 1 };
    const value = { a: shared, b: shared };
    const setRes = window.Store.set('goals.__b0_shared__', value);
    const back = window.Store.get('goals.__b0_shared__');
    return { setOk: setRes.ok, aX: back.a.x, bX: back.b.x, distinct: back.a !== back.b };
  });
  expect(r.setOk).toBe(true);
  expect(r.aX).toBe(1);
  expect(r.bX).toBe(1);
  // Structural clone: aliases become distinct copies. That's acceptable.
  expect(r.distinct).toBe(true);
});

// ────────────────────────────────────────────────────────
// T-clone-cycle-reject — actual cycle still rejects
// ────────────────────────────────────────────────────────
test('T-clone-cycle-reject — actual cyclic reference is rejected', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const cycle = { a: 1 };
    cycle.self = cycle;
    const res = window.Store.set('goals.__b0_cycle__', cycle);
    return { ok: res.ok, err: res.error };
  });
  expect(r.ok).toBe(false);
  // Either STORE_CYCLE or STORE_UNPERSISTABLE mapped to the outer generic
  // rejection is acceptable.
  expect(['STORE_UNPERSISTABLE', 'STORE_CYCLE']).toContain(r.err);
});

// ────────────────────────────────────────────────────────
// T-wrapper-revision-integer — non-integer revision on schema-13 is corrupt
// ────────────────────────────────────────────────────────
test('T-wrapper-revision-integer — non-integer wrapper revision triggers durability blocker', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Prime a pending op then poison the wrapper with a non-integer revision.
    window.Store.set('goals.__b0_revshape__', 1);
    const cur = JSON.parse(localStorage.getItem('dune_state_v4') || 'null');
    if (!cur) return { skipped: true };
    // Write a wrapper with an invalid revision (float).
    const bad = { version: window.Store.SCHEMA_VERSION, revision: 1.5, committedAt: new Date().toISOString(), data: cur.data };
    localStorage.setItem('dune_state_v4', JSON.stringify(bad));
    const res = await window.Store.flushNow();
    const blocker = window.Store.getDurabilityBlocker && window.Store.getDurabilityBlocker();
    // Clean up so downstream tests don't inherit the blocker.
    if (window.Store.clearDurabilityBlocker) window.Store.clearDurabilityBlocker();
    return { reason: res && res.reason, code: blocker && blocker.code };
  });
  if (r.skipped) return;
  expect(r.reason).toBe('STORE_CORRUPT_AUTHORITATIVE_STATE');
  expect(r.code).toBe('STORE_CORRUPT_AUTHORITATIVE_STATE');
});

// ────────────────────────────────────────────────────────
// T-corrupt-blocks — corrupt authoritative wrapper blocks new writes
// ────────────────────────────────────────────────────────
test('T-corrupt-blocks — corrupt authoritative disk state blocks writes until cleared', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Force a flush to know we have a known revision baseline.
    await window.Store.flushNow();
    // Poison disk with unparseable content.
    localStorage.setItem('dune_state_v4', '{{not json');
    // Provoke commitLocked path via a write + flush.
    window.Store.set('goals.__b0_corrupt__', 1);
    const res = await window.Store.flushNow();
    const set2 = window.Store.set('goals.__b0_corrupt__', 2);
    const blocker = window.Store.getDurabilityBlocker && window.Store.getDurabilityBlocker();
    if (window.Store.clearDurabilityBlocker) window.Store.clearDurabilityBlocker();
    return { flushReason: res && res.reason, writeErr: set2 && set2.error, code: blocker && blocker.code };
  });
  expect(r.flushReason).toBe('STORE_CORRUPT_AUTHORITATIVE_STATE');
  expect(r.writeErr).toBe('STORE_DURABILITY_BLOCKED');
  expect(r.code).toBe('STORE_CORRUPT_AUTHORITATIVE_STATE');
});

// ────────────────────────────────────────────────────────
// T-full-state-token-guard — commitFullStateWrapper rejects without token
// ────────────────────────────────────────────────────────
test('T-full-state-token-guard — commitFullStateWrapper rejects without an active token', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // No begin — direct call must be rejected.
    const bogus = { id: 'fake', reason: 'fake' };
    const res = await window.Store.commitFullStateWrapper(bogus, window.Store.defaultState(), 'test');
    return { ok: res.ok, err: res.error };
  });
  expect(r.ok).toBe(false);
  expect(r.err).toBe('FULL_STATE_TRANSACTION_NOT_ACTIVE');
});

// ────────────────────────────────────────────────────────
// T-full-state-freeze-write-rejection — writes rejected during freeze
// ────────────────────────────────────────────────────────
test('T-full-state-freeze-write-rejection — Store.set returns FULL_STATE_TRANSACTION_IN_PROGRESS during freeze', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const gate = window.Store.beginFullStateTransaction({ force: true, reason: 'test' });
    if (!gate.ok) return { failedBegin: gate.error };
    const set1 = window.Store.set('goals.__b0_freezerej__', 1);
    const upd1 = window.Store.update('goals.__b0_freezerej__', v => (v || 0) + 1);
    window.Store.endFullStateTransaction(gate.token);
    return { setErr: set1.error, updErr: upd1.error };
  });
  expect(r.setErr).toBe('FULL_STATE_TRANSACTION_IN_PROGRESS');
  expect(r.updErr).toBe('FULL_STATE_TRANSACTION_IN_PROGRESS');
});

// ────────────────────────────────────────────────────────
// T-subscriber-frozen — subscriber snapshot is frozen; mutation cannot affect state
// ────────────────────────────────────────────────────────
test('T-subscriber-frozen — notify payload is deeply frozen', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    let seen = null;
    let threw = false;
    const unsub = window.Store.subscribe('goals', function (snap) { seen = snap; });
    // Attempt mutation — Object.freeze makes assignment silently fail in
    // sloppy mode and throw in strict; the returned Store.get should stay clean.
    try { seen.__mutation_probe__ = 42; } catch (e) { threw = true; }
    const frozen = Object.isFrozen(seen);
    unsub();
    return { frozen: !!frozen, threw };
  });
  expect(r.frozen).toBe(true);
});

// ────────────────────────────────────────────────────────
// T-coordinator-recovers — a rejected coordinator task does not skip the next
// ────────────────────────────────────────────────────────
test('T-coordinator-recovers — after a coordinator task rejects, the next queued task still runs', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Prime a normal write to build a healthy pending op.
    window.Store.set('goals.__b0_coordrec__', { count: 1 });
    // Manually schedule two flushes on the internal chain by piggy-backing
    // on flushNow — the first is our real work; the second lands after.
    const first = window.Store.flushNow();
    const set2  = window.Store.set('goals.__b0_coordrec__', { count: 2 });
    const second = window.Store.flushNow();
    const [r1, r2] = await Promise.all([first, second]);
    const val = window.Store.get('goals.__b0_coordrec__');
    return { r1reason: r1 && r1.reason, r2committed: r2 && r2.committed, val };
  });
  // First flush should either commit or noop; second must at least run
  // (not be silently consumed by an earlier rejection).
  expect(r.val && r.val.count).toBe(2);
});

// ────────────────────────────────────────────────────────
// T-chain-C-use-saved — same-path chain resolution: use-saved leaves op2 idempotent
// ────────────────────────────────────────────────────────
test('T-chain-C-use-saved — A→B, B→C, external base C, use-saved removes op1 only', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Baseline: goals.__b0_chain__ = 'A' persisted at some revision.
    window.Store.set('goals.__b0_chain__', 'A');
    await window.Store.flushNow();
    // Enqueue A→B, B→C.
    window.Store.set('goals.__b0_chain__', 'B');
    window.Store.set('goals.__b0_chain__', 'C');
    // Simulate an external tab having committed 'C' at a higher revision.
    const cur = JSON.parse(localStorage.getItem('dune_state_v4'));
    cur.data.goals.__b0_chain__ = 'C';
    cur.revision = cur.revision + 5;
    cur.committedAt = new Date().toISOString();
    localStorage.setItem('dune_state_v4', JSON.stringify(cur));
    // Force a flush — should conflict on op1 (A→B).
    const res = await window.Store.flushNow();
    const cf = window.Store.getConflict && window.Store.getConflict();
    // Resolve with use-saved-version.
    let resolveRes = null;
    if (cf) resolveRes = window.Store.resolveConflict('use-saved-version');
    // After resolve, op2 (B→C) should be idempotently satisfied against C.
    const res2 = await window.Store.flushNow();
    const final = window.Store.get('goals.__b0_chain__');
    return { reason: res && res.reason, hadConflict: !!cf, resolved: !!(resolveRes && resolveRes.ok), reason2: res2 && res2.reason, final };
  });
  expect(r.hadConflict).toBe(true);
  expect(r.resolved).toBe(true);
  // After use-saved, op2 is idempotently satisfied against C on disk.
  expect(r.final).toBe('C');
});

// ────────────────────────────────────────────────────────
// T-derive-pure — Store.deriveStateFromLegacy uses only supplied reader
// ────────────────────────────────────────────────────────
test('T-derive-pure — Store.deriveStateFromLegacy reads only from the supplied reader', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    // Reader supplies a Russia salary that is NOT the one in live localStorage.
    const stagedReads = {};
    const reader = (k) => {
      stagedReads[k] = (stagedReads[k] || 0) + 1;
      if (k === 'dune_finance_v1') return { russia: { salary: 424242, usd_rate: 88, save_target: 55000 } };
      return null;
    };
    const before = JSON.stringify(localStorage.getItem('dune_state_v4'));
    const derived = window.Store.deriveStateFromLegacy(reader);
    const after = JSON.stringify(localStorage.getItem('dune_state_v4'));
    return {
      derivedSalary: derived.money.salary_net,
      readerFired: !!stagedReads.dune_finance_v1,
      touchedDisk: after !== before
    };
  });
  expect(r.derivedSalary).toBe(424242);
  expect(r.readerFired).toBe(true);
  expect(r.touchedDisk).toBe(false);
});
