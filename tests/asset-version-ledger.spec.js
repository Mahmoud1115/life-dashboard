const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER = require('./fixtures/asset-version-ledger.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('local scripts and stylesheets match their cache-bust version ledger', ({}, testInfo) => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const assets = {};
  const tags = html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g);

  for (const match of tags) {
    const url = new URL(match[1], 'http://life-os.test/');
    if (url.origin !== 'http://life-os.test' || !/\.(?:js|css)$/.test(url.pathname)) continue;
    const assetPath = url.pathname.replace(/^\//, '');
    assets[assetPath] = {
      version: url.searchParams.get('v'),
      sha256: sha256(path.join(ROOT, assetPath)),
    };
  }

  expect(Object.keys(assets).sort()).toEqual(Object.keys(LEDGER).sort());
  for (const [assetPath, actual] of Object.entries(assets)) {
    expect(actual.version, `${assetPath} must have a ?v= cache-bust query`).toBeTruthy();
    expect(actual, `${assetPath} changed; bump its ?v= value and refresh the ledger`).toEqual(LEDGER[assetPath]);
  }

  let baseLedger;
  try {
    const raw = execFileSync('git', [
      'show',
      'origin/main:tests/fixtures/asset-version-ledger.json',
    ], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    baseLedger = JSON.parse(raw);
  } catch (error) {
    const reason = error && error.message ? error.message.split('\n')[0] : String(error);
    testInfo.annotations.push({
      type: 'base-cache-bust-enforcement-skipped',
      description: `Could not read the asset ledger from origin/main: ${reason}`,
    });
  }

  if(baseLedger){
    for(const assetPath of Object.keys(assets)){
      if(!baseLedger[assetPath]) continue;
      if(assets[assetPath].sha256 !== baseLedger[assetPath].sha256){
        expect(
          assets[assetPath].version,
          `${assetPath} content changed from origin/main; bump its ?v= value`,
        ).not.toBe(baseLedger[assetPath].version);
      }
    }
  }
});
