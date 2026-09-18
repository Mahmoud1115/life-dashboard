// S1a Finance Round-3 certification + Round-2 regressions (hardened).
//
// Bounded claim (owner auth 106): every ordinary Finance mutation/seed/public
// merge/Save classifies root, admits the authoritative source structures it
// consumes (root+phase+collections+every row), admits the submitted target,
// builds a preservation-aware result, re-admits it, commits with readback
// proof, and verifies the intended semantic result (scalar field AND selected
// row). Row identity is unambiguous or the mutation refuses; drafts bind to
// kind+row-selection+field; Save aggregates scalar+custom intent truthfully;
// custom UI copy derives from the receipt outcome; matching-row unknown fields
// are preserved; a verified Save reconciles the mapped Store shadow. F11 /
// cross-tab / source-movement remains OUT.
//
// Harness discipline (auth 106 §9): prototype-level faults with POSITIVE hit
// witnesses; durable bytes read through the REAL getter; STRUCTURED refusal
// receipts required (never undefined/thrown as acceptable refusal); shadow
// oracle requires Store; native-UI selectors + selected-row + draft-registry +
// visible-DOM oracles. workers=1, retries=0, fresh dedicated server.
// Every R3 case discriminates against the frozen Round-2 unsafe control.

const { test, expect } = require('@playwright/test');

const FIN = 'dune_finance_v1';
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

async function installStorageFaults(page){
  await page.addInitScript(() => {
    const proto = Object.getPrototypeOf(window.localStorage);
    const realGet = proto.getItem, realSet = proto.setItem;
    const w = { getThrow:0, setThrow:0, setNoop:0, getMalformed:0, readbackThrow:0, readbackMalformed:0, readbackDifferent:0 };
    window.__faults = { mode:{}, witness:w, dirty:false };
    window.__realGet = realGet; window.__realSet = realSet;
    proto.getItem = function(k){
      if (k === 'dune_finance_v1'){
        const f = window.__faults, m = f.mode;
        if (m.getThrow){ w.getThrow++; throw new DOMException('SecurityError','SecurityError'); }
        if (m.getMalformed){ w.getMalformed++; return '{not-json'; }
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
        if (m.setNoop){ w.setNoop++; return; }
      }
      return realSet.call(this, k, v);
    };
  });
}
async function seedRaw(page, raw){
  await page.addInitScript((raw) => {
    const g = window.__realGet || Object.getPrototypeOf(window.localStorage).getItem;
    const s = window.__realSet || Object.getPrototypeOf(window.localStorage).setItem;
    if (g.call(window.localStorage, 'dune_finance_v1') !== null) return;
    if (raw !== null) s.call(window.localStorage, 'dune_finance_v1', raw);
  }, raw);
}
async function waitFinance(page){
  await page.waitForFunction(() => typeof window.finInputChange === 'function'
    && typeof window.finGetInputs === 'function'
    && typeof window.finSaveInputs === 'function'
    && !!window.MONEY_CUSTOM
    && !!(window.Store && typeof window.Store.get === 'function')
    && !!window.finDrafts, {}, { timeout: 15000 });
}
function readFinanceRaw(page){
  return page.evaluate(() => {
    try { const g = window.__realGet || Object.getPrototypeOf(window.localStorage).getItem; return g.call(window.localStorage, 'dune_finance_v1'); }
    catch(e){ return '__READ_THREW__'; }
  });
}
async function independentRead(context){
  const base = await context.pages()[0].evaluate(() => location.origin);
  const p = await context.newPage();
  await p.route('**/__r3reader__', route => route.fulfill({ status:200, contentType:'text/html', body:'<!doctype html><title>reader</title>' }));
  await p.route('**/*', route => { const u = route.request().url(); return (u.startsWith(base)) ? route.continue() : route.abort(); });
  await p.goto(base + '/__r3reader__');
  const raw = await p.evaluate(() => localStorage.getItem('dune_finance_v1'));
  await p.close();
  return raw;
}
async function armFault(page, mode){ await page.evaluate((m)=>{ window.__faults.mode = m; window.__faults.dirty = false; }, mode); }
async function faultWitness(page){ return page.evaluate(() => window.__faults.witness); }
async function toastText(page){ return page.evaluate(() => (document.getElementById('backup-toast')||{}).textContent || ''); }
async function shadowRent(page){ return page.evaluate(() => window.Store.get('money.expenses.rent') ?? null); }

// Structured-refusal oracle (auth 106 §9): the return must be a plain object
// (not undefined, not a thrown string) whose ok is not true; optionally the
// outcome must be one of the expected set. No conditional skip.
function expectRefused(ret, outcomes){
  expect(ret && typeof ret === 'object' && !ret.threw, 'must return a structured receipt, not throw/undefined').toBeTruthy();
  expect(ret.ok, 'must not report ok').not.toBe(true);
  if (outcomes) expect(outcomes, 'refusal outcome must be one of '+outcomes.join('/')).toContain(ret.outcome);
}
async function call(page, fn){
  return page.evaluate(new Function('return (async()=>{ try { return await ('+fn+')(); } catch(e){ return { threw:String(e && e.message || e) }; } })()'));
}

