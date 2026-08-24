// Import/restore hardening regression. See docs/lifeos/SECURITY_REVIEW.md
// categories 4, 11, 12. Uses only synthetic in-page localStorage seeded per
// test; the smoke suite's beforeEach page.goto('/') resets storage on every
// test by loading a fresh Life OS page. We stub `window.confirm` and defer
// the post-restore reload so assertions can run against the settled state.

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

async function waitReady(page) {
  await page.waitForFunction(() =>
    typeof window.processImport === 'function' &&
    Array.isArray(window.BACKUP_KEYS || null) === false // BACKUP_KEYS is a top-level const, not on window; verified by processImport being wired
  ).catch(() => {});
  // processImport is declared as a top-level function in app.js, exposed via
  // being in the global script scope. Wait for it and for the domain seeder.
  await page.waitForFunction(() => typeof window.processImport === 'function');
}

// Helper installed into the page to stub confirm(), suppress the
// setTimeout-driven reload, and run processImport. Returns the boolean it
// returned and the resulting BACKUP_KEYS snapshot.
async function runImport(page, backupObj) {
  return page.evaluate((backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    // Any setTimeout ≥ 1000 ms is the reload; swallow it so the test browser
    // context stays alive for post-import assertions.
    window.setTimeout = (fn, delay) =>
      (delay && delay >= 1000) ? 0 : _st(fn, delay);
    try {
      const KEYS = [
        'dune_state_v4', 'dune_finance_v1', 'dune_sb_v1',
        'dune_goals_v1', 'dune_easa_v1',
        'dune_logbook_v1', 'dune_deadlines_ext_v1',
        'dune_apartments_v1', 'dune_logbook_entries_v1', 'dune_logbook_tab_v1',
        'dune_claims_v1'
      ];
      const ok = window.processImport(JSON.stringify(backup));
      const after = {};
      for (const k of KEYS) after[k] = localStorage.getItem(k);
      const pre = localStorage.getItem('dune_pre_import_backup_v1');
      const pat = localStorage.getItem('dune_github_token_v1');
      const evil = localStorage.getItem('evil_key');
      return { ok, after, pre, pat, evil };
    } finally {
      window.setTimeout = _st;
    }
  }, backupObj);
}

// Seed a minimal set of BACKUP_KEYS entries plus PAT + evil in localStorage
// so we can verify preservation/removal behaviour.
async function seed(page, entries) {
  await page.evaluate((seedMap) => {
    for (const [k, v] of Object.entries(seedMap)) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }, entries);
}

function validEnvelope(data) {
  return { version: '2026.1', exported_at: '2026-08-24T00:00:00Z', data };
}
// Minimal dune_state_v4 that passes the Store's validate() on reload —
// though reload is suppressed in these tests, keep the shape realistic.
function minState() {
  return { version: 11, data: { money: { salary_net: 100000 }, qatarVisit: {} } };
}

test('T1 — valid backup restores allowed keys and creates recovery snapshot', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_apartments_v1: [{ id: 'existing' }],
    dune_github_token_v1: 'ghp_test_pat_should_survive',
  });
  const backup = validEnvelope({
    dune_state_v4: minState(),
    dune_apartments_v1: [{ id: 'imported' }],
  });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(true);
  expect(JSON.parse(r.after.dune_apartments_v1)).toEqual([{ id: 'imported' }]);
  expect(JSON.parse(r.after.dune_state_v4)).toEqual(minState());
  expect(r.pat).toBe('ghp_test_pat_should_survive');
  expect(r.pre).not.toBeNull();
  const pre = JSON.parse(r.pre);
  expect(pre.version).toBe('2026.1');
  // Recovery snapshot captured pre-import apartments value.
  expect(pre.data.dune_apartments_v1).toEqual([{ id: 'existing' }]);
});

test('T2 — unknown key evil_key rejects entire import, zero writes, no reload', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_apartments_v1: [{ id: 'existing' }],
    dune_github_token_v1: 'ghp_test_pat',
    evil_key: null,
  });
  const backup = validEnvelope({
    dune_state_v4: minState(),
    evil_key: 'attacker payload',
  });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(false);
  expect(JSON.parse(r.after.dune_apartments_v1)).toEqual([{ id: 'existing' }]);
  expect(r.after.dune_state_v4).toBeNull();
  expect(r.evil).toBeNull();
  expect(r.pat).toBe('ghp_test_pat');
  // Preflight failed before recovery snapshot was written.
  expect(r.pre).toBeNull();
});

