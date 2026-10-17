// Backup reminder banner must keep its Export now and dismiss buttons.
// Regression: checkBackupReminder() wrote textContent on #backup-reminder,
// which removed the <span id="backup-reminder-text"> and both buttons.
const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 390, height: 844 } });

test('BR-01: backup reminder shows text AND Export now / dismiss buttons (mobile)', async ({ page }) => {
  await page.goto('/');
  const rem = page.locator('#backup-reminder');
  await expect(rem).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#backup-reminder-text')).toContainText('No backup yet');
  await expect(rem.getByRole('button', { name: 'Export now' })).toBeVisible();
  await expect(rem.getByRole('button', { name: '✕' })).toBeVisible();
});

test('BR-02: reminder text is not squeezed and the banner stays inside the viewport', async ({ page }) => {
  await page.goto('/');
  const rem = page.locator('#backup-reminder');
  await expect(rem).toBeVisible({ timeout: 10000 });
  const box = await rem.boundingBox();
  const textBox = await page.locator('#backup-reminder-text').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // text gets a full line: at least 180px wide (squeezed layout was ~100px)
  expect(textBox.width).toBeGreaterThanOrEqual(180);
});

test('BR-03: dismiss button hides the banner and keeps it hidden', async ({ page }) => {
  await page.goto('/');
  const rem = page.locator('#backup-reminder');
  await expect(rem).toBeVisible({ timeout: 10000 });
  await rem.getByRole('button', { name: '✕' }).click();
  await expect(rem).toBeHidden();
});