// ── F02 calibration (hardened; structured receipts) ──
test.describe('S1a — F02 failed-read destructive overwrite', () => {
  test('CAL-F02-readfail: thrown read + edit preserves durable key', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const before = await readFinanceRaw(page); expect(before).toContain('424242'); expect(before).toContain('ROWKEEP');
    await armFault(page, { getThrow:true });
    const ret = await call(page, "()=>window.finInputChange('russia','rent',31000)");
    expect((await faultWitness(page)).getThrow).toBeGreaterThan(0);
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    await armFault(page, {});
    const after = await readFinanceRaw(page);
    expect(after).toContain('424242'); expect(after).toContain('c1'); expect(after).toContain('ROWKEEP');
  });
  test('CAL-F02-writenoop: dropped write is not saved and nothing overwritten', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await armFault(page, { setNoop:true });
    const ret = await call(page, "()=>window.finInputChange('russia','rent',31000)");
    expect((await faultWitness(page)).setNoop).toBeGreaterThan(0);
    expectRefused(ret, ['REFUSED_PRE_WRITE']);
    await armFault(page, {});
    const after = await readFinanceRaw(page); expect(after).toContain('26000'); expect(after).not.toContain('31000');
  });
  test('SHADOW-F02: refused edit publishes no Store shadow', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const before = await shadowRent(page);
    await armFault(page, { getThrow:true });
    await call(page, "()=>window.finInputChange('russia','rent',999999)");
    expect((await faultWitness(page)).getThrow).toBeGreaterThan(0);
    await armFault(page, {});
    expect(await shadowRent(page)).toBe(before); expect(await shadowRent(page)).not.toBe(999999);
  });
});

// ── A. source/target/result admission (R3-P1-01) ──
test.describe('S1a R3 — A source/target/result admission', () => {
  for (const [label, raw] of [['phase-array','{"russia":[]}'],['phase-null','{"russia":null}'],['phase-string','{"russia":"BAD"}']]) {
    test('A-src-'+label+'-partial-public: malformed source phase + partial target refuses, bytes unchanged', async ({ page }) => {
      await installStorageFaults(page); await seedRaw(page, raw); await page.goto('/'); await waitFinance(page);
      const ret = await call(page, "()=>window.finSaveInputs({russia:{rent:31000}})");
      expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
      expect(await readFinanceRaw(page)).toBe(raw);
    });
    test('A-src-'+label+'-empty-public: malformed source phase + empty target refuses, bytes unchanged', async ({ page }) => {
      await installStorageFaults(page); await seedRaw(page, raw); await page.goto('/'); await waitFinance(page);
      const ret = await call(page, "()=>window.finSaveInputs({})");
      expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
      expect(await readFinanceRaw(page)).toBe(raw);
    });
  }
  const BADCOLL = '{"rootExtra":"ROOTKEEP","russia":{"salary":424242,"customIncome":"MALFORMED_ROWS","customExpenses":[],"customSeeded":true}}';
  test('A-badcoll-scalar: malformed source collection refuses a scalar edit, evidence preserved', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, BADCOLL); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finInputChange('russia','rent',31000)");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    expect(await readFinanceRaw(page)).toContain('MALFORMED_ROWS');
  });
  test('A-badcoll-scenario: malformed source collection refuses a scenario, evidence preserved', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, BADCOLL); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.setFinScenario('realistic')");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    expect(await readFinanceRaw(page)).toContain('MALFORMED_ROWS');
  });
  test('A-badcoll-save: malformed source collection refuses Save, evidence preserved', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, BADCOLL); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    expect(await readFinanceRaw(page)).toContain('MALFORMED_ROWS');
  });
  test('A-healthy-partial-public: supported partial preserves extras and applies intent', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finSaveInputs({russia:{rent:31000}})");
    expect(ret.ok).toBe(true);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent).toBe(31000); expect(after.russia.salary).toBe(424242);
    expect(after.rootExtra).toBe('ROOTKEEP');
    expect(after.russia.customIncome.find(r=>r.id==='c1').rowExtra).toBe('ROWKEEP');
  });
  test('A-healthy-zero-unknown: zero/empty/unknown controls admitted and preserved', async ({ page }) => {
    const raw = JSON.stringify({ rootExtra:'ROOTKEEP', russia:{ customIncome:[], customExpenses:[], customSeeded:true, phaseExtra:'PHASEKEEP' } });
    await installStorageFaults(page); await seedRaw(page, raw); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finInputChange('russia','rent',0)");
    expect(ret.ok).toBe(true);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent).toBe(0); expect(after.rootExtra).toBe('ROOTKEEP'); expect(after.russia.phaseExtra).toBe('PHASEKEEP');
  });
});

