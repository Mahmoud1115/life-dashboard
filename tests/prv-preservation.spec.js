// PRV-0.5 Round 2 preservation-migration Playwright specs.
// See docs/lifeos/DECISIONS.md ADR-015 addendum #1.
//
// After Codex Round 2's HIGH-risk review, migration authority moved
// INSIDE the coordinated wrapper (schema 14) as
// `data.meta.recordsMigration = { status: 'migrated' | 'unmigrated', ... }`.
// The prior out-of-band Gen-1 sticky flag `dune_records_hydrated_v1`
// was removed — it could survive a durability failure and permanently
// skip migration.
//
// Every test spins the app in an isolated Playwright context; real
// user localStorage is never touched. Each test names precisely the
// property it exercises. No test overstates what it proves.

const { test, expect } = require('@playwright/test');

const EXPECTED_BLOCKED_URL = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//;
const GITHUB_ORIGIN = /^https?:\/\/api\.github\.com\//;
const APP_GITHUB_COMMITS_PATH = '/repos/Mahmoud1115/life-dashboard/commits';
const SYNTHETIC_COMMIT_ISO = '2026-08-25T00:00:00Z';

function isAppExpectedGithubCommitsRequest(rawUrl) {
  let parsed;
  try { parsed = new URL(rawUrl); } catch (_) { return false; }
  if (parsed.pathname !== APP_GITHUB_COMMITS_PATH) return false;
  if (parsed.searchParams.get('per_page') !== '1') return false;
  return Array.from(parsed.searchParams.keys()).length === 1;
}

async function routeSyntheticContext(context) {
  await context.route(EXPECTED_BLOCKED_URL, (route) => route.abort());
  await context.route(GITHUB_ORIGIN, (route) => {
    if (!isAppExpectedGithubCommitsRequest(route.request().url())) return route.abort();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ commit: { author: { date: SYNTHETIC_COMMIT_ISO } } }])
    });
  });
}

test.beforeEach(async ({ context }) => { await routeSyntheticContext(context); });

async function waitForApp(page) {
  await page.waitForFunction(() =>
    !!(window.Store && typeof window.Store.get === 'function' &&
       window.LEGACY_RECORDS && typeof window.hydratePreservationRecordsOnce === 'function'));
}

async function waitForNextSave(page) {
  await page.evaluate(() => new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; try { unsub(); } catch (e) {} resolve(); };
    const unsub = window.Store.onSave(finish);
    setTimeout(finish, 2000);
  }));
}

async function waitForMigrated(page, timeoutMs) {
  await page.waitForFunction(() => {
    const m = window.Store.get('meta.recordsMigration');
    return m && m.status === 'migrated';
  }, {}, { timeout: timeoutMs || 5000 });
}

// A pre-PRV schema-13 wrapper the app must accept + migrate on load.
function seedV13Wrapper(page, extra) {
  return page.addInitScript((extraArg) => {
    const nowIso = new Date().toISOString();
    // Minimal v13-shaped wrapper. The core.js validate() gate only
    // requires money.salary_net + qatarVisit, so a lean v13 data block
    // suffices to prove the migration path end-to-end.
    const data = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''],
      goals: {},
      career: { started: '', company: '', position: '', aircraft: [], engines: [], licenses: [], certificates: [], milestones: [] },
      easa: {},
      logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
      reviews: [],
      decisions: [],
      timeline: [],
      about: { version: 2, createdAt: '', lastUpdated: '', strengths: [], lessons: [], vision: '', values: [], reminders: [] },
      apartments: [],
      sbTasks: {},
      bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 },
      ideas: [],
      meta: { version: 13, createdAt: nowIso, lastUpdated: nowIso }
    };
    if (extraArg && extraArg.goalsOv) {
      try { localStorage.setItem('dune_goals_v1', JSON.stringify(extraArg.goalsOv)); } catch (e) {}
    }
    if (extraArg && extraArg.claimsOv) {
      try { localStorage.setItem('dune_claims_v1', JSON.stringify(extraArg.claimsOv)); } catch (e) {}
    }
    try {
      const wrapper = { version: 13, revision: 1, committedAt: nowIso, data: data };
      localStorage.setItem('dune_state_v4', JSON.stringify(wrapper));
    } catch (e) {}
  }, extra || null);
}

