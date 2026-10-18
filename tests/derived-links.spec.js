// Regression coverage for audit C-03/C-04. All values are synthetic and
// confined to Playwright's disposable localhost browser context.

const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'Europe/Moscow' });

const FIXED_NOW = new Date('2026-10-18T12:00:00+03:00');
const GOOGLE_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_API = /^https?:\/\/api\.github\.com\//;

test.beforeEach(async ({ context, page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await context.route(GOOGLE_FONTS, route => route.abort());
  await context.route(GITHUB_API, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([{ commit: { author: { date: '2026-10-18T09:00:00Z' } } }]),
  }));
});

async function seedLegacy(page, { easa = {}, russia }) {
  await page.addInitScript(([easaState, financeState]) => {
    if (localStorage.getItem('__pr4_seeded')) return; // seed once: the init script also runs on reload
    localStorage.setItem('__pr4_seeded', '1');
    localStorage.setItem('dune_easa_v1', JSON.stringify(easaState));
    localStorage.setItem('dune_finance_v1', JSON.stringify({ russia: financeState }));
  }, [easa, russia]);
}

async function waitForDerivedViews(page) {
  await page.waitForFunction(() =>
    window.Store &&
    typeof window.Store.get === 'function' &&
    (typeof window.Store.getDurabilityBlocker !== 'function' || window.Store.getDurabilityBlocker() === null) &&
    document.querySelectorAll('#today-goals-strip .today-goal-row').length === 2 &&
    document.querySelectorAll('#goals-list .goal-card-live').length === 2
  );
}

function syntheticFinance() {
  return {
    salary: 100000,
    rent: 10000,
    food: 0,
    transport: 0,
    utilities: 0,
    phone: 0,
    family_transfer: 0,
    other: 0,
    mai: 0,
    usd_rate: 100,
    save_target: 100000,
    customIncome: [],
    customExpenses: [],
    customSeeded: true,
  };
}

test('C-03 — an EASA UI edit refreshes Today and Goals without reload', async ({ page }) => {
  await seedLegacy(page, {
    easa: { ea01: { status: 'not_started', progress: 0 } },
    russia: syntheticFinance(),
  });
  await page.goto('/');
  await waitForDerivedViews(page);
  const moduleCount = await page.evaluate(() => D.easa.length);

  const todayEasa = page.locator('#today-goals-strip .today-goal-row').filter({ hasText: 'EASA Part-66' });
  const goalsEasa = page.locator('#goals-list .goal-card-live').filter({ hasText: 'EASA Part-66' });
  await expect(todayEasa).toContainText(`0 of ${moduleCount} modules done`);
  await expect(goalsEasa).toContainText(`0 of ${moduleCount} modules done`);

  await page.evaluate(() => window.show('easa'));
  await page.locator('#easa-grid .easa-card').first().locator('.easa-status-select').selectOption('done');

  await expect(todayEasa).toContainText(`1 of ${moduleCount} modules done`);
  await expect(goalsEasa).toContainText(`1 of ${moduleCount} modules done`);
  await expect.poll(() => page.evaluate(() => window.Store.get('easa.ea01'))).toEqual({
    status: 'done',
    progress: 100,
  });
});

