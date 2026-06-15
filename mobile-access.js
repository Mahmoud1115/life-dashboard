// ============================================================
// DUNE LIFE OS — MOBILE QUICK ACCESS
// On ≤640px, styles.css hides .nmb-util (Private + Backup).
// This module adds two small fixed-position buttons in the
// top-right corner so those actions stay reachable on phones.
// Desktop is untouched.
// ============================================================

(function (global) {
  'use strict';

  const MOBILE_BREAKPOINT = 640;

  function injectStyles() {
    if (document.getElementById('mobile-access-styles')) return;
    const css = `
#mobile-access {
  display: none;
  position: fixed;
  top: max(10px, env(safe-area-inset-top));
  right: max(10px, env(safe-area-inset-right));
  z-index: 200;
  flex-direction: column;
  gap: 8px;
}
@media (max-width: ${MOBILE_BREAKPOINT}px) {
  #mobile-access { display: flex; }
}
.ma-btn {
  -webkit-appearance: none;
  appearance: none;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(10px) saturate(140%);
  -webkit-backdrop-filter: blur(10px) saturate(140%);
  border: 1px solid rgba(154, 120, 50, 0.28);
  border-radius: 100px;
  padding: 7px 12px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  box-shadow: 0 2px 10px rgba(26, 24, 20, 0.06);
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 1.3px;
  text-transform: uppercase;
  color: var(--tx2);
  line-height: 1;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}
.ma-btn:active { transform: scale(0.97); }
.ma-btn .ma-emoji { font-size: 13px; line-height: 1; }
.ma-btn:hover { color: var(--gold2); border-color: rgba(154, 120, 50, 0.50); }
.ma-btn.is-public { background: rgba(154, 120, 50, 0.12); color: var(--gold2); border-color: rgba(154, 120, 50, 0.55); }
.ma-btn .ma-pip {
  width: 7px; height: 7px; border-radius: 50%;
  display: inline-block; flex-shrink: 0;
}
.ma-btn .ma-pip.bp-red    { background: var(--red, #a04040); }
.ma-btn .ma-pip.bp-amber  { background: var(--amber, #c08840); }
.ma-btn .ma-pip.bp-green  { background: var(--green, #5a8e3a); }
    `;
    const tag = document.createElement('style');
    tag.id = 'mobile-access-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function injectButtons() {
    if (document.getElementById('mobile-access')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mobile-access';
    wrap.innerHTML = `
      <button class="ma-btn" type="button" id="ma-private" aria-label="Toggle Private mode">
        <span class="ma-emoji">👁</span><span>Private</span>
      </button>
      <button class="ma-btn" type="button" id="ma-backup" aria-label="Open Backup panel">
        <span class="ma-emoji">📦</span><span id="ma-backup-label">Backup</span>
        <span class="ma-pip bp-red" id="ma-backup-pip"></span>
      </button>
    `;
    document.body.appendChild(wrap);

    document.getElementById('ma-private').addEventListener('click', () => {
      if (typeof global.togglePrivacy === 'function') global.togglePrivacy();
      // reflect state — privacy-btn class toggles on the original button
      requestAnimationFrame(syncPrivateState);
    });
    document.getElementById('ma-backup').addEventListener('click', () => {
      if (typeof global.openBackupPanel === 'function') global.openBackupPanel();
    });
  }

  function syncPrivateState() {
    const orig = document.getElementById('privacy-btn');
    const me   = document.getElementById('ma-private');
    if (!orig || !me) return;
    // app.js toggles the indicator '#privacy-ind' between PUBLIC MODE and PRIVATE MODE
    const ind = document.getElementById('privacy-ind');
    const isPublic = ind ? /PUBLIC/i.test(ind.textContent || '') : false;
    me.classList.toggle('is-public', isPublic);
    me.querySelector('span:last-child').textContent = isPublic ? 'Public' : 'Private';
  }

  function syncBackupPip() {
    const origPill = document.getElementById('backup-pill');
    const pip = document.getElementById('ma-backup-pip');
    const lbl = document.getElementById('ma-backup-label');
    if (!origPill || !pip) return;
    pip.className = 'ma-pip ' +
      (origPill.classList.contains('bp-green') ? 'bp-green'
       : origPill.classList.contains('bp-amber') ? 'bp-amber'
       : 'bp-red');
    // mirror the day count if present (e.g. "📦 2d" → "2d")
    const txt = (origPill.textContent || '').trim();
    if (lbl) {
      if (/^\d+d$|^Today$/i.test(txt)) lbl.textContent = txt;
      else lbl.textContent = 'Backup';
    }
  }

  function boot() {
    injectStyles();
    injectButtons();
    syncPrivateState();
    syncBackupPip();
    // Re-sync only when the two original elements change — not the whole tree.
    // The broad-body observer otherwise gets flooded by analytics rerenders.
    const pill = document.getElementById('backup-pill');
    const ind  = document.getElementById('privacy-ind');
    const obs = new MutationObserver(() => { syncPrivateState(); syncBackupPip(); });
    if (pill) obs.observe(pill, { attributes: true, childList: true, characterData: true, subtree: true });
    if (ind)  obs.observe(ind,  { attributes: true, childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