// ────────────────────────────────────────────────────────
// PRV-R2-FRESH-DEFAULT — fresh browser boots at schema 14 with
// status='migrated' + empty records. Legacy corpus CANNOT resurrect
// on a fresh browser under the new default; hydration is a no-op.
// ────────────────────────────────────────────────────────
test('PRV-R2-FRESH-DEFAULT — fresh browser has schema 14 + status=migrated + empty records; hydration is a no-op', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    const marker = window.Store.get('meta.recordsMigration');
    const domains = ['deadlines','claims','risks','goals'];
    const counts = {}; for (const d of domains) counts[d] = (window.Store.get('records.'+d) || []).length;
    const res = await window.hydratePreservationRecordsOnce();
    let persisted = null;
    try { persisted = JSON.parse(localStorage.getItem('dune_state_v4') || 'null'); } catch (e) {}
    const stickyFlag = localStorage.getItem('dune_records_hydrated_v1');
    return { marker, counts, res, wrapperVersion: persisted && persisted.version, stickyFlag };
  });
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.marker && proof.marker.status).toBe('migrated');
  expect(proof.counts.deadlines).toBe(0);
  expect(proof.counts.claims).toBe(0);
  expect(proof.counts.risks).toBe(0);
  expect(proof.counts.goals).toBe(0);
  expect(proof.res && proof.res.ok).toBe(true);
  expect(proof.res.skipped).toBe('already-migrated');
  // The Round 1 sticky flag must NOT be written under the new design.
  expect(proof.stickyFlag).toBeNull();
});

// ────────────────────────────────────────────────────────
// PRV-R2-V13-HYDRATE — a real v13 wrapper migrates up, hydration
// runs and durably persists all four domains + a migrated marker.
// This proves the boot-time migration path end-to-end.
// ────────────────────────────────────────────────────────
test('PRV-R2-V13-HYDRATE — v13 wrapper triggers hydration; records + migrated marker durably persist', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page, 5000);
  // The onSave-driven hydration issues a second wrapper commit; wait
  // once more so we can re-read localStorage and prove durability.
  await waitForNextSave(page);
  const proof = await page.evaluate(() => {
    const seed = window.LEGACY_RECORDS;
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4') || 'null');
    const pData = persisted && persisted.data;
    const pRecords = pData && pData.records;
    const pMarker = pData && pData.meta && pData.meta.recordsMigration;
    return {
      wrapperVersion: persisted && persisted.version,
      persistedMarker: pMarker,
      persistedDeadlines: (pRecords && pRecords.deadlines || []).length,
      persistedClaims: (pRecords && pRecords.claims || []).length,
      persistedRisks: (pRecords && pRecords.risks || []).length,
      persistedGoals: (pRecords && pRecords.goals || []).length,
      seedDeadlines: seed.deadlines.length,
      seedClaims: seed.claims.length,
      seedRisks: seed.risks.length,
      seedGoals: seed.goals.length,
      // Risks got their computed score.
      allRisksScored: (pRecords && Array.isArray(pRecords.risks)) && pRecords.risks.every(r => typeof r.score === 'number' && r.score === (r.prob || 0) * (r.impact || 0)),
      // Legacy sticky flag stayed absent.
      stickyFlag: localStorage.getItem('dune_records_hydrated_v1')
    };
  });
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.persistedMarker && proof.persistedMarker.status).toBe('migrated');
  expect(proof.persistedDeadlines).toBe(proof.seedDeadlines);
  expect(proof.persistedClaims).toBe(proof.seedClaims);
  expect(proof.persistedRisks).toBe(proof.seedRisks);
  expect(proof.persistedGoals).toBe(proof.seedGoals);
  expect(proof.allRisksScored).toBe(true);
  expect(proof.stickyFlag).toBeNull();
});

