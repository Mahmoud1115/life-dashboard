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
  const SCHEMA_VERSION = 14;
  // PRV-0.5 R2 (ADR-015 addendum #1): version 14 introduces persisted
  // migration-status state for the four record domains (deadlines,
  // claims, risks, goals) under `data.records.*` with a companion
  // `data.meta.recordsMigration` marker. Fresh cold-boot state is
  // `{ status: 'migrated', at: <iso> }` with empty record arrays, so
  // Reset cannot resurrect legacy personal records. A v13 wrapper
  // migrated up marks `status: 'unmigrated'`; app.js hydration reads
  // this marker to decide whether to seed from LEGACY_RECORDS.
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
      // PRV-0.5 R2 (schema 14): explicit per-domain record store for
      // deadlines / claims / risks / goals. Fresh state ships EMPTY;
      // hydration in app.js seeds from LEGACY_RECORDS only when a
      // v13-or-earlier wrapper is migrated up (see meta.recordsMigration).
      records: {
        deadlines: [],
        claims: [],
        risks: [],
        goals: []
      },
      meta: {
        version: SCHEMA_VERSION,
        createdAt: isoNow,
        lastUpdated: isoNow,
        // Fresh cold-boot and post-Reset state is `migrated + empty`:
        // Reset cannot rehydrate legacy personal records because the
        // hydration path (app.js) only fires when status === 'unmigrated'.
        recordsMigration: {
          status: 'migrated',
          schemaVersion: SCHEMA_VERSION,
          at: isoNow,
          reason: 'default-state'
        }
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

    // v13 → v14: records subtree + persisted migration marker (ADR-015
    // addendum #1 / PRV-0.5 Round 2). A wrapper that reaches this
    // migration step from a version <14 has never carried a records.*
    // subtree; app.js hydration is responsible for populating it from
    // LEGACY_RECORDS + any surviving Gen-1 override keys. The marker
    // starts as 'unmigrated' so hydration fires on next boot; hydration
    // flips it to 'migrated' only after durable persistence is verified.
    // A wrapper migrated up that ALREADY has records.* populated (e.g.
    // an older PRV-0.5 attempt that persisted its shape but not the
    // marker) is preserved: records survive, and the marker is set
    // conservatively to 'unmigrated' so the async verifier can prove
    // durability before promoting to 'migrated'.
    if ((fromVersion || 0) < 14) {
      if (!s.records || typeof s.records !== 'object' || Array.isArray(s.records)) {
        s.records = { deadlines: [], claims: [], risks: [], goals: [] };
      } else {
        for (const d of ['deadlines', 'claims', 'risks', 'goals']) {
          if (!Array.isArray(s.records[d])) s.records[d] = [];
        }
      }
      if (!s.meta.recordsMigration || typeof s.meta.recordsMigration !== 'object') {
        s.meta.recordsMigration = {
          status: 'unmigrated',
          schemaVersion: SCHEMA_VERSION,
          priorSchemaVersion: fromVersion || 0,
          reason: 'migrateUp-from-v' + (fromVersion || 0)
        };
      }
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
  // Wrapper-only structural gate. Used by both snapshot paths; data-level
  // validation is performed separately (see validateSnapshotWrapperFull).
  //
  // PRV-0.5 R5 (Codex Round-4 P1-5): reject wrappers whose version is
  // strictly greater than SCHEMA_VERSION. Unknown future semantics MUST
  // NOT be silently downgraded by migrateUp; the wrapper is quarantined.
  function isValidSnapshotWrapperShape(parsed) {
    if (!parsed || typeof parsed !== 'object') return false;
    if (typeof parsed.version !== 'number' || !Number.isInteger(parsed.version)) return false;
    if (parsed.version > SCHEMA_VERSION) return false;
    if (parsed.version === 13) {
      const rev = parsed.revision;
      if (!(typeof rev === 'number' && Number.isFinite(rev) && Number.isInteger(rev) && rev >= 0 && rev <= Number.MAX_SAFE_INTEGER)) {
        return false;
      }
    }
    return !!parsed.data;
  }
  // Full snapshot wrapper validation: structural gate → SOURCE
  // validation → migrate → Store data validation → canonical evaluator.
  // Never mutates Store. Returns { ok, data?, reason? }; on ok:true, data
  // is the migrated candidate suitable for commitFullStateWrapper.
  //
  // PRV-0.5 R5: routes through the Store-owned authority evaluator so the
  // snapshot-restore boundary applies the same canonical marker + records +
  // future-version rules used by hydration and import.
  //
  // PRV-0.5 R6 (Codex Round-5 P1-5): SOURCE validation runs BEFORE
  // migrateUp so that a source-invalid legacy generation (e.g. a v13
  // snapshot missing required `money.salary_net`) is REJECTED rather
  // than default-filled into plausibility. Recovery selection can
  // then skip this snapshot and choose the next independently valid
  // generation. Fields that legitimately did not exist in that
  // historical schema are NOT required at the source stage.
  function validateSnapshotWrapperFull(parsed) {
    if (!isValidSnapshotWrapperShape(parsed)) return { ok: false, reason: 'SNAPSHOT_WRAPPER_SHAPE_INVALID' };
    const sourceCheck = validateLegacySourceRequiredFields(parsed.data, parsed.version);
    if (!sourceCheck.ok) return { ok: false, reason: 'SNAPSHOT_SOURCE_' + sourceCheck.reason };
    let migrated;
    try {
      migrated = (parsed.version === SCHEMA_VERSION && parsed.data)
        ? parsed.data
        : migrateUp(parsed.data || {}, parsed.version || 0);
      normalizeLogbookDomain(migrated);
    } catch (e) { return { ok: false, reason: 'SNAPSHOT_MIGRATE_THREW' }; }
    if (!validate(migrated)) return { ok: false, reason: 'SNAPSHOT_DATA_INVALID' };
    const evalRes = evaluateCandidateData(migrated);
    if (!evalRes.canonical) return { ok: false, reason: 'SNAPSHOT_CANDIDATE_' + evalRes.classification };
    return { ok: true, data: migrated };
  }
  // PRV-0.5 R6 (Codex Round-5 P1-5): source-required invariants keyed
  // by the wrapper's DECLARED historical schema version. This runs
  // BEFORE migrateUp fills defaults so a snapshot / import candidate
  // whose stored data is missing an invariant that its own schema
  // required is REJECTED — the next independently valid generation
  // wins. Schemas prior to v12 predate the money slice and are not
  // required to carry it; from v12 onward the money slice was written
  // and is required.
  // PRV-0.5 R7 (Codex Round-6 P1-6, INV-7): historical source
  // validation is version-specific and runs BEFORE migrateUp default-
  // fill. A candidate whose declared source version required a domain
  // to be present cannot become valid because migrateUp inserts a
  // default in that domain's place.
  //
  // Required-domain floors derived from this repo's own migrateUp
  // history (see core.js `migrateUp`):
  //   money.salary_net (number)  → introduced ≤ v11, required from v12+
  //   qatarVisit (object)        → present from earliest tracked, required v12+
  //   career (object)            → v5+ additive; required v13+
  //   easa (object)              → v4+; required v13+
  //   logbook envelope OR array  → v11 legacy array; v12+ envelope; both accepted at v12+
  //   bht (object)               → v7+; required v13+
  //   telemetry (object)         → v8+; required v13+
  //   ideas (array)              → v9+; required v13+
  //   apartments (array)         → v6+; required v13+
  //   about (object)             → v2+; required v13+
  //   sbTasks (object)           → v6+; required v13+
  //   reviews (array)            → v3+; required v13+
  //   decisions (array)          → v3+; required v13+
  //   timeline (array)           → v1+; required v13+
  //   todayFocus (array)         → v1+; required v13+
  //   goals (object)             → v1+ / v14-records-goals; required v13 as object
  // records subtree + meta.recordsMigration are v14-only — NEVER
  // required in a historical source.
  // PRV-0.5 Final Closure (INV-I, R7-P1-08): version-indexed source
  // requirements matrix. Rather than ad-hoc v12 / v13 branches, the
  // requirements are DERIVED FROM migrateUp's own field-introduction
  // timeline in this file:
  //   - money, qatarVisit               — validate() gate (all versions)
  //   - career, about, timeline,
  //     reviews, decisions, todayFocus  — default-filled from v1 onward
  //     but were also emitted by every real production wrapper the
  //     app ever wrote (initialLoad has always guaranteed them via
  //     defaultState); require from v6 (oldest we support).
  //   - bht {habits, entries}           — introduced v6→v7 (line 632)
  //   - telemetry                       — introduced v7→v8 (line 634)
  //   - ideas                           — introduced v8→v9 (line 643)
  //   - logbook                         — envelope introduced v11→v12
  //                                        (line 652); v11 legacy shape
  //                                        is the flat Tracker array,
  //                                        also acceptable pre-migration
  //   - integer revision                — required at wrapper level v13+
  //                                        (enforced in parseWrapperRaw)
  //   - records / recordsMigration      — v14 (current schema)
  //
  // v0..v5 are not supported as legacy sources. If a real disk carries
  // a v<6 wrapper, we fail closed (per Final Closure §7 Q1) — the user
  // must recover via the explicit legacy-only import path
  // (deriveStateFromLegacy) rather than allowing default-fill of an
  // ambiguous ancient shape.
  // v6..v11: only the runtime validate() floor (money+salary_net,
  // qatarVisit) is enforced pre-migration. Older wrappers in this
  // range predate the codified per-version emission guarantees and
  // we accept them for migration to preserve backward compatibility
  // with historical fixtures. v12+ carries the strict per-version
  // requirements Codex P1-08 identified.
  const HISTORICAL_SCHEMA_REQUIREMENTS = {
    12: { requiredObjects: ['money', 'qatarVisit', 'career', 'easa', 'about', 'sbTasks', 'goals', 'bht', 'telemetry'],
          requiredArrays:  ['todayFocus', 'timeline', 'reviews', 'decisions', 'ideas', 'apartments'],
          nested: {
            'bht.habits': 'array', 'bht.entries': 'array',
            'logbook': 'array-or-object',   // envelope introduced v12; legacy array still tolerated
            'money.salary_net': 'number'
          } },
    13: { requiredObjects: ['money', 'qatarVisit', 'career', 'easa', 'about', 'sbTasks', 'goals', 'bht', 'telemetry'],
          requiredArrays:  ['todayFocus', 'timeline', 'reviews', 'decisions', 'ideas', 'apartments'],
          nested: {
            'bht.habits': 'array', 'bht.entries': 'array',
            'logbook': 'array-or-object',
            'money.salary_net': 'number'
          } }
  };
  function _checkNestedShape(data, spec) {
    for (const path of Object.keys(spec)) {
      const parts = path.split('.');
      let cur = data;
      for (let i = 0; i < parts.length; i++) {
        if (cur === null || cur === undefined || typeof cur !== 'object') return { ok: false, reason: 'missing-' + path };
        cur = cur[parts[i]];
      }
      const kind = spec[path];
      if (kind === 'array' && !Array.isArray(cur)) return { ok: false, reason: 'malformed-' + path };
      if (kind === 'number' && typeof cur !== 'number') return { ok: false, reason: 'malformed-' + path };
      if (kind === 'array-or-object') {
        const ok = Array.isArray(cur) || (cur && typeof cur === 'object');
        if (!ok) return { ok: false, reason: 'malformed-' + path };
      }
    }
    return { ok: true };
  }
  function validateLegacySourceRequiredFields(data, version) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'shape-invalid' };
    }
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      return { ok: false, reason: 'version-not-integer' };
    }
    // Money/salary + qatarVisit are the runtime `validate()` floor for
    // every version.
    if (!data.money || typeof data.money !== 'object' || Array.isArray(data.money)) return { ok: false, reason: 'missing-money' };
    if (typeof data.money.salary_net !== 'number') return { ok: false, reason: 'missing-money-salary_net' };
    if (!data.qatarVisit || typeof data.qatarVisit !== 'object' || Array.isArray(data.qatarVisit)) return { ok: false, reason: 'missing-qatarVisit' };
    // PRV-0.5 Pre-Push Amendment §6 (evidence-based historical
    // matrix): git-log evidence confirms `{version: N, data:{...}}`
    // emission at v8 (85e1d22, 2026-06-14) and v12 (521fe70,
    // 2026-08-25), plus the v13 wrapper with integer revision at
    // 94254c4 (2026-08-25) and v14 with records subtree at 4ead699
    // (2026-08-29). v0..v7 are BEFORE bht was introduced (5313b61)
    // — no confirmed emission with the current defaultState shape
    // exists in this branch's history. Fail closed for <v8. v8..v11
    // are accepted at the runtime validate() floor (money+salary_net
    // + qatarVisit) because pre-B0 wrappers wrote a minimal
    // {version, data} envelope; the per-version emission set can be
    // interpolated from migrateUp's field-introduction timeline but
    // is not directly attested by a persisted-artifact fixture.
    // v12+ carries the strict Codex P1-08 requirements.
    if (version < 8) return { ok: false, reason: 'version-unsupported', version };
    if (version < 12) return { ok: true };
    const req = HISTORICAL_SCHEMA_REQUIREMENTS[Math.min(version, 13)];
    if (!req) return { ok: false, reason: 'no-requirements-matrix', version };
    for (const d of req.requiredObjects) {
      if (!data[d] || typeof data[d] !== 'object' || Array.isArray(data[d])) {
        return { ok: false, reason: 'missing-' + d, version };
      }
    }
    for (const d of req.requiredArrays) {
      if (!Array.isArray(data[d])) return { ok: false, reason: 'missing-' + d, version };
    }
    // BHT substructure: preserve R6/R7 reason string
    // `malformed-bht-substructure` for backward compat with existing
    // reason-coupled tests.
    if (data.bht && (!Array.isArray(data.bht.habits) || !Array.isArray(data.bht.entries))) {
      return { ok: false, reason: 'malformed-bht-substructure', version };
    }
    const nested = _checkNestedShape(data, req.nested);
    if (!nested.ok) return { ok: false, reason: nested.reason, version };
    return { ok: true };
  }
  function getHistoricalRequirements(version) {
    if (typeof version !== 'number' || !Number.isInteger(version)) return null;
    if (version < 12 || version >= SCHEMA_VERSION) return null;
    return HISTORICAL_SCHEMA_REQUIREMENTS[Math.min(version, 13)] || null;
  }
  // PRV-0.5 R7 (Codex Round-6 P1-3, INV-4): COMPLETE canonical
  // full-state validation for schema-14 destructive commits. Every
  // required top-level domain must exist with the right container
  // type. Missing/wrong-type/null domains fail closed before mutation.
  function validateFullStateCanonical(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, reason: 'shape-invalid' };
    }
    const requiredObjects = ['money', 'qatarVisit', 'goals', 'career', 'easa', 'about', 'sbTasks', 'bht', 'telemetry', 'meta'];
    const missing = [];
    for (const d of requiredObjects) {
      if (!data[d] || typeof data[d] !== 'object' || Array.isArray(data[d])) missing.push(d);
    }
    const requiredArrays = ['todayFocus', 'reviews', 'decisions', 'timeline', 'apartments', 'ideas'];
    for (const d of requiredArrays) {
      if (!Array.isArray(data[d])) missing.push(d);
    }
    // logbook: envelope object OR (legacy) array — accepted.
    if (!(Array.isArray(data.logbook) || (data.logbook && typeof data.logbook === 'object' && !Array.isArray(data.logbook)))) {
      missing.push('logbook');
    }
    // money nested invariants.
    if (data.money && (typeof data.money.salary_net !== 'number' || !data.money.expenses || typeof data.money.expenses !== 'object')) {
      missing.push('money.salary_net-or-expenses');
    }
    // bht nested invariants — habits/entries arrays required.
    if (data.bht && (!Array.isArray(data.bht.habits) || !Array.isArray(data.bht.entries))) {
      missing.push('bht.habits-or-entries');
    }
    // records subtree (v14 addition).
    if (!data.records || typeof data.records !== 'object' || Array.isArray(data.records)) {
      missing.push('records');
    } else {
      for (const d of ['deadlines', 'claims', 'risks', 'goals']) {
        if (!Array.isArray(data.records[d])) missing.push('records.' + d);
      }
    }
    // meta.recordsMigration required (canonical marker).
    if (data.meta) {
      const m = data.meta.recordsMigration;
      if (!m || typeof m !== 'object' || Array.isArray(m)) missing.push('meta.recordsMigration');
      else if (m.schemaVersion !== SCHEMA_VERSION) missing.push('meta.recordsMigration.schemaVersion');
      else if (m.status !== MARKER_STATUS_MIGRATED && m.status !== MARKER_STATUS_UNMIGRATED) missing.push('meta.recordsMigration.status');
    }
    if (missing.length > 0) return { ok: false, missing: missing, reason: 'missing-required-domains' };
    return { ok: true };
  }
  // Retained alias — existing callers went through the shape-only gate.
  // Every production caller of the old name has been switched to the
  // Full validator; keep the name as an alias for backward reference.
  function isValidSnapshotWrapper(parsed) { return isValidSnapshotWrapperShape(parsed); }
  function restoreFromSnapshot() {
    try {
      const snaps = JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]');
      for (const s of snaps) {
        try {
          const parsed = JSON.parse(s.payload);
          // Skip snapshots whose wrapper OR data would not be accepted by
          // the live Store. Data-invalid snapshots continue the loop; the
          // next recoverable one wins.
          const v = validateSnapshotWrapperFull(parsed);
          if (!v.ok) continue;
          return v.data;
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
  // PRV-0.5 R4 (Codex Round-3 P1-B): a supplementary shape guard used by
  // DESTRUCTIVE boundaries only (snapshot restore, import). Every
  // schema-14 candidate MUST carry a canonical migration marker AND a
  // canonical records shape — a missing/invalid marker or missing/
  // non-array domain is REJECTED at the destructive boundary rather
  // than silently accepted (which is the Codex Round-3 bypass that let
  // a marker-less schema-14 backup overwrite good current state and
  // trigger intent-inventing legacy resurrection). Load-time uses the
  // softer `validate()` above so a stale-shape wrapper still loads and
  // can be healed by app.js hydration rather than being rejected into
  // a stranded disk-vs-memory revision divergence.
  function isRecordsMigrationShapeSafe(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    // A schema-14 candidate MUST carry a marker with a recognized status.
    // Missing/invalid/unknown-status = REJECT at destructive boundary.
    const rm = data.meta && data.meta.recordsMigration;
    if (!rm || typeof rm !== 'object' || Array.isArray(rm)) return false;
    if (rm.status !== 'migrated' && rm.status !== 'unmigrated') return false;
    // Canonical records shape is REQUIRED regardless of marker status —
    // both migrated and unmigrated schema-14 states carry all four
    // arrays after migrateUp. A shape violation at destructive commit
    // would replace good current state with malformed data.
    const r = data.records;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
    for (const d of ['deadlines', 'claims', 'risks', 'goals']) {
      if (!Array.isArray(r[d])) return false;
    }
    return true;
  }
  // ══════════════════════════════════════════════════════════════
  // PRV-0.5 R5 (ADR-015 addendum #4): STORE-OWNED AUTHORITY EVALUATOR.
  //
  // Codex Round-4 identified five HIGH-risk defects rooted in the SAME
  // architectural cause: parallel authority predicates in app.js and
  // core.js diverged and let ambiguous / stale / corrupt / future
  // wrappers pass one path while the other rejected them. R5 collapses
  // every wrapper-authority decision into this single evaluator.
  //
  // Consumers:
  //   - hydration fast-path (app.js) → evaluatePersistedAuthority()
  //   - production import (app.js processImport) → evaluateCandidateWrapper()
  //   - snapshot restore (validateSnapshotWrapperFull) → evaluateCandidateData()
  //   - backup/export (app.js exportBackup / copyBackupToClipboard) →
  //         evaluatePersistedAuthority() then checks acceptForBackup
  //   - boot recovery (initialLoad) → applies same classification to
  //         decide durability blocker vs. legacy fallback
  //
  // Classifications (six behavioural classes; A/B/G share behaviour and
  // return AUTHORITATIVE_MIGRATED with sub-flags):
  //   AUTHORITATIVE_MIGRATED     (A / B / G)
  //   VERIFIED_LEGACY_TRANSITION (C — the ONLY class that authorises
  //                                    LEGACY_RECORDS seeding)
  //   MALFORMED_CURRENT_SCHEMA   (D — invalid marker / non-canonical
  //                                    records / non-canonical marker
  //                                    schemaVersion / unmigrated w/o
  //                                    supported provenance)
  //   CORRUPT_STALE_COLLIDING    (E — invalid wrapper JSON, invalid
  //                                    revision, stale revision, equal
  //                                    revision divergent bytes, active
  //                                    Store durability blocker)
  //   UNSUPPORTED_FUTURE_SCHEMA  (F — version > SCHEMA_VERSION)
  //   ABSENT                     (no wrapper on disk / no candidate)
  //
  // Only VERIFIED_LEGACY_TRANSITION authorises LEGACY_RECORDS seeding.
  // Only AUTHORITATIVE_MIGRATED authorises the hydration fast-path
  // "already-migrated" skip AND normal backup export.
  // MALFORMED / CORRUPT / FUTURE always require explicit recovery
  // (accepted snapshot / import / reset) — never a synthesized `[]`,
  // never a silent seed, never a normal backup.
  // ══════════════════════════════════════════════════════════════

  const MARKER_STATUS_MIGRATED = 'migrated';
  const MARKER_STATUS_UNMIGRATED = 'unmigrated';
  const REQUIRED_RECORD_DOMAINS = ['deadlines', 'claims', 'risks', 'goals'];
  // Legacy transition source versions. migrateUp only understands
  // wrappers whose version is strictly less than SCHEMA_VERSION; higher
  // versions are UNSUPPORTED_FUTURE_SCHEMA.
  function isSupportedLegacySourceVersion(v) {
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < SCHEMA_VERSION;
  }
  // Canonical marker predicate. A schema-14 marker MUST carry:
  //   - status ∈ { 'migrated', 'unmigrated' }
  //   - schemaVersion === SCHEMA_VERSION (exact — future/older not accepted)
  //   - for 'unmigrated': priorSchemaVersion in [0..SCHEMA_VERSION-1] AND
  //     reason string matching migrateUp's provenance format
  //     ('migrateUp-from-vN' where N === priorSchemaVersion).
  // The provenance requirement is what makes an 'unmigrated' marker
  // PROVABLE — an arbitrary caller cannot fabricate a marker that
  // passes this check without also claiming a supported priorSchema.
  function classifyMarker(marker) {
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
      return { canonical: false, kind: 'missing' };
    }
    if (marker.schemaVersion !== SCHEMA_VERSION) {
      return { canonical: false, kind: 'wrong-schema-version' };
    }
    if (marker.status === MARKER_STATUS_MIGRATED) {
      return { canonical: true, kind: 'migrated' };
    }
    if (marker.status === MARKER_STATUS_UNMIGRATED) {
      if (!isSupportedLegacySourceVersion(marker.priorSchemaVersion)) {
        return { canonical: false, kind: 'unmigrated-no-provenance' };
      }
      const expectedReason = 'migrateUp-from-v' + marker.priorSchemaVersion;
      if (marker.reason !== expectedReason) {
        return { canonical: false, kind: 'unmigrated-reason-mismatch' };
      }
      return { canonical: true, kind: 'unmigrated' };
    }
    return { canonical: false, kind: 'unknown-status' };
  }
  // Canonical records-domain predicate. All four required domains must
  // be present as arrays. Absent / non-array / non-object = malformed.
  // Used identically at every destructive boundary; there is NO length
  // inference, and a missing domain is NEVER synthesized to [].
  function classifyRecords(records) {
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      return { canonical: false, kind: 'missing-or-shape-invalid', missing: REQUIRED_RECORD_DOMAINS.slice() };
    }
    const missing = [];
    for (const d of REQUIRED_RECORD_DOMAINS) {
      if (!Array.isArray(records[d])) missing.push(d);
    }
    if (missing.length) return { canonical: false, kind: 'missing-domain', missing };
    let allEmpty = true;
    for (const d of REQUIRED_RECORD_DOMAINS) {
      if (records[d].length > 0) { allEmpty = false; break; }
    }
    return { canonical: true, kind: allEmpty ? 'all-empty' : 'populated', allEmpty };
  }
  // Evaluate a bare `data` object (post-migrateUp when needed). Used by
  // snapshot restore, import candidate validation, and the boot-recovery
  // path. Returns { canonical, classification, marker, records, reasons }.
  function evaluateCandidateData(data) {
    const reasons = [];
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { canonical: false, classification: 'MALFORMED_CURRENT_SCHEMA', reasons: ['data-shape-invalid'] };
    }
    const marker = data.meta && data.meta.recordsMigration;
    const mk = classifyMarker(marker);
    const rk = classifyRecords(data.records);
    if (!mk.canonical) reasons.push('marker:' + mk.kind);
    if (!rk.canonical) reasons.push('records:' + rk.kind + (rk.missing ? '[' + rk.missing.join(',') + ']' : ''));
    if (mk.canonical && rk.canonical) {
      if (mk.kind === 'migrated') {
        return {
          canonical: true,
          classification: 'AUTHORITATIVE_MIGRATED',
          allEmpty: rk.allEmpty === true,
          marker: marker, records: data.records, reasons
        };
      }
      // unmigrated + canonical provenance + canonical records (four
      // arrays present) → VERIFIED_LEGACY_TRANSITION.
      //
      // Records are permitted to be non-empty here: a partial prior
      // migration attempt may have persisted some records BEFORE the
      // marker flip. The R5 authority contract keys off provenance
      // alone (priorSchemaVersion + canonical reason) — a fabricated
      // 'unmigrated' marker cannot pass classifyMarker regardless of
      // records emptiness.
      return {
        canonical: true,
        classification: 'VERIFIED_LEGACY_TRANSITION',
        marker: marker, records: data.records, reasons
      };
    }
    return { canonical: false, classification: 'MALFORMED_CURRENT_SCHEMA', marker, records: data.records, reasons };
  }
  // Evaluate an external candidate WRAPPER (parsed JSON object OR raw
  // JSON string) for destructive boundaries (import, snapshot restore).
  // Does NOT consider Store's live baseWrapperRaw / durabilityBlocker
  // (those belong to evaluatePersistedAuthority — the live-disk view).
  function evaluateCandidateWrapper(input) {
    if (input === null || input === undefined) {
      return { classification: 'ABSENT', canonical: false, reasons: ['absent'] };
    }
    let parsed;
    if (typeof input === 'string') {
      const p = parseWrapperRaw(input);
      if (!p) return { classification: 'ABSENT', canonical: false, reasons: ['null-parse'] };
      if (p.corrupt) {
        // PRV-0.5 R6 (Codex Round-5 P2-1): a future-version string
        // candidate must classify as UNSUPPORTED_FUTURE_SCHEMA — same
        // as the object-candidate branch below and the live-disk
        // evaluatePersistedAuthority path. Never collapse a known
        // future version into generic corruption.
        if (p.reason === 'wrapper-version-unsupported') {
          return { classification: 'UNSUPPORTED_FUTURE_SCHEMA', canonical: false, reasons: ['wrapper-version-unsupported', 'version=' + p.version], wrapperVersion: p.version };
        }
        return { classification: 'CORRUPT_STALE_COLLIDING', canonical: false, reasons: ['wrapper-corrupt', 'reason=' + (p.reason || 'unknown')] };
      }
      parsed = p;
    } else if (typeof input === 'object' && !Array.isArray(input)) {
      // Bare candidate wrapper object (from JSON.parse in caller).
      const v = (typeof input.version === 'number' && Number.isInteger(input.version)) ? input.version : null;
      if (v === null) return { classification: 'CORRUPT_STALE_COLLIDING', canonical: false, reasons: ['wrapper-version-invalid'] };
      if (v > SCHEMA_VERSION) {
        return { classification: 'UNSUPPORTED_FUTURE_SCHEMA', canonical: false, reasons: ['version>' + SCHEMA_VERSION], wrapperVersion: v };
      }
      if (v >= 13) {
        if (!isValidRevision(input.revision)) {
          return { classification: 'CORRUPT_STALE_COLLIDING', canonical: false, reasons: ['revision-invalid'], wrapperVersion: v };
        }
      }
      parsed = { version: v, revision: isValidRevision(input.revision) ? input.revision : 0, committedAt: input.committedAt || null, data: input.data || null, corrupt: false };
    } else {
      return { classification: 'CORRUPT_STALE_COLLIDING', canonical: false, reasons: ['wrapper-shape-invalid'] };
    }
    if (parsed.version > SCHEMA_VERSION) {
      return { classification: 'UNSUPPORTED_FUTURE_SCHEMA', canonical: false, reasons: ['version>' + SCHEMA_VERSION], wrapperVersion: parsed.version };
    }
    // PRV-0.5 R6 (Codex Round-5 P1-5): source-required invariants for
    // a legacy candidate MUST hold BEFORE migrateUp fills defaults.
    // A v12+ candidate missing `money.salary_net` at the source stage
    // is REJECTED — recovery selection can move on to the next
    // independently valid generation.
    if (parsed.version < SCHEMA_VERSION) {
      const src = validateLegacySourceRequiredFields(parsed.data, parsed.version);
      if (!src.ok) {
        return {
          classification: 'MALFORMED_CURRENT_SCHEMA', canonical: false,
          reasons: ['legacy-source-' + src.reason],
          wrapperVersion: parsed.version
        };
      }
    }
    // Migrate the inner data up if the wrapper is a legacy source.
    let migrated;
    try {
      migrated = (parsed.version === SCHEMA_VERSION && parsed.data)
        ? parsed.data
        : migrateUp(parsed.data || {}, parsed.version || 0);
      normalizeLogbookDomain(migrated);
    } catch (e) {
      return { classification: 'MALFORMED_CURRENT_SCHEMA', canonical: false, reasons: ['migrateUp-threw'], wrapperVersion: parsed.version };
    }
    if (!validate(migrated)) {
      return { classification: 'MALFORMED_CURRENT_SCHEMA', canonical: false, reasons: ['validate-failed'], wrapperVersion: parsed.version, data: migrated };
    }
    const inner = evaluateCandidateData(migrated);
    inner.wrapperVersion = parsed.version;
    inner.wrapperRevision = parsed.revision;
    inner.data = migrated;
    return inner;
  }
  // Evaluate the CURRENTLY PERSISTED authority (raw wrapper bytes on
  // disk, considered against the Store's live baseWrapperRaw,
  // knownRevision, and durabilityBlocker). Consumers: hydration
  // fast-path, backup/export gate, boot-recovery classification.
  //
  // `raw` (optional):
  //   - undefined  → read localStorage[STATE_KEY] internally.
  //   - null       → treat as ABSENT.
  //   - string     → treat as the raw persisted bytes.
  //
  // Returned booleans (consumer decisions):
  //   acceptFastPathMigrated → true iff AUTHORITATIVE_MIGRATED, no active
  //     durability blocker, raw bytes match Store's accepted baseline (no
  //     equal-revision divergent-bytes attack).
  //   authoritative         → true for AUTHORITATIVE_MIGRATED and
  //     VERIFIED_LEGACY_TRANSITION.
  //   seedLegacy            → true ONLY for VERIFIED_LEGACY_TRANSITION.
  //   acceptForBackup       → true iff authoritative AND no active
  //     durability blocker AND (for AUTHORITATIVE_MIGRATED) the raw
  //     matches the Store baseline. Malformed/corrupt/future/stale
  //     wrappers refuse normal backup and require quarantine.
  //   recoveryRequired      → true for MALFORMED, CORRUPT_STALE_COLLIDING,
  //     UNSUPPORTED_FUTURE_SCHEMA (with data on disk).
  function evaluatePersistedAuthority(raw) {
    // Read raw from disk when caller passes undefined; a null caller
    // request stays ABSENT.
    let rawEffective;
    if (raw === undefined) {
      try { rawEffective = localStorage.getItem(STATE_KEY); }
      catch (e) { rawEffective = null; }
    } else {
      rawEffective = raw;
    }
    const blocker = durabilityBlocker ? Object.assign({}, durabilityBlocker) : null;
    const reasons = [];
    if (rawEffective === null || rawEffective === undefined) {
      return {
        classification: 'ABSENT', canonical: false,
        acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
        acceptForBackup: false, recoveryRequired: false, blocker,
        rawIdentityMatchesStore: baseWrapperRaw === null,
        wrapper: null, data: null, marker: null, reasons: ['absent']
      };
    }
    // Parse wrapper via Store's own rules — single source of truth.
    const parsed = parseWrapperRaw(rawEffective);
    if (!parsed) {
      return {
        classification: 'CORRUPT_STALE_COLLIDING', canonical: false,
        acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
        acceptForBackup: false, recoveryRequired: true, blocker,
        rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
        wrapper: null, data: null, marker: null, reasons: ['null-parse']
      };
    }
    if (parsed.corrupt) {
      // PRV-0.5 R6 (Codex Round-5 P2-1): preserve outer wrapper context
      // even when parseWrapperRaw declines to migrate. A future-version
      // raw wrapper must classify as UNSUPPORTED_FUTURE_SCHEMA on the
      // live-disk path — same as evaluateCandidateWrapper on the same
      // bytes — instead of collapsing to generic CORRUPT_STALE_COLLIDING.
      if (parsed.reason === 'wrapper-version-unsupported') {
        return {
          classification: 'UNSUPPORTED_FUTURE_SCHEMA', canonical: false,
          acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
          acceptForBackup: false, recoveryRequired: true, blocker,
          rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
          wrapper: { version: parsed.version, revision: null, committedAt: null },
          data: null, marker: null,
          reasons: ['wrapper-version-unsupported', 'version=' + parsed.version]
        };
      }
      // PRV-0.5 Final Closure (INV-J, R7-P1-09): a persisted primary
      // wrapper missing its `version` key classifies distinctly as
      // WRAPPER_VERSION_ABSENT so consumers (backup refusal,
      // hydration, recovery UX) can distinguish it from generic JSON
      // corruption. No legacy transition auth is issued (parseWrapperRaw
      // now returns corrupt, so initialLoad's legacyTransitionCapability
      // check fails closed automatically).
      if (parsed.reason === 'wrapper-version-absent') {
        return {
          classification: 'WRAPPER_VERSION_ABSENT', canonical: false,
          acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
          acceptForBackup: false, recoveryRequired: true, blocker,
          rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
          wrapper: null, data: null, marker: null,
          reasons: ['wrapper-version-absent']
        };
      }
      return {
        classification: 'CORRUPT_STALE_COLLIDING', canonical: false,
        acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
        acceptForBackup: false, recoveryRequired: true, blocker,
        rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
        wrapper: null, data: null, marker: null,
        reasons: ['wrapper-corrupt', 'reason=' + (parsed.reason || 'unknown')]
      };
    }
    if (parsed.version > SCHEMA_VERSION) {
      return {
        classification: 'UNSUPPORTED_FUTURE_SCHEMA', canonical: false,
        acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
        acceptForBackup: false, recoveryRequired: true, blocker,
        rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
        wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
        data: null, marker: null, reasons: ['version>' + SCHEMA_VERSION]
      };
    }
    if (!isValidRevision(parsed.revision)) {
      return {
        classification: 'CORRUPT_STALE_COLLIDING', canonical: false,
        acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
        acceptForBackup: false, recoveryRequired: true, blocker,
        rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
        wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
        data: null, marker: null, reasons: ['revision-invalid']
      };
    }
    // Stale relative to Store's accepted disk revision.
    if (typeof knownRevision === 'number' && parsed.revision < knownRevision) {
      return {
        classification: 'CORRUPT_STALE_COLLIDING', canonical: false,
        acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
        acceptForBackup: false, recoveryRequired: true, blocker,
        rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
        wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
        data: null, marker: null, reasons: ['revision-stale', 'known=' + knownRevision]
      };
    }
    // At this point outer wrapper metadata is well-formed. Now evaluate
    // inner authority (marker + records) via evaluateCandidateData.
    // For version < SCHEMA_VERSION we treat this as a legacy source
    // wrapper — always VERIFIED_LEGACY_TRANSITION (post-migrateUp the
    // marker will read as 'unmigrated' with valid provenance).
    if (parsed.version < SCHEMA_VERSION) {
      if (!isSupportedLegacySourceVersion(parsed.version)) {
        // Non-integer or out-of-range legacy version — malformed.
        return {
          classification: 'MALFORMED_CURRENT_SCHEMA', canonical: false,
          acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
          acceptForBackup: false, recoveryRequired: true, blocker,
          rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
          wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
          data: null, marker: null, reasons: ['legacy-version-invalid']
        };
      }
      return {
        classification: 'VERIFIED_LEGACY_TRANSITION', canonical: true,
        acceptFastPathMigrated: false,
        authoritative: true,
        seedLegacy: !blocker,
        acceptForBackup: !blocker && rawEffective === baseWrapperRaw,
        recoveryRequired: false, blocker,
        rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
        wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
        data: parsed.data, marker: null,
        reasons: ['legacy-source-v' + parsed.version]
      };
    }
    // parsed.version === SCHEMA_VERSION — canonical marker + records
    // required.
    const inner = evaluateCandidateData(parsed.data);
    if (inner.classification === 'AUTHORITATIVE_MIGRATED') {
      const rawIdentityMatchesStore = rawEffective === baseWrapperRaw;
      const higherRevisionMismatch =
        baseWrapperRaw !== null &&
        parsed.revision > knownRevision &&
        !rawIdentityMatchesStore;
      const equalRevisionDivergentBytes =
        baseWrapperRaw !== null &&
        parsed.revision === knownRevision &&
        !rawIdentityMatchesStore;
      const acceptFastPathMigrated = !blocker && rawIdentityMatchesStore;
      const reasonsOut = inner.reasons.slice();
      if (blocker) reasonsOut.push('durability-blocker:' + blocker.code);
      if (higherRevisionMismatch) reasonsOut.push('higher-revision-raw-mismatch');
      if (equalRevisionDivergentBytes) reasonsOut.push('equal-revision-divergent-bytes');
      if (!rawIdentityMatchesStore) reasonsOut.push('raw-identity-mismatch');
      // PRV-0.5 R6 (Codex Round-5 P1-3, P1-4): equal-revision divergent
      // bytes, higher-revision raw mismatch, OR an active durability
      // blocker demote AUTHORITATIVE_MIGRATED into CORRUPT_STALE_COLLIDING
      // for consumers. Higher-revision mismatch is called out separately
      // because the Store storage-event handler owns the safe
      // adopt/rebase decision — hydration/backup/fast-path must NOT
      // silently seed or accept on the mismatched newer bytes.
      if (equalRevisionDivergentBytes || higherRevisionMismatch || blocker) {
        return {
          classification: 'CORRUPT_STALE_COLLIDING', canonical: false,
          acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
          acceptForBackup: false, recoveryRequired: true, blocker,
          rawIdentityMatchesStore,
          wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
          data: parsed.data, marker: inner.marker, reasons: reasonsOut
        };
      }
      return {
        classification: 'AUTHORITATIVE_MIGRATED', canonical: true,
        allEmpty: inner.allEmpty === true,
        acceptFastPathMigrated,
        authoritative: true, seedLegacy: false,
        acceptForBackup: acceptFastPathMigrated,
        recoveryRequired: false, blocker,
        rawIdentityMatchesStore,
        wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
        data: parsed.data, marker: inner.marker, reasons: reasonsOut
      };
    }
    if (inner.classification === 'VERIFIED_LEGACY_TRANSITION') {
      // PRV-0.5 R6 (Codex Round-5 P1-1): a schema-14 wrapper's inner
      // marker cannot self-attest legacy provenance. Legacy transition
      // authority is a transaction-scoped Store capability that this
      // boot only holds when it observed a supported outer legacy raw
      // wrapper (parsed.version < SCHEMA_VERSION). If the capability is
      // NOT set here, the wrapper's claim of `unmigrated` provenance is
      // forgeable — downgrade to MALFORMED_CURRENT_SCHEMA so consumers
      // refuse to seed. The forgery reproduction Codex ran on schema-14
      // + fabricated marker cold-boots into this downgrade branch.
      const rawIdentityMatchesStore = rawEffective === baseWrapperRaw;
      // PRV-0.5 R7: source-bound legacy transition auth is required.
      // The auth's sourceRawBytes must exactly match the current disk
      // raw — a schema-14 wrapper whose marker claims prior transition
      // but whose bytes do NOT match a Store-issued auth is forgery.
      if (!(_transitionAuth && _transitionAuth.kind === 'legacy'
            && _transitionAuth.sourceRawBytes === rawEffective)) {
        return {
          classification: 'MALFORMED_CURRENT_SCHEMA', canonical: false,
          acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
          acceptForBackup: false, recoveryRequired: true, blocker,
          rawIdentityMatchesStore,
          wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
          data: parsed.data, marker: inner.marker,
          reasons: inner.reasons.concat(['current-schema-cannot-self-attest-legacy-provenance'])
        };
      }
      return {
        classification: 'VERIFIED_LEGACY_TRANSITION', canonical: true,
        acceptFastPathMigrated: false,
        authoritative: true,
        seedLegacy: !blocker,
        acceptForBackup: !blocker && rawIdentityMatchesStore,
        recoveryRequired: false, blocker,
        rawIdentityMatchesStore,
        wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
        data: parsed.data, marker: inner.marker, reasons: inner.reasons
      };
    }
    // inner === MALFORMED_CURRENT_SCHEMA
    return {
      classification: 'MALFORMED_CURRENT_SCHEMA', canonical: false,
      acceptFastPathMigrated: false, authoritative: false, seedLegacy: false,
      acceptForBackup: false, recoveryRequired: true, blocker,
      rawIdentityMatchesStore: rawEffective === baseWrapperRaw,
      wrapper: { version: parsed.version, revision: parsed.revision, committedAt: parsed.committedAt },
      data: parsed.data, marker: inner.marker || null, reasons: inner.reasons
    };
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
    try { parsed = JSON.parse(raw); } catch (e) { return { corrupt: true, reason: 'json-parse-failed' }; }
    if (!parsed || typeof parsed !== 'object') return { corrupt: true, reason: 'wrapper-shape-invalid' };
    // PRV-0.5 R7 (Codex Round-6 P1-7): strict version semantics.
    // If `version` is present, it MUST be an integer in [0, SCHEMA_VERSION].
    // Any other type (string, boolean, null, object, non-integer number)
    // is a hard corruption signal — NOT a fallback to v0. This closes
    // the R6 defect where `version:"99"` silently became legacy v0,
    // migrated, and gained transition capability.
    //
    // PRV-0.5 Final Closure (INV-J, R7-P1-09): the `version` key must
    // be PRESENT on every persisted primary wrapper. Repository history
    // always emitted an explicit outer version (v6+); an absent version
    // is version-provenance corruption — never a silent fallback to
    // v0 that would gain legacy transition capability. Explicit
    // legacy-only import formats travel through a distinct
    // processImport path (evaluateCandidateWrapper), never through
    // parseWrapperRaw as a persisted primary wrapper.
    if (!('version' in parsed)) {
      return { corrupt: true, reason: 'wrapper-version-absent' };
    }
    const rawVersion = parsed.version;
    if (typeof rawVersion !== 'number' || !Number.isFinite(rawVersion) || !Number.isInteger(rawVersion)) {
      return { corrupt: true, reason: 'wrapper-version-malformed', versionType: typeof rawVersion };
    }
    if (rawVersion > SCHEMA_VERSION) {
      return { corrupt: true, reason: 'wrapper-version-unsupported', version: rawVersion };
    }
    if (rawVersion < 0) {
      return { corrupt: true, reason: 'wrapper-version-invalid', version: rawVersion };
    }
    const version = rawVersion;
    // Schema-13 wrappers MUST carry an integer revision in range.
    // Any other numeric shape (1.5, NaN, Infinity, negative, string) is a
    // hard corruption signal, not a fall-back-to-zero.
    let revision = 0;
    if (version >= 13) {
      if (!isValidRevision(parsed.revision)) return { corrupt: true, reason: 'revision-invalid' };
      revision = parsed.revision;
    } else if ('revision' in parsed) {
      // Older versions never wrote revision; if present but invalid, corrupt.
      if (parsed.revision !== undefined && parsed.revision !== null && !isValidRevision(parsed.revision)) {
        return { corrupt: true, reason: 'revision-invalid-legacy' };
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
    // PRV-0.5 Final Closure (INV-I, R7-P1-08): DESTRUCTIVE historical
    // source validation is enforced through evaluateCandidateWrapper
    // (import path). The boot path (migrateAndValidate) intentionally
    // keeps the softer floor so a stale-shape v11 wrapper still
    // loads and can be healed by app.js hydration — rejecting it here
    // would strand the user with recovery-required on a wrapper the
    // repository's own migrateUp pipeline supports. See ADR-015
    // addendum #7.
    try {
      const cloned = clonePersistable(data);
      return { ok: true, data: cloned };
    } catch (e) {
      return { ok: false };
    }
  }
  function initialLoad() {
    // PRV-0.5 Final Closure (INV-C, R7-P1-03): a boot-time getItem
    // throw is NOT the same as "no state exists". The app still
    // needs an in-memory shape to render, but writes must refuse
    // until the user acknowledges recovery — otherwise a transiently
    // unreadable localStorage would let boot's own scheduleFlush
    // overwrite whatever bytes are actually on disk.
    let raw = null;
    let bootReadFailed = false;
    try { raw = localStorage.getItem(STATE_KEY); }
    catch (e) { bootReadFailed = true; raw = null; }
    if (bootReadFailed) {
      return {
        data: clonePersistable(migrateFromLegacy()),
        revision: 0, committedAt: null, rawWrapper: null,
        pendingBlocker: { code: 'STORE_READ_FAILED', detail: { where: 'initialLoad' } }
      };
    }
    if (raw !== null) {
      const parsed = parseWrapperRaw(raw);
      const m = migrateAndValidate(parsed);
      if (m.ok) {
        // PRV-0.5 R6 (Codex Round-5 P1-1): if the raw wrapper this boot
        // observed was a supported outer legacy version, grant the
        // Store the transient legacy-transition capability so app.js
        // hydration on THIS boot may authorise a legacy seed. A
        // schema-14 raw wrapper NEVER grants this capability — a
        // current-schema wrapper cannot self-attest a prior transition.
        //
        // PRV-0.5 Pre-Push Amendment §2 (atomic legacy conversion):
        // a legacy raw ALSO sets a STORE_LEGACY_CONVERSION_PENDING
        // durability blocker so ordinary Store.set/update refuse
        // until the atomic legacy-conversion commit completes.
        // There is no "durable current-schema unmigrated + ordinary
        // writes enabled" intermediate operating state.
        const legacyTransitionCapability =
          parsed && !parsed.corrupt && typeof parsed.version === 'number'
          && parsed.version < SCHEMA_VERSION;
        const result = {
          data: m.data, revision: parsed.revision, committedAt: parsed.committedAt,
          rawWrapper: raw,
          legacyTransitionCapability: legacyTransitionCapability
        };
        if (legacyTransitionCapability) {
          result.pendingBlocker = {
            code: 'STORE_LEGACY_CONVERSION_PENDING',
            detail: { sourceVersion: parsed.version, sourceRevision: parsed.revision }
          };
        }
        return result;
      }
      // PRV-0.5 R5 (Codex Round-4 P1-4): a raw persisted wrapper exists
      // but Store's own parse/migrate/validate rejects it. That is a
      // durability invariant break — NOT an invitation to silently
      // reconstruct from legacy defaults. Preserve the raw bytes as
      // evidence (baseWrapperRaw = raw) and stage a pending durability
      // blocker so subsequent writes cannot overwrite the corrupt
      // wrapper. Recovery MUST go through an approved full-state
      // transaction (snapshot restore / import / reset).
      //
      // Snapshot fallback still runs when a valid snapshot exists so a
      // recoverable rolling snapshot lets the user keep going — but the
      // durability blocker still fires (the disk itself is corrupt and
      // ordinary writes must not blindly overwrite it before the user
      // acknowledges recovery). The blocker is cleared automatically by
      // any accepted full-state transaction (commitFullStateWrapper).
      const pendingReason = (parsed && parsed.reason) ||
        (parsed && parsed.corrupt ? 'wrapper-corrupt' : 'validate-failed');
      let snap = null;
      try { snap = restoreFromSnapshot(); } catch (e) { snap = null; }
      if (snap && validate(snap)) {
        try {
          return {
            data: clonePersistable(snap), revision: 0, committedAt: null,
            rawWrapper: raw,
            pendingBlocker: { code: 'STORE_CORRUPT_AUTHORITATIVE_STATE', detail: { reason: pendingReason, recoveredFromSnapshot: true } }
          };
        } catch (e) { /* snap clone failed — fall through */ }
      }
      // No valid snapshot either — surface recovery-required. Return
      // the legacy-derived baseline in memory (so the app can render),
      // but preserve the corrupt raw as baseWrapperRaw evidence, and
      // stage the durability blocker so writes / backup / export refuse
      // until an approved recovery lands. This is the exact scenario
      // Codex reproduced (corrupt revision + no snapshot); the user's
      // previously durable data is not silently invented as [], and
      // backup will refuse to export the corrupt bytes as if valid.
      return {
        data: clonePersistable(migrateFromLegacy()), revision: 0, committedAt: null,
        rawWrapper: raw,
        pendingBlocker: { code: 'STORE_CORRUPT_AUTHORITATIVE_STATE', detail: { reason: pendingReason, recoveredFromSnapshot: false } }
      };
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
  // PRV-0.5 R5 (Codex Round-4 P1-4): honour any pending durability
  // blocker that boot detected. `nowISO()` is not required in the record
  // returned by initialLoad — set it here so the blocker follows the
  // same shape as setDurabilityBlocker's records.
  if (_boot.pendingBlocker) {
    durabilityBlocker = {
      code: _boot.pendingBlocker.code,
      since: nowISO(),
      detail: _boot.pendingBlocker.detail || null
    };
  }
  // PRV-0.5 R7 (Codex Round-6 P1-1, P1-2, INV-1, INV-2, INV-3, INV-12):
  // authority contexts are SOURCE-GENERATION BOUND. A single narrow
  // `_transitionAuth` object carries:
  //   - kind: 'legacy' (issued by initialLoad when raw was a supported
  //           outer legacy wrapper) OR 'recovery' (issued by a
  //           recovery entry point when the current authority is
  //           corrupt).
  //   - sourceRawBytes: the EXACT raw bytes of the source generation
  //     the auth is authorised to replace. Under the destructive
  //     coordinator lock, the current disk raw is re-read and MUST
  //     byte-match this string — anything else (attacker substituted
  //     a different wrapper, another tab successfully recovered, a
  //     rogue write landed) causes fail-closed refusal with no
  //     mutation.
  //   - sourceVersion / sourceRevision: metadata for diagnostics.
  //   - issuedAt.
  // Auth is single-use: cleared on any accepted commit (recovery or
  // ordinary). Never persisted to disk; lives only in this Store
  // instance's memory.
  let _transitionAuth = null;
  // PRV-0.5 Pre-Push Amendment (BINDING-1): test-only flag that
  // simulates a no-lock environment for destructive-commit fail-closed
  // proofs. Production callers never touch this; the default false
  // preserves normal cross-tab lock behavior.
  let _testForceNoLockFlag = false;
  function _computeSourceIdentity(raw, parsed) {
    return {
      raw: raw,
      version: parsed && !parsed.corrupt && typeof parsed.version === 'number' ? parsed.version : null,
      revision: parsed && !parsed.corrupt && typeof parsed.revision === 'number' ? parsed.revision : null,
      corruptReason: parsed && parsed.corrupt ? (parsed.reason || 'unknown') : null
    };
  }
  function _issueLegacyTransitionAuth(rawBytes, parsed) {
    _transitionAuth = {
      kind: 'legacy',
      sourceRawBytes: rawBytes,
      sourceVersion: parsed && !parsed.corrupt && typeof parsed.version === 'number' ? parsed.version : null,
      sourceRevision: parsed && !parsed.corrupt && typeof parsed.revision === 'number' ? parsed.revision : null,
      issuedAt: nowISO()
    };
  }
  function _issueRecoveryAuthFromCurrentDisk() {
    // PRV-0.5 Final Closure (INV-E, R7-P1-02): recovery is legitimate
    // for EVERY blocker class that denotes invalid/untrusted
    // authority — corrupt JSON, malformed wrapper, revision
    // regression, unsupported future schema, absent primary,
    // versionless primary. The auth binds to:
    //   - the exact raw bytes currently on disk (or absence identity),
    //   - the blocker class the auth was issued under,
    //   - the knownRevision at issue (regression recovery must
    //     enforce monotonic advance past it).
    // A stale auth (disk changed after issue, blocker cleared /
    // changed class) fails the pre-commit source-identity + blocker
    // recheck under the destructive lock.
    if (!durabilityBlocker) return { ok: false, error: 'RECOVERY_AUTH_NO_BLOCKER' };
    let rawNow;
    try { rawNow = localStorage.getItem(STATE_KEY); } catch (e) { return { ok: false, error: 'RECOVERY_AUTH_READ_FAILED' }; }
    if (rawNow === null) {
      // Recovery from an absent primary is permitted as a special case
      // (e.g. STATE_KEY externally cleared with prior authority).
      _transitionAuth = {
        kind: 'recovery', sourceRawBytes: null, sourceVersion: null, sourceRevision: null,
        blockerClassAtIssue: durabilityBlocker.code,
        knownRevisionAtIssue: knownRevision,
        issuedAt: nowISO(), absent: true
      };
      return { ok: true };
    }
    const parsed = parseWrapperRaw(rawNow);
    _transitionAuth = {
      kind: 'recovery',
      sourceRawBytes: rawNow,
      sourceVersion: parsed && !parsed.corrupt && typeof parsed.version === 'number' ? parsed.version : null,
      sourceRevision: parsed && !parsed.corrupt && typeof parsed.revision === 'number' ? parsed.revision : null,
      corruptReason: parsed && parsed.corrupt ? (parsed.reason || 'unknown') : null,
      blockerClassAtIssue: durabilityBlocker.code,
      knownRevisionAtIssue: knownRevision,
      issuedAt: nowISO()
    };
    return { ok: true };
  }
  function _hasValidTransitionAuthForCurrentDisk(expectedKind) {
    if (!_transitionAuth || _transitionAuth.kind !== expectedKind) return { ok: false, reason: 'no-auth-or-wrong-kind' };
    let rawNow;
    try { rawNow = localStorage.getItem(STATE_KEY); } catch (e) { return { ok: false, reason: 'disk-read-failed' }; }
    // Absent-recovery auth: current disk must still be absent.
    if (_transitionAuth.absent === true) {
      if (rawNow !== null) return { ok: false, reason: 'disk-no-longer-absent' };
      return { ok: true };
    }
    if (rawNow !== _transitionAuth.sourceRawBytes) {
      return { ok: false, reason: 'source-generation-changed' };
    }
    return { ok: true };
  }
  function _consumeTransitionAuth() { _transitionAuth = null; }
  // Boot: if initialLoad observed a supported outer legacy source,
  // issue the source-bound legacy-transition auth.
  if (_boot.legacyTransitionCapability === true && typeof _boot.rawWrapper === 'string') {
    _issueLegacyTransitionAuth(_boot.rawWrapper, parseWrapperRaw(_boot.rawWrapper));
  }
  // Legacy R6-compat public read; now backed by the source-bound auth.
  function canAuthoriseLegacySeedForCurrentDisk() {
    const check = _hasValidTransitionAuthForCurrentDisk('legacy');
    return check.ok === true;
  }
  // Held so callers of `Store.reset()` (which still returns a boolean
  // for backward compat) can await the actual asynchronous commit via
  // `Store._lastResetSettled`. Overwritten by every reset invocation.
  let _lastResetSettled = null;

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
    //
    // PRV-0.5 Final Closure (INV-C, R7-P1-03): a primary-read exception
    // is NEVER equivalent to "no state exists". Fail closed with a
    // STORE_READ_FAILED blocker — never overwrite an unreadable
    // primary based on the assumption it is absent.
    let rawNow;
    try { rawNow = localStorage.getItem(STATE_KEY); }
    catch (e) {
      setDurabilityBlocker('STORE_READ_FAILED', { where: 'commitLocked', message: e && e.message });
      return { committed: false, reason: 'STORE_READ_FAILED' };
    }
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
        // PRV-0.5 Final Closure (INV-A, R7-P1-01): adoption of external
        // bytes invalidates any transition auth bound to the previous
        // source generation. A hydration attempt whose auth was
        // issued for W1 must not silently succeed against W2 just
        // because Store adopted W2.
        if (_transitionAuth && _transitionAuth.sourceRawBytes !== rawNow) {
          _consumeTransitionAuth();
        }
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
        // Same INV-A auth invalidation applies here.
        if (_transitionAuth && _transitionAuth.sourceRawBytes !== rawNow) {
          _consumeTransitionAuth();
        }
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
    // PRV-0.5 Final Closure (INV-B, R7-P1-06): ORDINARY CAS commits
    // require the same durable-reread + byte-match proof that
    // full-state commits use. Silent no-op writes, writes that
    // land altered bytes, and writes that go elsewhere are all
    // caught here — BEFORE memory / snapshot / pending / auth
    // state advance. On mismatch we set a persistent
    // STORE_ORDINARY_DURABLE_VERIFY_FAILED blocker (subsequent
    // ordinary writes refuse), keep pending ops intact, and do not
    // touch baseState / knownRevision / baseWrapperRaw / snapshot /
    // listeners / _transitionAuth. Recovery requires an approved
    // full-state transaction the same way the corrupt-authority
    // path does.
    let durableRawCas;
    try { durableRawCas = localStorage.getItem(STATE_KEY); }
    catch (e) {
      setDurabilityBlocker('STORE_ORDINARY_DURABLE_READ_FAILED');
      return { committed: false, reason: 'STORE_ORDINARY_DURABLE_READ_FAILED' };
    }
    if (durableRawCas !== payload) {
      setDurabilityBlocker('STORE_ORDINARY_DURABLE_VERIFY_FAILED', {
        disk: durableRawCas === null ? 'absent' : 'divergent-bytes',
        knownRevision, attemptedRevision: nextRevision
      });
      return { committed: false, reason: 'STORE_ORDINARY_DURABLE_VERIFY_FAILED' };
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
    // PRV-0.5 Pre-Push Amendment §2 (no rebind architecture): ordinary
    // CAS writes never mutate _transitionAuth. Legacy conversion is
    // handled atomically via commitFullStateWrapper's legacyConversion
    // mode, which consumes the auth in ONE write. If a rogue ordinary
    // commit ever landed with the marker still 'unmigrated' (which
    // is prevented now because STORE_LEGACY_CONVERSION_PENDING is
    // set on any legacy raw at boot and blocks ordinary Store.set /
    // update / commitLocked), it would not resurrect any auth here.
    try {
      const newMarker = baseState && baseState.meta && baseState.meta.recordsMigration;
      if (newMarker && newMarker.status === MARKER_STATUS_MIGRATED) {
        if (_transitionAuth && _transitionAuth.kind === 'legacy') _consumeTransitionAuth();
      }
    } catch (e) { /* ignore */ }

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

  // ── QUARANTINE-KEY ALLOCATION ────────────────────
  // PRV-0.5 Final Closure (INV-H, R7-P2-01): quarantine key format is
  // `dune_state_v4_quarantine_<epoch-ms>_<random-suffix>`. Allocation
  // requires the candidate key to be currently absent in localStorage
  // — never overwrite existing recovery evidence. Retries up to 8
  // attempts with a fresh suffix; if none is unique, fail closed
  // BEFORE any primary mutation begins.
  const _QUARANTINE_KEY_PREFIX = 'dune_state_v4_quarantine_';
  function _quarantineRandomSuffix() {
    try {
      if (typeof crypto !== 'undefined' && crypto && typeof crypto.getRandomValues === 'function') {
        const a = new Uint32Array(2);
        crypto.getRandomValues(a);
        return a[0].toString(36) + a[1].toString(36);
      }
    } catch (e) { /* fall through */ }
    return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
  }
  function _allocateQuarantineKey() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const key = _QUARANTINE_KEY_PREFIX + Date.now() + '_' + _quarantineRandomSuffix();
      let existing;
      try { existing = localStorage.getItem(key); } catch (e) {
        return { ok: false, reason: 'read-failed' };
      }
      if (existing === null) return { ok: true, key: key };
    }
    return { ok: false, reason: 'collision-cap-exceeded' };
  }
  function _listQuarantineKeys() {
    const out = [];
    let n;
    try { n = localStorage.length; } catch (e) { return out; }
    for (let i = 0; i < n; i++) {
      let k;
      try { k = localStorage.key(i); } catch (e) { continue; }
      if (typeof k === 'string' && k.indexOf(_QUARANTINE_KEY_PREFIX) === 0) out.push(k);
    }
    return out;
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
    let endReadFailed = false;
    try { rawNow = localStorage.getItem(STATE_KEY); }
    catch (e) { endReadFailed = true; rawNow = null; }
    if (endReadFailed) {
      // PRV-0.5 Final Closure (INV-C): read failure ≠ absence.
      setDurabilityBlocker('STORE_READ_FAILED', { where: 'endFullStateTransaction' });
    } else if (rawNow === null) {
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
          // PRV-0.5 Final Closure (INV-A, R7-P1-01): auth invalidation
          // on external adoption of different bytes.
          if (_transitionAuth && _transitionAuth.sourceRawBytes !== rawNow) {
            _consumeTransitionAuth();
          }
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
  //
  // PRV-0.5 R6 (Codex Round-5 P1-2 + P1-3):
  //   - `opts.recovery === true` puts this commit in recovery mode: a
  //     corrupt authoritative disk read no longer refuses; the corrupt
  //     raw bytes are quarantined into a distinct localStorage key
  //     `dune_state_v4_quarantine_<epoch-ms>` as evidence, and the
  //     commit proceeds using `max(knownRevision, 0) + 1` for
  //     monotonicity (never trusting the corrupt revision). This is the
  //     ONLY path that can replace corrupt authority; ordinary
  //     Store.set/update flushes and ordinary (non-recovery) full-state
  //     commits still refuse.
  //   - The lowest destructive boundary now enforces the canonical
  //     authority contract via `evaluateCandidateData(cloned)` under the
  //     coordinator. Any candidate that lacks canonical marker / records
  //     is rejected BEFORE the write and the blocker is NOT cleared.
  //   - Post-write verification re-parses the committed payload via the
  //     evaluator; if the persisted result does not evaluate as
  //     AUTHORITATIVE_MIGRATED the commit reports failure and leaves
  //     the previous blocker intact.
  function commitFullStateWrapper(token, candidateData, reason, opts) {
    if (!activeFullStateTransaction) return Promise.resolve({ ok: false, error: 'FULL_STATE_TRANSACTION_NOT_ACTIVE' });
    if (!fullStateTxToken || token !== fullStateTxToken) return Promise.resolve({ ok: false, error: 'FULL_STATE_TX_TOKEN_MISMATCH' });
    const recoveryMode = !!(opts && opts.recovery === true);
    const legacyConversionMode = !!(opts && opts.legacyConversion === true);
    // PRV-0.5 Pre-Push Amendment (BINDING-1): NO LOCK = FAIL CLOSED.
    // Both destructive-mode commits (recovery + legacy conversion)
    // require the cross-tab Web Lock. If navigator.locks is
    // unavailable in this environment, refuse — do NOT fall back to
    // the best-effort same-tab-only serializer for a destructive
    // primary write.
    if (recoveryMode || legacyConversionMode) {
      // PRV-0.5 Pre-Push Amendment (BINDING-1): re-evaluate lock
      // availability at commit time (not just module init). A test
      // or environment that removes navigator.locks after Store
      // construction must also refuse — this is a real fail-closed
      // path, not a static capability tag. `_testForceNoLock`
      // exists because Chromium's `navigator.locks` is a
      // non-configurable native property and cannot be `delete`d;
      // the test hook lets adversarial suites simulate a no-lock
      // environment.
      const dynamicLockAvailable = !_testForceNoLockFlag && !!(typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function');
      if (!dynamicLockAvailable) {
        return Promise.resolve({ ok: false, error: 'STORE_LOCK_UNAVAILABLE',
          reason: 'no-web-locks-support', mode: recoveryMode ? 'recovery' : 'legacy-conversion' });
      }
    }
    // PRV-0.5 R7 (Codex Round-6 P1-2, INV-2, INV-3, INV-12): if the
    // caller declares recovery mode, an active recovery auth MUST
    // exist AND its sourceRawBytes MUST byte-match the disk raw the
    // Store observes under the destructive lock. A stale recovery
    // prepared for a corrupt generation the disk no longer holds
    // (another tab already recovered, or the raw was replaced) fails
    // closed — the newer healthy state is not overwritten.
    return withCoordinator(function () {
      // PRV-0.5 Final Closure (INV-C, R7-P1-03): primary-read exception
      // is NEVER absence. Fail closed rather than proceed to
      // quarantine/write as if disk were empty.
      let rawNow;
      let rawReadFailed = false;
      try { rawNow = localStorage.getItem(STATE_KEY); }
      catch (e) { rawReadFailed = true; rawNow = null; }
      if (rawReadFailed) {
        setDurabilityBlocker('STORE_READ_FAILED', { where: 'commitFullStateWrapper' });
        return { ok: false, error: 'STORE_READ_FAILED' };
      }
      // R7 P1-2: recovery-mode source authorisation check happens
      // BEFORE any quarantine / write. Non-recovery commits enforce
      // "disk parseable" (unchanged from R6).
      //
      // PRV-0.5 Final Closure (INV-E, R7-P1-02): recovery mode also
      // enforces blocker-class match under the destructive lock. An
      // auth issued for STORE_REVISION_REGRESSION does not authorise
      // recovery under a later STORE_CORRUPT_AUTHORITATIVE_STATE
      // blocker (or vice versa) — the class labels the source
      // condition the auth's user consented to replace.
      if (recoveryMode) {
        const authCheck = _hasValidTransitionAuthForCurrentDisk('recovery');
        if (!authCheck.ok) {
          return { ok: false, error: 'RECOVERY_AUTH_INVALID', reason: authCheck.reason, disk: rawNow === null ? 'absent' : 'present' };
        }
        if (_transitionAuth
            && _transitionAuth.blockerClassAtIssue
            && (!durabilityBlocker || durabilityBlocker.code !== _transitionAuth.blockerClassAtIssue)) {
          return { ok: false, error: 'RECOVERY_AUTH_BLOCKER_CHANGED',
                   authBlocker: _transitionAuth.blockerClassAtIssue,
                   currentBlocker: durabilityBlocker && durabilityBlocker.code };
        }
      } else if (legacyConversionMode) {
        // PRV-0.5 Pre-Push Amendment §2 + §8 (atomic legacy conversion):
        // legacy conversion requires a valid legacy transition auth
        // that byte-matches the current disk raw (identity check
        // under the exclusive lock). The auth is issued by
        // initialLoad from the exact legacy raw wrapper the Store
        // observed at boot; disk substitution between boot and
        // conversion invalidates it.
        const authCheck = _hasValidTransitionAuthForCurrentDisk('legacy');
        if (!authCheck.ok) {
          return { ok: false, error: 'LEGACY_CONVERSION_AUTH_INVALID',
                   reason: authCheck.reason,
                   disk: rawNow === null ? 'absent' : 'present' };
        }
        // Additionally re-validate the historical source against the
        // frozen matrix under lock — a v13 raw that failed validation
        // between boot and conversion (impossible via legitimate
        // paths, but the check is cheap) fails closed.
        const parsed = rawNow !== null ? parseWrapperRaw(rawNow) : null;
        if (!parsed || parsed.corrupt) {
          return { ok: false, error: 'LEGACY_CONVERSION_SOURCE_UNPARSEABLE',
                   reason: parsed && parsed.reason };
        }
        if (parsed.version >= SCHEMA_VERSION) {
          return { ok: false, error: 'LEGACY_CONVERSION_SOURCE_NOT_LEGACY',
                   version: parsed.version };
        }
        const srcCheck = validateLegacySourceRequiredFields(parsed.data, parsed.version);
        if (!srcCheck.ok) {
          return { ok: false, error: 'LEGACY_CONVERSION_SOURCE_INVALID',
                   reason: srcCheck.reason, version: parsed.version };
        }
      } else {
        // R6-compat: non-recovery mode still refuses corrupt disk.
        if (rawNow !== null) {
          const parsedGuard = parseWrapperRaw(rawNow);
          if (!parsedGuard || parsedGuard.corrupt) {
            setDurabilityBlocker('STORE_CORRUPT_AUTHORITATIVE_STATE');
            return { ok: false, error: 'STORE_CORRUPT_AUTHORITATIVE_STATE' };
          }
        }
      }
      // Recovery-mode disk may now be parseable (revision-regression /
      // unsupported-future / etc. blockers). Compute the disk
      // revision from whatever parseWrapperRaw returns; for corrupt
      // wrappers it stays 0. Monotonic advance below still uses
      // max(diskRevision, knownRevision, knownRevisionAtIssue).
      let diskRevision = 0;
      if (rawNow !== null) {
        const parsed = parseWrapperRaw(rawNow);
        diskRevision = parsed && !parsed.corrupt && typeof parsed.revision === 'number' ? parsed.revision : 0;
      }
      let cloned;
      try { cloned = clonePersistable(candidateData); } catch (e) { return { ok: false, error: 'STORE_UNPERSISTABLE' }; }
      // PRV-0.5 Final Closure (INV-F, R7-P1-04): validate the ORIGINAL
      // candidate shape BEFORE any normalization/default-fill runs.
      // A malformed current-schema Logbook (an object that is neither
      // a legitimate envelope nor a legacy array) must be rejected
      // rather than silently replaced with an empty default envelope
      // — that replacement destroys the user's own data.
      if ('logbook' in cloned && cloned.logbook !== undefined && cloned.logbook !== null) {
        const lb = cloned.logbook;
        const validAsArray = Array.isArray(lb);   // legacy pre-v12 array shape
        const validAsEnvelope = isLogbookEnvelope(lb);
        if (!validAsArray && !validAsEnvelope) {
          return {
            ok: false, error: 'FULL_STATE_CANDIDATE_MALFORMED_LOGBOOK',
            reason: 'logbook-neither-array-nor-envelope'
          };
        }
      }
      normalizeLogbookDomain(cloned);
      if (!validate(cloned)) return { ok: false, error: 'FULL_STATE_INVALID' };
      // R6 P1-3: canonical marker/records shape.
      const evalCand = evaluateCandidateData(cloned);
      if (!evalCand.canonical) {
        return {
          ok: false, error: 'FULL_STATE_CANDIDATE_NONCANONICAL',
          classification: evalCand.classification, reasons: evalCand.reasons
        };
      }
      // PRV-0.5 Final Closure (INV-G, R7-P1-07): ordinary full-state
      // commit accepts ONLY AUTHORITATIVE_MIGRATED at pre-write. A
      // VERIFIED_LEGACY_TRANSITION (marker.status='unmigrated') would
      // pass the R6 canonical check, write disk, and then fail
      // post-classification — leaving the primary mutated but the
      // operation reporting failure. All three legitimate callers
      // (Reset via defaultState(), restoreSnapshot rewriting marker
      // to 'migrated', processImport via inline hydration marker
      // rewrite) already produce AUTHORITATIVE_MIGRATED; any caller
      // that supplies an unmigrated candidate must instead use an
      // explicit legacy-migration path with its own transition auth.
      if (evalCand.classification !== 'AUTHORITATIVE_MIGRATED') {
        return {
          ok: false, error: 'FULL_STATE_CANDIDATE_NOT_MIGRATED',
          classification: evalCand.classification, reasons: evalCand.reasons
        };
      }
      // R7 P1-3, INV-4: complete canonical full-state schema. Missing
      // required top-level domains (bht, career, reviews, ideas,
      // logbook envelope, etc.) fail before mutation.
      const fullEval = validateFullStateCanonical(cloned);
      if (!fullEval.ok) {
        return {
          ok: false, error: 'FULL_STATE_CANONICAL_INCOMPLETE',
          missing: fullEval.missing, reason: fullEval.reason
        };
      }
      if (diskRevision >= Number.MAX_SAFE_INTEGER) return { ok: false, error: 'STORE_REVISION_EXHAUSTED' };
      // R7 P1-4, INV-5: quarantine BEFORE destructive replacement of
      // corrupt authority, WITH mandatory reread + byte-match
      // verification. Only proceed to primary write if quarantine
      // durably matches source.
      //
      // PRV-0.5 Final Closure (INV-H + P2-01): quarantine key allocation
      // now checks absence and retries on collision (up to 8 attempts);
      // if a unique key cannot be established, we abort BEFORE any
      // primary mutation. Once a verified quarantine copy exists,
      // ALL subsequent failure paths retain it — no cleanup on
      // uncertainty (removeItem calls previously at lines 2624,
      // 2638, 2642, 2651, 2656, 2667 removed). Cleanup on success
      // also does not happen: retention is documented policy and the
      // key is exposed via Store.listQuarantineKeys() for
      // tests/diagnostics; user-facing UI can be added in a follow-up
      // without changing the retention contract.
      let quarantineKey = null;
      if (recoveryMode && rawNow !== null) {
        const alloc = _allocateQuarantineKey();
        if (!alloc.ok) return { ok: false, error: 'RECOVERY_QUARANTINE_KEY_UNAVAILABLE', reason: alloc.reason };
        const qKey = alloc.key;
        try { localStorage.setItem(qKey, rawNow); }
        catch (qe) {
          return { ok: false, error: 'RECOVERY_QUARANTINE_WRITE_FAILED', detail: qe && qe.message };
        }
        let qRead;
        try { qRead = localStorage.getItem(qKey); } catch (qre) { qRead = null; }
        if (qRead !== rawNow) {
          // Verification failed — do NOT delete: the write may have
          // partially landed and represents genuine failure evidence.
          // INV-H: "never delete on uncertainty".
          return { ok: false, error: 'RECOVERY_QUARANTINE_VERIFY_FAILED', retainedEvidenceKey: qKey };
        }
        quarantineKey = qKey;
      }
      // R7 INV-3: immediately before primary write, re-read disk and
      // confirm the source generation the auth was issued for is
      // still on disk. This forecloses the concurrent-race window
      // between quarantine-verify and primary-write.
      if (recoveryMode) {
        let rawCheckRaw;
        try { rawCheckRaw = localStorage.getItem(STATE_KEY); } catch (e) { rawCheckRaw = null; }
        if (_transitionAuth && _transitionAuth.absent === true) {
          if (rawCheckRaw !== null) {
            return { ok: false, error: 'RECOVERY_SOURCE_CHANGED_UNDER_LOCK', reason: 'disk-no-longer-absent', retainedEvidenceKey: quarantineKey };
          }
        } else if (_transitionAuth && rawCheckRaw !== _transitionAuth.sourceRawBytes) {
          return { ok: false, error: 'RECOVERY_SOURCE_CHANGED_UNDER_LOCK', reason: 'source-generation-changed', retainedEvidenceKey: quarantineKey };
        }
      }
      // PRV-0.5 Final Closure (INV-D, R7-P1-02): monotonic revision.
      // Recovery must advance past BOTH the current disk revision AND
      // Store's knownRevision — so a stale-revision disk cannot let
      // a recovery replay an earlier number, and a
      // regression-blocker recovery mints strictly greater than the
      // last accepted revision the Store observed.
      const monotonicBaseline = Math.max(
        diskRevision,
        typeof knownRevision === 'number' ? knownRevision : 0,
        _transitionAuth && typeof _transitionAuth.knownRevisionAtIssue === 'number' ? _transitionAuth.knownRevisionAtIssue : 0
      );
      const nextRevision = monotonicBaseline + 1;
      const committedAtNow = nowISO();
      const wrapper = { version: SCHEMA_VERSION, revision: nextRevision, committedAt: committedAtNow, data: cloned };
      let payload;
      try { payload = JSON.stringify(wrapper); } catch (e) {
        return { ok: false, error: 'STORE_SERIALIZE_FAILED', retainedEvidenceKey: quarantineKey };
      }
      try { localStorage.setItem(STATE_KEY, payload); }
      catch (e) {
        return { ok: false, error: 'STORE_QUOTA', detail: e && e.message, retainedEvidenceKey: quarantineKey };
      }
      // R7 P1-5, INV-6: DURABLE verification — read back what is
      // ACTUALLY persisted at STATE_KEY and require an exact
      // byte-match with `payload`. Catches: silent-no-op writes,
      // writes that landed different bytes, writes that went
      // elsewhere. Only after this proof do we advance memory.
      let durableRaw;
      try { durableRaw = localStorage.getItem(STATE_KEY); } catch (e) { durableRaw = null; }
      if (durableRaw !== payload) {
        return {
          ok: false, error: 'FULL_STATE_DURABLE_VERIFY_FAILED',
          disk: durableRaw === null ? 'absent' : (durableRaw === rawNow ? 'unchanged-source' : 'divergent-bytes'),
          retainedEvidenceKey: quarantineKey
        };
      }
      // Re-parse the durable read (not just the payload we constructed)
      // and re-classify — belt-and-suspenders for schema conformance.
      const verifyParsed = parseWrapperRaw(durableRaw);
      const verifyEval = verifyParsed && !verifyParsed.corrupt
        ? evaluateCandidateData(verifyParsed.data)
        : { canonical: false, classification: 'PARSE_FAILED' };
      if (!verifyEval.canonical || verifyEval.classification !== 'AUTHORITATIVE_MIGRATED') {
        return {
          ok: false, error: 'FULL_STATE_POST_WRITE_VERIFICATION_FAILED',
          classification: verifyEval.classification,
          retainedEvidenceKey: quarantineKey
        };
      }
      { const _snap = pushSnapshot(payload); if (!_snap.ok) emitError({ code: 'STORE_SNAPSHOT_DEGRADED', revision: nextRevision, error: String((_snap.error && _snap.error.message) || _snap.error) }); }
      baseState      = cloned;
      knownRevision  = nextRevision;
      committedAt    = committedAtNow;
      baseWrapperRaw = payload;
      pendingOps     = [];
      conflict       = null;
      durabilityBlocker = null;
      _consumeTransitionAuth();
      return {
        ok: true,
        revision: nextRevision,
        committedAt: committedAtNow,
        reason: reason || 'full-state',
        recovery: recoveryMode,
        quarantineKey: quarantineKey
      };
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
    // PRV-0.5 Final Closure (INV-A, R7-P1-01): storage-event driven
    // adoption of external bytes invalidates any transition auth
    // bound to a different source generation.
    if (_transitionAuth && _transitionAuth.sourceRawBytes !== rawWrapper) {
      _consumeTransitionAuth();
    }
    baseState      = data;
    knownRevision  = parsed.revision;
    committedAt    = parsed.committedAt;
    baseWrapperRaw = rawWrapper;
    // PRV-0.5 Pre-Push Amendment §2: if another tab's atomic legacy
    // conversion committed a valid v14 AUTHORITATIVE_MIGRATED
    // wrapper, this tab's STORE_LEGACY_CONVERSION_PENDING blocker
    // is resolved by that adoption (the legacy source no longer
    // exists on disk). Clear it so ordinary writes can resume.
    if (durabilityBlocker && durabilityBlocker.code === 'STORE_LEGACY_CONVERSION_PENDING'
        && parsed.version === SCHEMA_VERSION) {
      const inner = evaluateCandidateData(data);
      if (inner.classification === 'AUTHORITATIVE_MIGRATED') {
        durabilityBlocker = null;
        try {
          if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('lifeos:store-durability-cleared'));
          }
        } catch (e) { /* ignore */ }
      }
    }
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
    // PRV-0.5 R4 (Codex Round-3 P1-A): expose the SAME wrapper-parse and
    // revision-validity rules the Store applies. app.js hydration MUST use
    // these to judge persisted-wrapper authority instead of hand-rolling
    // a shallower validator. A wrapper the Store would reject at
    // parseWrapperRaw/initialLoad must NEVER be trusted as authoritative
    // by the migration fast path (Codex R3 defect: revision=-1 and
    // version=13 with schema-14 inner data both fast-pathed as migrated).
    parseWrapper: function (raw) {
      return parseWrapperRaw(raw);
    },
    isValidRevision,
    // PRV-0.5 R5 (ADR-015 addendum #4): the ONE Store-owned authority
    // evaluator all consumers must route through. See the block-comment
    // above evaluatePersistedAuthority in this file for the six-class
    // contract and each consumer's decision rule.
    evaluatePersistedAuthority: function (raw) { return evaluatePersistedAuthority(raw); },
    evaluateCandidateWrapper: function (input) { return evaluateCandidateWrapper(input); },
    evaluateCandidateData: function (data) { return evaluateCandidateData(data); },
    validateLegacySourceRequiredFields: validateLegacySourceRequiredFields,
    // PRV-0.5 Final Closure (INV-I): expose the version-indexed
    // historical requirements matrix so tests / diagnostics can assert
    // the exact per-version emission expectations without duplicating
    // the table.
    getHistoricalRequirements: getHistoricalRequirements,
    // PRV-0.5 R6 (Codex Round-5 P1-1): read-only check whether Store
    // currently holds the transient legacy-transition authority. Only
    // hydration should honour a `VERIFIED_LEGACY_TRANSITION` seed when
    // this returns true.
    // PRV-0.5 R7: source-bound legacy-transition auth. Returns true
    // only when an auth exists for the EXACT current disk raw bytes
    // — not a boolean the Store flipped in the past.
    canAuthoriseLegacySeed: function () { return canAuthoriseLegacySeedForCurrentDisk(); },
    // PRV-0.5 R7 (Codex Round-6 P1-2, INV-2): issue a recovery auth
    // for the current corrupt-disk source generation. Callers
    // (restoreSnapshot / reset / processImport recovery path) invoke
    // this before commitFullStateWrapper{recovery:true}. The auth
    // binds to the exact corrupt raw bytes currently on disk. A stale
    // auth (disk already recovered by another tab) fails the
    // pre-commit source-identity check under the destructive lock.
    prepareRecoveryAuth: function () { return _issueRecoveryAuthFromCurrentDisk(); },
    // Read-only diagnostics for tests / UI.
    _currentTransitionAuth: function () { return _transitionAuth ? Object.assign({}, _transitionAuth) : null; },
    // Async completion handle for the most recent `reset()` call —
    // resolves to the actual full-state commit result (P1-2 truthful
    // async result).
    _lastResetSettled: function () { return _lastResetSettled; },
    // PRV-0.5 Final Closure (INV-H): enumerate every quarantine key
    // currently in localStorage. Retention policy is "always keep
    // once verified"; enumeration lets tests and diagnostics inspect
    // accumulated recovery evidence. Order is browser-dependent
    // (localStorage insertion), so consumers must not depend on
    // ordering for identity checks — the caller filters by key
    // suffix / getItem to select individual entries.
    listQuarantineKeys: function () { return _listQuarantineKeys(); },
    // PRV-0.5 Pre-Push Amendment (BINDING-1): test hook. `true`
    // forces every recovery + legacy-conversion commit to refuse
    // with STORE_LOCK_UNAVAILABLE; `false` restores normal behavior.
    _testForceNoLock: function (flag) { _testForceNoLockFlag = flag === true; },
    // Raised for tests / documentation of the canonical marker contract.
    MARKER_STATUS: { MIGRATED: MARKER_STATUS_MIGRATED, UNMIGRATED: MARKER_STATUS_UNMIGRATED },
    REQUIRED_RECORD_DOMAINS: REQUIRED_RECORD_DOMAINS.slice(),
    isSupportedLegacySourceVersion,
    // Read the Store's currently accepted disk revision (baseline for
    // regression detection). Used by the hydration fast path to reject a
    // persisted wrapper whose revision has regressed relative to what
    // the Store already accepted — even if the wrapper's inner shape
    // otherwise looks canonical.
    currentKnownRevision: function () { return knownRevision; },
    snapshots: () => {
      try { return JSON.parse(localStorage.getItem(SNAPSHOTS_KEY) || '[]'); } catch (e) { return []; }
    },
    // Snapshot restore + reset become full-state transactions.
    // Kept sync-callable for backward compat with existing UI: begin freeze,
    // fire the commit through the coordinator, settle on completion. The
    // returned boolean reports whether the transaction was accepted for
    // dispatch (mirrors legacy semantics); durability lands under the lock.
    // PRV-0.5 R6 (Codex Round-5 P1-2): recovery-mode full-state commits
    // for restoreSnapshot/reset. Both surface a `settled` promise so
    // callers can `await` the actual asynchronous durable outcome — not
    // just the dispatch acceptance the pre-R6 API returned. When boot
    // detected corrupt authority, the recovery-mode commit quarantines
    // the corrupt raw bytes and atomically replaces disk with the
    // validated candidate; the durability blocker is cleared only after
    // post-write evaluator verification. On failure, blocker + evidence
    // stay intact and `settled` reports the exact error.
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
      const v = validateSnapshotWrapperFull(parsed);
      if (!v.ok) return { ok: false, error: 'SNAPSHOT_SOURCE_WRAPPER_INVALID', reason: v.reason };
      const data = v.data;
      // PRV-0.5 R6 (Codex Round-5 P1-2): snapshot restore is an
      // approved recovery event by construction. The migrated
      // candidate's marker MUST land as `status='migrated'` on disk so
      // reload does not re-enter the recovery-required loop. A v13
      // source's migrateUp-generated `unmigrated` marker is rewritten
      // here to a canonical migrated marker with `reason='snapshot-
      // restore'` — the user's explicit choice of THIS generation as
      // authoritative supersedes further legacy seeding.
      if (!data.meta || typeof data.meta !== 'object') data.meta = {};
      data.meta.recordsMigration = {
        status: MARKER_STATUS_MIGRATED,
        schemaVersion: SCHEMA_VERSION,
        reason: 'snapshot-restore'
      };
      // PRV-0.5 R7: issue a recovery auth for the current corrupt
      // source generation (if any). Non-corrupt commits skip the
      // recovery-auth path.
      let restoreRecoveryMode = false;
      if (durabilityBlocker) {
        const authRes = _issueRecoveryAuthFromCurrentDisk();
        if (!authRes.ok) return { ok: false, error: 'RESTORE_RECOVERY_AUTH_FAILED', reason: authRes.error };
        restoreRecoveryMode = true;
      }
      const gate = beginFullStateTransaction({ force: !!opts.force, reason: 'snapshot' });
      if (!gate.ok) return { ok: false, error: gate.error };
      const settled = commitFullStateWrapper(gate.token, data, 'snapshot', { recovery: restoreRecoveryMode }).then(res => {
        try {
          if (res && res.ok) {
            const frozen = deepFreezePersistable(clonePersistable(baseState));
            for (const fn of saveListeners) {
              try { fn(frozen, { revision: res.revision, committedAt: res.committedAt, reason: res.reason }); } catch (e) {}
            }
          }
        } finally { endFullStateTransaction(gate.token); }
        return res;
      }, (err) => { endFullStateTransaction(gate.token); return { ok: false, error: 'SNAPSHOT_COMMIT_REJECTED', detail: err && err.message }; });
      return { ok: true, settled: settled };
    },
    reset: function (opts) {
      opts = opts || {};
      // PRV-0.5 R7: if a corrupt-authority blocker is active, issue a
      // recovery auth bound to the current corrupt source. Otherwise
      // reset is a normal full-state commit.
      let resetRecoveryMode = false;
      if (durabilityBlocker) {
        const authRes = _issueRecoveryAuthFromCurrentDisk();
        if (!authRes.ok) {
          _lastResetSettled = Promise.resolve({ ok: false, error: 'RESET_RECOVERY_AUTH_FAILED', reason: authRes.error });
          return false;
        }
        resetRecoveryMode = true;
      }
      const gate = beginFullStateTransaction({ force: !!opts.force, reason: 'reset' });
      if (!gate.ok) return false;
      const settled = commitFullStateWrapper(gate.token, defaultState(), 'reset', { recovery: resetRecoveryMode }).then(res => {
        try {
          if (res && res.ok) {
            const snap = deepFreezePersistable(clonePersistable(baseState));
            for (const fn of saveListeners) {
              try { fn(snap, { revision: res.revision, committedAt: res.committedAt, reason: res.reason }); } catch (e) {}
            }
          }
        } finally { endFullStateTransaction(gate.token); }
        return res;
      }, (err) => { endFullStateTransaction(gate.token); return { ok: false, error: 'RESET_COMMIT_REJECTED', detail: err && err.message }; });
      // Legacy return contract: reset() returned a boolean. Preserve
      // that for callers that don't need to await, and attach settled
      // as a static property so callers that DO need to await can pick
      // it up via `Store._lastResetSettled`.
      _lastResetSettled = settled;
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
    // Test-only helper exposure (not part of the public API surface). Used
    // by store-durability regressions to prove canonical-index classification
    // at the 2^32 boundary without allocating a 4.29-billion-slot array.
    _test_isCanonicalArrayIndexKey: isCanonicalArrayIndexKey,
    // For post-commit listener firing.
    _internal_fireSaveListeners: function (frozenSnap, meta) {
      for (const fn of saveListeners) { try { fn(frozenSnap, meta); } catch (e) {} }
    },
    derive
  };
})(window);
