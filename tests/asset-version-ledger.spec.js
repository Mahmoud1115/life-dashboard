const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER = require('./fixtures/asset-version-ledger.json');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

test('local scripts and stylesheets match their cache-bust version ledger', () => {
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
});
