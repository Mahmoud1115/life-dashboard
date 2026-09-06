// Logbook Phase A canonicalisation regression. See ADR / STORAGE_MAP /
// ARCHITECTURE Logbook Phase A. Legacy Tracker + Builder remain
// authoritative; state.logbook is a reconciled mirror only. Uses only
// synthetic in-page storage seeded via addInitScript.

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

// A quick readiness check that returns as soon as Store + LOGBOOK
// are available, WITHOUT waiting for the boot atomic legacy
// conversion to clear its blocker. Used by tests whose seeds are
// designed to reject at the strict-matrix source validation (so the
// blocker never clears).
async function waitAppSurfaces(page) {
  await page.waitForFunction(() =>
    typeof window.Store !== 'undefined' &&
    typeof window.LOGBOOK !== 'undefined' &&
    typeof window.LOGBOOK.reconcile === 'function',
    { timeout: 5000 }
  );
}

async function waitReady(page) {
  await page.waitForFunction(() =>
    typeof window.Store !== 'undefined' &&
    typeof window.LOGBOOK !== 'undefined' &&
    typeof window.LOGBOOK.reconcile === 'function'
  );
  // PRV-0.5 Pre-Push R2 / BINDING-3-A: the boot init()'s
  // LOGBOOK.reconcile() may fire while the boot atomic legacy
  // conversion still holds STORE_LEGACY_CONVERSION_PENDING; its
  // Store.set is then refused and the reconciled envelope is not
  // applied. Wait for the durability blocker to clear (the atomic
  // legacy conversion has committed the migrated wrapper and cleared
  // the blocker on success) then re-run reconcile deterministically.
  // On seeds with no legacy blocker (no dune_state_v4 at all) the
  // wait completes immediately.
  const blockerCleared = await page.waitForFunction(() => {
    if (!window.Store || typeof window.Store.getDurabilityBlocker !== 'function') return true;
    return window.Store.getDurabilityBlocker() === null;
  }, { timeout: 2500 }).then(() => true).catch(() => false);
  if (blockerCleared) {
    // Blocker cleared → atomic legacy conversion completed → re-run
    // reconcile so the reconciled envelope is applied deterministically
    // (the init-time reconcile may have fired while the blocker was
    // still set and been refused).
    try {
      await page.evaluate(() => {
        try { window.LOGBOOK && window.LOGBOOK.reconcile && window.LOGBOOK.reconcile(); }
        catch (e) { /* best-effort */ }
      });
    } catch (e) { /* page might have closed for reload flows */ }
  }
  // If the blocker did not clear (e.g. malformed-source atomic conversion
  // refused), the test that follows exercises that scenario directly and
  // does not need the deterministic re-reconcile step.
}

// PRV-0.5 Pre-Push R2 / BINDING-3-A: legacy dune_state_v4 wrappers
// (v8..v13) must carry the evidence-backed full defaultState-shape
// emitted at their bump commit. Fill any missing domain with the
// v9-shape default so a boot-time atomic legacy conversion (which
// runs validateLegacySourceRequiredFields under the exclusive
// lock) accepts the seed as a legitimate historical source. Any
// domain explicitly provided by the caller wins.
function _fillLegacyStateDomains(state) {
  if (!state || typeof state !== 'object' || !state.data || typeof state.data !== 'object') return state;
  // PRV-0.5 Codex-final P1-03: full emission audit added `meta` and
  // `money.expenses` to every v8..v13 required set. Keep the fill
  // helper aligned with the strict matrix so seeds pass validation
  // whether the caller opts into v11 (logbook array) or v12+
  // (logbook envelope) shape.
  const isEnvelopeVersion = state.version && state.version >= 12;
  const defaultLogbook = isEnvelopeVersion
    ? { schemaVersion: 1, authority: 'legacy-mirror', entries: [],
        migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } },
        reconciled: false, drift: null }
    : [];
  const defaults = {
    money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
    qatarVisit: {},
    career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
    bht: { habits: [], entries: [] },
    telemetry: {},
    todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
    logbook: defaultLogbook,
    meta: { version: state.version, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' }
  };
  const filled = Object.assign({}, defaults, state.data);
  // If caller passed money without expenses, merge in the default
  // expenses object rather than overriding money wholesale.
  if (filled.money && typeof filled.money === 'object' && !Array.isArray(filled.money) && !filled.money.expenses) {
    filled.money = Object.assign({}, defaults.money, filled.money);
  }
  return Object.assign({}, state, { data: filled });
}

async function seed(page, { tracker = null, builder = null, state = null } = {}) {
  const filled = state ? _fillLegacyStateDomains(state) : null;
  await page.addInitScript(([t, b, s]) => {
    if (t !== undefined) localStorage.setItem('dune_logbook_v1', JSON.stringify(t));
    if (b !== undefined) localStorage.setItem('dune_logbook_entries_v1', JSON.stringify(b));
    if (s) localStorage.setItem('dune_state_v4', JSON.stringify(s));
  }, [tracker, builder, filled]);
}