// ────────────────────────────────────────────────────────
// PRV-R2-V13-OVERRIDES — pre-PRV per-id overrides in dune_goals_v1
// and dune_claims_v1 survive hydration merge.
// ────────────────────────────────────────────────────────
test('PRV-R2-V13-OVERRIDES — legacy per-id overrides survive hydration merge', async ({ page }) => {
  await seedV13Wrapper(page, {
    goalsOv: { go01: { progress: 77, status: 'blocked' } },
    claimsOv: { cl01: { confidence: 'dangerous', lastChecked: '2026-08-01' } }
  });
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(() => {
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4'));
    const goals = persisted.data.records.goals;
    const claims = persisted.data.records.claims;
    const g = goals.find(x => x.id === 'go01');
    const c = claims.find(x => x.id === 'cl01');
    return {
      goalProgress: g && g.progress,
      goalStatus: g && g.status,
      claimConfidence: c && c.confidence,
      claimChecked: c && c.lastChecked
    };
  });
  expect(proof.goalProgress).toBe(77);
  expect(proof.goalStatus).toBe('blocked');
  expect(proof.claimConfidence).toBe('dangerous');
  expect(proof.claimChecked).toBe('2026-08-01');
});

// ────────────────────────────────────────────────────────
// PRV-R2-EMPTY-STATE — an intentionally-empty migrated state is
// distinguishable from unmigrated. Deleting all goals leaves
// records.goals=[] AND status='migrated'; subsequent hydration
// invocations skip. Legacy records CANNOT resurrect.
// ────────────────────────────────────────────────────────
test('PRV-R2-EMPTY-STATE — records.goals=[] with status=migrated is preserved; hydration skips', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    // Simulate the user deleting all goals through the writer path.
    const setRes = window.Store.set('records.goals', []);
    // Wait for durability so the persisted wrapper shows the empty array.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
    const persistedAfter = JSON.parse(localStorage.getItem('dune_state_v4'));
    const rerun = await window.hydratePreservationRecordsOnce();
    const persistedFinal = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      setOk: setRes && setRes.ok,
      afterUserDeleteGoalsLen: persistedAfter.data.records.goals.length,
      afterUserDeleteMarker: persistedAfter.data.meta.recordsMigration,
      rerunResult: rerun,
      finalGoalsLen: persistedFinal.data.records.goals.length,
      finalMarker: persistedFinal.data.meta.recordsMigration
    };
  });
  expect(proof.setOk).toBe(true);
  expect(proof.afterUserDeleteGoalsLen).toBe(0);
  expect(proof.afterUserDeleteMarker && proof.afterUserDeleteMarker.status).toBe('migrated');
  expect(proof.rerunResult && proof.rerunResult.ok).toBe(true);
  expect(proof.rerunResult.skipped).toBe('already-migrated');
  // Rehydration was a no-op; goals stayed empty; legacy DID NOT resurrect.
  expect(proof.finalGoalsLen).toBe(0);
  expect(proof.finalMarker && proof.finalMarker.status).toBe('migrated');
});

// ────────────────────────────────────────────────────────
// PRV-R2-RESET-SAFETY — Store.reset() commits defaultState()
// (schema 14 with status='migrated' + empty records). Hydration is a
// no-op post-Reset. Legacy personal records CANNOT resurrect.
// ────────────────────────────────────────────────────────
test('PRV-R2-RESET-SAFETY — Reset produces empty migrated records; hydration does not resurrect legacy', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    const preGoalsLen = (window.Store.get('records.goals') || []).length;
    // Drive Reset via the public API. Store.reset returns boolean
    // and fires an onSave listener when durability settles.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      const ok = window.Store.reset({ force: true });
      if (!ok) finish();
      setTimeout(finish, 3000);
    });
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4'));
    // Explicit re-invoke to prove hydration does NOT reseed after Reset.
    const rerun = await window.hydratePreservationRecordsOnce();
    const persistedFinal = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      preGoalsLen,
      postResetGoalsLen: persisted.data.records.goals.length,
      postResetMarker: persisted.data.meta.recordsMigration,
      rerunResult: rerun,
      finalGoalsLen: persistedFinal.data.records.goals.length
    };
  });
  expect(proof.preGoalsLen).toBeGreaterThan(0);
  expect(proof.postResetGoalsLen).toBe(0);
  expect(proof.postResetMarker && proof.postResetMarker.status).toBe('migrated');
  expect(proof.rerunResult && proof.rerunResult.ok).toBe(true);
  expect(proof.rerunResult.skipped).toBe('already-migrated');
  expect(proof.finalGoalsLen).toBe(0);
});

