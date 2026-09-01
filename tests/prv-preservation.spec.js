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
  // R3: fresh cold-boot (persisted absent + in-memory defaultState
  // canonical migrated) reports 'default-state-migrated'. Post-first-
  // save it becomes 'already-migrated'. Either is a valid skip.
  expect(['default-state-migrated', 'already-migrated']).toContain(proof.res.skipped);
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

// ────────────────────────────────────────────────────────
// PRV-R3-REAL-DURABLE-FAILURE-P1-1 — the Codex Round-3 P1-1
// reproduction. When the REAL durable `dune_state_v4` write fails
// (Storage.prototype.setItem patched to throw on that key),
// optimistic in-memory Store can hold `migrated` while persisted
// disk stays `unmigrated`. A same-tab retry MUST re-check disk (not
// optimistic memory) and complete the migration.
// ────────────────────────────────────────────────────────
test('PRV-R3-REAL-DURABLE-FAILURE-P1-1 — real dune_state_v4 write failure keeps disk unmigrated; same-tab retry converges', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    // Suspend the boot-time onSave auto-retry so the test controls timing.
    window.__prv05HydrationAutoRetryEnabled = false;
    // Roll marker back to unmigrated on disk via a normal Store write.
    window.Store.set('meta.recordsMigration', { status: 'unmigrated', schemaVersion: 14, reason: 'test-r3-reset' });
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
    // Patch localStorage.setItem so every future dune_state_v4 write
    // fails at the durable boundary — mirrors a quota / write error
    // in production. In-memory Store enqueues succeed; the flush
    // that would persist them throws.
    const realSetItem = Storage.prototype.setItem;
    let dropCount = 0;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'dune_state_v4') {
        dropCount++;
        throw new DOMException('QuotaExceededError test injection', 'QuotaExceededError');
      }
      return realSetItem.call(this, k, v);
    };
    const firstAttempt = await window.hydratePreservationRecordsOnce();
    // Persisted disk should still be unmigrated (write failures blocked
    // the flush); optimistic in-memory Store may claim migrated.
    const persistedAfterFail = JSON.parse(realSetItem === Storage.prototype.setItem ? localStorage.getItem('dune_state_v4') : (function(){
      // Peek at localStorage bypassing our patch (patch only blocks setItem, not getItem).
      return localStorage.getItem('dune_state_v4');
    })());
    const inMemAfterFail = window.Store.get('meta.recordsMigration');
    // Remove the injection and retry in the SAME TAB.
    Storage.prototype.setItem = realSetItem;
    const secondAttempt = await window.hydratePreservationRecordsOnce();
    // Wait for the retry's durable commit to land.
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
    const persistedAfterSuccess = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      dropCount,
      firstAttempt,
      failMarker: persistedAfterFail && persistedAfterFail.data && persistedAfterFail.data.meta && persistedAfterFail.data.meta.recordsMigration,
      failGoalsLen: (persistedAfterFail && persistedAfterFail.data && persistedAfterFail.data.records && persistedAfterFail.data.records.goals || []).length,
      inMemAfterFail,
      secondAttempt,
      finalMarker: persistedAfterSuccess.data.meta.recordsMigration,
      finalGoalsLen: persistedAfterSuccess.data.records.goals.length
    };
  });
  // Real dune_state_v4 writes DID hit the injection.
  expect(proof.dropCount).toBeGreaterThan(0);
  // First attempt reported failure (durability verification detected
  // that the disk didn't move).
  expect(proof.firstAttempt.ok).toBe(false);
  expect(proof.firstAttempt.reason).toBe('durability-verification-failed');
  // Persisted disk unchanged: still unmigrated.
  expect(proof.failMarker && proof.failMarker.status).toBe('unmigrated');
  // SAME-TAB retry succeeded (early-check reads from disk, sees
  // unmigrated, ignores stale optimistic memory).
  expect(proof.secondAttempt.ok).toBe(true);
  expect(proof.finalMarker && proof.finalMarker.status).toBe('migrated');
  expect(proof.finalGoalsLen).toBeGreaterThan(0);
});

