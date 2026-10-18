const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'Europe/Moscow' });

test('training labels replace EASA in the nav, section, Today, and Goals', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00+03:00'));
  await page.goto('/');

  await page.locator('.nmb[data-group="career"]').click();
  await expect(page.locator('#nav-sub')).toContainText('Training Log Book');
  await expect(page.locator('#easa .sec-title')).toContainText('Training Log Book');

  const todayRow = page.locator('#today-goals-strip .today-goal-row').filter({ hasText: 'Training Log Book' });
  const goalsRow = page.locator('#goals-list .goal-card-live').filter({ hasText: 'Training Log Book' });
  await expect(todayRow).toHaveCount(1); // Today lives in another nav group, so assert presence, not visibility
  await expect(goalsRow).toHaveCount(1);

  await expect(page.locator('#nav-sub')).not.toContainText('EASA');
  await expect(page.locator('#easa .sec-title')).not.toContainText('EASA');
  const rows = (await page.locator('#today-goals-strip .today-goal-row').allTextContents())
    .concat(await page.locator('#goals-list .goal-card-live').allTextContents());
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.join(' ')).not.toContain('EASA');
});