function trackerRec(overrides = {}) {
  return Object.assign({
    id: 'lb_' + (1_700_000_000_000 + Math.floor(Math.random() * 1000)),
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
function builderRec(overrides = {}) {
  return Object.assign({
    id: 'lbe_' + (1_700_000_000_000 + Math.floor(Math.random() * 1000)),
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

test('L1 — Tracker-only reconciliation contains all Tracker records', async ({ page }) => {
  const t = [trackerRec({ id: 'lb_1000' }), trackerRec({ id: 'lb_2000', hours: '3' })];
  await seed(page, { tracker: t, builder: [] });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.authority).toBe('legacy-mirror');
  expect(env.entries.length).toBe(2);
  expect(env.entries.every(e => e.source === 'tracker')).toBe(true);
  expect(env.migration.sourceCounts).toEqual({ tracker: 2, builder: 0 });
});

test('L2 — Builder-only reconciliation contains all Builder records', async ({ page }) => {
  const b = [builderRec({ id: 'lbe_1' }), builderRec({ id: 'lbe_2', hours: 4 })];
  await seed(page, { tracker: [], builder: b });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(2);
  expect(env.entries.every(e => e.source === 'builder')).toBe(true);
  expect(env.migration.sourceCounts).toEqual({ tracker: 0, builder: 2 });
});

test('L3 — Disjoint union: canonical count = tracker + builder', async ({ page }) => {
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_a', task_description: 'T1' }), trackerRec({ id: 'lb_b', task_description: 'T2' })],
    builder: [builderRec({ id: 'lbe_x', desc: 'B1' }), builderRec({ id: 'lbe_y', desc: 'B2' }), builderRec({ id: 'lbe_z', desc: 'B3' })],
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(5);
  expect(env.entries.filter(e => e.source === 'tracker').length).toBe(2);
  expect(env.entries.filter(e => e.source === 'builder').length).toBe(3);
});

test('L4 — identical cross-source records remain as two canonical entries', async ({ page }) => {
  // Same fingerprint content in Tracker and Builder shape.
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_dup', date: '2026-08-25', aircraft_type: 'A320-200', registration: 'VP-BQP', ata_chapter: '72', task_description: 'Same task', hours: '2.5' })],
    builder: [builderRec({ id: 'lbe_dup', date: '2026-08-25', aircraft: 'A320-200', reg: 'VP-BQP', ata: '72', desc: 'Same task', hours: 2.5 })],
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(2);
  const sources = env.entries.map(e => e.source).sort();
  expect(sources).toEqual(['builder', 'tracker']);
  // Diagnostic possibleDuplicateKey matches across sources.
  const keys = env.entries.map(e => e.possibleDuplicateKey);
  expect(keys[0]).toBe(keys[1]);
});

test('L5 — conflicting cross-source records remain separate', async ({ page }) => {
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_c', task_description: 'A', hours: '2.5' })],
    builder: [builderRec({ id: 'lbe_c', desc: 'A', hours: 3.5 })],
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(2);
});

test('L6 — missing and duplicate legacy IDs produce distinct deterministic canonical IDs', async ({ page }) => {
  await seed(page, {
    tracker: [
      trackerRec({ id: 'lb_shared' }),
      trackerRec({ id: 'lb_shared' }),    // duplicate legacy ID within source
      trackerRec({ id: undefined }),       // missing ID
      trackerRec({ id: '' }),              // empty ID
    ],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  const ids = env.entries.map(e => e.id);
  expect(new Set(ids).size).toBe(ids.length);
  // Pre-count rule: since lb_shared appears twice, NEITHER member gets the
  // unsuffixed form; both take the content-hashed dup form so reorder
  // cannot swap identities.
  expect(ids[0]).toMatch(/^lb2:tracker:dup:lb_shared:[0-9a-f]+:\d+$/);
  expect(ids[1]).toMatch(/^lb2:tracker:dup:lb_shared:[0-9a-f]+:\d+$/);
  // Missing legacy ID: <source>:fallback:<contentHash>:<occurrence>
  expect(ids[2]).toMatch(/^lb2:tracker:fallback:[0-9a-f]+:\d+$/);
  expect(ids[3]).toMatch(/^lb2:tracker:fallback:[0-9a-f]+:\d+$/);
});

test('L7 — canonical IDs are stable across reloads', async ({ page }) => {
  const t = [trackerRec({ id: 'lb_s1' }), trackerRec({ id: 'lb_s2' })];
  const b = [builderRec({ id: 'lbe_s1' })];
  await seed(page, { tracker: t, builder: b });
  await page.goto('/');
  await waitReady(page);
  const first = await page.evaluate(() => window.Store.get('logbook').entries.map(e => e.id));
  await page.reload();
  await waitReady(page);
  const second = await page.evaluate(() => window.Store.get('logbook').entries.map(e => e.id));
  expect(second).toEqual(first);
});

test('L8 — hours normalisation: valid strings, invalid strings, zero, and preservation', async ({ page }) => {
  await seed(page, {
    tracker: [
      trackerRec({ id: 'lb_h1', hours: '2.5' }),
      trackerRec({ id: 'lb_h2', hours: '2.5h' }),
      trackerRec({ id: 'lb_h3', hours: 0 }),
      trackerRec({ id: 'lb_h4', hours: 'abc' }),
      trackerRec({ id: 'lb_h5', hours: '' }),
    ],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  const byId = Object.fromEntries(env.entries.map(e => [e.legacyId, e]));
  expect(byId.lb_h1.hours).toBe(2.5);
  expect(byId.lb_h2.hours).toBeNull();
  expect(byId.lb_h2.legacyExtra.hours).toBe('2.5h');
  expect(byId.lb_h3.hours).toBe(0);
  expect(byId.lb_h4.hours).toBeNull();
  expect(byId.lb_h4.legacyExtra.hours).toBe('abc');
  expect(byId.lb_h5.hours).toBeNull();
});

test('L9 — empty Tracker key is authoritative: no resurrection from old envelope', async ({ page }) => {
  // Seed dune_state_v4 with a valid envelope containing tracker records;
  // seed dune_logbook_v1 as an explicit empty array. Tracker authoritative
  // says the envelope's tracker records should NOT be resurrected.
  await seed(page, {
    tracker: [],
    builder: [],
    state: {
      version: 12,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: {
          schemaVersion: 1,
          authority: 'legacy-mirror',
          entries: [
            { id: 'lb2:tracker:lb_old', source: 'tracker', legacyId: 'lb_old', sourceIndex: 0,
              inferredCreatedAt: null, date: '2020-01-01', aircraft: 'X', registration: null,
              ata: null, ataLabel: null, description: 'stale', hours: null, supervisor: null,
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} }
          ],
          migration: { version: 1, sourceCounts: { tracker: 1, builder: 0 } },
          drift: null
        }
      }
    },
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(0);
});

test('L10 — Tracker key absent: recover tracker-tagged records from envelope', async ({ page }) => {
  // PRV-0.5 Pre-Push R2 / BINDING-3-A: state passed through
  // _fillLegacyStateDomains so the strict matrix accepts it at
  // boot-time atomic legacy conversion.
  const _state = _fillLegacyStateDomains({
    version: 12,
    data: {
      money: { salary_net: 130000 },
      qatarVisit: {},
      logbook: {
        schemaVersion: 1,
        authority: 'legacy-mirror',
        entries: [
          { id: 'lb2:tracker:lb_recovered', source: 'tracker', legacyId: 'lb_recovered', sourceIndex: 0,
            inferredCreatedAt: null, date: '2026-01-01', aircraft: 'A320', registration: null,
            ata: '72', ataLabel: null, description: 'from state', hours: 1.5, supervisor: null,
            company: null, engineType: null, system: null, role: null, stampStatus: null,
            language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} }
        ],
        migration: { version: 1, sourceCounts: { tracker: 1, builder: 0 } },
        drift: null
      }
    }
  });
  await page.addInitScript((s) => {
    // Tracker key deliberately not set → truly absent.
    localStorage.removeItem('dune_logbook_v1');
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify([]));
    localStorage.setItem('dune_state_v4', JSON.stringify(s));
  }, _state);
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].source).toBe('tracker');
  expect(env.entries[0].legacyId).toBe('lb_recovered');
});

test('L11 — empty Builder key is authoritative: no builder resurrection', async ({ page }) => {
  await seed(page, {
    tracker: [],
    builder: [],
    state: {
      version: 12,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: {
          schemaVersion: 1,
          authority: 'legacy-mirror',
          entries: [
            { id: 'lb2:builder:lbe_old', source: 'builder', legacyId: 'lbe_old', sourceIndex: 0,
              inferredCreatedAt: null, date: '2020-01-01', aircraft: 'X', registration: null,
              ata: null, ataLabel: null, description: 'stale', hours: null, supervisor: null,
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} }
          ],
          migration: { version: 1, sourceCounts: { tracker: 0, builder: 1 } },
          drift: null
        }
      }
    }
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(0);
});

test('L12 — Tracker add via submitLogEntry mirrors into canonical', async ({ page }) => {
  await seed(page, { tracker: [], builder: [] });
  await page.goto('/');
  await waitReady(page);
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    arr.push({
      id: 'lb_new1', date: '2026-08-25', company: 'X', aircraft_type: 'A320',
      registration: 'A', engine_type: 'CFM', ata_chapter: '72', system: 'Engine',
      task_description: 'Added', hours: '3', role: 'assistant', supervisor: 'S',
      stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1',
    });
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].legacyId).toBe('lb_new1');
});

test('L13 — Tracker delete via deleteLogEntry removes from canonical', async ({ page }) => {
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_del1' }), trackerRec({ id: 'lb_del2' })],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    arr.splice(0, 1);
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].legacyId).toBe('lb_del2');
});

test('L14 — Builder add via lbbSaveEntry mirrors into canonical', async ({ page }) => {
  await seed(page, { tracker: [], builder: [] });
  await page.goto('/');
  await waitReady(page);
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_entries_v1') || '[]');
    arr.unshift({ id: 'lbe_new1', date: '2026-08-25', aircraft: 'A320', reg: 'A',
      ata: '72', ataLabel: '72 — Engine', hours: 2, supervisor: 'S', ref: '', desc: 'built' });
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].legacyId).toBe('lbe_new1');
});

