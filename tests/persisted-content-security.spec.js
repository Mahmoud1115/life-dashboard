// B1 — Secure persisted-content rendering. Verifies ADR-011 R1–R8 for
// the six confirmed P0 sinks: Tracker table, Builder entries list,
// Logbook CSV export, global Search, Apartments card grid, and Life
// Timeline. All tests use isolated synthetic Playwright contexts: no
// real user storage is touched. Font/GitHub requests are aborted so
// the harness cannot escape to the network.

const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;

test.beforeEach(async ({ context, page }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: '2026-08-25T00:00:00Z' } } }]),
    })
  );
});

async function seed(page, kv) {
  await page.addInitScript((pairs) => {
    // Install sentinel BEFORE any app script runs so injected event
    // handlers or <script> tags would have a chance to trip it.
    window.__B1_SENTINEL__ = 'clean';
    // Only seed keys that are not already present so reload() does not
    // clobber writes made by the test itself.
    Object.keys(pairs).forEach((k) => {
      if (localStorage.getItem(k) === null) {
        localStorage.setItem(k, JSON.stringify(pairs[k]));
      }
    });
  }, kv);
}

async function waitReady(page) {
  await page.waitForFunction(() =>
    typeof window.Store !== 'undefined' &&
    typeof window.LOGBOOK !== 'undefined' &&
    typeof window.LOGBOOK.reconcile === 'function'
  );
}

async function activate(page, sectionId) {
  await page.evaluate((id) => {
    if (typeof window.show === 'function') window.show(id);
  }, sectionId);
}

async function activateLogbookBuilder(page) {
  await activate(page, 'logbook');
  await page.evaluate(() => {
    if (typeof window.showLbTab === 'function') window.showLbTab('builder');
  });
}

const PAYLOADS = [
  '<img src=x onerror="window.__B1_SENTINEL__=\'executed\'">',
  '<script>window.__B1_SENTINEL__=\'executed\'<\/script>',
  '"><svg/onload="window.__B1_SENTINEL__=\'executed\'">',
  '\'"><img src=x onerror="window.__B1_SENTINEL__=\'executed\'">',
];

async function assertSentinelClean(page) {
  const v = await page.evaluate(() => window.__B1_SENTINEL__);
  expect(v).toBe('clean');
}

// ─── Tracker ──────────────────────────────────────────────────────────

function trackerRec(overrides = {}) {
  return Object.assign({
    id: 'lb_' + Math.floor(Math.random() * 1e9),
    date: '2026-08-25',
    company: 'АэроТраст',
    aircraft_type: 'A320-200',
    registration: 'VP-BQP',
    engine_type: 'CFM56-5B',
    ata_chapter: '72',
    system: 'Engine',
    task_description: 'Borescope inspection',
    hours: '2.5',
    role: 'assistant',
    supervisor: 'Ivan Petrov',
    stamp_status: 'pending',
    language: 'en',
    b1_relevance: 'B1.1',
  }, overrides);
}

test('B1 tracker — malicious fields render literally, no executable node, sentinel clean', async ({ page }) => {
  const t = PAYLOADS.map((p, i) => trackerRec({
    id: 'lb_' + (100 + i),
    company: p,
    aircraft_type: p,
    registration: p,
    ata_chapter: p,
    task_description: p,
    stamp_status: p,
  }));
  await seed(page, { dune_logbook_v1: t, dune_logbook_entries_v1: [] });
  await page.goto('/');
  await waitReady(page);
  await activate(page, 'logbook');
  await page.waitForSelector('#lb-tbody tr', { state: 'attached' });

  // No executable payload node inside the table body.
  const injected = await page.evaluate(() => {
    const tbody = document.getElementById('lb-tbody');
    return tbody ? tbody.querySelectorAll('img, script, svg').length : -1;
  });
  expect(injected).toBe(0);

  // Every visible cell renders the payload as literal text.
  const textHits = await page.evaluate(() => {
    const tbody = document.getElementById('lb-tbody');
    return Array.from(tbody.querySelectorAll('td')).some((td) => td.textContent.includes('<script>'));
  });
  expect(textHits).toBe(true);

  await assertSentinelClean(page);
});

