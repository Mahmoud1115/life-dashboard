// S1a Track A proof fixtures + Track C/Round-2 certification for the Finance P0.
//
// Bounded claim under test (owner authorization 101 §19):
//   A failed or malformed Finance authority read cannot authorize destructive
//   overwrite or false Store-shadow publication; every named Finance structure
//   is admitted before it can authorize a write; submitted semantic intent is
//   verified in the durable result; refused/newer drafts survive ordinary
//   render/recompute callbacks; Save and post-write feedback are truthful; and
//   the degraded fallback never acknowledges a dropped write. Supported healthy
//   edits retain intended data.
//
// Track A discipline (auth 101 §8 / Codex 100 §17 G01):
//   - Portable PROTOTYPE-level storage fault injection (NOT own-property
//     assignment, a WebKit no-op — Codex F12). Every negative fault carries a
//     POSITIVE HIT WITNESS.
//   - Exact durable-byte oracle over dune_finance_v1 (read through the REAL
//     getter, so a faulted getItem cannot mask truth) + Store money shadow
//     oracle + truthful UI/outcome oracle.
//   - Every B01-B06 regression FAILS on the frozen failed candidate
//     8194b489 (the calibrated unsafe control, auth 101 §8) and PASSES here.
//
// Chromium + WebKit. workers=1, retries=0.

const { test, expect } = require('@playwright/test');

const FIN = 'dune_finance_v1';

// Rich seed matching Codex 100: salary sentinel, two custom rows with a row
// sentinel, and unknown root/phase fields that must all survive.
const RICH = JSON.stringify({
  rootExtra: 'ROOTKEEP',
  russia: {
    salary: 424242, rent: 26000, food: 0, save_target: 0, phaseExtra: 'PHASEKEEP',
    customIncome: [
      { id: 'c1', name: 'Old name', amount: 33333, rowExtra: 'ROWKEEP' },
      { id: 'c2', name: 'Second', amount: 0 }
    ],
    customExpenses: [], customSeeded: true
  },
  otherPhase: { zero: 0, extra: 'OTHERKEEP' }
});

// Prototype-level fault injector installed before app scripts run. Faults are
// scoped to the Finance key and counted so tests assert a positive hit. The
// readback* modes fire only AFTER a write (dirty), so the initial authority
// read sees truth and the post-write readback is what fails (Codex 100 harness).
async function installStorageFaults(page){
  await page.addInitScript(() => {
    const proto = Object.getPrototypeOf(window.localStorage);
    const realGet = proto.getItem;
    const realSet = proto.setItem;
    const w = { getThrow:0, setThrow:0, setNoop:0, getMalformed:0, readbackThrow:0, readbackMalformed:0, readbackDifferent:0 };
    window.__faults = { mode:{}, witness:w, dirty:false };
    window.__realGet = realGet;
    window.__realSet = realSet;
    proto.getItem = function(k){
      if (k === 'dune_finance_v1'){
        const f = window.__faults, m = f.mode;
        if (m.getThrow){ w.getThrow++; throw new DOMException('SecurityError','SecurityError'); }
        if (m.getMalformed){ w.getMalformed++; return m.getMalformed === 'string' ? '"a-plain-string"' : '{not-json'; }
        if (m.readbackThrow && f.dirty){ w.readbackThrow++; throw new DOMException('SecurityError','SecurityError'); }
        if (m.readbackMalformed && f.dirty){ w.readbackMalformed++; return '{invalid'; }
        if (m.readbackDifferent && f.dirty){ w.readbackDifferent++; return '{"different":true}'; }
      }
      return realGet.call(this, k);
    };
    proto.setItem = function(k, v){
      if (k === 'dune_finance_v1'){
        const f = window.__faults, m = f.mode; f.dirty = true;
        if (m.setThrow){ w.setThrow++; throw new DOMException('QuotaExceededError','QuotaExceededError'); }
        if (m.setNoop){ w.setNoop++; return; } // silent no-op: value NOT written
      }
      return realSet.call(this, k, v);
    };
  });
}