test('L15 — Builder delete via lbbDeleteEntry removes from canonical', async ({ page }) => {
  await seed(page, {
    tracker: [],
    builder: [builderRec({ id: 'lbe_a' }), builderRec({ id: 'lbe_b' })],
  });
  await page.goto('/');
  await waitReady(page);
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_entries_v1') || '[]')
      .filter(e => e.id !== 'lbe_a');
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].legacyId).toBe('lbe_b');
});

test('L16 — more than 50 Builder records survive: cap removed', async ({ page }) => {
  const b = [];
  for (let i = 0; i < 60; i++) b.push(builderRec({ id: 'lbe_' + i, desc: 'entry ' + i }));
  await seed(page, { tracker: [], builder: b });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(60);
});

test('L17 — legacy divergence produces bounded drift metadata', async ({ page }) => {
  await seed(page, { tracker: [trackerRec({ id: 'lb_1' })], builder: [] });
  await page.goto('/');
  await waitReady(page);
  const initial = await page.evaluate(() => window.Store.get('logbook'));
  expect(initial.entries.length).toBe(1);
  expect(initial.drift).toBeNull();
  // Mutate legacy independently; then re-reconcile.
  const drift = await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    arr.push({
      id: 'lb_2', date: '2026-08-25', company: 'X', aircraft_type: 'A320',
      registration: 'B', engine_type: 'CFM', ata_chapter: '72', system: 'Engine',
      task_description: 'divergent', hours: '1', role: 'assistant', supervisor: 'S',
      stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1',
    });
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    const env = window.LOGBOOK.reconcile();
    return env.drift;
  });
  expect(drift.detected).toBe(true);
  expect(drift.previousCount).toBe(1);
  expect(drift.reconciledCount).toBe(2);
  expect(drift.reason).toBe('legacy_divergence');
  expect(typeof drift.previousDigest).toBe('string');
  expect(typeof drift.reconciledDigest).toBe('string');
  expect(drift.previousDigest).not.toBe(drift.reconciledDigest);
});

test('L18 — reconciliation is idempotent on unchanged legacy', async ({ page }) => {
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_i1' })],
    builder: [builderRec({ id: 'lbe_i1' })],
  });
  await page.goto('/');
  await waitReady(page);
  const first = await page.evaluate(() => JSON.stringify(window.Store.get('logbook').entries));
  const second = await page.evaluate(() => {
    window.LOGBOOK.reconcile();
    return JSON.stringify(window.Store.get('logbook').entries);
  });
  expect(second).toBe(first);
});

test('L19 — malformed logbook in dune_state_v4 is rejected by the strict source matrix; blocker set, envelope shape preserved', async ({ page }) => {
  // PRV-0.5 Pre-Push R2 / BINDING-3-A: a legacy source with a
  // malformed logbook (neither array nor envelope object) is
  // UNPROVEN under the strict matrix and MUST fail the atomic
  // legacy conversion — no silent recovery. The Store still boots
  // with a well-typed envelope shape (default-filled), but
  // STORE_LEGACY_CONVERSION_PENDING remains set until the user
  // recovers explicitly.
  test.setTimeout(15000);
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_ok' })],
    builder: [],
    state: {
      version: 12,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        logbook: 'this is not valid',
      }
    },
  });
  await page.goto('/');
  await waitAppSurfaces(page);
  const proof = await page.evaluate(() => ({
    env: window.Store.get('logbook'),
    blocker: window.Store.getDurabilityBlocker && window.Store.getDurabilityBlocker()
  }));
  expect(proof.env.authority).toBe('legacy-mirror');
  expect(Array.isArray(proof.env.entries)).toBe(true);
  expect(proof.blocker && proof.blocker.code).toBe('STORE_LEGACY_CONVERSION_PENDING');
});