test('T2b — payload injecting dune_github_token_v1 is rejected', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, { dune_github_token_v1: 'ghp_original' });
  const backup = validEnvelope({
    dune_state_v4: minState(),
    dune_github_token_v1: 'ghp_attacker',
  });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(false);
  expect(r.pat).toBe('ghp_original');
  expect(r.after.dune_state_v4).toBeNull();
});

test('T3 — payload injecting dune_pre_import_backup_v1 is rejected', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_pre_import_backup_v1: { version: '2026.1', exported_at: 'orig', data: {} },
  });
  const backup = validEnvelope({
    dune_state_v4: minState(),
    dune_pre_import_backup_v1: { version: '2026.1', exported_at: 'attacker', data: {} },
  });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(false);
  // Original recovery capsule untouched.
  expect(JSON.parse(r.pre).exported_at).toBe('orig');
});

test('T4 — malformed payloads are no-ops', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, { dune_apartments_v1: [{ id: 'existing' }] });
  const cases = [
    null,
    [],
    { version: '2026.1', data: null },
    { version: '2026.1', data: [] },
    { version: '2026.1', data: {} },              // no known keys
    { version: 'bogus', data: { dune_state_v4: minState() } },
    { data: { dune_state_v4: minState() } },      // no version
  ];
  for (const badBackup of cases) {
    const r = await runImport(page, badBackup);
    expect(r.ok, `case ${JSON.stringify(badBackup)}`).toBe(false);
    expect(JSON.parse(r.after.dune_apartments_v1)).toEqual([{ id: 'existing' }]);
    expect(r.after.dune_state_v4).toBeNull();
    expect(r.pre).toBeNull();
  }
});

test('T5 — omitted allowed key is removed (no stale hybrid state)', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_apartments_v1: [{ id: 'stale' }],
    dune_goals_v1: { g1: { done: true } },
  });
  const backup = validEnvelope({
    dune_state_v4: minState(),
    dune_apartments_v1: [{ id: 'fresh' }],
    // dune_goals_v1 intentionally omitted from payload.
  });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(true);
  expect(JSON.parse(r.after.dune_apartments_v1)).toEqual([{ id: 'fresh' }]);
  // Omitted key removed to prevent hybrid state.
  expect(r.after.dune_goals_v1).toBeNull();
});

test('T6 — apply failure rolls back to byte-exact pre-import state', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_apartments_v1: [{ id: 'existing' }],
    dune_finance_v1: { russia: { salary: 100000 } },
  });
  // Monkey-patch setItem to succeed for the first BACKUP_KEYS write and
  // fail on the second, so at least one write is applied before the throw.
  const r = await page.evaluate((backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const origSet = localStorage.setItem.bind(localStorage);
    let count = 0;
    localStorage.setItem = function (k, v) {
      // Allow the pre-import recovery capsule write (dune_pre_import_backup_v1).
      // Fail the second BACKUP_KEYS write only.
      if (k === 'dune_pre_import_backup_v1') return origSet(k, v);
      count++;
      if (count === 2) throw new Error('simulated quota');
      return origSet(k, v);
    };
    try {
      const ok = window.processImport(JSON.stringify(backup));
      return {
        ok,
        apartments: localStorage.getItem('dune_apartments_v1'),
        finance: localStorage.getItem('dune_finance_v1'),
      };
    } finally {
      localStorage.setItem = origSet;
      window.setTimeout = _st;
    }
  }, validEnvelope({
    dune_state_v4: minState(),
    dune_apartments_v1: [{ id: 'new1' }],
    dune_finance_v1: { russia: { salary: 999999 } },
  }));
  expect(r.ok).toBe(false);
  // Byte-exact rollback of BACKUP_KEYS values.
  expect(JSON.parse(r.apartments)).toEqual([{ id: 'existing' }]);
  expect(JSON.parse(r.finance)).toEqual({ russia: { salary: 100000 } });
});

test('T7 — 2026.1 backup with only legacy keys still restores', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const backup = validEnvelope({
    dune_logbook_entries_v1: [{ id: 'e1', ata: '32' }],
    dune_logbook_tab_v1: 'entries',
  });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(true);
  expect(JSON.parse(r.after.dune_logbook_entries_v1)).toEqual([{ id: 'e1', ata: '32' }]);
  expect(JSON.parse(r.after.dune_logbook_tab_v1)).toEqual('entries');
});

