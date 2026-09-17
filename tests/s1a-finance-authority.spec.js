// S1a Track A proof fixtures + Track C certification for the Finance P0.
//
// Bounded claim under test (owner authorization §5.1):
//   A failed or malformed Finance authority read cannot authorize destructive
//   overwrite or false Store-shadow publication, while supported healthy
//   Finance edits retain intended data and provide truthful local feedback.
//
// Track A discipline (auth §3 / Codex 93 §11):
//   - Portable PROTOTYPE-level storage fault injection (NOT own-property
//     assignment, which is a no-op in WebKit — Codex F12). Every fault test
//     carries a POSITIVE HIT WITNESS.
//   - Byte oracle over dune_finance_v1 (+ Store money shadow where relevant).
//   - The F02 calibration MUST FAIL on the pristine baseline for the exact
//     destructive reason, and PASS only after the Track C fix.
//
// Chromium + WebKit. workers=1, retries=0.

const { test, expect } = require('@playwright/test');

const FIN = 'dune_finance_v1';

// Prototype-level fault injector installed before app scripts run. Faults are
// scoped to the Finance key and counted so tests can assert a positive hit.
async function installStorageFaults(page){
  await page.addInitScript(() => {
    const proto = Object.getPrototypeOf(window.localStorage);
    const realGet = proto.getItem;
    const realSet = proto.setItem;
    const w = { getThrow:0, setThrow:0, setNoop:0, getMalformed:0 };
    window.__faults = { mode:{}, witness:w };
    proto.getItem = function(k){
      if (k === 'dune_finance_v1'){
        const m = window.__faults.mode;
        if (m.getThrow){ w.getThrow++; throw new DOMException('SecurityError','SecurityError'); }
        if (m.getMalformed){ w.getMalformed++; return m.getMalformed === 'notjson' ? '{not-json' : '"a-plain-string"'; }
      }
      return realGet.call(this, k);
    };
    proto.setItem = function(k, v){
      if (k === 'dune_finance_v1'){
        const m = window.__faults.mode;
        if (m.setThrow){ w.setThrow++; throw new DOMException('QuotaExceededError','QuotaExceededError'); }
        if (m.setNoop){ w.setNoop++; return; } // silent no-op: value NOT written
      }
      return realSet.call(this, k, v);
    };
  });
}

// Seed a realistic Finance value with a custom row + a sentinel field, so we
// can detect destruction. Written with the REAL setItem before faults arm.
async function seedFinance(page){
  await page.addInitScript(() => {
    const realGet = Object.getPrototypeOf(window.localStorage).getItem;
    const real = Object.getPrototypeOf(window.localStorage).setItem;
    // Reload-idempotent: addInitScript re-runs on every navigation; only seed
    // when the key is genuinely absent so a reload does not clobber an edit.
    if (realGet.call(window.localStorage, 'dune_finance_v1') !== null) return;
    real.call(window.localStorage, 'dune_finance_v1', JSON.stringify({
      russia: {
        salary: 424242, rent: 26000, food: 16000, save_target: 55000,
        customIncome: [{ id:'c_seed1', name:'Side job', amount:33333 }],
        customExpenses: [], customSeeded: true,
        __sentinel: 'KEEPME'
      }
    }));
  });
}

async function waitFinance(page){
  await page.waitForFunction(() => typeof window.finInputChange === 'function' && typeof window.finGetInputs === 'function', {}, { timeout: 15000 });
}

function readFinanceRaw(page){
  return page.evaluate(() => {
    const real = Object.getPrototypeOf(window.localStorage).getItem;
    let raw; try { raw = real.call(window.localStorage, 'dune_finance_v1'); } catch(e){ raw = '__READ_THREW__'; }
    return raw;
  });
}

