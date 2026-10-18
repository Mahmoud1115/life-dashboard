const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'Europe/Moscow' });

const HTML_PAYLOAD = '<img src=x onerror=window.__xss=1>';
const ATTR_PAYLOAD = '\"><script>window.__xss=1<\/script>';
const ICS_PAYLOAD = 'Calendar title\r\nBEGIN:VALARM\r\nACTION:DISPLAY';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-18T12:00:00+03:00'));
});

async function seedPersistedPayloads(page) {
  await page.addInitScript(({ htmlPayload, attrPayload, icsPayload }) => {
    window.__xss = undefined;
    localStorage.setItem('dune_github_token_v1', JSON.stringify('synthetic-test-token'));
    localStorage.setItem('dune_easa_v1', JSON.stringify({
      ea01: { status: attrPayload, progress: htmlPayload },
    }));
    localStorage.setItem('dune_gist_id_v1', JSON.stringify(attrPayload));
  }, { htmlPayload: HTML_PAYLOAD, attrPayload: ATTR_PAYLOAD, icsPayload: ICS_PAYLOAD });

  await page.goto('/');
  await page.waitForFunction(() => window.Store && typeof window.Store.defaultState === 'function');
  await page.evaluate(({ htmlPayload, attrPayload, icsPayload }) => {
    const data = window.Store.defaultState();
    data.records.goals = [{
      id: attrPayload, title: htmlPayload, progress: 25, status: attrPayload,
      cat: attrPayload, deadline: attrPayload, nextAction: htmlPayload, note: attrPayload,
    }];
    data.records.deadlines = [{
      id: attrPayload, date: '2026-10-20', title: icsPayload,
      cat: attrPayload, importance: 'high', consequence: htmlPayload, note: attrPayload,
    }];
    data.records.claims = [{
      id: attrPayload, confidence: attrPayload, title: htmlPayload, text: attrPayload,
      cat: htmlPayload, sourceType: attrPayload, lastChecked: htmlPayload,
      recheckDate: attrPayload, consequence: htmlPayload, nextAction: attrPayload,
    }];
    data.records.risks = [{
      title: htmlPayload, score: 12, prob: attrPayload, impact: htmlPayload,
      cat: attrPayload, mitigation: htmlPayload, nextReview: attrPayload,
    }];
    data.career.licenses = [{ id: 'license-xss', name: htmlPayload, target: null, status: attrPayload }];
    data.career.milestones = [{ at: '2026-10-21', text: htmlPayload }];
    data.about.version = htmlPayload;
    data.about.createdAt = attrPayload;
    data.about.lastUpdated = htmlPayload;
    const wrapper = {
      version: window.Store.SCHEMA_VERSION,
      revision: 1,
      committedAt: '2026-10-18T00:00:00.000Z',
      data,
    };
    localStorage.setItem('dune_state_v4', JSON.stringify(wrapper));
  }, { htmlPayload: HTML_PAYLOAD, attrPayload: ATTR_PAYLOAD, icsPayload: ICS_PAYLOAD });
  await page.reload();
  await page.waitForFunction(() => window.Store && typeof window.show === 'function');
}

async function assertLiteralAndSafe(page, section, selector, text) {
  await page.evaluate((id) => window.show(id), section);
  await expect(page.locator(selector)).toContainText(text);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator(`${selector} img, ${selector} script`).count()).toBe(0);
}

test('stored payloads render literally across records, EASA, career, About, and calendar surfaces', async ({ page }) => {
  await seedPersistedPayloads(page);

  await assertLiteralAndSafe(page, 'progress', '#goals-list', HTML_PAYLOAD);
  await assertLiteralAndSafe(page, 'deadlines', '#deadlines-list', ICS_PAYLOAD);
  await assertLiteralAndSafe(page, 'claims', '#claims-list', HTML_PAYLOAD);
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'risk-mon-list';
    document.body.appendChild(host);
    window.renderRiskMonitor();
  });
  await expect(page.locator('#risk-mon-list')).toContainText(HTML_PAYLOAD);
  expect(await page.locator('#risk-mon-list img, #risk-mon-list script').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  await assertLiteralAndSafe(page, 'easa', '#easa-grid', ATTR_PAYLOAD);
  await assertLiteralAndSafe(page, 'career-tracker', '#c-licenses-list', HTML_PAYLOAD);
  await assertLiteralAndSafe(page, 'aboutyou', '.about-meta-strip', HTML_PAYLOAD);
  await assertLiteralAndSafe(page, 'home', '#home-upcoming-list', HTML_PAYLOAD);

  await page.evaluate(() => window.updateGistUI());
  await expect(page.locator('#gist-token-section')).toContainText(ATTR_PAYLOAD.slice(0, 12));
  expect(await page.locator('#gist-token-section script').count()).toBe(0);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('ICS escaping prevents injected properties and VALARM blocks', async ({ page }) => {
  await seedPersistedPayloads(page);
  const ics = await page.evaluate(async () => {
    let captured;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob) => { captured = blob; return 'blob:test'; };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = () => {};
    try {
      window.downloadAllICS();
      return await captured.text();
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
  expect(ics).toContain('SUMMARY:Calendar title\\nBEGIN:VALARM\\nACTION:DISPLAY');
  expect(ics.split('\r\n').filter((line) => line === 'BEGIN:VALARM')).toHaveLength(1);
});

test('CSP meta restricts connections to self and GitHub API', async ({ page }) => {
  await page.goto('/');
  const content = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(content).toBeTruthy();
  const connect = content.split(';').map((part) => part.trim()).find((part) => part.startsWith('connect-src '));
  expect(connect).toBe("connect-src 'self' https://api.github.com http://localhost:11434 http://127.0.0.1:11434");
});
