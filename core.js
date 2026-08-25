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
  const SCHEMA_VERSION = 13;
  const STATE_KEY = 'dune_state_v4';
  const SNAPSHOTS_KEY = 'dune_snapshots_v1';
  const MAX_SNAPSHOTS = 8;
  const SAVE_DEBOUNCE_MS = 300;
  const WEB_LOCK_NAME = 'lifeos-state-write-v1';

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

  // Fixed epoch for deterministic (passive migration / legacy-derivation)
  // metadata. User-action timestamps elsewhere continue to use nowISO().
  const DETERMINISTIC_META_ISO = '2026-06-01T00:00:00.000Z';
  function defaultState(opts) {
    const isoNow = (opts && opts.deterministic) ? DETERMINISTIC_META_ISO : nowISO();
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
        createdAt: isoNow,
        lastUpdated: isoNow
      }
    };
  }

  // ──────────────────────────────────────────────
  // MIGRATIONS
  // ──────────────────────────────────────────────
  // Pure legacy → Gen-2 candidate derivation. `read` is `(key) => parsedJsonOrNull`.
  // No live localStorage access here, no Store mutation, no wall-clock. Same
  // staged legacy input → byte-equivalent derived candidate across calls.
  // Used by initial boot (reader = live localStorage) and by legacy-only
  // import derivation (reader = staged map of the freshly-written keys).
  function deriveStateFromLegacy(read) {
    const s = defaultState({ deterministic: true });
    const safe = (typeof read === 'function')
      ? read
      : function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

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

  // Backwards-compatible thin wrapper. Live localStorage reader.
  function migrateFromLegacy() {
    return deriveStateFromLegacy(null);
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
  // B0 · STORE DURABILITY (schema-13 wrapper + CAS + coordinator)
  // Reviewed design: docs/lifeos/DECISIONS.md ADR-010.
  //
  // Wire diagram:
  //   baseState  = last accepted persisted data
  //   pendingOps = ordered CAS operations enqueued by callers
  //   state      = optimisticReplay(baseState, pendingOps)
  //
  //   flush = webLock + sameTabSerializer(
  //             read → migrate → validate → rebase → strict-replay
  //             → primary write → snapshot write → accept new base
  //           )
  //
  //   storage event = rebase-only (never triggers a write)
  //
  //   full-state transaction (import/snapshot/reset) freezes ordinary
  //   Store.set/update; always unfreezes in finally.
  // ──────────────────────────────────────────────

  // ── PATH PRIMITIVES ──────────────────────────────
  function isSafeStringKey(k) {
    return typeof k === 'string' && k.length > 0;
  }
  function splitPath(path) {
    if (typeof path !== 'string' || path.length === 0) throw new Error('STORE_INVALID_PATH');
    const segs = path.split('.');
    for (const s of segs) if (!isSafeStringKey(s)) throw new Error('STORE_INVALID_PATH');
    return segs;
  }
  // Descriptor-based own-property read. Never invokes accessors, never
  // traverses prototypes; __proto__ / constructor / prototype are safe as
  // own data keys.
  function readOwnPath(root, path) {
    const segs = splitPath(path);
    let cur = root;
    for (let i = 0; i < segs.length; i++) {
      if (cur === null || typeof cur !== 'object') return { exists: false, value: null };
      const desc = Object.getOwnPropertyDescriptor(cur, segs[i]);
      if (!desc) return { exists: false, value: null };
      if ('get' in desc || 'set' in desc) throw new Error('STORE_ACCESSOR_ENCOUNTERED');
      if (i === segs.length - 1) return { exists: true, value: desc.value };
      cur = desc.value;
    }
    return { exists: true, value: cur };
  }
  // Write via defineProperty so Object.prototype setters are never invoked.
  // Intermediate parents are null-prototype for safety.
  function applyOwnPath(root, path, op) {
    const segs = splitPath(path);
    let cur = root;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      const desc = Object.getOwnPropertyDescriptor(cur, seg);
      if (!desc) {
        const child = Object.create(null);
        Object.defineProperty(cur, seg, { value: child, writable: true, enumerable: true, configurable: true });
        cur = child;
      } else {
        if ('get' in desc || 'set' in desc) throw new Error('STORE_ACCESSOR_ENCOUNTERED');
        if (desc.value === null || typeof desc.value !== 'object') {
          throw new Error('PATH_PARENT_NOT_OBJECT');
        }
        cur = desc.value;
      }
    }
    const tail = segs[segs.length - 1];
    if (op.kind === 'delete') {
      const d = Object.getOwnPropertyDescriptor(cur, tail);
      if (d && !d.configurable) throw new Error('STORE_KEY_NOT_CONFIGURABLE');
      if (d) delete cur[tail];
    } else {
      Object.defineProperty(cur, tail, { value: op.value, writable: true, enumerable: true, configurable: true });
    }
  }

  // Canonical ECMAScript array index: integer in [0, 2^32 - 2] whose
  // decimal-string representation is exactly the property name (no leading
  // zeros, no "-0", no "1.0"). "4294967295" is deliberately excluded — it
  // is the length limit, not a valid index.
  const MAX_ARRAY_INDEX = 4294967294; // 2^32 - 2
  function isCanonicalArrayIndexKey(name) {
    if (typeof name !== 'string' || name.length === 0) return false;
    const n = Number(name);
    return Number.isInteger(n)
      && n >= 0
      && n <= MAX_ARRAY_INDEX
      && String(n) === name;
  }

  // ── PERSISTABLE VALUE CONTRACT ───────────────────
  function isPlainOrNullProtoObject(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === null || p === Object.prototype;
  }
  // ancestry-based cycle detection: only ancestors on the current recursion
  // path count as cycles. Shared non-cyclic references (a = {x:1}; {p:a, q:a})
  // are allowed and produce structurally-cloned copies at each site.
  function clonePersistable(v, ancestry) {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'undefined') throw new Error('STORE_UNPERSISTABLE');
    if (t === 'boolean' || t === 'string') return v;
    if (t === 'number') { if (!Number.isFinite(v)) throw new Error('STORE_UNPERSISTABLE'); return v; }
    if (t === 'function' || t === 'symbol' || t === 'bigint') throw new Error('STORE_UNPERSISTABLE');
    if (t !== 'object') throw new Error('STORE_UNPERSISTABLE');
    if (v instanceof Date || v instanceof RegExp) throw new Error('STORE_UNPERSISTABLE');
    if (typeof Map !== 'undefined' && v instanceof Map) throw new Error('STORE_UNPERSISTABLE');
    if (typeof Set !== 'undefined' && v instanceof Set) throw new Error('STORE_UNPERSISTABLE');
    if (typeof Node !== 'undefined' && v instanceof Node) throw new Error('STORE_UNPERSISTABLE');
    ancestry = ancestry || [];
    for (let i = 0; i < ancestry.length; i++) if (ancestry[i] === v) throw new Error('STORE_CYCLE');
    ancestry.push(v);
    try {
      if (Array.isArray(v)) {
        // Arrays obey the same descriptor contract as objects:
        //   - no own symbol keys
        //   - no indexed accessors (never invoke a getter to check for one)
        //   - no non-index own data properties beyond length
        //   - no sparse holes
        // Canonical array indices are exactly integers in [0, 2^32 - 2].
        // "4294967295" (2^32 - 1) is NOT a valid array index; regex-based
        // matching would misclassify it and silently drop the value.
        if (Object.getOwnPropertySymbols(v).length > 0) throw new Error('STORE_UNPERSISTABLE');
        const names = Object.getOwnPropertyNames(v);
        for (const n of names) {
          if (n === 'length') continue;
          if (!isCanonicalArrayIndexKey(n)) throw new Error('STORE_UNPERSISTABLE'); // non-index own property
          const desc = Object.getOwnPropertyDescriptor(v, n);
          if (!desc || 'get' in desc || 'set' in desc) throw new Error('STORE_UNPERSISTABLE');
        }
        const out = new Array(v.length);
        for (let i = 0; i < v.length; i++) {
          if (!(i in v)) throw new Error('STORE_UNPERSISTABLE'); // sparse
          const desc = Object.getOwnPropertyDescriptor(v, i);
          if (!desc || 'get' in desc || 'set' in desc) throw new Error('STORE_UNPERSISTABLE');
          out[i] = clonePersistable(desc.value, ancestry);
        }
        return out;
      }
      if (!isPlainOrNullProtoObject(v)) throw new Error('STORE_UNPERSISTABLE');
      // Any own symbol key is a hard reject — never silently dropped.
      if (Object.getOwnPropertySymbols(v).length > 0) throw new Error('STORE_UNPERSISTABLE');
      // Inspect ALL own string names (enumerable AND non-enumerable) so a
      // hidden non-enumerable accessor cannot slip through as "persistable".
      const allNames = Object.getOwnPropertyNames(v);
      for (const n of allNames) {
        const d = Object.getOwnPropertyDescriptor(v, n);
        if (!d) throw new Error('STORE_UNPERSISTABLE');
        if ('get' in d || 'set' in d) throw new Error('STORE_UNPERSISTABLE');
        // Non-enumerable own data properties are rejected too: schema
        // serialisation only handles enumerable ones.
        if (!d.enumerable) throw new Error('STORE_UNPERSISTABLE');
      }
      const proto = Object.getPrototypeOf(v);
      const out = proto === null ? Object.create(null) : {};
      const keys = Object.keys(v);
      for (const k of keys) {
        if (typeof k !== 'string') throw new Error('STORE_UNPERSISTABLE');
        const desc = Object.getOwnPropertyDescriptor(v, k);
        Object.defineProperty(out, k, {
          value: clonePersistable(desc.value, ancestry),
          writable: true, enumerable: true, configurable: true
        });
      }
      return out;
    } finally {
      ancestry.pop();
    }
  }
  // Deeply freeze a persistable value in place. Used to hand read-only
  // snapshots to subscribers/onSave without cloning per callback.
  function deepFreezePersistable(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Object.isFrozen(v)) return v;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) deepFreezePersistable(v[i]);
    } else {
      const keys = Object.keys(v);
      for (const k of keys) {
        const desc = Object.getOwnPropertyDescriptor(v, k);
        if (desc && ('value' in desc)) deepFreezePersistable(desc.value);
      }
    }
    Object.freeze(v);
    return v;
  }
  function deepEqualPersistable(a, b) {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    const ta = typeof a, tb = typeof b;
    if (ta !== tb) return false;
    if (ta !== 'object') return a === b;
    const aIsArr = Array.isArray(a), bIsArr = Array.isArray(b);
    if (aIsArr !== bIsArr) return false;
    if (aIsArr) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqualPersistable(a[i], b[i])) return false;
      return true;
    }
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
    for (const k of ka) {
      const da = Object.getOwnPropertyDescriptor(a, k);
      const db = Object.getOwnPropertyDescriptor(b, k);
      if (!deepEqualPersistable(da.value, db.value)) return false;
    }
    return true;
  }

  // ── SNAPSHOTS ────────────────────────────────────
  // Best-effort snapshot writer. Returns { ok, error? }. Callers decide
  // whether to surface the failure — normal flush and commitFullStateWrapper
  // both emit STORE_SNAPSHOT_DEGRADED on failure without failing the primary
  // commit.
  function pushSnapshot(payload) {
    try {
      const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
      snaps.unshift({ at: nowISO(), payload });
      while (snaps.length > MAX_SNAPSHOTS) snaps.pop();
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snaps));
      return { ok: true };
    } catch (e) { return { ok: false, error: e }; }
  }
  // Validate a parsed snapshot wrapper. Schema-13 wrappers must have an
  // integer revision in [0, MAX_SAFE_INTEGER]; malformed schema-13 sources
  // are rejected outright (never re-wrapped, never migrated). Schema ≤12
  // wrappers remain migratable.
  function isValidSnapshotWrapper(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version)) return false;
    if (parsed.version === 13) {
      const rev = parsed.revision;
      if (!(typeof rev === 'number' && Number.isFinite(rev) && Number.isInteger(rev) && rev >= 0 && rev <= Number.MAX_SAFE_INTEGER)) {
        return false;
      }
    }
    return !!parsed.data;
  }
  function restoreFromSnapshot() {
    try {
      const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
      for (const s of snaps) {
        try {
          const parsed = JSON.parse(s.payload);
          if (!isValidSnapshotWrapper(parsed)) continue; // skip malformed
          return migrateUp(parsed.data, parsed.version);
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

  // ── WRAPPER · LOAD ───────────────────────────────
  // Accepted wrapper shapes:
  //   schema 13 → { version:13, revision:int, committedAt:ISO, data:{} }
  //   schema ≤12 → { version:<n>, data:{} }              (migrated up)
  //   legacy bare data (no wrapper) → treated as v0 data
  function isValidRevision(n) {
    return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n)
      && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
  }
  function parseWrapperRaw(raw) {
    if (raw === null || raw === undefined) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return { corrupt: true }; }
    if (!parsed || typeof parsed !== 'object') return { corrupt: true };
    const version = (typeof parsed.version === 'number') ? parsed.version : 0;
    // Schema-13 wrappers MUST carry an integer revision in range.
    // Any other numeric shape (1.5, NaN, Infinity, negative, string) is a
    // hard corruption signal, not a fall-back-to-zero.
    let revision = 0;
    if (version >= 13) {
      if (!isValidRevision(parsed.revision)) return { corrupt: true };
      revision = parsed.revision;
    } else if ('revision' in parsed) {
      // Older versions never wrote revision; if present but invalid, corrupt.
      if (parsed.revision !== undefined && parsed.revision !== null && !isValidRevision(parsed.revision)) {
        return { corrupt: true };
      }
      if (isValidRevision(parsed.revision)) revision = parsed.revision;
    }
    const committedAt = (typeof parsed.committedAt === 'string') ? parsed.committedAt : null;
    const data = parsed.data || null;
    return { version, revision, committedAt, data, corrupt: false };
  }
  function migrateAndValidate(rawParsed) {
    // Returns { ok, data } — data is a defensive clone if ok.
    if (!rawParsed) return { ok: false };
    if (rawParsed.corrupt) return { ok: false };
    const rawData = rawParsed.data;
    const data = (rawParsed.version === SCHEMA_VERSION && rawData)
      ? rawData
      : migrateUp(rawData || {}, rawParsed.version || 0);
    normalizeLogbookDomain(data);
    if (!validate(data)) return { ok: false };
    try {
      const cloned = clonePersistable(data);
      return { ok: true, data: cloned };
    } catch (e) {
      return { ok: false };
    }
  }
  function initialLoad() {
    let raw = null;
    try { raw = localStorage.getItem(STATE_KEY); } catch (e) { raw = null; }
    if (raw !== null) {
      const parsed = parseWrapperRaw(raw);
      const m = migrateAndValidate(parsed);
      if (m.ok) return { data: m.data, revision: parsed.revision, committedAt: parsed.committedAt, rawWrapper: raw };
      // Corrupt / invalid — fall through to snapshot then legacy.
      let snap = null;
      try { snap = restoreFromSnapshot(); } catch (e) { snap = null; }
      if (snap && validate(snap)) {
        try { return { data: clonePersistable(snap), revision: 0, committedAt: null, rawWrapper: null }; }
        catch (e) { /* snap clone failed — fall through */ }
      }
      return { data: clonePersistable(migrateFromLegacy()), revision: 0, committedAt: null, rawWrapper: null };
    }
    return { data: clonePersistable(migrateFromLegacy()), revision: 0, committedAt: null, rawWrapper: null };
  }

  // ── INTERNAL STATE ───────────────────────────────
  const _boot = initialLoad();
  let baseState      = _boot.data;
  let knownRevision  = _boot.revision;
  let committedAt    = _boot.committedAt;
  let baseWrapperRaw = _boot.rawWrapper;
  let state          = clonePersistable(baseState);   // optimistic projection
  let pendingOps     = [];
  let nextSeq        = 1;
  let conflict       = null;
  let saveTimer      = null;
  let flushChain     = Promise.resolve();
  let activeFullStateTransaction = false;
  let fullStateTxToken = null;
  let deferredStorageEvents = [];
  // Persistent durability blocker (corrupt disk, revision regression, etc.).
  // Set to a {code, since, detail?} record; when non-null Store rejects new
  // writes AND flushes with STORE_DURABILITY_BLOCKED until cleared via
  // Store.clearDurabilityBlocker (or an approved full-state transaction).
  let durabilityBlocker = null;
  const saveListeners = new Set();
  const errorListeners = new Set();

  // Backward-compat pause flag: legacy import code (b4083a8) calls
  // pausePersistence/resumePersistence and relies on scheduleSave being a
  // no-op while paused. Under B0 this is a subset of the freeze protocol.
  let paused = false;
  let dirtyWhilePaused = false;

  // ── REPLAY ───────────────────────────────────────
  function existenceEqual(a, b) { return a === b; }
  function opAppliesCleanlyToBase(current, before) {
    return existenceEqual(current.exists, before.exists) && deepEqualPersistable(current.value, before.value);
  }
  function strictReplay(baseData, ops) {
    const data = clonePersistable(baseData);
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op.kind === 'force-set') {
        if (op.afterExists) applyOwnPath(data, op.path, { kind: 'set', value: clonePersistable(op.after) });
        else applyOwnPath(data, op.path, { kind: 'delete' });
        continue;
      }
      const cur = readOwnPath(data, op.path);
      const before = { exists: op.beforeExists, value: op.before };
      const after  = { exists: op.afterExists,  value: op.after  };
      if (opAppliesCleanlyToBase(cur, before)) {
        if (op.afterExists) applyOwnPath(data, op.path, { kind: 'set', value: clonePersistable(op.after) });
        else applyOwnPath(data, op.path, { kind: 'delete' });
      } else if (opAppliesCleanlyToBase(cur, after)) {
        // idempotently satisfied — no write, no conflict
      } else {
        return { conflict: { op, savedExists: cur.exists, savedValue: clonePersistable(cur.value) } };
      }
    }
    return { data };
  }
  function optimisticReplay(baseData, ops) {
    const data = clonePersistable(baseData);
    for (const op of ops) {
      if (op.afterExists) applyOwnPath(data, op.path, { kind: 'set', value: clonePersistable(op.after) });
      else applyOwnPath(data, op.path, { kind: 'delete' });
    }
    return data;
  }
  function rebuildOptimistic() {
    state = optimisticReplay(baseState, pendingOps);
    invalidateFrozenSnapshot();
  }

  // ── SUBSCRIBERS / NOTIFY ─────────────────────────
  const subscribers = new Map(); // path → Set<fn>
  // Build one deeply-frozen snapshot per notification cycle. Subscribers
  // receive this shared frozen reference; mutation attempts throw in strict
  // mode and are silently ignored otherwise — either way internal state is
  // protected. `null` cache means "rebuild on next read".
  let _frozenSnapshot = null;
  function invalidateFrozenSnapshot() { _frozenSnapshot = null; }
  function currentFrozenSnapshot() {
    if (_frozenSnapshot === null) _frozenSnapshot = deepFreezePersistable(clonePersistable(state));
    return _frozenSnapshot;
  }
  function subscribe(path, fn) {
    if (!subscribers.has(path)) subscribers.set(path, new Set());
    subscribers.get(path).add(fn);
    // Immediate hydration also gets the frozen snapshot.
    try { fn(currentFrozenSnapshot()); } catch (e) { console.error('[Store] sub immediate:', e); }
    return () => { const set = subscribers.get(path); if (set) set.delete(fn); };
  }
  function notify(changedPath) {
    const snap = currentFrozenSnapshot();
    // Dedup callbacks — a subscriber registered on both '*' and a specific
    // path must only fire once per notification cycle.
    const fired = new Set();
    for (const [path, fns] of subscribers) {
      if (path === '*' || path === changedPath || changedPath.startsWith(path + '.') || path.startsWith(changedPath + '.')) {
        for (const fn of fns) {
          if (fired.has(fn)) continue;
          fired.add(fn);
          try { fn(snap); } catch (e) { console.error('[Store] notify:', e); }
        }
      }
    }
  }
  function notifyAll() {
    const snap = currentFrozenSnapshot();
    const seen = new Set();
    for (const [, fns] of subscribers) {
      for (const fn of fns) {
        if (seen.has(fn)) continue;
        seen.add(fn);
        try { fn(snap); } catch (e) { console.error('[Store] notify(*):', e); }
      }
    }
  }
  function emitError(err) {
    errorListeners.forEach(fn => { try { fn(err); } catch (e) { /* swallow */ } });
  }
  function setDurabilityBlocker(code, detail) {
    durabilityBlocker = { code: code, since: nowISO(), detail: detail || null };
    emitError(durabilityBlocker);
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('lifeos:store-durability-blocked', { detail: { code: code } }));
      }
    } catch (e) { /* ignore */ }
  }
  function clearDurabilityBlocker() {
    if (!durabilityBlocker) return { ok: true };
    durabilityBlocker = null;
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('lifeos:store-durability-cleared'));
      }
    } catch (e) { /* ignore */ }
    if (pendingOps.length > 0 && !conflict) scheduleFlush();
    return { ok: true };
  }

  // ── PUBLIC READS ─────────────────────────────────
  function get(path) {
    if (!path) return clonePersistable(state);
    const { exists, value } = readOwnPath(state, path);
    if (!exists) return undefined;
    try { return clonePersistable(value); } catch (e) { return value; }
  }

  // ── PUBLIC WRITES ────────────────────────────────
  function set(path, val) {
    if (activeFullStateTransaction) return { ok: false, error: 'FULL_STATE_TRANSACTION_IN_PROGRESS' };
    // Ordinary writes still enqueue during conflict (spec §9). They are
    // rejected only during full-state freeze or durability block.
    if (durabilityBlocker) return { ok: false, error: 'STORE_DURABILITY_BLOCKED', code: durabilityBlocker.code };
    if (val === undefined) return { ok: false, error: 'STORE_INVALID_OPERATION' };
    let cloned;
    try { cloned = clonePersistable(val); } catch (e) { return { ok: false, error: 'STORE_UNPERSISTABLE' }; }
    let cur;
    try { cur = readOwnPath(state, path); } catch (e) { return { ok: false, error: e.message || 'STORE_INVALID_PATH' }; }
    let before = null;
    if (cur.exists) {
      try { before = clonePersistable(cur.value); } catch (e) { before = cur.value; }
      if (!pendingOpsAffect(path) && deepEqualPersistable(before, cloned)) {
        return { ok: true, noop: true };
      }
    }
    const op = {
      seq: nextSeq++,
      kind: 'cas-set',
      path: path,
      beforeExists: cur.exists,
      before: cur.exists ? before : null,
      afterExists: true,
      after: cloned,
      createdAt: nowISO()
    };
    // Trial-apply to a clone of optimistic state so any path-shape violation
    // is caught BEFORE pendingOps changes visible state.
    try {
      const trial = optimisticReplay(baseState, pendingOps.concat([op]));
      state = trial;
      invalidateFrozenSnapshot();
    } catch (e) {
      return { ok: false, error: e.message || 'STORE_APPLY_FAILED' };
    }
    pendingOps.push(op);
    notify(path);
    scheduleFlush();
    return { ok: true, seq: op.seq };
  }
  function update(path, updater) {
    if (activeFullStateTransaction) return { ok: false, error: 'FULL_STATE_TRANSACTION_IN_PROGRESS' };
    if (durabilityBlocker) return { ok: false, error: 'STORE_DURABILITY_BLOCKED', code: durabilityBlocker.code };
    let cur;
    try { cur = readOwnPath(state, path); } catch (e) { return { ok: false, error: e.message || 'STORE_INVALID_PATH' }; }
    let arg;
    if (cur.exists) {
      try { arg = clonePersistable(cur.value); } catch (e) { arg = cur.value; }
    } else {
      arg = undefined;
    }
    const ret = updater(arg);
    if (ret === undefined) return { ok: false, error: 'STORE_INVALID_OPERATION' };
    return set(path, ret);
  }
  function pendingOpsAffect(path) {
    for (const op of pendingOps) if (op.path === path) return true;
    return false;
  }

  // ── COORDINATOR / FLUSH ──────────────────────────
  const capabilities = {
    crossTabSafe: !!(typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function'),
    webStorage:   (typeof localStorage !== 'undefined')
  };

  function withCoordinator(fn) {
    // Same-tab serializer + optional Web Lock.
    // IMPORTANT: catch prior rejection SEPARATELY from running the current
    // task, so the current task always executes (a previous rejection must
    // not consume the current queued work).
    const recovered = flushChain.catch(function (prev) {
      try { console.warn('[Store] previous coordinator task rejected:', prev); } catch (e) {}
    });
    const runCurrent = recovered.then(async function () {
      if (capabilities.crossTabSafe) {
        return await navigator.locks.request(WEB_LOCK_NAME, { mode: 'exclusive' }, async function () {
          return fn();
        });
      }
      return fn();
    });
    flushChain = runCurrent;
    return runCurrent;
  }

  function scheduleFlush() {
    if (paused) { dirtyWhilePaused = true; return; }
    if (activeFullStateTransaction) return;
    if (conflict) return; // persistence blocked while conflict live
    if (durabilityBlocker) return; // persistence blocked while durability blocker set
    clearTimeout(saveTimer);
    saveTimer = null;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      flushNow();
    }, SAVE_DEBOUNCE_MS);
  }

  function flushNow() {
    if (paused) return Promise.resolve({ committed: false, reason: 'PAUSED' });
    if (activeFullStateTransaction) return Promise.resolve({ committed: false, reason: 'FROZEN' });
    if (durabilityBlocker) return Promise.resolve({ committed: false, reason: 'STORE_DURABILITY_BLOCKED', code: durabilityBlocker.code });
    if (conflict) return Promise.resolve({ committed: false, reason: 'CONFLICT' });
    if (pendingOps.length === 0) return Promise.resolve({ committed: false, reason: 'NOOP' });
    return withCoordinator(function () { return commitLocked(); });
  }

  // Runs inside coordinator (Web Lock when available). SYNCHRONOUS body.
  function commitLocked() {
    if (activeFullStateTransaction) return { committed: false, reason: 'FROZEN' };
    if (pendingOps.length === 0) return { committed: false, reason: 'NOOP' };

    // 1. Re-read disk under lock and rebase if needed. Corrupt / regressed
    // / cleared authoritative storage sets a persistent durability blocker
    // and refuses to overwrite; the human must recover via an approved
    // full-state transaction (snapshot restore, import, reset) or explicit
    // clearDurabilityBlocker after inspection.
    let rawNow;
    try { rawNow = localStorage.getItem(STATE_KEY); } catch (e) { rawNow = null; }
    if (rawNow === null && baseWrapperRaw !== null) {
      // External clear of an accepted STATE_KEY — invariant break, block writes.
      setDurabilityBlocker('STORE_STATE_CLEARED_EXTERNAL', { knownRevision });
      return { committed: false, reason: 'STORE_STATE_CLEARED_EXTERNAL' };
    }
    if (rawNow !== null && rawNow !== baseWrapperRaw) {
      const parsed = parseWrapperRaw(rawNow);
      if (!parsed || parsed.corrupt) {
        setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE');
        return { committed: false, reason: 'STORE_CORRUPT_AUTHORITATIVE_STATE' };
      }
      const m = migrateAndValidate(parsed);
      if (!m.ok) {
        setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE');
        return { committed: false, reason: 'STORE_CORRUPT_AUTHORITATIVE_STATE' };
      }
      if (parsed.revision > knownRevision) {
        // Newer external state — adopt as new base before replay.
        baseState      = m.data;
        knownRevision  = parsed.revision;
        committedAt    = parsed.committedAt;
        baseWrapperRaw = rawNow;
      } else if (parsed.revision < knownRevision) {
        // Regression on disk — invariant break, block writes.
        setDurabilityBlocker('STORE_REVISION_REGRESSION', { diskRevision: parsed.revision, knownRevision });
        return { committed: false, reason: 'STORE_REVISION_REGRESSION' };
      } else { // parsed.revision === knownRevision, raw differs
        // Equal revision, different raw wrapper — collision. Adopt disk
        // defensively; surface warning.
        baseState      = m.data;
        committedAt    = parsed.committedAt;
        baseWrapperRaw = rawNow;
        emitError({ code: 'STORE_REVISION_COLLISION', revision: parsed.revision });
      }
    }

    // 2. Capture generation and strict-replay.
    const capturedMaxSeq = pendingOps[pendingOps.length - 1].seq;
    const captured = pendingOps.filter(op => op.seq <= capturedMaxSeq);
    const r = strictReplay(baseState, captured);
    if (r.conflict) {
      setConflict(r.conflict);
      return { committed: false, reason: 'CONFLICT' };
    }
    // 3. If nothing actually changed → drop captured ops; no new revision.
    if (deepEqualPersistable(r.data, baseState)) {
      pendingOps = pendingOps.filter(op => op.seq > capturedMaxSeq);
      rebuildOptimistic();
      return { committed: false, reason: 'IDEMPOTENT' };
    }
    // 4. Revision exhaustion.
    if (knownRevision >= Number.MAX_SAFE_INTEGER) {
      emitError({ code: 'STORE_REVISION_EXHAUSTED' });
      return { committed: false, reason: 'STORE_REVISION_EXHAUSTED' };
    }
    // 5. Write primary + snapshot (both synchronous inside lock).
    const nextRevision = knownRevision + 1;
    const committedAtNow = nowISO();
    const wrapper = { version: SCHEMA_VERSION, revision: nextRevision, committedAt: committedAtNow, data: r.data };
    let payload;
    try { payload = JSON.stringify(wrapper); } catch (e) { emitError({ code: 'STORE_SERIALIZE_FAILED', error: e }); return { committed: false, reason: 'SERIALIZE' }; }
    try {
      localStorage.setItem(STATE_KEY, payload);
    } catch (e) {
      emitError({ code: 'STORE_QUOTA', error: e });
      return { committed: false, reason: 'QUOTA' };
    }
    // Snapshot failure after primary success is a non-fatal degradation —
    // primary commit remains accepted; captured ops are dropped; a
    // STORE_SNAPSHOT_DEGRADED error is emitted so UI/log can surface it.
    { const _snap = pushSnapshot(payload); if (!_snap.ok) emitError({ code: 'STORE_SNAPSHOT_DEGRADED', revision: nextRevision, error: String((_snap.error && _snap.error.message) || _snap.error) }); }
    baseState      = r.data;
    knownRevision  = nextRevision;
    committedAt    = committedAtNow;
    baseWrapperRaw = payload;
    pendingOps     = pendingOps.filter(op => op.seq > capturedMaxSeq);
    rebuildOptimistic();

    // 6. Post-commit hooks (fire outside lock — collect here, caller fires).
    const listenersSnapshot = Array.from(saveListeners);
    return {
      committed: true,
      revision: nextRevision,
      committedAt: committedAtNow,
      listeners: listenersSnapshot,
      snapshotForListeners: deepFreezePersistable(clonePersistable(baseState)),
      reason: 'user'
    };
  }

  // Wrap flushNow so post-commit hooks fire outside the lock.
  const _originalFlushNow = flushNow;
  flushNow = function () {
    return _originalFlushNow().then(res => {
      if (res && res.committed && res.listeners) {
        for (const fn of res.listeners) {
          try { fn(res.snapshotForListeners, { revision: res.revision, committedAt: res.committedAt, reason: res.reason }); } catch (e) { /* isolate */ }
        }
        if (pendingOps.length > 0 && !conflict && !durabilityBlocker) scheduleFlush();
      }
      return res;
    });
  };

  // ── CONFLICT ─────────────────────────────────────
  function setConflict(c) {
    conflict = {
      id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      seq: c.op.seq,
      path: c.op.path,
      beforeExists: c.op.beforeExists,
      before: c.op.before,
      localAfterExists: c.op.afterExists,
      localAfter: c.op.after,
      savedExists: c.savedExists,
      savedValue: c.savedValue,
      createdAt: nowISO()
    };
    // Global signal so any UI can react.
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('lifeos:store-conflict', { detail: { path: conflict.path } }));
      }
    } catch (e) { /* ignore */ }
  }
  function resolveConflict(choice) {
    if (!conflict) return { ok: false, error: 'NO_CONFLICT' };
    const idx = pendingOps.findIndex(op => op.seq === conflict.seq);
    if (idx === -1) { conflict = null; rebuildOptimistic(); return { ok: true }; }
    if (choice === 'use-this-tab') {
      const orig = pendingOps[idx];
      pendingOps[idx] = {
        seq: orig.seq,
        kind: 'force-set',
        path: orig.path,
        beforeExists: orig.beforeExists,
        before: orig.before,
        afterExists: orig.afterExists,
        after: orig.after,
        createdAt: orig.createdAt
      };
    } else if (choice === 'use-saved-version') {
      pendingOps.splice(idx, 1);
    } else {
      return { ok: false, error: 'INVALID_CHOICE' };
    }
    conflict = null;
    rebuildOptimistic();
    notifyAll();
    scheduleFlush();
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('lifeos:store-conflict-resolved'));
      }
    } catch (e) { /* ignore */ }
    return { ok: true };
  }

  // ── FULL-STATE TRANSACTIONS ──────────────────────
  // Import / snapshot restore / reset. Freezes ordinary Store.set/update.
  // commitFullStateWrapper is token-guarded — no caller can bypass the freeze,
  // event deferral, or finally-cleanup guarantees.
  function beginFullStateTransaction(opts) {
    opts = opts || {};
    if (activeFullStateTransaction) return { ok: false, error: 'FULL_STATE_TRANSACTION_IN_PROGRESS' };
    if (pendingOps.length > 0 && !opts.force) return { ok: false, error: 'PENDING_CHANGES' };
    clearTimeout(saveTimer); saveTimer = null;
    activeFullStateTransaction = true;
    fullStateTxToken = { id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), reason: opts.reason || 'full-state' };
    // Fire freeze-begin so UI can render the banner.
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('lifeos:store-freeze-begin', { detail: { reason: fullStateTxToken.reason } }));
      }
    } catch (e) { /* ignore */ }
    return { ok: true, token: fullStateTxToken };
  }
  function endFullStateTransaction(token) {
    // Strict token enforcement: missing / wrong / stale / already-ended tokens
    // are rejected without mutating transaction state.
    if (!activeFullStateTransaction) return { ok: false, error: 'FULL_STATE_TRANSACTION_TOKEN_INVALID', reason: 'not-active' };
    if (!token || token !== fullStateTxToken) return { ok: false, error: 'FULL_STATE_TRANSACTION_TOKEN_INVALID', reason: 'token-mismatch' };
    activeFullStateTransaction = false;
    fullStateTxToken = null;
    // Discard queued event payload assumptions; re-read authoritative disk now.
    // Fail closed on any of: missing STATE_KEY where one was expected, corrupt
    // wrapper, lower revision than what we accepted. Adopt safely on a newer
    // valid wrapper.
    deferredStorageEvents.length = 0;
    let rawNow = null;
    try { rawNow = localStorage.getItem(STATE_KEY); } catch (e) { rawNow = null; }
    if (rawNow === null) {
      // Anything cleared the STATE_KEY after our transaction body ran (or the
      // body never wrote it). If we previously accepted a wrapper, this is a
      // durability invariant break.
      if (baseWrapperRaw !== null) setDurabilityBlocker('STORE_STATE_CLEARED_EXTERNAL');
    } else {
      const parsed = parseWrapperRaw(rawNow);
      if (!parsed || parsed.corrupt) {
        setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE');
      } else {
        const m = migrateAndValidate(parsed);
        if (!m.ok) {
          setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE');
        } else if (parsed.revision < knownRevision) {
          // Something regressed the disk under us — fail closed.
          setDurabilityBlocker('STORE_REVISION_REGRESSION', { diskRevision: parsed.revision, knownRevision });
        } else if (parsed.revision > knownRevision || rawNow !== baseWrapperRaw) {
          // Newer valid wrapper (or equal-revision but different raw) — adopt.
          baseState      = m.data;
          knownRevision  = parsed.revision;
          committedAt    = parsed.committedAt;
          baseWrapperRaw = rawNow;
        }
      }
    }
    rebuildOptimistic();
    notifyAll();
    try {
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        // Fire freeze-end AFTER settlement so listeners re-evaluating
        // getDurabilityBlocker() see the final state.
        window.dispatchEvent(new CustomEvent('lifeos:store-freeze-end', { detail: { durabilityBlocker: durabilityBlocker ? Object.assign({}, durabilityBlocker) : null } }));
      }
    } catch (e) { /* ignore */ }
    if (pendingOps.length > 0 && !conflict && !durabilityBlocker) scheduleFlush();
    return { ok: true, durabilityBlocker: durabilityBlocker ? Object.assign({}, durabilityBlocker) : null };
  }
  // Commit a full-state candidate (import / snapshot / reset) inside the
  // coordinator. Token guard enforces freeze; latest validated disk revision
  // + 1 is the ONLY revision source; Math.max shortcuts are forbidden.
  function commitFullStateWrapper(token, candidateData, reason) {
    if (!activeFullStateTransaction) return Promise.resolve({ ok: false, error: 'FULL_STATE_TRANSACTION_NOT_ACTIVE' });
    if (!fullStateTxToken || token !== fullStateTxToken) return Promise.resolve({ ok: false, error: 'FULL_STATE_TX_TOKEN_MISMATCH' });
    return withCoordinator(function () {
      // Re-read disk under lock. Corrupt disk = fail closed.
      let rawNow;
      try { rawNow = localStorage.getItem(STATE_KEY); } catch (e) { rawNow = null; }
      let diskRevision = 0;
      if (rawNow !== null) {
        const parsed = parseWrapperRaw(rawNow);
        if (!parsed || parsed.corrupt) {
          setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE');
          return { ok: false, error: 'STORE_CORRUPT_AUTHORITATIVE_STATE' };
        }
        diskRevision = parsed.revision;
      }
      let cloned;
      try { cloned = clonePersistable(candidateData); } catch (e) { return { ok: false, error: 'STORE_UNPERSISTABLE' }; }
      normalizeLogbookDomain(cloned);
      if (!validate(cloned)) return { ok: false, error: 'FULL_STATE_INVALID' };
      // Latest validated disk revision + 1 — no Math.max, no knownRevision shortcut.
      if (diskRevision >= Number.MAX_SAFE_INTEGER) return { ok: false, error: 'STORE_REVISION_EXHAUSTED' };
      const nextRevision = diskRevision + 1;
      const committedAtNow = nowISO();
      const wrapper = { version: SCHEMA_VERSION, revision: nextRevision, committedAt: committedAtNow, data: cloned };
      let payload;
      try { payload = JSON.stringify(wrapper); } catch (e) { return { ok: false, error: 'STORE_SERIALIZE_FAILED' }; }
      try { localStorage.setItem(STATE_KEY, payload); } catch (e) { return { ok: false, error: 'STORE_QUOTA' }; }
      { const _snap = pushSnapshot(payload); if (!_snap.ok) emitError({ code: 'STORE_SNAPSHOT_DEGRADED', revision: nextRevision, error: String((_snap.error && _snap.error.message) || _snap.error) }); }
      baseState      = cloned;
      knownRevision  = nextRevision;
      committedAt    = committedAtNow;
      baseWrapperRaw = payload;
      pendingOps     = [];
      conflict       = null;
      durabilityBlocker = null; // an approved full-state transaction clears the blocker
      return { ok: true, revision: nextRevision, committedAt: committedAtNow, reason: reason || 'full-state' };
    });
  }

  // ── STORAGE EVENTS ───────────────────────────────
  function onStorage(e) {
    if (!e || e.key !== STATE_KEY) return;
    if (activeFullStateTransaction) {
      // Queue only "something changed" — do not trust old queued payload
      // when we settle; endFullStateTransaction rereads authoritative disk.
      deferredStorageEvents.push({ at: nowISO() });
      return;
    }
    const rawNow = e.newValue;
    if (rawNow === null) {
      // External clear of an accepted STATE_KEY — persistent invariant break.
      if (baseWrapperRaw !== null) setDurabilityBlocker('STORE_STATE_CLEARED_EXTERNAL');
      return;
    }
    if (rawNow === baseWrapperRaw) return;
    const parsed = parseWrapperRaw(rawNow);
    if (!parsed || parsed.corrupt) { setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE'); return; }
    const m = migrateAndValidate(parsed);
    if (!m.ok) { setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE'); return; }
    if (parsed.revision > knownRevision) {
      adoptExternal(m.data, parsed, rawNow);
      return;
    }
    if (parsed.revision === knownRevision) {
      // Equal revision — defensively reread actual current disk even with
      // Web Locks (per Codex §15 correction). If disk still shows a raw
      // different from what we hold, adopt/rebase and surface collision.
      let diskRaw = null;
      try { diskRaw = localStorage.getItem(STATE_KEY); } catch (err) { diskRaw = null; }
      if (diskRaw === baseWrapperRaw) return;
      if (diskRaw === null) { setDurabilityBlocker('STORE_STATE_CLEARED_EXTERNAL'); return; }
      const dparsed = parseWrapperRaw(diskRaw);
      if (!dparsed || dparsed.corrupt) { setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE'); return; }
      const dm = migrateAndValidate(dparsed);
      if (!dm.ok) { setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE'); return; }
      if (dparsed.revision >= knownRevision) {
        adoptExternal(dm.data, dparsed, diskRaw);
        if (dparsed.revision === knownRevision) emitError({ code: 'STORE_REVISION_COLLISION', revision: dparsed.revision });
      } else {
        setDurabilityBlocker('STORE_REVISION_REGRESSION', { diskRevision: dparsed.revision, knownRevision });
      }
      return;
    }
    // parsed.revision < knownRevision — persistent regression blocker.
    setDurabilityBlocker('STORE_REVISION_REGRESSION', { diskRevision: parsed.revision, knownRevision });
  }
  function adoptExternal(data, parsed, rawWrapper) {
    baseState      = data;
    knownRevision  = parsed.revision;
    committedAt    = parsed.committedAt;
    baseWrapperRaw = rawWrapper;
    clearTimeout(saveTimer); saveTimer = null;
    const r = strictReplay(baseState, pendingOps);
    if (r.conflict) {
      setConflict(r.conflict);
    }
    rebuildOptimistic();
    notifyAll();
    if (!conflict && pendingOps.length > 0) scheduleFlush();
  }
  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('storage', onStorage);
    }
  } catch (e) { /* ignore */ }

  // ── BACKWARDS-COMPAT PAUSE API ───────────────────
  function pausePersistence() {
    if (saveTimer !== null) { dirtyWhilePaused = true; clearTimeout(saveTimer); saveTimer = null; }
    paused = true;
  }
  function resumePersistence() {
    if (!paused) return;
    paused = false;
    if (dirtyWhilePaused) { dirtyWhilePaused = false; scheduleFlush(); }
  }
  function isPersistencePaused() { return paused; }

  // Synchronous best-effort persist for callers relying on the pre-B0 API.
  // Kicks the coordinator and does not await it. If a caller genuinely needs
  // a completed write it should call Store.flushNow().
  function persistNow() {
    if (paused) return;
    if (activeFullStateTransaction) return;
    if (pendingOps.length === 0) return;
    // Best-effort: schedule an immediate flush without debounce.
    clearTimeout(saveTimer); saveTimer = null;
    flushNow();
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
    onError: (fn) => { errorListeners.add(fn); return () => errorListeners.delete(fn); },
    raw: () => clonePersistable(state),
    persistNow,
    flushNow,
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
    deriveStateFromLegacy,
    // Exposed for import derivation: migrate a bare `data` object (of any
    // prior schema version) up to the current schema. Never touches Store.
    migrateData: function (data, fromVersion) {
      return migrateUp(data || {}, fromVersion || 0);
    },
    normalizeLogbookDomain,
    validateData: validate,
    snapshots: () => {
      try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]'); } catch (e) { return []; }
    },
    // Snapshot restore + reset become full-state transactions.
    // Kept sync-callable for backward compat with existing UI: begin freeze,
    // fire the commit through the coordinator, settle on completion. The
    // returned boolean reports whether the transaction was accepted for
    // dispatch (mirrors legacy semantics); durability lands under the lock.
    restoreSnapshot: function (i, opts) {
      opts = opts || {};
      let snap;
      try {
        const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
        snap = snaps[i || 0];
      } catch (e) { return { ok: false, error: 'SNAPSHOT_LIST_UNREADABLE' }; }
      if (!snap) return { ok: false, error: 'SNAPSHOT_NOT_FOUND' };
      let parsed;
      try { parsed = JSON.parse(snap.payload); } catch (e) { return { ok: false, error: 'SNAPSHOT_SOURCE_WRAPPER_INVALID' }; }
      // Schema-13 snapshots must carry a valid integer revision; malformed
      // sources are rejected outright — no Store state mutation, no new
      // live wrapper minted from bad source data. Schema ≤12 remain
      // migratable.
      if (!isValidSnapshotWrapper(parsed)) return { ok: false, error: 'SNAPSHOT_SOURCE_WRAPPER_INVALID' };
      const data = (parsed.version === SCHEMA_VERSION && parsed.data)
        ? parsed.data
        : migrateUp(parsed.data || {}, parsed.version || 0);
      normalizeLogbookDomain(data);
      const gate = beginFullStateTransaction({ force: !!opts.force, reason: 'snapshot' });
      if (!gate.ok) return { ok: false, error: gate.error };
      commitFullStateWrapper(gate.token, data, 'snapshot').then(res => {
        try {
          if (res && res.ok) {
            const frozen = deepFreezePersistable(clonePersistable(baseState));
            for (const fn of saveListeners) {
              try { fn(frozen, { revision: res.revision, committedAt: res.committedAt, reason: res.reason }); } catch (e) {}
            }
          }
        } finally { endFullStateTransaction(gate.token); }
      }, () => { endFullStateTransaction(gate.token); });
      return { ok: true };
    },
    reset: function (opts) {
      opts = opts || {};
      const gate = beginFullStateTransaction({ force: !!opts.force, reason: 'reset' });
      if (!gate.ok) return false;
      commitFullStateWrapper(gate.token, defaultState(), 'reset').then(res => {
        try {
          if (res && res.ok) {
            const snap = deepFreezePersistable(clonePersistable(baseState));
            for (const fn of saveListeners) {
              try { fn(snap, { revision: res.revision, committedAt: res.committedAt, reason: res.reason }); } catch (e) {}
            }
          }
        } finally { endFullStateTransaction(gate.token); }
      }, () => { endFullStateTransaction(gate.token); });
      return true;
    },
    // Full-state transaction primitives — for import/snapshot/reset callers.
    // commitFullStateWrapper is token-guarded (must be preceded by
    // beginFullStateTransaction; endFullStateTransaction must be called in a
    // finally).
    beginFullStateTransaction,
    endFullStateTransaction,
    commitFullStateWrapper,
    // Durability blocker surface.
    getDurabilityBlocker: function () { return durabilityBlocker ? Object.assign({}, durabilityBlocker) : null; },
    clearDurabilityBlocker,
    // "Something unsaved / unsafe" predicate for beforeunload wiring.
    hasUnsavedWork: function () {
      return !!(pendingOps.length > 0 || conflict || activeFullStateTransaction || durabilityBlocker);
    },
    // Read-only wrapper metadata for About/status UI.
    wrapperMeta: () => ({ revision: knownRevision, committedAt: committedAt, capabilities: Object.assign({}, capabilities) }),
    capabilities,
    // Conflict surface.
    // Deep-clone + freeze so external mutation cannot alter queued CAS intent.
    getConflict: () => (conflict ? deepFreezePersistable(clonePersistable(conflict)) : null),
    resolveConflict,
    // For post-commit listener firing.
    _internal_fireSaveListeners: function (frozenSnap, meta) {
      for (const fn of saveListeners) { try { fn(frozenSnap, meta); } catch (e) {} }
    },
    derive
  };
})(window);
