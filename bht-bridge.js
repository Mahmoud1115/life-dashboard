// ============================================================
// DUNE LIFE OS — BHT · BRIDGE (Phase 6)
// Cross-module sensor adapter · synthetic data factory · checks
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store || !global.BHT || !global.BHT_UI || !global.BHT_COMPONENTS || !global.BHT_ANALYTICS || !global.BHT_COACH) {
    console.error('[BHT-BRIDGE] Phases 1-5 must load first.');
    return;
  }

  const CANDIDATE_PATHS = {
    sleep: [
      'sleep', 'health.sleep', 'today.sleep', 'metrics.sleep',
      'wellbeing.sleep', 'daily.sleep', 'sb.sleep'
    ],
    stress: [
      'stress', 'health.stress', 'today.stress', 'metrics.stress',
      'wellbeing.stress', 'daily.stress', 'sb.stress'
    ]
  };

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function ymdOf(v) {
    if (!v) return null;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
    const d = new Date(v);
    if (isNaN(d)) return null;
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function numOf(v) {
    if (v == null) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const n = parseFloat(v);
    return isFinite(n) ? n : null;
  }

  function coerceToDateMap(raw, kind) {
    if (!raw) return null;
    const map = {};
    let hit = 0;

    function inspect(rec, dateHint) {
      if (!rec) return;
      const d = ymdOf(rec.date || rec.day || rec.at || rec.when || dateHint);
      if (!d) return;
      const v = numOf(
        rec[kind]
        ?? rec[kind + 'Hours']
        ?? rec[kind + 'Level']
        ?? rec.value
        ?? (typeof rec === 'number' ? rec : null)
      );
      if (v != null) { map[d] = v; hit++; }
    }

    if (Array.isArray(raw)) {
      raw.forEach(rec => inspect(rec));
    } else if (typeof raw === 'object') {
      Object.keys(raw).forEach(k => {
        if (/^\d{4}-\d{2}-\d{2}/.test(k)) {
          const v = raw[k];
          if (typeof v === 'number') { map[k.slice(0,10)] = v; hit++; }
          else inspect(v, k);
        } else if (raw[k] && typeof raw[k] === 'object') {
          inspect(raw[k]);
        }
      });
    }
    return hit > 0 ? map : null;
  }

  const sensorState = { sleep: null, stress: null, sources: { sleep: null, stress: null } };

  function discover() {
    const root = global.Store.raw();
    sensorState.sleep = null;
    sensorState.stress = null;
    sensorState.sources.sleep = null;
    sensorState.sources.stress = null;

    for (const kind of ['sleep', 'stress']) {
      for (const p of CANDIDATE_PATHS[kind]) {
        const raw = getPath(root, p);
        const map = coerceToDateMap(raw, kind);
        if (map) {
          sensorState[kind] = map;
          sensorState.sources[kind] = p;
          break;
        }
      }
    }
  }

  function sleepForDate(ymd) {
    return (sensorState.sleep && sensorState.sleep[ymd] != null) ? sensorState.sleep[ymd] : null;
  }
  function stressForDate(ymd) {
    return (sensorState.stress && sensorState.stress[ymd] != null) ? sensorState.stress[ymd] : null;
  }

  function enrichEntries(entries) {
    if (!sensorState.sleep && !sensorState.stress) return entries;
    return entries.map(e => {
      const patch = {};
      if (e.sleepHours == null && sensorState.sleep) {
        const v = sensorState.sleep[e.date]; if (v != null) patch.sleepHours = v;
      }
      if (e.stressLevel == null && sensorState.stress) {
        const v = sensorState.stress[e.date]; if (v != null) patch.stressLevel = v;
      }
      return Object.keys(patch).length ? Object.assign({}, e, patch) : e;
    });
  }

  function status() {
    const have = [];
    if (sensorState.sleep)  have.push({ kind: 'sleep',  path: sensorState.sources.sleep,  days: Object.keys(sensorState.sleep).length });
    if (sensorState.stress) have.push({ kind: 'stress', path: sensorState.sources.stress, days: Object.keys(sensorState.stress).length });
    return {
      found: have.length > 0,
      kinds: have,
      scanned: CANDIDATE_PATHS,
      note: have.length === 0
        ? 'No cross-module sleep/stress source exists in dune_state_v4 today. Per-entry sleepHours/stressLevel from the CBT modal continue to feed the risk model. The bridge will pick up any future state.sleep / state.stress / state.health.sleep automatically.'
        : 'Cross-module sensors live — feeding the worker via enrichEntries().'
    };
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function ymdBack(days) {
    const d = new Date(); d.setDate(d.getDate() - days);
    return d.getFullYear() + '-' + pad2(d.getMonth()+1) + '-' + pad2(d.getDate());
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function pickN(arr, n) {
    const out = []; const pool = arr.slice();
    while (out.length < n && pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  const HEAVY_FROM = 55, HEAVY_TO = 75;
  const CLEAN_FROM = 12, CLEAN_TO  = 26;
  const SYNTH_TAG = '[synthetic]';

  function distributeDay() {
    const r = Math.random();
    if (r < 0.32) return Math.floor(rand(HEAVY_FROM, HEAVY_TO + 1));
    if (r < 0.46) return Math.floor(rand(CLEAN_FROM, CLEAN_TO + 1));
    return Math.floor(rand(0, 90));
  }
  function severityFor(dayBack) {
    const r = Math.random();
    if (dayBack >= HEAVY_FROM && dayBack <= HEAVY_TO) {
      return r < 0.42 ? 'major' : r < 0.78 ? 'moderate' : 'minor';
    }
    if (dayBack >= CLEAN_FROM && dayBack <= CLEAN_TO) {
      return r < 0.80 ? 'minor' : r < 0.95 ? 'moderate' : 'major';
    }
    return r < 0.58 ? 'minor' : r < 0.86 ? 'moderate' : 'major';
  }
  function todFor() {
    const r = Math.random();
    return r < 0.12 ? 'Morning' : r < 0.30 ? 'Afternoon' : r < 0.70 ? 'Evening' : 'Night';
  }
  function sleepFor(dayBack) {
    const base = (dayBack >= HEAVY_FROM && dayBack <= HEAVY_TO) ? 5.4
               : (dayBack >= CLEAN_FROM && dayBack <= CLEAN_TO) ? 7.6 : 6.9;
    return Math.max(3.5, Math.min(9.5, +(base + rand(-0.9, 0.9)).toFixed(1)));
  }
  function stressFor(dayBack) {
    const base = (dayBack >= HEAVY_FROM && dayBack <= HEAVY_TO) ? 7
               : (dayBack >= CLEAN_FROM && dayBack <= CLEAN_TO) ? 4 : 5;
    return Math.max(1, Math.min(10, Math.round(base + rand(-1.5, 1.5))));
  }

  function seedSyntheticData(opts) {
    opts = opts || {};
    const slice = global.Store.get('bht') || {};
    const habits = (slice.habits || []).filter(h => !h.archived);
    if (habits.length === 0) {
      console.warn('[BHT-DEBUG] No active habits. Aborting seed.');
      return { ok: false, reason: 'no-habits' };
    }
    const triggers = (slice.vocab && slice.vocab.triggers) || [];
    const moods    = (slice.vocab && slice.vocab.moods)    || [];
    const coping   = (slice.vocab && slice.vocab.coping)   || [];

    function pickHabit() {
      const r = Math.random();
      if (r < 0.50 && habits[0]) return habits[0];
      if (r < 0.80 && habits[1]) return habits[1];
      return habits[Math.min(habits.length - 1, 2 + Math.floor(Math.random() * Math.max(1, habits.length - 2)))];
    }

    const created = [];
    const TARGET = 62;
    for (let i = 0; i < TARGET; i++) {
      const dayBack = distributeDay();
      const date = ymdBack(dayBack);
      const habit = pickHabit();
      const resisted = Math.random() < 0.15;
      const occurred = !resisted;
      const severity = occurred ? severityFor(dayBack) : 'minor';
      const sl  = sleepFor(dayBack);
      const sr  = stressFor(dayBack);
      const en  = Math.max(1, Math.min(10, 11 - sr + Math.round(rand(-1, 1))));
      const cf  = Math.max(1, Math.min(10, Math.round(rand(3, 8))));
      const trigPool  = triggers.length ? triggers : ['stress','boredom','fatigue','phone-nearby'];
      const moodPool  = moods.length    ? moods    : ['tired','tense','restless','calm','flat'];
      const copingP   = coping.length   ? coping   : ['walk','water','breathing 4-7-8','phone away'];

      const entry = global.BHT.logEntry({
        habitId: habit.id, date, occurred, resisted, severity,
        frequency: 1,
        urgeIntensity: Math.max(0, Math.min(10, Math.round(rand(2, 9)))),
        timeOfDay: todFor(),
        sleepHours: sl, stressLevel: sr, energyLevel: en, confidenceLevel: cf,
        copingMethod: occurred ? '' : pick(copingP),
        triggers: pickN(trigPool, 1 + Math.floor(Math.random() * 2)),
        moodBefore: pickN(moodPool, 1 + Math.floor(Math.random() * 2)),
        moodAfter:  occurred ? pickN(moodPool, 1) : ['calm'],
        recoveryActions: occurred && Math.random() < 0.35
          ? [{ text: pick(copingP), done: Math.random() < 0.6 }]
          : [],
        notes: SYNTH_TAG + ' generated ' + new Date().toISOString().slice(0, 10),
        automaticThoughts: occurred && Math.random() < 0.3 ? "just one won't matter" : '',
        rationalChallenge: occurred && Math.random() < 0.25 ? 'the next 90 minutes are what counts' : '',
        entryMethod: Math.random() < 0.7 ? 'quick-log' : 'manual'
      });
      created.push(entry.id);
    }

    const lifeEvents = [
      { title: 'АэроТраст first shift cycle', daysBack: 78, impact: 8 },
      { title: 'MAI application crunch week', daysBack: 42, impact: 7 },
      { title: 'Family call · Cairo',         daysBack: 14, impact: 4 }
    ];
    const evtIds = lifeEvents.map(ev => {
      const e = global.BHT.addLifeEvent({
        title: ev.title,
        startDate: ymdBack(ev.daysBack),
        perceivedStressImpact: ev.impact,
        notes: SYNTH_TAG
      });
      return e.id;
    });

    global.Store.set('bht.meta.initialized', true);
    global.BHT_ANALYTICS.recompute();

    console.log('[BHT-DEBUG] seeded', created.length, 'entries +', evtIds.length, 'life events.');
    return { ok: true, entries: created.length, events: evtIds.length, ids: { entries: created, events: evtIds } };
  }

  function clearSynthetic() {
    const slice = global.Store.get('bht') || {};
    const keepEntries = (slice.entries  || []).filter(e => !(e.notes && e.notes.indexOf(SYNTH_TAG) === 0));
    const keepEvents  = (slice.lifeEvents || []).filter(e => !(e.notes && e.notes.indexOf(SYNTH_TAG) === 0));
    const removedE = (slice.entries||[]).length - keepEntries.length;
    const removedL = (slice.lifeEvents||[]).length - keepEvents.length;
    global.Store.set('bht.entries', keepEntries);
    global.Store.set('bht.lifeEvents', keepEvents);
    console.log('[BHT-DEBUG] cleared', removedE, 'synthetic entries +', removedL, 'synthetic events.');
    return { entries: removedE, events: removedL };
  }

  function runIntegrationCheck() {
    const checks = [];
    function add(name, ok, info) { checks.push({ name, ok: !!ok, info: info || '' }); }

    add('Store',                  !!global.Store && typeof global.Store.get === 'function');
    add('BHT slice present',      !!global.Store.get('bht'));
    add('BHT API',                !!(global.BHT && global.BHT.logEntry && global.BHT.addSnapshot && global.BHT.exportSlice));
    add('Schema v7+',             (global.Store.get('meta') && global.Store.get('meta').version >= 7), 'core.js migration applied');
    add('dune_state_v4 in BACKUP_KEYS', (function(){
      try {
        if (typeof global.getAllBackupData === 'function') {
          return Object.prototype.hasOwnProperty.call(global.getAllBackupData(), 'dune_state_v4');
        }
        return null;
      } catch (e) { return null; }
    })(), 'core state ships with Gist sync');

    add('Nav button injected',    !!document.querySelector('.nmb[data-group="behavior"]'));
    add('#behavior section',      !!document.getElementById('behavior'));
    add('FAB present',            !!document.getElementById('bht-fab'));
    add('Overlay shell',          !!document.getElementById('bht-overlay'));
    add('Hotkey handler',         true, 'Ctrl/Cmd+Shift+B installed on document');

    add('BHT_COMPONENTS',         !!global.BHT_COMPONENTS);
    add('Reflect modal',          !!document.getElementById('bht-reflect'));

    add('BHT_ANALYTICS',          !!global.BHT_ANALYTICS);
    add('Worker thread',          !!(global.BHT_ANALYTICS && global.BHT_ANALYTICS.workerOk && global.BHT_ANALYTICS.workerOk()));
    add('Analytics result cached',!!(global.BHT_ANALYTICS && global.BHT_ANALYTICS.lastResult && global.BHT_ANALYTICS.lastResult()));
    add('Enrichment hook wired',  !!(global.BHT_ANALYTICS && typeof global.BHT_ANALYTICS.buildSnapshot === 'function'));

    add('BHT_COACH',              !!global.BHT_COACH);
    add('Provider router',        typeof global.BHT_COACH.callProvider === 'function');
    add('Offline generator',      typeof global.BHT_COACH.offlineGenerate === 'function');

    const sens = status();
    add('Cross-module sensor scan ran', !!sens, sens.found ? sens.kinds.map(k => k.kind+':'+k.path).join(' · ') : sens.note);
    add('Synthetic factory exposed', !!(global.BHT.debug && typeof global.BHT.debug.seedSyntheticData === 'function'));

    const passed = checks.filter(c => c.ok).length;
    const total  = checks.length;
    try { console.table(checks); } catch (e) { console.log(checks); }
    console.log('[BHT-DEBUG] integration: ' + passed + ' / ' + total + ' checks passed.');
    return { passed, total, checks };
  }

  function boot() {
    discover();
    global.Store.subscribe('*', () => {
      const before = JSON.stringify(sensorState.sources);
      discover();
      const after = JSON.stringify(sensorState.sources);
      if (before !== after) global.BHT_ANALYTICS.recompute();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_SENSORS = {
    discover, sleepForDate, stressForDate, enrichEntries, status
  };
  global.BHT.debug = {
    seedSyntheticData, clearSynthetic, runIntegrationCheck,
    sensors: () => status()
  };
})(window);
