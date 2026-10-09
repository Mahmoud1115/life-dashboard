// Regression guard for the mobile backup-panel scroll incident.
//
// INCIDENT (production, owner's phone): opening 📦 Backup & Restore on a
// phone showed the panel, but its content was taller than the viewport
// and the panel had no max-height / no scroll. With the overlay pinned
// (position:fixed) the panel's TOP — which holds the "✕ Close" button —
// was pushed above the screen edge with no way to scroll back to it, so
// the panel could not be closed.
//
// FIX (styles.css .backup-panel / -head / -body): cap the panel to the
// overlay height, make it a flex column, pin the header, and let only the
// body scroll. The header (Close) therefore stays in view no matter how
// far the body is scrolled.
//
// This test fails against the pre-fix CSS (Close off-screen) and passes
// against the fix. Deterministic: external subresources are aborted the
// same way as the smoke suite.
const { test, expect } = require('@playwright/test');

const LOCAL_ORIGIN = 'http://127.0.0.1:4173';
const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;
const APP_GITHUB_COMMITS_PATH = '/repos/Mahmoud1115/life-dashboard/commits';
const SYNTHETIC_COMMIT_ISO = '2026-08-24T00:00:00Z';

function isAppExpectedGithubCommitsRequest(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return false; }
  if (parsed.pathname !== APP_GITHUB_COMMITS_PATH) return false;
  if (parsed.searchParams.get('per_page') !== '1') return false;
  return Array.from(parsed.searchParams.keys()).length === 1;
}

let errors;

test.beforeEach(async ({ context, page }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) => {
    if (!isAppExpectedGithubCommitsRequest(route.request().url())) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: SYNTHETIC_COMMIT_ISO } } }]),
    });
  });
  errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location() && msg.location().url;
    if (url && EXPECTED_BLOCKED_URL.test(url)) return;
    errors.push(`console.error: ${msg.text()}${url ? ` (${url})` : ''}`);
  });
});

test.afterEach(() => {
  expect(errors, `Unexpected browser errors:\n${(errors || []).join('\n')}`).toEqual([]);
});

async function waitForAppReady(page) {
  await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
  await page.waitForFunction(() => typeof window.openBackupPanel === 'function');
}

// A phone viewport small enough that the full backup-panel content (export,
// import, recovery, and the GitHub Gist Sync block) overflows it — this is
// the condition that hid the Close button before the fix.
test.use({ viewport: { width: 390, height: 720 } });

test('backup panel Close stays reachable on a phone viewport', async ({ page }) => {
  await page.goto(LOCAL_ORIGIN + '/');
  await waitForAppReady(page);

  // Populate a saved Gist token so the panel renders its longest form (the
  // Gist Sync block with connected-backup rows), matching the owner's state.
  await page.evaluate(() => {
    try {
      localStorage.setItem('dune_github_token_v1', 'ghp_test_sentinel_token');
      localStorage.setItem('dune_gist_id_v1', 'g_mobile_scroll');
      localStorage.setItem('dune_last_gist_sync_v1', JSON.stringify('2026-09-09T10:57:58.000Z'));
      localStorage.removeItem('dune_gist_sync_base_v1');
    } catch (_) {}
  });

  await page.evaluate(() => window.openBackupPanel());

  const overlay = page.locator('#backup-panel');
  await expect(overlay).toBeVisible();

  const panel = overlay.locator('.backup-panel');
  const closeBtn = overlay.locator('.backup-panel-head button');
  await expect(closeBtn).toHaveText(/Close/);

  // 1) The panel must not exceed the viewport height (it is capped + scrolls
  //    internally rather than overflowing off both edges).
  const vh = page.viewportSize().height;
  const panelBox = await panel.boundingBox();
  expect(panelBox, 'panel should have a layout box').not.toBeNull();
  expect(panelBox.height).toBeLessThanOrEqual(vh + 1);

  // 2) Close must be fully inside the viewport immediately after opening.
  await expect(closeBtn).toBeInViewport({ ratio: 1 });

  // 3) Scroll the body all the way down (this is what the owner did to reach
  //    the Gist section). The header — and Close — must remain pinned in view.
  const body = overlay.locator('.backup-panel-body');
  await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const gistSummary = overlay.getByText('Bootstrap is required before ordinary Save or Load.', { exact: false });
  const bootstrapBtn = overlay.locator('#backup-sync-bootstrap-btn');
  await expect(gistSummary).toBeVisible();
  await expect(bootstrapBtn).toBeVisible();
  await expect(bootstrapBtn).toBeInViewport({ ratio: 1 });
  await expect(closeBtn).toBeInViewport({ ratio: 1 });

  // 4) Close actually closes the panel (proves the button is clickable, not
  //    merely painted under something).
  await closeBtn.click();
  await expect(overlay).toBeHidden();
});
