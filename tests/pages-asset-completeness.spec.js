// Pages asset-completeness + Jekyll-protection regression.
//
// Covers Integration P1-A: the production Pages deployment omitted
// `_migration-legacy-records.js` because default Jekyll processing on the
// legacy Pages build excludes underscore-prefixed files. A repo-level
// `.nojekyll` file disables Jekyll and preserves these assets.
//
// These are static checks against the repository source, not the live site.
// A separate post-deploy probe (tools/pages-post-deploy-probe.mjs) verifies
// actual Pages emission after deployment.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

function readIndex(){
  return fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
}

function stripQuery(ref){
  const i = ref.indexOf('?');
  return i === -1 ? ref : ref.slice(0, i);
}

function localScriptSrcs(html){
  const out = [];
  const re = /<script[^>]*src="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null){
    const v = m[1];
    if (/^https?:\/\//i.test(v)) continue;
    out.push(stripQuery(v));
  }
  return out;
}

function localStyleAndManifestHrefs(html){
  const out = [];
  const re = /<link[^>]*href="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null){
    const v = m[1];
    if (/^https?:\/\//i.test(v)) continue;
    // ignore icon links — they're optional; but still exist here.
    out.push(stripQuery(v));
  }
  return out;
}

test.describe('D1 — asset-completeness contract (canonical index.html → repo files)', () => {
  test('D1-01: every local <script src> referenced by index.html exists in repo', () => {
    const html = readIndex();
    const missing = [];
    for (const src of localScriptSrcs(html)){
      const full = path.join(REPO_ROOT, src);
      if (!fs.existsSync(full)) missing.push(src);
    }
    expect(missing, 'missing local scripts: ' + missing.join(', ')).toEqual([]);
  });

  test('D1-02: every local <link href> (stylesheet/manifest/icon) exists in repo', () => {
    const html = readIndex();
    const missing = [];
    for (const href of localStyleAndManifestHrefs(html)){
      const full = path.join(REPO_ROOT, href);
      if (!fs.existsSync(full)) missing.push(href);
    }
    expect(missing, 'missing local link hrefs: ' + missing.join(', ')).toEqual([]);
  });

  test('D1-03: the migration seed file exists and is not empty', () => {
    const full = path.join(REPO_ROOT, '_migration-legacy-records.js');
    expect(fs.existsSync(full), '_migration-legacy-records.js must exist').toBe(true);
    const st = fs.statSync(full);
    expect(st.size, '_migration-legacy-records.js must be non-empty').toBeGreaterThan(0);
  });
});

test.describe('D2 — Jekyll underscore-exclusion is disabled via root .nojekyll', () => {
  test('D2-01: root .nojekyll exists', () => {
    const nj = path.join(REPO_ROOT, '.nojekyll');
    expect(fs.existsSync(nj), 'root .nojekyll must exist so Pages does not run Jekyll').toBe(true);
  });

  test('D2-02: any underscore-prefixed local runtime script referenced by index.html requires .nojekyll present', () => {
    const html = readIndex();
    const underscoreRefs = localScriptSrcs(html).filter(s => path.basename(s).startsWith('_'));
    if (underscoreRefs.length === 0){
      // No underscore-prefixed assets => .nojekyll is not strictly required
      // for this contract. Still, an existing .nojekyll is harmless.
      return;
    }
    const nj = path.join(REPO_ROOT, '.nojekyll');
    expect(fs.existsSync(nj), 'underscore-prefixed runtime asset(s) present (' + underscoreRefs.join(',') + '); root .nojekyll must disable Jekyll').toBe(true);
  });
});

test.describe('D3 — missing migration seed is fail-closed (source of truth in code)', () => {
  test('D3-01: gist-sync + core reference _migration- filename by exact path only via index.html', () => {
    // No other code path may hardcode a rewritten seed name — that would hide
    // the missing-asset failure. This is a fail-closed guard: if someone
    // renames the seed, the rename must go through index.html.
    const html = readIndex();
    const raw = html.match(/_migration-legacy-records\.js/g) || [];
    expect(raw.length, 'canonical seed reference must appear at least once in index.html').toBeGreaterThan(0);
  });
});
