const { test, expect } = require('@playwright/test');

test.describe('PR-3 date fixes', () => {
  test.use({ timezoneId: 'Europe/Moscow' });

  async function boot(page) {
    await page.clock.install({ time: new Date('2026-10-18T22:30:00Z') });
    await page.goto('/');
    await page.waitForFunction(() => window.Store && window.BHT);
  }

  test('uses the Moscow local date for Logbook and Review defaults', async ({ page }) => {
    await boot(page);
    await page.locator('.nmb[data-group="review"]').click();
    await expect(page.locator('#rev-week')).toHaveValue('2026-10-19');
    await page.locator('.nmb[data-group="documents"]').click();
    await page.evaluate(() => window.show && window.show('logbook'));
    await expect(page.locator('#lb-date-input')).toHaveValue('2026-10-19');
  });

  test('clearing the aviation start date never renders NaN', async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => {
      window.Store.set('career.started', '');
      await window.Store.flushNow();
      window.showGroup('career');
    });
    await expect(page.locator('body')).not.toContainText('NaN');
  });

  test('future BHT entries are excluded by main and worker analytics', async ({ page }) => {
    await boot(page);
    const result = await page.evaluate(async () => {
      const habit = { id: 'h_test', name: 'Test', severityWeight: 3 };
      const base = { habits: [habit], entries: [], lifeEvents: [], todayKey: '2026-10-19', days: 90 };
      const future = Object.assign({}, base, { entries: [{ id: 'e_future', habitId: 'h_test', date: '2026-10-20', occurred: true, severity: 'major', stressLevel: 5, sleepHours: 3, resisted: false }] });
      const main = (payload) => {
        const s = { bht: payload };
        return window.BHT.derive.overallRiskScore(s);
      };
      const workerSource = await (await fetch('/bht-worker.js')).text();
      const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })));
      const compute = (payload) => new Promise((resolve, reject) => {
        const id = Math.random().toString();
        const onMessage = (event) => { if (event.data.id === id) { worker.removeEventListener('message', onMessage); resolve(event.data.payload); } };
        worker.addEventListener('message', onMessage);
        worker.postMessage(Object.assign({ type: 'compute', id }, { payload }));
        setTimeout(() => reject(new Error('worker timeout')), 2000);
      });
      const workerBase = await compute(base);
      const workerFuture = await compute(future);
      worker.terminate();
      return {
        mainBase: main(base), mainFuture: main(future),
        workerBase: workerBase.risk, workerFuture: workerFuture.risk
      };
    });
    expect(result.mainFuture).toEqual(result.mainBase);
    expect(result.workerFuture).toEqual(result.workerBase);
  });
});
