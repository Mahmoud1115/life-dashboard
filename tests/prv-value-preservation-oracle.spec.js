// PRV-0.5 Codex Round-6 P3-01 — historical value-preservation oracle.
//
// For every supported historical schema (v8..v13) construct a valid
// source with NON-DEFAULT sentinel values on every BHT + telemetry +
// money named path, then run Store.evaluateCandidateWrapper (the
// destructive-boundary migration path) and assert every sentinel
// survives byte-exact in the migrated v14 candidate.
//
// Exception (ADR-005): bht.ai.apiKey is not canonical preservation
// state and MUST NOT be reintroduced. If a sentinel key on
// bht.ai.apiKey survives migration, the migration has re-widened a
// deliberately-narrowed provenance surface — fail.
//
// This oracle deliberately defines its own literal sentinel table
// inside the spec (not sourced from R6A_EVIDENCE, not derived from
// Store code). A production matrix corruption bug that quietly
// rewrites expected preservation cannot rewrite this oracle.

const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;
const APP_GITHUB_COMMITS_PATH = '/repos/Mahmoud1115/life-dashboard/commits';
const SYNTHETIC_COMMIT_ISO = '2026-08-25T00:00:00Z';

function isAppExpectedGithubCommitsRequest(rawUrl) {
  let parsed; try { parsed = new URL(rawUrl); } catch (_) { return false; }
  if (parsed.pathname !== APP_GITHUB_COMMITS_PATH) return false;
  if (parsed.searchParams.get('per_page') !== '1') return false;
  return Array.from(parsed.searchParams.keys()).length === 1;
}

test.beforeEach(async ({ context }) => {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) => {
    if (!isAppExpectedGithubCommitsRequest(route.request().url())) return route.abort();
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: SYNTHETIC_COMMIT_ISO } } }])
    });
  });
});

async function waitForApp(page) {
  await page.waitForFunction(() =>
    !!(window.Store && typeof window.Store.get === 'function'));
}

// ── Independent sentinel table ────────────────────────────────────
// One sentinel value per required BHT + telemetry + money field. NON-
// DEFAULT for every path (default fixture uses `provider:'fallback'`,
// `ollamaUrl:'http://localhost:11434'`, `model:''`, `[]` for arrays,
// `{}` for meta, and 0/100 for telemetry numbers). If any of these
// literal values disappears from the migrated candidate, migration
// has silently lost user data.
//
// Provider is constrained to {'fallback','ollama'} by bht.js
// sanitizeAI (ADR-005). We use 'ollama' — the non-default option that
// survives sanitization AND proves the sentinel is preserved by
// migration. Sanitization only runs at app load; the Store-level
// migration (evaluateCandidateWrapper) does not apply it. If a future
// migration ever wired sanitizeAI into evaluateCandidateWrapper, a
// non-ollama provider would still survive as 'fallback' — for that
// hardening branch, we assert exactly the two values that survive
// sanitizeAI.
const SENTINELS = Object.freeze({
  money: Object.freeze({
    'money.salary_net': 424242,
    'money.expenses':   Object.freeze({ __oracle_marker__: 'money-expenses-sentinel', rent: 90210 })
  }),
  bht: Object.freeze({
    'bht.habits':          Object.freeze([ Object.freeze({ id: 'oracle-habit-1', label: 'oracle-label-1' }) ]),
    'bht.entries':         Object.freeze([ Object.freeze({ id: 'oracle-entry-1', mood: 'oracle-mood-1' }) ]),
    'bht.snapshots':       Object.freeze([ Object.freeze({ at: '2026-06-15T00:00:00Z', risk: 'oracle-risk-1' }) ]),
    'bht.lifeEvents':      Object.freeze([ Object.freeze({ id: 'oracle-life-1', note: 'oracle-life-note' }) ]),
    'bht.vocab.triggers':  Object.freeze([ 'oracle-trigger-1', 'oracle-trigger-2' ]),
    'bht.vocab.coping':    Object.freeze([ 'oracle-coping-1' ]),
    'bht.vocab.moods':     Object.freeze([ 'oracle-mood-a', 'oracle-mood-b', 'oracle-mood-c' ]),
    'bht.ai.provider':     'ollama',
    'bht.ai.ollamaUrl':    'http://oracle-sentinel.local:19999',
    'bht.ai.model':        'oracle-model-sentinel',
    // `bht.meta` marker uses only free-form keys the migration does
    // not normalize (`version` is migration-managed and correctly gets
    // rewritten to the migrated schemaVersion). A preserved arbitrary
    // key is proof enough that the meta object was carried through.
    'bht.meta':            Object.freeze({ __oracle_marker__: 'bht-meta-sentinel', __oracle_note__: 'preserve-me' })
  }),
  telemetry: Object.freeze({
    'telemetry.accumulatedFatigue': 7777,
    'telemetry.weeklyShiftHours':   88.5,
    'telemetry.focusReserve':       33
  })
});

