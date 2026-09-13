#!/usr/bin/env node
// Post-deploy Pages probe (R2-strengthened).
//
// Availability + integrity check for a GitHub Pages deployment of LIFE OS.
// Confirms every locally-referenced asset returns 200, and for the critical
// migration seed additionally does a full GET, hashes the response bytes
// with SHA-256, and compares to the on-disk file's SHA-256.
//
// This script deliberately does NOT prove deployment SHA identity — that
// requires GitHub Pages API/receipt, which is checked separately in the
// controlled-merge report. This script proves availability + byte-integrity
// for the migration seed only.
//
// Usage:
//   node tools/pages-post-deploy-probe.mjs [base-url]
//
// Default base-url: https://mahmoud1115.github.io/life-dashboard/

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_BASE = 'https://mahmoud1115.github.io/life-dashboard/';
const base = (process.argv[2] || DEFAULT_BASE).replace(/\/$/, '') + '/';

const CRITICAL_ASSETS = ['_migration-legacy-records.js'];

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

function sha256Hex(bytes){ return createHash('sha256').update(bytes).digest('hex'); }

async function headStatus(url){
  const res = await fetch(url, { method:'HEAD' });
  return res.status;
}

async function getBytes(url){
  const res = await fetch(url, { method:'GET' });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf };
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
      console.log(' ' + (ok ? 'OK ' : 'FAIL') + ' HEAD ' + s + ' ' + url);
      if (!ok) failures.push({ url, status: s });
    } catch(e){
      console.log(' ERR  HEAD    ' + url + ' :: ' + (e && e.message || e));
      failures.push({ url, error: String(e && e.message || e) });
    }
  }
  console.log('\nR2 §strengthening: full GET + SHA-256 for critical asset(s):');
  for (const a of CRITICAL_ASSETS){
    const url = base + a;
    let localHash, remote;
    try {
      const localBytes = readFileSync(join(REPO_ROOT, a));
      localHash = sha256Hex(localBytes);
    } catch(e){
      console.log('  ERR local read ' + a + ' :: ' + (e && e.message || e));
      failures.push({ url, error:'local-read-' + (e && e.message || e) });
      continue;
    }
    try {
      remote = await getBytes(url);
    } catch(e){
      console.log('  ERR GET       ' + url + ' :: ' + (e && e.message || e));
      failures.push({ url, error:String(e && e.message || e) });
      continue;
    }
    if (remote.status !== 200){
      console.log('  FAIL GET ' + remote.status + ' ' + url);
      failures.push({ url, status: remote.status });
      continue;
    }
    const remoteHash = sha256Hex(remote.bytes);
    const match = remoteHash === localHash;
    console.log('  ' + (match ? 'OK ' : 'FAIL') + ' GET/SHA-256 ' + url);
    console.log('    local  sha256 = ' + localHash);
    console.log('    remote sha256 = ' + remoteHash);
    if (!match){
      failures.push({ url, error:'sha256-mismatch', localHash, remoteHash });
    }
  }

  if (failures.length){
    console.error('\nPages probe FAILED: ' + failures.length + ' asset(s)');
    process.exit(1);
  }
  console.log('\nPages probe OK — all assets available; critical assets byte-identical to repo.');
  console.log('NOTE: this script does not prove deployment SHA identity; that is the controlled-merge report\'s responsibility.');
}
main().catch(e => { console.error(e); process.exit(2); });
