// BHT AI-secret cleanup regression. See ADR-005 and docs/lifeos/SESSION_HANDOFF.md.
// Verifies:
//   - direct-browser cloud AI providers cannot be persisted
//   - migrateSlice() strips legacy apiKey and downgrades legacy cloud providers
//   - the sanitizer is idempotent (no second-pass mutation, no repeat log)
//   - the Coach settings UI no longer exposes API-key input or anthropic/openrouter options
// Uses synthetic in-memory state only. Never touches real user localStorage payloads.

const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;

test.beforeEach(async ({ context, page }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: '2026-08-24T00:00:00Z' } } }]),
    })
  );
});

async function waitForBHT(page) {
  await page.waitForFunction(() =>
    !!(window.BHT && typeof window.BHT.migrateSlice === 'function' &&
       typeof window.BHT.setAIConfig === 'function' && window.Store)
  );
}

test('migrateSlice downgrades anthropic and strips apiKey', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const slice = window.BHT.migrateSlice({
      habits: [], entries: [], snapshots: [], lifeEvents: [],
      vocab: { triggers: [], coping: [], moods: [] },
      ai: { provider: 'anthropic', model: 'claude-x', apiKey: 'synthetic-test-secret', ollamaUrl: 'http://localhost:11434' },
      meta: {}
    });
    return {
      provider: slice.ai.provider,
      hasApiKey: Object.prototype.hasOwnProperty.call(slice.ai, 'apiKey'),
      model: slice.ai.model,
      ollamaUrl: slice.ai.ollamaUrl,
    };
  });
  expect(result.provider).toBe('fallback');
  expect(result.hasApiKey).toBe(false);
  expect(result.model).toBe('claude-x');
  expect(result.ollamaUrl).toBe('http://localhost:11434');
});

test('migrateSlice downgrades openrouter and strips apiKey', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const slice = window.BHT.migrateSlice({
      habits: [], entries: [], snapshots: [], lifeEvents: [],
      vocab: { triggers: [], coping: [], moods: [] },
      ai: { provider: 'openrouter', apiKey: 'synthetic-test-secret' },
      meta: {}
    });
    return {
      provider: slice.ai.provider,
      hasApiKey: Object.prototype.hasOwnProperty.call(slice.ai, 'apiKey'),
    };
  });
  expect(result.provider).toBe('fallback');
  expect(result.hasApiKey).toBe(false);
});

test('migrateSlice preserves ollama config untouched', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const slice = window.BHT.migrateSlice({
      habits: [], entries: [], snapshots: [], lifeEvents: [],
      vocab: { triggers: [], coping: [], moods: [] },
      ai: { provider: 'ollama', model: 'llama3.1:8b', ollamaUrl: 'http://localhost:11434' },
      meta: {}
    });
    return {
      provider: slice.ai.provider,
      model: slice.ai.model,
      ollamaUrl: slice.ai.ollamaUrl,
      hasApiKey: Object.prototype.hasOwnProperty.call(slice.ai, 'apiKey'),
    };
  });
  expect(result.provider).toBe('ollama');
  expect(result.model).toBe('llama3.1:8b');
  expect(result.ollamaUrl).toBe('http://localhost:11434');
  expect(result.hasApiKey).toBe(false);
});

test('sanitizer is idempotent and does not re-log on second pass', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const infoCalls = [];
    const orig = console.info;
    console.info = (...args) => { infoCalls.push(args.join(' ')); };
    try {
      const seed = {
        habits: [], entries: [], snapshots: [], lifeEvents: [],
        vocab: { triggers: [], coping: [], moods: [] },
        ai: { provider: 'anthropic', apiKey: 'synthetic-test-secret' },
        meta: {}
      };
      const first = window.BHT.migrateSlice(seed);
      const firstLogs = infoCalls.filter(l => l.includes('[BHT]')).length;
      const snapshot = JSON.stringify(first);
      const second = window.BHT.migrateSlice(JSON.parse(snapshot));
      const secondLogs = infoCalls.filter(l => l.includes('[BHT]')).length;
      // Ignore volatile meta.lastUpdated when comparing state.
      const strip = (o) => { const c = JSON.parse(JSON.stringify(o)); if (c.meta) delete c.meta.lastUpdated; return c; };
      return {
        firstLogs, secondLogs,
        stateEqual: JSON.stringify(strip(first)) === JSON.stringify(strip(second)),
        provider: second.ai.provider,
        hasApiKey: Object.prototype.hasOwnProperty.call(second.ai, 'apiKey'),
      };
    } finally {
      console.info = orig;
    }
  });
  expect(result.firstLogs).toBe(1);
  expect(result.secondLogs).toBe(1);
  expect(result.stateEqual).toBe(true);
  expect(result.provider).toBe('fallback');
  expect(result.hasApiKey).toBe(false);
});