// Rehydrate the frozen sentinel table on the page side, then set every
// field on a synthesized source of the requested version.
function _buildSentinelSourceFactory() {
  return `
(function(version, sentinels) {
  var iso = '2026-08-25T00:00:00Z';
  var envelope = {
    schemaVersion: 1, authority: 'legacy-mirror', entries: [],
    migration: { version: 1, sourceCounts: { tracker: 0, builder: 0 } },
    reconciled: false, drift: null
  };
  var lb = (version >= 12) ? envelope : [];
  // Deep-clone sentinels so the source object is mutable (Playwright
  // freezes payload structures on the page side).
  function d(x) { return JSON.parse(JSON.stringify(x)); }
  var data = {
    money: { salary_net: d(sentinels.money['money.salary_net']),
             expenses:   d(sentinels.money['money.expenses']) },
    qatarVisit: { from_airport:'', to_airport:'', travel_month:'', flights:0, hotel:0, food:0, transport:0, misc:0, emergency:0, saved:0, notes:'' },
    todayFocus: ['','',''], reviews: [], decisions: [], timeline: [], apartments: [],
    goals: {}, career: {}, easa: {}, about: {}, sbTasks: {},
    logbook: lb,
    bht: {
      habits:     d(sentinels.bht['bht.habits']),
      entries:    d(sentinels.bht['bht.entries']),
      snapshots:  d(sentinels.bht['bht.snapshots']),
      lifeEvents: d(sentinels.bht['bht.lifeEvents']),
      vocab: {
        triggers: d(sentinels.bht['bht.vocab.triggers']),
        coping:   d(sentinels.bht['bht.vocab.coping']),
        moods:    d(sentinels.bht['bht.vocab.moods'])
      },
      ai: {
        provider:  sentinels.bht['bht.ai.provider'],
        ollamaUrl: sentinels.bht['bht.ai.ollamaUrl'],
        model:     sentinels.bht['bht.ai.model'],
        // PRV-0.5 Codex Round-7 P3 remediation: seed a sentinel apiKey
        // value on the historical source. ADR-005 mandates that
        // bht.ai.apiKey MUST NOT survive migration. The oracle proves
        // active removal by planting a specific literal here and then
        // asserting it is absent in the migrated candidate — not just
        // asserting it "was never present."
        apiKey: 'oracle-apiKey-sentinel-must-be-stripped-by-migration'
      },
      meta: d(sentinels.bht['bht.meta'])
    },
    telemetry: {
      accumulatedFatigue: sentinels.telemetry['telemetry.accumulatedFatigue'],
      weeklyShiftHours:   sentinels.telemetry['telemetry.weeklyShiftHours'],
      focusReserve:       sentinels.telemetry['telemetry.focusReserve']
    },
    meta: { version: version, createdAt: iso, lastUpdated: iso }
  };
  if (version >= 9) data.ideas = [];
  // v12+ wrappers carry revision/committedAt; v8..v11 do not (source is
  // an outer legacy version).
  var wrapper = (version >= 12)
    ? { version: version, revision: 5, committedAt: iso, data: data }
    : { version: version, data: data };
  return wrapper;
})`;
}