// ── B. row-element admission (R3-P1-02) ──
test.describe('S1a R3 — B row-element admission', () => {
  const bads = [['null','null'],['number','123'],['string','"x"'],['array','[]'],['object','{}']];
  for (const [label, badJson] of bads) {
    for (const [op, expr] of [
      ['scalar', "()=>window.finInputChange('russia','rent',31000)"],
      ['add',    "()=>window.MONEY_CUSTOM.addRow('income')"],
      ['update', "()=>window.MONEY_CUSTOM.updateRow('income','c1',{name:'UPDATED'})"],
      ['remove', "()=>window.MONEY_CUSTOM.removeRow('income','c1')"],
      ['public', "()=>window.finSaveInputs({russia:{rent:31000}})"],
      ['save',   "()=>window.saveFinanceNow()"],
    ]) {
      test('B-'+label+'-'+op+': malformed row element fails closed, evidence preserved, no crash', async ({ page }) => {
        const errs = []; page.on('pageerror', e => errs.push(e.message));
        const seed = '{"rootExtra":"ROOTKEEP","russia":{"salary":424242,"customIncome":['+badJson+',{"id":"c1","name":"Old name","amount":33333,"rowExtra":"ROWKEEP"}],"customExpenses":[],"customSeeded":true}}';
        await installStorageFaults(page); await seedRaw(page, seed); await page.goto('/'); await waitFinance(page);
        await page.evaluate(() => window.show && window.show('finance'));
        const ret = await call(page, expr);
        expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
        const after = await readFinanceRaw(page);
        // malformed element evidence preserved (not normalized/deleted/committed)
        expect(JSON.parse(after).russia.customIncome.length).toBe(2);
        expect(after).toContain('ROWKEEP'); expect(after).toContain('424242');
        expect(errs, 'render/op must not crash the page').toEqual([]);
      });
    }
  }
  test('B-startup-seed: malformed rows + customSeeded:false must NOT flip the marker', async ({ page }) => {
    const seed = '{"russia":{"customIncome":[123],"customExpenses":[],"customSeeded":false}}';
    await installStorageFaults(page); await seedRaw(page, seed); await page.goto('/'); await waitFinance(page);
    await page.waitForTimeout(200);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.customSeeded, 'startup seed must fail closed on malformed rows').toBe(false);
    expect(after.russia.customIncome).toEqual([123]);
  });
  test('B-mixed-healthy-update-still-refuses: a malformed neighbour fails the whole mutation closed', async ({ page }) => {
    const seed = '{"russia":{"salary":1,"customIncome":[null,{"id":"c1","name":"Old","amount":5}],"customExpenses":[],"customSeeded":true}}';
    await installStorageFaults(page); await seedRaw(page, seed); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.MONEY_CUSTOM.updateRow('income','c1',{name:'X'})");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    expect(JSON.parse(await readFinanceRaw(page)).russia.customIncome[1].name).toBe('Old');
  });
});

// ── C. identity (R3-P1-03) native UI ──
test.describe('S1a R3 — C row identity', () => {
  const DUP = JSON.stringify({ russia:{ salary:1, customIncome:[
    {id:'dup',name:'FIRST',amount:111,rowExtra:'FIRSTKEEP'},
    {id:'dup',name:'SECOND',amount:222,rowExtra:'SECONDKEEP'},
    {id:'c2',name:'NEIGHBOR',amount:333}
  ], customExpenses:[], customSeeded:true } });
  test('C-dup-remove-native: second-duplicate Remove deletes NO row (ambiguous refused)', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, DUP); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.locator('.mc-row[data-kind="income"] .mc-rm').nth(1).click();
    await page.waitForTimeout(60);
    const coll = JSON.parse(await readFinanceRaw(page)).russia.customIncome;
    expect(coll.filter(r=>r.id==='dup').length, 'both duplicate rows must survive').toBe(2);
    expect(coll.find(r=>r.id==='c2')).toBeTruthy();
    // must not falsely claim success ("Not saved" legitimately contains 'saved')
    expect((await toastText(page)).toLowerCase()).not.toContain('saved on this device');
  });
  test('C-dup-edit-native: editing the second duplicate does NOT modify the first durable row', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, DUP); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.locator('.mc-row[data-kind="income"] .mc-name').nth(1).fill('EDIT SECOND');
    await page.waitForTimeout(60);
    const coll = JSON.parse(await readFinanceRaw(page)).russia.customIncome;
    expect(coll[0].name).toBe('FIRST'); expect(coll[1].name).toBe('SECOND'); // neither durable row wrongly edited
  });
});

