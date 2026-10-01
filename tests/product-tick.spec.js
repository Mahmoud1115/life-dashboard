const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.Store && window.IDEAS);
});

test('Product Tick — capture adds an idea without a new storage key', async ({ page }) => {
  await page.locator('#pt-capture-input').fill('Synthetic captured task');
  await page.locator('#pt-capture-btn').click();
  await expect(page.locator('#pt-capture-status')).toHaveText('Captured in Ideas.');
  const result = await page.evaluate(() => ({
    idea: Store.get('ideas').find(i => i.title === 'Synthetic captured task'),
    extraKey: localStorage.getItem('dune_product_tick')
  }));
  expect(result.idea.status).toBe('parked');
  expect(result.extraKey).toBeNull();
});

test('Product Tick — NOW outcome writes an existing-shape decision and clears the slot', async ({ page }) => {
  await page.locator('input[data-focus-idx="0"]').fill('Synthetic NOW item');
  await page.waitForTimeout(250);
  await page.locator('button[data-outcome-idx="0"]').click();
  await page.locator('#pt-outcome-result').selectOption('changed');
  await page.locator('#pt-outcome-note').fill('Scope changed safely.');
  await page.locator('#pt-outcome-save').click();
  await expect(page.locator('#pt-capture-status')).toHaveText('Outcome saved. NOW slot cleared.');
  const result = await page.evaluate(() => ({ focus: Store.get('todayFocus')[0], outcome: Store.get('decisions').at(-1) }));
  expect(result.focus).toBe('');
  expect(result.outcome).toMatchObject({ title: 'Synthetic NOW item', reasoning: 'Scope changed safely.', kind: 'outcome', result: 'changed' });
});

test('Product Tick — persisted outcome text is rendered as text, never markup', async ({ page }) => {
  await page.evaluate(() => Store.set('decisions', [{
    at: new Date().toISOString(), title: '<img src=x onerror="window.__ptXss=1">', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done'
  }]));
  await expect(page.locator('#pt-week-outcomes')).toContainText('<img src=x onerror="window.__ptXss=1">');
  await expect(page.locator('#pt-week-outcomes img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__ptXss || 0)).toBe(0);
});

test('Product Tick — weekly review prefill separates done and unresolved outcomes', async ({ page }) => {
  const now = new Date().toISOString();
  await page.evaluate((at) => Store.set('decisions', [
    { at, title: 'Finished item', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' },
    { at, title: 'Changed item', reasoning: 'New plan', expected: '', success: '', kind: 'outcome', result: 'changed' }
  ]), now);
  await page.getByRole('button', { name: '📓 Weekly Review' }).click();
  await page.locator('#pt-prefill-review').click();
  await expect(page.locator('#rev-wins')).toHaveValue('• Finished item');
  await expect(page.locator('#rev-problems')).toHaveValue('• Changed item — New plan');
});

test('Product Tick — outcomes stay out of the Decision Journal', async ({ page }) => {
  await page.evaluate(() => Store.set('decisions', [
    { at: new Date().toISOString(), title: 'A real decision', reasoning: '', expected: '', success: '' },
    { at: new Date().toISOString(), title: 'A recorded outcome', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' }
  ]));
  await page.getByRole('button', { name: '📓 Weekly Review' }).click();
  await page.getByRole('button', { name: 'Decision Journal' }).click();
  await expect(page.locator('#decisions-list')).toContainText('A real decision');
  await expect(page.locator('#decisions-list')).not.toContainText('A recorded outcome');
});

test('Product Tick — prefill preserves review text already typed by the owner', async ({ page }) => {
  await page.evaluate(() => Store.set('decisions', [
    { at: new Date().toISOString(), title: 'Finished item', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' },
    { at: new Date().toISOString(), title: 'Changed item', reasoning: 'New plan', expected: '', success: '', kind: 'outcome', result: 'changed' }
  ]));
  await page.getByRole('button', { name: '📓 Weekly Review' }).click();
  await page.locator('#rev-wins').fill('Owner-authored win');
  await page.locator('#pt-prefill-review').click();
  await expect(page.locator('#rev-wins')).toHaveValue('Owner-authored win');
  await expect(page.locator('#rev-problems')).toHaveValue('• Changed item — New plan');
});

test('Product Tick — refuses a stale outcome panel after the NOW item changes', async ({ page }) => {
  await page.locator('input[data-focus-idx="0"]').fill('Original item');
  await page.waitForTimeout(250);
  await page.locator('button[data-outcome-idx="0"]').click();
  await page.evaluate(() => {
    const focus = Store.get('todayFocus').slice();
    focus[0] = 'Changed elsewhere';
    Store.set('todayFocus', focus);
  });
  await page.locator('#pt-outcome-save').click();
  await expect(page.locator('#pt-capture-status')).toHaveText('NOW item changed. Reopen Outcome before saving.');
  const result = await page.evaluate(() => ({ focus: Store.get('todayFocus')[0], outcomes: Store.get('decisions').filter(d => d.kind === 'outcome') }));
  expect(result.focus).toBe('Changed elsewhere');
  expect(result.outcomes).toHaveLength(0);
});

test('Product Tick — a mistaken outcome can be removed without touching decisions', async ({ page }) => {
  await page.evaluate(() => Store.set('decisions', [
    { at: new Date().toISOString(), title: 'Keep decision', reasoning: '', expected: '', success: '' },
    { at: new Date().toISOString(), title: 'Mistaken outcome', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'not_done' }
  ]));
  await page.getByRole('button', { name: '📓 Weekly Review' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#pt-week-outcomes').getByRole('button', { name: 'Remove' }).click();
  const remaining = await page.evaluate(() => Store.get('decisions'));
  expect(remaining).toHaveLength(1);
  expect(remaining[0].title).toBe('Keep decision');
});

test('Product Tick — outcome Remove buttons are individually named and never delete a different entry', async ({ page }) => {
  const at = new Date().toISOString();
  await page.evaluate((at) => Store.set('decisions', [
    { at, title: 'ALPHA', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' },
    { at, title: 'BETA', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' }
  ]), at);
  await page.getByRole('button', { name: '📓 Weekly Review' }).click();
  const root = page.locator('#pt-week-outcomes');
  await expect(root.getByRole('button', { name: 'Remove outcome: ALPHA' })).toHaveCount(1);
  await expect(root.getByRole('button', { name: 'Remove outcome: BETA' })).toHaveCount(1);
  // a non-notifying writer swaps the entry at the rendered index: the stale button must not delete it
  await page.evaluate((at) => {
    const swapped = [{ at, title: 'SWAPPED', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' },
                     { at, title: 'BETA2', reasoning: '', expected: '', success: '', kind: 'outcome', result: 'done' }];
    const original = Store.get; window.__origGet = original;
    Store.get = (key) => key === 'decisions' ? swapped : original.call(Store, key);
  }, at);
  page.once('dialog', dialog => dialog.accept());
  await root.getByRole('button', { name: 'Remove outcome: BETA' }).click();
  const untouched = await page.evaluate(() => { Store.get = window.__origGet; return Store.get('decisions').map(d => d.title); });
  expect(untouched).toEqual(['ALPHA', 'BETA']);
});
