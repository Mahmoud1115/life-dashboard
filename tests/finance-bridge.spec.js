// Russia finance bridge hotfix regression. See the storage audit and
// docs/lifeos/STORAGE_MAP.md — Gen-1 dune_finance_v1.russia is the
// authoritative writer today; Gen-2 state.money is a shadow only. These
// tests use only synthetic in-page state seeded per test via addInitScript
// so real user storage is never touched.

const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;

test.beforeEach(async ({ context, page }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: '2026-08-24T00:00:00Z' } } }]),
    })
  );
});

async function waitAppReady(page) {
  await page.waitForFunction(() =>
    typeof window.Store !== 'undefined' &&
    typeof window.Store.get === 'function' &&
    typeof window.finInputChange === 'function'
  );
}

// Seed dune_finance_v1 (Gen-1) and optionally dune_state_v4 (Gen-2) before
// any Life OS script runs, so bridgeFinance() sees the values during init.
async function seedFinance(page, { gen1 = null, gen2Money = null } = {}) {
  await page.addInitScript(([g1, g2m]) => {
    if (g1) localStorage.setItem('dune_finance_v1', JSON.stringify(g1));
    if (g2m) {
      // Minimal dune_state_v4 shape that passes core.js:validate().
      // Only the money slice matters for these tests.
      localStorage.setItem('dune_state_v4', JSON.stringify({
        version: 11,
        data: {
          money: g2m,
          qatarVisit: {},
        },
      }));
    }
  }, [gen1, gen2Money]);
}

test('F1 — save_target overwrite regression: Gen-1 edit survives subsequent bridged edit', async ({ page }) => {
  // Reproduces the exact bug: pre-fix, editing salary via finInputChange
  // would fire the Store.money subscription and pushStoreToInputs would
  // write state.money.save_target back into dune_finance_v1.russia,
  // silently reverting a fresh Gen-1 save_target edit.
  await seedFinance(page, {
    gen1: { russia: { salary: 100000, save_target: 55000 } },
    gen2Money: { salary_net: 100000, save_target: 55000, usd_rate: 88, expenses: {} },
  });
  await page.goto('/');
  await waitAppReady(page);

  // 1. Bridge init should have seeded Gen-2 from Gen-1 (both are equal here).
  //    Now the user updates Gen-1 save_target directly (as the raw finance
  //    input would) — but not through the bridge, since we're testing the
  //    scenario where Gen-2 has a stale value relative to Gen-1.
  const result = await page.evaluate(() => {
    // Simulate a direct Gen-1 write of save_target=77777 (as if from a
    // finance input handler in a code path that doesn't go through
    // fieldMap — matches the pre-fix reality where save_target wasn't
    // in the fieldMap at all).
    const legacy = JSON.parse(localStorage.getItem('dune_finance_v1') || '{}');
    legacy.russia.save_target = 77777;
    localStorage.setItem('dune_finance_v1', JSON.stringify(legacy));
    // 2. Now the user edits salary through the wrapped finInputChange.
    //    Wrapper calls orig (writes Gen-1 salary) then Store.set(money.salary_net).
    //    Store subscription fires pushStoreToInputs.
    //    Pre-fix: pushStoreToInputs wrote state.money.save_target (55000)
    //    back into legacy.russia.save_target, clobbering our 77777.
    //    Post-fix: pushStoreToInputs no longer touches dune_finance_v1.
    window.finInputChange('russia', 'salary', 150000);
    const after = JSON.parse(localStorage.getItem('dune_finance_v1') || '{}');
    return {
      gen1SaveTarget: after.russia && after.russia.save_target,
      gen1Salary: after.russia && after.russia.salary,
    };
  });
  expect(result.gen1SaveTarget).toBe(77777);
  expect(result.gen1Salary).toBe(150000);
});

