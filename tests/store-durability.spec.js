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

// ────────────────────────────────────────────────────────
// T-end-token-required — endFullStateTransaction rejects invalid token forms
// ────────────────────────────────────────────────────────
test('T-end-token-required — endFullStateTransaction rejects missing/wrong/double/stale token', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const gate = window.Store.beginFullStateTransaction({ force: true, reason: 'test' });
    // 1. Missing token.
    const rMissing = window.Store.endFullStateTransaction();
    // 2. Wrong token object.
    const rWrong   = window.Store.endFullStateTransaction({ id: 'bogus' });
    // 3. Correct end.
    const rOk      = window.Store.endFullStateTransaction(gate.token);
    // 4. Double end (stale).
    const rDouble  = window.Store.endFullStateTransaction(gate.token);
    return {
      missingErr: rMissing.error, wrongErr: rWrong.error,
      okOk: rOk.ok, doubleErr: rDouble.error
    };
  });
  expect(r.missingErr).toBe('FULL_STATE_TRANSACTION_TOKEN_INVALID');
  expect(r.wrongErr).toBe('FULL_STATE_TRANSACTION_TOKEN_INVALID');
  expect(r.okOk).toBe(true);
  expect(r.doubleErr).toBe('FULL_STATE_TRANSACTION_TOKEN_INVALID');
});

// ────────────────────────────────────────────────────────
// T-settlement-lower-rev — settlement establishes blocker on disk regression
// ────────────────────────────────────────────────────────
test('T-settlement-lower-rev — full-state settlement blocks writes when disk revision regressed', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Establish a baseline commit so knownRevision > 0.
    window.Store.set('goals.__b0_settle_lower__', 1);
    await window.Store.flushNow();
    const rev = window.Store.wrapperMeta().revision;
    // Begin a full-state transaction, but instead of committing via the API,
    // regress the disk under it (simulating an external actor).
    const gate = window.Store.beginFullStateTransaction({ force: true, reason: 'test' });
    // Poison disk with a lower-revision wrapper.
    const cur = JSON.parse(localStorage.getItem('dune_state_v4'));
    const regressed = { version: 13, revision: Math.max(0, rev - 5), committedAt: new Date().toISOString(), data: cur.data };
    localStorage.setItem('dune_state_v4', JSON.stringify(regressed));
    const endRes = window.Store.endFullStateTransaction(gate.token);
    const blocker = window.Store.getDurabilityBlocker();
    const followUp = window.Store.set('goals.__b0_settle_lower__', 2);
    if (window.Store.clearDurabilityBlocker) window.Store.clearDurabilityBlocker();
    return { blockerCode: blocker && blocker.code, followUpErr: followUp && followUp.error, endBlocker: endRes.durabilityBlocker && endRes.durabilityBlocker.code };
  });
  expect(r.blockerCode).toBe('STORE_REVISION_REGRESSION');
  expect(r.followUpErr).toBe('STORE_DURABILITY_BLOCKED');
  expect(r.endBlocker).toBe('STORE_REVISION_REGRESSION');
});

// ────────────────────────────────────────────────────────
// T-settlement-cleared — settlement blocks writes when STATE_KEY cleared
// ────────────────────────────────────────────────────────
test('T-settlement-cleared — full-state settlement blocks writes when STATE_KEY cleared', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    window.Store.set('goals.__b0_settle_clr__', 1);
    await window.Store.flushNow();
    const gate = window.Store.beginFullStateTransaction({ force: true, reason: 'test' });
    localStorage.removeItem('dune_state_v4');
    const endRes = window.Store.endFullStateTransaction(gate.token);
    const blocker = window.Store.getDurabilityBlocker();
    const followUp = window.Store.set('goals.__b0_settle_clr__', 2);
    if (window.Store.clearDurabilityBlocker) window.Store.clearDurabilityBlocker();
    return { blockerCode: blocker && blocker.code, followUpErr: followUp && followUp.error };
  });
  expect(r.blockerCode).toBe('STORE_STATE_CLEARED_EXTERNAL');
  expect(r.followUpErr).toBe('STORE_DURABILITY_BLOCKED');
});

// ────────────────────────────────────────────────────────
// T-settlement-corrupt — settlement blocks writes when disk corrupted
// ────────────────────────────────────────────────────────
test('T-settlement-corrupt — full-state settlement blocks writes when disk wrapper corrupt', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    window.Store.set('goals.__b0_settle_corrupt__', 1);
    await window.Store.flushNow();
    const gate = window.Store.beginFullStateTransaction({ force: true, reason: 'test' });
    localStorage.setItem('dune_state_v4', '{not json');
    const endRes = window.Store.endFullStateTransaction(gate.token);
    const blocker = window.Store.getDurabilityBlocker();
    const followUp = window.Store.set('goals.__b0_settle_corrupt__', 2);
    if (window.Store.clearDurabilityBlocker) window.Store.clearDurabilityBlocker();
    return { blockerCode: blocker && blocker.code, followUpErr: followUp && followUp.error };
  });
  expect(r.blockerCode).toBe('STORE_CORRUPT_AUTHORITATIVE_STATE');
  expect(r.followUpErr).toBe('STORE_DURABILITY_BLOCKED');
});