test('B1 tracker — reverse-order delete removes the intended source record', async ({ page }) => {
  const t = [
    trackerRec({ id: 'lb_A', task_description: 'FIRST-<img src=x onerror=1>' }),
    trackerRec({ id: 'lb_B', task_description: 'SECOND' }),
    trackerRec({ id: 'lb_C', task_description: 'THIRD "quoted"' }),
  ];
  await seed(page, { dune_logbook_v1: t, dune_logbook_entries_v1: [] });
  await page.goto('/');
  await waitReady(page);
  await activate(page, 'logbook');
  page.on('dialog', (d) => d.accept());
  await page.waitForSelector('#lb-tbody .lb-row-del', { state: 'attached' });
  // Rows are rendered reversed. Clicking the source-index-1 delete
  // button must remove 'lb_B', not the visually-first row.
  await page.evaluate(() => document.querySelector('#lb-tbody .lb-row-del[data-idx="1"]').click());
  const remainingIds = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dune_logbook_v1')).map((r) => r.id));
  expect(remainingIds).toEqual(['lb_A', 'lb_C']);
  await assertSentinelClean(page);
});

// ─── Builder ──────────────────────────────────────────────────────────

function builderRec(overrides = {}) {
  return Object.assign({
    id: 'lbe_' + Math.floor(Math.random() * 1e9),
    date: '2026-08-25',
    aircraft: 'Airbus A320-200',
    reg: 'VP-BQP',
    ata: '72',
    ataLabel: '72 — Engine',
    hours: 2.5,
    supervisor: 'Ivan Petrov',
    ref: 'AMM 72-00-00-200',
    desc: 'Borescope inspection',
  }, overrides);
}

test('B1 builder — malicious fields render literally, no executable node, sentinel clean', async ({ page }) => {
  const b = PAYLOADS.map((p, i) => builderRec({
    id: 'lbe_' + (200 + i),
    aircraft: p, reg: p, desc: p, supervisor: p, ref: p,
  }));
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  await activateLogbookBuilder(page);
  await page.waitForSelector('#lbb-entries .lbb-entry', { state: 'attached' });
  const injected = await page.evaluate(() => {
    const c = document.getElementById('lbb-entries');
    return c ? c.querySelectorAll('img, script, svg').length : -1;
  });
  expect(injected).toBe(0);
  await assertSentinelClean(page);
});

test('B1 builder — opaque IDs preserved exactly on dataset and delivered to handler', async ({ page }) => {
  const oddIds = [
    'a"b', "a'b", 'a]b', 'a:b', 'a#b', 'a\\b',
    "');alert(1);//",
    '<script>x</script>',
  ];
  const b = oddIds.map((id, i) => builderRec({ id, desc: 'row-' + i }));
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  await activateLogbookBuilder(page);
  await page.waitForSelector('#lbb-entries .lbb-entry', { state: 'attached' });

  // dataset.id equals the raw id byte-for-byte.
  const datasetIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#lbb-entries .lbb-entry')).map((el) => el.dataset.id));
  expect(datasetIds).toEqual(oddIds);

  // Delegated dispatch delivers the raw id to the handler. Install a
  // spy on lbbCopyEntry that captures the argument.
  await page.evaluate(() => {
    window.__B1_COPIED__ = [];
    const orig = window.lbbCopyEntry;
    window.lbbCopyEntry = function(id) { window.__B1_COPIED__.push(id); if (orig) return orig.call(this, id); };
  });
  // Click Copy on the first three rows (JS-driven so visibility of the
  // hidden section doesn't block the dispatch).
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#lbb-entries .lbb-entry');
    [0,1,2].forEach((i) => rows[i].querySelector('button[data-lbb-action="copy"]').click());
  });
  const copied = await page.evaluate(() => window.__B1_COPIED__);
  expect(copied).toEqual([oddIds[0], oddIds[1], oddIds[2]]);
  await assertSentinelClean(page);
});

