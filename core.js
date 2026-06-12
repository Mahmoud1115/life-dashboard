// ============================================================
// DUNE LIFE OS — CORE
// Single source of truth · reactive store · versioned schema
// auto-save with snapshots · pure derivations
// ============================================================

(function (global) {
  'use strict';

  // ──────────────────────────────────────────────
  // SCHEMA
  // ──────────────────────────────────────────────
  const SCHEMA_VERSION = 5;
  const STATE_KEY = 'dune_state_v4';
  const SNAPSHOTS_KEY = 'dune_snapshots_v1';
  const MAX_SNAPSHOTS = 8;
  const SAVE_DEBOUNCE_MS = 300;

  function nowISO() { return new Date().toISOString(); }

  function defaultState() {
    return {
      money: {
        salary_net: 130000,
        expenses: {
          rent: 26000, food: 16000, transport: 5000,
          utilities: 3500, phone: 1500, family_transfer: 0,
          other: 8000, mai: 0
        },
        usd_rate: 88,
        save_target: 55000
      },
      qatarVisit: {
        from_airport: 'SVO',
        to_airport: 'DOH',
        travel_month: '',
        flights: 35000,
        hotel: 45000,
        food: 18000,
        transport: 5000,
        misc: 5000,
        emergency: 10000,
        saved: 0,
        notes: ''
      },
      todayFocus: [
        '',
        '',
        ''
      ],
      goals: {},
      career: {
        started: '2024-06-01',
        company: 'АэроТраст',
        position: 'Engine technician — CFM56-5B overhaul',
        aircraft: ['An-28'],
        engines: ['TVD-10', 'CFM56-5B'],
        licenses: [
          { id: 'l_favt_a', name: 'ФАВТ Category A', status: 'planned', target: '2027-09-01' }
        ],
        certificates: [],
        milestones: [
          { id: 'm0', at: '2024-06-01', text: 'Started aviation career (Ryazan)' }
        ]
      },
      easa: {},
      logbook: [],
      reviews: [],
      decisions: [],
      timeline: [
        { id: 't_birth', at: '2000-01-21', kind: 'past', text: 'Born' },
        { id: 't_egypt', at: '2018-09-01', kind: 'past', text: 'Began studies' },
        { id: 't_russia', at: '2020-09-01', kind: 'past', text: 'Moved to Russia for university' },
        { id: 't_deg', at: '2024-06-01', kind: 'past', text: 'Engineering degree completed' },
        { id: 't_ryazan', at: '2024-09-01', kind: 'past', text: 'First aviation job (Ryazan, An-28/TVD-10)' },
        { id: 't_moscow', at: '2026-06-15', kind: 'current', text: 'АэроТраст · CFM56-5B overhaul · 130k net' },
        { id: 't_vnzh', at: '2027-03-01', kind: 'future', text: 'ВНЖ renewal' },
        { id: 't_pass', at: '2027-06-01', kind: 'future', text: 'Egyptian passport renewal (age 27)' },
        { id: 't_cata', at: '2027-09-01', kind: 'future', text: 'ФАВТ Category A application' },
        { id: 't_easa', at: '2029-06-01', kind: 'future', text: 'EASA Part-66 B1.1 — all 15 modules' }
      ],
      about: {
        version: 2,
        createdAt: 'June 2026',
        lastUpdated: '11 June 2026',
        strengths: [
          'Metabolize pain into structure',
          'Vision plus precision — ambitious and meticulous',
          'Bilingual technical mind (RU + EN, working Russian)',
          'Faith held quietly under pressure'
        ],
        lessons: [
          'Discipline can become a wall — choose connection on purpose',
          'Rest is a safety system in aviation, not a luxury',
          'Nothing essential is ever lost — only futures imagined'
        ],
        vision: 'Master CFM56-5B overhaul. Stack EASA Part-66 modules. Save 55k a month. Build the kind of engineer nobody can ignore.',
        values: ['Deen', 'Family', 'Mastery', 'Discipline', 'Honesty'],
        reminders: [
          'You restructured your whole life in one week. That is rare.',
          'You are 26 with a 130k net job, a savings system, and a license pipeline. You are not behind — you are early.',
          'The plan needs you sane and warm, not just disciplined.'
        ]
      },
      apartments: [],
      sbTasks: {},
      meta: {
        version: SCHEMA_VERSION,
        createdAt: nowISO(),
        lastUpdated: nowISO()
      }
    };
  }

  // ──────────────────────────────────────────────
  // MIGRATIONS
  // ──────────────────────────────────────────────
  function migrateFromLegacy() {
    const s = defaultState();
    function safe(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }

    const oldFin = safe('dune_finance_v1');
    if (oldFin && oldFin.russia) {
      const r = oldFin.russia;
      if (typeof r.salary === 'number') s.money.salary_net = r.salary;
      if (typeof r.usd_rate === 'number') s.money.usd_rate = r.usd_rate;
      if (typeof r.save_target === 'number') s.money.save_target = r.save_target;
      ['rent','food','transport','utilities','phone','family_transfer','other','mai'].forEach(k => {
        if (typeof r[k] === 'number') s.money.expenses[k] = r[k];
      });
    }

    const oldGoals = safe('dune_goals_v1');
    if (oldGoals && typeof oldGoals === 'object') s.goals = oldGoals;

    const oldEasa = safe('dune_easa_v1');
    if (oldEasa && typeof oldEasa === 'object') s.easa = oldEasa;

    const oldLb = safe('dune_logbook_v1');
    if (Array.isArray(oldLb)) s.logbook = oldLb;

    const oldApts = safe('dune_apartments_v1');
    if (Array.isArray(oldApts)) s.apartments = oldApts;

    const oldSb = safe('dune_sb_v1');
    if (oldSb && typeof oldSb === 'object') s.sbTasks = oldSb;

    return s;
  }

  function migrateUp(data, fromVersion) {
    // Forward-only migration pipeline. Each step is small and idempotent.
    let s = data || {};
    if (!s.meta) s.meta = { version: fromVersion || 1, createdAt: nowISO(), lastUpdated: nowISO() };

    // v1/v2/v3 → v4: ensure all top-level keys exist
    const def = defaultState();
    for (const k of Object.keys(def)) {
      if (!(k in s)) s[k] = def[k];
    }
    if (!s.money.expenses) s.money.expenses = def.money.expenses;
    if (!Array.isArray(s.todayFocus)) s.todayFocus = def.todayFocus;
    if (!Array.isArray(s.timeline)) s.timeline = def.timeline;
    if (!Array.isArray(s.reviews)) s.reviews = [];
    if (!Array.isArray(s.decisions)) s.decisions = [];
    if (!s.about) s.about = def.about;
    // about v1 → v2: switch to friendly date labels + version
    if (s.about && (s.about.version || 1) < 2) {
      s.about.version = 2;
      s.about.createdAt = 'June 2026';
      s.about.lastUpdated = '11 June 2026';
    }
    if (!s.career) s.career = def.career;
    if (!s.qatarVisit) s.qatarVisit = def.qatarVisit;
    s.meta.version = SCHEMA_VERSION;
    s.meta.lastUpdated = nowISO();
    return s;
  }

  // ──────────────────────────────────────────────
  // LOAD / SAVE / SNAPSHOTS / INTEGRITY
  // ──────────────────────────────────────────────
  function pushSnapshot(payload) {
    try {
      const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
      snaps.unshift({ at: nowISO(), payload });
      while (snaps.length > MAX_SNAPSHOTS) snaps.pop();
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snaps));
    } catch (e) { /* quota — silent */ }
  }

  function restoreFromSnapshot() {
    try {
      const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
      for (const s of snaps) {
        try {
          const parsed = JSON.parse(s.payload);
          if (parsed && parsed.data) return migrateUp(parsed.data, parsed.version);
        } catch (e) { continue; }
      }
    } catch (e) { }
    return null;
  }

  function validate(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.money || typeof data.money.salary_net !== 'number') return false;
    if (!data.qatarVisit) return false;
    return true;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const data = (parsed && parsed.version === SCHEMA_VERSION && parsed.data)
          ? parsed.data
          : migrateUp((parsed && parsed.data) || {}, (parsed && parsed.version) || 0);
        if (validate(data)) return data;
        console.warn('[Store] integrity check failed — trying snapshot');
        return restoreFromSnapshot() || migrateFromLegacy();
      }
      // First load — migrate from legacy keys if present
      return migrateFromLegacy();
    } catch (e) {
      console.error('[Store] load failed:', e);
      return restoreFromSnapshot() || defaultState();
    }
  }

  let state = load();
  let saveTimer = null;
  let saveListeners = new Set();

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
  }

  function persistNow() {
    try {
      state.meta.lastUpdated = nowISO();
      const payload = JSON.stringify({ version: SCHEMA_VERSION, data: state });
      localStorage.setItem(STATE_KEY, payload);
      pushSnapshot(payload);
      saveListeners.forEach(fn => { try { fn(state); } catch (e) {} });
    } catch (e) {
      console.error('[Store] save failed:', e);
    }
  }

  // ──────────────────────────────────────────────
  // PUB/SUB
  // ──────────────────────────────────────────────
  const subscribers = new Map(); // path → Set<fn>

  function subscribe(path, fn) {
    if (!subscribers.has(path)) subscribers.set(path, new Set());
    subscribers.get(path).add(fn);
    // Fire immediately with current state so subscribers can hydrate
    try { fn(state); } catch (e) { console.error('[Store] sub immediate:', e); }
    return () => { const set = subscribers.get(path); if (set) set.delete(fn); };
  }

  function notify(changedPath) {
    for (const [path, fns] of subscribers) {
      if (path === '*' || path === changedPath || changedPath.startsWith(path + '.') || path.startsWith(changedPath + '.')) {
        fns.forEach(fn => { try { fn(state); } catch (e) { console.error('[Store] notify:', e); } });
      }
    }
  }

  // ──────────────────────────────────────────────
  // GET / SET / UPDATE
  // ──────────────────────────────────────────────
  function get(path) {
    if (!path) return state;
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), state);
  }

  function set(path, val) {
    const keys = path.split('.');
    let cur = state;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
      cur = cur[k];
    }
    cur[keys[keys.length - 1]] = val;
    scheduleSave();
    notify(path);
  }

  function update(path, updater) {
    const cur = get(path);
    const next = updater(cur);
    set(path, next);
  }

  // ──────────────────────────────────────────────
  // DERIVATIONS — pure, side-effect-free
  // ──────────────────────────────────────────────
  const derive = {
    monthlyExpenses(s) {
      const e = (s || state).money.expenses;
      return (e.rent||0)+(e.food||0)+(e.transport||0)+(e.utilities||0)+(e.phone||0)+(e.family_transfer||0)+(e.other||0)+(e.mai||0);
    },
    monthlySurplus(s) {
      s = s || state;
      return s.money.salary_net - derive.monthlyExpenses(s);
    },
    saveTargetHitPct(s) {
      s = s || state;
      const t = s.money.save_target || 1;
      return Math.max(0, Math.round(derive.monthlySurplus(s) / t * 100));
    },
    savingsPerYearAtTarget(s) {
      return (s || state).money.save_target * 12;
    },
    monthlyToUSD(s, rub) {
      const r = (s || state).money.usd_rate || 88;
      return rub / r;
    },
    qatarTotal(s) {
      const q = (s || state).qatarVisit;
      return (q.flights||0)+(q.hotel||0)+(q.food||0)+(q.transport||0)+(q.misc||0)+(q.emergency||0);
    },
    qatarRemaining(s) {
      s = s || state;
      return Math.max(0, derive.qatarTotal(s) - (s.qatarVisit.saved||0));
    },
    qatarProgressPct(s) {
      const t = derive.qatarTotal(s);
      return t > 0 ? Math.min(100, Math.round(((s||state).qatarVisit.saved||0) / t * 100)) : 0;
    },
    qatarMonthlyCapacity(s) {
      s = s || state;
      // We assume goal contributions come out of the 55k savings target
      const surplus = derive.monthlySurplus(s);
      return Math.max(0, Math.min(surplus, s.money.save_target));
    },
    qatarMonthsToGo(s) {
      const remaining = derive.qatarRemaining(s);
      if (remaining === 0) return 0;
      const cap = derive.qatarMonthlyCapacity(s);
      if (cap <= 0) return Infinity;
      return Math.ceil(remaining / cap);
    },
    qatarETA(s) {
      const months = derive.qatarMonthsToGo(s);
      if (!isFinite(months)) return null;
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      return d;
    },
    qatarOnTrack(s) {
      s = s || state;
      if (!s.qatarVisit.travel_month) return null;
      const eta = derive.qatarETA(s);
      if (!eta) return false;
      const target = new Date(s.qatarVisit.travel_month + '-01');
      return eta <= target;
    },
    careerMonths(s) {
      s = s || state;
      const start = new Date(s.career.started);
      const now = new Date();
      return Math.max(0, (now.getFullYear()-start.getFullYear())*12 + (now.getMonth()-start.getMonth()));
    },
    monthsToCatA(s) {
      s = s || state;
      const lic = (s.career.licenses||[]).find(l => l.id === 'l_favt_a');
      if (!lic || !lic.target) return null;
      const t = new Date(lic.target);
      const now = new Date();
      return Math.max(0, (t.getFullYear()-now.getFullYear())*12 + (t.getMonth()-now.getMonth()));
    },
    easaProgress(s) {
      s = s || state;
      try {
        if (typeof D === 'undefined' || !D.easa) return { done: 0, total: 0, pct: 0 };
        const stored = s.easa || {};
        const total = D.easa.length;
        let done = 0, totalPct = 0;
        D.easa.forEach(m => {
          const sm = stored[m.id] || {};
          const status = sm.status || m.status;
          if (status === 'done') done++;
          totalPct += (sm.progress !== undefined ? sm.progress : m.progress);
        });
        return { done, total, pct: total ? Math.round(totalPct / total) : 0 };
      } catch (e) { return { done: 0, total: 0, pct: 0 }; }
    },
    logbookStats(s) {
      const lb = (s || state).logbook || [];
      const hours = lb.reduce((a, e) => a + (parseFloat(e.hours) || 0), 0);
      return { entries: lb.length, hours };
    }
  };

  // ──────────────────────────────────────────────
  // PUBLIC API
  // ──────────────────────────────────────────────
  global.Store = {
    SCHEMA_VERSION,
    get,
    set,
    update,
    subscribe,
    onSave: (fn) => { saveListeners.add(fn); return () => saveListeners.delete(fn); },
    raw: () => state,
    persistNow,
    defaultState,
    snapshots: () => {
      try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]'); } catch (e) { return []; }
    },
    restoreSnapshot: (i) => {
      try {
        const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
        const snap = snaps[i || 0];
        if (!snap) return false;
        const parsed = JSON.parse(snap.payload);
        state = migrateUp(parsed.data, parsed.version);
        persistNow();
        notify('*');
        return true;
      } catch (e) { return false; }
    },
    reset: () => { state = defaultState(); persistNow(); notify('*'); },
    derive
  };
})(window);
