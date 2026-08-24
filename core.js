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
  const SCHEMA_VERSION = 12;
  const STATE_KEY = 'dune_state_v4';
  const SNAPSHOTS_KEY = 'dune_snapshots_v1';
  const MAX_SNAPSHOTS = 8;
  const SAVE_DEBOUNCE_MS = 300;

  function nowISO() { return new Date().toISOString(); }

  // ──────────────────────────────────────────────
  // LOGBOOK canonical envelope (Phase A — see docs/lifeos/STORAGE_MAP.md)
  // Gen-2 mirror of the two live Gen-1 sources (Tracker + Builder).
  // authority stays 'legacy-mirror' until Phase B; canonical is not yet
  // user-facing. No automatic cross-source dedupe.
  //
  // All logbook pure helpers live here so core.js can migrate schema
  // 11→12 without depending on window.LOGBOOK (app.js) being loaded
  // first. app.js LOGBOOK is a thin I/O wrapper over these helpers.
  // ──────────────────────────────────────────────
  const LOGBOOK_ENVELOPE_VERSION = 1;
  // Plausible legacy-ID epoch range: 2000-01-01 .. 2100-01-01 (ms).
  const LOGBOOK_MIN_EPOCH_MS = 946684800000;
  const LOGBOOK_MAX_EPOCH_MS = 4102444800000;

  function defaultLogbookEnvelope() {
    return {
      schemaVersion: LOGBOOK_ENVELOPE_VERSION,
      authority: 'legacy-mirror',
      entries: [],
      migration: {
        version: LOGBOOK_ENVELOPE_VERSION,
        sourceCounts: { tracker: 0, builder: 0 }
      },
      // Explicit marker: true only after at least one successful
      // Phase A reconcile(). Prevents drift comparison against the
      // migrate-only interim shape (which can already carry
      // source-tagged records but was never reconciled against live
      // legacy). Set by app-side LOGBOOK.reconcile.
      reconciled: false,
      drift: null
    };
  }
  function isLogbookEnvelope(v) {
    return !!(v && typeof v === 'object' && !Array.isArray(v)
      && v.schemaVersion === LOGBOOK_ENVELOPE_VERSION
      && Array.isArray(v.entries)
      && v.authority === 'legacy-mirror');
  }

  // Deterministic 32-bit djb2 hash rendered as unsigned hex.
  function logbookStableHash(s) {
    let h = 5381; const str = String(s == null ? '' : s);
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
    return (h >>> 0).toString(16);
  }

  // Deterministic structured serialisation. Used by BOTH the identity
  // fingerprint (assignCanonicalIds) and the drift digest so they cannot
  // subtly diverge. Recursively handles:
  //   null, string, number, boolean → JSON-encoded scalar
  //   Array                          → [<serialised elements>, …]
  //   plain/null-prototype object    → {"k1":<v1>,"k2":<v2>} with keys
  //                                    from Object.keys(sorted)
  // Preserves special own keys (__proto__, constructor, prototype).
  // Rejects functions/symbols/undefined (returns "null" for them so the
  // serialiser is total).
  function stableSerialize(value) {
    if (value === null || value === undefined) return 'null';
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(value);
    if (t === 'function' || t === 'symbol') return 'null';
    if (Array.isArray(value)) {
      return '[' + value.map(stableSerialize).join(',') + ']';
    }
    if (t === 'object') {
      // Object.keys returns own enumerable string keys — includes
      // __proto__ / constructor / prototype when they are own props
      // (as when a null-prototype object holds them, or when they
      // came in via JSON.parse of '{"__proto__":…}').
      const keys = Object.keys(value).sort();
      const parts = new Array(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        // Read via getOwnPropertyDescriptor to avoid triggering any
        // accessor on the prototype chain.
        const desc = Object.getOwnPropertyDescriptor(value, k);
        const v = desc && ('value' in desc) ? desc.value : undefined;
        parts[i] = JSON.stringify(k) + ':' + stableSerialize(v);
      }
      return '{' + parts.join(',') + '}';
    }
    return 'null';
  }

  // Hours parser — accepts finite number or fully-numeric string ("2.5").
  // Rejects partial numeric strings ("2.5h"), non-numeric, non-finite,
  // objects/arrays. Preserves 0. Returns null on invalid.
  function logbookParseHours(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    if (!trimmed) return null;
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
    const n = parseFloat(trimmed);
    return isFinite(n) ? n : null;
  }

  // Epoch inference from 'lb_<epoch>' / 'lbe_<epoch>' — only accepts
  // plausible Date.now-style millisecond values. 'lb_1' → null.
  function logbookInferCreatedAtFromId(legacyId) {
    if (typeof legacyId !== 'string') return null;
    const m = legacyId.match(/^(?:lb|lbe)_(\d+)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (!isFinite(n) || n < LOGBOOK_MIN_EPOCH_MS || n > LOGBOOK_MAX_EPOCH_MS) return null;
    const d = new Date(n);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  // Diagnostic fingerprint for possibleDuplicateKey. Never used for merge.
  function logbookPossibleDuplicateKey(canonical) {
    const norm = (v) => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
    const hoursPart = (typeof canonical.hours === 'number') ? canonical.hours.toFixed(2) : '';
    return [
      norm(canonical.date),
      norm(canonical.aircraft),
      norm(canonical.registration),
      norm(canonical.ata),
      hoursPart,
      norm(canonical.description)
    ].join('|');
  }

  // Known-field sets — anything else is preserved under legacyExtra.
  const TRACKER_KNOWN_KEYS = ['id','date','company','aircraft_type','registration','engine_type','ata_chapter','system','task_description','hours','role','supervisor','stamp_status','language','b1_relevance'];
  const BUILDER_KNOWN_KEYS = ['id','date','aircraft','reg','ata','ataLabel','hours','supervisor','ref','desc'];

  // Build legacyExtra safely: null-prototype dict, no exposure to
  // Object.prototype setters even if the source contained __proto__ /
  // constructor / prototype keys. Malformed known fields (see caller)
  // are added in as well so raw data is never silently dropped.
  function makeLegacyExtra() {
    return Object.create(null);
  }
  function extraSet(extras, k, v) {
    // Direct bracket assignment on a null-proto object bypasses the
    // __proto__ / constructor setter surface entirely.
    Object.defineProperty(extras, k, { value: v, writable: true, enumerable: true, configurable: true });
  }
  function collectUnknownExtras(raw, knownKeys, extras) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    for (const k of Object.keys(raw)) {
      if (knownKeys.indexOf(k) === -1) extraSet(extras, k, raw[k]);
    }
  }

  function toStringOrNull(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    // Object/array in a scalar field → treat as unrecoverable in canonical
    // form; caller preserves the raw value under legacyExtra.
    return null;
  }
  // Wrap toStringOrNull so we know when a raw known-field value could
  // not be coerced (so caller can preserve it under legacyExtra).
  function coerceScalar(v) {
    const out = toStringOrNull(v);
    // "unrecoverable in canonical" → the raw was non-null AND non-scalar.
    const preserved = out === null && v != null && !(typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    return { value: out, preserved };
  }

  function normalizeTrackerRecord(raw, sourceIndex) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const extras = makeLegacyExtra();
    const hours = logbookParseHours(raw.hours);
    const legacyId = (typeof raw.id === 'string' && raw.id) ? raw.id : null;

    const dateCoerce         = coerceScalar(raw.date);
    const companyCoerce      = coerceScalar(raw.company);
    const aircraftCoerce     = coerceScalar(raw.aircraft_type);
    const registrationCoerce = coerceScalar(raw.registration);
    const engineTypeCoerce   = coerceScalar(raw.engine_type);
    const ataCoerce          = coerceScalar(raw.ata_chapter);
    const systemCoerce       = coerceScalar(raw.system);
    const descriptionCoerce  = coerceScalar(raw.task_description);
    const roleCoerce         = coerceScalar(raw.role);
    const supervisorCoerce   = coerceScalar(raw.supervisor);
    const stampCoerce        = coerceScalar(raw.stamp_status);
    const languageCoerce     = coerceScalar(raw.language);
    const b1Coerce           = coerceScalar(raw.b1_relevance);

    const canonical = {
      id: null,
      source: 'tracker',
      legacyId,
      sourceIndex,
      inferredCreatedAt: logbookInferCreatedAtFromId(legacyId),
      date:         dateCoerce.value,
      aircraft:     aircraftCoerce.value,
      registration: registrationCoerce.value,
      ata:          ataCoerce.value,
      ataLabel:     null,
      description:  descriptionCoerce.value,
      hours,
      supervisor:   supervisorCoerce.value,
      company:      companyCoerce.value,
      engineType:   engineTypeCoerce.value,
      system:       systemCoerce.value,
      role:         roleCoerce.value,
      stampStatus:  stampCoerce.value,
      language:     languageCoerce.value,
      b1Relevance:  b1Coerce.value,
      ref: null,
      possibleDuplicateKey: null,
      legacyExtra: extras
    };
    // Preserve malformed known fields (unrecoverable object/array
    // in a scalar slot, or bad hours) under legacyExtra so raw data
    // is never silently discarded.
    if (hours === null && raw.hours != null) extraSet(extras, 'hours', raw.hours);
    if (dateCoerce.preserved)         extraSet(extras, 'date', raw.date);
    if (companyCoerce.preserved)      extraSet(extras, 'company', raw.company);
    if (aircraftCoerce.preserved)     extraSet(extras, 'aircraft_type', raw.aircraft_type);
    if (registrationCoerce.preserved) extraSet(extras, 'registration', raw.registration);
    if (engineTypeCoerce.preserved)   extraSet(extras, 'engine_type', raw.engine_type);
    if (ataCoerce.preserved)          extraSet(extras, 'ata_chapter', raw.ata_chapter);
    if (systemCoerce.preserved)       extraSet(extras, 'system', raw.system);
    if (descriptionCoerce.preserved)  extraSet(extras, 'task_description', raw.task_description);
    if (roleCoerce.preserved)         extraSet(extras, 'role', raw.role);
    if (supervisorCoerce.preserved)   extraSet(extras, 'supervisor', raw.supervisor);
    if (stampCoerce.preserved)        extraSet(extras, 'stamp_status', raw.stamp_status);
    if (languageCoerce.preserved)     extraSet(extras, 'language', raw.language);
    if (b1Coerce.preserved)           extraSet(extras, 'b1_relevance', raw.b1_relevance);
    collectUnknownExtras(raw, TRACKER_KNOWN_KEYS, extras);
    canonical.possibleDuplicateKey = logbookPossibleDuplicateKey(canonical);
    return canonical;
  }

  function normalizeBuilderRecord(raw, sourceIndex) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const extras = makeLegacyExtra();
    const hours = logbookParseHours(raw.hours);
    const legacyId = (typeof raw.id === 'string' && raw.id) ? raw.id : null;

    const dateCoerce       = coerceScalar(raw.date);
    const aircraftCoerce   = coerceScalar(raw.aircraft);
    const regCoerce        = coerceScalar(raw.reg);
    const ataCoerce        = coerceScalar(raw.ata);
    const ataLabelCoerce   = coerceScalar(raw.ataLabel);
    const descCoerce       = coerceScalar(raw.desc);
    const supervisorCoerce = coerceScalar(raw.supervisor);
    const refCoerce        = coerceScalar(raw.ref);

    const canonical = {
      id: null,
      source: 'builder',
      legacyId,
      sourceIndex,
      inferredCreatedAt: logbookInferCreatedAtFromId(legacyId),
      date:         dateCoerce.value,
      aircraft:     aircraftCoerce.value,
      registration: regCoerce.value,
      ata:          ataCoerce.value,
      ataLabel:     ataLabelCoerce.value,
      description:  descCoerce.value,
      hours,
      supervisor:   supervisorCoerce.value,
      company: null, engineType: null, system: null, role: null,
      stampStatus: null, language: null, b1Relevance: null,
      ref:          refCoerce.value,
      possibleDuplicateKey: null,
      legacyExtra: extras
    };
    if (hours === null && raw.hours != null) extraSet(extras, 'hours', raw.hours);
    if (dateCoerce.preserved)       extraSet(extras, 'date', raw.date);
    if (aircraftCoerce.preserved)   extraSet(extras, 'aircraft', raw.aircraft);
    if (regCoerce.preserved)        extraSet(extras, 'reg', raw.reg);
    if (ataCoerce.preserved)        extraSet(extras, 'ata', raw.ata);
    if (ataLabelCoerce.preserved)   extraSet(extras, 'ataLabel', raw.ataLabel);
    if (descCoerce.preserved)       extraSet(extras, 'desc', raw.desc);
    if (supervisorCoerce.preserved) extraSet(extras, 'supervisor', raw.supervisor);
    if (refCoerce.preserved)        extraSet(extras, 'ref', raw.ref);
    collectUnknownExtras(raw, BUILDER_KNOWN_KEYS, extras);
    canonical.possibleDuplicateKey = logbookPossibleDuplicateKey(canonical);
    return canonical;
  }

  // Canonical identity payload — every user-content field that
  // distinguishes records, including preserved legacyExtra. This is the
  // input to both ID content fingerprints and drift digests, so the
  // two invariants cannot subtly diverge. Excludes id / sourceIndex /
  // possibleDuplicateKey / drift-metadata / any nondeterministic field.
  function logbookIdentityPayload(r) {
    if (!r || typeof r !== 'object') return {};
    return {
      date:         r.date         == null ? null : r.date,
      aircraft:     r.aircraft     == null ? null : r.aircraft,
      registration: r.registration == null ? null : r.registration,
      ata:          r.ata          == null ? null : r.ata,
      ataLabel:     r.ataLabel     == null ? null : r.ataLabel,
      description:  r.description  == null ? null : r.description,
      hours:        r.hours        == null ? null : r.hours,
      supervisor:   r.supervisor   == null ? null : r.supervisor,
      company:      r.company      == null ? null : r.company,
      engineType:   r.engineType   == null ? null : r.engineType,
      system:       r.system       == null ? null : r.system,
      role:         r.role         == null ? null : r.role,
      stampStatus:  r.stampStatus  == null ? null : r.stampStatus,
      language:     r.language     == null ? null : r.language,
      b1Relevance:  r.b1Relevance  == null ? null : r.b1Relevance,
      ref:          r.ref          == null ? null : r.ref,
      legacyExtra:  (r.legacyExtra && typeof r.legacyExtra === 'object') ? r.legacyExtra : {}
    };
  }
  function logbookContentFingerprint(r) {
    return stableSerialize(logbookIdentityPayload(r));
  }

  // Assign deterministic canonical IDs.
  //   Unique legacy ID (count == 1)              → lb2:<src>:<legacyId>
  //   Duplicate legacy ID (count > 1, every row) → lb2:<src>:dup:<legacyId>:<contentHash>:<occ>
  //   Missing legacy ID                          → lb2:<src>:fallback:<contentHash>:<occ>
  // Occurrences are always counted per identical (source|…|contentHash)
  // bucket, never by raw array index — so unrelated prepend/reorder
  // never shifts an existing record's ID. Duplicate-ID handling is
  // pre-counted so no member of a duplicate group ever receives the
  // unsuffixed canonical ID (which would flip identity on reorder).
  function assignCanonicalIds(records) {
    if (!Array.isArray(records)) return records;
    const legacyIdCounts = new Map();  // source|legacyId → total occurrences
    for (const r of records) {
      if (!r || !r.legacyId) continue;
      const k = r.source + '|' + r.legacyId;
      legacyIdCounts.set(k, (legacyIdCounts.get(k) || 0) + 1);
    }
    const dupBucketOccurrences = new Map();      // source|legacyId|contentHash → n
    const fallbackBucketOccurrences = new Map(); // source|contentHash          → n
    for (const r of records) {
      if (!r) continue;
      const contentHash = logbookStableHash(logbookContentFingerprint(r));
      if (r.legacyId) {
        const legKey = r.source + '|' + r.legacyId;
        const total = legacyIdCounts.get(legKey) || 0;
        if (total <= 1) {
          r.id = 'lb2:' + r.source + ':' + r.legacyId;
        } else {
          const bucket = legKey + '|' + contentHash;
          const occ = dupBucketOccurrences.get(bucket) || 0;
          dupBucketOccurrences.set(bucket, occ + 1);
          r.id = 'lb2:' + r.source + ':dup:' + r.legacyId + ':' + contentHash + ':' + occ;
        }
      } else {
        const bucket = r.source + '|' + contentHash;
        const occ = fallbackBucketOccurrences.get(bucket) || 0;
        fallbackBucketOccurrences.set(bucket, occ + 1);
        r.id = 'lb2:' + r.source + ':fallback:' + contentHash + ':' + occ;
      }
    }
    return records;
  }

  // Deterministic digest of the canonical mirror content. Uses the same
  // stableSerialize / identity payload as ID fingerprinting, plus the
  // stable canonical id and source, so a content-only change (including
  // legacyExtra) surfaces as drift even when count is unchanged.
  function logbookContentDigest(entries) {
    if (!Array.isArray(entries)) return logbookStableHash('');
    const rows = entries.map(e => {
      if (!e || typeof e !== 'object') return 'null';
      return stableSerialize({
        id: e.id == null ? null : e.id,
        source: e.source == null ? null : e.source,
        legacyId: e.legacyId == null ? null : e.legacyId,
        payload: logbookIdentityPayload(e)
      });
    });
    return logbookStableHash(rows.join('\n'));
  }

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
          { id: 'l_eng_auth', name: 'CFM56-5B engine certifying authorization (Part-145)', status: 'planned', target: '2027-09-01' }
        ],
        certificates: [],
        milestones: [
          { id: 'm0', at: '2024-06-01', text: 'Started aviation career (Ryazan)' }
        ]
      },
      easa: {},
      logbook: defaultLogbookEnvelope(),
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
        { id: 't_cata', at: '2027-09-01', kind: 'future', text: 'CFM56-5B engine certifying authorization' },
        { id: 't_easa', at: '2029-06-01', kind: 'future', text: 'EASA Part-66 B1.1 — all 15 modules' }
      ],
      about: {
        version: 2,
        createdAt: 'June 2026',
        lastUpdated: '19 June 2026',
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
      bht: (window.BHT && window.BHT.defaultBhtState)
        ? window.BHT.defaultBhtState()
        : { habits: [], entries: [], snapshots: [], lifeEvents: [], vocab: { triggers: [], coping: [], moods: [] }, ai: { provider: 'fallback', ollamaUrl: 'http://localhost:11434', model: '' }, meta: {} },
      telemetry: {
        accumulatedFatigue: 0,
        weeklyShiftHours: 0,
        focusReserve: 100
      },
      ideas: [],
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
    if (Array.isArray(oldLb)) {
      const env = defaultLogbookEnvelope();
      env.entries = oldLb.map((r, i) => normalizeTrackerRecord(r, i)).filter(Boolean);
      assignCanonicalIds(env.entries);
      env.migration.sourceCounts.tracker = oldLb.length;
      s.logbook = env;
    }

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
      s.about.lastUpdated = '19 June 2026';
    }
    // v8 → v9 about touch-up: keep lastUpdated in sync with the latest revision
    if (s.about && s.about.lastUpdated === '11 June 2026') {
      s.about.lastUpdated = '19 June 2026';
    }
    // v10 → v11 about touch-up: catch the previously-mis-set 15 June stamp
    if (s.about && s.about.lastUpdated === '15 June 2026') {
      s.about.lastUpdated = '19 June 2026';
    }
    if (!s.career) s.career = def.career;
    // v5 → v6: Category A is line/whole-aircraft only; engine-shop work can't earn it.
    // Replace it with the engine certifying authorization.
    if (s.career && Array.isArray(s.career.licenses)) {
      s.career.licenses = s.career.licenses.map(l =>
        (l.id === 'l_favt_a' || /Category A/i.test(l.name || ''))
          ? { id: 'l_eng_auth', name: 'CFM56-5B engine certifying authorization (Part-145)', status: l.status || 'planned', target: l.target || '2027-09-01' }
          : l);
    }
    if (s.career && Array.isArray(s.career.milestones)) {
      s.career.milestones = s.career.milestones.map(m =>
        /Category A/i.test(m.text || '') ? { ...m, text: 'CFM56-5B engine certifying authorization' } : m);
    }
    if (Array.isArray(s.timeline)) {
      s.timeline = s.timeline.map(t =>
        /Category A/i.test(t.text || '') ? { ...t, text: 'CFM56-5B engine certifying authorization' } : t);
    }
    if (!s.qatarVisit) s.qatarVisit = def.qatarVisit;
    // v6 → v7: behavior intelligence slice
    if (!s.bht) s.bht = def.bht;
    if (window.BHT && window.BHT.migrateSlice) s.bht = window.BHT.migrateSlice(s.bht);
    // v7 → v8: telemetry slice (additive — never overwrites existing values)
    if (!s.telemetry || typeof s.telemetry !== 'object') {
      s.telemetry = def.telemetry;
    } else {
      if (typeof s.telemetry.accumulatedFatigue !== 'number') s.telemetry.accumulatedFatigue = 0;
      if (typeof s.telemetry.weeklyShiftHours   !== 'number') s.telemetry.weeklyShiftHours   = 0;
      if (typeof s.telemetry.focusReserve       !== 'number') s.telemetry.focusReserve       = 100;
    }
    // v8 → v9: ideas parking lot
    if (!Array.isArray(s.ideas)) s.ideas = [];

    // v11 → v12: logbook becomes a versioned envelope. If the existing
    // slice is the old flat Tracker-shaped array, convert it into
    // canonical Tracker-tagged records via the in-core normaliser. The
    // app-side reconciler then rebuilds entries from live Gen-1 sources
    // on boot; when Tracker key is truly absent (state-only backup),
    // these migrated records are recovered as tracker-source fallback.
    // Malformed logbook recovers to an empty envelope.
    if (Array.isArray(s.logbook)) {
      const legacyArray = s.logbook;
      const env = defaultLogbookEnvelope();
      env.entries = legacyArray.map((r, i) => normalizeTrackerRecord(r, i)).filter(Boolean);
      assignCanonicalIds(env.entries);
      env.migration.sourceCounts.tracker = legacyArray.length;
      s.logbook = env;
    } else if (!isLogbookEnvelope(s.logbook)) {
      s.logbook = defaultLogbookEnvelope();
    }

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

  // Domain-local normaliser. Runs after load()/migrateUp so a malformed
  // Logbook envelope (e.g. schema-12 payload where state.logbook is a
  // string or plain array) is recovered without triggering a full-state
  // reset. Unrelated slices are never touched.
  function normalizeLogbookDomain(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.logbook)) {
      const env = defaultLogbookEnvelope();
      env.entries = data.logbook.map((r, i) => normalizeTrackerRecord(r, i)).filter(Boolean);
      assignCanonicalIds(env.entries);
      env.migration.sourceCounts.tracker = data.logbook.length;
      data.logbook = env;
      return;
    }
    if (!isLogbookEnvelope(data.logbook)) {
      data.logbook = defaultLogbookEnvelope();
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const data = (parsed && parsed.version === SCHEMA_VERSION && parsed.data)
          ? parsed.data
          : migrateUp((parsed && parsed.data) || {}, (parsed && parsed.version) || 0);
        normalizeLogbookDomain(data);
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
  // Persistence pause flag. When true, both scheduleSave() and persistNow()
  // become no-ops so a pending stale in-memory snapshot cannot overwrite a
  // freshly-imported dune_state_v4 during the reload window. Set/cleared via
  // Store.pausePersistence / Store.resumePersistence.
  let paused = false;
  // Set when either (a) a save was pending at the moment we paused, or (b) a
  // Store.set/update happened while paused. On resumePersistence() we
  // re-arm one debounced save so the legitimate in-memory state eventually
  // persists — this avoids losing a real user edit that was already queued
  // when a failed import canceled its debounce timer. Successful import
  // never resumes (stays paused until reload), so this flag is never
  // consulted on the success path.
  let dirtyWhilePaused = false;

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (paused) { dirtyWhilePaused = true; return; }
    // Clear saveTimer in the callback BEFORE persistNow runs so that
    // `saveTimer !== null` is a truthful signal of "a debounce is
    // pending". Otherwise a completed save leaves the handle in place
    // and a later pause() would misclassify it as pending and re-arm
    // an unnecessary write on resume.
    saveTimer = setTimeout(function () {
      saveTimer = null;
      persistNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function persistNow() {
    if (paused) return;
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

  function pausePersistence() {
    // Capture pending-save state before cancelling the timer so a failed
    // import can re-arm it on resume. Repeated pause() calls remain
    // idempotent: dirtyWhilePaused is a set-only-once-until-resume flag,
    // and saveTimer is null after the first pause so subsequent pauses
    // are true no-ops.
    if (saveTimer !== null) {
      dirtyWhilePaused = true;
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    paused = true;
  }

  function resumePersistence() {
    if (!paused) return; // idempotent — a duplicate resume is a no-op
    paused = false;
    if (dirtyWhilePaused) {
      dirtyWhilePaused = false;
      scheduleSave();
    }
  }

  function isPersistencePaused() { return paused; }

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
      const slice = (s || state).logbook;
      const entries = (slice && Array.isArray(slice.entries))
        ? slice.entries
        : (Array.isArray(slice) ? slice : []); // tolerate pre-envelope shape
      const hours = entries.reduce((a, e) => a + (typeof e.hours === 'number' ? e.hours : (parseFloat(e && e.hours) || 0)), 0);
      return { entries: entries.length, hours };
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
    pausePersistence,
    resumePersistence,
    isPersistencePaused,
    defaultLogbookEnvelope,
    isLogbookEnvelope,
    LOGBOOK_ENVELOPE_VERSION,
    logbookHelpers: {
      normalizeTrackerRecord,
      normalizeBuilderRecord,
      assignCanonicalIds,
      parseHours: logbookParseHours,
      inferCreatedAtFromId: logbookInferCreatedAtFromId,
      possibleDuplicateKey: logbookPossibleDuplicateKey,
      identityPayload: logbookIdentityPayload,
      contentFingerprint: logbookContentFingerprint,
      contentDigest: logbookContentDigest,
      stableSerialize,
      stableHash: logbookStableHash
    },
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