test('T8 — GitHub PAT never touched by valid import', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, { dune_github_token_v1: 'ghp_untouchable' });
  const backup = validEnvelope({ dune_state_v4: minState() });
  const r = await runImport(page, backup);
  expect(r.ok).toBe(true);
  expect(r.pat).toBe('ghp_untouchable');
});

test('T9 — pending Store autosave race: stale in-memory Store cannot overwrite imported dune_state_v4', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  // Trigger a real Store mutation. This schedules the 300 ms debounced
  // persistNow — exactly the timer that used to overwrite imported state.
  await page.evaluate(() => {
    window.Store.set('money.salary_net', 130000);
  });
  const imported = { version: 11, data: { money: { salary_net: 222222 }, qatarVisit: {} } };
  const r = await page.evaluate(async (backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const ok = window.processImport(JSON.stringify(backup));
    // Wait past the original 300 ms debounce window to prove the pending
    // save was canceled/quiesced and did not fire.
    await new Promise(r => _st(r, 500));
    const raw = localStorage.getItem('dune_state_v4');
    const paused = window.Store.isPersistencePaused && window.Store.isPersistencePaused();
    window.setTimeout = _st;
    // Explicitly resume so the test process leaves Store in a clean state.
    if (window.Store.resumePersistence) window.Store.resumePersistence();
    return { ok, raw, paused };
  }, validEnvelope({ dune_state_v4: imported }));
  expect(r.ok).toBe(true);
  const parsed = JSON.parse(r.raw);
  expect(parsed.data.money.salary_net).toBe(222222);
  // On successful import, persistence stays paused through the reload window.
  expect(r.paused).toBe(true);
});

test('T10 — recovery-capsule write failure aborts before any restore mutation', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, { dune_apartments_v1: [{ id: 'orig' }] });
  const r = await page.evaluate((backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const origSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (k, v) {
      if (k === 'dune_pre_import_backup_v1') throw new Error('simulated quota on recovery');
      return origSet(k, v);
    };
    try {
      const ok = window.processImport(JSON.stringify(backup));
      return {
        ok,
        apartments: localStorage.getItem('dune_apartments_v1'),
        state: localStorage.getItem('dune_state_v4'),
        paused: window.Store.isPersistencePaused && window.Store.isPersistencePaused(),
      };
    } finally {
      localStorage.setItem = origSet;
      window.setTimeout = _st;
    }
  }, validEnvelope({
    dune_state_v4: minState(),
    dune_apartments_v1: [{ id: 'new' }],
  }));
  expect(r.ok).toBe(false);
  // No supported restore key was mutated.
  expect(JSON.parse(r.apartments)).toEqual([{ id: 'orig' }]);
  // Store persistence was never paused because we aborted before that step.
  expect(r.paused).toBe(false);
});

test('T11 — removeItem apply failure rolls back and resumes Store persistence', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_apartments_v1: [{ id: 'stale' }],  // will be removed (omitted from payload)
    dune_finance_v1: { russia: { salary: 100000 } },  // will be written
  });
  const r = await page.evaluate((backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (k) {
      if (k === 'dune_apartments_v1') throw new Error('simulated remove failure');
      return origRemove(k);
    };
    try {
      const ok = window.processImport(JSON.stringify(backup));
      return {
        ok,
        apartments: localStorage.getItem('dune_apartments_v1'),
        finance: localStorage.getItem('dune_finance_v1'),
        state: localStorage.getItem('dune_state_v4'),
        paused: window.Store.isPersistencePaused && window.Store.isPersistencePaused(),
      };
    } finally {
      localStorage.removeItem = origRemove;
      window.setTimeout = _st;
    }
  }, validEnvelope({
    dune_state_v4: minState(),
    dune_finance_v1: { russia: { salary: 999999 } },
    // dune_apartments_v1 omitted → import will removeItem it → will throw
  }));
  expect(r.ok).toBe(false);
  // All BACKUP_KEYS restored to pre-import values.
  expect(JSON.parse(r.apartments)).toEqual([{ id: 'stale' }]);
  expect(JSON.parse(r.finance)).toEqual({ russia: { salary: 100000 } });
  expect(r.state).toBeNull();
  // Store persistence was resumed after rollback.
  expect(r.paused).toBe(false);
});

