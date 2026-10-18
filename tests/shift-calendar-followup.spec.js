const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'Europe/Moscow' });

test('shift next-start projection handles in-progress and future windows', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T07:00:00+03:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Shifts' }).click();
  for (const [time, expected] of [
    ['07:00', 'Sunday, 18 October 2026 · 08:00'],
    ['12:00', 'In progress, ends 20:00'],
    ['21:00', 'Wednesday, 21 October 2026 · 08:00'],
  ]) {
    await page.clock.setFixedTime(new Date(`2026-10-18T${time}:00+03:00`));
    await page.locator('#shift-anchor').fill('2026-10-01');
    await expect(page.locator('#shift-next-start')).toHaveText(expected);
  }
});

test('OFF day next-start projection skips to the next ON day', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-19T12:00:00+03:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Shifts' }).click();
  await page.locator('#shift-anchor').fill('2026-10-01');
  await expect(page.locator('#shift-next-start')).toHaveText('Wednesday, 21 October 2026 · 08:00');
});

test('mobile bottom nav exposes Shifts and fits six entries at 390px', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T12:00:00+03:00') });
  await page.goto('/');
  await page.setViewportSize({ width: 390, height: 844 });
  const shifts = page.locator('.mob-nb[data-sec="shifts"]');
  await expect(shifts).toBeVisible();
  await shifts.click();
  await expect(page.locator('#shifts')).toHaveClass(/\bactive\b/);
  const layout = await page.locator('.mob-nb').evaluateAll((buttons) => ({
    count: buttons.length,
    labelsAtLeastTenPx: buttons.every((button) => parseFloat(getComputedStyle(button.querySelector('.mob-nb-label')).fontSize) >= 10),
    withinViewport: buttons.every((button) => { const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }),
  }));
  expect(layout).toEqual({ count: 6, labelsAtLeastTenPx: true, withinViewport: true });
});

test('shift day status labels remain visible at least 10px', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-18T12:00:00+03:00') });
  await page.goto('/');
  await page.getByRole('button', { name: 'Shifts' }).click();
  await page.locator('#shift-anchor').fill('2026-10-01');
  await expect(page.locator('.shift-p1-day strong').first()).toHaveCSS('font-size', '10px');
});
