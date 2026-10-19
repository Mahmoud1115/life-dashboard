const { test, expect } = require('@playwright/test');

const MIGRATION_ASSET = /_migration-legacy-records\.js(\?|$)/;
const DUKU_ASSET = /bht-duku\.js(\?|$)/;

function seedLegacyWrapper(page) {
  return page.addInitScript(() => {
    if (localStorage.getItem('__seeded_once')) return; // init scripts re-run on reload and would overwrite the converted state
    localStorage.setItem('__seeded_once', '1');
    const nowIso = '2026-06-15T12:00:00.000Z';
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
      bht: {
        habits: [{ id: 'HABIT_KEEP', name: 'BHT_SENTINEL' }],
        entries: [{ id: 'E_KEEP', habitId: 'HABIT_KEEP', mood: 'BHT_ENTRY_SENTINEL' }],
        snapshots: [],
        lifeEvents: [],
        vocab: { triggers: [], coping: [], moods: [] },
        ai: { provider: 'fallback', ollamaUrl: '', model: '' },
        meta: {}
      },
      telemetry: { accumulatedFatigue: 0, weeklyShiftHours: 0, focusReserve: 100 },
      ideas: [{ id: 'IDEA_KEEP', text: 'IDEA_SENTINEL' }],
      meta: { version: 13, createdAt: nowIso, lastUpdated: nowIso }
    };
    localStorage.setItem('dune_state_v4', JSON.stringify({
      version: 13,
      revision: 1,
      committedAt: nowIso,
      data
    }));
  });
}

async function delayAsset(page, pattern, delayMs) {
  if (!delayMs) return;
  await page.route(pattern, async route => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    await route.continue();
  });
}

const timingCases = [
  { migrationDelay: 0, dukuDelay: 0 },
  { migrationDelay: 500, dukuDelay: 0 },
  { migrationDelay: 0, dukuDelay: 500 },
  { migrationDelay: 500, dukuDelay: 500 }
];

for (const timing of timingCases) {
  test(`legacy conversion is deterministic with migration=${timing.migrationDelay}ms and duku=${timing.dukuDelay}ms`, async ({ page }) => {
    await delayAsset(page, MIGRATION_ASSET, timing.migrationDelay);
    await delayAsset(page, DUKU_ASSET, timing.dukuDelay);
    await seedLegacyWrapper(page);

    await page.goto('/');
    await page.waitForFunction(() => {
      const marker = window.Store && window.Store.get('meta.recordsMigration');
      return marker && marker.status === 'migrated';
    }, {}, { timeout: 15000 });

    const proof = await page.evaluate(() => {
      const wrapper = JSON.parse(localStorage.getItem('dune_state_v4') || 'null');
      const data = wrapper && wrapper.data;
      return {
        version: wrapper && wrapper.version,
        habit: data && data.bht && data.bht.habits && data.bht.habits[0] && data.bht.habits[0].name,
        entry: data && data.bht && data.bht.entries && data.bht.entries[0] && data.bht.entries[0].mood,
        idea: data && data.ideas && data.ideas[0] && data.ideas[0].text,
        salary: data && data.money && data.money.salary_net,
        rent: data && data.money && data.money.expenses && data.money.expenses.rent
      };
    });

    expect(proof).toEqual({
      version: 14,
      habit: 'BHT_SENTINEL',
      entry: 'BHT_ENTRY_SENTINEL',
      idea: 'IDEA_SENTINEL',
      salary: 424242,
      rent: 26000
    });

    // The designed one-time consolidation is deferred, not abandoned:
    // the next load starts from authoritative schema 14 with no blocker.
    await page.reload();
    await page.waitForFunction(() => {
      const habits = window.Store && window.Store.get('bht.habits');
      const meta = window.Store && window.Store.get('bht.meta');
      return habits && habits[0] && habits[0].name === 'DUKU'
        && meta && meta.dukuMigrated === true;
    }, {}, { timeout: 15000 });
  });
}