test('T12 — early rollback failure does not abort rollback for later keys', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  // Seed both keys so rollback needs to setItem (not removeItem) both.
  await seed(page, {
    dune_finance_v1: { russia: { salary: 100000 } },
    dune_apartments_v1: [{ id: 'orig' }],
  });
  const r = await page.evaluate((backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const toasts = [];
    const origToast = window.showBackupToast;
    window.showBackupToast = (msg) => { toasts.push(String(msg)); };
    const origSet = localStorage.setItem.bind(localStorage);
    let applyCount = 0;
    let inRollback = false;
    localStorage.setItem = function (k, v) {
      if (k === 'dune_pre_import_backup_v1') return origSet(k, v);
      if (!inRollback) {
        applyCount++;
        // Payload writes 4 keys in BACKUP_KEYS order:
        //   state_v4, finance_v1, easa_v1 (throws), apartments_v1
        // With apply failure on the 3rd write (easa_v1), applied[] will be
        // [state_v4, finance_v1]. Rollback then iterates them in that
        // order. We fail rollback of the FIRST key (state_v4) and expect
        // rollback to continue and restore finance_v1.
        if (applyCount === 3) { inRollback = true; throw new Error('simulated apply failure'); }
        return origSet(k, v);
      }
      // Rollback phase: fail on the EARLIEST key so we prove continuation
      // reaches finance_v1. state_v4 was originally absent, so its rollback
      // is a removeItem, not a setItem — we can't intercept via setItem.
      // We therefore make the ORIGINAL raw value of state_v4 exist so
      // rollback uses setItem. See seed() above — but state_v4 isn't seeded.
      // Adjust by patching removeItem too.
      if (k === 'dune_finance_v1') return origSet(k, v);
      return origSet(k, v);
    };
    const origRemove = localStorage.removeItem.bind(localStorage);
    localStorage.removeItem = function (k) {
      if (inRollback && k === 'dune_state_v4') throw new Error('simulated rollback failure');
      return origRemove(k);
    };
    try {
      const ok = window.processImport(JSON.stringify(backup));
      return {
        ok,
        state: localStorage.getItem('dune_state_v4'),
        finance: localStorage.getItem('dune_finance_v1'),
        apartments: localStorage.getItem('dune_apartments_v1'),
        toasts,
        paused: window.Store.isPersistencePaused && window.Store.isPersistencePaused(),
      };
    } finally {
      localStorage.setItem = origSet;
      localStorage.removeItem = origRemove;
      window.showBackupToast = origToast;
      window.setTimeout = _st;
    }
  }, validEnvelope({
    dune_state_v4: minState(),
    dune_finance_v1: { russia: { salary: 999999 } },
    dune_easa_v1: { m1: { status: 'x' } },
    dune_apartments_v1: [{ id: 'new' }],
  }));
  expect(r.ok).toBe(false);
  // Early rollback failed → state_v4 remains as imported (not removed).
  expect(r.state).not.toBeNull();
  expect(JSON.parse(r.state)).toEqual(minState());
  // Rollback continued: finance_v1 restored byte-exact to its pre-import value.
  expect(JSON.parse(r.finance)).toEqual({ russia: { salary: 100000 } });
  // apartments_v1 was not in applied[] (apply threw before reaching it), so
  // its pre-import value is unchanged.
  expect(JSON.parse(r.apartments)).toEqual([{ id: 'orig' }]);
  // Failure was surfaced and named the failed rollback key.
  const incompleteToast = r.toasts.find(t => t.includes('rollback incomplete'));
  expect(incompleteToast, JSON.stringify(r.toasts)).toBeTruthy();
  expect(incompleteToast).toMatch(/dune_state_v4/);
  // Persistence resumed even after partial-rollback failure.
  expect(r.paused).toBe(false);
});

test('T13 — invalid known-key shapes rejected with zero mutations and no recovery capsule', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  await seed(page, {
    dune_apartments_v1: [{ id: 'existing' }],
    dune_pre_import_backup_v1: null,
  });
  const invalidCases = [
    { dune_state_v4: null },
    { dune_state_v4: 'not an object' },
    { dune_state_v4: { version: 11 } },       // missing .data
    { dune_apartments_v1: {} },                // object, not array
    { dune_logbook_tab_v1: [] },               // array, not string
    { dune_logbook_entries_v1: {} },           // object, not array
    { dune_finance_v1: null },
    { dune_finance_v1: [] },
  ];
  for (const badData of invalidCases) {
    const r = await runImport(page, validEnvelope(badData));
    expect(r.ok, `case ${JSON.stringify(badData)}`).toBe(false);
    // Existing state untouched.
    expect(JSON.parse(r.after.dune_apartments_v1)).toEqual([{ id: 'existing' }]);
    // No recovery capsule created because rejection happens in preflight.
    expect(r.pre).toBeNull();
  }
});

