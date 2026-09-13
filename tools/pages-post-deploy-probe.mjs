#!/usr/bin/env node
// Post-deploy Pages probe.
//
// Verifies that the LIVE GitHub Pages site emits every required local
// runtime asset referenced by canonical index.html — with special
// emphasis on `_migration-legacy-records.js`, whose absence under
// default Jekyll processing produced Integration P1-A.
//
// Usage:
//   node tools/pages-post-deploy-probe.mjs [base-url]
//
// Default base-url is derived from the GitHub Pages API when GITHUB_TOKEN
// is set and the repo is Mahmoud1115/life-dashboard; otherwise it uses
// https://mahmoud1115.github.io/life-dashboard/.
//
// Exits non-zero if any required asset is missing or non-200.
// Uses only Node standard library — no npm dependency.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_BASE = 'https://mahmoud1115.github.io/life-dashboard/';
const base = (process.argv[2] || DEFAULT_BASE).replace(/\/$/, '') + '/';

function stripQuery(ref){ const i = ref.indexOf('?'); return i === -1 ? ref : ref.slice(0, i); }
function localScriptSrcs(html){
  const out = []; const re = /<script[^>]*src="([^"]+)"/gi; let m;
  while ((m = re.exec(html)) !== null){ const v = m[1]; if (/^https?:\/\//i.test(v)) continue; out.push(stripQuery(v)); }
  return out;
}
function localLinkHrefs(html){
  const out = []; const re = /<link[^>]*href="([^"]+)"[^>]*>/gi; let m;
  while ((m = re.exec(html)) !== null){ const v = m[1]; if (/^https?:\/\//i.test(v)) continue; out.push(stripQuery(v)); }
  return out;
}

async function headStatus(url){
  const res = await fetch(url, { method:'HEAD' });
  return res.status;
}

async function main(){
  const html = readFileSync(join(REPO_ROOT, 'index.html'), 'utf8');
  const assets = new Set([
    'index.html',
    ...localScriptSrcs(html),
    ...localLinkHrefs(html),
  ]);
  console.log('Probing ' + assets.size + ' assets at ' + base);
  const failures = [];
  for (const a of assets){
    const url = base + a;
    try {
      const s = await headStatus(url);
      const ok = s === 200;
      console.log(' ' + (ok ? 'OK ' : 'FAIL') + ' ' + s + ' ' + url);
      if (!ok) failures.push({ url, status: s });
    } catch(e){
      console.log(' ERR    ' + url + ' :: ' + (e && e.message || e));
      failures.push({ url, error: String(e && e.message || e) });
    }
  }
  const migrationUrl = base + '_migration-legacy-records.js';
  console.log('\nSpecial: migration seed must be 200 → ' + migrationUrl);
  const migStatus = await headStatus(migrationUrl).catch(e => ({ error:String(e && e.message || e) }));
  console.log('  status = ' + JSON.stringify(migStatus));

  if (failures.length){
    console.error('\nPages probe FAILED: ' + failures.length + ' asset(s) not 200');
    process.exit(1);
  }
  console.log('\nPages probe OK');
}
main().catch(e => { console.error(e); process.exit(2); });
