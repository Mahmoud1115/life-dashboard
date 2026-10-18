// Storage write failures must never clear owner input or claim success.
// Runs against Playwright's isolated localhost storage, never a real profile.
const { test, expect } = require('@playwright/test');

test('SWF-01: failed Review write keeps text and shows failure without saved state', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.Store && typeof window.Store.flushNow === 'function');
  await page.getByRole('button', { name: '📓 Weekly Review' }).click();
  await page.locator('#rev-wins').fill('Synthetic review text that must survive');

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'dune_state_v4') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });

  await page.getByRole('button', { name: '💾 Save Review' }).click();

  await expect(page.locator('#rev-wins')).toHaveValue('Synthetic review text that must survive');
  await expect(page.locator('#backup-toast')).toBeVisible();
  await expect(page.locator('#backup-toast')).toContainText(/could not save|storage/i);
  await expect(page.locator('#backup-toast')).not.toContainText(/saved/i);
  await expect(page.locator('#review-saved-ind')).toHaveCSS('opacity', '0');
});

test('SWF-02: failed Logbook write keeps the open form and typed task', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.show('logbook'));
  await page.getByRole('button', { name: '+ Add Entry' }).click();
  await page.locator('[name="lb_company"]').fill('Synthetic MRO');
  await page.locator('[name="lb_aircraft"]').fill('Synthetic A320');
  await page.locator('[name="lb_ata"]').fill('72');
  await page.locator('[name="lb_task"]').fill('Synthetic task that must survive');
  await page.locator('[name="lb_hours"]').fill('2');

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'dune_logbook_v1') throw new DOMException('Synthetic quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });

  await page.locator('#lb-form').getByRole('button', { name: 'Save Entry' }).click();

  await expect(page.locator('#lb-form')).toBeVisible();
  await expect(page.locator('[name="lb_task"]')).toHaveValue('Synthetic task that must survive');
  await expect(page.locator('#backup-toast')).toBeVisible();
  await expect(page.locator('#backup-toast')).toContainText(/storage write failed/i);
  await expect(page.locator('#backup-toast')).not.toContainText(/saved/i);
});