// ────────────────────────────────────────────────────────
// PRV-R3-PARTIAL-MIGRATED-IMPORT-P1-2 — Codex Round-3 P1-2
// reproduction. A schema-14 wrapper claiming migrated but missing
// `records.goals` must be REJECTED by production processImport()
// BEFORE it can overwrite the current good state.
// ────────────────────────────────────────────────────────
test('PRV-R3-PARTIAL-MIGRATED-IMPORT-P1-2 — processImport rejects schema-14 migrated wrapper with missing records.goals; good state preserved', async ({ page }) => {
  // Fresh browser: defaultState v14, status='migrated', empty records.
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  // Baseline: write a distinctive marker into an unrelated Store path so
  // we can prove import did NOT commit any state change on rejection.
  await page.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    window.Store.set('goals.__partial_import_witness__', 'ORIGINAL');
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 2000);
    });
  });
  const proof = await page.evaluate(async () => {
    // Build a malformed schema-14 backup: status='migrated' but
    // records.goals missing (only three of the four required arrays).
    const nowIso = new Date().toISOString();
    const malformedData = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''], goals: {}, career: { started: '', company: '', position: '', aircraft: [], engines: [], licenses: [], certificates: [], milestones: [] },
      easa: {}, logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
      reviews: [], decisions: [], timeline: [], about: { version: 2, createdAt: '', lastUpdated: '', strengths: [], lessons: [], vision: '', values: [], reminders: [] },
      apartments: [], sbTasks: {}, bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
      // Partial records — deadlines/claims/risks present, GOALS OMITTED.
      records: { deadlines: [], claims: [], risks: [] },
      meta: {
        version: 14, createdAt: nowIso, lastUpdated: nowIso,
        // Claims migrated but the shape is malformed.
        recordsMigration: { status: 'migrated', schemaVersion: 14, at: nowIso, reason: 'test-partial' }
      }
    };
    const wrapper = { version: 14, revision: 42, committedAt: nowIso, data: malformedData };
    const backup = { version: '2026.1', exported_at: nowIso, data: { dune_state_v4: wrapper } };
    const backupText = JSON.stringify(backup);
    // Neutralize the reload.
    try { window.location.reload = function () {}; } catch (e) {}
    const importOk = await window.processImport(backupText);
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      importOk,
      witnessStillPresent: window.Store.get('goals.__partial_import_witness__') === 'ORIGINAL',
      persistedWitness: persisted && persisted.data && persisted.data.goals && persisted.data.goals.__partial_import_witness__,
      persistedRevision: persisted && persisted.revision,
      persistedMarker: persisted && persisted.data && persisted.data.meta && persisted.data.meta.recordsMigration,
      persistedGoalsIsArray: Array.isArray(persisted && persisted.data && persisted.data.records && persisted.data.records.goals)
    };
  });
  // processImport returned false (rejected the malformed wrapper).
  expect(proof.importOk).toBe(false);
  // Existing good state PRESERVED — no overwrite happened.
  expect(proof.witnessStillPresent).toBe(true);
  expect(proof.persistedWitness).toBe('ORIGINAL');
  // Post-rejection persisted state still has canonical shape (four arrays).
  expect(proof.persistedGoalsIsArray).toBe(true);
});

// ────────────────────────────────────────────────────────
// PRV-R3-PARTIAL-MIGRATED-BOOT — a hand-crafted partial-migrated
// wrapper persisted to localStorage BEFORE boot must not be trusted
// as complete. Hydration's disk-authoritative shape check must
// detect the malformed shape and heal it.
// ────────────────────────────────────────────────────────
test('PRV-R3-PARTIAL-MIGRATED-BOOT — partial schema-14 migrated wrapper on disk is healed, not trusted', async ({ page }) => {
  // Seed a malformed wrapper before goto: status='migrated' but
  // records.goals missing. On boot, load-time validate() should
  // reject it (falling back to defaultState), OR if it slips through,
  // hydration's disk-authoritative shape check must heal.
  await page.addInitScript(() => {
    const nowIso = new Date().toISOString();
    const malformed = {
      version: 14, revision: 7, committedAt: nowIso,
      data: {
        money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
        qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
        todayFocus: ['','',''], goals: {}, career: {}, easa: {},
        logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
        reviews: [], decisions: [], timeline: [], about: {}, apartments: [], sbTasks: {},
        bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
        telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
        records: { deadlines: [], claims: [], risks: [] }, // goals missing!
        meta: {
          version: 14, createdAt: nowIso, lastUpdated: nowIso,
          recordsMigration: { status: 'migrated', schemaVersion: 14, at: nowIso, reason: 'test-partial-boot' }
        }
      }
    };
    try { localStorage.setItem('dune_state_v4', JSON.stringify(malformed)); } catch (e) {}
  });
  await page.goto('/');
  await waitForApp(page);
  // Explicitly drive hydration so we can await the healing commit.
  const hydrateRes = await page.evaluate(() => window.hydratePreservationRecordsOnce());
  // Wait for the healing commit to flush to disk.
  await waitForNextSave(page);
  const proof = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    const rec = p && p.data && p.data.records;
    const marker = p && p.data && p.data.meta && p.data.meta.recordsMigration;
    return {
      wrapperVersion: p && p.version,
      marker: marker,
      status: marker && marker.status,
      recKeys: rec ? Object.keys(rec) : null,
      recTypes: rec ? { deadlines: typeof rec.deadlines, claims: typeof rec.claims, risks: typeof rec.risks, goals: typeof rec.goals, goalsIsArray: Array.isArray(rec.goals), goalsIsUndef: rec.goals === undefined } : null,
      allDomainsAreArrays: rec && ['deadlines','claims','risks','goals'].every(d => Array.isArray(rec[d]))
    };
  });
  expect(hydrateRes && hydrateRes.ok).toBe(true);
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.status).toBe('migrated');
  expect(proof.allDomainsAreArrays).toBe(true);
});