// Seed via the REAL setter, reload-idempotent (addInitScript re-runs on every
// navigation; only seed when genuinely absent so a reload cannot clobber edits).
async function seedRaw(page, raw){
  await page.addInitScript((raw) => {
    const realGet = window.__realGet || Object.getPrototypeOf(window.localStorage).getItem;
    const realSet = window.__realSet || Object.getPrototypeOf(window.localStorage).setItem;
    if (realGet.call(window.localStorage, 'dune_finance_v1') !== null) return;
    if (raw !== null) realSet.call(window.localStorage, 'dune_finance_v1', raw);
  }, raw);
}

// Legacy healthy seed used by the original calibrated tests.
async function seedFinance(page){
  await seedRaw(page, JSON.stringify({
    russia: {
      salary: 424242, rent: 26000, food: 16000, save_target: 55000,
      customIncome: [{ id:'c_seed1', name:'Side job', amount:33333 }],
      customExpenses: [], customSeeded: true,
      __sentinel: 'KEEPME'
    }
  }));
}

async function waitFinance(page){
  await page.waitForFunction(() => typeof window.finInputChange === 'function'
    && typeof window.finGetInputs === 'function'
    && typeof window.finSaveInputs === 'function'
    && !!window.MONEY_CUSTOM, {}, { timeout: 15000 });
}

// Durable read through the REAL getter so an armed fault cannot mask truth.
function readFinanceRaw(page){
  return page.evaluate(() => {
    try {
      const g = window.__realGet || Object.getPrototypeOf(window.localStorage).getItem;
      return g.call(window.localStorage, 'dune_finance_v1');
    } catch(e){ return '__READ_THREW__'; }
  });
}