// ── D. draft binding (R3-P1-04) native UI ──
test.describe('S1a R3 — D draft binding', () => {
  const CROSS = JSON.stringify({ russia:{ salary:1,
    customIncome:[{id:'c1',name:'Income old',amount:5}],
    customExpenses:[{id:'c1',name:'Expense old',amount:9}], customSeeded:true } });
  test('D-cross-kind: refused expense draft binds to expense only, never income', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, CROSS); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.waitForSelector('.mc-row[data-kind="expense"][data-id="c1"] .mc-name');
    await armFault(page, { setNoop:true });
    await page.locator('.mc-row[data-kind="expense"][data-id="c1"] .mc-name').fill('EXPENSE DRAFT');
    expect((await faultWitness(page)).setNoop).toBeGreaterThan(0);
    await armFault(page, {});
    await page.evaluate(() => window.MONEY_CUSTOM.render());
    await expect(page.locator('.mc-row[data-kind="expense"][data-id="c1"] .mc-name')).toHaveValue('EXPENSE DRAFT');
    await expect(page.locator('.mc-row[data-kind="income"][data-id="c1"] .mc-name'), 'income c1 must be untouched').toHaveValue('Income old');
  });
});

// ── E. Save aggregation (R3-P1-05) ──
test.describe('S1a R3 — E Save aggregation', () => {
  test('E-custom-only: Save submits a retained custom draft and only then claims saved', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.waitForSelector('.mc-row[data-id="c1"] .mc-name');
    await armFault(page, { setNoop:true });
    await page.locator('.mc-row[data-id="c1"] .mc-name').fill('NEW CUSTOM INTENT');
    await armFault(page, {});
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expect(ret.ok).toBe(true);
    const coll = JSON.parse(await readFinanceRaw(page)).russia.customIncome;
    expect(coll.find(r=>r.id==='c1').name, 'Save must persist the retained custom intent').toBe('NEW CUSTOM INTENT');
    expect((await toastText(page)).toLowerCase()).toContain('saved');
    const pending = await page.evaluate(() => window.finDrafts.entries().length);
    expect(pending, 'the submitted custom draft must be cleared').toBe(0);
  });
  test('E-scalar-plus-custom: both are submitted and verified', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop:true });
    await page.locator('#fin-r-rent').fill('31000');
    await page.locator('.mc-row[data-id="c1"] .mc-amount').fill('44444');
    await armFault(page, {});
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expect(ret.ok).toBe(true);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent).toBe(31000);
    expect(after.russia.customIncome.find(r=>r.id==='c1').amount).toBe(44444);
  });
  test('E-unresolved-scoped: an ambiguous custom draft is truthfully scoped, not claimed saved', async ({ page }) => {
    const DUP = JSON.stringify({ russia:{ salary:1, customIncome:[{id:'dup',name:'A',amount:1},{id:'dup',name:'B',amount:2}], customExpenses:[], customSeeded:true } });
    await installStorageFaults(page); await seedRaw(page, DUP); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.locator('.mc-row[data-kind="income"] .mc-name').nth(1).fill('AMBIG DRAFT'); // ambiguous -> refused + retained
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expect(ret.ok).toBe(true);
    expect(ret.unresolvedCustom).toBeGreaterThan(0);
    const toast = (await toastText(page)).toLowerCase();
    expect(toast).toContain('pending');
    // durable duplicate rows unchanged (ambiguous never written)
    const coll = JSON.parse(await readFinanceRaw(page)).russia.customIncome;
    expect(coll[0].name).toBe('A'); expect(coll[1].name).toBe('B');
  });
  test('E-save-refuses-under-fault: Save does not claim saved while writes fail', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop:true });
    await page.locator('#fin-r-rent').fill('31000');
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expectRefused(ret, ['REFUSED_PRE_WRITE','POST_WRITE_UNCERTAIN','UNSAFE_AUTHORITY_REFUSAL']);
    await armFault(page, {});
    expect(await readFinanceRaw(page)).toContain('26000');
    expect((await toastText(page)).toLowerCase()).not.toContain('saved on this device');
  });
});

// ── F. custom uncertainty copy (R3-P1-06) ──
test.describe('S1a R3 — F custom post-write uncertainty', () => {
  for (const mode of ['readbackThrow','readbackDifferent']) {
    test('F-'+mode+': landed custom write with failed readback is uncertain, never "nothing changed"', async ({ page }) => {
      await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
      await armFault(page, { [mode]:true });
      const ret = await call(page, "()=>window.MONEY_CUSTOM.updateRow('income','c1',{name:'LANDED NEW'})");
      expect((await faultWitness(page))[mode]).toBeGreaterThan(0);
      expectRefused(ret, ['POST_WRITE_UNCERTAIN']);
      const toast = (await toastText(page)).toLowerCase();
      expect(toast).toContain('uncertain'); expect(toast).not.toContain('nothing was changed');
      await armFault(page, {});
      expect(await readFinanceRaw(page)).toContain('LANDED NEW'); // it did land
    });
  }
  test('F-setnoop-refused-pre-write: dropped custom write reports refusal with unchanged bytes', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await armFault(page, { setNoop:true });
    const ret = await call(page, "()=>window.MONEY_CUSTOM.updateRow('income','c1',{name:'DROPPED'})");
    expect((await faultWitness(page)).setNoop).toBeGreaterThan(0);
    expectRefused(ret, ['REFUSED_PRE_WRITE']);
    await armFault(page, {});
    expect(await readFinanceRaw(page)).not.toContain('DROPPED');
  });
});

