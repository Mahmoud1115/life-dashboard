// ============================================================
// DUNE LIFE OS — BHT · PRESENTATION LAYER (Phase 2)
// Nav button · section · FAB · Ctrl+Shift+B hotkey · onboarding
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store) { console.error('[BHT-UI] core.js missing'); return; }
  if (!global.BHT)   { console.error('[BHT-UI] bht.js missing');  return; }

  const GROUP_KEY   = 'behavior';
  const SECTION_ID  = 'behavior';
  const NAV_LABEL   = 'Behavior';
  const NAV_EMOJI   = '◐';

  function injectStyles() {
    if (document.getElementById('bht-styles')) return;
    const css = `
#${SECTION_ID} .bht-hero { margin-bottom: 28px; }
#${SECTION_ID} .bht-intro {
  font-family: var(--serif);
  font-size: 17px; line-height: 1.55; color: var(--tx2);
  font-style: italic; max-width: 64ch; margin: 8px 0 0;
}
#${SECTION_ID} .bht-onboard-card {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 28px 30px; margin-top: 18px;
  box-shadow: 0 1px 0 var(--bdr);
}
#${SECTION_ID} .bht-onboard-eyebrow {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--gold2); margin-bottom: 10px;
}
#${SECTION_ID} .bht-onboard-title {
  font-family: var(--serif); font-size: 28px; font-weight: 400;
  color: var(--tx); margin: 0 0 8px; line-height: 1.15;
}
#${SECTION_ID} .bht-onboard-title em { font-style: italic; color: var(--gold); }
#${SECTION_ID} .bht-onboard-lede {
  font-family: var(--serif); font-size: 15px; line-height: 1.6;
  color: var(--tx2); margin: 0 0 22px; max-width: 56ch;
}
#${SECTION_ID} .bht-pillar-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px; margin: 0 0 24px; padding: 18px 0;
  border-top: 1px solid var(--bdr); border-bottom: 1px solid var(--bdr);
}
#${SECTION_ID} .bht-pillar-cell .pc-l {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 4px;
}
#${SECTION_ID} .bht-pillar-cell .pc-v {
  font-family: var(--serif); font-size: 15px;
  color: var(--tx); line-height: 1.4;
}
#${SECTION_ID} .bht-default-habits { margin: 0 0 24px; }
#${SECTION_ID} .bht-dh-label {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 10px;
}
#${SECTION_ID} .bht-chip-row { display: flex; flex-wrap: wrap; gap: 8px; }
#${SECTION_ID} .bht-chip {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--gold3); border: 1px solid rgba(154,120,50,0.22);
  border-radius: 100px; padding: 6px 14px;
  font-family: var(--mono); font-size: 11px;
  color: var(--gold2); letter-spacing: 0.3px;
}
#${SECTION_ID} .bht-chip-cat {
  font-size: 9px; opacity: 0.65; text-transform: uppercase; letter-spacing: 1px;
}
#${SECTION_ID} .bht-cta-row {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
}
#${SECTION_ID} .bht-btn-primary,
.bht-btn-primary {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: var(--gold); color: var(--bg2);
  border: 1px solid var(--gold2); border-radius: 4px;
  padding: 10px 18px; cursor: pointer;
  transition: background 120ms ease;
}
#${SECTION_ID} .bht-btn-primary:hover,
.bht-btn-primary:hover { background: var(--gold2); }
#${SECTION_ID} .bht-btn-ghost {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: transparent; color: var(--tx2);
  border: 1px solid var(--bdr2); border-radius: 4px;
  padding: 10px 18px; cursor: pointer;
}
#${SECTION_ID} .bht-btn-ghost:hover { background: var(--bg3); }

#${SECTION_ID} .bht-ready-card {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 24px 26px; margin-top: 18px;
}
#${SECTION_ID} .bht-ready-title {
  font-family: var(--serif); font-size: 22px;
  color: var(--tx); margin: 0 0 6px;
}
#${SECTION_ID} .bht-ready-sub {
  font-family: var(--mono); font-size: 10px;
  color: var(--tx3); letter-spacing: 1px;
  text-transform: uppercase; margin-bottom: 18px;
}

#bht-fab {
  position: fixed; right: 22px; bottom: 22px; z-index: 9000;
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--gold); color: var(--bg2);
  border: 1px solid var(--gold2);
  box-shadow: 0 4px 14px rgba(26,24,20,0.18), 0 1px 3px rgba(26,24,20,0.10);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-family: var(--serif); font-size: 26px; line-height: 1;
  transition: transform 140ms ease, background 140ms ease;
}
#bht-fab:hover { background: var(--gold2); transform: translateY(-1px); }
#bht-fab:focus-visible { outline: 2px solid var(--gold2); outline-offset: 3px; }
#bht-fab .bht-fab-hint {
  position: absolute; right: 66px;
  background: var(--tx); color: var(--bg2);
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1px; white-space: nowrap;
  padding: 6px 10px; border-radius: 4px;
  opacity: 0; transition: opacity 120ms ease; pointer-events: none;
}
#bht-fab:hover .bht-fab-hint,
#bht-fab:focus-visible .bht-fab-hint { opacity: 1; }
@media (max-width: 720px) {
  #bht-fab { right: 14px; bottom: 76px; }
  #bht-fab .bht-fab-hint { display: none; }
}

#bht-overlay {
  position: fixed; inset: 0; z-index: 9100;
  background: rgba(26,24,20,0.42);
  display: none; align-items: flex-end; justify-content: center; padding: 0;
}
#bht-overlay.is-open { display: flex; }
#bht-overlay .bht-sheet {
  background: var(--bg2); width: 100%; max-width: 560px;
  border-radius: 10px 10px 0 0;
  border: 1px solid var(--bdr); border-bottom: none;
  padding: 22px 24px 28px;
  box-shadow: 0 -8px 28px rgba(26,24,20,0.20);
  animation: bht-sheet-up 180ms ease;
}
@media (min-width: 720px) {
  #bht-overlay { align-items: center; padding: 24px; }
  #bht-overlay .bht-sheet { border-radius: 10px; border-bottom: 1px solid var(--bdr); }
}
@keyframes bht-sheet-up {
  from { transform: translateY(18px); opacity: 0.6; }
  to   { transform: translateY(0);    opacity: 1; }
}
#bht-overlay .bht-sheet-hd {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 12px; margin-bottom: 14px;
}
#bht-overlay .bht-sheet-eyebrow {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--gold2); margin-bottom: 4px;
}
#bht-overlay .bht-sheet-title {
  font-family: var(--serif); font-size: 22px;
  color: var(--tx); margin: 0; line-height: 1.2;
}
#bht-overlay .bht-sheet-close {
  background: transparent; border: none; cursor: pointer;
  font-family: var(--mono); font-size: 18px; color: var(--tx3);
  padding: 4px 8px; border-radius: 4px;
}
#bht-overlay .bht-sheet-close:hover { background: var(--bg3); color: var(--tx); }
#bht-overlay .bht-sheet-body {
  font-family: var(--serif); font-size: 15px; line-height: 1.6; color: var(--tx2);
}
#bht-overlay .bht-sheet-body p { margin: 0 0 12px; }
#bht-overlay .bht-sheet-body .bht-soon {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--gold2); background: var(--gold3);
  display: inline-block; padding: 4px 10px;
  border-radius: 100px; margin-top: 6px;
}
    `;
    const tag = document.createElement('style');
    tag.id = 'bht-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function injectNavButton() {
    const navMain = document.querySelector('.nav .nav-main');
    if (!navMain) { console.warn('[BHT-UI] .nav-main not found'); return; }
    if (document.querySelector('.nmb[data-group="' + GROUP_KEY + '"]')) return;

    const btn = document.createElement('button');
    btn.className = 'nmb';
    btn.dataset.group = GROUP_KEY;
    btn.setAttribute('onclick', "BHT_UI.goto()");
    btn.innerHTML =
      '<span class="nmb-emoji">' + NAV_EMOJI + '</span>' +
      '<span class="nmb-label">' + NAV_LABEL + '</span>';

    const reviewBtn = navMain.querySelector('.nmb[data-group="review"]');
    if (reviewBtn) navMain.insertBefore(btn, reviewBtn);
    else {
      const utilBtn = navMain.querySelector('.nmb.nmb-util');
      if (utilBtn) navMain.insertBefore(btn, utilBtn);
      else navMain.appendChild(btn);
    }
  }

  function injectSection() {
    if (document.getElementById(SECTION_ID)) return;
    const main = document.querySelector('main.main');
    if (!main) { console.warn('[BHT-UI] main.main not found'); return; }

    const sec = document.createElement('section');
    sec.className = 'sec';
    sec.id = SECTION_ID;
    sec.innerHTML = `
      <div class="sec-hd">
        <div class="sec-num">${NAV_EMOJI} Behavior</div>
        <h2 class="sec-title">Behavior —<br><em>Self-Awareness Layer</em></h2>
        <p class="sec-intro">A quiet companion to the career, money, and legal pillars. Not a streak game — a place to notice what's quietly costing the plan, and to come back lighter the next day.</p>
      </div>
      <div id="bht-body"></div>
    `;
    main.appendChild(sec);
  }

  function registerNavGroup() {
    if (!global.NAV_GROUPS || !global.SEC_TO_GROUP) {
      // app.js declares these as `const` at module scope, so they're not on
      // window. We use BHT_UI.goto() to drive navigation directly instead.
      return;
    }
    if (!global.NAV_GROUPS[GROUP_KEY]) {
      global.NAV_GROUPS[GROUP_KEY] = { primary: SECTION_ID, subs: [] };
    }
    if (!global.SEC_TO_GROUP[SECTION_ID]) {
      global.SEC_TO_GROUP[SECTION_ID] = GROUP_KEY;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function isOnboarding() {
    const slice = global.Store.get('bht') || {};
    const entries = Array.isArray(slice.entries) ? slice.entries : [];
    const initialized = slice.meta && slice.meta.initialized;
    return entries.length === 0 && !initialized;
  }

  function renderOnboarding() {
    const slice = global.Store.get('bht') || {};
    const habits = (slice.habits || []).filter(h => !h.archived);
    const habitChips = habits.map(h => `
      <span class="bht-chip">
        ${escapeHtml(h.name)}
        <span class="bht-chip-cat">${escapeHtml(h.category)} · w${h.severityWeight}</span>
      </span>
    `).join('');

    return `
      <div class="bht-onboard-card">
        <div class="bht-onboard-eyebrow">New Pillar · Added June 2026</div>
        <h3 class="bht-onboard-title">A quiet ledger for the patterns that <em>quietly cost the plan</em>.</h3>
        <p class="bht-onboard-lede">
          The 55k system, the EASA pipeline, and the Moscow build all depend on daily state — and daily state is made of behaviors you can notice, name, and adjust. This pillar holds them. One tap to log a slip or an urge. Optional CBT-style reflection. Weekly snapshots that tell you what the patterns are really saying.
        </p>

        <div class="bht-pillar-grid">
          <div class="bht-pillar-cell">
            <div class="pc-l">Friction</div>
            <div class="pc-v">Under 15 seconds per entry. Long-press for reflection.</div>
          </div>
          <div class="bht-pillar-cell">
            <div class="pc-l">Tone</div>
            <div class="pc-v">Compassionate, not punitive. Progress over streaks.</div>
          </div>
          <div class="bht-pillar-cell">
            <div class="pc-l">Privacy</div>
            <div class="pc-v">Local-first. Ships with Gist sync &amp; backup.</div>
          </div>
          <div class="bht-pillar-cell">
            <div class="pc-l">AI Coach</div>
            <div class="pc-v">Ollama, BYOK, or offline JS fallback. Your choice.</div>
          </div>
        </div>

        <div class="bht-default-habits">
          <div class="bht-dh-label">Pre-seeded habits — rename or remove anytime</div>
          <div class="bht-chip-row">${habitChips}</div>
        </div>

        <div class="bht-cta-row">
          <button class="bht-btn-primary" type="button" onclick="BHT_UI.initialize()">Initialize System</button>
          <button class="bht-btn-ghost"   type="button" onclick="BHT_UI.openQuickLog()">Quick-log now</button>
          <span style="font-family:var(--mono);font-size:10px;color:var(--tx3);letter-spacing:1px">
            ⌘/Ctrl + Shift + B · anywhere in the app
          </span>
        </div>
      </div>
    `;
  }

  function renderReady() {
    const slice = global.Store.get('bht') || {};
    const habits = (slice.habits || []).filter(h => !h.archived);
    const entries = slice.entries || [];
    const todayKey = global.BHT.todayKey();
    const entriesToday = entries.filter(e => e.date === todayKey);

    return `
      <div class="bht-ready-card">
        <div class="bht-ready-sub">${entries.length} entries · ${habits.length} habits · ${entriesToday.length} today</div>
        <h3 class="bht-ready-title">Ledger is live.</h3>
        <p style="font-family:var(--serif);font-size:15px;line-height:1.6;color:var(--tx2);margin:0 0 18px;max-width:56ch">
          The quick-logger grid, deep reflection modal, contribution heatmap, and weekly snapshot view will load in below. Log a slip or an urge whenever you notice one. The data flows into the same backup &amp; Gist sync as the rest of the OS.
        </p>
        <div class="bht-cta-row">
          <button class="bht-btn-primary" type="button" onclick="BHT_UI.openQuickLog()">Quick-log now</button>
          <span style="font-family:var(--mono);font-size:10px;color:var(--tx3);letter-spacing:1px">
            ⌘/Ctrl + Shift + B
          </span>
        </div>
      </div>
    `;
  }

  function renderBody() {
    const body = document.getElementById('bht-body');
    if (!body) return;
    body.innerHTML = isOnboarding() ? renderOnboarding() : renderReady();
  }

  function injectFAB() {
    if (document.getElementById('bht-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'bht-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Quick-log a behavior · Ctrl+Shift+B');
    fab.setAttribute('title', 'Quick-log (Ctrl+Shift+B)');
    fab.innerHTML = '＋<span class="bht-fab-hint">Quick-log · ⌃⇧B</span>';
    fab.addEventListener('click', () => openQuickLog());
    document.body.appendChild(fab);
  }

  function injectOverlay() {
    if (document.getElementById('bht-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'bht-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'bht-sheet-title');
    overlay.innerHTML = `
      <div class="bht-sheet" role="document">
        <div class="bht-sheet-hd">
          <div>
            <div class="bht-sheet-eyebrow">Quick Log</div>
            <h3 class="bht-sheet-title" id="bht-sheet-title">What happened?</h3>
          </div>
          <button class="bht-sheet-close" type="button" aria-label="Close" onclick="BHT_UI.closeQuickLog()">✕</button>
        </div>
        <div class="bht-sheet-body" id="bht-sheet-body">
          <p>Quick-logger loading…</p>
        </div>
      </div>
    `;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeQuickLog();
    });
    document.body.appendChild(overlay);
  }

  let _lastFocus = null;

  function openQuickLog() {
    const overlay = document.getElementById('bht-overlay');
    if (!overlay) return;
    _lastFocus = document.activeElement;
    overlay.classList.add('is-open');
    const close = overlay.querySelector('.bht-sheet-close');
    if (close) close.focus();
    document.body.style.overflow = 'hidden';
  }
  function closeQuickLog() {
    const overlay = document.getElementById('bht-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    if (_lastFocus && typeof _lastFocus.focus === 'function') {
      try { _lastFocus.focus(); } catch (e) {}
    }
  }
  function initialize() {
    const meta = global.Store.get('bht.meta') || {};
    meta.initialized = true;
    meta.initializedAt = new Date().toISOString();
    global.Store.set('bht.meta', meta);
    goto();
    renderBody();
  }

  function goto() {
    // Direct route to the behavior section — bypasses NAV_GROUPS which is
    // const-scoped inside app.js and not reachable from this module.
    if (typeof global.show === 'function') global.show(SECTION_ID);
    else {
      document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(SECTION_ID);
      if (sec) sec.classList.add('active');
    }
    document.querySelectorAll('.nmb').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
    const btn = document.querySelector('.nmb[data-group="' + GROUP_KEY + '"]');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-current', 'page'); }
    // Clear any sub-nav from the previously-active group
    const sub = document.getElementById('nav-sub');
    if (sub) { sub.innerHTML = ''; sub.dataset.group = GROUP_KEY; }
    try { localStorage.setItem('dune_activesec', JSON.stringify(SECTION_ID)); } catch (e) {}
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
    return false;
  }
  function installHotkey() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overlay = document.getElementById('bht-overlay');
        if (overlay && overlay.classList.contains('is-open')) {
          e.preventDefault();
          closeQuickLog();
        }
        return;
      }
      const isB = (e.key === 'B' || e.key === 'b' || e.code === 'KeyB');
      const mod = (e.ctrlKey || e.metaKey) && e.shiftKey;
      if (!isB || !mod) return;
      if (isTypingTarget(e.target || document.activeElement)) return;
      e.preventDefault();
      const overlay = document.getElementById('bht-overlay');
      if (overlay && overlay.classList.contains('is-open')) closeQuickLog();
      else openQuickLog();
    });
  }

  function boot() {
    injectStyles();
    injectNavButton();
    injectSection();
    registerNavGroup();
    injectFAB();
    injectOverlay();
    installHotkey();
    renderBody();

    global.Store.subscribe('bht', () => renderBody());

    const last = (function () {
      try { return JSON.parse(localStorage.getItem('dune_activesec') || '""'); }
      catch (e) { return ''; }
    })();
    if (last === SECTION_ID && typeof global.show === 'function') {
      global.show(SECTION_ID);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_UI = {
    openQuickLog,
    closeQuickLog,
    initialize,
    goto,
    rerender: renderBody,
    GROUP_KEY,
    SECTION_ID
  };
})(window);
