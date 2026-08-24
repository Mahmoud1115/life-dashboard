// Life OS smoke suite. See docs/lifeos/TESTING.md and ADR-009.
const { test, expect } = require('@playwright/test');

const LOCAL_ORIGIN = 'http://127.0.0.1:4173';
// Google Fonts is the one external subresource index.html asks for. We
// abort it at the Playwright layer so the fixture stays deterministic;
// the fallback font stack renders the app correctly without it. Failures
// of these URLs are expected and must not fail the test.
const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;

// The one specific external endpoint app.js:31 fetches — a "last updated"
// widget reading commits[0].commit.author.date. We catch every
// api.github.com request and only fulfill when the parsed URL matches
// exactly: pathname + per_page=1 + no extra query params. Any drift
// (a different path, extra params, a stray call) is aborted, which
// surfaces as `requestfailed` and trips the strict collector rules.
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

const NAV = [
  ['home',      'home'],
  ['money',     'finance'],
  ['goals',     'progress'],
  ['career',    'career-tracker'],
  ['documents', 'passport'],
  ['about',     'aboutyou'],
  ['review',    'review'],
  ['sync',      'sync'],
];

// Shared per-test error bucket. workers=1 in playwright.config.js so a
// single `let` is safe. Populated by beforeEach, asserted by afterEach.
let errors;

test.beforeEach(async ({ context, page }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) => {
    if (!isAppExpectedGithubCommitsRequest(route.request().url())) {
      return route.abort();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { commit: { author: { date: SYNTHETIC_COMMIT_ISO } } },
      ]),
    });
  });

  errors = [];

  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location() && msg.location().url;
    // Ignore console noise from the external subresources we deliberately
    // block. Every other console.error is real and must fail the test.
    if (url && EXPECTED_BLOCKED_URL.test(url)) return;
    errors.push(`console.error: ${msg.text()}${url ? ` (${url})` : ''}`);
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    if (EXPECTED_BLOCKED_URL.test(url)) return;
    const failure = req.failure();
    errors.push(`requestfailed: ${url} — ${failure ? failure.errorText : 'unknown'}`);
  });

  page.on('response', (res) => {
    const url = res.url();
    if (!url.startsWith(LOCAL_ORIGIN)) return;
    if (res.status() >= 400) {
      errors.push(`http ${res.status()}: ${url}`);
    }
  });
});

test.afterEach(() => {
  expect(
    errors,
    `Unexpected browser/network errors:\n${(errors || []).join('\n')}`,
  ).toEqual([]);
});

async function waitForStore(page) {
  await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
}

// Gate on both `core.js` (Store) AND `app.js`'s DOMContentLoaded init
// having run, otherwise a fast first click can land before the init pass
// that marks #home as .active, and the first sweep assertion races.
async function waitForAppReady(page) {
  await waitForStore(page);
  await page.waitForFunction(() =>
    typeof window.showGroup === 'function' &&
    !!document.querySelector('#home.sec.active')
  );
}

async function sweepNav(page) {
  for (const [group, primary] of NAV) {
    await page.locator(`.nmb[data-group="${group}"]`).click();
    await expect(page.locator(`#${primary}.sec`)).toHaveClass(/\bactive\b/);
  }
}

test('1. application loads successfully', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav.nav[aria-label="Main navigation"]')).toBeVisible();
  await waitForAppReady(page);
  await expect(page.locator('#home.sec.active')).toBeVisible();
});

test('2. primary navigation sections can be opened', async ({ page }) => {
  await page.goto('/');
  await waitForAppReady(page);
  await sweepNav(page);
});

test('3. navigation sweep produces no unexpected browser errors', async ({ page }) => {
  // The error/network monitors installed in beforeEach do the checking;
  // afterEach makes the assertion. This test's job is to walk the app so
  // the monitors have something to observe.
  await page.goto('/');
  await waitForAppReady(page);
  await sweepNav(page);
});

// NOTE: Life OS has no `prefers-color-scheme` styling or theme system today
// (verified against origin/main). Visual output is identical between the
// two preferences. These tests guard against a regression where a future
// theme system half-lands and one preference breaks the app. See
// docs/lifeos/TESTING.md for the honest scope of this check.
test.describe('4. app remains functional under dark OS color preference', () => {
  test.use({ colorScheme: 'dark' });
  test('load + nav sweep + no browser errors', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await sweepNav(page);
  });
});

test.describe('4. app remains functional under light OS color preference', () => {
  test.use({ colorScheme: 'light' });
  test('load + nav sweep + no browser errors', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
    await sweepNav(page);
  });
});

test.describe('5. prefers-reduced-motion: reduce is respected', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('.sec animation-duration collapsed and .tg-fill transition-duration collapsed', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    // .sec is universal — every section has animation: secIn ...
    await expect(page.locator('#home.sec.active')).toBeVisible();
    const secAnim = await page.evaluate(() => {
      const el = document.querySelector('#home.sec');
      return getComputedStyle(el).animationDuration;
    });
    expect(parseFloat(secAnim)).toBeLessThanOrEqual(0.02);

    // .tg-fill is rendered by renderGoalsStrip() into #today-goals-strip
    // via Store.subscribe('*') on load. Assert presence, then behavior.
    const tgFill = page.locator('#today-goals-strip .tg-fill').first();
    await expect(tgFill).toBeAttached();
    const tgTrans = await tgFill.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(tgTrans)).toBeLessThanOrEqual(0.02);
  });
});

test('6. synthetic Gen-2 persistence/rehydration round-trip on ideas', async ({ page }) => {
  const marker = `pw-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await page.goto('/');
  await waitForAppReady(page);

  // Baseline shape
  expect(await page.evaluate(() => Array.isArray(window.Store.get('ideas')))).toBe(true);

  // Write synthetic entry, persist immediately
  await page.evaluate((m) => {
    window.Store.set('ideas', [{ id: 'pw-1', text: m, ts: Date.now() }]);
    window.Store.persistNow();
  }, marker);

  // Confirm the write landed in the persisted dune_state_v4 blob
  await expect.poll(async () => page.evaluate(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('dune_state_v4') || '{}');
      return raw && raw.data && Array.isArray(raw.data.ideas) && raw.data.ideas[0] && raw.data.ideas[0].id;
    } catch (_) { return null; }
  })).toBe('pw-1');

  // Reload and wait for Store to rehydrate with our marker
  await page.reload();
  await waitForAppReady(page);
  await page.waitForFunction(
    (expected) => {
      const ideas = window.Store.get('ideas');
      return Array.isArray(ideas) && ideas[0] && ideas[0].text === expected;
    },
    marker,
  );

  // Round-trip assertion using the test-scope marker
  const rehydrated = await page.evaluate(() => window.Store.get('ideas')[0].text);
  expect(rehydrated).toBe(marker);
});