// ────────────────────────────────────────────────────────
// PRV-R3-SIMULTANEOUS-TABS-P1-3 — the Codex Round-3 P1-3
// reproduction. Two tabs alive; both invoke hydration concurrently
// via Promise.all. Neither tab retains a pending marker CAS op;
// the losing tab's subsequent ordinary Store edit persists.
// ────────────────────────────────────────────────────────
test('PRV-R3-SIMULTANEOUS-TABS-P1-3 — concurrent two-tab hydration converges without leaving a losing-tab conflict', async ({ context }) => {
  // Register the v13 seed at the CONTEXT level so both tabs' cold-boot
  // pages see the same starting localStorage regardless of which
  // navigates first (page-level addInitScript would only cover one tab).
  await context.addInitScript(() => {
    if (localStorage.getItem('dune_state_v4')) return;
    const nowIso = new Date().toISOString();
    const data = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''], goals: {}, career: { started: '', company: '', position: '', aircraft: [], engines: [], licenses: [], certificates: [], milestones: [] },
      easa: {},
      logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
      reviews: [], decisions: [], timeline: [], about: {}, apartments: [], sbTasks: {},
      bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
      meta: { version: 13, createdAt: nowIso, lastUpdated: nowIso }
    };
    const wrapper = { version: 13, revision: 1, committedAt: nowIso, data: data };
    try { localStorage.setItem('dune_state_v4', JSON.stringify(wrapper)); } catch (e) {}
  });
  const a = await context.newPage();
  const b = await context.newPage();
  await Promise.all([a.goto('/'), b.goto('/')]);
  await Promise.all([waitForApp(a), waitForApp(b)]);
  // Suspend the boot-time auto-retry so we drive hydration explicitly
  // and Promise.all is the actual concurrency signal (not a nested
  // fire-and-forget from onSave).
  await a.evaluate(() => { window.__prv05HydrationAutoRetryEnabled = false; });
  await b.evaluate(() => { window.__prv05HydrationAutoRetryEnabled = false; });
  // Both tabs invoke hydration simultaneously. Under the Web Lock
  // (`lifeos-prv05-migrate`), one wins and does the actual migration;
  // the other enters the lock afterwards, sees disk is already
  // migrated + shape valid, and early-returns without enqueuing a
  // conflicting marker CAS op.
  const [ra, rb] = await Promise.all([
    a.evaluate(() => window.hydratePreservationRecordsOnce()).catch(e => ({ threw: String(e) })),
    b.evaluate(() => window.hydratePreservationRecordsOnce()).catch(e => ({ threw: String(e) }))
  ]);
  // If either returned durability-failed but the disk actually settled
  // migrated (from the winning tab), a retry converges. Both tabs must
  // ultimately report ok — the invariant Codex requires is convergence,
  // not that both succeed on the first attempt.
  const rerun = async (page, prior) => {
    if (prior && prior.ok) return prior;
    return await page.evaluate(() => window.hydratePreservationRecordsOnce()).catch(e => ({ threw: String(e) }));
  };
  const raFinal = await rerun(a, ra);
  const rbFinal = await rerun(b, rb);
  if (!(raFinal && raFinal.ok && rbFinal && rbFinal.ok)) {
    // eslint-disable-next-line no-console
    console.log('SIMULTANEOUS-TABS diagnostic:', JSON.stringify({ ra, rb, raFinal, rbFinal }, null, 2));
  }
  expect(raFinal && raFinal.ok).toBe(true);
  expect(rbFinal && rbFinal.ok).toBe(true);
  // Persisted disk is migrated + shape valid + no pending marker conflict.
  const disk = await a.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    const rec = p.data.records;
    return {
      wrapperVersion: p.version,
      status: p.data.meta.recordsMigration && p.data.meta.recordsMigration.status,
      allDomainsAreArrays: ['deadlines','claims','risks','goals'].every(d => Array.isArray(rec[d])),
      goalsLen: (rec.goals || []).length
    };
  });
  expect(disk.wrapperVersion).toBe(14);
  expect(disk.status).toBe('migrated');
  expect(disk.allDomainsAreArrays).toBe(true);
  expect(disk.goalsLen).toBeGreaterThan(0);
  // Losing tab = whichever second call reported already-migrated / default-state-migrated
  const losingTab = (raFinal.skipped) ? a : b;
  // Codex P1-3 asks specifically that NO migration-metadata conflict
  // remains on either tab and that ordinary edits from the losing tab
  // persist. Note: two-tab concurrent boot of Store can independently
  // produce a conflict on unrelated non-deterministic slices (e.g. BHT
  // slice migration timing), and that Store-level conflict is not
  // caused by hydration. We assert:
  //   (1) neither tab has a conflict on records.* or meta.recordsMigration;
  //   (2) after resolving any unrelated pre-existing conflict (a
  //       real user would resolve via the UI conflict banner), the
  //       losing tab's ordinary Store edit persists.
  // Codex P1-3 invariants that PRV-0.5 owns:
  //   (a) no MIGRATION-metadata conflict on either tab after hydration
  //       (`meta.recordsMigration` and `records.*` are hydration-owned);
  //   (b) ordinary edits from the losing tab eventually persist.
  //
  // Note: Store's own concurrent-boot behavior may leave pre-existing
  // conflicts on unrelated non-deterministic slices (e.g. `bht`,
  // `ideas` from timing-dependent init). Those are OUT of PRV-0.5's
  // scope — a real user would resolve them via the app's conflict
  // banner. The test resolves any such unrelated conflict via
  // `use-this-tab` (mirrors the banner's "keep my edits") in a bounded
  // loop, then verifies (a) and (b).
  const migrationPaths = ['records.deadlines', 'records.claims', 'records.risks', 'records.goals', 'meta.recordsMigration'];
  const editProof = await losingTab.evaluate(async (mpArr) => {
    const migPaths = new Set(mpArr);
    const conflictsObserved = [];
    // Bounded conflict-resolution loop for unrelated Store-baseline
    // conflicts. If a MIGRATION conflict appears, capture it and stop.
    for (let i = 0; i < 8; i++) {
      const c = typeof window.Store.getConflict === 'function' ? window.Store.getConflict() : null;
      if (!c) break;
      conflictsObserved.push(c.path);
      if (migPaths.has(c.path)) break;
      try { window.Store.resolveConflict('use-this-tab'); } catch (e) {}
      // wait for the resolution commit to land
      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
        const unsub = window.Store.onSave(finish);
        setTimeout(finish, 1500);
      });
    }
    const finalConflict = typeof window.Store.getConflict === 'function' ? window.Store.getConflict() : null;
    const migrationConflict = conflictsObserved.filter(p => migPaths.has(p));
    // Ordinary edit
    const setRes = window.Store.set('todayFocus', ['losing-tab-edit', '', '']);
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish);
      setTimeout(finish, 3000);
    });
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      conflictsObserved,
      migrationConflict,
      finalConflictPath: finalConflict && finalConflict.path,
      setOk: !!(setRes && setRes.ok),
      persistedFocus: persisted && persisted.data && persisted.data.todayFocus && persisted.data.todayFocus[0]
    };
  }, migrationPaths);
  if (editProof.migrationConflict.length > 0 || editProof.persistedFocus !== 'losing-tab-edit') {
    // eslint-disable-next-line no-console
    console.log('SIMULTANEOUS-TABS edit diagnostic:', JSON.stringify(editProof, null, 2));
  }
  // Invariant (a): no MIGRATION-metadata conflict ever surfaced.
  expect(editProof.migrationConflict).toEqual([]);
  // Invariant (b): losing tab's ordinary edit persists (after resolving
  // any unrelated Store-baseline conflicts from concurrent boot).
  expect(editProof.setOk).toBe(true);
  expect(editProof.persistedFocus).toBe('losing-tab-edit');
  await a.close();
  await b.close();
});