// Pull a value at a dotted path.
function _getAt(obj, path) {
  var cur = obj;
  var parts = path.split('.');
  for (var i = 0; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

for (const version of [8, 9, 10, 11, 12, 13]) {
  test('R7-CODEX-R6-P3-01-V' + version + '-VALUE-PRESERVATION-ORACLE — every named BHT + telemetry + money sentinel survives evaluateCandidateWrapper migration to v14; bht.ai.apiKey never reintroduced', async ({ page }) => {
    await page.goto('/'); await waitForApp(page);
    const proof = await page.evaluate(({ v, sentinels, factorySrc }) => {
      const factory = eval(factorySrc);
      const wrapper = factory(v, sentinels);
      const ev = window.Store.evaluateCandidateWrapper(wrapper);
      return {
        canonical: ev.canonical,
        classification: ev.classification,
        data: ev.data ? JSON.parse(JSON.stringify(ev.data)) : null,
        reasons: ev.reasons || null
      };
    }, { v: version, sentinels: SENTINELS, factorySrc: _buildSentinelSourceFactory() });
    expect(proof.canonical, JSON.stringify({ classification: proof.classification, reasons: proof.reasons })).toBe(true);
    // Money sentinels
    expect(_getAt(proof.data, 'money.salary_net')).toBe(SENTINELS.money['money.salary_net']);
    expect(_getAt(proof.data, 'money.expenses')).toMatchObject({ __oracle_marker__: 'money-expenses-sentinel', rent: 90210 });
    // BHT sentinels (arrays deep-equal, primitives strict-equal)
    expect(_getAt(proof.data, 'bht.habits')).toEqual([{ id: 'oracle-habit-1', label: 'oracle-label-1' }]);
    expect(_getAt(proof.data, 'bht.entries')).toEqual([{ id: 'oracle-entry-1', mood: 'oracle-mood-1' }]);
    expect(_getAt(proof.data, 'bht.snapshots')).toEqual([{ at: '2026-06-15T00:00:00Z', risk: 'oracle-risk-1' }]);
    expect(_getAt(proof.data, 'bht.lifeEvents')).toEqual([{ id: 'oracle-life-1', note: 'oracle-life-note' }]);
    expect(_getAt(proof.data, 'bht.vocab.triggers')).toEqual(['oracle-trigger-1', 'oracle-trigger-2']);
    expect(_getAt(proof.data, 'bht.vocab.coping')).toEqual(['oracle-coping-1']);
    expect(_getAt(proof.data, 'bht.vocab.moods')).toEqual(['oracle-mood-a', 'oracle-mood-b', 'oracle-mood-c']);
    expect(_getAt(proof.data, 'bht.ai.provider')).toBe('ollama');
    expect(_getAt(proof.data, 'bht.ai.ollamaUrl')).toBe('http://oracle-sentinel.local:19999');
    expect(_getAt(proof.data, 'bht.ai.model')).toBe('oracle-model-sentinel');
    expect(_getAt(proof.data, 'bht.meta')).toMatchObject({ __oracle_marker__: 'bht-meta-sentinel', __oracle_note__: 'preserve-me' });
    // ADR-005 + PRV-0.5 Codex Round-7 P3: the historical source seeded
    // a literal sentinel `bht.ai.apiKey`. Migration MUST actively strip
    // it. Assert BOTH: (a) the key is not an own property of the
    // migrated `bht.ai`; (b) the sentinel string is not present as any
    // value anywhere under `bht.ai`.
    const ai = _getAt(proof.data, 'bht.ai') || {};
    expect(Object.prototype.hasOwnProperty.call(ai, 'apiKey'), 'bht.ai.apiKey MUST be stripped by migration (ADR-005 / Round-7 P3)').toBe(false);
    const aiStr = JSON.stringify(ai);
    expect(aiStr.indexOf('oracle-apiKey-sentinel-must-be-stripped-by-migration'), 'sentinel apiKey value MUST NOT survive under bht.ai').toBe(-1);
    // Telemetry sentinels
    expect(_getAt(proof.data, 'telemetry.accumulatedFatigue')).toBe(7777);
    expect(_getAt(proof.data, 'telemetry.weeklyShiftHours')).toBe(88.5);
    expect(_getAt(proof.data, 'telemetry.focusReserve')).toBe(33);
  });
}

// Local helper on the test side, mirrored for asserts.
function _getAtHelper(obj, path) { return _getAt(obj, path); }