test('T14 — changed dune_state_v4 rolls back byte-exact on apply failure', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const originalStateBlob = JSON.stringify({ version: 11, data: { money: { salary_net: 111111 }, qatarVisit: {} } });
  await page.evaluate((blob) => {
    // Pause persistence so any pending Store save from module init cannot
    // overwrite our synthetic dune_state_v4 seed before processImport runs.
    // processImport will call resumePersistence on failure; on success it
    // stays paused through the reload window.
    if (window.Store && window.Store.pausePersistence) window.Store.pausePersistence();
    localStorage.setItem('dune_state_v4', blob);
  }, originalStateBlob);
  const r = await page.evaluate((backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);
    const origSet = localStorage.setItem.bind(localStorage);
    let count = 0;
    // Let recovery write and the first apply setItem (dune_state_v4) succeed,
    // then fail the second apply so rollback must restore dune_state_v4.
    localStorage.setItem = function (k, v) {
      if (k === 'dune_pre_import_backup_v1') return origSet(k, v);
      count++;
      if (count === 2) throw new Error('simulated');
      return origSet(k, v);
    };
    try {
      const ok = window.processImport(JSON.stringify(backup));
      return { ok, state: localStorage.getItem('dune_state_v4') };
    } finally {
      localStorage.setItem = origSet;
      window.setTimeout = _st;
    }
  }, validEnvelope({
    dune_state_v4: { version: 11, data: { money: { salary_net: 999999 }, qatarVisit: {} } },
    dune_apartments_v1: [{ id: 'new' }],
  }));
  expect(r.ok).toBe(false);
  // Byte-exact rollback of the raw dune_state_v4 value.
  expect(r.state).toBe(originalStateBlob);
});

test('T15 — failed import re-arms canceled pending Store save', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const r = await page.evaluate(async (backup) => {
    window.confirm = () => true;
    const _st = window.setTimeout;
    window.setTimeout = (fn, d) => (d && d >= 1000) ? 0 : _st(fn, d);

    // 1. Legitimate Store edit — schedules the 300 ms persistence debounce.
    window.Store.set('money.salary_net', 555555);

    // 2. Wire an apply-phase failure so import passes preflight, pauses
    //    persistence, then fails inside the destructive apply. Rollback
    //    runs and resumePersistence is called — which must re-arm the
    //    canceled save.
    const origSet = localStorage.setItem.bind(localStorage);
    let applyCount = 0;
    localStorage.setItem = function (k, v) {
      if (k === 'dune_pre_import_backup_v1') return origSet(k, v);
      applyCount++;
      if (applyCount === 2) throw new Error('simulated apply failure');
      return origSet(k, v);
    };
    let ok, pausedDuringApply, pausedAfter;
    try {
      // Assert pause actually happens during the flow.
      const origPause = window.Store.pausePersistence;
      window.Store.pausePersistence = function () {
        pausedDuringApply = true;
        return origPause.apply(this, arguments);
      };
      try {
        ok = window.processImport(JSON.stringify(backup));
      } finally {
        window.Store.pausePersistence = origPause;
      }
      pausedAfter = window.Store.isPersistencePaused();
    } finally {
      localStorage.setItem = origSet;
    }

    // 3. Wait past the debounce for the re-armed save to actually fire.
    await new Promise(r => _st(r, 500));
    const raw = localStorage.getItem('dune_state_v4');
    const stillPaused = window.Store.isPersistencePaused();
    window.setTimeout = _st;
    return { ok, pausedDuringApply, pausedAfter, stillPaused, raw };
  }, validEnvelope({
    dune_state_v4: { version: 11, data: { money: { salary_net: 777 }, qatarVisit: {} } },
    dune_apartments_v1: [{ id: 'imported' }],
  }));

  expect(r.ok).toBe(false);
  expect(r.pausedDuringApply).toBe(true);
  expect(r.pausedAfter).toBe(false);
  expect(r.stillPaused).toBe(false);
  // The re-armed save persisted the legitimate pre-import Store state
  // (salary_net=555555), NOT the imported one (777) which never landed.
  const parsed = JSON.parse(r.raw);
  expect(parsed.data.money.salary_net).toBe(555555);
});