// ═════════════════════════════════════════════════════════════════════
// PRV-0.5 R4 — Codex Round-3 remediation regressions
// ═════════════════════════════════════════════════════════════════════

// Helper: seed a canonically-migrated v14 wrapper with all four records
// arrays and a canonical migrated marker.
function seedMigratedV14Wrapper(page, opts) {
  return page.addInitScript((o) => {
    const nowIso = new Date().toISOString();
    const overrides = o || {};
    const wrapperVersion = 'wrapperVersion' in overrides ? overrides.wrapperVersion : 14;
    const revision = 'revision' in overrides ? overrides.revision : 5;
    const records = 'records' in overrides
      ? overrides.records
      : { deadlines: [], claims: [], risks: [], goals: [] };
    const marker = 'marker' in overrides
      ? overrides.marker
      : { status: 'migrated', schemaVersion: 14, at: nowIso, reason: 'seed' };
    const data = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''], goals: {}, career: {}, easa: {},
      logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
      reviews: [], decisions: [], timeline: [], about: {}, apartments: [], sbTasks: {},
      bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
      records: records,
      meta: {
        version: 14, createdAt: nowIso, lastUpdated: nowIso,
        recordsMigration: marker
      }
    };
    // Allow the marker or records object to be omitted entirely.
    if (overrides.omitMarker) delete data.meta.recordsMigration;
    if (overrides.omitRecords) delete data.records;
    const wrapper = 'wrapperOverride' in overrides
      ? overrides.wrapperOverride
      : { version: wrapperVersion, revision: revision, committedAt: nowIso, data: data };
    try { localStorage.setItem('dune_state_v4', JSON.stringify(wrapper)); } catch (e) {}
  }, opts || null);
}