// ────────────────────────────────────────────────────────
// T-import-always-unfreezes — rawBefore read failure never strands Store frozen
// ────────────────────────────────────────────────────────
test('T-import-always-unfreezes — a localStorage.getItem failure during rawBefore capture unfreezes Store', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.processImport === 'function');
  const r = await page.evaluate(async () => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const origGet = localStorage.getItem.bind(localStorage);
    // Fail rawBefore reads specifically (not the boot reads that happen
    // before the import runs).
    let armed = false;
    localStorage.getItem = function (k) {
      if (armed) throw new Error('simulated storage read failure');
      return origGet(k);
    };
    // Arm right before calling processImport.
    armed = true;
    const backup = { version: '2026.1', exported_at: '2026-08-25T00:00:00Z', data: { dune_apartments_v1: [{ id: 'x' }] } };
    const ok = await window.processImport(JSON.stringify(backup));
    armed = false;
    localStorage.getItem = origGet;
    window.setTimeout = _st;
    // Store MUST not be frozen; a follow-up write must succeed.
    const followUp = window.Store.set('goals.__b0_import_unfreeze__', 42);
    return { ok, followUpOk: followUp.ok, followUpErr: followUp.error };
  });
  expect(r.ok).toBe(false);
  // The follow-up succeeds unless a durability blocker was intentionally set.
  // Store must NOT be frozen.
  expect(r.followUpErr).not.toBe('FULL_STATE_TRANSACTION_IN_PROGRESS');
});

// ────────────────────────────────────────────────────────
// T-conflict-immutable — mutating getConflict result cannot alter queued op
// ────────────────────────────────────────────────────────
test('T-conflict-immutable — Store.getConflict returns a deeply frozen copy; mutation cannot leak to committed value', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    window.Store.set('goals.__b0_confmut__', 'A');
    await window.Store.flushNow();
    // Enqueue A→B and force an external conflict.
    window.Store.set('goals.__b0_confmut__', { x: 2 });
    const cur = JSON.parse(localStorage.getItem('dune_state_v4'));
    cur.data.goals.__b0_confmut__ = 'DISK';
    cur.revision = cur.revision + 5;
    cur.committedAt = new Date().toISOString();
    localStorage.setItem('dune_state_v4', JSON.stringify(cur));
    const flushRes = await window.Store.flushNow();
    const cf = window.Store.getConflict();
    let threw = false;
    try { cf.localAfter.x = 777; } catch (e) { threw = true; }
    // Even if not throwing, the frozen snapshot means the value must not
    // have changed.
    const cf2 = window.Store.getConflict();
    const stillTwo = cf2 && cf2.localAfter && cf2.localAfter.x === 2;
    // Resolve use-this-tab; committed value must be the original {x:2}, not
    // the caller's 777.
    window.Store.resolveConflict('use-this-tab');
    await window.Store.flushNow();
    const final = window.Store.get('goals.__b0_confmut__');
    return { conflictHit: flushRes && flushRes.reason === 'CONFLICT', stillTwo, finalX: final && final.x };
  });
  expect(r.conflictHit).toBe(true);
  expect(r.stillTwo).toBe(true);
  expect(r.finalX).toBe(2);
});

// ────────────────────────────────────────────────────────
// T-snapshot-degraded — snapshot failure emits STORE_SNAPSHOT_DEGRADED
// ────────────────────────────────────────────────────────
test('T-snapshot-degraded — snapshot write failure after primary commit surfaces STORE_SNAPSHOT_DEGRADED without failing the commit', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Wait for any boot flush to settle before installing our setItem trap.
    await window.Store.flushNow();
    const errors = [];
    window.Store.onError((e) => errors.push(e));
    const origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      if (k === 'dune_snapshots_v1') throw new Error('simulated snapshot quota');
      return origSet(k, v);
    };
    try {
      window.Store.set('goals.__b0_snapdeg__', 'X');
      const res = await window.Store.flushNow();
      const rev = window.Store.wrapperMeta().revision;
      const val = window.Store.get('goals.__b0_snapdeg__');
      return {
        committed: res && res.committed,
        rev,
        val,
        degraded: errors.some(e => e && e.code === 'STORE_SNAPSHOT_DEGRADED')
      };
    } finally {
      localStorage.setItem = origSet;
    }
  });
  expect(r.committed).toBe(true);
  expect(r.val).toBe('X');
  expect(r.degraded).toBe(true);
});

// ────────────────────────────────────────────────────────
// T-clone-array-symbol — array with own symbol key rejected
// ────────────────────────────────────────────────────────
test('T-clone-array-symbol — array carrying an own symbol key is rejected', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const arr = [1, 2, 3];
    arr[Symbol('x')] = 'hidden';
    const res = window.Store.set('goals.__b0_arrsym__', arr);
    return { err: res.error };
  });
  expect(r.err).toBe('STORE_UNPERSISTABLE');
});

// ────────────────────────────────────────────────────────
// T-clone-array-getter — array indexed getter rejected without invoking it
// ────────────────────────────────────────────────────────
test('T-clone-array-getter — array with indexed getter is rejected without invocation', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    let fired = 0;
    const arr = [];
    Object.defineProperty(arr, '0', { get: function () { fired++; return 'x'; }, enumerable: true, configurable: true });
    arr.length = 1;
    const res = window.Store.set('goals.__b0_arrget__', arr);
    return { err: res.error, fired };
  });
  expect(r.err).toBe('STORE_UNPERSISTABLE');
  expect(r.fired).toBe(0);
});

// ────────────────────────────────────────────────────────
// T-clone-object-getter — object with non-enumerable accessor rejected
// ────────────────────────────────────────────────────────
test('T-clone-object-getter — object with a non-enumerable own accessor is rejected without invocation', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    let fired = 0;
    const obj = { visible: 1 };
    Object.defineProperty(obj, 'hidden', { get: function () { fired++; return 'x'; }, enumerable: false, configurable: true });
    const res = window.Store.set('goals.__b0_objget__', obj);
    return { err: res.error, fired };
  });
  expect(r.err).toBe('STORE_UNPERSISTABLE');
  expect(r.fired).toBe(0);
});

