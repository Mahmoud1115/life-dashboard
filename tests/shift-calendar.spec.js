const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'Europe/Moscow' });

async function openFixedCalendar(page) {
  await page.clock.install({ time: new Date('2028-02-15T09:00:00+03:00') });
  await page.goto('/');
  await page.waitForFunction(() => window.ShiftCalendar && window.Store);
}

test.beforeEach(async ({ page }) => {
  await openFixedCalendar(page);
});

test('pattern math stays 2 ON / 2 OFF over month and year boundaries', async ({ page }) => {
  const states = await page.evaluate(() => {
    const status = window.ShiftCalendar.statusForDate;
    return [
      status('2027-12-30', '2027-12-30'),
      status('2027-12-30', '2027-12-31'),
      status('2027-12-30', '2028-01-01'),
      status('2027-12-30', '2028-01-02'),
      status('2027-12-30', '2028-01-03'),
    ];
  });
  expect(states).toEqual(['ON', 'ON', 'OFF', 'OFF', 'ON']);
});

test('pattern math handles leap day 2028-02-29', async ({ page }) => {
  const states = await page.evaluate(() => {
    const status = window.ShiftCalendar.statusForDate;
    return [
      status('2028-02-27', '2028-02-27'),
      status('2028-02-27', '2028-02-28'),
      status('2028-02-27', '2028-02-29'),
      status('2028-02-27', '2028-03-01'),
      status('2028-02-27', '2028-03-02'),
    ];
  });
  expect(states).toEqual(['ON', 'ON', 'OFF', 'OFF', 'ON']);
});

test('anchor on a month last day begins a working pair', async ({ page }) => {
  const states = await page.evaluate(() => {
    const status = window.ShiftCalendar.statusForDate;
    return [
      status('2028-04-30', '2028-04-30'),
      status('2028-04-30', '2028-05-01'),
      status('2028-04-30', '2028-05-02'),
    ];
  });
  expect(states).toEqual(['ON', 'ON', 'OFF']);
});

test('manual overrides take precedence without double counting', async ({ page }) => {
  const result = await page.evaluate(() => {
    const overrides = {
      '2028-02-03': 'EXTRA', // pattern OFF
      '2028-02-05': 'OFF',   // pattern ON
    };
    return {
      extra: window.ShiftCalendar.statusForDate('2028-02-01', '2028-02-03', overrides),
      turnedOff: window.ShiftCalendar.statusForDate('2028-02-01', '2028-02-05', overrides),
      summary: window.ShiftCalendar.summarizeMonth(2028, 1, '2028-02-01', overrides),
    };
  });
  expect(result.extra).toBe('EXTRA');
  expect(result.turnedOff).toBe('OFF');
  expect(result.summary.extraDays).toBe(1);
  expect(result.summary.onDays).toBe(14);
  expect(result.summary.offDays).toBe(14);
  expect(result.summary.totalHours).toBe(180);
});

test('synthetic month summary totals use the named shift length default', async ({ page }) => {
  const result = await page.evaluate(() => ({
    defaults: window.ShiftCalendar.DEFAULTS,
    summary: window.ShiftCalendar.summarizeMonth(2028, 1, '2028-02-01', {}),
  }));
  expect(result.defaults).toMatchObject({ startTime: '08:00', shiftLengthHours: 12 });
  expect(result.summary).toMatchObject({ onDays: 15, extraDays: 0, offDays: 14, totalHours: 180 });
});

test('Shifts tab is reachable and remains empty until an anchor is chosen', async ({ page }) => {
  await page.locator('.nmb[data-group="shifts"]').click();
  await expect(page.locator('#shifts')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#shift-empty')).toBeVisible();
  await expect(page.locator('#shift-calendar-grid')).toBeEmpty();
  await page.locator('#shift-anchor').fill('2028-02-01');
  await expect(page.locator('#shift-calendar-grid [data-date="2028-02-01"]')).toContainText('ON');
  await expect(page.locator('#shift-summary')).toContainText('180');
  await expect(page.locator('#shift-next-start')).toContainText('17 February 2028 · 08:00');
});

test('day controls set EXTRA and OFF overrides in memory', async ({ page }) => {
  await page.locator('.nmb[data-group="shifts"]').click();
  await page.locator('#shift-anchor').fill('2028-02-01');
  await page.locator('#shift-calendar-grid [data-date="2028-02-03"]').click();
  await page.getByRole('button', { name: 'Mark selected day EXTRA' }).click();
  await expect(page.locator('#shift-calendar-grid [data-date="2028-02-03"]')).toContainText('EXTRA');
  await expect(page.locator('#shift-summary')).toContainText('192'); // 16 working days after EXTRA alone
  await page.locator('#shift-calendar-grid [data-date="2028-02-05"]').click();
  await page.getByRole('button', { name: 'Mark selected day OFF' }).click();
  await expect(page.locator('#shift-calendar-grid [data-date="2028-02-05"]')).toContainText('OFF');
  await expect(page.locator('#shift-summary')).toContainText('180');
});

test('mobile 390x844 has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.nmb[data-group="shifts"]').click();
  await page.locator('#shift-anchor').fill('2028-02-01');
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test('Shifts tab interactions do not write localStorage', async ({ page }) => {
  // The app's own "last updated" fetch writes dune_last_commit_cache_v1 in the background; block it so only Shifts activity can change storage.
  await page.context().route(/^https?:\/\/api\.github\.com\//, route => route.abort());
  await page.reload();
  await page.evaluate(async () => {
    if (window.Store && window.Store.flushNow) await window.Store.flushNow();
  });
  const before = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter(Boolean)
      .sort()
      .map((key) => [key, localStorage.getItem(key)]),
  ));

  await page.locator('.nmb[data-group="shifts"]').click();
  await page.locator('#shift-anchor').fill('2028-02-01');
  await page.locator('#shift-calendar-grid [data-date="2028-02-03"]').click();
  await page.getByRole('button', { name: 'Mark selected day EXTRA' }).click();
  await page.getByRole('button', { name: 'Next month' }).click();
  await page.getByRole('button', { name: 'Previous month' }).click();

  const after = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter(Boolean)
      .sort()
      .map((key) => [key, localStorage.getItem(key)]),
  ));
  expect(after).toEqual(before);
});