// ── G. matching-row unknown-field preservation (R3-P1-07) ──
test.describe('S1a R3 — G matching-row preservation', () => {
  test('G-rowextra-preserved: same ids/order, changed name, omitted unknown field survives', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finSaveInputs({russia:{customIncome:[{id:'c1',name:'Changed',amount:33333},{id:'c2',name:'Second',amount:0}]}})");
    expect(ret.ok).toBe(true);
    const inc = JSON.parse(await readFinanceRaw(page)).russia.customIncome;
    const c1 = inc.find(r=>r.id==='c1');
    expect(c1.name).toBe('Changed');
    expect(c1.rowExtra, 'unknown matching-row field must be preserved').toBe('ROWKEEP');
    expect(inc.find(r=>r.id==='c2')).toBeTruthy(); // unrelated row not dropped
  });
});

// ── H. verified Save → shadow reconciliation (R3-P1-08) ──
test.describe('S1a R3 — H Save/shadow reconciliation', () => {
  test('H-verified-save-reconciles-shadow: subscription cannot replay pre-Save value', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop:true });
    await page.locator('#fin-r-rent').fill('31000');
    await armFault(page, {});
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expect(ret.ok).toBe(true);
    expect(JSON.parse(await readFinanceRaw(page)).russia.rent).toBe(31000);
    expect(await shadowRent(page), 'shadow reconciled to committed value').toBe(31000);
    // an unrelated money update fires the subscription; the committed rent must stand
    await page.evaluate(() => window.Store.set('money.expenses.food', 42));
    await page.waitForTimeout(120);
    expect((await page.locator('#fin-r-rent').inputValue()).replace(/,/g,'')).toBe('31000');
  });
  test('H-refused-save-no-shadow: a refused Save fabricates no shadow', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    const before = await shadowRent(page);
    await armFault(page, { setNoop:true });
    await page.locator('#fin-r-rent').fill('31000');
    await call(page, "()=>window.saveFinanceNow()");
    await armFault(page, {});
    expect(await shadowRent(page)).toBe(before);
  });
});

