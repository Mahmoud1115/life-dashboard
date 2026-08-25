// B0 two-page durability contention. Uses two pages in the SAME Playwright
// browser context so they share localStorage (and Web Locks / storage events
// on the same origin). See docs/lifeos/DECISIONS.md ADR-010.
const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;

async function makePage(context) {
  const page = await context.newPage();
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify([{ commit: { author: { date: '2026-08-25T00:00:00Z' } } }])
  }));
  await page.goto('/');
  await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
  // Flush any boot-time debounced writes so both pages start with a settled
  // wrapper on disk.
  await page.evaluate(() => window.Store.flushNow());
  return page;
}

test('T-two-page-A — unrelated paths merge; neither tab erases the other', async ({ context }) => {
  const A = await makePage(context);
  const B = await makePage(context);
  // Page A writes goals.__b0_tpA__ (a fresh path); page B writes goals.__b0_tpB__.
  await A.evaluate(async () => {
    window.Store.set('goals.__b0_tpA__', 'from-A');
    await window.Store.flushNow();
  });
  // Give the storage event a moment to propagate to B.
  await B.waitForTimeout(200);
  await B.evaluate(async () => {
    window.Store.set('goals.__b0_tpB__', 'from-B');
    await window.Store.flushNow();
  });
  await A.waitForTimeout(200);
  // Force both tabs to reflush any pending state so we can compare disk.
  await A.evaluate(() => window.Store.flushNow());
  await B.evaluate(() => window.Store.flushNow());
  const disk = await A.evaluate(() => JSON.parse(localStorage.getItem('dune_state_v4')));
  expect(disk.version).toBe(13);
  expect(disk.data.goals.__b0_tpA__).toBe('from-A');
  expect(disk.data.goals.__b0_tpB__).toBe('from-B');
  await A.close(); await B.close();
});

test('T-two-page-B-forced-conflict — overlapping path forces a real conflict on B; A committed value survives, B holds optimistic local intent, resolution converges', async ({ context }) => {
  const A = await makePage(context);
  const B = await makePage(context);
  // 1. Both pages accept the same initial value at the same base revision.
  await A.evaluate(async () => {
    window.Store.set('goals.__b0_tpConflictForced__', 'seed');
    await window.Store.flushNow();
  });
  // Let B observe the seed via storage event.
  await B.waitForTimeout(300);
  const bBaseline = await B.evaluate(() => ({
    val: window.Store.get('goals.__b0_tpConflictForced__'),
    rev: window.Store.wrapperMeta().revision
  }));
  const aBaseline = await A.evaluate(() => ({
    val: window.Store.get('goals.__b0_tpConflictForced__'),
    rev: window.Store.wrapperMeta().revision
  }));
  expect(bBaseline.val).toBe('seed');
  expect(bBaseline.rev).toBe(aBaseline.rev);

  // 2. Deterministic ordering: enqueue B's write FIRST so it holds a pending
  //    op against the seed base, then let A commit before B flushes. B must
  //    then conflict when it tries to persist.
  //
  //    We install a same-page storage-event pause hook in B so a mid-test
  //    storage event doesn't rebase B and clear the conflict before we
  //    assert. The hook is bounded to this test's path only.
  await B.evaluate(() => {
    // Intercept storage events for STATE_KEY so B does NOT rebase between
    // enqueue and flush. The interceptor removes itself once we release it.
    window.__b0_tp_events__ = [];
    const orig = window.addEventListener.bind(window);
    window.__b0_tp_originalStorage__ = null;
    window.__b0_tp_release__ = null;
    // Playwright's evaluate runs after page load; the storage listener was
    // installed by core.js. We wrap by dispatching a stopImmediatePropagation
    // guard at capture phase.
    const guard = (e) => {
      if (e.key === 'dune_state_v4') {
        window.__b0_tp_events__.push({ at: Date.now(), newValue: e.newValue });
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('storage', guard, true);
    window.__b0_tp_release__ = () => window.removeEventListener('storage', guard, true);
  });

  // 3. B enqueues its write. This is now a pending CAS op with base=seed.
  await B.evaluate(() => {
    window.Store.set('goals.__b0_tpConflictForced__', 'B-wants');
  });

  // 4. A commits its own overlapping write and lands on disk.
  const rA = await A.evaluate(async () => {
    window.Store.set('goals.__b0_tpConflictForced__', 'A-wins');
    const res = await window.Store.flushNow();
    return { committed: res && res.committed, revision: res && res.revision, disk: JSON.parse(localStorage.getItem('dune_state_v4')).data.goals.__b0_tpConflictForced__ };
  });
  expect(rA.committed).toBe(true);
  expect(rA.disk).toBe('A-wins');

  // 5. B flushes; its `before` is now stale → CONFLICT.
  const rB = await B.evaluate(async () => {
    const res = await window.Store.flushNow();
    const cf = window.Store.getConflict();
    const optimistic = window.Store.get('goals.__b0_tpConflictForced__');
    return { reason: res && res.reason, hasConflict: !!cf, cfPath: cf && cf.path, optimistic };
  });
  expect(rB.reason).toBe('CONFLICT');
  expect(rB.hasConflict).toBe(true);
  expect(rB.cfPath).toBe('goals.__b0_tpConflictForced__');
  expect(rB.optimistic).toBe('B-wants');

  // 6. Disk preserves A's value; no second silent overwrite.
  const diskAfterConflict = await B.evaluate(() => JSON.parse(localStorage.getItem('dune_state_v4')).data.goals.__b0_tpConflictForced__);
  expect(diskAfterConflict).toBe('A-wins');

  // 7. Release the storage-event guard, then resolve B use-saved-version;
  //    B converges to A's value; disk unchanged.
  await B.evaluate(async () => {
    if (window.__b0_tp_release__) window.__b0_tp_release__();
    window.Store.resolveConflict('use-saved-version');
    await window.Store.flushNow();
  });
  const converged = await B.evaluate(() => window.Store.get('goals.__b0_tpConflictForced__'));
  expect(converged).toBe('A-wins');
  const diskFinal = await A.evaluate(() => JSON.parse(localStorage.getItem('dune_state_v4')).data.goals.__b0_tpConflictForced__);
  expect(diskFinal).toBe('A-wins');
  await A.close(); await B.close();
});
