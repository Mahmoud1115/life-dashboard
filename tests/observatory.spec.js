const { test, expect } = require('@playwright/test');

async function openSystem(page, manifest) {
  await page.route('**/system-manifest.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(manifest)
  }));
  await page.goto('/');
  await page.getByRole('button', { name: /System/i }).click();
}

test('F10 — missing evidence is UNKNOWN, never healthy', async ({ page }) => {
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: null,
    staleAfterSeconds: 86400, sourceSha: 'UNGENERATED',
    components: [{ id: 'core', label: 'DUNE Core', status: 'UNKNOWN', observedAt: null, summary: 'No evidence.', evidence: 'Awaiting review' }]
  });
  await expect(page.locator('#obs-summary .obs-state')).toHaveText('UNKNOWN');
  await expect(page.locator('#obs-components .obs-state')).toHaveText('UNKNOWN');
});

test('F10 — expired healthy evidence becomes STALE', async ({ page }) => {
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: '2020-01-01T00:00:00Z',
    staleAfterSeconds: 60, sourceSha: 'abc1234',
    components: [{ id: 'core', label: 'DUNE Core', status: 'HEALTHY', observedAt: '2020-01-01T00:00:00Z', summary: 'Old probe.', evidence: 'Synthetic' }]
  });
  await expect(page.locator('#obs-summary .obs-state')).toHaveText('STALE');
  await expect(page.locator('#obs-components .obs-state')).toHaveText('STALE');
});

test('F10 — invalid manifest fails closed and Life OS Store remains available', async ({ page }) => {
  await openSystem(page, { schema: 99, classification: 'PRIVATE', components: [] });
  await expect(page.locator('#obs-summary .obs-state')).toHaveText('UNKNOWN');
  expect(await page.evaluate(() => Boolean(window.Store && Store.get('todayFocus')))).toBe(true);
});

test('F10 — manifest text is rendered inert and Observatory does not write storage', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('obs-test-sentinel', 'unchanged'));
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: new Date().toISOString(),
    staleAfterSeconds: 86400, sourceSha: 'abc1234',
    components: [{ id: 'core', label: '<img src=x onerror="window.__obsXss=1">', status: 'HEALTHY', observedAt: new Date().toISOString(), summary: '<script>bad()</script>', evidence: 'review' }]
  });
  await expect(page.locator('#obs-components img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__obsXss || 0)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('obs-test-sentinel'))).toBe('unchanged');
});

test('F10 — healthy without its own observation time is UNKNOWN, not fresh from the manifest time', async ({ page }) => {
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: new Date().toISOString(), staleAfterSeconds: 86400, sourceSha: 'abc1234',
    components: [{ id: 'core', label: 'DUNE Core', status: 'HEALTHY', observedAt: null, summary: 'No probe.', evidence: 'None' }]
  });
  await expect(page.locator('#obs-components .obs-state')).toHaveText('UNKNOWN');
  await expect(page.locator('#obs-summary .obs-state')).toHaveText('UNKNOWN');
});

test('F10 — future-dated or timezone-less observations are not evidence', async ({ page }) => {
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: new Date().toISOString(), staleAfterSeconds: 86400, sourceSha: 'abc1234',
    components: [
      { id: 'a', label: 'Future', status: 'HEALTHY', observedAt: '2999-01-01T00:00:00Z', summary: 's', evidence: 'e' },
      { id: 'b', label: 'No zone', status: 'HEALTHY', observedAt: '2030-01-01T00:00:00', summary: 's', evidence: 'e' }
    ]
  });
  await expect(page.locator('#obs-components .obs-state')).toHaveText(['UNKNOWN', 'UNKNOWN']);
});

test('F10 — a huge staleness window cannot keep ancient evidence healthy', async ({ page }) => {
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: '2001-01-01T00:00:00Z', staleAfterSeconds: 1e12, sourceSha: 'abc1234',
    components: [{ id: 'core', label: 'DUNE Core', status: 'HEALTHY', observedAt: '2001-01-01T00:00:00Z', summary: 'Old.', evidence: 'Synthetic' }]
  });
  await expect(page.locator('#obs-components .obs-state')).toHaveText('STALE');
});

test('F10 — recent healthy evidence still renders HEALTHY (the rules are not just stricter everywhere)', async ({ page }) => {
  const recent = new Date(Date.now() - 60000).toISOString();
  await openSystem(page, {
    schema: 1, classification: 'PUBLIC_SAFE', generatedAt: recent, staleAfterSeconds: 86400, sourceSha: 'abc1234',
    components: [{ id: 'core', label: 'DUNE Core', status: 'HEALTHY', observedAt: recent, summary: 'Probe ok.', evidence: 'Synthetic' }]
  });
  await expect(page.locator('#obs-summary .obs-state')).toHaveText('HEALTHY');
});