// ────────────────────────────────────────────────────────
// PRV-R2-DURABILITY-FAILURE — force the wrapper write to fail after
// hydration enqueues its ops. The migration marker MUST NOT flip to
// 'migrated', and a retry after failure removal MUST complete.
// This is the P1-A defect from the Codex Round 2 review.
// ────────────────────────────────────────────────────────
test('PRV-R2-DURABILITY-FAILURE — Store.set failure keeps marker unmigrated; retry succeeds', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    // Suspend the boot-time onSave auto-retry so it does not race with
    // the test's own hydration invocations. Production always leaves
    // this enabled; the toggle exists only for deterministic tests.
    window.__prv05HydrationAutoRetryEnabled = false;
    // Roll the marker BACK to unmigrated via the same Store writer
    // (simulating either a fresh v13 boot that has not yet completed,
    // or a post-import wrapper). Then break Store.set for the marker
    // path so hydration cannot flip it forward.
    const rollbackMarker = window.Store.set('meta.recordsMigration', { status: 'unmigrated', schemaVersion: 14, reason: 'test-rollback' });
    // Wait for the rollback commit to durably land so the injected
    // failure applies to the retry attempt, not to a stale in-flight write.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
    const realSet = window.Store.set;
    let markerSetCalls = 0;
    window.Store.set = function (path, val) {
      if (path === 'meta.recordsMigration' && val && val.status === 'migrated') {
        markerSetCalls++;
        return { ok: false, error: 'INJECTED_FAILURE' };
      }
      return realSet.call(window.Store, path, val);
    };
    const firstAttempt = await window.hydratePreservationRecordsOnce();
    const persistedAfterFail = JSON.parse(localStorage.getItem('dune_state_v4'));
    // Restore Store.set and retry.
    window.Store.set = realSet;
    const secondAttempt = await window.hydratePreservationRecordsOnce();
    const persistedAfterSuccess = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      rollbackOk: !!(rollbackMarker && rollbackMarker.ok),
      firstAttempt,
      failMarker: persistedAfterFail.data.meta.recordsMigration,
      failGoalsLen: persistedAfterFail.data.records.goals.length,
      secondAttempt,
      finalMarker: persistedAfterSuccess.data.meta.recordsMigration,
      finalGoalsLen: persistedAfterSuccess.data.records.goals.length,
      markerFailedSetCalls: markerSetCalls
    };
  });
  expect(proof.rollbackOk).toBe(true);
  // First attempt failed on the marker set; the marker MUST stay unmigrated.
  expect(proof.firstAttempt.ok).toBe(false);
  expect(proof.firstAttempt.reason).toBe('set-marker-failed');
  expect(proof.failMarker && proof.failMarker.status).toBe('unmigrated');
  // Retry after restoration succeeds.
  expect(proof.secondAttempt.ok).toBe(true);
  expect(proof.finalMarker && proof.finalMarker.status).toBe('migrated');
  expect(proof.finalGoalsLen).toBeGreaterThan(0);
});