// ── Healthy controls (no regression) ──
test.describe('S1a — healthy controls', () => {
  test('HEALTHY-edit-reload', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const r = await call(page, "()=>window.finInputChange('russia','rent',27777)");
    expect(r.ok).toBe(true);
    let after = await readFinanceRaw(page);
    expect(after).toContain('27777'); expect(after).toContain('ROWKEEP'); expect(after).toContain('424242');
    await page.reload(); await waitFinance(page);
    expect(await readFinanceRaw(page)).toContain('27777');
  });
  test('HEALTHY-absent-firstedit: proven ABSENT immediately before edit', async ({ page }) => {
    await installStorageFaults(page); await page.goto('/'); await waitFinance(page);
    const auth = await page.evaluate(() => { try { localStorage.removeItem('dune_finance_v1'); } catch(e){} return window.finReadAuthority().state; });
    expect(auth, 'must be ABSENT at the edit point').toBe('ABSENT');
    const r = await call(page, "()=>window.finInputChange('russia','rent',25000)");
    expect(r.ok).toBe(true);
    expect(await readFinanceRaw(page)).toContain('25000');
  });
  test('HEALTHY-scenario preserves unknown fields + rows', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const r = await call(page, "()=>window.setFinScenario('realistic')");
    expect(r.ok).toBe(true);
    const after = await readFinanceRaw(page);
    expect(after).toContain('ROOTKEEP'); expect(after).toContain('ROWKEEP'); expect(after).toContain('c1');
  });
  test('HEALTHY-sequential custom zero + save + reload preserves unknown row fields', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    const a = await call(page, "()=>window.finInputChange('russia','rent',27777)"); expect(a.ok).toBe(true);
    const b = await call(page, "()=>window.MONEY_CUSTOM.updateRow('income','c1',{amount:0})"); expect(b.ok).toBe(true);
    const s = await call(page, "()=>window.saveFinanceNow()"); expect(s.ok).toBe(true);
    await page.reload(); await waitFinance(page);
    const after = JSON.parse(await readFinanceRaw(page));
    expect(after.russia.rent).toBe(27777);
    const c1 = after.russia.customIncome.find(r=>r.id==='c1');
    expect(c1.amount).toBe(0); expect(c1.rowExtra).toBe('ROWKEEP');
  });
  test('HEALTHY-custom-draft-survives-add', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.waitForSelector('.mc-row[data-id="c1"] .mc-name');
    await armFault(page, { setNoop:true });
    await page.locator('.mc-row[data-id="c1"] .mc-name').fill('KEPT DRAFT');
    await armFault(page, {});
    await page.locator('#mc-host [data-add="income"]').click();
    await expect(page.locator('.mc-row[data-id="c1"] .mc-name')).toHaveValue('KEPT DRAFT');
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// ROUND-4 discriminating regressions (owner auth 112 §2) — P1-01..P1-04.
// Hardened per Codex 109 §19: native Save, positive witnesses, exact bytes,
// actually-invoked independent fresh reader, structural draft movement,
// failed-shadow→subscriber, real app-hook-unavailable degraded mode.
// ═══════════════════════════════════════════════════════════════════════════

const DUP4 = JSON.stringify({ rootExtra:'ROOTKEEP', russia:{ salary:1,
  customIncome:[
    { id:'pre',  name:'PRE',   amount:10 },
    { id:'dup',  name:'FIRST', amount:111, rowExtra:'FIRSTKEEP' },
    { id:'dup',  name:'SECOND',amount:222, rowExtra:'SECONDKEEP' },
    { id:'tail', name:'TAIL',  amount:333, rowExtra:'TAILKEEP' }
  ], customExpenses:[], customSeeded:true } });

// ── R4 P1-01 — position-bound draft instability ──
test.describe('S1a R4 — P1-01 draft position instability', () => {
  test('P1-01-remove-preceding: draft on ambiguous row is NOT replayed onto another row after a preceding Remove', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, DUP4); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await page.waitForSelector('.mc-row[data-kind="income"] .mc-name');
    // type a refused draft into the SECOND duplicate (position-bound, ambiguous id)
    await armFault(page, { setNoop:true });
    await page.locator('.mc-row[data-kind="income"] .mc-name').nth(2).fill('SECOND NEWER DRAFT');
    await armFault(page, {});
    const draftsAfterType = await page.evaluate(() => window.finDrafts.entries().length);
    expect(draftsAfterType, 'ambiguous draft retained').toBeGreaterThan(0);
    // remove an unrelated preceding UNIQUE row (structural shift)
    await page.locator('.mc-row[data-id="pre"] .mc-rm').click();
    await page.waitForTimeout(80);
    // the newer intent must NOT appear on tail (the row now at the old position)
    const names = await page.evaluate(() => [...document.querySelectorAll('.mc-row[data-kind="income"] .mc-name')].map(n => n.value));
    expect(names, 'draft must not be replayed onto a different row').not.toContain('SECOND NEWER DRAFT');
    const tail = await page.locator('.mc-row[data-id="tail"] .mc-name').inputValue();
    expect(tail, 'tail must keep its durable name').toBe('TAIL');
    // canonical bytes unchanged (draft never committed) — independent fresh reader
    const durable = JSON.parse(await independentRead(page.context()));
    const inc = durable.russia.customIncome;
    expect(inc.find(r=>r.id==='dup'&&r.name==='FIRST')).toBeTruthy();
    expect(inc.find(r=>r.id==='dup'&&r.name==='SECOND')).toBeTruthy();
    expect(inc.find(r=>r.id==='tail'&&r.name==='TAIL')).toBeTruthy();
    // and the retained intent is still held (not silently discarded)
    expect(await page.evaluate(() => window.finDrafts.entries().length)).toBeGreaterThan(0);
  });

  test('P1-01-unique-draft-survives-preceding-remove: a UNIQUE-id draft stays on its own row', async ({ page }) => {
    const seed = JSON.stringify({ russia:{ salary:1, customIncome:[
      { id:'pre', name:'PRE', amount:1 }, { id:'u1', name:'U1', amount:2 }, { id:'u2', name:'U2', amount:3 }
    ], customExpenses:[], customSeeded:true } });
    await installStorageFaults(page); await seedRaw(page, seed); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop:true });
    await page.locator('.mc-row[data-id="u2"] .mc-name').fill('U2 DRAFT');
    await armFault(page, {});
    await page.locator('.mc-row[data-id="pre"] .mc-rm').click();
    await page.waitForTimeout(80);
    await expect(page.locator('.mc-row[data-id="u2"] .mc-name'), 'unique-id draft stays bound to its row').toHaveValue('U2 DRAFT');
  });
});

