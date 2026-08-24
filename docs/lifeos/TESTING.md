# Testing — Playwright smoke suite

Regression coverage for the Dune Life OS static site. See ADR-009 for the
tooling boundary and ADR-002 for the runtime boundary.

## What this suite is

- **Playwright Test** runner (`@playwright/test` pinned at `1.62.1`), Chromium only.
- Six smoke checks. Not exhaustive coverage — a floor, not a ceiling.
- Runs against a local `node tools/test-server.js` on `127.0.0.1:4173`. **Never against production GitHub Pages.**
- All data is synthetic. Isolated Playwright browser contexts (one per test) guarantee no bleed into the developer's real `localStorage`.

## Requirements

- Node.js (any recent LTS — no version pinned in `package.json` on purpose). Node runs both Playwright and the tiny static server at `tools/test-server.js`.

## First-time setup

```bash
npm install
npm run test:install
```

`test:install` downloads the Chromium browser binaries Playwright needs.
It does **not** pass `--with-deps` — installing OS-level dependencies is a
CI-specific concern and out of scope for this initial setup.

## Running the suite

```bash
npm test
```

Playwright starts the static server itself (`webServer.command`) and reuses
an already-running one during local dev (`reuseExistingServer: !process.env.CI`).

The static server for the suite is [`tools/test-server.js`](../../tools/test-server.js) —
a tiny Node built-in-only implementation. It binds `127.0.0.1:4173`,
serves the repo root, strips query strings, rejects any resolved path
outside the root, and sends `Connection: close` per response so Chromium's
cold-context load bursts never race stale keep-alive sockets. No extra
npm dependency.

The suite runs with `workers: 1` on purpose. The suite is small enough
that serial execution is faster than debugging worker contention.

`retries` is `0` locally and `1` on CI. First-attempt failures must
surface immediately during development. A rare fixture blip on CI can
retry once, but any run that passed only on retry should be inspected,
not treated as noise.

## Error collection

`beforeEach` attaches the same set of listeners to every test's page:

- `pageerror` — any uncaught JS exception → test failure.
- `console.error` — classified by `msg.location().url`:
  - **The only URL-based drop is the intentionally aborted Google Fonts
    stylesheet** (`fonts.googleapis.com` / `fonts.gstatic.com`). That
    abort produces a Chromium "Failed to load resource" console line
    which is expected fixture noise.
  - Every other `console.error` → test failure. `Failed to load resource`
    is **not** blanket-filtered — the URL is inspected so a missing local
    asset cannot pass silently. The GitHub commits endpoint is **not**
    on this list either; it is handled explicitly by a synthetic route
    fulfill (see next section), not by ignoring its console noise.
- `requestfailed` — any request whose URL is not the Google Fonts
  intentional abort → test failure. This includes every same-origin
  (`http://127.0.0.1:4173/…`) resource and any unexpected external URL.
- `response` — any response from `http://127.0.0.1:4173/…` with status
  `>= 400` → test failure.

`afterEach` asserts the collected error list is empty, printing every
entry when it isn't.

## Expected external network handling

Two intercepts are installed at the Playwright layer via `context.route`
so the fixture never depends on real internet availability:

- **Aborted:** `fonts.googleapis.com` and `fonts.gstatic.com` — the one
  Google Fonts stylesheet in `index.html`. Response time varies enough
  to destabilize load-state waits. The site's fallback font stack renders
  correctly without it and none of the six checks depend on which glyphs
  paint.
- **Fulfilled with a synthetic 200:** the one specific request
  [`app.js:31`](../../app.js#L31) makes. The route handler catches every
  `api.github.com` URL, parses it, and only fulfills when the shape
  matches exactly:
  - pathname is `/repos/Mahmoud1115/life-dashboard/commits`
  - `per_page` query parameter equals `"1"`
  - no other query parameters are present
  It replies with `[{ commit: { author: { date: '2026-08-24T00:00:00Z' } } }]`,
  the minimum shape the widget reads, so the success branch of the
  widget runs (not just its `.catch`) without touching real network or
  hitting GitHub's unauthenticated rate limit. **Any other `api.github.com`
  URL, or the commits URL with unexpected params, is aborted** — that
  surfaces as `requestfailed` and trips the strict failure rules above.
  A stray or drifted external call cannot pass silently. Note this is
  explicit synthetic routing, not a broad `api.github.com` error
  allow-list.

That `app.js` makes an unauthenticated external API call on every page
load is a real product-behavior observation worth revisiting separately
— not fixed here.

## What each test checks

1. **Application loads and the primary nav renders.**
   Confirms `/` returns, the `<nav>` element and default `#home.sec.active`
   are visible, and `window.Store` finishes initializing.
2. **Primary navigation sections can be opened.**
   Clicks each `.nmb[data-group]` button (Home, Money, Goals, Career,
   Documents, About, Review, Sync) and asserts the corresponding primary
   section receives the `.active` class. Group→primary mapping mirrors
   `NAV_GROUPS` in `app.js`.
3. **Nav sweep produces no unexpected browser errors.**
   Walks every group with `pageerror` and `console.error` listeners
   attached; asserts the collected list is empty.
4. **App remains functional under light and dark OS color preferences.**
   Life OS has no `prefers-color-scheme` styling or theme system today.
   Visual output is identical between the two OS preferences. This test
   guards against a future regression where a theme system half-lands and
   one preference breaks the app: it re-runs the load + nav-sweep +
   zero-errors check under both `colorScheme: 'dark'` and
   `colorScheme: 'light'`.
5. **`prefers-reduced-motion: reduce` is respected for specific behaviors.**
   Under `reducedMotion: 'reduce'`, asserts:
   - `#home.sec` computed `animation-duration` collapses to ≤ 0.02s (i.e. the `secIn` animation is disabled).
   - `#today-goals-strip .tg-fill` computed `transition-duration` collapses to ≤ 0.02s.
   `.tg-fill` is rendered deterministically by `renderGoalsStrip()` on
   home. If the class disappears from that render path in the future, this
   test will fail loudly rather than silently skip. `.qs-bar-fill` in
   `styles.css` has no runtime consumer today (dead CSS) and is not
   asserted on.
6. **Synthetic Gen-2 persistence/rehydration round-trip.**
   Writes a synthetic `ideas` entry via `Store.set('ideas', ...)`, calls
   `Store.persistNow()`, confirms the write landed in the persisted
   `dune_state_v4` blob, reloads the page, waits for `Store` to rehydrate,
   and asserts the entry survived. Uses the `ideas` domain because it is
   fully Gen-2 write-authoritative per `STORAGE_MAP.md` with no
   cross-module coupling and no `validate()` dependency. The synthetic
   marker is generated in test-runner scope, not in `window`, so it
   survives reload conceptually.

## Rules

- Playwright locators and web-first assertions only. **No `waitForTimeout()`.**
- Never navigate to `mahmoud1115.github.io` from tests.
- Never seed real user data. Never assert against real user shapes.
- Money is off-limits for persistence tests until it has been folded from
  Gen-1 into Gen-2 (see ADR-006).
- If a test exposes an existing application problem, fix the underlying
  problem — do not silence the test or edit unrelated runtime code to
  make it pass.
