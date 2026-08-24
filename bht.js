// ============================================================
// DUNE LIFE OS — BEHAVIOR INTELLIGENCE (BHT)
// Self-awareness layer · habits · entries · weekly snapshots
// Lives inside Store.raw().bht — inherits save, snapshots, sync
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store) {
    console.error('[BHT] core.js must load before bht.js');
    return;
  }

  // ──────────────────────────────────────────────
  // SCHEMA · enums · defaults
  // ──────────────────────────────────────────────
  const BHT_VERSION = 1;

  const CATEGORIES = ['focus', 'consumption', 'sleep', 'screen', 'mood', 'other'];
  const SEVERITIES = ['minor', 'moderate', 'major'];
  const TIME_OF_DAY = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const ENTRY_METHODS = ['manual', 'quick-log', 'voice'];

  const DEFAULT_TRIGGERS = [
    'stress', 'boredom', 'fatigue', 'loneliness', 'phone-nearby',
    'late-evening', 'post-shift', 'after-meal', 'social-media', 'unstructured-time'
  ];
  const DEFAULT_COPING = [
    'walk', 'wudu + salah', 'water', 'breathing 4-7-8',
    'put phone away', 'switch task', 'sleep early', 'call family'
  ];
  const DEFAULT_MOODS = [
    'calm', 'tense', 'tired', 'restless', 'focused',
    'anxious', 'flat', 'content', 'frustrated', 'hopeful'
  ];

  const DEFAULT_HABITS = [
    { name: 'Procrastination',     category: 'focus',       severityWeight: 3 },
    { name: 'Doomscrolling',       category: 'screen',      severityWeight: 3 },
    { name: 'Late-night snacking', category: 'consumption', severityWeight: 2 }
  ];

  // ──────────────────────────────────────────────
  // UTILITIES
  // ──────────────────────────────────────────────
  function nowISO() { return new Date().toISOString(); }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function isYMD(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // ──────────────────────────────────────────────
  // DEFAULT SLICE
  // ──────────────────────────────────────────────
  function defaultBhtState() {
    return {
      meta: { version: BHT_VERSION, createdAt: nowISO(), lastUpdated: nowISO() },
      habits: DEFAULT_HABITS.map(h => ({
        id: uid('b'),
        name: h.name,
        category: h.category,
        severityWeight: h.severityWeight,
        archived: false,
        createdAt: nowISO()
      })),
      entries: [],
      snapshots: [],
      lifeEvents: [],
      vocab: {
        triggers: DEFAULT_TRIGGERS.slice(),
        coping:   DEFAULT_COPING.slice(),
        moods:    DEFAULT_MOODS.slice()
      },
      ai: {
        provider: 'fallback',
        ollamaUrl: 'http://localhost:11434',
        model: ''
      }
    };
  }

  // ──────────────────────────────────────────────
  // MIGRATION
  // ──────────────────────────────────────────────
  function migrateSlice(slice) {
    const def = defaultBhtState();
    if (!slice || typeof slice !== 'object') return def;
    for (const k of Object.keys(def)) {
      if (!(k in slice)) slice[k] = def[k];
    }
    if (!Array.isArray(slice.habits))     slice.habits     = [];
    if (!Array.isArray(slice.entries))    slice.entries    = [];
    if (!Array.isArray(slice.snapshots))  slice.snapshots  = [];
    if (!Array.isArray(slice.lifeEvents)) slice.lifeEvents = [];
    if (!slice.vocab) slice.vocab = def.vocab;
    slice.ai = sanitizeAI(slice.ai, def.ai);
    slice.meta = slice.meta || def.meta;
    slice.meta.version = BHT_VERSION;
    slice.meta.lastUpdated = nowISO();
    return slice;
  }

  // Normalize BHT AI config into the ADR-005 invariant:
  // - shape is always a plain object,
  // - provider is always 'fallback' or 'ollama',
  // - no apiKey field survives,
  // - valid Ollama/fallback settings are preserved.
  // Idempotent: on already-clean input, returns unchanged shape and does not log.
  // Never logs the removed value.
  function sanitizeAI(ai, defAI) {
    const ALLOWED = ['fallback', 'ollama'];
    const isPlainObject = ai && typeof ai === 'object' && !Array.isArray(ai);
    if (!isPlainObject) {
      if (typeof console !== 'undefined' && console.info) {
        console.info('[BHT] Malformed AI config replaced with defaults (ADR-005).');
      }
      return Object.assign({}, defAI);
    }
    let changed = false;
    if (ALLOWED.indexOf(ai.provider) === -1) {
      ai.provider = 'fallback';
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(ai, 'apiKey')) {
      delete ai.apiKey;
      changed = true;
    }
    if (changed && typeof console !== 'undefined' && console.info) {
      console.info('[BHT] Legacy/invalid AI config normalized (ADR-005).');
    }
    return ai;
  }

  (function ensureSlice() {
    const cur = global.Store.get('bht');
    if (!cur) {
      global.Store.set('bht', defaultBhtState());
      return;
    }
    const fixed = migrateSlice(cur);
    // Re-seed defaults if an earlier core.js fallback created an empty husk
    // (happens on first load after upgrade — core.js can't see BHT defaults
    // until bht.js has executed).
    const empty = (!fixed.habits || fixed.habits.length === 0) &&
                  (!fixed.entries || fixed.entries.length === 0);
    if (empty) {
      const def = defaultBhtState();
      fixed.habits = def.habits;
      if (!fixed.vocab || !fixed.vocab.triggers || fixed.vocab.triggers.length === 0) fixed.vocab = def.vocab;
      if (!fixed.ai) fixed.ai = def.ai;
    }
    global.Store.set('bht', fixed);
  })();

  // ──────────────────────────────────────────────
  // VALIDATION
  // ──────────────────────────────────────────────
  function validHabit(h) {
    return h && typeof h.id === 'string' && typeof h.name === 'string' &&
      CATEGORIES.indexOf(h.category) !== -1 &&
      typeof h.severityWeight === 'number';
  }
  function validEntry(e) {
    return e && typeof e.id === 'string' && typeof e.habitId === 'string' &&
      isYMD(e.date) && typeof e.occurred === 'boolean' &&
      SEVERITIES.indexOf(e.severity) !== -1 &&
      TIME_OF_DAY.indexOf(e.timeOfDay) !== -1;
  }
  function validSlice(s) {
    if (!s || typeof s !== 'object') return false;
    if (!Array.isArray(s.habits) || !Array.isArray(s.entries)) return false;
    return s.habits.every(validHabit) && s.entries.every(validEntry);
  }

  // ──────────────────────────────────────────────
  // ACTIONS · habits
  // ──────────────────────────────────────────────
  function addHabit(input) {
    const h = {
      id: uid('b'),
      name: String(input.name || 'Untitled').trim().slice(0, 80),
      category: CATEGORIES.indexOf(input.category) !== -1 ? input.category : 'other',
      severityWeight: clamp(parseInt(input.severityWeight, 10) || 3, 1, 5),
      archived: false,
      createdAt: nowISO()
    };
    global.Store.update('bht.habits', list => list.concat([h]));
    touch();
    return h;
  }
  function updateHabit(id, patch) {
    global.Store.update('bht.habits', list => list.map(h => {
      if (h.id !== id) return h;
      const next = Object.assign({}, h, patch);
      if (patch.category && CATEGORIES.indexOf(patch.category) === -1) next.category = h.category;
      if (patch.severityWeight != null) next.severityWeight = clamp(parseInt(patch.severityWeight, 10) || h.severityWeight, 1, 5);
      if (patch.name != null) next.name = String(patch.name).trim().slice(0, 80);
      return next;
    }));
    touch();
  }
  function archiveHabit(id, archived) {
    updateHabit(id, { archived: !!archived });
  }
  function removeHabit(id, opts) {
    if (opts && opts.purgeEntries) {
      global.Store.update('bht.entries', list => list.filter(e => e.habitId !== id));
      global.Store.update('bht.habits',  list => list.filter(h => h.id !== id));
    } else {
      archiveHabit(id, true);
    }
    touch();
  }

  // ──────────────────────────────────────────────
  // ACTIONS · entries
  // ──────────────────────────────────────────────
  function makeEntry(input) {
    const t = new Date();
    const hour = t.getHours();
    const guessedTOD =
      hour < 6  ? 'Night'    :
      hour < 12 ? 'Morning'  :
      hour < 17 ? 'Afternoon':
      hour < 22 ? 'Evening'  : 'Night';

    return {
      id: uid('e'),
      habitId: String(input.habitId),
      date: isYMD(input.date) ? input.date : todayKey(),
      occurred: input.occurred !== false,
      frequency: clamp(parseInt(input.frequency, 10) || 1, 0, 99),
      severity: SEVERITIES.indexOf(input.severity) !== -1 ? input.severity : 'minor',
      urgeIntensity: clamp(parseInt(input.urgeIntensity, 10) || 0, 0, 10),
      resisted: !!input.resisted,
      copingMethod: input.copingMethod || '',
      moodBefore: Array.isArray(input.moodBefore) ? input.moodBefore : [],
      moodAfter:  Array.isArray(input.moodAfter)  ? input.moodAfter  : [],
      triggers:   Array.isArray(input.triggers)   ? input.triggers   : [],
      notes: input.notes || '',
      automaticThoughts: input.automaticThoughts || '',
      rationalChallenge: input.rationalChallenge || '',
      location: input.location || '',
      company:  input.company  || '',
      timeOfDay: TIME_OF_DAY.indexOf(input.timeOfDay) !== -1 ? input.timeOfDay : guessedTOD,
      sleepHours:      input.sleepHours      != null ? clamp(parseFloat(input.sleepHours), 0, 24)   : null,
      stressLevel:     input.stressLevel     != null ? clamp(parseInt(input.stressLevel,10), 1, 10) : null,
      energyLevel:     input.energyLevel     != null ? clamp(parseInt(input.energyLevel,10), 1, 10) : null,
      confidenceLevel: input.confidenceLevel != null ? clamp(parseInt(input.confidenceLevel,10),1,10): null,
      entryMethod: ENTRY_METHODS.indexOf(input.entryMethod) !== -1 ? input.entryMethod : 'manual',
      lifeEventId: input.lifeEventId || null,
      recoveryActions: Array.isArray(input.recoveryActions) ? input.recoveryActions : [],
      createdAt: nowISO(),
      updatedAt: nowISO()
    };
  }
  function logEntry(input) {
    const e = makeEntry(input);
    global.Store.update('bht.entries', list => list.concat([e]));
    touch();
    return e;
  }
  function updateEntry(id, patch) {
    global.Store.update('bht.entries', list => list.map(e => {
      if (e.id !== id) return e;
      const next = Object.assign({}, e, patch, { updatedAt: nowISO() });
      if (patch.severity  && SEVERITIES.indexOf(patch.severity)   === -1) next.severity  = e.severity;
      if (patch.timeOfDay && TIME_OF_DAY.indexOf(patch.timeOfDay) === -1) next.timeOfDay = e.timeOfDay;
      if (patch.date && !isYMD(patch.date)) next.date = e.date;
      return next;
    }));
    touch();
  }
  function removeEntry(id) {
    global.Store.update('bht.entries', list => list.filter(e => e.id !== id));
    touch();
  }

  // ──────────────────────────────────────────────
  // ACTIONS · snapshots & life events
  // ──────────────────────────────────────────────
  function addSnapshot(input) {
    const s = {
      id: uid('s'),
      weekStart: isYMD(input.weekStart) ? input.weekStart : weekStartOf(todayKey()),
      summary: input.summary || '',
      trends:  Array.isArray(input.trends)  ? input.trends  : [],
      riskScore: clamp(parseInt(input.riskScore, 10) || 0, 0, 100),
      primaryTriggers: Array.isArray(input.primaryTriggers) ? input.primaryTriggers : [],
      wins:            Array.isArray(input.wins)            ? input.wins            : [],
      recommendations: Array.isArray(input.recommendations) ? input.recommendations : [],
      generatedBy: input.generatedBy || 'fallback',
      createdAt: nowISO()
    };
    global.Store.update('bht.snapshots', list => list.concat([s]));
    touch();
    return s;
  }
  function addLifeEvent(input) {
    const ev = {
      id: uid('lv'),
      title: String(input.title || '').trim().slice(0, 120),
      startDate: isYMD(input.startDate) ? input.startDate : todayKey(),
      endDate:   isYMD(input.endDate)   ? input.endDate   : null,
      perceivedStressImpact: clamp(parseInt(input.perceivedStressImpact, 10) || 5, 1, 10),
      notes: input.notes || '',
      createdAt: nowISO()
    };
    global.Store.update('bht.lifeEvents', list => list.concat([ev]));
    touch();
    return ev;
  }
  function removeLifeEvent(id) {
    global.Store.update('bht.lifeEvents', list => list.filter(e => e.id !== id));
    touch();
  }

  // ──────────────────────────────────────────────
  // ACTIONS · AI config
  // ──────────────────────────────────────────────
  function setAIConfig(patch) {
    const cur = global.Store.get('bht.ai') || {};
    const next = Object.assign({}, cur, patch);
    if (['fallback','ollama'].indexOf(next.provider) === -1) {
      next.provider = (['fallback','ollama'].indexOf(cur.provider) !== -1) ? cur.provider : 'fallback';
    }
    if ('apiKey' in next) delete next.apiKey;
    global.Store.set('bht.ai', next);
    touch();
  }

  function touch() {
    const m = global.Store.get('bht.meta') || { version: BHT_VERSION, createdAt: nowISO() };
    m.lastUpdated = nowISO();
    global.Store.set('bht.meta', m);
  }

  // ──────────────────────────────────────────────
  // DERIVATIONS
  // ──────────────────────────────────────────────
  function weekStartOf(ymd) {
    const d = new Date(ymd + 'T00:00:00');
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function daysBetween(a, b) {
    const ms = new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00');
    return Math.floor(ms / 86400000);
  }

  const derive = {
    activeHabits(s) {
      return ((s || global.Store.raw()).bht.habits || []).filter(h => !h.archived);
    },
    entriesByHabit(s, habitId) {
      return ((s || global.Store.raw()).bht.entries || []).filter(e => e.habitId === habitId);
    },
    entriesOn(s, ymd) {
      return ((s || global.Store.raw()).bht.entries || []).filter(e => e.date === ymd);
    },
    cleanStreakDays(s, habitId) {
      const entries = derive.entriesByHabit(s, habitId)
        .filter(e => e.occurred)
        .map(e => e.date)
        .sort();
      if (entries.length === 0) return Infinity;
      const last = entries[entries.length - 1];
      return daysBetween(last, todayKey());
    },
    longestCleanStreak(s, habitId) {
      const slips = derive.entriesByHabit(s, habitId)
        .filter(e => e.occurred)
        .map(e => e.date)
        .sort();
      if (slips.length === 0) return null;
      let longest = 0;
      let prev = null;
      for (const d of slips) {
        if (prev) longest = Math.max(longest, daysBetween(prev, d) - 1);
        prev = d;
      }
      longest = Math.max(longest, daysBetween(prev, todayKey()));
      return longest;
    },
    weeklyOccurrence(s, habitId, weekStart) {
      const ws = weekStart || weekStartOf(todayKey());
      const end = new Date(ws + 'T00:00:00');
      end.setDate(end.getDate() + 7);
      return derive.entriesByHabit(s, habitId)
        .filter(e => e.occurred && e.date >= ws && new Date(e.date + 'T00:00:00') < end)
        .length;
    },
    overallRiskScore(s) {
      s = s || global.Store.raw();
      const habits = derive.activeHabits(s);
      if (habits.length === 0) return 0;
      const sevenDaysAgo = (() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.getFullYear() + '-' +
          String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0');
      })();
      const recent = (s.bht.entries || []).filter(e => e.occurred && e.date >= sevenDaysAgo);
      let score = 0;
      for (const e of recent) {
        const h = habits.find(x => x.id === e.habitId);
        if (!h) continue;
        const sevMult = e.severity === 'major' ? 3 : e.severity === 'moderate' ? 2 : 1;
        score += h.severityWeight * sevMult;
      }
      return clamp(Math.round(score), 0, 100);
    }
  };

  // ──────────────────────────────────────────────
  // SERIALIZATION
  // ──────────────────────────────────────────────
  function exportSlice() {
    return {
      version: BHT_VERSION,
      exportedAt: nowISO(),
      data: JSON.parse(JSON.stringify(global.Store.get('bht') || defaultBhtState()))
    };
  }
  function importSlice(payload, opts) {
    if (!payload || !payload.data) return { ok: false, reason: 'empty payload' };
    const migrated = migrateSlice(JSON.parse(JSON.stringify(payload.data)));
    if (!validSlice(migrated)) return { ok: false, reason: 'integrity check failed' };
    if (opts && opts.merge) {
      const cur = global.Store.get('bht') || defaultBhtState();
      const mergeArr = (a, b) => {
        const map = new Map(a.map(x => [x.id, x]));
        b.forEach(x => map.set(x.id, x));
        return Array.from(map.values());
      };
      cur.habits     = mergeArr(cur.habits,     migrated.habits);
      cur.entries    = mergeArr(cur.entries,    migrated.entries);
      cur.snapshots  = mergeArr(cur.snapshots,  migrated.snapshots);
      cur.lifeEvents = mergeArr(cur.lifeEvents, migrated.lifeEvents);
      cur.vocab = migrated.vocab || cur.vocab;
      cur.meta.lastUpdated = nowISO();
      global.Store.set('bht', cur);
    } else {
      global.Store.set('bht', migrated);
    }
    return { ok: true, counts: {
      habits: migrated.habits.length,
      entries: migrated.entries.length,
      snapshots: migrated.snapshots.length,
      lifeEvents: migrated.lifeEvents.length
    }};
  }

  // ──────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────
  global.BHT = {
    BHT_VERSION,
    CATEGORIES, SEVERITIES, TIME_OF_DAY, ENTRY_METHODS,
    defaultBhtState,
    migrateSlice,
    validSlice,
    addHabit, updateHabit, archiveHabit, removeHabit,
    logEntry, updateEntry, removeEntry,
    addSnapshot, addLifeEvent, removeLifeEvent,
    setAIConfig,
    derive,
    weekStartOf, todayKey, uid,
    exportSlice, importSlice
  };
})(window);