// ── R4 P1-02 — shadow publication failure / stale replay ──
test.describe('S1a R4 — P1-02 shadow failure stale replay', () => {
  async function armStoreFault(page, mode){
    await page.evaluate((mode) => {
      const orig = window.Store.set;
      window.__storeFault = { orig, hits:0, mode };
      window.Store.set = function(path, val){
        if (path === 'money.expenses.rent'){ window.__storeFault.hits++;
          if (mode === 'throw') throw new Error('synthetic Store refusal');
          if (mode === 'false') return { ok:false, reason:'synthetic-refusal' };
          if (mode === 'noop')  return { ok:true }; // pretends ok but does not persist
        }
        return orig.call(this, path, val);
      };
    }, mode);
  }
  async function disarmStoreFault(page){ await page.evaluate(() => { if (window.__storeFault) window.Store.set = window.__storeFault.orig; }); }

  for (const mode of ['false','throw','noop']) {
    test('P1-02-'+mode+': failed shadow publish must not let a stale shadow replay over verified canonical rent', async ({ page }) => {
      await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
      await page.evaluate(() => window.show && window.show('finance'));
      await armFault(page, { setNoop:true });
      await page.locator('#fin-r-rent').fill('31000');   // refused → scalar draft
      await armFault(page, {});
      await armStoreFault(page, mode);
      const ret = await call(page, "()=>window.saveFinanceNow()");
      expect(ret.ok, 'canonical Save must remain truthfully successful').toBe(true);
      expect(await page.evaluate(() => window.__storeFault.hits), 'shadow publish attempt must fire').toBeGreaterThan(0);
      expect(JSON.parse(await independentRead(page.context())).russia.rent, 'canonical committed').toBe(31000);
      // R4 mechanism: the projection guard must engage when the shadow publish failed.
      expect(await page.evaluate(() => !!(window.finProjection && window.finProjection.has('rent'))), 'projection guard must engage on failed shadow publish').toBe(true);
      await disarmStoreFault(page);
      // an unrelated ordinary money update fires the subscription with the stale shadow
      await page.evaluate(() => window.Store.set('money.expenses.food', 42));
      await page.waitForTimeout(120);
      expect((await page.locator('#fin-r-rent').inputValue()).replace(/,/g,''), 'stale shadow must not replay over verified canonical').toBe('31000');
    });
  }

  test('P1-02-coherence-clears-guard: once the shadow catches up, the guard releases', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop:true }); await page.locator('#fin-r-rent').fill('31000'); await armFault(page, {});
    await armStoreFault(page, 'false');
    await call(page, "()=>window.saveFinanceNow()");
    await disarmStoreFault(page);
    expect(await page.evaluate(() => window.finProjection.has('rent'))).toBe(true);
    // healthy path publishes coherent shadow, then an ordinary update clears the guard
    await page.evaluate(() => window.Store.set('money.expenses.rent', 31000));
    await page.evaluate(() => window.Store.set('money.expenses.food', 43));
    await page.waitForTimeout(120);
    expect(await page.evaluate(() => window.finProjection.has('rent')), 'guard cleared once coherent').toBe(false);
    expect((await page.locator('#fin-r-rent').inputValue()).replace(/,/g,'')).toBe('31000');
  });

  test('P1-02-zero-and-multi: zero and multiple mapped fields are guarded', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    await armFault(page, { setNoop:true });
    await page.locator('#fin-r-rent').fill('0');
    await page.locator('#fin-r-food').fill('12345');
    await armFault(page, {});
    // fail the rent shadow only
    await armStoreFault(page, 'false');
    const ret = await call(page, "()=>window.saveFinanceNow()");
    expect(ret.ok).toBe(true);
    await disarmStoreFault(page);
    await page.evaluate(() => window.Store.set('money.expenses.transport', 7));
    await page.waitForTimeout(120);
    expect((await page.locator('#fin-r-rent').inputValue()).replace(/,/g,'')).toBe('0');
    expect(JSON.parse(await independentRead(page.context())).russia.food).toBe(12345);
  });

  test('P1-02-refused-save-no-projection: a refused Save creates no guard/shadow', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    await page.evaluate(() => window.show && window.show('finance'));
    const before = await shadowRent(page);
    await armFault(page, { setNoop:true });
    await page.locator('#fin-r-rent').fill('31000');
    await call(page, "()=>window.saveFinanceNow()"); // fault still armed -> refused
    await armFault(page, {});
    expect(await shadowRent(page)).toBe(before);
    expect(await page.evaluate(() => window.finProjection.has('rent'))).toBe(false);
  });
});