test('T16 — mutation while paused persists exactly once after resume', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const r = await page.evaluate(async () => {
    const _st = window.setTimeout;
    // Wait past any pending post-load save so the counter starts clean.
    await new Promise(r => _st(r, 400));
    let saves = 0;
    const unsub = window.Store.onSave(() => { saves++; });
    try {
      window.Store.pausePersistence();
      window.Store.set('money.salary_net', 313131);
      // No save fires while paused, even past the debounce window.
      await new Promise(r => _st(r, 400));
      const savesWhilePaused = saves;
      const rawWhilePaused = localStorage.getItem('dune_state_v4');
      window.Store.resumePersistence();
      await new Promise(r => _st(r, 400));
      return {
        savesWhilePaused,
        savesAfterResume: saves,
        rawWhilePaused,
        rawAfterResume: localStorage.getItem('dune_state_v4'),
      };
    } finally {
      unsub();
    }
  });
  expect(r.savesWhilePaused).toBe(0);
  expect(r.savesAfterResume).toBe(1);
  // While paused, the new salary must not have been persisted.
  if (r.rawWhilePaused !== null) {
    const beforeResume = JSON.parse(r.rawWhilePaused);
    expect(beforeResume.data.money.salary_net).not.toBe(313131);
  }
  const afterResume = JSON.parse(r.rawAfterResume);
  expect(afterResume.data.money.salary_net).toBe(313131);
});

test('T17 — completed Store save is not re-armed by pause/resume', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const r = await page.evaluate(async () => {
    const _st = window.setTimeout;
    // Let any post-load Store save land so the counter starts from a clean
    // baseline — this test is about pause/resume, not module-init noise.
    await new Promise(r => _st(r, 400));
    let saves = 0;
    const unsub = window.Store.onSave(() => { saves++; });
    try {
      // 1. Real edit → debounce fires → save completes.
      window.Store.set('money.salary_net', 606060);
      await new Promise(r => _st(r, 400));
      const savesAfterFirstEdit = saves;
      const rawAfterFirstEdit = localStorage.getItem('dune_state_v4');
      // 2. Pause/resume with NO new Store mutation between them.
      //    Previously the completed timer handle left saveTimer non-null,
      //    so pause captured a false-positive "pending" flag and resume
      //    re-armed a redundant write. Now saveTimer is nulled by the
      //    debounce callback, so this pair must be a no-op.
      const rawBeforePauseResume = localStorage.getItem('dune_state_v4');
      window.Store.pausePersistence();
      window.Store.resumePersistence();
      await new Promise(r => _st(r, 400));
      return {
        savesAfterFirstEdit,
        savesAfterPauseResume: saves,
        rawAfterFirstEdit,
        rawBeforePauseResume,
        rawAfterPauseResume: localStorage.getItem('dune_state_v4'),
      };
    } finally {
      unsub();
    }
  });
  // Baseline: the real edit persisted exactly once.
  expect(r.savesAfterFirstEdit).toBe(1);
  const firstParsed = JSON.parse(r.rawAfterFirstEdit);
  expect(firstParsed.data.money.salary_net).toBe(606060);
  // Fix invariant: pause+resume with no mutation ⇒ zero additional saves,
  // and raw dune_state_v4 unchanged.
  expect(r.savesAfterPauseResume).toBe(1);
  expect(r.rawAfterPauseResume).toBe(r.rawBeforePauseResume);
});

test('T18 — genuine pending save resumes exactly once', async ({ page }) => {
  await page.goto('/');
  await waitReady(page);
  const r = await page.evaluate(async () => {
    const _st = window.setTimeout;
    // Drain any post-load save.
    await new Promise(r => _st(r, 400));
    let saves = 0;
    const unsub = window.Store.onSave(() => { saves++; });
    try {
      // 1. Mutate. Debounce is pending — do NOT wait past it.
      window.Store.set('money.salary_net', 707070);
      // 2. Pause BEFORE the debounce fires. This is the genuine
      //    "pending save" case — dirtyWhilePaused must be captured.
      window.Store.pausePersistence();
      // 3. Wait past the debounce; no save must fire because paused.
      await new Promise(r => _st(r, 400));
      const savesWhilePaused = saves;
      // 4. Resume — re-arm one save.
      window.Store.resumePersistence();
      await new Promise(r => _st(r, 400));
      return {
        savesWhilePaused,
        savesAfterResume: saves,
        raw: localStorage.getItem('dune_state_v4'),
      };
    } finally {
      unsub();
    }
  });
  expect(r.savesWhilePaused).toBe(0);
  expect(r.savesAfterResume).toBe(1);
  const parsed = JSON.parse(r.raw);
  expect(parsed.data.money.salary_net).toBe(707070);
});
