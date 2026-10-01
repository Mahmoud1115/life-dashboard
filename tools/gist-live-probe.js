/* Life OS — value-free Gist Sync evidence probe (INERT helper; paste into the DevTools console of a Life OS tab, or load as a script).
 *
 * Purpose: capture ONLY hashes (24-hex prefixes), counts and byte sizes before/after a Gist Save and before/after a restore into an ISOLATED fresh profile,
 * so the end-to-end test needs no personal value to be read, printed or copied.
 *
 * Hard rules this file keeps (a Playwright test asserts them):
 *   - it never reads, references or transmits the GitHub PAT, never calls fetch/XHR, and never builds an Authorization header;
 *   - every returned object contains hashes, counts, sizes, booleans and fixed status words only (no record text, no Gist id, no revision id);
 *   - it has NO restore/load function. A restore is done only through the app's own explicit, confirmation-gated UI in an isolated profile;
 *   - save() calls the app's own GistSync.saveConnected(), which refuses on conflict / remote-only / no-base and verifies the remote by re-reading it.
 */
(function () {
  'use strict';
  var HASH_PREFIX = 24;

  function gs() {
    if (!window.GistSync || typeof window.getAllBackupData !== 'function') throw new Error('Life OS not ready (GistSync/getAllBackupData missing)');
    return window.GistSync;
  }
  function shape(value) {
    if (Array.isArray(value)) return { type: 'array', count: value.length };
    if (value && typeof value === 'object') return { type: 'object', count: Object.keys(value).length };
    if (typeof value === 'string') return { type: 'string', count: value.length };
    return { type: typeof value, count: 1 };
  }
  async function hashPrefix(data) {
    return (await gs().backupDataHash(data)).slice(0, HASH_PREFIX);
  }
  async function sha256Prefix(text) {
    var bytes = new TextEncoder().encode(String(text));
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, HASH_PREFIX);
  }

  /** Current local backup identity: semantic hash prefix + per-collection type/count/bytes. */
  async function local() {
    var data = window.getAllBackupData();
    var collections = {};
    Object.keys(data).sort().forEach(function (key) {
      var info = shape(data[key]);
      info.bytes = JSON.stringify(data[key]).length;
      collections[key] = info;
    });
    return { semanticHash: await hashPrefix(data), collectionCount: Object.keys(collections).length, collections: collections };
  }

  /** Sync base summary: presence, hash prefix, and an opaque fingerprint of the Gist id/revision (never the raw ids). */
  async function syncBase() {
    var base = gs().readSyncBase();
    if (!base) return { present: false };
    return {
      present: true,
      baseDataHash: String(base.baseDataHash).slice(0, HASH_PREFIX),
      gistFingerprint: await sha256Prefix(base.gistId),
      revisionFingerprint: await sha256Prefix(base.remoteVersion),
      acceptedAt: base.acceptedAt,
    };
  }

  /** Runs the app's own guarded Save and returns a value-free outcome. Safe by construction: it refuses on conflict/remote-only/no-base. */
  async function save() {
    var result;
    try { result = await gs().saveConnected(); }
    catch (e) { result = { ok: false, reason: 'threw' }; }
    var after = await local();
    var base = await syncBase();
    return {
      ok: result && result.ok === true,
      kind: (result && typeof result.kind === 'string') ? result.kind : null,
      reason: (result && typeof result.reason === 'string') ? result.reason : null,
      localAfter: { semanticHash: after.semanticHash, collectionCount: after.collectionCount },
      syncBase: base,
      baseMatchesLocal: !!(base.present && base.baseDataHash === after.semanticHash),
    };
  }

  /** Pure comparison of two local() outputs (e.g. production vs the isolated restored profile). */
  function compare(a, b) {
    var problems = [];
    if (!a || !b) return { pass: false, problems: ['missing input'] };
    if (a.semanticHash !== b.semanticHash) problems.push('semanticHash differs');
    var names = Array.from(new Set(Object.keys(a.collections || {}).concat(Object.keys(b.collections || {})))).sort();
    names.forEach(function (name) {
      var x = a.collections[name], y = b.collections[name];
      if (!x || !y) problems.push(name + ': missing on one side');
      else if (x.type !== y.type || x.count !== y.count) problems.push(name + ': type/count differs');
    });
    return { pass: problems.length === 0, problems: problems };
  }

  window.__gistProbe = Object.freeze({ local: local, syncBase: syncBase, save: save, compare: compare });
})();