test('B1 builder — repeated render+search does not double-bind click delegate', async ({ page }) => {
  const b = [builderRec({ id: 'lbe_X', desc: 'searchable-term' })];
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  await activateLogbookBuilder(page);
  await page.waitForSelector('#lbb-entries .lbb-entry', { state: 'attached' });

  // Spy on lbbCopyEntry. Force many re-renders via search input.
  await page.evaluate(() => {
    window.__B1_COPY_CALLS__ = 0;
    const orig = window.lbbCopyEntry;
    window.lbbCopyEntry = function(id) { window.__B1_COPY_CALLS__++; if (orig) return orig.call(this, id); };
    for (let i = 0; i < 5; i++) {
      window.lbbSearch('');
      window.lbbSearch('searchable');
      window.lbbSearch('');
    }
  });
  await page.evaluate(() => document.querySelector('#lbb-entries .lbb-entry button[data-lbb-action="copy"]').click());
  const calls = await page.evaluate(() => window.__B1_COPY_CALLS__);
  expect(calls).toBe(1);
});

// ─── Save → reconcile → reload ────────────────────────────────────────

test('B1 builder — save malicious desc → reload → still literal and safe', async ({ page }) => {
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: [], dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  await activateLogbookBuilder(page);
  await page.waitForSelector('#lbb-date', { state: 'attached' });

  const payload = '<img src=x onerror="window.__B1_SENTINEL__=\'executed\'">';
  await page.evaluate((p) => {
    document.getElementById('lbb-aircraft').value = 'A320';
    document.getElementById('lbb-hours').value = '1';
    document.getElementById('lbb-desc').value = p;
    window.lbbSaveEntry();
  }, payload);
  await page.reload();
  await waitReady(page);
  // Force render (init may already have consumed the render guard).
  await page.evaluate(() => {
    if (typeof window.show === 'function') window.show('logbook');
    const r = document.getElementById('lb-builder-root');
    if (r) r.dataset.rendered = '0';
    if (typeof window.showLbTab === 'function') window.showLbTab('builder');
  });
  await page.waitForSelector('#lbb-entries .lbb-entry', { state: 'attached' });
  const injected = await page.evaluate(() =>
    document.querySelectorAll('#lbb-entries img, #lbb-entries script, #lbb-entries svg').length);
  expect(injected).toBe(0);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dune_logbook_entries_v1'))[0].desc);
  expect(stored).toBe(payload); // R6/R7: storage not rewritten
  await assertSentinelClean(page);
});

// ─── Import boundary ──────────────────────────────────────────────────

test('B1 import boundary — malformed and malicious entries do not throw and render safely', async ({ page }) => {
  const malformed = [
    null,
    {},
    { id: 'x1', desc: '<img src=x onerror="window.__B1_SENTINEL__=\'executed\'">' },
    { id: 42, desc: { nested: 'object' }, aircraft: ['a','b'] },
    { id: 'a"b\'c', desc: 'ok', hours: 'not-a-number' },
  ];
  await seed(page, {
    dune_logbook_v1: [],
    dune_logbook_entries_v1: malformed,
    dune_logbook_tab_v1: 'builder',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitReady(page);
  await activateLogbookBuilder(page);
  await page.waitForSelector('#lbb-entries', { state: 'attached' });
  // Malformed members are filtered (typeof !== 'object' or null are
  // skipped by lbbRenderEntries); the well-formed rows render safely.
  const rowCount = await page.locator('#lbb-entries .lbb-entry').count();
  expect(rowCount).toBeGreaterThanOrEqual(3);
  const injected = await page.evaluate(() =>
    document.querySelectorAll('#lbb-entries img, #lbb-entries script, #lbb-entries svg').length);
  expect(injected).toBe(0);
  expect(errors).toEqual([]);
  // R6/R7: storage byte-preserved (still the same object shape).
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('dune_logbook_entries_v1')));
  expect(stored.length).toBe(malformed.length);
  await assertSentinelClean(page);
});