// ── R4 P1-03 — degraded app-hook bypass ──
test.describe('S1a R4 — P1-03 degraded app-hook admission', () => {
  async function bootDegraded(page, seedJson){
    await page.addInitScript(() => {
      const g = Object.getPrototypeOf(window.localStorage).getItem;
      window.__realGet = g;
    });
    await page.route('**/app.js*', route => route.abort());
    await page.addInitScript((raw) => {
      const s = Object.getPrototypeOf(window.localStorage).setItem;
      s.call(window.localStorage, 'dune_finance_v1', raw);
    }, seedJson);
    await page.goto('/');
    await page.waitForFunction(() => !!window.MONEY_CUSTOM && typeof window.finAdmit === 'undefined' && typeof window.finSaveInputs === 'undefined');
    await page.waitForTimeout(150);
  }
  function degradeRead(page){ return page.evaluate(() => { try { return window.__realGet.call(window.localStorage,'dune_finance_v1'); } catch(e){ return '__THREW__'; } }); }

  test('P1-03-malformed-row-add: degraded Add over a malformed row must refuse, marker not advanced, bytes unchanged', async ({ page }) => {
    const seed = JSON.stringify({ russia:{ salary:1, customIncome:[null,{id:'c1',name:'Old',amount:5}], customExpenses:[], customSeeded:false } });
    await bootDegraded(page, seed);
    const ret = await call(page, "()=>window.MONEY_CUSTOM.addRow('expense')");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    const after = JSON.parse(await degradeRead(page));
    expect(after.russia.customSeeded, 'seed marker must not advance over malformed evidence').toBe(false);
    expect(after.russia.customIncome[0], 'malformed row preserved').toBe(null);
  });
  test('P1-03-malformed-collection-update: degraded update must refuse, bytes unchanged', async ({ page }) => {
    const seed = '{"russia":{"salary":1,"customIncome":"BAD","customExpenses":[],"customSeeded":false}}';
    await bootDegraded(page, seed);
    const ret = await call(page, "()=>window.MONEY_CUSTOM.updateRow('income','c1',{name:'NEW'})");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    expect(await degradeRead(page)).toBe(seed);
  });
  test('P1-03-healthy-degraded-add-verifies: a healthy degraded Add commits with local verification', async ({ page }) => {
    const seed = JSON.stringify({ russia:{ salary:1, customIncome:[{id:'c1',name:'Old',amount:5}], customExpenses:[], customSeeded:true } });
    await bootDegraded(page, seed);
    const ret = await call(page, "()=>window.MONEY_CUSTOM.addRow('income')");
    expect(ret.ok, 'healthy degraded add should still succeed via local admission').toBe(true);
    expect(JSON.parse(await degradeRead(page)).russia.customIncome.length).toBe(2);
  });
});

// ── R4 P1-04 — ambiguous public-row preservation ──
test.describe('S1a R4 — P1-04 public-row preservation', () => {
  test('P1-04-duplicate-refused: a duplicate-id public submission refuses, metadata not stripped', async ({ page }) => {
    const seed = JSON.stringify({ rootExtra:'ROOTKEEP', russia:{ salary:1, customIncome:[
      { id:'dup', name:'FIRST', amount:111, rowExtra:'FIRSTKEEP', nested:{a:[false,0,'']} },
      { id:'dup', name:'SECOND', amount:222, rowExtra:'SECONDKEEP' },
      { id:'tail', name:'TAIL', amount:333, rowExtra:'TAILKEEP' }
    ], customExpenses:[], customSeeded:true } });
    await installStorageFaults(page); await seedRaw(page, seed); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finSaveInputs({russia:{customIncome:[{id:'dup',name:'FIRST revised',amount:111},{id:'dup',name:'SECOND',amount:222},{id:'tail',name:'TAIL',amount:333}]}})");
    expectRefused(ret, ['UNSAFE_AUTHORITY_REFUSAL']);
    expect(ret.reason).toBe('ambiguous-row-correspondence');
    const after = await independentRead(page.context());
    expect(after).toContain('FIRSTKEEP'); expect(after).toContain('SECONDKEEP'); expect(after).toContain('TAILKEEP');
  });
  test('P1-04-prototype-own-props: own row fields named constructor/toString/hasOwnProperty are preserved', async ({ page }) => {
    const seed = JSON.stringify({ russia:{ salary:1, customIncome:[
      { id:'c1', name:'Old', amount:5, rowExtra:'ROWKEEP', constructor:'CONSTRUCTORKEEP', toString:'TOSTRINGKEEP', hasOwnProperty:'OWNKEEP' },
      { id:'c2', name:'Second', amount:0 }
    ], customExpenses:[], customSeeded:true } });
    await installStorageFaults(page); await seedRaw(page, seed); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finSaveInputs({russia:{customIncome:[{id:'c1',name:'Changed',amount:5},{id:'c2',name:'Second',amount:0}]}})");
    expect(ret.ok).toBe(true);
    const c1 = JSON.parse(await independentRead(page.context())).russia.customIncome.find(r=>r.id==='c1');
    expect(c1.name).toBe('Changed');
    expect(c1.constructor).toBe('CONSTRUCTORKEEP');
    expect(c1.toString).toBe('TOSTRINGKEEP');
    expect(c1.hasOwnProperty).toBe('OWNKEEP');
    expect(c1.rowExtra).toBe('ROWKEEP');
  });
  test('P1-04-unique-correspondence-preserves: unique-id submission still preserves metadata', async ({ page }) => {
    await installStorageFaults(page); await seedRaw(page, RICH); await page.goto('/'); await waitFinance(page);
    const ret = await call(page, "()=>window.finSaveInputs({russia:{customIncome:[{id:'c1',name:'Changed',amount:33333},{id:'c2',name:'Second',amount:0}]}})");
    expect(ret.ok).toBe(true);
    const c1 = JSON.parse(await independentRead(page.context())).russia.customIncome.find(r=>r.id==='c1');
    expect(c1.name).toBe('Changed'); expect(c1.rowExtra).toBe('ROWKEEP');
  });
});