function makeMalformedBackup(overrides) {
  const nowIso = new Date().toISOString();
  const o = overrides || {};
  const wrapperVersion = 'wrapperVersion' in o ? o.wrapperVersion : 14;
  const revision = 'revision' in o ? o.revision : 42;
  const records = 'records' in o
    ? o.records
    : { deadlines: [], claims: [], risks: [], goals: [] };
  const marker = 'marker' in o
    ? o.marker
    : { status: 'migrated', schemaVersion: 14, at: nowIso, reason: 'test' };
  const data = {
    money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
    qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
    todayFocus: ['','',''], goals: {}, career: {}, easa: {},
    logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
    reviews: [], decisions: [], timeline: [], about: {}, apartments: [], sbTasks: {},
    bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
    telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
    records: records,
    meta: {
      version: 14, createdAt: nowIso, lastUpdated: nowIso,
      recordsMigration: marker
    }
  };
  if (o.omitMarker) delete data.meta.recordsMigration;
  if (o.omitRecords) delete data.records;
  const wrapper = { version: wrapperVersion, revision: revision, committedAt: nowIso, data: data };
  return JSON.stringify({ version: '2026.1', exported_at: nowIso, data: { dune_state_v4: wrapper } });
}

// ────────────────────────────────────────────────────────
// PRV-R4-P1A-NEGATIVE-REVISION — Codex R3 P1-A #1. Hydration MUST NOT
// return { ok:true, skipped:'already-migrated' } for a wrapper whose
// revision is negative — Store rejects that as corrupt at initialLoad,
// so hydration must apply the same authority rule.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1A-NEGATIVE-REVISION — invalid negative revision is not a migrated fast-path authority', async ({ page }) => {
  await seedMigratedV14Wrapper(page, { revision: -1 });
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    const res = await window.hydratePreservationRecordsOnce();
    return { res };
  });
  // Codex expected: hydration must NOT report `already-migrated` for
  // a wrapper Store itself treats as corrupt.
  expect(proof.res.skipped).not.toBe('already-migrated');
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1A-OLD-VERSION — Codex R3 P1-A #2. A wrapper carrying
// version=13 with canonical schema-14 inner data must NOT enter the
// "already migrated" fast path merely because its inner shape looks
// current.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1A-OLD-VERSION — version=13 wrapper with schema-14 inner data is not a migrated fast-path authority', async ({ page }) => {
  await seedMigratedV14Wrapper(page, { wrapperVersion: 13, revision: 3 });
  await page.goto('/');
  await waitForApp(page);
  const proof = await page.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    const res = await window.hydratePreservationRecordsOnce();
    return { res };
  });
  expect(proof.res.skipped).not.toBe('already-migrated');
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1A-EXPORT-RELOAD — after hydration reports success, the
// exported wrapper must be schema-14, carry a canonical marker, hold
// all four records arrays, and pass another reload's authority
// checks — never a wrapper that reload would reject and fall back on.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1A-EXPORT-RELOAD — a hydration-completed wrapper is accepted by a subsequent reload', async ({ context }) => {
  const a = await context.newPage();
  await a.addInitScript(() => {
    if (localStorage.getItem('dune_state_v4')) return;
    const nowIso = new Date().toISOString();
    const data = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''], goals: {}, career: {}, easa: {},
      logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
      reviews: [], decisions: [], timeline: [], about: {}, apartments: [], sbTasks: {},
      bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
      meta: { version: 13, createdAt: nowIso, lastUpdated: nowIso }
    };
    const wrapper = { version: 13, revision: 1, committedAt: nowIso, data: data };
    try { localStorage.setItem('dune_state_v4', JSON.stringify(wrapper)); } catch (e) {}
  });
  await a.goto('/');
  await waitForApp(a);
  await waitForMigrated(a);
  await waitForNextSave(a);
  const postHydrateWrapper = await a.evaluate(() => localStorage.getItem('dune_state_v4'));
  await a.close();

  // Fresh page on the same origin — the post-hydration wrapper is
  // already persisted. New page hydration must fast-path accept it.
  const b = await context.newPage();
  await b.goto('/');
  await waitForApp(b);
  const proof = await b.evaluate(async () => {
    const res = await window.hydratePreservationRecordsOnce();
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      res,
      wrapperVersion: p && p.version,
      revisionValid: typeof p.revision === 'number' && Number.isInteger(p.revision) && p.revision >= 0,
      marker: p && p.data && p.data.meta && p.data.meta.recordsMigration,
      allArrays: p && p.data && p.data.records
        && ['deadlines','claims','risks','goals'].every(d => Array.isArray(p.data.records[d]))
    };
  });
  expect(postHydrateWrapper).toBeTruthy();
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.revisionValid).toBe(true);
  expect(proof.marker && proof.marker.status).toBe('migrated');
  expect(proof.allArrays).toBe(true);
  expect(proof.res.ok).toBe(true);
  // Reload MUST accept the wrapper — not treat it as corrupt or stale.
  expect(proof.res.skipped).toBe('already-migrated');
  await b.close();
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1B-IMPORT-MISSING-MARKER — Codex R3 P1-B #1. A schema-14
// backup with four empty arrays but NO migration marker must be
// rejected by production processImport() BEFORE it can replace good
// current state.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1B-IMPORT-MISSING-MARKER — schema-14 backup with missing marker is rejected; good state preserved', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  await page.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    window.Store.set('goals.__r4_import_missing_marker_witness__', 'ORIGINAL');
    await new Promise((resolve) => {
      let done = false; const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish); setTimeout(finish, 2000);
    });
  });
  const proof = await page.evaluate(async (backupText) => {
    try { window.location.reload = function () {}; } catch (e) {}
    const importOk = await window.processImport(backupText);
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      importOk,
      witnessStillPresent: window.Store.get('goals.__r4_import_missing_marker_witness__') === 'ORIGINAL',
      persistedWitness: persisted && persisted.data && persisted.data.goals && persisted.data.goals.__r4_import_missing_marker_witness__,
      persistedMarkerStatus: persisted && persisted.data && persisted.data.meta && persisted.data.meta.recordsMigration && persisted.data.meta.recordsMigration.status
    };
  }, makeMalformedBackup({ omitMarker: true }));
  expect(proof.importOk).toBe(false);
  expect(proof.witnessStillPresent).toBe(true);
  expect(proof.persistedWitness).toBe('ORIGINAL');
  // Existing good state's marker survives unchanged.
  expect(proof.persistedMarkerStatus).toBe('migrated');
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1B-IMPORT-BOGUS-STATUS — Codex R3 P1-B #2. A schema-14
// backup with `status:'bogus'` (unknown marker status) must be
// rejected — must NOT bypass the guard just because it isn't the
// literal 'migrated' string.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1B-IMPORT-BOGUS-STATUS — schema-14 backup with bogus marker status is rejected; good state preserved', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  await page.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    window.Store.set('goals.__r4_bogus_status_witness__', 'ORIGINAL');
    await new Promise((resolve) => {
      let done = false; const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish); setTimeout(finish, 2000);
    });
  });
  const proof = await page.evaluate(async (backupText) => {
    try { window.location.reload = function () {}; } catch (e) {}
    const importOk = await window.processImport(backupText);
    return {
      importOk,
      witnessStillPresent: window.Store.get('goals.__r4_bogus_status_witness__') === 'ORIGINAL'
    };
  }, makeMalformedBackup({ marker: { status: 'bogus', schemaVersion: 14 } }));
  expect(proof.importOk).toBe(false);
  expect(proof.witnessStillPresent).toBe(true);
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1B-IMPORT-MISSING-RECORDS — Codex R3 P1-B #3. A schema-14
// backup with no `records` object at all and no marker must be
// rejected — the guard cannot infer intent for the four domains.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1B-IMPORT-MISSING-RECORDS — schema-14 backup with no records object is rejected; good state preserved', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  await page.evaluate(async () => {
    window.__prv05HydrationAutoRetryEnabled = false;
    window.Store.set('goals.__r4_missing_records_witness__', 'ORIGINAL');
    await new Promise((resolve) => {
      let done = false; const finish = () => { if (done) return; done = true; try { unsub(); } catch(e){} resolve(); };
      const unsub = window.Store.onSave(finish); setTimeout(finish, 2000);
    });
  });
  const proof = await page.evaluate(async (backupText) => {
    try { window.location.reload = function () {}; } catch (e) {}
    const importOk = await window.processImport(backupText);
    return {
      importOk,
      witnessStillPresent: window.Store.get('goals.__r4_missing_records_witness__') === 'ORIGINAL'
    };
  }, makeMalformedBackup({ omitMarker: true, omitRecords: true }));
  expect(proof.importOk).toBe(false);
  expect(proof.witnessStillPresent).toBe(true);
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1B-SNAPSHOT-MISSING-MARKER — Snapshot restore mirrors the
// import authority: a stored snapshot whose payload is a schema-14
// wrapper missing the migration marker must be rejected by
// Store.restoreSnapshot / validateSnapshotWrapperFull.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1B-SNAPSHOT-MISSING-MARKER — snapshot restore rejects schema-14 payload with missing marker', async ({ page }) => {
  await page.goto('/');
  await waitForApp(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(async () => {
    const nowIso = new Date().toISOString();
    const malformedData = {
      money: { salary_net: 130000, expenses: {}, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['','',''], goals: {}, career: {}, easa: {},
      logbook: { schemaVersion: 1, authority: 'legacy-mirror', entries: [], migration: { sourceCounts: { tracker: 0, builder: 0 } }, reconciled: { at: nowIso }, drift: { diverged: false } },
      reviews: [], decisions: [], timeline: [], about: {}, apartments: [], sbTasks: {},
      bht: { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 }, ideas: [],
      records: { deadlines: [], claims: [], risks: [], goals: [] },
      // NO marker.
      meta: { version: 14, createdAt: nowIso, lastUpdated: nowIso }
    };
    const wrapper = { version: 14, revision: 99, committedAt: nowIso, data: malformedData };
    // Inject a snapshot whose payload is the malformed wrapper.
    const snaps = [{ at: nowIso, payload: JSON.stringify(wrapper) }];
    localStorage.setItem('dune_snapshots_v1', JSON.stringify(snaps));
    // Capture pre-restore witness so we can prove no destructive commit happened.
    const preMarker = window.Store.get('meta.recordsMigration');
    const restoreRes = window.Store.restoreSnapshot(0, { force: true });
    // Snapshot restore is async — give it a bounded moment.
    await new Promise((r) => setTimeout(r, 800));
    const post = JSON.parse(localStorage.getItem('dune_state_v4'));
    return {
      restoreOk: restoreRes && restoreRes.ok,
      restoreError: restoreRes && restoreRes.error,
      preMarkerStatus: preMarker && preMarker.status,
      postMarkerStatus: post && post.data && post.data.meta && post.data.meta.recordsMigration && post.data.meta.recordsMigration.status
    };
  });
  // Restore refuses — SNAPSHOT_SOURCE_WRAPPER_INVALID.
  expect(proof.restoreOk).toBe(false);
  expect(proof.restoreError).toBe('SNAPSHOT_SOURCE_WRAPPER_INVALID');
  // Post-rejection state is unchanged from pre-restore.
  expect(proof.postMarkerStatus).toBe(proof.preMarkerStatus);
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1C-INTENT-PRESERVATION — Codex R3 P1-C reproduction.
// Persisted disk claims migrated but omits records.goals; the sibling
// three arrays are intentionally empty. After hydration heals the
// state, the three empty siblings MUST remain empty (no legacy
// resurrection) and goals is canonicalized to [] (never invented
// from LEGACY_RECORDS).
// ────────────────────────────────────────────────────────
test('PRV-R4-P1C-INTENT-PRESERVATION — three empty siblings + one missing domain: no legacy resurrection', async ({ page }) => {
  await seedMigratedV14Wrapper(page, {
    records: { deadlines: [], claims: [], risks: [] } // goals omitted
  });
  await page.goto('/');
  await waitForApp(page);
  const hydrateRes = await page.evaluate(() => window.hydratePreservationRecordsOnce());
  await waitForNextSave(page);
  const proof = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    const rec = p && p.data && p.data.records;
    const marker = p && p.data && p.data.meta && p.data.meta.recordsMigration;
    return {
      wrapperVersion: p && p.version,
      marker,
      deadlinesLen: rec && Array.isArray(rec.deadlines) ? rec.deadlines.length : -1,
      claimsLen: rec && Array.isArray(rec.claims) ? rec.claims.length : -1,
      risksLen: rec && Array.isArray(rec.risks) ? rec.risks.length : -1,
      goalsLen: rec && Array.isArray(rec.goals) ? rec.goals.length : -1,
      allArrays: rec && ['deadlines','claims','risks','goals'].every(d => Array.isArray(rec[d]))
    };
  });
  expect(hydrateRes && hydrateRes.ok).toBe(true);
  expect(proof.wrapperVersion).toBe(14);
  expect(proof.marker && proof.marker.status).toBe('migrated');
  expect(proof.allArrays).toBe(true);
  // The three siblings that were present as [] MUST remain [].
  expect(proof.deadlinesLen).toBe(0);
  expect(proof.claimsLen).toBe(0);
  expect(proof.risksLen).toBe(0);
  // The one absent domain is canonicalized to [] — NOT resurrected from LEGACY.
  expect(proof.goalsLen).toBe(0);
});