test('F2 — Gen-1 → Gen-2 propagation covers save_target', async ({ page }) => {
  await seedFinance(page, {
    gen1: { russia: { salary: 120000, save_target: 66666, usd_rate: 90 } },
  });
  await page.goto('/');
  await waitAppReady(page);

  // At this point bridgeFinance's seedGen2FromGen1 has run.
  let store = await page.evaluate(() => ({
    save_target: window.Store.get('money.save_target'),
    salary_net: window.Store.get('money.salary_net'),
    usd_rate: window.Store.get('money.usd_rate'),
  }));
  expect(store.save_target).toBe(66666);
  expect(store.salary_net).toBe(120000);
  expect(store.usd_rate).toBe(90);

  // Now a live Gen-1 edit through the wrapped finInputChange must
  // propagate save_target into the Store shadow too (fieldMap fix).
  store = await page.evaluate(() => {
    window.finInputChange('russia', 'save_target', 88888);
    return { save_target: window.Store.get('money.save_target') };
  });
  expect(store.save_target).toBe(88888);
});

test('F3 — Gen-2 stale save_target cannot overwrite Gen-1; Gen-1 wins at init', async ({ page }) => {
  // Conflicting seed: Gen-1 fresh (77777), Gen-2 stale (55000).
  await seedFinance(page, {
    gen1: { russia: { salary: 100000, save_target: 77777 } },
    gen2Money: { salary_net: 100000, save_target: 55000, usd_rate: 88, expenses: {} },
  });
  await page.goto('/');
  await waitAppReady(page);

  const state = await page.evaluate(() => ({
    gen1: JSON.parse(localStorage.getItem('dune_finance_v1') || '{}').russia,
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  // Gen-1 remains authoritative and unchanged.
  expect(state.gen1.save_target).toBe(77777);
  // Gen-2 shadow was reconciled UP from Gen-1 during bridge init.
  expect(state.storeSaveTarget).toBe(77777);
});

test('F4 — legitimate zero value in Gen-1 is preserved (not treated as missing)', async ({ page }) => {
  await seedFinance(page, {
    gen1: { russia: { salary: 100000, save_target: 0, rent: 0 } },
    gen2Money: { salary_net: 100000, save_target: 55000, usd_rate: 88, expenses: { rent: 45000 } },
  });
  await page.goto('/');
  await waitAppReady(page);

  const state = await page.evaluate(() => ({
    storeSaveTarget: window.Store.get('money.save_target'),
    storeRent: window.Store.get('money.expenses.rent'),
  }));
  expect(state.storeSaveTarget).toBe(0);
  expect(state.storeRent).toBe(0);
});

test('F5 — reload/rehydrate: Gen-2 shadow re-reconciles to Gen-1 authoritative value', async ({ page }) => {
  // Persist conflicting values first, then reload — bridge init on the
  // second load must still pull Gen-1 into Gen-2.
  await seedFinance(page, {
    gen1: { russia: { salary: 100000, save_target: 77777 } },
    gen2Money: { salary_net: 100000, save_target: 55000, usd_rate: 88, expenses: {} },
  });
  await page.goto('/');
  await waitAppReady(page);
  // First load: bridge should have reconciled.
  let sv = await page.evaluate(() => window.Store.get('money.save_target'));
  expect(sv).toBe(77777);
  // Now make the Store stale via direct set (as if a prior session had
  // persisted a stale Gen-2 value), then reload.
  await page.evaluate(() => window.Store.set('money.save_target', 33333));
  // Wait past 300 ms debounce so the stale value hits dune_state_v4.
  await page.waitForTimeout(400);
  await page.reload();
  await waitAppReady(page);
  sv = await page.evaluate(() => window.Store.get('money.save_target'));
  // Gen-1 (77777) still wins on the second load.
  expect(sv).toBe(77777);
});

test('F6 — non-Russia phases and Russia custom rows are not touched by the bridge', async ({ page }) => {
  // Custom rows live at dune_finance_v1.russia.customIncome/customExpenses
  // per money-custom.js:113-117 and 237-244. Fixture matches production.
  await seedFinance(page, {
    gen1: {
      russia: {
        salary: 100000,
        save_target: 77777,
        customIncome:   [{ id: 'c1', name: 'freelance', amount: 5000 }],
        customExpenses: [{ id: 'c2', name: 'gym',       amount: 2000 }],
        customSeeded: true,
      },
      gulf:  { salary: 200000 },
      qatar: { salary: 300000 },
    },
  });
  await page.goto('/');
  await waitAppReady(page);
  await page.evaluate(() => window.finInputChange('russia', 'salary', 150000));
  const gen1 = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dune_finance_v1') || '{}')
  );
  // Russia edit landed via `orig`.
  expect(gen1.russia.salary).toBe(150000);
  // Non-Russia phases and Russia custom-row subtrees are byte-exact untouched.
  expect(gen1.gulf).toEqual({ salary: 200000 });
  expect(gen1.qatar).toEqual({ salary: 300000 });
  expect(gen1.russia.customIncome).toEqual([{ id: 'c1', name: 'freelance', amount: 5000 }]);
  expect(gen1.russia.customExpenses).toEqual([{ id: 'c2', name: 'gym', amount: 2000 }]);
  expect(gen1.russia.customSeeded).toBe(true);
});

test('F7 — state-only finance survives two reloads when Gen-1 is initially absent', async ({ page }) => {
  // Codex reproduction: Gen-1 absent, valid Gen-2 exists. Without the
  // bootstrap, money-custom.js seedFromIdeas() creates dune_finance_v1
  // with no salary/save_target, then a later reload has bridge treat
  // that new-but-partial Gen-1 as authoritative, replacing the valid
  // state-only values with defaults on next paint that touches them.
  await seedFinance(page, {
    gen2Money: {
      salary_net: 246810,
      save_target: 86420,
      usd_rate: 93,
      expenses: { rent: 45000, food: 30000, transport: 5000, utilities: 4000, phone: 800, family_transfer: 40000, other: 8000, mai: 0 },
    },
    // Gen-1 deliberately absent.
  });

  await page.goto('/');
  await waitAppReady(page);

  // After bridge init, Gen-1 has been bootstrapped from Gen-2.
  let s = await page.evaluate(() => ({
    gen1Raw: localStorage.getItem('dune_finance_v1'),
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  expect(s.gen1Raw).not.toBeNull();
  const gen1After = JSON.parse(s.gen1Raw);
  expect(gen1After.russia.salary).toBe(246810);
  expect(gen1After.russia.save_target).toBe(86420);
  expect(s.storeSalary).toBe(246810);
  expect(s.storeSaveTarget).toBe(86420);

  // First reload — money-custom.js may add customIncome/customExpenses to
  // russia. bridge must not treat that as a signal to reset salary.
  await page.reload();
  await waitAppReady(page);
  s = await page.evaluate(() => ({
    gen1: JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'),
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  expect(s.gen1.russia.salary).toBe(246810);
  expect(s.gen1.russia.save_target).toBe(86420);
  expect(s.storeSalary).toBe(246810);
  expect(s.storeSaveTarget).toBe(86420);

  // Second reload — the pattern Codex used to reproduce the failure.
  await page.reload();
  await waitAppReady(page);
  s = await page.evaluate(() => ({
    gen1: JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'),
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  expect(s.gen1.russia.salary).toBe(246810);
  expect(s.gen1.russia.save_target).toBe(86420);
  expect(s.storeSalary).toBe(246810);
  expect(s.storeSaveTarget).toBe(86420);
  // Defaults 130000 / 55000 (core.js defaultState money) must never appear.
  expect(s.storeSalary).not.toBe(130000);
  expect(s.storeSaveTarget).not.toBe(55000);
});

test('F8 — bootstrap runs exactly once; existing Gen-1 is never replaced', async ({ page }) => {
  await seedFinance(page, {
    gen1: { russia: { salary: 111111 } },              // Gen-1 present, partial
    gen2Money: { salary_net: 222222, save_target: 333333, usd_rate: 88, expenses: {} },
  });
  await page.goto('/');
  await waitAppReady(page);
  const s = await page.evaluate(() => ({
    gen1: JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'),
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  // Existing Gen-1 remained authoritative for the field it holds.
  expect(s.gen1.russia.salary).toBe(111111);
  // Bootstrap did NOT fire, so save_target was not written into Gen-1
  // (Gen-1.save_target still absent).
  expect(s.gen1.russia.save_target).toBeUndefined();
  // Store shadow reflects Gen-1 for salary (seedGen2FromGen1) and keeps
  // its own value for save_target (no Gen-1 to copy from).
  expect(s.storeSalary).toBe(111111);
  expect(s.storeSaveTarget).toBe(333333);
});

test('F9 — zero-value Gen-1 keys count as present and prevent bootstrap', async ({ page }) => {
  await seedFinance(page, {
    gen1: { russia: { salary: 0, save_target: 0 } },   // legitimate zeros
    gen2Money: { salary_net: 999999, save_target: 888888, usd_rate: 88, expenses: {} },
  });
  await page.goto('/');
  await waitAppReady(page);
  const s = await page.evaluate(() => ({
    gen1: JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'),
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  // Existing Gen-1 zeros preserved.
  expect(s.gen1.russia.salary).toBe(0);
  expect(s.gen1.russia.save_target).toBe(0);
  // Store shadow reconciled to Gen-1's zeros (not the stale non-zero Gen-2).
  expect(s.storeSalary).toBe(0);
  expect(s.storeSaveTarget).toBe(0);
});

test('F11 — snapshot restore is deliberately non-canonical for Gen-1 finance during this transition', async ({ page }) => {
  // Decision: Option B from the plan. Snapshot restore updates Gen-2 only
  // (via Store.restoreSnapshot → notify('*')). Gen-1 stays authoritative;
  // any Store-side snapshot value is transient and is re-reconciled from
  // Gen-1 on the next reload via bridgeFinance's seedGen2FromGen1. This
  // test pins that behaviour so a future change that accidentally makes
  // snapshots authoritative for Gen-1 finance surfaces here.
  await seedFinance(page, {
    gen1: { russia: { salary: 100000, save_target: 77777 } },
    gen2Money: { salary_net: 100000, save_target: 77777, usd_rate: 88, expenses: {} },
  });
  await page.goto('/');
  await waitAppReady(page);

  // Simulate an older snapshot in Gen-2 containing different Russia money.
  // Push a snapshot manually via Store.set → autosave → snapshot buffer.
  await page.evaluate(async () => {
    window.Store.set('money.salary_net', 424242);
    window.Store.set('money.save_target', 313131);
    await new Promise(r => setTimeout(r, 400));   // let debounce persist + push snapshot
    // Now mutate to a "current" value so the snapshot above is the older one.
    window.Store.set('money.salary_net', 555555);
    window.Store.set('money.save_target', 606060);
    await new Promise(r => setTimeout(r, 400));
  });

  // Restore snapshot index 1 (the older Gen-2 money).
  const restored = await page.evaluate(() => window.Store.restoreSnapshot(1));
  // B0 restoreSnapshot returns { ok, error? } — validate the accepted case.
  expect(restored && restored.ok).toBe(true);
  // Give the coordinator a beat to complete the full-state transaction.
  await page.waitForTimeout(200);

  const s = await page.evaluate(() => ({
    gen1: JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'),
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  // Store reflects the restored snapshot values (Gen-2 was mutated).
  // Gen-1 was NOT mutated by snapshot restore — transitional non-canonical.
  expect(s.gen1.russia.salary).toBe(100000);
  expect(s.gen1.russia.save_target).toBe(77777);

  // On reload, bridge's seedGen2FromGen1 re-reconciles Gen-2 to Gen-1.
  await page.reload();
  await waitAppReady(page);
  const after = await page.evaluate(() => ({
    storeSalary: window.Store.get('money.salary_net'),
    storeSaveTarget: window.Store.get('money.save_target'),
  }));
  expect(after.storeSalary).toBe(100000);
  expect(after.storeSaveTarget).toBe(77777);
});