// Strongest durable oracle: a fresh same-origin page with NO app scripts,
// reading native storage directly (Codex 100 §10 independent reader).
async function independentDurableRead(context){
  const p = await context.newPage();
  await p.route('**/*', route => {
    const u = route.request().url();
    return u.endsWith('/__reader__') ? route.fulfill({ status:200, contentType:'text/html', body:'<!doctype html><title>reader</title>' }) : (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost') ? route.continue() : route.abort());
  });
  const base = await context.pages()[0].evaluate(() => location.origin);
  await p.goto(base + '/__reader__');
  const raw = await p.evaluate(() => localStorage.getItem('dune_finance_v1'));
  await p.close();
  return raw;
}

async function armFault(page, mode){
  await page.evaluate((m) => { window.__faults.mode = m; window.__faults.dirty = false; }, mode);
}
async function faultWitness(page){
  return page.evaluate(() => window.__faults.witness);
}
async function toastText(page){
  return page.evaluate(() => (document.getElementById('backup-toast')||{}).textContent || '');
}
async function shadowRent(page){
  return page.evaluate(() => (window.Store && typeof window.Store.get === 'function') ? (window.Store.get('money.expenses.rent') ?? null) : null);
}

// ── F02 CALIBRATION — must FAIL destructively on baseline, PASS after fix ──
test.describe('S1a — Finance failed-read destructive overwrite (F02)', () => {

  test('CAL-F02-readfail: a thrown Finance read + edit must NOT overwrite the durable key', async ({ page }) => {
    await installStorageFaults(page);
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    const before = await readFinanceRaw(page);
    expect(before).toContain('KEEPME');
    expect(before).toContain('424242');

    await armFault(page, { getThrow: true });
    const res = await page.evaluate(() => {
      try { return { ret: window.finInputChange('russia','rent',31000) }; }
      catch(e){ return { threw: String(e && e.message || e) }; }
    });
    const w = await faultWitness(page);
    expect(w.getThrow).toBeGreaterThan(0);

    await armFault(page, {});
    const after = await readFinanceRaw(page);
    expect(after, 'durable Finance data must survive a failed read').toContain('KEEPME');
    expect(after).toContain('424242');
    expect(after).toContain('c_seed1');
    if (res && res.ret !== undefined) {
      expect(res.ret && res.ret.ok, 'finInputChange must not report ok on a failed authority read').not.toBe(true);
    }
  });

  test('CAL-F02-malformed: malformed stored Finance + edit must NOT overwrite', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, '{not-json-MALFORMED-SENTINEL');
    await page.goto('/');
    await waitFinance(page);
    const before = await readFinanceRaw(page);
    expect(before).toContain('MALFORMED-SENTINEL');
    const res = await page.evaluate(() => { try { return { ret: window.finInputChange('russia','rent',31000) }; } catch(e){ return { threw:String(e) }; } });
    const after = await readFinanceRaw(page);
    expect(after, 'malformed durable bytes must be preserved, not overwritten').toContain('MALFORMED-SENTINEL');
    if (res && res.ret !== undefined) expect(res.ret && res.ret.ok).not.toBe(true);
  });

  test('CAL-F02-writenoop: a silently-dropped write must NOT report saved', async ({ page }) => {
    await installStorageFaults(page);
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    await armFault(page, { setNoop: true });
    const res = await page.evaluate(() => { try { return { ret: window.finInputChange('russia','rent',31000) }; } catch(e){ return { threw:String(e) }; } });
    const w = await faultWitness(page);
    expect(w.setNoop).toBeGreaterThan(0);
    if (res && res.ret !== undefined) {
      expect(res.ret && res.ret.ok, 'a no-op write must not be reported as saved').not.toBe(true);
    }
    // A verified-unchanged no-op must be truthful: nothing overwritten.
    await armFault(page, {});
    const after = await readFinanceRaw(page);
    expect(after).toContain('26000');
    expect(after).not.toContain('31000');
  });

  test('SHADOW-F02: a refused Finance edit must NOT publish a Store money shadow', async ({ page }) => {
    await installStorageFaults(page);
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
    const shadowBefore = await shadowRent(page);
    await armFault(page, { getThrow: true });
    await page.evaluate(() => { try { window.finInputChange('russia','rent', 999999); } catch(e){} });
    const w = await faultWitness(page);
    expect(w.getThrow).toBeGreaterThan(0);
    await armFault(page, {});
    const shadowAfter = await shadowRent(page);
    expect(shadowAfter).not.toBe(999999);
    expect(shadowAfter).toBe(shadowBefore);
  });
});

// ── B01 — public whole-object authority bypass (P0) ──
test.describe('S1a Round-2 — B01 public authority bypass', () => {

  test('B01-default-under-throw: finSaveInputs(finGetInputs()) under a thrown read must not destroy durable data', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    await armFault(page, { getThrow: true });
    const res = await page.evaluate(() => {
      try { const d = window.finGetInputs(); return { ret: window.finSaveInputs(d) }; }
      catch(e){ return { threw: String(e) }; }
    });
    const w = await faultWitness(page);
    expect(w.getThrow, 'read fault must actually fire').toBeGreaterThan(0);
    await armFault(page, {});
    const after = await readFinanceRaw(page);
    expect(after).toContain('424242');   // salary sentinel survives
    expect(after).toContain('ROOTKEEP');
    expect(after).toContain('ROWKEEP');
    expect(after).toContain('c1');
    if (res && res.ret !== undefined) expect(res.ret && res.ret.ok).not.toBe(true);
  });

  test('B01-null: finSaveInputs(null) must be refused, not become canonical authority', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    const res = await page.evaluate(() => ({ ret: window.finSaveInputs(null) }));
    expect(res.ret && res.ret.ok).not.toBe(true);
    const after = await readFinanceRaw(page);
    expect(after).toContain('424242');
    expect(after).not.toBe('null');
  });

  test('B01-partial: finSaveInputs partial target cannot silently destroy extras', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    const res = await page.evaluate(() => ({ ret: window.finSaveInputs({ russia: { rent: 31000 } }) }));
    const after = await readFinanceRaw(page);
    // preservation merge: extras survive; the intended rent is applied.
    expect(after).toContain('424242');   // salary preserved
    expect(after).toContain('ROOTKEEP'); // unknown root preserved
    expect(after).toContain('c1');       // custom rows preserved
    expect(after).toContain('31000');    // intent applied
    expect(res.ret && res.ret.ok).toBe(true);
  });
});

