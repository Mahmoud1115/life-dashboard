// Regression guard for the production incident fixed by adding `.nojekyll`.
//
// Incident: GitHub Pages (Jekyll, build_type=legacy) excluded the
// underscore-prefixed `_migration-legacy-records.js`, so it 404'd in
// production. Without `window.LEGACY_RECORDS`, a browser holding a
// pre-schema-14 (legacy) `dune_state_v4` wrapper cannot complete the
// one-time atomic legacy conversion; the `STORE_LEGACY_CONVERSION_PENDING`
// durability blocker never clears and every save is refused
// ("Saving is blocked").
//
// This spec cannot exercise Jekyll itself (server-side), so it proves the
// APPLICATION contract the fix depends on, on both engines:
//   1. Asset MISSING (simulated 404) + legacy wrapper => saves are refused
//      with STORE_LEGACY_CONVERSION_PENDING, AND the user's existing data
//      stays frozen in localStorage (nothing removed).
//   2. Asset SERVED + legacy wrapper => conversion completes to schema 14,
//      the blocker clears, a save SUCCEEDS, AND the user's Behavior/Ideas/
//      Money data is preserved verbatim through the migration.
//
// Distinctive sentinels prove per-domain preservation.
const { test, expect } = require('@playwright/test');

const MIGRATION_ASSET = /_migration-legacy-records\.js(\?|$)/;

// A pre-PRV schema-13 wrapper carrying real user-shaped data with sentinels
// in Behavior (BHT) and Ideas (both live inside dune_state_v4) plus Money
// values, so we can prove nothing is dropped by the conversion.
function seedLegacyWithUserData(page) {
  return page.addInitScript(() => {
    const nowIso = new Date().toISOString();
    const data = {
      money: { salary_net: 424242, expenses: { rent: 26000 }, usd_rate: 88, save_target: 55000 },
      qatarVisit: { from_airport: 'SVO', to_airport: 'DOH', travel_month: '', flights: 0, hotel: 0, food: 0, transport: 0, misc: 0, emergency: 0, saved: 0, notes: '' },
      todayFocus: ['', '', ''],
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
      // Behavior sentinel — a habit + an entry the user "clicked".
      bht: { habits: [{ id: 'HABIT_KEEP', name: 'BHT_SENTINEL' }], entries: [{ id: 'E_KEEP', mood: 'BHT_ENTRY_SENTINEL' }], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: '', model: '' }, meta: {} },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 },
      // Ideas sentinel.
      ideas: [{ id: 'IDEA_KEEP', text: 'IDEA_SENTINEL' }],
      meta: { version: 13, createdAt: nowIso, lastUpdated: nowIso }
    };
    try {
      const wrapper = { version: 13, revision: 1, committedAt: nowIso, data: data };
      localStorage.setItem('dune_state_v4', JSON.stringify(wrapper));
    } catch (e) {}
  });
}

function rawWrapper(page) {
  return page.evaluate(() => { try { return localStorage.getItem('dune_state_v4'); } catch (e) { return null; } });
}

test('INCIDENT — migration asset 404 keeps saves blocked (STORE_LEGACY_CONVERSION_PENDING) and does NOT remove existing data', async ({ page }) => {
  // Simulate the production 404: block the underscore-prefixed seed script.
  await page.route(MIGRATION_ASSET, (route) => route.abort());
  await seedLegacyWithUserData(page);
  await page.goto('/');
  // Store boots independently of the (missing) seed; wait for it.
  await page.waitForFunction(() => !!(window.Store && typeof window.Store.set === 'function'), {}, { timeout: 15000 });
  // The seed never loaded -> conversion cannot complete.
  const seedPresent = await page.evaluate(() => typeof window.LEGACY_RECORDS !== 'undefined');
  expect(seedPresent).toBe(false);
  // A save must be refused with the exact production blocker code.
  const setRes = await page.evaluate(() => window.Store.set('money.save_target', 99999));
  expect(setRes.ok).toBe(false);
  expect(setRes.error).toBe('STORE_DURABILITY_BLOCKED');
  expect(setRes.code).toBe('STORE_LEGACY_CONVERSION_PENDING');
  // Existing data is FROZEN, not lost: the legacy wrapper + sentinels remain.
  const raw = await rawWrapper(page);
  expect(raw).toContain('BHT_SENTINEL');
  expect(raw).toContain('IDEA_SENTINEL');
  expect(raw).toContain('424242'); // money salary
  const parsed = JSON.parse(raw);
  expect(parsed.version).toBe(13); // still the legacy wrapper; nothing overwritten
});

