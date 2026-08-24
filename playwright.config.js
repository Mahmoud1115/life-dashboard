// Playwright config for Dune Life OS. See docs/lifeos/TESTING.md.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  // `python3 -m http.server` is fine for a smoke suite but drops connections
  // under concurrent workers loading 15 script tags + fonts. The suite is
  // small; run one worker so the fixture doesn't become the flaky variable.
  workers: 1,
  forbidOnly: !!process.env.CI,
  // Zero local retries so first-attempt failures surface immediately.
  // CI keeps one retry as a courtesy for the rare fixture blip; that
  // rerun should be inspected, not treated as noise.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    // Tiny Node built-in static server committed at tools/test-server.js.
    // Node-only (no extra npm dep), binds 127.0.0.1, closes each
    // connection, serves the repo root. See TESTING.md.
    command: 'node tools/test-server.js',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