// ────────────────────────────────────────────────────────
// PRV-R4-P1C-INTENT-PRESERVATION-PARAMETERIZED — parameterize the
// P1-C invariant across every choice of "which domain is missing".
// For any single-domain omission, the other three intentionally-empty
// siblings must stay empty; the missing one canonicalizes to [].
// ────────────────────────────────────────────────────────
for (const missing of ['deadlines', 'claims', 'risks', 'goals']) {
  test(`PRV-R4-P1C-PARAM — missing ${missing} does not resurrect empty siblings`, async ({ page }) => {
    const rec = { deadlines: [], claims: [], risks: [], goals: [] };
    delete rec[missing];
    await seedMigratedV14Wrapper(page, { records: rec });
    await page.goto('/');
    await waitForApp(page);
    const hydrateRes = await page.evaluate(() => window.hydratePreservationRecordsOnce());
    await waitForNextSave(page);
    const proof = await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('dune_state_v4'));
      const r = p && p.data && p.data.records;
      return {
        allArrays: r && ['deadlines','claims','risks','goals'].every(d => Array.isArray(r[d])),
        lengths: r ? { deadlines: (r.deadlines||[]).length, claims: (r.claims||[]).length, risks: (r.risks||[]).length, goals: (r.goals||[]).length } : null
      };
    });
    expect(hydrateRes && hydrateRes.ok).toBe(true);
    expect(proof.allArrays).toBe(true);
    // Every one of the four domains must be empty — no LEGACY resurrection.
    expect(proof.lengths.deadlines).toBe(0);
    expect(proof.lengths.claims).toBe(0);
    expect(proof.lengths.risks).toBe(0);
    expect(proof.lengths.goals).toBe(0);
  });
}