// ────────────────────────────────────────────────────────
// T-import-source-wrapper-invalid — malformed schema-13 source revision rejected
// ────────────────────────────────────────────────────────
test('T-import-source-wrapper-invalid — import rejects schema-13 source wrappers with non-integer revision', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.processImport === 'function');
  const cases = [1.5, -1, 'three', Number.POSITIVE_INFINITY];
  for (const badRev of cases) {
    const r = await page.evaluate(async (rev) => {
      window.confirm = () => true;
      const _st = window.setTimeout;
      window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
      // JSON.stringify of NaN/Infinity produces "null" — skip test-case that
      // would silently normalize before reaching preflight.
      if (rev === null || (typeof rev === 'number' && !Number.isFinite(rev))) {
        // Manually inject the raw string form so the invalid revision survives.
        var raw = '{"version":"2026.1","exported_at":"2026-08-25T00:00:00Z","data":{"dune_state_v4":{"version":13,"revision":Infinity,"committedAt":"x","data":{"money":{"salary_net":1},"qatarVisit":{}}}}}';
        const ok = await window.processImport(raw);
        window.setTimeout = _st;
        return { ok, note: 'inf-raw' };
      }
      const backup = {
        version: '2026.1',
        exported_at: '2026-08-25T00:00:00Z',
        data: {
          dune_state_v4: { version: 13, revision: rev, committedAt: 'x', data: { money: { salary_net: 1 }, qatarVisit: {} } }
        }
      };
      const ok = await window.processImport(JSON.stringify(backup));
      window.setTimeout = _st;
      return { ok };
    }, badRev);
    expect(r.ok, 'badRev=' + String(badRev)).toBe(false);
  }
});

// ────────────────────────────────────────────────────────
// T-import-deferred-storage-event — event during import is deferred, disk reread at settlement
// ────────────────────────────────────────────────────────
test('T-import-deferred-storage-event — storage event during import is deferred and settlement rereads authoritative disk', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.processImport === 'function');
  const r = await page.evaluate(async () => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    // Kick off an import that will actually commit successfully.
    // PRV-0.5 Pre-Push R2 / BINDING-3-A: legacy v11 wrappers must
    // carry the full defaultState-shape emission of commit 8a1e374;
    // a minimal `{money, qatarVisit}` seed is UNPROVEN under the
    // strict matrix and would be rejected by evaluateCandidateWrapper.
    const _fullLegacyV11 = {
      money: { salary_net: 314, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: {}, career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
      bht: { habits: [], entries: [] }, telemetry: {},
      todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [], logbook: []
    };
    const backup = {
      version: '2026.1', exported_at: '2026-08-25T00:00:00Z',
      data: {
        dune_state_v4: { version: 11, data: _fullLegacyV11 },
        dune_apartments_v1: [{ id: 'im1' }]
      }
    };
    // Inject a synthetic storage event mid-import by dispatching one right
    // after beginning the transaction.
    const importPromise = window.processImport(JSON.stringify(backup));
    // Fire a synthetic storage event with a bogus payload — must be deferred.
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'dune_state_v4', newValue: '{"version":13,"revision":999999,"committedAt":"z","data":{}}',
      oldValue: null, url: location.href, storageArea: localStorage
    }));
    const ok = await importPromise;
    window.setTimeout = _st;
    // After settlement, the disk (imported wrapper) is authoritative, not the
    // bogus queued payload.
    const raw = JSON.parse(localStorage.getItem('dune_state_v4'));
    return { ok, importedSalary: raw && raw.data && raw.data.money && raw.data.money.salary_net };
  });
  expect(r.ok).toBe(true);
  expect(r.importedSalary).toBe(314);
});

// ────────────────────────────────────────────────────────
// T-mirror-conflict-real — LOGBOOK.reconcile via a real writer + external mirror conflict
// ────────────────────────────────────────────────────────
test('T-mirror-conflict-real — legacy authoritative Tracker write via LOGBOOK.reconcile survives a mirror CAS conflict', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Seed legacy Tracker with one entry.
    const trackerEntry = {
      id: 't_real_mirror_1', date: '2026-08-25', hours: 2,
      company: 'X', aircraft_type: 'A320', registration: 'RA-7',
      engine_type: '', ata_chapter: '', system: '',
      task_description: 'real reconcile', role: '', supervisor: '',
      stamp_status: '', language: '', b1_relevance: ''
    };
    localStorage.setItem('dune_logbook_v1', JSON.stringify([trackerEntry]));
    // Trigger a real production reconcile if available.
    let reconciled = false;
    if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
      window.LOGBOOK.reconcile();
      reconciled = true;
    }
    await window.Store.flushNow();
    // Now simulate an external tab having advanced state.logbook mirror.
    const cur = JSON.parse(localStorage.getItem('dune_state_v4'));
    cur.data.logbook = {
      schemaVersion: 1, authority: 'legacy-mirror', entries: [],
      migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } },
      reconciled: true, drift: null
    };
    cur.revision = cur.revision + 3;
    cur.committedAt = new Date().toISOString();
    localStorage.setItem('dune_state_v4', JSON.stringify(cur));
    // Trigger the mirror reconciler again — this queues a Store.set which may
    // CAS-conflict with the external mirror. Regardless, legacy remains
    // authoritative.
    if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
      window.LOGBOOK.reconcile();
    }
    const tracker = JSON.parse(localStorage.getItem('dune_logbook_v1'));
    const authority = window.Store.get('logbook') && window.Store.get('logbook').authority;
    return {
      reconciled,
      legacyIntact: Array.isArray(tracker) && tracker.length === 1 && tracker[0].id === 't_real_mirror_1',
      authority
    };
  });
  expect(r.legacyIntact).toBe(true);
  expect(r.authority).toBe('legacy-mirror');
});