test('setAIConfig refuses cloud providers and drops apiKey', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    window.BHT.setAIConfig({ provider: 'fallback', model: '' });
    window.BHT.setAIConfig({ provider: 'anthropic', apiKey: 'synthetic-test-secret' });
    const afterCloud = JSON.parse(JSON.stringify(window.Store.get('bht.ai') || {}));
    window.BHT.setAIConfig({ provider: 'ollama', apiKey: 'synthetic-test-secret', model: 'llama3.1:8b' });
    const afterOllama = JSON.parse(JSON.stringify(window.Store.get('bht.ai') || {}));
    return { afterCloud, afterOllama };
  });
  expect(result.afterCloud.provider).toBe('fallback');
  expect(Object.prototype.hasOwnProperty.call(result.afterCloud, 'apiKey')).toBe(false);
  expect(result.afterOllama.provider).toBe('ollama');
  expect(result.afterOllama.model).toBe('llama3.1:8b');
  expect(Object.prototype.hasOwnProperty.call(result.afterOllama, 'apiKey')).toBe(false);
});

test('migrateSlice normalizes malformed ai (string/null/array/number)', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const cases = ['bad', null, [], 123, undefined, {}];
    return cases.map((bad, i) => {
      const seed = {
        habits: [], entries: [], snapshots: [], lifeEvents: [],
        vocab: { triggers: [], coping: [], moods: [] },
        ai: bad,
        meta: {}
      };
      // Drop the key entirely for the `undefined` case so it exercises the
      // "missing property" path rather than an explicit `undefined` value.
      if (i === 4) delete seed.ai;
      const out = window.BHT.migrateSlice(seed);
      return {
        provider: out.ai && out.ai.provider,
        isObject: !!out.ai && typeof out.ai === 'object' && !Array.isArray(out.ai),
        hasApiKey: out.ai ? Object.prototype.hasOwnProperty.call(out.ai, 'apiKey') : false,
      };
    });
  });
  for (const r of result) {
    expect(r.isObject).toBe(true);
    expect(r.provider).toBe('fallback');
    expect(r.hasApiKey).toBe(false);
  }
});

test('migrateSlice downgrades unsupported provider to fallback', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const out = window.BHT.migrateSlice({
      habits: [], entries: [], snapshots: [], lifeEvents: [],
      vocab: { triggers: [], coping: [], moods: [] },
      ai: { provider: 'made-up-provider', ollamaUrl: 'http://localhost:11434' },
      meta: {}
    });
    return { provider: out.ai.provider, ollamaUrl: out.ai.ollamaUrl };
  });
  expect(result.provider).toBe('fallback');
  // Unrelated valid fields survive.
  expect(result.ollamaUrl).toBe('http://localhost:11434');
});

test('sanitizer is idempotent on normalized malformed input', async ({ page }) => {
  await page.goto('/');
  await waitForBHT(page);
  const result = await page.evaluate(() => {
    const infoCalls = [];
    const orig = console.info;
    console.info = (...args) => { infoCalls.push(args.join(' ')); };
    try {
      const seed = {
        habits: [], entries: [], snapshots: [], lifeEvents: [],
        vocab: { triggers: [], coping: [], moods: [] },
        ai: 'bad', meta: {}
      };
      const first = window.BHT.migrateSlice(seed);
      const firstLogs = infoCalls.filter(l => l.includes('[BHT]')).length;
      const snapshot = JSON.parse(JSON.stringify(first));
      window.BHT.migrateSlice(snapshot);
      const secondLogs = infoCalls.filter(l => l.includes('[BHT]')).length;
      return { firstLogs, secondLogs, provider: first.ai.provider };
    } finally {
      console.info = orig;
    }
  });
  expect(result.provider).toBe('fallback');
  expect(result.firstLogs).toBe(1);
  expect(result.secondLogs).toBe(1);
});

test('Coach source has no direct-browser cloud AI path', async ({ page }) => {
  // Source-level assertion: fetch the served bht-coach.js and verify the
  // cloud provider paths, API-key input, and browser-side call signatures
  // are gone. Rendering the Coach card in-app requires seeded synthetic
  // BHT state which risks coupling this security regression to unrelated
  // Coach render logic; asserting on the served source keeps the check
  // narrow and stable.
  await page.goto('/');
  const src = await page.evaluate(async () => {
    const r = await fetch('/bht-coach.js');
    return r.text();
  });
  expect(src).not.toMatch(/data-cfg="apiKey"/);
  expect(src).not.toMatch(/callAnthropic|callOpenRouter/);
  expect(src).not.toMatch(/api\.anthropic\.com/);
  expect(src).not.toMatch(/openrouter\.ai/);
  expect(src).not.toMatch(/x-api-key/);
  expect(src).not.toMatch(/anthropic-dangerous-direct-browser-access/);
  expect(src).not.toMatch(/value="anthropic"/);
  expect(src).not.toMatch(/value="openrouter"/);
});