// ────────────────────────────────────────────────────────
// PRV-R2-DURABILITY-VERIFY-REREAD — even if Store.set returns ok,
// hydration re-reads the persisted wrapper to verify durability. If
// the wrapper is missing records or the marker post-flush, hydration
// reports failure and the marker stays unmigrated.
// ────────────────────────────────────────────────────────
test('PRV-R2-DURABILITY-VERIFY-REREAD — hydration verifies persisted wrapper before reporting success', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    // Force marker back to unmigrated for a clean retry.
    window.__prv05HydrationAutoRetryEnabled = false;
    window.Store.set('meta.recordsMigration', { status: 'unmigrated', schemaVersion: 14, reason: 'test-rollback' });
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
    // Patch localStorage.getItem so hydration's post-commit re-read
    // sees a wrapper with a stale (unmigrated) marker even though the
    // in-memory Store believes the commit landed.
    const realGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      if (k === 'dune_state_v4') {
        const raw = realGetItem.call(this, k);
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.data && parsed.data.meta && parsed.data.meta.recordsMigration) {
            parsed.data.meta.recordsMigration = { status: 'unmigrated', schemaVersion: 14, reason: 'test-strip' };
            return JSON.stringify(parsed);
          }
        } catch (e) {}
        return raw;
      }
      return realGetItem.call(this, k);
    };
    const res = await window.hydratePreservationRecordsOnce();
    Storage.prototype.getItem = realGetItem;
    return { res };
  });
  expect(proof.res.ok).toBe(false);
  expect(proof.res.reason).toBe('durability-verification-failed');
});

// ────────────────────────────────────────────────────────
// PRV-R2-CROSS-TAB-DURABILITY — cross-tab flag-before-durability
// regression. Tab A's hydration marker-set fails; Tab B boots and
// observes the unmigrated marker, then completes hydration itself.
// Tab B MUST NOT treat the migration as complete based on any
// out-of-band signal (the sticky flag no longer exists).
// ────────────────────────────────────────────────────────
test('PRV-R2-CROSS-TAB-DURABILITY — Tab B does not treat migration as complete when Tab A failed', async ({ context }) => {
  const a = await context.newPage();
  await seedV13Wrapper(a, {});
  await a.goto('/');
  await waitForApp(a);
  await waitForMigrated(a);
  await waitForNextSave(a);
  // Tab A: roll marker back and break marker-set. Fail attempt persists
  // records but leaves marker unmigrated.
  await a.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    window.Store.set('meta.recordsMigration', { status: 'unmigrated', schemaVersion: 14, reason: 'test-cross-tab' });
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
    const realSet = window.Store.set;
    window.Store.set = function (path, val) {
      if (path === 'meta.recordsMigration' && val && val.status === 'migrated') {
        return { ok: false, error: 'INJECTED_FAILURE' };
      }
      return realSet.call(window.Store, path, val);
    };
    await window.hydratePreservationRecordsOnce();
    window.Store.set = realSet;
  });
  // Tab A's post-fail localStorage: marker unmigrated.
  const aPostFail = await a.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    return p.data.meta.recordsMigration && p.data.meta.recordsMigration.status;
  });
  expect(aPostFail).toBe('unmigrated');
  await a.close();

  // Tab B boots on the same localStorage.
  const b = await context.newPage();
  await b.goto('/');
  await waitForApp(b);
  // Tab B's hydration should detect status='unmigrated' and re-run.
  await waitForMigrated(b, 5000);
  await waitForNextSave(b);
  const bProof = await b.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      status: p.data.meta.recordsMigration && p.data.meta.recordsMigration.status,
      goalsLen: (p.data.records.goals || []).length
    };
  });
  expect(bProof.status).toBe('migrated');
  expect(bProof.goalsLen).toBeGreaterThan(0);
});