async function armFault(page, mode){
  await page.evaluate((m) => { window.__faults.mode = m; }, mode);
}
async function faultWitness(page){
  return page.evaluate(() => window.__faults.witness);
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

    // Arm a thrown read on the Finance key, then perform an ordinary edit.
    await armFault(page, { getThrow: true });
    const res = await page.evaluate(() => {
      try { return { ret: window.finInputChange('russia','rent',31000) }; }
      catch(e){ return { threw: String(e && e.message || e) }; }
    });
    const w = await faultWitness(page);
    // POSITIVE HIT WITNESS: the injected read fault actually fired.
    expect(w.getThrow).toBeGreaterThan(0);

    await armFault(page, {}); // disarm to read truth
    const after = await readFinanceRaw(page);

    // THE INVARIANT: the durable key must still hold the original data.
    // On baseline this FAILS (rent written onto D.finance default, sentinel + salary + custom row destroyed, "saved" shown).
    expect(after, 'durable Finance data must survive a failed read').toContain('KEEPME');
    expect(after).toContain('424242');
    expect(after).toContain('c_seed1');
    // And the write path must have reported refusal, not success.
    if (res && res.ret !== undefined) {
      expect(res.ret && res.ret.ok, 'finInputChange must not report ok on a failed authority read').not.toBe(true);
    }
  });

  test('CAL-F02-malformed: malformed stored Finance + edit must NOT overwrite', async ({ page }) => {
    // Durably store MALFORMED bytes on disk (the realistic corruption case),
    // then edit. The authority read must classify MALFORMED and refuse,
    // preserving the malformed bytes as evidence rather than minting a default.
    await installStorageFaults(page);
    await page.addInitScript(() => {
      const realGet = Object.getPrototypeOf(window.localStorage).getItem;
      const realSet = Object.getPrototypeOf(window.localStorage).setItem;
      if (realGet.call(window.localStorage, 'dune_finance_v1') !== null) return;
      realSet.call(window.localStorage, 'dune_finance_v1', '{not-json-MALFORMED-SENTINEL');
    });
    await page.goto('/');
    await waitFinance(page);
    const before = await readFinanceRaw(page);
    expect(before).toContain('MALFORMED-SENTINEL');
    const res = await page.evaluate(() => { try { return { ret: window.finInputChange('russia','rent',31000) }; } catch(e){ return { threw:String(e) }; } });
    const after = await readFinanceRaw(page);
    // Malformed durable bytes preserved as evidence, not overwritten by a default.
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
  });

  test('SHADOW-F02: a refused Finance edit must NOT publish a Store money shadow', async ({ page }) => {
    await installStorageFaults(page);
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    await page.waitForFunction(() => !!(window.Store && typeof window.Store.get === 'function'));
    const shadowBefore = await page.evaluate(() => (window.Store && window.Store.get('money.expenses.rent')) ?? null);
    await armFault(page, { getThrow: true });
    await page.evaluate(() => { try { window.finInputChange('russia','rent', 999999); } catch(e){} });
    const w = await faultWitness(page);
    expect(w.getThrow).toBeGreaterThan(0);
    await armFault(page, {});
    const shadowAfter = await page.evaluate(() => (window.Store && window.Store.get('money.expenses.rent')) ?? null);
    // The fabricated 999999 must NOT have been published to the Store shadow.
    expect(shadowAfter).not.toBe(999999);
    expect(shadowAfter).toBe(shadowBefore);
  });
});

// ── HEALTHY CONTROLS — must PASS on baseline AND after fix (no regression) ──
test.describe('S1a — healthy Finance controls (no regression)', () => {

  test('HEALTHY-edit-reload: normal edit persists and survives reload', async ({ page }) => {
    await installStorageFaults(page); // installed but not armed
    await seedFinance(page);
    await page.goto('/');
    await waitFinance(page);
    const r = await page.evaluate(() => window.finInputChange('russia','rent', 27777));
    if (r !== undefined) expect(r && r.ok !== false).toBeTruthy();
    let after = await readFinanceRaw(page);
    expect(after).toContain('27777');
    expect(after).toContain('KEEPME');   // unknown field preserved
    expect(after).toContain('c_seed1');  // custom row preserved
    expect(after).toContain('424242');   // untouched salary preserved
    await page.reload(); await waitFinance(page);
    after = await readFinanceRaw(page);
    expect(after).toContain('27777');
  });

  test('HEALTHY-absent-firstedit: genuine absence + edit writes a fresh default+field', async ({ page }) => {
    await installStorageFaults(page); // not armed; key genuinely absent (no seed)
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
});
