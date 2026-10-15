#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER_PATH = path.join(ROOT, 'tests', 'fixtures', 'asset-version-ledger.json');
const CHECK_ONLY = process.argv.includes('--check');
const unknownArgs = process.argv.slice(2).filter(arg => arg !== '--check');

if(unknownArgs.length){
  console.error(`Unknown argument: ${unknownArgs[0]}`);
  process.exit(2);
}

function sha256(filePath){
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readAssets(){
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const assets = {};
  const tags = html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"[^>]*>/g);

  for(const match of tags){
    const url = new URL(match[1], 'http://life-os.test/');
    if(url.origin !== 'http://life-os.test' || !/\.(?:js|css)$/.test(url.pathname)) continue;
    const assetPath = url.pathname.replace(/^\//, '');
    const version = url.searchParams.get('v');
    if(!version) throw new Error(`${assetPath} must have a ?v= cache-bust query`);
    assets[assetPath] = {
      version,
      sha256: sha256(path.join(ROOT, assetPath)),
    };
  }

  return Object.fromEntries(Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)));
}

let ledger;
let assets;
try{
  ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  assets = readAssets();
}catch(error){
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}

const staleVersions = [];
for(const [assetPath, actual] of Object.entries(assets)){
  const previous = ledger[assetPath];
  if(previous && actual.sha256 !== previous.sha256 && actual.version === previous.version){
    staleVersions.push(assetPath);
  }
}

if(staleVersions.length){
  for(const assetPath of staleVersions){
    console.error(`${assetPath}: content changed; bump ?v= in index.html first`);
  }
  process.exit(1);
}

const refreshed = JSON.stringify(assets, null, 2) + '\n';
const current = fs.readFileSync(LEDGER_PATH, 'utf8');
if(current === refreshed){
  console.log('Asset version ledger is up to date.');
  process.exit(0);
}

if(CHECK_ONLY){
  console.error('Asset version ledger is out of date; run node tools/update-asset-ledger.js.');
  process.exit(1);
}

fs.writeFileSync(LEDGER_PATH, refreshed);
console.log(`Updated ${path.relative(ROOT, LEDGER_PATH)} (${Object.keys(assets).length} assets).`);