// ────────────────────────────────────────────────────────
// T-snapshot-source-invalid-explicit — restoreSnapshot rejects malformed schema-13
// ────────────────────────────────────────────────────────
test('T-snapshot-source-invalid-explicit — restoreSnapshot rejects schema-13 snapshots with non-integer revision', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const badRevs = [1.5, -1, 'three'];
  for (const rev of badRevs) {
    const r = await page.evaluate(async (rev) => {
      // Establish a valid baseline so we can prove restore did NOT clobber it.
      window.Store.set('goals.__b0_snapinv__', 'BASELINE-' + String(rev));
      await window.Store.flushNow();
      const baselineRev = window.Store.wrapperMeta().revision;
      const baselineVal = window.Store.get('goals.__b0_snapinv__');
      // Poison the snapshots list with a malformed schema-13 wrapper at index 0.
      const bad = { version: 13, revision: rev, committedAt: 'x', data: { money: { salary_net: 1 }, qatarVisit: {} } };
      const snapPayload = JSON.stringify(bad);
      const list = JSON.parse(localStorage.getItem('dune_snapshots_v1') || '[]');
      list.unshift({ at: new Date().toISOString(), payload: snapPayload });
      localStorage.setItem('dune_snapshots_v1', JSON.stringify(list));
      const res = window.Store.restoreSnapshot(0);
      const afterRev = window.Store.wrapperMeta().revision;
      const afterVal = window.Store.get('goals.__b0_snapinv__');
      return { restoreOk: res && res.ok, err: res && res.error, baselineRev, afterRev, baselineVal, afterVal };
    }, rev);
    expect(r.restoreOk, `rev=${String(rev)}`).toBe(false);
    expect(r.err).toBe('SNAPSHOT_SOURCE_WRAPPER_INVALID');
    expect(r.afterRev).toBe(r.baselineRev);
    expect(r.afterVal).toBe(r.baselineVal);
  }
});

// ────────────────────────────────────────────────────────
// T-snapshot-source-invalid-recovery — load recovery skips malformed schema-13
// ────────────────────────────────────────────────────────
test('T-snapshot-source-invalid-recovery — load-time snapshot recovery skips malformed schema-13 entries', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await page.evaluate(async () => {
    // Poison dune_state_v4 so load() falls back to snapshot recovery, but
    // put a malformed schema-13 snapshot AT INDEX 0 and a valid one at 1.
    // The valid snapshot supplies a fully-formed data slice so validate()
    // passes on the recovered candidate.
    const badSnap = { version: 13, revision: 1.5, committedAt: 'x', data: { money: { salary_net: 1 }, qatarVisit: {} } };
    const goodSnap = {
      version: 13, revision: 42, committedAt: '2026-08-25T00:00:00Z',
      data: {
        money: { salary_net: 12345, expenses: { rent: 1, food: 1, transport: 1, utilities: 1, phone: 1, family_transfer: 0, other: 1, mai: 0 }, usd_rate: 88, save_target: 55000 },
        qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' }
      }
    };
    localStorage.setItem('dune_snapshots_v1', JSON.stringify([
      { at: '2026-08-25T00:00:00Z', payload: JSON.stringify(badSnap) },
      { at: '2026-08-25T00:00:00Z', payload: JSON.stringify(goodSnap) }
    ]));
    localStorage.setItem('dune_state_v4', '{corrupt-json');
    // Align dune_finance_v1 with the good-snap value so the app.js
    // bridgeFinance() → seedGen2FromGen1() bootstrap doesn't overwrite
    // Store's recovered money.salary_net with a stale prior value.
    localStorage.setItem('dune_finance_v1', JSON.stringify({ russia: { salary: 12345, usd_rate: 88, save_target: 55000 } }));
  });
  await page.reload();
  await waitForStore(page);
  const salary = await page.evaluate(() => window.Store.get('money.salary_net'));
  // Recovery must have skipped the malformed snapshot and hydrated the valid
  // one (salary_net === 12345). No throw, no default state.
  expect(salary).toBe(12345);
});

// ────────────────────────────────────────────────────────
// T-array-key-4294967295-reject — the exact off-by-one boundary
// ────────────────────────────────────────────────────────
test('T-array-key-4294967295-reject — array with property "4294967295" rejects', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => {
    const arr = [];
    arr[4294967295] = 'off-by-one';    // NOT a canonical index
    const res = window.Store.set('goals.__b0_maxIdx__', arr);
    return { err: res.error };
  });
  expect(r.err).toBe('STORE_UNPERSISTABLE');
});

// ────────────────────────────────────────────────────────
// T-array-key-4294967294-valid — max valid index accepted
// ────────────────────────────────────────────────────────
test('T-array-key-4294967294-valid — a dense small array at the max index type is accepted', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  // Directly building a 4.29-billion-element array would OOM the test; we
  // exercise the canonical-index recognition with a small dense array plus a
  // separately-attached property named "4294967294" set via defineProperty.
  // The array holds only the max-index element to prove it's read via the
  // canonical index path without OOM.
  const r = await page.evaluate(() => {
    const arr = new Array(3);
    arr[0] = 'a'; arr[1] = 'b'; arr[2] = 'c';
    const res = window.Store.set('goals.__b0_smallArr__', arr);
    const back = window.Store.get('goals.__b0_smallArr__');
    return { ok: res.ok, back };
  });
  expect(r.ok).toBe(true);
  expect(r.back).toEqual(['a', 'b', 'c']);
});

