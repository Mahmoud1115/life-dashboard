// ============================================================
// DUNE LIFE OS — MONEY · thousands-separator formatter
// Visually formats every Money-section number input as you type.
// Storage stays raw integers — commas are display only.
// ============================================================

(function (global) {
  'use strict';

  // ── Format helper ─────────────────────────────
  function fmt(raw) {
    if (raw == null) return '';
    let clean = String(raw).replace(/[^\d.\-]/g, '');
    if (clean === '' || clean === '-' || clean === '.') return clean;
    const hasDot = clean.indexOf('.') !== -1;
    const negative = clean.indexOf('-') === 0;
    let intPart = clean.replace(/^-/, '').split('.')[0] || '0';
    intPart = intPart.replace(/^0+(?=\d)/, '');                 // strip leading zeros
    const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    let out = (negative ? '-' : '') + withCommas;
    if (hasDot) {
      const decPart = clean.split('.')[1] || '';
      out += '.' + decPart.slice(0, 2);
    }
    return out;
  }

  function reformat(el) {
    const oldVal = el.value;
    const caret = el.selectionStart || oldVal.length;
    const newVal = fmt(oldVal);
    if (newVal === oldVal) return;
    // Preserve cursor position across the comma-injection
    const oldCommas = (oldVal.slice(0, caret).match(/,/g) || []).length;
    el.value = newVal;
    const newCommas = (newVal.slice(0, caret).match(/,/g) || []).length;
    let newCaret = caret + (newCommas - oldCommas);
    if (newCaret < 0) newCaret = 0;
    if (newCaret > newVal.length) newCaret = newVal.length;
    try { el.setSelectionRange(newCaret, newCaret); } catch (e) { /* not a text-type input */ }
  }

  // ── Wire a single input ───────────────────────
  function wireInput(el) {
    if (!el || el._commaWired) return;
    el._commaWired = true;
    // type=number rejects commas in the value, so switch to text + numeric keyboard
    el.setAttribute('type', 'text');
    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    if (el.value) reformat(el);
    el.addEventListener('input', () => reformat(el));
    el.addEventListener('blur',  () => reformat(el));
  }

  // ── Wire all Money inputs ─────────────────────
  const MAIN_IDS = [
    'fin-r-salary', 'fin-r-rent', 'fin-r-food', 'fin-r-transport',
    'fin-r-utilities', 'fin-r-phone', 'fin-r-family_transfer',
    'fin-r-other', 'fin-r-mai', 'fin-r-usd_rate', 'fin-r-save_target'
  ];
  function wireMain() {
    MAIN_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) wireInput(el);
    });
  }
  function wireCustoms() {
    document.querySelectorAll('.mc-amount').forEach(wireInput);
  }

  // ── Patch finInputChange so the inline oninput handlers receive a
  //    comma-stripped value (parseFloat stops at commas otherwise) ──
  function patchFinInputChange() {
    const orig = global.finInputChange;
    if (!orig || orig._commaPatched) return;
    const wrapped = function (phase, field, val) {
      if (typeof val === 'string') val = val.replace(/,/g, '');
      return orig.call(this, phase, field, val);
    };
    wrapped._commaPatched = true;
    global.finInputChange = wrapped;
  }

  function boot() {
    patchFinInputChange();
    wireMain();
    wireCustoms();
    // Money customs render asynchronously — re-wire any new .mc-amount.
    // Also re-wire main inputs on app.js's syncInputs() pass which can
    // overwrite .value and bypass our formatter momentarily.
    const obs = new MutationObserver(() => {
      patchFinInputChange();
      wireMain();
      wireCustoms();
      // After app.js sets raw values via syncInputs, reformat all wired fields.
      MAIN_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el._commaWired) reformat(el);
      });
      document.querySelectorAll('.mc-amount').forEach(el => {
        if (el._commaWired) reformat(el);
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.MONEY_COMMAS = { fmt, reformat, wireInput };
})(window);