test('FIX — migration asset served: legacy browser converts to schema 14, saving unblocks, and Behavior/Ideas/Money are preserved', async ({ page }) => {
  // Asset served normally (no abort) — the .nojekyll production fix.
  await seedLegacyWithUserData(page);
  await page.goto('/');
  await page.waitForFunction(() =>
    !!(window.Store && typeof window.Store.set === 'function' && window.LEGACY_RECORDS &&
       typeof window.hydratePreservationRecordsOnce === 'function'), {}, { timeout: 15000 });
  // Conversion completes to schema 14 / migrated.
  await page.waitForFunction(() => {
    const m = window.Store.get('meta.recordsMigration');
    return m && m.status === 'migrated';
  }, {}, { timeout: 8000 });
  // Let the hydration's durable commit settle.
  await page.evaluate(() => new Promise((resolve) => {
    let done = false; const finish = () => { if (done) return; done = true; try { unsub(); } catch (e) {} resolve(); };
    const unsub = window.Store.onSave(finish); setTimeout(finish, 3000);
  }));
  // Saving is now UNBLOCKED — a write succeeds and durably flushes.
  const setRes = await page.evaluate(() => window.Store.set('about.vision', 'SAVE_WORKS_SENTINEL'));
  expect(setRes.ok).toBe(true);
  // Wait for the write's own durable save before re-reading localStorage.
  await page.evaluate(() => new Promise((resolve) => {
    let done = false; const finish = () => { if (done) return; done = true; try { unsub(); } catch (e) {} resolve(); };
    const unsub = window.Store.onSave(finish); setTimeout(finish, 3000);
  }));
  // The durable wrapper is now schema 14, the write persisted, and the
  // user's existing Behavior/Ideas/Money data survived verbatim.
  const proof = await page.evaluate(() => {
    const persisted = JSON.parse(localStorage.getItem('dune_state_v4') || 'null');
    const d = persisted && persisted.data;
    return {
      version: persisted && persisted.version,
      migrated: d && d.meta && d.meta.recordsMigration && d.meta.recordsMigration.status,
      newWrite: d && d.about && d.about.vision,
      bhtHabit: d && d.bht && d.bht.habits && d.bht.habits[0] && d.bht.habits[0].name,
      bhtEntry: d && d.bht && d.bht.entries && d.bht.entries[0] && d.bht.entries[0].mood,
      idea: d && d.ideas && d.ideas[0] && d.ideas[0].text,
      salary: d && d.money && d.money.salary_net,
      rent: d && d.money && d.money.expenses && d.money.expenses.rent
    };
  });
  expect(proof.version).toBe(14);
  expect(proof.migrated).toBe('migrated');
  expect(proof.newWrite).toBe('SAVE_WORKS_SENTINEL'); // the new save actually persisted
  expect(proof.bhtHabit).toBe('BHT_SENTINEL');        // Behavior preserved
  expect(proof.bhtEntry).toBe('BHT_ENTRY_SENTINEL');
  expect(proof.idea).toBe('IDEA_SENTINEL');           // Ideas preserved
  expect(proof.salary).toBe(424242);                  // Money preserved
  expect(proof.rent).toBe(26000);
});