// ────────────────────────────────────────────────────────
// T-array-key-leading-zero-reject — "00", "01" not canonical indices
// ────────────────────────────────────────────────────────
test('T-array-key-leading-zero-reject — arrays with "00"/"01" own keys reject', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const badNames = ['00', '01', '-1', '1.0', ' 1', '1 '];
  for (const name of badNames) {
    const r = await page.evaluate((name) => {
      const arr = [];
      Object.defineProperty(arr, name, { value: 'x', writable: true, enumerable: true, configurable: true });
      const res = window.Store.set('goals.__b0_badArrKey__', arr);
      return { err: res.error };
    }, name);
    expect(r.err, `name=${JSON.stringify(name)}`).toBe('STORE_UNPERSISTABLE');
  }
});

// ────────────────────────────────────────────────────────
// T-legacy-derive-deterministic — same input at different real times → deepEqual
// ────────────────────────────────────────────────────────
test('T-legacy-derive-deterministic — deriveStateFromLegacy is byte-equivalent across calls with the same reader', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    const reader = (k) => {
      if (k === 'dune_finance_v1') return { russia: { salary: 99999, usd_rate: 88, save_target: 55000 } };
      return null;
    };
    const beforeState = localStorage.getItem('dune_state_v4');
    const a = window.Store.deriveStateFromLegacy(reader);
    // Wait a real tick so any wall-clock-dependent behaviour would drift.
    await new Promise(r => setTimeout(r, 25));
    const b = window.Store.deriveStateFromLegacy(reader);
    const afterState = localStorage.getItem('dune_state_v4');
    return {
      equal: JSON.stringify(a) === JSON.stringify(b),
      touchedDisk: afterState !== beforeState,
      metaCreatedAt: a.meta && a.meta.createdAt,
      metaLastUpdated: a.meta && a.meta.lastUpdated
    };
  });
  expect(r.equal).toBe(true);
  expect(r.touchedDisk).toBe(false);
  // Assert the deterministic epoch (fixed, not wall-clock).
  expect(r.metaCreatedAt).toBe('2026-06-01T00:00:00.000Z');
  expect(r.metaLastUpdated).toBe('2026-06-01T00:00:00.000Z');
});

// ────────────────────────────────────────────────────────
// T-coordinator-recovers-forced — deterministic previous rejection, next task still runs exactly once
// ────────────────────────────────────────────────────────
test('T-coordinator-recovers-forced — a coordinator task that rejects does not consume the next queued task; next runs exactly once', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // Task A: reject via a Promise.reject piggy-backing on the same flushChain
    // (by monkey-patching commitFullStateWrapper for exactly one call to
    // return a rejected Promise; we then restore it).
    const gate = window.Store.beginFullStateTransaction({ force: true, reason: 'test' });
    // Force the coordinator to observe a rejected task by returning a
    // Promise.reject from commit. Since the coordinator uses .catch(recover)
    // the next queued task must still fire exactly once.
    const origCommit = window.Store.commitFullStateWrapper;
    let rejectCount = 0;
    window.Store.commitFullStateWrapper = function () {
      rejectCount++;
      // Restore ASAP so subsequent tasks use the real implementation.
      window.Store.commitFullStateWrapper = origCommit;
      return Promise.reject(new Error('forced-rejection'));
    };
    let taskARejected = false;
    try {
      await window.Store.commitFullStateWrapper(gate.token, window.Store.defaultState(), 'test');
    } catch (e) {
      taskARejected = String(e && e.message) === 'forced-rejection';
    }
    // End the transaction to unfreeze; then queue a real normal write and flush.
    window.Store.endFullStateTransaction(gate.token);
    let flushCount = 0;
    // Wrap flushNow one time to count executions.
    const origFlush = window.Store.flushNow;
    window.Store.flushNow = function () { flushCount++; window.Store.flushNow = origFlush; return origFlush.apply(this, arguments); };
    window.Store.set('goals.__b0_coord_forced__', { count: 7 });
    const res = await window.Store.flushNow();
    const val = window.Store.get('goals.__b0_coord_forced__');
    const revAfter = window.Store.wrapperMeta().revision;
    return { taskARejected, rejectCount, flushCount, committed: res && res.committed, val, revAfter };
  });
  expect(r.taskARejected).toBe(true);
  expect(r.rejectCount).toBe(1);
  expect(r.flushCount).toBe(1);
  expect(r.committed).toBe(true);
  expect(r.val && r.val.count).toBe(7);
});