test('L21 — schema-11 state-only Tracker recovery: legacy key absent, v11 Store array survives', async ({ page }) => {
  await page.addInitScript(() => {
    // No dune_logbook_v1, no dune_logbook_entries_v1 — both truly absent.
    // PRV-0.5 Pre-Push R2 / BINDING-3-A: v11 legacy wrappers require the
    // full defaultState-shape emitted at commit 8a1e374.
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 11,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: [
          { id: 'lb_1_recover', date: '2026-08-25', company: 'X',
            aircraft_type: 'A320', registration: 'S', engine_type: 'CFM',
            ata_chapter: '72', system: 'Engine', task_description: 'from v11 state',
            hours: '2', role: 'assistant', supervisor: 'S', stamp_status: 'pending',
            language: 'en', b1_relevance: 'B1.1' },
        ],
      }
    }));
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.authority).toBe('legacy-mirror');
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].source).toBe('tracker');
  expect(env.entries[0].legacyId).toBe('lb_1_recover');
});

test('L22 — schema-12 state-only Builder recovery: Builder legacy key absent, canonical Builder entries survive', async ({ page }) => {
  await page.addInitScript(() => {
    // Only Tracker present (as empty); Builder key deliberately absent.
    localStorage.setItem('dune_logbook_v1', JSON.stringify([]));
    localStorage.removeItem('dune_logbook_entries_v1');
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 12,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: {
          schemaVersion: 1,
          authority: 'legacy-mirror',
          entries: [
            { id: 'lb2:builder:lbe_saved', source: 'builder', legacyId: 'lbe_saved', sourceIndex: 0,
              inferredCreatedAt: null, date: '2026-01-01', aircraft: 'A320', registration: 'B',
              ata: '72', ataLabel: '72 — Engine', description: 'from state', hours: 1.5, supervisor: 'S',
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: 'R1', possibleDuplicateKey: null, legacyExtra: {} }
          ],
          migration: { version: 1, sourceCounts: { tracker: 0, builder: 1 } },
          drift: null
        }
      }
    }));
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].source).toBe('builder');
  expect(env.entries[0].legacyId).toBe('lbe_saved');
});

test('L23 — both legacy keys absent: canonical Tracker + Builder entries both recovered', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.removeItem('dune_logbook_v1');
    localStorage.removeItem('dune_logbook_entries_v1');
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 12,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: {
          schemaVersion: 1, authority: 'legacy-mirror',
          entries: [
            { id: 'lb2:tracker:lb_a', source: 'tracker', legacyId: 'lb_a', sourceIndex: 0,
              inferredCreatedAt: null, date: '2026-01-01', aircraft: 'T-A', registration: null,
              ata: null, ataLabel: null, description: null, hours: null, supervisor: null,
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} },
            { id: 'lb2:builder:lbe_b', source: 'builder', legacyId: 'lbe_b', sourceIndex: 0,
              inferredCreatedAt: null, date: '2026-01-02', aircraft: 'B-A', registration: null,
              ata: null, ataLabel: null, description: null, hours: null, supervisor: null,
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} }
          ],
          migration: { version: 1, sourceCounts: { tracker: 1, builder: 1 } },
          drift: null
        }
      }
    }));
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  expect(env.entries.length).toBe(2);
  const bySource = Object.fromEntries(env.entries.map(e => [e.source, e]));
  expect(bySource.tracker.legacyId).toBe('lb_a');
  expect(bySource.builder.legacyId).toBe('lbe_b');
});

test('L24 — empty legacy key suppresses recovery for that source', async ({ page }) => {
  await page.addInitScript(() => {
    // Tracker present as []; Builder absent.
    localStorage.setItem('dune_logbook_v1', JSON.stringify([]));
    localStorage.removeItem('dune_logbook_entries_v1');
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 12,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: {
          schemaVersion: 1, authority: 'legacy-mirror',
          entries: [
            { id: 'lb2:tracker:lb_ghost', source: 'tracker', legacyId: 'lb_ghost', sourceIndex: 0,
              inferredCreatedAt: null, date: '2020-01-01', aircraft: 'stale', registration: null,
              ata: null, ataLabel: null, description: null, hours: null, supervisor: null,
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} },
            { id: 'lb2:builder:lbe_ok', source: 'builder', legacyId: 'lbe_ok', sourceIndex: 0,
              inferredCreatedAt: null, date: '2026-01-01', aircraft: 'B', registration: null,
              ata: null, ataLabel: null, description: null, hours: null, supervisor: null,
              company: null, engineType: null, system: null, role: null, stampStatus: null,
              language: null, b1Relevance: null, ref: null, possibleDuplicateKey: null, legacyExtra: {} }
          ],
          migration: { version: 1, sourceCounts: { tracker: 1, builder: 1 } },
          drift: null
        }
      }
    }));
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  // Tracker legacy [] suppresses the ghost record; Builder legacy absent
  // → Builder recovered from envelope.
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].source).toBe('builder');
  expect(env.entries[0].legacyId).toBe('lbe_ok');
});