test('C-04 — custom income and expense update Today/Goals and survive reload', async ({ page }) => {
  await seedLegacy(page, { easa: {}, russia: syntheticFinance() });
  await page.goto('/');
  await waitForDerivedViews(page);

  const todayMoney = page.locator('#today-goals-strip .today-goal-row').filter({ hasText: 'Monthly Savings' });
  const goalsMoney = page.locator('#goals-list .goal-card-live').filter({ hasText: 'Monthly Savings' });
  await expect(todayMoney).toContainText('90,000 ₽ surplus');
  await expect(goalsMoney).toContainText('90,000 ₽ surplus');

  await page.evaluate(() => window.show('finance'));
  await page.locator('#mc-host [data-add="income"]').click();
  const incomeRow = page.locator('#mc-host .mc-row[data-kind="income"]').last();
  await incomeRow.locator('.mc-name').fill('Synthetic side work');
  await incomeRow.locator('.mc-amount').fill('5000');

  await page.locator('#mc-host [data-add="expense"]').click();
  const expenseRow = page.locator('#mc-host .mc-row[data-kind="expense"]').last();
  await expenseRow.locator('.mc-name').fill('Synthetic class');
  await expenseRow.locator('.mc-amount').fill('2000');

  await expect(todayMoney).toContainText('93,000 ₽ surplus');
  await expect(todayMoney.locator('.tg-pct')).toHaveText('93%');
  await expect(goalsMoney).toContainText('93,000 ₽ surplus');
  await expect(goalsMoney.locator('.goal-pct-static')).toHaveText('93%');

  await page.reload();
  await waitForDerivedViews(page);
  await expect(page.locator('#today-goals-strip .today-goal-row').filter({ hasText: 'Monthly Savings' }))
    .toContainText('93,000 ₽ surplus');
  await expect(page.locator('#goals-list .goal-card-live').filter({ hasText: 'Monthly Savings' }))
    .toContainText('93,000 ₽ surplus');
});

test('C-03b — EASA progress restored into storage reaches Today and Goals after reload, with no edit', async ({ page }) => {
  await seedLegacy(page, {
    easa: { ea02: { status: 'done', progress: 100 }, ea03: { status: 'done', progress: 100 } },
    russia: syntheticFinance(),
  });
  await page.goto('/');
  await waitForDerivedViews(page);
  const moduleCount = await page.evaluate(() => D.easa.length);
  await expect(page.locator('#today-goals-strip .today-goal-row').filter({ hasText: 'EASA Part-66' }))
    .toContainText(`2 of ${moduleCount} modules done`);
  // Make sure the Store wrapper is durably written, so the next boot loads it as-is (no legacy re-derivation).
  await page.waitForFunction(() => !!localStorage.getItem('dune_state_v4'));
  await page.waitForTimeout(800);
  // Simulate a restore/import that rewrites the Gen-1 key behind the Store's back.
  await page.evaluate(() => localStorage.setItem('dune_easa_v1', JSON.stringify({ ea01: { status: 'done', progress: 100 } })));
  await page.reload();
  await waitForDerivedViews(page);
  await expect(page.locator('#today-goals-strip .today-goal-row').filter({ hasText: 'EASA Part-66' }))
    .toContainText(`1 of ${moduleCount} modules done`);
  await expect(page.locator('#goals-list .goal-card-live').filter({ hasText: 'EASA Part-66' }))
    .toContainText(`1 of ${moduleCount} modules done`);
});

test('C-04b — a non-finite custom amount is ignored instead of poisoning the totals', async ({ page }) => {
  const fin = syntheticFinance();
  fin.customIncome = [{ id: 'c_a', name: 'Synthetic ok', amount: 5000 }, { id: 'c_b', name: 'Synthetic huge', amount: '1e999' }];
  await seedLegacy(page, { easa: {}, russia: fin });
  await page.goto('/');
  await waitForDerivedViews(page);
  await page.evaluate(() => window.show('finance'));
  await page.evaluate(() => window.finRecompute());
  expect(await page.evaluate(() => window.Store.get('money.custom_income_total'))).toBe(5000);
});

test('C-03c — a missing Gen-1 EASA key does not wipe the Store shadow at boot', async ({ page }) => {
  await seedLegacy(page, {
    easa: { ea02: { status: 'done', progress: 100 }, ea03: { status: 'done', progress: 100 } },
    russia: syntheticFinance(),
  });
  await page.goto('/');
  await waitForDerivedViews(page);
  await page.waitForFunction(() => !!localStorage.getItem('dune_state_v4'));
  await page.waitForTimeout(800);
  await page.evaluate(() => localStorage.removeItem('dune_easa_v1')); // e.g. an import whose backup lacks the key
  await page.reload();
  await waitForDerivedViews(page);
  expect(await page.evaluate(() => Object.keys(window.Store.get('easa') || {}).sort())).toEqual(['ea02', 'ea03']);
});