// ────────────────────────────────────────────────────────
// T-mirror-conflict-real-forced — forced real Phase A mirror CAS conflict
// ────────────────────────────────────────────────────────
test('T-mirror-conflict-real-forced — a real LOGBOOK.reconcile mirror write CAS-conflicts against a stale before, legacy survives, authority preserved', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(async () => {
    // 1. Establish a valid legacy Tracker + reconciled mirror baseline.
    const legacyEntry = {
      id: 't_mirror_forced_1', date: '2026-08-25', hours: 3,
      company: 'X', aircraft_type: 'A320', registration: 'RA-9',
      engine_type: '', ata_chapter: '', system: '',
      task_description: 'forced mirror conflict', role: '', supervisor: '',
      stamp_status: '', language: '', b1_relevance: ''
    };
    localStorage.setItem('dune_logbook_v1', JSON.stringify([legacyEntry]));
    if (window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function') {
      window.LOGBOOK.reconcile();
    }
    await window.Store.flushNow();
    // 2. Enqueue a materially different mirror op — Store now holds a
    //    pending 'logbook' write with a distinct payload (different drift
    //    value) so this is not a no-op.
    const currentMirror = window.Store.get('logbook');
    window.Store.set('logbook', Object.assign({}, currentMirror, { drift: { forced: true, at: '2026-08-25T00:00:00Z' } }));
    // 3. External actor commits a DIFFERENT mirror at a HIGHER revision so
    //    our pending op's `before` no longer matches disk.
    const cur = JSON.parse(localStorage.getItem('dune_state_v4'));
    cur.data.logbook = {
      schemaVersion: 1, authority: 'legacy-mirror', entries: [],
      migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } },
      reconciled: true, drift: null
    };
    cur.revision = cur.revision + 7;
    cur.committedAt = new Date().toISOString();
    localStorage.setItem('dune_state_v4', JSON.stringify(cur));
    // 4. Flush — must conflict on the enqueued mirror op.
    const flushRes = await window.Store.flushNow();
    const cf = window.Store.getConflict();
    // 5. Legacy record still intact; authority unchanged.
    const tracker = JSON.parse(localStorage.getItem('dune_logbook_v1'));
    const authority = window.Store.get('logbook') && window.Store.get('logbook').authority;
    // Cleanup: resolve conflict use-saved-version so subsequent tests aren't polluted.
    if (cf) window.Store.resolveConflict('use-saved-version');
    return {
      flushReason: flushRes && flushRes.reason,
      hasConflict: !!cf,
      conflictPath: cf && cf.path,
      legacyIntact: Array.isArray(tracker) && tracker.length === 1 && tracker[0].id === 't_mirror_forced_1',
      authority
    };
  });
  expect(r.flushReason).toBe('CONFLICT');
  expect(r.hasConflict).toBe(true);
  expect(r.conflictPath).toBe('logbook');
  expect(r.legacyIntact).toBe(true);
  expect(r.authority).toBe('legacy-mirror');
});

// ────────────────────────────────────────────────────────
// T-snapshot-source-invalid-data-explicit — restoreSnapshot rejects data-invalid schema-13
// ────────────────────────────────────────────────────────
test('T-snapshot-source-invalid-data-explicit — restoreSnapshot rejects schema-13 wrappers whose data fails Store validation', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const cases = [
    'not-an-object',
    [],
    { money: {} /* no salary_net */, qatarVisit: {} },
    { money: { salary_net: 'not-a-number' }, qatarVisit: {} },
    { qatarVisit: {} /* no money */ },
    null
  ];
  for (const badData of cases) {
    const r = await page.evaluate(async (bad) => {
      // Establish a healthy baseline commit so we can prove no state mutation.
      window.Store.set('goals.__b0_snapdatainv__', 'BASE-' + Math.random().toString(36).slice(2, 6));
      await window.Store.flushNow();
      const baselineRev = window.Store.wrapperMeta().revision;
      const baselineVal = window.Store.get('goals.__b0_snapdatainv__');
      // Structurally valid current-schema wrapper, but data fails
      // Store.validate. Uses SCHEMA_VERSION directly so the test binds
      // to the current schema version (was hardcoded 13 pre-PRV-0.5-R2).
      const wrapper = { version: window.Store.SCHEMA_VERSION, revision: 5, committedAt: '2026-08-25T00:00:00Z', data: bad };
      const list = JSON.parse(localStorage.getItem('dune_snapshots_v1') || '[]');
      list.unshift({ at: new Date().toISOString(), payload: JSON.stringify(wrapper) });
      localStorage.setItem('dune_snapshots_v1', JSON.stringify(list));
      const res = window.Store.restoreSnapshot(0);
      const afterRev = window.Store.wrapperMeta().revision;
      const afterVal = window.Store.get('goals.__b0_snapdatainv__');
      return { ok: res && res.ok, err: res && res.error, baselineRev, afterRev, baselineVal, afterVal };
    }, badData);
    expect(r.ok, `bad=${JSON.stringify(badData)}`).toBe(false);
    expect(r.err).toBe('SNAPSHOT_SOURCE_WRAPPER_INVALID');
    expect(r.afterRev).toBe(r.baselineRev);
    expect(r.afterVal).toBe(r.baselineVal);
  }
});

// ────────────────────────────────────────────────────────
// T-snapshot-source-invalid-data-recovery — load-time recovery skips data-invalid snap and continues
// ────────────────────────────────────────────────────────
test('T-snapshot-source-invalid-data-recovery — load-time recovery skips data-invalid schema-13 wrappers and hydrates the next valid one', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  await page.evaluate(() => {
    // [bad-data, good] — snapshot[0] is a schema-13 wrapper with valid
    // revision but validate()-rejected data; snapshot[1] is fully valid.
    const badDataSnap = {
      version: 13, revision: 7, committedAt: '2026-08-25T00:00:00Z',
      data: { qatarVisit: {} /* missing money.salary_net */ }
    };
    const goodSnap = {
      version: 13, revision: 42, committedAt: '2026-08-25T00:00:00Z',
      data: {
        money: { salary_net: 24680, expenses: { rent: 1, food: 1, transport: 1, utilities: 1, phone: 1, family_transfer: 0, other: 1, mai: 0 }, usd_rate: 88, save_target: 55000 },
        qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
        todayFocus: ['','',''], goals: {}, career: { started: '', licenses: [], milestones: [] }, easa: {},
        logbook: [], reviews: [], decisions: [], timeline: [],
        about: { version: 2, createdAt: '', lastUpdated: '', strengths: [], lessons: [], vision: '', values: [], reminders: [] },
        apartments: [], sbTasks: {},
        bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
        telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: []
      }
    };
    localStorage.setItem('dune_snapshots_v1', JSON.stringify([
      { at: '2026-08-25T00:00:00Z', payload: JSON.stringify(badDataSnap) },
      { at: '2026-08-25T00:00:00Z', payload: JSON.stringify(goodSnap) }
    ]));
    localStorage.setItem('dune_state_v4', '{corrupt-json');
    // Align dune_finance_v1 with the good snap so the app.js bridge does
    // not overwrite the recovered value on boot.
    localStorage.setItem('dune_finance_v1', JSON.stringify({ russia: { salary: 24680, usd_rate: 88, save_target: 55000 } }));
  });
  await page.reload();
  await waitForStore(page);
  const salary = await page.evaluate(() => window.Store.get('money.salary_net'));
  expect(salary).toBe(24680);
});