test('L25 — fallback ID stable after unrelated prepend', async ({ page }) => {
  await seed(page, {
    tracker: [
      // Existing missing-ID record.
      trackerRec({ id: undefined, task_description: 'stable-A', hours: '1' }),
    ],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const first = await page.evaluate(() => window.Store.get('logbook').entries.map(e => e.id));
  expect(first.length).toBe(1);
  const originalId = first[0];
  // Prepend an unrelated missing-ID record; the existing record's ID must not shift.
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    arr.unshift({
      // no id → missing-ID; different content so different contentHash.
      date: '2026-08-01', company: 'X', aircraft_type: 'DIFF',
      registration: 'DIFF', engine_type: 'CFM', ata_chapter: '05',
      system: 'Time Limits', task_description: 'unrelated-prepend',
      hours: '9', role: 'assistant', supervisor: 'S',
      stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1'
    });
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const after = await page.evaluate(() => window.Store.get('logbook').entries);
  // Find the original by content marker.
  const originalStill = after.find(e => e.description === 'stable-A');
  expect(originalStill).toBeTruthy();
  expect(originalStill.id).toBe(originalId);
});

test('L26 — fallback ID stable under reorder of distinct missing-ID records', async ({ page }) => {
  await seed(page, {
    tracker: [
      trackerRec({ id: undefined, task_description: 'reorder-A', hours: '1' }),
      trackerRec({ id: undefined, task_description: 'reorder-B', hours: '2' }),
    ],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const beforeIds = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.description, e.id]))
  );
  // Reverse the array; distinct-content records must keep same IDs.
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]').reverse();
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const afterIds = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.description, e.id]))
  );
  expect(afterIds['reorder-A']).toBe(beforeIds['reorder-A']);
  expect(afterIds['reorder-B']).toBe(beforeIds['reorder-B']);
});

test('L27 — duplicate legacy IDs stay stable after reorder; no member gets the unsuffixed ID', async ({ page }) => {
  await seed(page, {
    tracker: [
      trackerRec({ id: 'lb_dupsame', task_description: 'dup-first', hours: '1' }),
      trackerRec({ id: 'lb_dupsame', task_description: 'dup-second', hours: '2' }),
    ],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const first = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.description, e.id]))
  );
  // Neither member of a duplicate-ID group may receive the unsuffixed form —
  // otherwise reordering swaps identities.
  expect(first['dup-first']).not.toBe('lb2:tracker:lb_dupsame');
  expect(first['dup-second']).not.toBe('lb2:tracker:lb_dupsame');
  expect(first['dup-first']).toMatch(/^lb2:tracker:dup:lb_dupsame:[0-9a-f]+:\d+$/);
  expect(first['dup-second']).toMatch(/^lb2:tracker:dup:lb_dupsame:[0-9a-f]+:\d+$/);
  expect(first['dup-first']).not.toBe(first['dup-second']);
  // Reverse the legacy array order; each semantic record must retain its
  // exact canonical ID.
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]').reverse();
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const afterReorder = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.description, e.id]))
  );
  expect(afterReorder['dup-first']).toBe(first['dup-first']);
  expect(afterReorder['dup-second']).toBe(first['dup-second']);
  // Reload; still stable across load.
  await page.reload();
  await waitReady(page);
  const afterReload = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.description, e.id]))
  );
  expect(afterReload['dup-first']).toBe(first['dup-first']);
  expect(afterReload['dup-second']).toBe(first['dup-second']);
});

test('L28 — same-count drift: content change with unchanged count still detected', async ({ page }) => {
  await seed(page, { tracker: [trackerRec({ id: 'lb_sc1', task_description: 'original', hours: '2' })], builder: [] });
  await page.goto('/');
  await waitReady(page);
  // Force a canonical persist so subsequent reconcile has a prior digest to compare.
  await page.evaluate(() => window.LOGBOOK.reconcile());
  const drift = await page.evaluate(() => {
    // Replace the record content while keeping the same ID and count.
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    arr[0].hours = '5';
    arr[0].task_description = 'edited';
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    return window.LOGBOOK.reconcile().drift;
  });
  expect(drift).not.toBeNull();
  expect(drift.detected).toBe(true);
  expect(drift.previousCount).toBe(1);
  expect(drift.reconciledCount).toBe(1);
  expect(drift.previousDigest).not.toBe(drift.reconciledDigest);
});

test('L29 — legacyExtra safely holds real own __proto__ / constructor / prototype without prototype mutation', async ({ page }) => {
  // Object-literal `{__proto__: …}` sets the prototype instead of adding an
  // own property. To create a REAL own __proto__ key we use JSON.parse,
  // which post-ES2015 makes it an own enumerable data property.
  await page.addInitScript(() => {
    const hostileJson = '{"id":"lb_hostile","date":"2026-08-25","company":"X",' +
      '"aircraft_type":"A320","registration":"H","engine_type":"CFM",' +
      '"ata_chapter":"72","system":"Engine","task_description":"safe extras test",' +
      '"hours":"2","role":"assistant","supervisor":"S","stamp_status":"pending",' +
      '"language":"en","b1_relevance":"B1.1",' +
      '"__proto__":{"polluted":true},"constructor":"attacker-constructor",' +
      '"prototype":"attacker-prototype","innocent":"ok"}';
    const arr = [JSON.parse(hostileJson)];
    // Round-trip the array so localStorage receives standard JSON with a
    // real own __proto__ key preserved.
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify([]));
  });
  await page.goto('/');
  await waitReady(page);
  const result = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]')[0];
    const env = window.Store.get('logbook');
    const rec = env.entries[0];
    return {
      // Input actually contains a real own __proto__ key.
      inputHasOwnProto: Object.prototype.hasOwnProperty.call(raw, '__proto__'),
      // Confirm no leakage onto Object.prototype.
      globalPolluted: ({}).polluted,
      // extras is a null-prototype dict.
      extrasHasProto: Object.getPrototypeOf(rec.legacyExtra) === null,
      // Own properties on extras — via Object.keys so we don't accidentally
      // walk a prototype chain.
      extrasKeys: Object.keys(rec.legacyExtra).sort(),
      innocentValue: rec.legacyExtra.innocent,
      constructorValue: rec.legacyExtra.constructor,
      prototypeValue: rec.legacyExtra.prototype,
      // Read __proto__ safely via getOwnPropertyDescriptor.
      protoOwn: !!Object.getOwnPropertyDescriptor(rec.legacyExtra, '__proto__'),
      protoOwnValue: (Object.getOwnPropertyDescriptor(rec.legacyExtra, '__proto__') || {}).value,
    };
  });
  expect(result.inputHasOwnProto).toBe(true);
  expect(result.globalPolluted).toBeUndefined();
  expect(result.extrasHasProto).toBe(true);
  expect(result.extrasKeys).toEqual(['__proto__', 'constructor', 'innocent', 'prototype']);
  expect(result.innocentValue).toBe('ok');
  expect(result.constructorValue).toBe('attacker-constructor');
  expect(result.prototypeValue).toBe('attacker-prototype');
  expect(result.protoOwn).toBe(true);
  expect(result.protoOwnValue).toEqual({ polluted: true });
});

