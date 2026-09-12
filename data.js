// DUNE LIFE OS — Structured Data Layer
// Version: 3.1 — PRV-0.5 (2026-08-28): deadlines / claims / risks / goals
// moved to _migration-legacy-records.js and now live under durable Store
// paths `records.deadlines / .claims / .risks / .goals` (ADR-015).
// Only the two seed-only domains that are safe to sanitize with a
// fallback-default pattern remain here.

const D = {};

// ═══════════════════════════════════════════
// EASA MODULE TRACKER
// Public EASA Part-66 module list. Per-user progress/status is stored
// under `dune_easa_v1` (per-id overrides); those overrides win at
// render time. IDs must remain stable across PRV-1 sanitization so
// existing overrides continue to bind — see ADR-015 §EASA.
// ═══════════════════════════════════════════
D.easa = [
  { id:'ea01', num:'M1',  title:'Mathematics',                           status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea02', num:'M2',  title:'Physics',                               status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea03', num:'M3',  title:'Electrical Fundamentals',               status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea04', num:'M4',  title:'Electronic Fundamentals',               status:'not_started', progress:0,  priority:'low',    note:'' },
  { id:'ea05', num:'M5',  title:'Digital Techniques & Computer Systems', status:'not_started', progress:0,  priority:'low',    note:'' },
  { id:'ea06', num:'M6',  title:'Materials & Hardware',                  status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea07', num:'M7',  title:'Maintenance Practices',                 status:'not_started', progress:0,  priority:'high',   note:'Strong area — practical experience applies directly' },
  { id:'ea08', num:'M8',  title:'Basic Aerodynamics',                    status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea09', num:'M9',  title:'Human Factors',                         status:'not_started', progress:0,  priority:'high',   note:'Short module, high pass rate. Start early.' },
  { id:'ea10', num:'M10', title:'Aviation Legislation',                  status:'not_started', progress:0,  priority:'high',   note:'Critical for license application. Do not skip.' },
  { id:'ea11', num:'M11A',title:'Turbine Aeroplane Aero & Structures',   status:'not_started', progress:0,  priority:'high',   note:'A320/B737 directly relevant' },
  { id:'ea12', num:'M13', title:'Aircraft Aerodynamics, Structures & Systems', status:'not_started', progress:0, priority:'medium', note:'' },
  { id:'ea13', num:'M14', title:'Propulsion',                            status:'not_started', progress:0,  priority:'high',   note:'' },
  { id:'ea14', num:'M15', title:'Gas Turbine Engine',                    status:'studying',    progress:20, priority:'high',   note:'START HERE — strongest area, CFM56 work compounds it daily' },
  { id:'ea15', num:'M17A',title:'Propeller',                             status:'not_started', progress:0,  priority:'low',    note:'Least critical for turbine path' }
];

// ═══════════════════════════════════════════
// FINANCE DEFAULTS — Moscow (net salary)
// Fallback-only for browsers with no `dune_finance_v1` in localStorage.
// Existing populated finance state wins.
// ═══════════════════════════════════════════
D.finance = {
  russia: {
    salary: 130000, rent: 26000, food: 16000, transport: 5000,
    utilities: 3500, phone: 1500, family_transfer: 0,
    other: 8000, mai: 0, usd_rate: 88,
    save_target: 55000
  }
};

// ═══════════════════════════════════════════
// Compatibility shims — read-only accessors that expose the migrated
// domains to any legacy call site that references `D.deadlines /
// .goals / .claims / .risks`. Every runtime renderer now reads from
// the Store directly (see ADR-015). These accessors return the same
// arrays the Store would return, and exist ONLY so a stray reference
// (e.g. downloaded ICS from window.downloadAllICS) resolves to
// authoritative live data rather than to `undefined`. They are NOT
// authoritative; they proxy to the Store snapshot.
// ═══════════════════════════════════════════
Object.defineProperties(D, {
  deadlines: {
    get() {
      if (window.Store && typeof window.Store.get === 'function') {
        const v = window.Store.get('records.deadlines');
        if (Array.isArray(v)) return v;
      }
      return [];
    },
    enumerable: true
  },
  goals: {
    get() {
      if (window.Store && typeof window.Store.get === 'function') {
        const v = window.Store.get('records.goals');
        if (Array.isArray(v)) return v;
      }
      return [];
    },
    enumerable: true
  },
  claims: {
    get() {
      if (window.Store && typeof window.Store.get === 'function') {
        const v = window.Store.get('records.claims');
        if (Array.isArray(v)) return v;
      }
      return [];
    },
    enumerable: true
  },
  risks: {
    get() {
      if (window.Store && typeof window.Store.get === 'function') {
        const v = window.Store.get('records.risks');
        if (Array.isArray(v)) return v;
      }
      return [];
    },
    enumerable: true
  }
});