// ─── CSV ──────────────────────────────────────────────────────────────

function parseCsv(text) {
  // Minimal, spec-compliant CSV parser sufficient for our exports:
  // handles CRLF terminators, "…" fields, doubled quotes, embedded
  // commas and newlines. No BOM stripping — caller does that.
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r' && text[i + 1] === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; }
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('B1 csv — formula prefix neutralized on every dangerous leading char (ASCII and full-width)', async ({ page }) => {
  const cases = [
    { first: '=', v: '=HYPERLINK("http://x")' },
    { first: '+', v: '+SUM(1,2)' },
    { first: '-', v: '-2+3' },
    { first: '@', v: '@SUM(A1)' },
    { first: '\t', v: '\tinjected' },
    { first: '\r', v: '\rinjected' },
    { first: '\n', v: '\ninjected' },
    { first: '＝', v: '＝FULLWIDTH' },
    { first: '＋', v: '＋FULLWIDTH' },
    { first: '－', v: '－FULLWIDTH' },
    { first: '＠', v: '＠FULLWIDTH' },
  ];
  const b = cases.map((c, i) => builderRec({ id: 'lbe_c'+i, desc: c.v, aircraft: 'A320' }));
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  const csvText = await page.evaluate(() => {
    const chunks = [];
    const OrigBlob = window.Blob;
    window.Blob = function(parts, opts) { chunks.push(parts.join('')); return new OrigBlob(parts, opts); };
    window.Blob.prototype = OrigBlob.prototype;
    window.lbbExportCSV();
    window.Blob = OrigBlob;
    return chunks[0];
  });
  // Strip BOM
  const body = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  expect(csvText.charCodeAt(0)).toBe(0xFEFF);
  expect(body.includes('\r\n')).toBe(true);
  const rows = parseCsv(body);
  const header = rows[0];
  const descCol = header.indexOf('Task Description');
  expect(descCol).toBeGreaterThanOrEqual(0);
  cases.forEach((c, i) => {
    const cell = rows[i + 1][descCol];
    // Every dangerous-leading cell must be prefixed with an apostrophe.
    expect(cell.charAt(0)).toBe("'");
    // And the original char must be preserved right after the apostrophe.
    expect(cell.charAt(1)).toBe(c.first);
  });
});

test('B1 csv — structural preservation of commas, quotes, newlines', async ({ page }) => {
  const b = [
    builderRec({ id: 'lbe_s1', aircraft: 'A320, Big', reg: 'has "quotes"', desc: 'line1\nline2', supervisor: 'a\r\nb' }),
  ];
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  const csvText = await page.evaluate(() => {
    const chunks = [];
    const OrigBlob = window.Blob;
    window.Blob = function(parts, opts) { chunks.push(parts.join('')); return new OrigBlob(parts, opts); };
    window.Blob.prototype = OrigBlob.prototype;
    window.lbbExportCSV();
    window.Blob = OrigBlob;
    return chunks[0];
  });
  const body = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const rows = parseCsv(body);
  const header = rows[0];
  const rec = rows[1];
  expect(rec[header.indexOf('Aircraft Type')]).toBe('A320, Big');
  expect(rec[header.indexOf('Registration')]).toBe('has "quotes"');
  expect(rec[header.indexOf('Task Description')]).toBe('line1\nline2');
});

test('B1 csv — number path only for finite JS numbers; numeric strings go through text/quoted path', async ({ page }) => {
  const b = [
    builderRec({ id: 'lbe_n1', hours: 2.5, desc: 'A' }),
    builderRec({ id: 'lbe_n2', hours: '12', desc: 'B' }),
    builderRec({ id: 'lbe_n3', hours: '1e3', desc: 'C' }),
  ];
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  const csvText = await page.evaluate(() => {
    const chunks = [];
    const OrigBlob = window.Blob;
    window.Blob = function(parts, opts) { chunks.push(parts.join('')); return new OrigBlob(parts, opts); };
    window.Blob.prototype = OrigBlob.prototype;
    window.lbbExportCSV();
    window.Blob = OrigBlob;
    return chunks[0];
  });
  const body = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  // Line 1 = header. Line 2 = record 1 (numeric).
  const secondLine = body.split('\r\n')[1];
  // Hours column value for row 1 is unquoted "2.5".
  expect(secondLine.includes(',2.5,')).toBe(true);
  const thirdLine = body.split('\r\n')[2];
  // Hours column value for row 2 is a quoted "12" (text path).
  expect(thirdLine.includes(',"12",')).toBe(true);
  const fourthLine = body.split('\r\n')[3];
  expect(fourthLine.includes(',"1e3",')).toBe(true);
});

test('B1 csv — strict date validation: valid ISO date unquoted; impossible dates fall through to text', async ({ page }) => {
  const b = [
    builderRec({ id: 'lbe_d1', date: '2026-08-25', desc: 'A' }),
    builderRec({ id: 'lbe_d2', date: '2026-02-31', desc: 'B' }),
    builderRec({ id: 'lbe_d3', date: '2026-13-10', desc: 'C' }),
    builderRec({ id: 'lbe_d4', date: 'not-a-date', desc: 'D' }),
  ];
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: b, dune_logbook_tab_v1: 'builder' });
  await page.goto('/');
  await waitReady(page);
  const csvText = await page.evaluate(() => {
    const chunks = [];
    const OrigBlob = window.Blob;
    window.Blob = function(parts, opts) { chunks.push(parts.join('')); return new OrigBlob(parts, opts); };
    window.Blob.prototype = OrigBlob.prototype;
    window.lbbExportCSV();
    window.Blob = OrigBlob;
    return chunks[0];
  });
  const body = csvText.charCodeAt(0) === 0xFEFF ? csvText.slice(1) : csvText;
  const lines = body.split('\r\n');
  expect(lines[1].startsWith('2026-08-25,')).toBe(true);   // valid date, unquoted
  expect(lines[2].startsWith('"2026-02-31",')).toBe(true); // impossible day
  expect(lines[3].startsWith('"2026-13-10",')).toBe(true); // impossible month
  expect(lines[4].startsWith('"not-a-date",')).toBe(true); // malformed
});