test('L30 — malformed known field: raw value preserved under legacyExtra', async ({ page }) => {
  await seed(page, {
    tracker: [{
      id: 'lb_bad_scalar',
      date: { year: 2026 },              // object instead of string
      company: 'X', aircraft_type: 'A320', registration: 'R',
      engine_type: 'CFM', ata_chapter: '72', system: 'Engine',
      task_description: 'malformed date preserved',
      hours: { unit: 'h' },              // object instead of number/string
      role: 'assistant', supervisor: 'S',
      stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1',
    }],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const rec = await page.evaluate(() => window.Store.get('logbook').entries[0]);
  expect(rec.date).toBeNull();
  expect(rec.hours).toBeNull();
  expect(rec.legacyExtra.date).toEqual({ year: 2026 });
  expect(rec.legacyExtra.hours).toEqual({ unit: 'h' });
});

test('L31 — implausible legacy epoch → inferredCreatedAt=null; plausible → ISO', async ({ page }) => {
  await seed(page, {
    tracker: [
      trackerRec({ id: 'lb_1', task_description: 'implausible' }),
      trackerRec({ id: 'lb_1735689600000', task_description: 'plausible 2025' }), // 2025-01-01
    ],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  const rows = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.description, e.inferredCreatedAt]))
  );
  expect(rows['implausible']).toBeNull();
  expect(typeof rows['plausible 2025']).toBe('string');
  expect(rows['plausible 2025']).toMatch(/^2025-/);
});

test('L32 — malformed schema-12 Logbook: strict source rejection, blocker set, unrelated slices survive in memory', async ({ page }) => {
  // PRV-0.5 Pre-Push R2 / BINDING-3-A: v12 source with a malformed
  // logbook fails source validation under the strict matrix. The
  // Store boots with a default-filled canonical envelope shape and
  // preserves the user-provided unrelated slices (money, qatarVisit)
  // in memory, while STORE_LEGACY_CONVERSION_PENDING remains set
  // until the user recovers.
  test.setTimeout(15000);
  await page.addInitScript(() => {
    localStorage.setItem('dune_logbook_v1', JSON.stringify([]));
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify([]));
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 12,
      data: {
        money: { salary_net: 999888, expenses: {}, save_target: 44444, usd_rate: 77 },
        qatarVisit: { foo: 'bar' },
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: 'not an envelope',
      }
    }));
  });
  await page.goto('/');
  await waitAppSurfaces(page);
  const s = await page.evaluate(() => ({
    logbook: window.Store.get('logbook'),
    salary: window.Store.get('money.salary_net'),
    saveTarget: window.Store.get('money.save_target'),
    qatarVisit: window.Store.get('qatarVisit'),
    blocker: window.Store.getDurabilityBlocker && window.Store.getDurabilityBlocker()
  }));
  expect(s.logbook.authority).toBe('legacy-mirror');
  expect(Array.isArray(s.logbook.entries)).toBe(true);
  expect(s.salary).toBe(999888);
  expect(s.saveTarget).toBe(44444);
  expect(s.qatarVisit).toEqual({ foo: 'bar' });
  expect(s.blocker && s.blocker.code).toBe('STORE_LEGACY_CONVERSION_PENDING');
});

// Production-writer path helpers: attach the minimal DOM the writer
// functions read. Both writers call renderLogbookBuilder/renderLogbook
// on completion which touch DOM, so we inject stubs where necessary.
async function attachBuilderDom(page) {
  await page.evaluate(() => {
    function ensure(id, tag) {
      if (document.getElementById(id)) return document.getElementById(id);
      const el = document.createElement(tag);
      el.id = id;
      document.body.appendChild(el);
      return el;
    }
    ensure('lb-builder-root', 'div');
    ['lbb-date','lbb-aircraft','lbb-reg','lbb-hours','lbb-supervisor','lbb-ref','lbb-ata-other']
      .forEach(id => ensure(id, 'input'));
    ensure('lbb-desc', 'textarea');
    const sel = ensure('lbb-ata', 'select');
    if (!sel.querySelector('option[value="72"]')) {
      const opt = document.createElement('option');
      opt.value = '72'; opt.textContent = '72 — Engine';
      sel.appendChild(opt);
    }
    ensure('lbb-ata-other-wrap', 'div');
    ensure('lbb-entries', 'div');
  });
}

test('L33 — real submitLogEntry mirrors into canonical', async ({ page }) => {
  await seed(page, { tracker: [], builder: [] });
  await page.goto('/');
  await waitReady(page);
  await page.evaluate(() => {
    // Stub confirm/alert so downstream renderers don't block.
    window.confirm = () => true; window.alert = () => {};
    const fakeForm = {
      lb_date: { value: '2026-08-25' }, lb_company: { value: 'АэроТраст' },
      lb_aircraft: { value: 'A320-200' }, lb_reg: { value: 'VP-BQP' },
      lb_engine: { value: 'CFM56-5B' }, lb_ata: { value: '72' },
      lb_system: { value: 'Engine' }, lb_task: { value: 'real add' },
      lb_hours: { value: '3' }, lb_role: { value: 'assistant' },
      lb_supervisor: { value: 'S' }, lb_stamp: { value: 'pending' },
      lb_lang: { value: 'en' }, lb_b1: { value: 'B1.1' },
      reset: () => {},
    };
    fakeForm.lb_date.value = '2026-08-25';
    window.submitLogEntry({ preventDefault: () => {}, target: fakeForm });
  });
  const s = await page.evaluate(() => ({
    legacy: JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]'),
    canonical: window.Store.get('logbook').entries,
  }));
  expect(s.legacy.length).toBe(1);
  expect(s.legacy[0].task_description).toBe('real add');
  expect(s.canonical.length).toBe(1);
  expect(s.canonical[0].source).toBe('tracker');
  expect(s.canonical[0].description).toBe('real add');
});