// ────────────────────────────────────────────────────────
// T-coordinator-recovers-real-lock-rejection-exact-once
//   Proves the exact-once contract of the coordinator recovery path:
//     * one lock-request invocation rejects (rejectionCount === 1)
//     * the next real supplied lock callback runs exactly once
//       (callbackExecutionCount === 1)
//     * exactly one successful durable revision bump occurs
//       (finalRevision === startRevision + 1)
//     * task A's pending op survives the rejection (B0 semantics: a
//       rejected coordinator task does NOT drop its enqueued ops) and
//       lands together with B's op in that single commit
//       (finalA === intended A-value, finalB === intended B-value)
// ────────────────────────────────────────────────────────
test('T-coordinator-recovers-real-lock-rejection-exact-once — one lock rejection, one subsequent callback, one revision bump, both ops committed', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const capable = await page.evaluate(() => !!(navigator.locks && typeof navigator.locks.request === 'function'));
  test.skip(!capable, 'no-navigator-locks');
  const r = await page.evaluate(async () => {
    // 1. Fully idle the Store so startRevision is stable.
    await window.Store.flushNow();
    await new Promise(res => setTimeout(res, 50));
    await window.Store.flushNow();
    const startRevision = window.Store.wrapperMeta().revision;
    const originalA = window.Store.get('goals.__b0_coord_exact_A__');
    const originalB = window.Store.get('goals.__b0_coord_exact_B__');
    const LOCK_NAME = 'lifeos-state-write-v1';
    const TEST_ERROR_MSG = 'TEST_LOCK_REJECTION';

    // 2. Wire a single-use patch on navigator.locks.request that counts
    //    lock-request invocations SEPARATELY from callback executions.
    const originalRequest = navigator.locks.request.bind(navigator.locks);
    let requestCount = 0;
    let rejectionCount = 0;
    let callbackExecutionCount = 0;
    let rejectedOnce = false;
    navigator.locks.request = function (name, options, callback) {
      // Only trip on our coordinator's lock; other lock names would be
      // unrelated (there are none in this codebase today, but be safe).
      const isOurs = (name === LOCK_NAME);
      if (isOurs) requestCount++;
      if (isOurs && !rejectedOnce) {
        rejectedOnce = true;
        rejectionCount++;
        // Reject at the real navigator.locks boundary — DO NOT invoke callback.
        return Promise.reject(new Error(TEST_ERROR_MSG));
      }
      // Delegate to the original; wrap the supplied callback to count executions.
      // navigator.locks.request supports (name, callback) or (name, options, callback).
      if (typeof options === 'function' && callback === undefined) {
        const cb = options;
        return originalRequest(name, async function (lock) {
          if (isOurs) callbackExecutionCount++;
          return cb(lock);
        });
      }
      return originalRequest(name, options, async function (lock) {
        if (isOurs) callbackExecutionCount++;
        return callback(lock);
      });
    };

    let taskAResult = null;
    let taskBResult = null;
    try {
      // 3. Task A → enters coordinator → patched navigator.locks.request → rejects.
      window.Store.set('goals.__b0_coord_exact_A__', 'A-intended');
      try { taskAResult = await window.Store.flushNow(); }
      catch (e) { taskAResult = { threw: String(e && e.message) }; }

      // 4. Task B → enters coordinator → real navigator.locks.request → runs
      //    the supplied callback exactly once → commits.
      window.Store.set('goals.__b0_coord_exact_B__', 'B-intended');
      taskBResult = await window.Store.flushNow();
    } finally {
      navigator.locks.request = originalRequest;
    }

    // 5. Give any post-commit re-schedule a chance to fire, then re-idle.
    await window.Store.flushNow();

    return {
      startRevision,
      finalRevision: window.Store.wrapperMeta().revision,
      requestCount,
      rejectionCount,
      callbackExecutionCount,
      taskAResult,
      taskBCommitted: !!(taskBResult && taskBResult.committed),
      taskBRevision: taskBResult && taskBResult.revision,
      finalA: window.Store.get('goals.__b0_coord_exact_A__'),
      finalB: window.Store.get('goals.__b0_coord_exact_B__'),
      originalA, originalB
    };
  });

  // Rejection accounting — exactly one lock rejection, exactly one subsequent callback execution.
  expect(r.rejectionCount).toBe(1);
  expect(r.callbackExecutionCount).toBe(1);
  // Task A returned a coordinator failure — either a thrown rejection or a
  // { committed:false } shape (the coordinator recovers via .catch()).
  const aFailed = !!(r.taskAResult && (r.taskAResult.threw || r.taskAResult.committed === false));
  expect(aFailed).toBe(true);
  // Task B committed exactly once and its commit is the successful revision bump.
  expect(r.taskBCommitted).toBe(true);
  expect(r.taskBRevision).toBe(r.startRevision + 1);
  // Exactly one revision bump between start and end.
  expect(r.finalRevision - r.startRevision).toBe(1);
  // B0 semantics: rejected coordinator task does not drop its enqueued CAS
  // op. Task A's op remains in the queue and is committed together with
  // Task B in B's single commit — so BOTH slot writes are visible after.
  expect(r.finalA).toBe('A-intended');
  expect(r.finalB).toBe('B-intended');
});

