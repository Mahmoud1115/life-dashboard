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
      applyScalars() {}
    };
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
  function blockedToast() {
    if (typeof global.showBackupToast === 'function') {
      try { global.showBackupToast('⚠ Not saved — Finance storage unavailable. Nothing was changed.'); } catch (e) {}
    }
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
    if (auth.state === 'READ_FAILED' || auth.state === 'MALFORMED') { blockedToast(); return { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'finance-authority-' + auth.state.toLowerCase() }; }
    const all = (auth.state === 'PRESENT') ? auth.value : {};
    // Only a genuinely ABSENT phase key defaults to {}. A present but non-object
    // russia (null/array/scalar) is REFUSED (evidence preserved), never
    // normalized — otherwise a malformed phase silently becomes writable (B02).
    if (!('russia' in all)) all.russia = {};
    if (!isPlainObject(all.russia)) { blockedToast(); return { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'phase-shape' }; }
    // Present-but-malformed named collections are refused (evidence preserved),
    // never normalized to [] (B02). Only ABSENT collections default to [].
    if ('customIncome' in all.russia && !Array.isArray(all.russia.customIncome)) { blockedToast(); return { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'malformed-collection' }; }
    if ('customExpenses' in all.russia && !Array.isArray(all.russia.customExpenses)) { blockedToast(); return { ok: false, outcome: 'UNSAFE_AUTHORITY_REFUSAL', reason: 'malformed-collection' }; }
    if (!('customIncome' in all.russia))   all.russia.customIncome = [];
    if (!('customExpenses' in all.russia)) all.russia.customExpenses = [];
    const r = mutator(all);
    if (r === false) return { ok: false, outcome: 'REFUSED_PRE_WRITE', reason: 'noop' };
    const w = saveInputs(all);
    // VERIFIED-only success: any non-verified result is a truthful failure.
    if (!w || w.ok !== true) { blockedToast(); return w || { ok: false, outcome: 'POST_WRITE_UNCERTAIN', reason: 'unknown' }; }
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
  function updateRow(kind, id, patch) {
    const res = mutateRussia((all) => {
      const list = kind === 'income' ? all.russia.customIncome : all.russia.customExpenses;
      const idx = list.findIndex(r => r.id === id);
      if (idx === -1) return false;
      list[idx] = Object.assign({}, list[idx], patch);
    });
    const d = drafts();
    if (res.ok) {
      // committed: the field is durable, drop any retained draft.
      Object.keys(patch).forEach(f => d.clear('custom:' + kind + ':' + id + ':' + f));
      recompute();
    } else if (res.reason !== 'noop') {
      // refused/uncertain: retain the newer typed intent so a later ordinary
      // render/recompute cannot erase it (B03).
      Object.keys(patch).forEach(f => d.set('custom:' + kind + ':' + id + ':' + f, patch[f]));
    }
    return res;
  }
  function removeRow(kind, id) {
    const res = mutateRussia((all) => {
      if (kind === 'income') {
        all.russia.customIncome = all.russia.customIncome.filter(r => r.id !== id);
      } else {
        all.russia.customExpenses = all.russia.customExpenses.filter(r => r.id !== id);
      }
    });
    if (!res.ok) return res; // refused: keep existing DOM, do not drop the row visually
    render();
    recompute();
    return res;
  }

  function rowHTML(kind, r) {
    return `
      <div class="mc-row" data-kind="${kind}" data-id="${esc(r.id)}">
        <input class="mc-name" type="text" placeholder="${kind === 'income' ? 'e.g. side job · tutoring' : 'e.g. gym · archery class'}" value="${esc(r.name)}">
        <input class="mc-amount" type="number" inputmode="numeric" placeholder="0" value="${r.amount || ''}">
        <button class="mc-rm" type="button" aria-label="Remove">✕</button>
      </div>
    `;
  }

  function blockHTML(kind, rows) {
    const total = rows.reduce((a, r) => a + (parseFloat(r.amount) || 0), 0);
    const title = kind === 'income' ? 'Custom Income' : 'Custom Expenses';
    const addLabel = kind === 'income' ? '+ add income' : '+ add expense';
    return `
      <div class="mc-block" data-block-kind="${kind}">
        <div class="mc-block-hd">
          <span class="mc-block-title">${title} (₽/month)</span>
          <button class="mc-add" type="button" data-add="${kind}">${addLabel}</button>
        </div>
        ${rows.length === 0
          ? `<div class="mc-empty">Nothing here yet. Click <strong>${addLabel}</strong>.</div>`
          : rows.map(r => rowHTML(kind, r)).join('')}
        ${rows.length > 0 ? `
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
      const m = /^custom:(income|expense):([^:]+):(name|amount)$/.exec(k);
      if (!m) continue;
      let row;
      try { row = host.querySelector('.mc-row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(m[2]) : m[2]) + '"]'); }
      catch (e) { row = null; }
      if (!row) continue;
      const input = row.querySelector(m[3] === 'name' ? '.mc-name' : '.mc-amount');
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
      const name = row.querySelector('.mc-name');
      const amt  = row.querySelector('.mc-amount');
      const rm   = row.querySelector('.mc-rm');
      name.addEventListener('input', () => updateRow(kind, id, { name: name.value }));
      amt.addEventListener('input',  () => updateRow(kind, id, { amount: parseFloat(String(amt.value).replace(/,/g, '')) || 0 }));
      rm.addEventListener('click',   () => removeRow(kind, id));
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

  global.MONEY_CUSTOM = {
    addRow, updateRow, removeRow, render,
    getRows: (kind) => {
      const r = getRussia().russia;
      return kind === 'income' ? r.customIncome : r.customExpenses;
    }
  };
})(window);