test('L34 — real deleteLogEntry mirrors into canonical', async ({ page }) => {
  await seed(page, {
    tracker: [trackerRec({ id: 'lb_del_a' }), trackerRec({ id: 'lb_del_b' })],
    builder: [],
  });
  await page.goto('/');
  await waitReady(page);
  await page.evaluate(() => {
    window.confirm = () => true;
    window.deleteLogEntry(0);
  });
  const s = await page.evaluate(() => ({
    legacy: JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]'),
    canonical: window.Store.get('logbook').entries,
  }));
  expect(s.legacy.length).toBe(1);
  expect(s.legacy[0].id).toBe('lb_del_b');
  expect(s.canonical.length).toBe(1);
  expect(s.canonical[0].legacyId).toBe('lb_del_b');
});

test('L35 — real lbbSaveEntry mirrors into canonical', async ({ page }) => {
  await seed(page, { tracker: [], builder: [] });
  await page.goto('/');
  await waitReady(page);
  await attachBuilderDom(page);
  await page.evaluate(() => {
    document.getElementById('lbb-date').value = '2026-08-25';
    document.getElementById('lbb-aircraft').value = 'A320';
    document.getElementById('lbb-reg').value = 'RG';
    document.getElementById('lbb-ata').value = '72';
    document.getElementById('lbb-hours').value = '2';
    document.getElementById('lbb-supervisor').value = 'Sup';
    document.getElementById('lbb-ref').value = 'AMM 72';
    document.getElementById('lbb-desc').value = 'real builder add';
    window.lbbSaveEntry();
  });
  const s = await page.evaluate(() => ({
    legacy: JSON.parse(localStorage.getItem('dune_logbook_entries_v1') || '[]'),
    canonical: window.Store.get('logbook').entries,
  }));
  expect(s.legacy.length).toBe(1);
  expect(s.legacy[0].desc).toBe('real builder add');
  expect(s.canonical.length).toBe(1);
  expect(s.canonical[0].source).toBe('builder');
  expect(s.canonical[0].description).toBe('real builder add');
});

test('L36 — real lbbDeleteEntry mirrors into canonical', async ({ page }) => {
  await seed(page, {
    tracker: [],
    builder: [builderRec({ id: 'lbe_del_a' }), builderRec({ id: 'lbe_del_b' })],
  });
  await page.goto('/');
  await waitReady(page);
  await attachBuilderDom(page);
  await page.evaluate(() => {
    window.confirm = () => true;
    window.lbbDeleteEntry('lbe_del_a');
  });
  const s = await page.evaluate(() => ({
    legacy: JSON.parse(localStorage.getItem('dune_logbook_entries_v1') || '[]'),
    canonical: window.Store.get('logbook').entries,
  }));
  expect(s.legacy.length).toBe(1);
  expect(s.legacy[0].id).toBe('lbe_del_b');
  expect(s.canonical.length).toBe(1);
  expect(s.canonical[0].legacyId).toBe('lbe_del_b');
});

test('L37 — real 51st Builder write via lbbSaveEntry: cap is truly gone in production path', async ({ page }) => {
  const b = [];
  for (let i = 0; i < 50; i++) b.push(builderRec({ id: 'lbe_seed_' + i, desc: 'seed ' + i }));
  await seed(page, { tracker: [], builder: b });
  await page.goto('/');
  await waitReady(page);
  await attachBuilderDom(page);
  await page.evaluate(() => {
    document.getElementById('lbb-date').value = '2026-08-25';
    document.getElementById('lbb-aircraft').value = 'A320';
    document.getElementById('lbb-reg').value = 'R51';
    document.getElementById('lbb-ata').value = '72';
    document.getElementById('lbb-hours').value = '2';
    document.getElementById('lbb-supervisor').value = 'S';
    document.getElementById('lbb-ref').value = '';
    document.getElementById('lbb-desc').value = 'the 51st entry';
    window.lbbSaveEntry();
  });
  const s = await page.evaluate(() => {
    const legacy = JSON.parse(localStorage.getItem('dune_logbook_entries_v1') || '[]');
    const canonical = window.Store.get('logbook').entries;
    return {
      legacyLen: legacy.length,
      canonicalLen: canonical.length,
      hasNewLegacy:      legacy.some(e => e.desc === 'the 51st entry'),
      // The old cap was `unshift(newEntry); if (length>50) pop()`, so
      // it would remove the TAIL record (highest-index seed = lbe_seed_49),
      // not the head. Assert that specific tail record survives to prove
      // the cap is truly gone.
      hasCapVictimLegacy: legacy.some(e => e.id === 'lbe_seed_49'),
      hasNewCanonical:   canonical.some(e => e.description === 'the 51st entry'),
      hasCapVictimCanonical: canonical.some(e => e.legacyId === 'lbe_seed_49'),
    };
  });
  expect(s.legacyLen).toBe(51);
  expect(s.canonicalLen).toBe(51);
  expect(s.hasNewLegacy).toBe(true);
  expect(s.hasNewCanonical).toBe(true);
  // Explicit cap-victim survival: lbe_seed_49 (the record the old
  // 50-cap would have popped) is still present in both legacy and
  // canonical.
  expect(s.hasCapVictimLegacy).toBe(true);
  expect(s.hasCapVictimCanonical).toBe(true);
});

test('L38 — legacyExtra participates in identity: swapping content-identical records with different extras preserves IDs', async ({ page }) => {
  // Two missing-ID Tracker records identical in every normalised field
  // but differing only in legacyExtra content (unknown extra field
  // `tool`). Their canonical IDs must depend on legacyExtra so reversing
  // them does not swap identities.
  await page.addInitScript(() => {
    const arr = [
      // No id → missing legacyId. Extras via unknown `tool` key.
      { date: '2026-08-25', company: 'X', aircraft_type: 'A320',
        registration: 'R', engine_type: 'CFM', ata_chapter: '72',
        system: 'Engine', task_description: 'identical', hours: '2',
        role: 'assistant', supervisor: 'S', stamp_status: 'pending',
        language: 'en', b1_relevance: 'B1.1', tool: 'A' },
      { date: '2026-08-25', company: 'X', aircraft_type: 'A320',
        registration: 'R', engine_type: 'CFM', ata_chapter: '72',
        system: 'Engine', task_description: 'identical', hours: '2',
        role: 'assistant', supervisor: 'S', stamp_status: 'pending',
        language: 'en', b1_relevance: 'B1.1', tool: 'B' },
    ];
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify([]));
  });
  await page.goto('/');
  await waitReady(page);
  const first = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.legacyExtra.tool, e.id]))
  );
  expect(first.A).toBeDefined();
  expect(first.B).toBeDefined();
  expect(first.A).not.toBe(first.B);
  // Reverse order; each semantic record (identified by its extras) keeps its ID.
  await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]').reverse();
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    window.LOGBOOK.reconcile();
  });
  const after = await page.evaluate(() =>
    Object.fromEntries(window.Store.get('logbook').entries.map(e => [e.legacyExtra.tool, e.id]))
  );
  expect(after.A).toBe(first.A);
  expect(after.B).toBe(first.B);
});