// ─── Search P0 ────────────────────────────────────────────────────────

test('B1 search — malicious query is echoed as literal text, no executable node, sentinel clean', async ({ page }) => {
  await seed(page, { dune_logbook_v1: [], dune_logbook_entries_v1: [] });
  await page.goto('/');
  await waitReady(page);
  const payload = '<img src=x onerror="window.__B1_SENTINEL__=\'executed\'">';
  const [injected, contains] = await page.evaluate((q) => {
    // Search DOM is not always present in the static HTML — inject the
    // minimum shell doSearch expects.
    let res = document.getElementById('search-results');
    if (!res) {
      res = document.createElement('div');
      res.id = 'search-results';
      document.body.appendChild(res);
    }
    window.doSearch({ target: { value: q } });
    return [
      res.querySelectorAll('img, script, svg').length,
      res.textContent.includes(q),
    ];
  }, payload);
  expect(injected).toBe(0);
  expect(contains).toBe(true);
  await assertSentinelClean(page);
});

// ─── Apartments P0 ────────────────────────────────────────────────────

test('B1 apartments — malicious fields render literally, no executable node, correct delete target', async ({ page }) => {
  // rents chosen so the default sort (rent_asc) keeps apt_A first and
  // the hostile-id row second, matching the assertion below.
  const apts = [
    { id: 'apt_A', address: '<img src=x onerror="window.__B1_SENTINEL__=\'executed\'">', area: 'khimki', rent: 22000, rooms: '1', commute_min: 40, registration: 'yes', status: 'viewing', winner: false, notes: '"><svg/onload="window.__B1_SENTINEL__=\'executed\'">', added: '2026-01-01' },
    { id: 'a"b\'; alert(1);//', address: 'Тестовая 1', area: 'lobnya', rent: 27000, rooms: '1', commute_min: 55, registration: 'no', status: 'applied', winner: false, notes: '', added: '2026-01-02' },
  ];
  await seed(page, { dune_apartments_v1: apts });
  await page.goto('/');
  await waitReady(page);
  await activate(page, 'passport');
  // Force render (apartments-root can render on nav).
  await page.evaluate(() => window.renderApartments && window.renderApartments());
  await page.waitForSelector('#apartments-root .apt-card', { state: 'attached' });
  const injected = await page.evaluate(() =>
    document.querySelectorAll('#apartments-root img, #apartments-root script, #apartments-root svg').length);
  expect(injected).toBe(0);

  // dataset.aptId preserves the raw id exactly.
  const cards = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#apartments-root .apt-card')).map((c) => c.dataset.aptId));
  expect(cards).toEqual(['apt_A', 'a"b\'; alert(1);//']);

  // Delete the second card via delegated dispatch; verify the correct
  // record is removed from storage.
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() =>
    document.querySelectorAll('#apartments-root .apt-card')[1]
      .querySelector('button[data-apt-action="delete"]').click());
  const remaining = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('dune_apartments_v1')).map((a) => a.id));
  expect(remaining).toEqual(['apt_A']);
  await assertSentinelClean(page);
});