// ────────────────────────────────────────────────────────
// PRV-R2-IMPORT-PRE-PRV — a pre-PRV (v13) backup imported through the
// PRODUCTION processImport() function is migration-aware. The imported
// wrapper carries status='unmigrated' after migrateUp; the onSave
// listener re-triggers hydration and the final persisted state is
// schema 14 with records populated + status='migrated'.
// ────────────────────────────────────────────────────────
test('PRV-R2-IMPORT-PRE-PRV — production processImport() of a v13 backup ends up migrated with records populated', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  // Prepare a v13-shaped backup with legacy per-id override keys.
  const backupText = await page.evaluate(() => {
    const nowIso = new Date().toISOString();
    const v13data = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''],
      goals: {},
      career: { started: '', company: '', position: '', aircraft: [], engines: [], licenses: [], certificates: [], milestones: [] },
      easa: {},
      logbook: [],
      reviews: [],
      decisions: [],
      timeline: [],
      about: { version: 2, createdAt: '', lastUpdated: '', strengths: [], lessons: [], vision: '', values: [], reminders: [] },
      apartments: [],
      sbTasks: {},
      bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 },
      ideas: [],
      meta: { version: 13, createdAt: nowIso, lastUpdated: nowIso }
    };
    const wrapper = { version: 13, revision: 1, committedAt: nowIso, data: v13data };
    const backup = {
      version: '2026.1',
      exported_at: nowIso,
      data: {
        dune_state_v4: wrapper,
        dune_goals_v1: { go01: { progress: 42, status: 'active' } },
        dune_claims_v1: { cl02: { confidence: 'uncertain', lastChecked: '2026-07-15' } }
      }
    };
    return JSON.stringify(backup);
  });
  // Auto-accept the destructive-import confirm() prompt.
  page.on('dialog', (d) => d.accept());
  // processImport schedules `location.reload()` 1.2s after success in
  // production. Run the import AND the post-import hydration + read
  // inside a single evaluate so the reload's context destruction
  // cannot race the assertions.
  const proof = await page.evaluate(async (text) => {
    const importOk = await window.processImport(text);
    // Force-drive the hydration synchronously so we do not depend on
    // the fire-and-forget onSave auto-retry timing.
    const hydrateResult = await window.hydratePreservationRecordsOnce();
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    const g = p.data.records.goals.find(x => x.id === 'go01');
    const c = p.data.records.claims.find(x => x.id === 'cl02');
    return {
      importOk,
      hydrateResult,
      wrapperVersion: p.version,
      status: p.data.meta.recordsMigration && p.data.meta.recordsMigration.status,
      deadlinesLen: p.data.records.deadlines.length,
      claimsLen: p.data.records.claims.length,
      risksLen: p.data.records.risks.length,
      goalsLen: p.data.records.goals.length,
      go01Progress: g && g.progress,
      go01Status: g && g.status,
      cl02Confidence: c && c.confidence
    };
  }, backupText);
  expect(proof.importOk).toBe(true);
  expect(proof.hydrateResult && proof.hydrateResult.ok).toBe(true);
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.status).toBe('migrated');
  expect(proof.deadlinesLen).toBeGreaterThan(0);
  expect(proof.claimsLen).toBeGreaterThan(0);
  expect(proof.risksLen).toBeGreaterThan(0);
  expect(proof.goalsLen).toBeGreaterThan(0);
  // Per-id overrides from the pre-PRV backup survived the migration.
  expect(proof.go01Progress).toBe(42);
  expect(proof.go01Status).toBe('active');
  expect(proof.cl02Confidence).toBe('uncertain');
});