test('L39 — legacyExtra participates in drift digest: same-ID same-normalised-fields extras change → drift', async ({ page }) => {
  await page.addInitScript(() => {
    const arr = [{
      id: 'lb_ex_drift', date: '2026-08-25', company: 'X', aircraft_type: 'A320',
      registration: 'R', engine_type: 'CFM', ata_chapter: '72', system: 'Engine',
      task_description: 'stable', hours: '2', role: 'assistant', supervisor: 'S',
      stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1', tool: 'A'
    }];
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify([]));
  });
  await page.goto('/');
  await waitReady(page);
  // First reconcile is baseline — mark reconciled by running once through the API.
  await page.evaluate(() => window.LOGBOOK.reconcile());
  const drift = await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    // Change ONLY an extras field (unknown key `tool`). Count, id,
    // normalised fields all unchanged.
    arr[0].tool = 'B';
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    return window.LOGBOOK.reconcile().drift;
  });
  expect(drift).not.toBeNull();
  expect(drift.detected).toBe(true);
  expect(drift.previousCount).toBe(1);
  expect(drift.reconciledCount).toBe(1);
  expect(drift.previousDigest).not.toBe(drift.reconciledDigest);
});

test('L40 — first reconciliation after schema-11 migration produces reconciled marker and no false drift', async ({ page }) => {
  await page.addInitScript(() => {
    // Schema-11 state with a stale/dormant Tracker array.
    // PRV-0.5 Pre-Push R2 / BINDING-3-A: v11 requires the full
    // defaultState-shape emitted at commit 8a1e374.
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 11,
      data: {
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: [
          { id: 'lb_stale', date: '2020-01-01', company: 'stale',
            aircraft_type: 'X', registration: 'X', engine_type: 'X',
            ata_chapter: '00', system: 'X', task_description: 'stale',
            hours: '0', role: 'x', supervisor: 'x',
            stamp_status: 'pending', language: 'en', b1_relevance: '' },
        ],
      }
    }));
    // Live legacy Tracker with different records.
    localStorage.setItem('dune_logbook_v1', JSON.stringify([
      { id: 'lb_live', date: '2026-08-25', company: 'live',
        aircraft_type: 'A320', registration: 'L', engine_type: 'CFM',
        ata_chapter: '72', system: 'Engine', task_description: 'live entry',
        hours: '2', role: 'assistant', supervisor: 'S',
        stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1' },
    ]));
    localStorage.setItem('dune_logbook_entries_v1', JSON.stringify([]));
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  // Canonical reflects LIVE legacy, not the stale migrated array.
  expect(env.entries.length).toBe(1);
  expect(env.entries[0].legacyId).toBe('lb_live');
  // Reconciled marker true; drift null on first real reconciliation.
  expect(env.reconciled).toBe(true);
  expect(env.drift).toBeNull();
  // Now legitimate divergence: mutate legacy → drift should appear.
  const drift = await page.evaluate(() => {
    const arr = JSON.parse(localStorage.getItem('dune_logbook_v1') || '[]');
    arr.push({ id: 'lb_live2', date: '2026-08-26', company: 'live',
      aircraft_type: 'A320', registration: 'L', engine_type: 'CFM',
      ata_chapter: '72', system: 'Engine', task_description: 'second',
      hours: '3', role: 'assistant', supervisor: 'S',
      stamp_status: 'pending', language: 'en', b1_relevance: 'B1.1' });
    localStorage.setItem('dune_logbook_v1', JSON.stringify(arr));
    return window.LOGBOOK.reconcile().drift;
  });
  expect(drift).not.toBeNull();
  expect(drift.detected).toBe(true);
});

test('L20 — old schema-11 array in dune_state_v4 migrates into envelope and reconciles from live legacy', async ({ page }) => {
  // dune_state_v4 at version 11 with logbook as a Tracker-shaped array —
  // migrateUp v11→v12 must convert to envelope; then reconcile from
  // current live legacy keys should replace those entries with whatever
  // dune_logbook_v1 currently holds (present + empty = empty).
  await seed(page, {
    tracker: [],
    builder: [],
    state: {
      version: 11,
      data: {
        // PRV-0.5 Pre-Push R2 / BINDING-3-A: v11 requires full
        // defaultState-shape emission (commit 8a1e374).
        money: { salary_net: 130000, expenses: {} },
        qatarVisit: {},
        career: {}, easa: {}, about: {}, sbTasks: {}, goals: {},
        bht: { habits: [], entries: [] }, telemetry: {},
        todayFocus: [], timeline: [], reviews: [], decisions: [], ideas: [], apartments: [],
        meta: { version: 12, createdAt: '2026-08-25T00:00:00Z', lastUpdated: '2026-08-25T00:00:00Z' },
        logbook: [
          { id: 'lb_from_state', date: '2026-08-01', company: 'X',
            aircraft_type: 'A320', registration: 'S', engine_type: 'CFM',
            ata_chapter: '72', system: 'Engine', task_description: 'preseed',
            hours: '2', role: 'assistant', supervisor: 'S', stamp_status: 'pending',
            language: 'en', b1_relevance: 'B1.1' },
        ],
      }
    }
  });
  await page.goto('/');
  await waitReady(page);
  const env = await page.evaluate(() => window.Store.get('logbook'));
  // Tracker key present as [] is authoritative — old-state entry NOT resurrected.
  expect(env.authority).toBe('legacy-mirror');
  expect(env.entries.length).toBe(0);
});
