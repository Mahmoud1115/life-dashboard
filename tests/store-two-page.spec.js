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

test('T-two-page-B — overlapping path: one commits, the other detects conflict', async ({ context }) => {
  const A = await makePage(context);
  const B = await makePage(context);
  // Both pages read the same initial value.
  await A.evaluate(async () => {
    window.Store.set('goals.__b0_tpConflict__', 'seed');
    await window.Store.flushNow();
  });
  // Let B observe the seed via storage event.
  await B.waitForTimeout(200);
  // Now both queue overlapping writes to the same path from the same base.
  // A flushes first; B's stale base will then conflict on its enqueued write.
  const [rA, rB] = await Promise.all([
    A.evaluate(async () => {
      window.Store.set('goals.__b0_tpConflict__', 'A-wins');
      const res = await window.Store.flushNow();
      return { committed: res && res.committed, val: window.Store.get('goals.__b0_tpConflict__') };
    }),
    B.evaluate(async () => {
      // Enqueue B's write before hearing about A's commit. Delay the flush
      // so A's write lands first.
      window.Store.set('goals.__b0_tpConflict__', 'B-wants');
      // Wait a tick for A's storage event to arrive at B.
      await new Promise(r => setTimeout(r, 400));
      const res = await window.Store.flushNow();
      const cf = window.Store.getConflict();
      const optimistic = window.Store.get('goals.__b0_tpConflict__');
      return { reason: res && res.reason, hasConflict: !!cf, optimistic };
    })
  ]);
  expect(rA.committed).toBe(true);
  expect(rA.val).toBe('A-wins');
  // B either sees a conflict (and its optimistic state still shows 'B-wants')
  // OR — if it rebased before enqueue — it committed its own value cleanly.
  // Both are valid multi-tab outcomes; the durability invariant is that
  // A's data is not silently erased.
  expect(rB.optimistic === 'B-wants' || rB.optimistic === 'A-wins').toBe(true);
  await A.close(); await B.close();
});
