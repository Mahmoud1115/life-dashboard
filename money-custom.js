// ============================================================
// DUNE LIFE OS — MONEY · Custom Income / Expense rows
// Lives inside the existing dune_finance_v1 store under
// russia.customIncome[] and russia.customExpenses[].
// app.js's calcRussia() sums these into gross/expenses so the
// existing breakdown updates with no further wiring.
// ============================================================

(function (global) {
  'use strict';

  function injectStyles() {
    if (document.getElementById('money-custom-styles')) return;
    const css = `
.mc-block {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--bdr);
}
.mc-block-hd {
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 10px; gap: 10px;
}
.mc-block-title {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3);
}
.mc-add {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.1px; text-transform: uppercase;
  background: transparent; color: var(--gold2);
  border: 1px solid rgba(154,120,50,0.30);
  padding: 6px 12px; border-radius: 4px; cursor: pointer;
  transition: background 100ms ease;
}
.mc-add:hover { background: var(--gold3); }

.mc-row {
  display: grid;
  grid-template-columns: 1fr 130px 32px;
  gap: 8px; align-items: center;
  margin-bottom: 8px;
}
@media (max-width: 540px) {
  .mc-row { grid-template-columns: 1fr 110px 32px; gap: 6px; }
}
.mc-row input {
  width: 100%; box-sizing: border-box;
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 4px; padding: 7px 10px;
  font-family: var(--serif); font-size: 14px;
  color: var(--tx); outline: none;
  transition: border-color 100ms ease;
}
.mc-row input:focus { border-color: var(--gold); }
.mc-row input.mc-amount {
  font-family: var(--mono); font-size: 13px;
  text-align: right;
}
.mc-rm {
  background: transparent; border: 1px solid var(--bdr2);
  color: var(--tx3); border-radius: 4px;
  width: 32px; height: 32px;
  cursor: pointer; font-family: var(--mono); font-size: 13px;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
.mc-rm:hover { color: #a04040; border-color: rgba(160,64,64,0.40); background: rgba(160,64,64,0.04); }

.mc-empty {
  font-family: var(--serif); font-style: italic; font-size: 13px;
  color: var(--tx3); padding: 6px 0;
}

.mc-total {
  display: flex; justify-content: space-between;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1px; color: var(--tx2);
  padding-top: 8px; margin-top: 4px;
  border-top: 1px dashed var(--bdr);
}
.mc-total .v { font-family: var(--serif); font-size: 14px; color: var(--tx); }
.mc-total.income .v { color: rgba(20, 100, 60, 0.95); }
.mc-total.expense .v { color: rgba(160, 36, 36, 0.95); }
    `;
    const tag = document.createElement('style');
    tag.id = 'money-custom-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function uid() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function isPlainObject(o){ return !!o && typeof o === 'object' && !Array.isArray(o); }
  // R3: shared Finance-local admission/identity helpers (prefer app.js's, so both
  // layers enforce the identical contract; local fallback for degraded init).
  function isUsableId(x){ return (global.finAdmit && global.finAdmit.isUsableId) ? global.finAdmit.isUsableId(x) : (typeof x === 'string' && x.length > 0); }
  function isAdmissibleRow(r){ return (global.finAdmit && global.finAdmit.isAdmissibleRow) ? global.finAdmit.isAdmissibleRow(r) : (isPlainObject(r) && isUsableId(r.id)); }
  // R4-P1-03: when app.js hooks are unavailable, admission/verification must NOT
  // downgrade to permissive success. These fall back to an EQUIVALENT local deep
  // admission / semantic verification, never {ok:true}/true by default.
  function localAdmitDeep(v){
    if (!isPlainObject(v)) return { ok:false, reason:'root-shape' };
    if ('russia' in v){
      const ph = v.russia;
      if (!isPlainObject(ph)) return { ok:false, reason:'phase-shape' };
      for (const key of ['customIncome','customExpenses']){
        if (key in ph){
          if (!Array.isArray(ph[key])) return { ok:false, reason:'malformed-collection' };
          if (!ph[key].every(isAdmissibleRow)) return { ok:false, reason:'malformed-row' };
        }
      }
    }
    return { ok:true };
  }
  function localVerifyRow(kind, id, field, value){
    let parsed; try { parsed = JSON.parse(localStorage.getItem('dune_finance_v1')); } catch (e) { return false; }
    if (!isPlainObject(parsed) || !isPlainObject(parsed.russia)) return false;
    const coll = kind === 'income' ? parsed.russia.customIncome : parsed.russia.customExpenses;
    if (!Array.isArray(coll)) return false;
    const matches = coll.filter(r => isPlainObject(r) && r.id === id);
    if (matches.length !== 1) return false;
    const rv = matches[0][field];
    return field === 'amount' ? (parseFloat(rv) || 0) === value : rv === value;
  }
  function admitDeep(v){ return (global.finAdmit && global.finAdmit.deep) ? global.finAdmit.deep(v) : localAdmitDeep(v); }
  function verifyRow(kind, id, field, value){ return (global.finAdmit && global.finAdmit.verifyRow) ? global.finAdmit.verifyRow(kind, id, field, value) : localVerifyRow(kind, id, field, value); }
  // Finance-local draft registry accessor: prefer the app.js registry so drafts
  // are shared with scalar edits; fall back to a local Map only when the hook
  // is unavailable (degraded init). Not a platform-wide draft store.
  const _localDrafts = new Map();
  function drafts() {
    return global.finDrafts || {
      set: (k, v) => _localDrafts.set(k, v),
      clear: (k) => _localDrafts.delete(k),
      has: (k) => _localDrafts.has(k),
      get: (k) => _localDrafts.get(k),
      entries: () => Array.from(_localDrafts.entries()),
      applyScalars() {},
      customKey: (kind, sel, field) => 'custom:' + JSON.stringify([kind, sel, field]),
      parseCustom: (k) => { if (typeof k !== 'string' || k.slice(0,7) !== 'custom:') return null; try { const a = JSON.parse(k.slice(7)); return { kind:a[0], sel:a[1], field:a[2] }; } catch(e){ return null; } }
    };
  }
  function dKey(kind, sel, field){ const d = drafts(); return d.customKey ? d.customKey(kind, sel, field) : ('custom:' + JSON.stringify([kind, sel, field])); }
  // R3-P1-03: resolve a single unambiguous durable row by id; -1 = missing/ambiguous.
  function resolveRow(list, id){
    if (!Array.isArray(list) || !isUsableId(id)) return -1;
    const idxs = [];
    list.forEach((r, i) => { if (isPlainObject(r) && r.id === id) idxs.push(i); });
    return idxs.length === 1 ? idxs[0] : -1;
  }

  // S1a Finance P0: tri-state authority read. A thrown/malformed read must
  // never be treated as absence and must never authorize a whole-key rewrite.
  function readAuthority() {
    if (typeof global.finReadAuthority === 'function') return global.finReadAuthority();
    // Fallback tri-state if the app.js hook is unavailable.
    let raw;
    try { raw = localStorage.getItem('dune_finance_v1'); }
    catch (e) { return { state: 'READ_FAILED' }; }
    if (raw === null) return { state: 'ABSENT' };
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return { state: 'MALFORMED', reason: 'json' }; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { state: 'MALFORMED', reason: 'shape' };
    return { state: 'PRESENT', value: parsed };
  }
  // Presentational read only — may soft-default because it never authorizes a
  // write on its own. Writers must go through mutateRussia (authority-gated).
  function loadInputs() {
    if (typeof global.finGetInputs === 'function') return global.finGetInputs();
    try { return JSON.parse(localStorage.getItem('dune_finance_v1') || '{}'); }
    catch (e) { return {}; }
  }
  // Guarded write: returns a truthful acknowledgement (readback-proven via
  // app.js when present). The degraded fallback (app hook unavailable) performs
  // its OWN readback proof and never acknowledges a dropped/no-op write as
  // saved (B06).
  function saveInputs(v) {
    if (typeof global.finSaveInputs === 'function') return global.finSaveInputs(v);
    let ser, prev;
    try { prev = localStorage.getItem('dune_finance_v1'); } catch (e) { prev = '__READ_THREW__'; }
    try { ser = JSON.stringify(v); } catch (e) { return { ok: false, outcome: 'REFUSED_PRE_WRITE', reason: 'serialize' }; }
    let wrote = false;
    try { localStorage.setItem('dune_finance_v1', ser); wrote = true; } catch (e) { /* rejected */ }
    let rb, rbThrew = false;
    try { rb = localStorage.getItem('dune_finance_v1'); } catch (e) { rbThrew = true; }
    if (!rbThrew && rb === ser) return { ok: true, outcome: 'VERIFIED_LOCAL_COMMIT' };
    if (!rbThrew && rb === prev) return { ok: false, outcome: 'REFUSED_PRE_WRITE', reason: wrote ? 'write-noop' : 'write-failed' };
    return { ok: false, outcome: 'POST_WRITE_UNCERTAIN', reason: rbThrew ? 'readback-failed' : 'readback-mismatch' };
  }
  function recompute() {
    if (typeof global.finRecompute === 'function') global.finRecompute();
  }
  // R3-P1-06: custom UI copy derives from the actual receipt outcome; a
  // POST_WRITE_UNCERTAIN custom mutation must never claim "Nothing was changed".
  function customToast(res) {
    if (typeof global.showBackupToast !== 'function') return;
    let msg;
    if (res && res.outcome === 'POST_WRITE_UNCERTAIN') msg = '⚠ Save uncertain — this change may or may not be stored. Reload to check before relying on it.';
    else if (res && res.reason === 'ambiguous-identity') msg = '⚠ Not saved — this row cannot be identified unambiguously; nothing was changed. Your typed value is kept.';
    else if (res && res.outcome === 'UNSAFE_AUTHORITY_REFUSAL') msg = '⚠ Not saved — Finance data is unreadable/invalid right now; nothing was changed. Your typed value is kept.';
    else msg = '⚠ Not saved — nothing was overwritten. Your typed value is kept.';
    try { global.showBackupToast(msg); } catch (e) {}
  }

  // Presentational shape: never writes. On unsafe read returns a safe empty
  // view so render()/getRows do not throw, WITHOUT persisting anything.
  function getRussia() {
    const auth = readAuthority();
    const all = (auth.state === 'PRESENT') ? auth.value : {};
    if (!all.russia) all.russia = {};
    if (!Array.isArray(all.russia.customIncome))   all.russia.customIncome = [];
    if (!Array.isArray(all.russia.customExpenses)) all.russia.customExpenses = [];
    return all;
  }

  // Authority-gated mutation: refuse (no write, no destructive render) on
  // READ_FAILED/MALFORMED; on ABSENT/PRESENT build the object, mutate, and
  // commit through the guarded writer, reporting truthful failure.
  function mutateRussia(mutator) {
    const auth = readAuthority();
    if (auth.state === 'READ_FAILED' || auth.state === 'MALFORMED') { const res = { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'finance-authority-' + auth.state.toLowerCase() }; customToast(res); return res; }
    const all = (auth.state === 'PRESENT') ? auth.value : {};
    // Only a genuinely ABSENT phase key defaults to {}. A present but non-object
    // russia is REFUSED (evidence preserved), never normalized (B02).
    if (!('russia' in all)) all.russia = {};
    if (!isPlainObject(all.russia)) { const res = { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'phase-shape' }; customToast(res); return res; }
    if (!('customIncome' in all.russia))   all.russia.customIncome = [];
    if (!('customExpenses' in all.russia)) all.russia.customExpenses = [];
    // R3-P1-01/02: deep-admit the SOURCE (collections + every row element). A
    // present-but-malformed collection or row fails closed (evidence preserved),
    // never normalized/deleted/committed-before-crash.
    const sa = admitDeep(all);
    if (!sa.ok) { const res = { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'source-' + sa.reason }; customToast(res); return res; }
    const r = mutator(all);
    if (r === false) return { ok: false, outcome: 'REFUSED_PRE_WRITE', reason: 'noop' };
    const w = saveInputs(all);
    // VERIFIED-only success: any non-verified result is a truthful failure.
    if (!w || w.ok !== true) { customToast(w); return w || { ok: false, outcome: 'POST_WRITE_UNCERTAIN', reason: 'unknown' }; }
    return { ok: true, outcome: 'VERIFIED_LOCAL_COMMIT' };
  }

  function addRow(kind) {
    const res = mutateRussia((all) => {
      const list = kind === 'income' ? all.russia.customIncome : all.russia.customExpenses;
      list.push({ id: uid(), name: '', amount: 0 });
    });
    if (!res.ok) return res; // refused: no destructive render; existing DOM kept
    render();
    setTimeout(() => {
      const rows = document.querySelectorAll('.mc-row[data-kind="' + kind + '"]');
      const last = rows[rows.length - 1];
      if (last) last.querySelector('.mc-name').focus();
    }, 30);
    return res;
  }
  function updateRow(kind, id, patch, sel) {
    sel = sel || ['id', id];
    const d = drafts();
    let ambiguous = false;
    const res = mutateRussia((all) => {
      const list = kind === 'income' ? all.russia.customIncome : all.russia.customExpenses;
      const idx = resolveRow(list, id); // R3-P1-03: exactly one match, else refuse
      if (idx === -1) { ambiguous = true; return false; }
      list[idx] = Object.assign({}, list[idx], patch);
    });
    if (res.ok) {
      // R3-P1-03: verify the exact SELECTED row's field survived, not just bytes.
      let verified = true;
      for (const f of Object.keys(patch)) { if (!verifyRow(kind, id, f, patch[f])) { verified = false; break; } }
      if (!verified) {
        const out = { ok:false, outcome:'POST_WRITE_UNCERTAIN', reason:'intent-not-persisted' };
        Object.keys(patch).forEach(f => d.set(dKey(kind, sel, f), patch[f]));
        customToast(out);
        return out;
      }
      Object.keys(patch).forEach(f => d.clear(dKey(kind, sel, f)));
      recompute();
      return res;
    }
    if (ambiguous) {
      // Missing/duplicate identity: refuse durable mutation, retain visible intent
      // bound to this exact row selection (R3-P1-04), truthful toast.
      const out = { ok:false, outcome:'UNSAFE_AUTHORITY_REFUSAL', reason:'ambiguous-identity' };
      Object.keys(patch).forEach(f => d.set(dKey(kind, sel, f), patch[f]));
      customToast(out);
      return out;
    }
    if (res.reason !== 'noop') {
      // refused/uncertain write: retain the newer typed intent (toast already
      // fired inside mutateRussia with the correct outcome copy).
      Object.keys(patch).forEach(f => d.set(dKey(kind, sel, f), patch[f]));
    }
    return res;
  }
  function removeRow(kind, id, sel) {
    let ambiguous = false;
    const res = mutateRussia((all) => {
      const list = kind === 'income' ? all.russia.customIncome : all.russia.customExpenses;
      const idx = resolveRow(list, id); // exactly one match, else refuse (never delete both)
      if (idx === -1) { ambiguous = true; return false; }
      list.splice(idx, 1);
    });
    if (res.ok) { render(); recompute(); return res; }
    if (ambiguous) { const out = { ok:false, outcome:'UNSAFE_AUTHORITY_REFUSAL', reason:'ambiguous-identity' }; customToast(out); return out; }
    return res; // other refusal: keep existing DOM
  }

  function attrEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/'/g,'&#39;'); }
  function rowHTML(kind, r, index, list) {
    // R3-P1-04: bind a stable selection token to each row: kind+id when the id
    // is usable and unique in this collection, else kind+position. Drafts bind
    // to this token so replay never crosses kinds or ambiguous rows.
    const unique = isUsableId(r.id) && list.filter(x => isPlainObject(x) && x.id === r.id).length === 1;
    // R4-P1-01: a position token also records the captured row id so replay can
    // refuse to bind onto a DIFFERENT row after a structural change (position is
    // never treated as stable identity).
    const sel = unique ? ['id', r.id] : ['pos', index, (r.id == null ? '' : String(r.id))];
    return `
      <div class="mc-row" data-kind="${kind}" data-id="${esc(r.id)}" data-sel='${attrEsc(JSON.stringify(sel))}'>
        <input class="mc-name" type="text" placeholder="${kind === 'income' ? 'e.g. side job · tutoring' : 'e.g. gym · archery class'}" value="${esc(r.name)}">
        <input class="mc-amount" type="number" inputmode="numeric" placeholder="0" value="${(r.amount === 0 || r.amount) ? esc(r.amount) : ''}">
        <button class="mc-rm" type="button" aria-label="Remove">✕</button>
      </div>
    `;
  }

  function blockHTML(kind, rows) {
    // Presentational only: a malformed durable row (non-object) is SKIPPED for
    // display so it cannot crash render/calculation; it is never written or
    // deleted here (mutation refuses malformed collections/rows) (R3-P1-02).
    const list = Array.isArray(rows) ? rows.filter(isPlainObject) : [];
    const total = list.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
    const title = kind === 'income' ? 'Custom Income' : 'Custom Expenses';
    const addLabel = kind === 'income' ? '+ add income' : '+ add expense';
    return `
      <div class="mc-block" data-block-kind="${kind}">
        <div class="mc-block-hd">
          <span class="mc-block-title">${title} (₽/month)</span>
          <button class="mc-add" type="button" data-add="${kind}">${addLabel}</button>
        </div>
        ${list.length === 0
          ? `<div class="mc-empty">Nothing here yet. Click <strong>${addLabel}</strong>.</div>`
          : list.map((r, i) => rowHTML(kind, r, i, list)).join('')}
        ${list.length > 0 ? `
          <div class="mc-total ${kind}">
            <span>Total ${kind}</span>
            <span class="v">${total > 0 ? (kind === 'expense' ? '−' : '+') : ''}${Math.round(total).toLocaleString()} ₽</span>
          </div>` : ''}
      </div>
    `;
  }

  function mount() {
    const finInputs = document.querySelector('#fin-russia .fin-inputs');
    if (!finInputs) return;
    let host = document.getElementById('mc-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mc-host';
      finInputs.appendChild(host);
    }
    return host;
  }

  function render() {
    const host = mount();
    if (!host) return;
    const all = getRussia();
    host.innerHTML =
      blockHTML('income',  all.russia.customIncome) +
      blockHTML('expense', all.russia.customExpenses);
    wireHost(host);
    applyCustomDrafts(host);
  }
  // Re-apply retained custom drafts on top of a freshly-rendered (durable) DOM
  // so an ordinary render cannot erase newer refused intent (B03). Visual only:
  // does not dispatch input, so it never re-triggers a mutation.
  function applyCustomDrafts(host) {
    const d = drafts();
    for (const [k, v] of d.entries()) {
      const c = d.parseCustom ? d.parseCustom(k) : null;
      if (!c || !c.sel) continue;
      const kind = c.kind, sel = c.sel, field = c.field;
      let row = null;
      if (sel[0] === 'id') {
        // R3-P1-04: bind by kind AND id, and only when it resolves to exactly one
        // row — never cross income/expense, never an ambiguous match.
        let nodes;
        try { nodes = host.querySelectorAll('.mc-row[data-kind="' + kind + '"][data-id="' + (window.CSS && CSS.escape ? CSS.escape(sel[1]) : sel[1]) + '"]'); }
        catch (e) { nodes = []; }
        if (nodes.length === 1) row = nodes[0];
      } else if (sel[0] === 'pos') {
        // R4-P1-01: position is unstable. Only replay when the row currently at
        // that position still has the SAME id captured at draft time; otherwise
        // the intent is retained in the registry but never bound to another row.
        const nodes = host.querySelectorAll('.mc-row[data-kind="' + kind + '"]');
        const cand = nodes[sel[1]] || null;
        const capturedId = (sel.length > 2 && sel[2] != null) ? String(sel[2]) : null;
        if (cand && (cand.dataset.id || '') === (capturedId || '')) row = cand;
      }
      if (!row) continue;
      const input = row.querySelector(field === 'name' ? '.mc-name' : '.mc-amount');
      if (input && document.activeElement !== input) input.value = v;
    }
  }

  function wireHost(host) {
    host.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', () => addRow(btn.dataset.add));
    });
    host.querySelectorAll('.mc-row').forEach(row => {
      const kind = row.dataset.kind;
      const id   = row.dataset.id;
      let sel; try { sel = JSON.parse(row.dataset.sel); } catch (e) { sel = ['id', id]; }
      const name = row.querySelector('.mc-name');
      const amt  = row.querySelector('.mc-amount');
      const rm   = row.querySelector('.mc-rm');
      name.addEventListener('input', () => updateRow(kind, id, { name: name.value }, sel));
      amt.addEventListener('input',  () => updateRow(kind, id, { amount: parseFloat(String(amt.value).replace(/,/g, '')) || 0 }, sel));
      rm.addEventListener('click',   () => removeRow(kind, id, sel));
    });
  }

  // One-time seed from the parked ideas so the user starts with placeholder rows
  // matching their planning context. Gated on russia.customSeeded so it only
  // runs when both arrays are still empty AND has never run before.
  function seedFromIdeas() {
    // S1a: a failed/malformed authority read must NOT fall through into this
    // default-minting startup writer (that is the F02 startup vector).
    const auth = readAuthority();
    if (auth.state === 'READ_FAILED' || auth.state === 'MALFORMED') return;
    mutateRussia((all) => {
      if (all.russia.customSeeded) return false;
      if (all.russia.customIncome.length || all.russia.customExpenses.length) {
        all.russia.customSeeded = true;
        return; // commit the marker only
      }
      all.russia.customIncome = [
        { id: uid(), name: 'Side job (off-days)', amount: 0 }
      ];
      all.russia.customExpenses = [
        { id: uid(), name: 'Gym',                    amount: 0 },
        { id: uid(), name: 'Archery',                amount: 0 },
        { id: uid(), name: 'Engine certifications',  amount: 0 }
      ];
      all.russia.customSeeded = true;
    });
  }

  function boot() {
    injectStyles();
    // Wait until the finance section's inputs are in the DOM (always inline, but be defensive)
    if (document.querySelector('#fin-russia .fin-inputs')) {
      seedFromIdeas();
      render();
      recompute();
      // Re-render once after app.js's own DOMContentLoaded handler runs so we
      // catch any late-init state.
      setTimeout(render, 60);
    } else {
      const obs = new MutationObserver(() => {
        if (document.querySelector('#fin-russia .fin-inputs')) {
          obs.disconnect();
          seedFromIdeas();
          render();
          recompute();
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // R3-P1-05: Save re-renders custom rows to reflect committed values / drops
  // committed drafts. Exposed so app.js saveFinanceNow can refresh after commit.
  global.finRenderCustom = render;
  global.MONEY_CUSTOM = {
    addRow, updateRow, removeRow, render,
    getRows: (kind) => {
      const r = getRussia().russia;
      return kind === 'income' ? r.customIncome : r.customExpenses;
    }
  };
})(window);