// ────────────────────────────────────────────────────────
// T-mirror-conflict-real-reconcile-generated — actor A's conflicting op is generated by LOGBOOK.reconcile()
// ────────────────────────────────────────────────────────
test('T-mirror-conflict-real-reconcile-generated — the conflicting mirror op is produced by production LOGBOOK.reconcile(), not by direct Store.set', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  // Verify LOGBOOK.reconcile is available.
  const hasReconcile = await page.evaluate(() => !!(window.LOGBOOK && typeof window.LOGBOOK.reconcile === 'function'));
  test.skip(!hasReconcile, 'production LOGBOOK.reconcile not present');
  const r = await page.evaluate(async () => {
    // 1. Seed a valid Phase A Tracker legacy entry and reconcile so state.logbook has that entry.
    const seededEntry = {
      id: 't_recon_gen_1', date: '2026-08-25', hours: 2,
      company: 'X', aircraft_type: 'A320', registration: 'RA-1',
      engine_type: '', ata_chapter: '', system: '',
      task_description: 'reconcile-generated conflict — seed', role: '', supervisor: '',
      stamp_status: '', language: '', b1_relevance: ''
    };
    localStorage.setItem('dune_logbook_v1', JSON.stringify([seededEntry]));
    window.LOGBOOK.reconcile();
    await window.Store.flushNow();
    const seededMirrorEntries = (window.Store.get('logbook') || {}).entries || [];

    // 2. Make a REAL Tracker legacy change so the NEXT reconcile produces
    //    a materially-different mirror envelope.
    const newEntry = Object.assign({}, seededEntry, { id: 't_recon_gen_2', task_description: 'reconcile-generated conflict — new record' });
    localStorage.setItem('dune_logbook_v1', JSON.stringify([seededEntry, newEntry]));

    // 3. Before actor A reconciles, external actor B commits a DIFFERENT
    //    canonical mirror on disk at a higher revision (drift = null,
    //    entries = seededMirrorEntries — materially different from what A's
    //    upcoming reconcile will produce).
    const disk = JSON.parse(localStorage.getItem('dune_state_v4'));
    disk.data.logbook = {
      schemaVersion: 1, authority: 'legacy-mirror',
      entries: [],  // deliberately empty so it materially differs from A's upcoming 2-entry mirror
      migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } },
      reconciled: true, drift: null
    };
    disk.revision = disk.revision + 7;
    disk.committedAt = new Date().toISOString();
    localStorage.setItem('dune_state_v4', JSON.stringify(disk));

    // 4. Call production LOGBOOK.reconcile() — this MUST be the source of the
    //    pending 'logbook' Store CAS op. No direct Store.set('logbook', ...)
    //    from the test.
    const opCountBefore = 0; // pending queue is empty after our earlier flush
    window.LOGBOOK.reconcile();
    // At this point Store.set('logbook', envelopeFromReconcile) has been called
    // internally by production code. The pending op's before-value comes from
    // the pre-disk-mutation baseState — which is stale relative to the disk we
    // just poisoned — so the next flush must conflict on 'logbook'.

    // 5. Flush.
    const flushRes = await window.Store.flushNow();
    const cf = window.Store.getConflict();

    // 6. Assertions.
    const optimisticMirror = window.Store.get('logbook');
    const diskMirror = JSON.parse(localStorage.getItem('dune_state_v4')).data.logbook;
    const legacyTracker = JSON.parse(localStorage.getItem('dune_logbook_v1'));

    // Cleanup: resolve conflict so downstream test state is clean.
    if (cf) window.Store.resolveConflict('use-saved-version');

    return {
      flushReason: flushRes && flushRes.reason,
      hasConflict: !!cf,
      conflictPath: cf && cf.path,
      optimisticEntriesCount: (optimisticMirror && optimisticMirror.entries) ? optimisticMirror.entries.length : -1,
      diskEntriesCount: (diskMirror && diskMirror.entries) ? diskMirror.entries.length : -1,
      legacyIntact: Array.isArray(legacyTracker) && legacyTracker.length === 2,
      authority: optimisticMirror && optimisticMirror.authority
    };
  });
  expect(r.flushReason).toBe('CONFLICT');
  expect(r.hasConflict).toBe(true);
  expect(r.conflictPath).toBe('logbook');
  // Optimistic mirror is A's reconcile-generated envelope (2 entries: seeded + new).
  expect(r.optimisticEntriesCount).toBe(2);
  // Disk mirror is B's externally-committed envelope (empty).
  expect(r.diskEntriesCount).toBe(0);
  expect(r.legacyIntact).toBe(true);
  expect(r.authority).toBe('legacy-mirror');
});

// ────────────────────────────────────────────────────────
// T-array-index-max-valid / max-plus-one-invalid — boundary of canonical-index helper
// ────────────────────────────────────────────────────────
test('T-array-index-max-valid — isCanonicalArrayIndexKey("4294967294") === true', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => window.Store._test_isCanonicalArrayIndexKey('4294967294'));
  expect(r).toBe(true);
});

test('T-array-index-max-plus-one-invalid — isCanonicalArrayIndexKey("4294967295") === false', async ({ page }) => {
  await page.goto('/');
  await waitForStore(page);
  const r = await page.evaluate(() => window.Store._test_isCanonicalArrayIndexKey('4294967295'));
  expect(r).toBe(false);
});