// ────────────────────────────────────────────────────────
// PRV-R4-P1C-UNMIGRATED-STILL-SEEDS — the P1-C fix must NOT regress
// the legitimate v13→v14 flow. A wrapper whose marker claims
// unmigrated must still trigger LEGACY_RECORDS seeding, because that
// is exactly the preservation semantics for the v13 transition —
// the marker signals user intent has NOT yet been established.
// ────────────────────────────────────────────────────────
test('PRV-R4-P1C-UNMIGRATED-STILL-SEEDS — unmigrated marker still seeds records from LEGACY_RECORDS', async ({ page }) => {
  await seedV13Wrapper(page, {});
  await page.goto('/');
  await waitForApp(page);
  await waitForMigrated(page);
  await waitForNextSave(page);
  const proof = await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('dune_state_v4'));
    const r = p && p.data && p.data.records;
    return {
      status: p && p.data && p.data.meta && p.data.meta.recordsMigration && p.data.meta.recordsMigration.status,
      deadlinesLen: r ? (r.deadlines||[]).length : -1,
      claimsLen: r ? (r.claims||[]).length : -1,
      risksLen: r ? (r.risks||[]).length : -1,
      goalsLen: r ? (r.goals||[]).length : -1
    };
  });
  expect(proof.status).toBe('migrated');
  expect(proof.deadlinesLen).toBeGreaterThan(0);
  expect(proof.claimsLen).toBeGreaterThan(0);
  expect(proof.risksLen).toBeGreaterThan(0);
  expect(proof.goalsLen).toBeGreaterThan(0);
});