// ── B02 — nested shape / semantic acknowledgement (P1) ──
test.describe('S1a Round-2 — B02 nested admission + semantic intent', () => {

  for (const [label, raw] of [['phase-array','{"russia":[]}'],['phase-string','{"russia":"BAD_PHASE"}'],['phase-null','{"russia":null}']]) {
    test(`B02-${label}: invalid phase must refuse, not fabricate success/shadow`, async ({ page }) => {
      await installStorageFaults(page);
      await seedRaw(page, raw);
      await page.goto('/');
      await waitFinance(page);
      const shadowBefore = await shadowRent(page);
      const res = await page.evaluate(() => { try { return { ret: window.finInputChange('russia','rent',99000) }; } catch(e){ return { threw:String(e) }; } });
      const after = await readFinanceRaw(page);
      const shadowAfter = await shadowRent(page);
      expect(res.ret && res.ret.ok, 'invalid phase must not report ok').not.toBe(true);
      // durable bytes unchanged (evidence preserved), no fabricated shadow.
      expect(after).toBe(raw);
      expect(shadowAfter).not.toBe(99000);
      expect(shadowAfter).toBe(shadowBefore);
    });
  }

  test('B02-malformed-collection: a present-but-malformed custom collection must refuse, preserving evidence', async ({ page }) => {
    const raw = '{"rootExtra":"ROOTKEEP","russia":{"salary":424242,"customIncome":"MALFORMED_ROWS","customExpenses":[],"customSeeded":true}}';
    await installStorageFaults(page);
    await seedRaw(page, raw);
    await page.goto('/');
    await waitFinance(page);
    const res = await page.evaluate(() => ({ ret: window.MONEY_CUSTOM.addRow('income') }));
    const after = await readFinanceRaw(page);
    expect(res.ret && res.ret.ok, 'malformed collection must not be silently normalized/committed').not.toBe(true);
    expect(after, 'malformed collection evidence must be preserved').toContain('MALFORMED_ROWS');
  });

  test('B02-semantic-intent: a successful scalar edit must persist the intended field itself', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    const res = await page.evaluate(() => ({ ret: window.finInputChange('russia','rent',31000) }));
    expect(res.ret && res.ret.ok).toBe(true);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent, 'the intended canonical field must hold the intended value').toBe(31000);
    expect(after.russia.salary).toBe(424242); // preserved
  });

  test('B02-healthy-zero-empty-partial: valid zero/empty/partial historical data is admitted and preserved', async ({ page }) => {
    const raw = JSON.stringify({ rootExtra:'ROOTKEEP', russia:{ customIncome:[], customExpenses:[], customSeeded:true, phaseExtra:'PHASEKEEP' } });
    await installStorageFaults(page);
    await seedRaw(page, raw);
    await page.goto('/');
    await waitFinance(page);
    const res = await page.evaluate(() => ({ ret: window.finInputChange('russia','rent',0) }));
    expect(res.ret && res.ret.ok).toBe(true);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent).toBe(0);
    expect(after.rootExtra).toBe('ROOTKEEP');
    expect(after.russia.phaseExtra).toBe('PHASEKEEP');
  });
});