// ────────────────────────────────────────────────────────
// PRV-R2-RESTORE-WITHOUT-LEGACY — a post-migration backup is restored
// into a fresh browser where LEGACY_RECORDS has been NEUTRALIZED
// (emptied). The wrapper alone must reconstruct all four domains.
// This is the key PRV-1 prerequisite Codex asked for — legacy source
// truly unavailable, not just seeded around.
// ────────────────────────────────────────────────────────
test('PRV-R2-RESTORE-WITHOUT-LEGACY — restore reconstructs records with LEGACY_RECORDS neutralized', async ({ context }) => {
  // Boot A on a v13 wrapper, hydrate, wait for durability, capture backup.
  const a = await context.newPage();
  await seedV13Wrapper(a, {});
  await a.goto('/');
  await waitForApp(a);
  await waitForMigrated(a);
  await waitForNextSave(a);
  const backupText = await a.evaluate(() => {
    // Call the production exporter equivalent.
    const bd = window.getAllBackupData();
    const backup = { version: '2026.1', exported_at: new Date().toISOString(), data: bd };
    return JSON.stringify(backup);
  });
  await a.close();

  // Fresh context. Before app.js loads, neutralize LEGACY_RECORDS.
  const fresh = await context.browser().newContext();
  await routeSyntheticContext(fresh);
  const b = await fresh.newPage();
  await b.addInitScript(() => {
    // Overwrite LEGACY_RECORDS with an EMPTY object as soon as it is
    // defined by _migration-legacy-records.js. Assignment beats freeze
    // at the outer binding — the file's `try { Object.freeze(...) }`
    // freezes the inner arrays but does not seal `window.LEGACY_RECORDS`.
    // If a future rev seals the whole object, this init script will
    // fail visibly and the test will surface it.
    Object.defineProperty(window, 'LEGACY_RECORDS', {
      configurable: true,
      get() { return { deadlines: [], claims: [], risks: [], goals: [] }; },
      set() { /* absorb */ }
    });
  });
  b.on('dialog', (d) => d.accept());
  await b.goto('/');
  await b.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function' && typeof window.processImport === 'function'));
  // processImport schedules `location.reload()` 1.2s after success in
  // production. To keep the test's execution context alive so we can
  // read localStorage post-import, capture the persisted wrapper INSIDE
  // the same evaluate as the import call — before the 1.2s timer fires.
  const proof = await b.evaluate(async (text) => {
    const ok = await window.processImport(text);
    // Read the persisted state immediately; the wrapper commit landed
    // synchronously via commitFullStateWrapper inside processImport
    // before it returned.
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      importOk: ok,
      wrapperVersion: p && p.version,
      status: p && p.data && p.data.meta && p.data.meta.recordsMigration && p.data.meta.recordsMigration.status,
      deadlinesLen: p && p.data && p.data.records && (p.data.records.deadlines || []).length,
      claimsLen: p && p.data && p.data.records && (p.data.records.claims || []).length,
      risksLen: p && p.data && p.data.records && (p.data.records.risks || []).length,
      goalsLen: p && p.data && p.data.records && (p.data.records.goals || []).length,
      seedIsEmpty: window.LEGACY_RECORDS.goals.length === 0
    };
  }, backupText);
  expect(proof.importOk).toBe(true);
  await fresh.close();
  expect(proof.seedIsEmpty).toBe(true);
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.status).toBe('migrated');
  expect(proof.deadlinesLen).toBeGreaterThan(0);
  expect(proof.claimsLen).toBeGreaterThan(0);
  expect(proof.risksLen).toBeGreaterThan(0);
  expect(proof.goalsLen).toBeGreaterThan(0);
});

// ────────────────────────────────────────────────────────
// PRV-R2-READER-CUTOVER — the D.deadlines / .goals / .claims / .risks
// runtime accessors read from the Store, not from LEGACY_RECORDS.
// After hydration, mutating LEGACY_RECORDS in-place has no effect on
// what the app renders.
// ────────────────────────────────────────────────────────
test('PRV-R2-READER-CUTOVER — D.* accessors read from Store, not from LEGACY_RECORDS', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  const proof = await page.evaluate(() => {
    const D_ref = (typeof D !== 'undefined') ? D : null;
    const cur = window.Store.get('records.goals');
    const nextFirst = Object.assign({}, cur[0], { progress: 91, status: 'done' });
    const setRes = window.Store.set('records.goals', [nextFirst, ...cur.slice(1)]);
    // Try to poison the seed — the accessor MUST NOT use it.
    try { window.LEGACY_RECORDS.goals[0].progress = -999; } catch (e) { /* frozen */ }
    return {
      setOk: !!(setRes && setRes.ok),
      dFirstProgress: (D_ref && D_ref.goals && D_ref.goals[0] && D_ref.goals[0].progress),
      seedIsFrozen: Object.isFrozen(window.LEGACY_RECORDS.goals)
    };
  });
  expect(proof.setOk).toBe(true);
  expect(proof.dFirstProgress).toBe(91);
});