// ─── Timeline P0 ──────────────────────────────────────────────────────

test('B1 timeline — hostile kind falls back to allowlisted class; hostile id preserved on dataset only', async ({ page }) => {
  await seed(page, {});
  await page.goto('/');
  await waitReady(page);
  await activate(page, 'timeline');
  await page.evaluate(() => {
    const items = [
      { id: 'tl_ok',    at: '2026-08-25', kind: 'past',    text: 'ok' },
      { id: 'tl"1',     at: '2026-08-25', kind: 'future" onmouseover="window.__B1_SENTINEL__=\'executed\'" x="', text: 'hostile-kind' },
      { id: "');alert(1);//", at: '2026-08-25', kind: 'current', text: '<img src=x onerror=1>' },
    ];
    window.Store.set('timeline', items);
  });
  await page.waitForSelector('#timeline-list .tl-row', { state: 'attached' });
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#timeline-list .tl-row')).map((r) => ({
      cls: r.className,
      id: r.dataset.tlId,
    })));
  // Hostile kind falls back to 'past'.
  expect(rows[1].cls).toContain('tl-past');
  expect(rows[1].cls).not.toMatch(/onmouseover|onerror/);
  // Hostile ids preserved exactly on dataset (safe, opaque).
  expect(rows[1].id).toBe('tl"1');
  expect(rows[2].id).toBe("');alert(1);//");
  const injected = await page.evaluate(() =>
    document.querySelectorAll('#timeline-list img, #timeline-list script, #timeline-list svg').length);
  expect(injected).toBe(0);
  await assertSentinelClean(page);

  // Delegated delete on hostile-id row dispatches raw id to deleteTimeline.
  await page.evaluate(() => {
    window.__B1_TL_DEL__ = [];
    const orig = window.deleteTimeline;
    window.deleteTimeline = function(id) { window.__B1_TL_DEL__.push(id); if (orig) return orig.call(this, id); };
  });
  page.on('dialog', (d) => d.accept());
  await page.evaluate(() =>
    document.querySelectorAll('#timeline-list .tl-row')[1]
      .querySelector('button[data-tl-action="delete"]').click());
  const captured = await page.evaluate(() => window.__B1_TL_DEL__);
  expect(captured).toEqual(['tl"1']);
});