// ── B03 — refused draft later erased by ordinary render (P1) ──
test.describe('S1a Round-2 — B03 retained drafts survive render', () => {

  test('B03-custom-draft-survives-add: a refused custom name draft is not erased by a later successful Add', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.waitForSelector('.mc-row[data-id="c1"] .mc-name');
    await armFault(page, { setNoop: true });
    await page.locator('.mc-row[data-id="c1"] .mc-name').fill('NEW TYPED DRAFT');
    const w = await faultWitness(page);
    expect(w.setNoop).toBeGreaterThan(0);
    expect(await page.locator('.mc-row[data-id="c1"] .mc-name').inputValue()).toBe('NEW TYPED DRAFT');
    await armFault(page, {});
    await page.locator('#mc-host [data-add="income"]').click();
    // after a successful add + render, the newer refused intent must survive.
    await expect(page.locator('.mc-row[data-id="c1"] .mc-name')).toHaveValue('NEW TYPED DRAFT');
  });

  test('B03-scalar-draft-survives-recompute: a refused scalar draft is not erased by finRecompute', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop: true });
    await page.locator('#fin-r-rent').fill('31000');
    // money-commas.js formats the DISPLAY with thousands separators; storage is
    // raw. Normalize the comma so the oracle is on numeric intent, not display.
    expect((await page.locator('#fin-r-rent').inputValue()).replace(/,/g,'')).toBe('31000');
    await armFault(page, {});
    await page.evaluate(() => window.finRecompute && window.finRecompute());
    expect((await page.locator('#fin-r-rent').inputValue()).replace(/,/g,''), 'refused scalar draft must survive recompute').toBe('31000');
  });
});

// ── B04 — Save-on-device truthfulness (P1) ──
test.describe('S1a Round-2 — B04 truthful Save on this device', () => {

  test('B04-save-commits-retained-intent: Save submits the visible refused edit and only then claims saved', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop: true });
    await page.locator('#fin-r-rent').fill('31000');   // refused → draft retained
    await armFault(page, {});                          // fault cleared
    const res = await page.evaluate(() => window.saveFinanceNow());
    const after = JSON.parse(await readFinanceRaw(page));
    expect(res && res.ok).toBe(true);
    expect(after.russia.rent, 'Save must actually persist the visible intent').toBe(31000);
    expect((await toastText(page)).toLowerCase()).toContain('saved');
  });

  test('B04-save-refuses-under-fault: Save must not claim saved while the write still fails', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop: true });
    await page.locator('#fin-r-rent').fill('31000');
    const res = await page.evaluate(() => window.saveFinanceNow()); // fault still armed
    expect(res && res.ok).not.toBe(true);
    await armFault(page, {});
    const after = await readFinanceRaw(page);
    expect(after).toContain('26000');       // durable unchanged
    expect(after).not.toContain('31000');
    expect((await toastText(page)).toLowerCase()).not.toContain('saved on this device');
  });
});

// ── B05 — post-write uncertainty must not be mislabeled unchanged (P1) ──
test.describe('S1a Round-2 — B05 post-write uncertainty', () => {

  for (const mode of ['readbackThrow','readbackDifferent']) {
    test(`B05-${mode}: a successful native write with failed readback is POST_WRITE_UNCERTAIN, never "unchanged"`, async ({ page }) => {
      await installStorageFaults(page);
      await seedRaw(page, RICH);
      await page.goto('/');
      await waitFinance(page);
      const shadowBefore = await shadowRent(page);
      await armFault(page, { [mode]: true });
      const res = await page.evaluate(() => { try { return { ret: window.finInputChange('russia','rent',31000) }; } catch(e){ return { threw:String(e) }; } });
      const w = await faultWitness(page);
      expect(w[mode], 'the readback fault must actually fire').toBeGreaterThan(0);
      expect(res.ret && res.ret.ok).not.toBe(true);
      expect(res.ret && res.ret.outcome, 'must be flagged uncertain, not unchanged/refused-pre-write').toBe('POST_WRITE_UNCERTAIN');
      // no false shadow publication
      const shadowAfter = await shadowRent(page);
      expect(shadowAfter).not.toBe(31000);
      expect(shadowAfter).toBe(shadowBefore);
      // truthful copy: must not claim nothing was overwritten
      expect((await toastText(page)).toLowerCase()).not.toContain('nothing was overwritten');
      // durable independently inspected after disarm: the write DID land (31000)
      await armFault(page, {});
      const after = await readFinanceRaw(page);
      expect(after).toContain('31000');
    });
  }
});

// ── B06 — degraded custom fallback must not falsely acknowledge (P1) ──
test.describe('S1a Round-2 — B06 degraded fallback truthfulness', () => {

  test('B06-fallback-dropped-write: with app hooks removed, a dropped fallback write must not return ok', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    const res = await page.evaluate(() => {
      // Remove the app.js hooks so money-custom uses its OWN fallback writer.
      delete window.finReadAuthority;
      delete window.finSaveInputs;
      window.__faults.mode = { setNoop: true };
      window.__faults.dirty = false;
      try { return { ret: window.MONEY_CUSTOM.addRow('income') }; }
      catch(e){ return { threw: String(e) }; }
    });
    const w = await faultWitness(page);
    expect(w.setNoop, 'the dropped-write fault must actually fire').toBeGreaterThan(0);
    expect(res.ret && res.ret.ok, 'fallback must not acknowledge a dropped write as saved').not.toBe(true);
    await armFault(page, {});
    const after = await readFinanceRaw(page);
    // durable bytes byte-identical to the seed (no row stored).
    expect(after).toBe(RICH);
  });
});

// ── HEALTHY CONTROLS — must PASS on baseline AND after fix (no regression) ──
test.describe('S1a — healthy Finance controls (no regression)', () => {

  test('HEALTHY-edit-reload: normal edit persists and survives reload', async ({ page }) => {
    await installStorageFaults(page);
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    const r = await page.evaluate(() => window.finInputChange('russia','rent', 27777));
    if (r !== undefined) expect(r && r.ok !== false).toBeTruthy();
    let after = await readFinanceRaw(page);
    expect(after).toContain('27777');
    expect(after).toContain('KEEPME');
    expect(after).toContain('c_seed1');
    expect(after).toContain('424242');
    await page.reload(); await waitFinance(page);
    after = await readFinanceRaw(page);
    expect(after).toContain('27777');
  });

  test('HEALTHY-absent-firstedit: genuine absence + edit writes a fresh default+field', async ({ page }) => {
    await installStorageFaults(page);
    await page.goto('/');
    await waitFinance(page);
    const r = await page.evaluate(() => window.finInputChange('russia','rent', 25000));
    if (r !== undefined) expect(r && r.ok !== false).toBeTruthy();
    const after = await readFinanceRaw(page);
    expect(after).toContain('25000');
  });

  test('HEALTHY-scenario: setFinScenario preserves unknown fields + custom rows', async ({ page }) => {
    await installStorageFaults(page);
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    await page.evaluate(() => window.setFinScenario('realistic'));
    const after = await readFinanceRaw(page);
    expect(after).toContain('KEEPME');
    expect(after).toContain('c_seed1');
  });

  test('HEALTHY-sequential: sequential edits + custom zero + save persist and reload', async ({ page }) => {
    await installStorageFaults(page);
    await seedRaw(page, RICH);
    await page.goto('/');
    await waitFinance(page);
    const d = await page.evaluate(() => ({
      a: window.finInputChange('russia','rent',27777),
      b: window.finInputChange('russia','food',0),
      c: window.MONEY_CUSTOM.updateRow('income','c1',{amount:0}),
      s: window.saveFinanceNow()
    }));
    expect(d.a.ok).toBe(true);
    expect(d.b.ok).toBe(true);
    expect(d.c.ok).toBe(true);
    await page.reload(); await waitFinance(page);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent).toBe(27777);
    expect(after.russia.food).toBe(0);
    expect(after.rootExtra).toBe('ROOTKEEP');   // unknown preserved
    expect(after.russia.customIncome.find(r => r.id === 'c1').amount).toBe(0);
    expect(after.russia.customIncome.find(r => r.id === 'c1').rowExtra).toBe('ROWKEEP'); // row unknown preserved
  });
});
