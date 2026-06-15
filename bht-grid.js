// ============================================================
// DUNE LIFE OS — BHT · INTERACTIVE GRID (Editorial Paper-Glass)
// Replaces the SVG heatmap with a clickable CSS-grid + frosted
// popover. Maps green/red/volume clicks onto the existing
// HabitEntry schema. Writes summary metrics to bht.metrics so
// other modules can read them.
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store || !global.BHT || !global.BHT_UI || !global.BHT_ANALYTICS) {
    console.error('[BHT-GRID] earlier phases must load first.');
    return;
  }

  const HABIT_NAME  = 'DUKU';
  const WINDOW_DAYS = 30;

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────
  function nowISO() { return new Date().toISOString(); }
  function uid(p)   { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad2(n)  { return n < 10 ? '0' + n : '' + n; }
  function ymd(d)   { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function todayYMD() { return ymd(new Date()); }
  function ymdBack(n) {
    const d = new Date(); d.setDate(d.getDate() - n);
    return ymd(d);
  }
  function fmtNice(s) {
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d)) return s;
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  }
  function getDuku() {
    const slice = global.Store.get('bht') || {};
    return (slice.habits || []).find(h => h.name === HABIT_NAME && !h.archived);
  }

  // ──────────────────────────────────────────────
  // DAY MAP · derive per-day status from existing entries
  // ──────────────────────────────────────────────
  function buildDayMap() {
    const duku = getDuku();
    if (!duku) return null;
    const slice = global.Store.get('bht') || {};
    const today = todayYMD();
    const dates = [];
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) dates.push(ymdBack(i));

    const byDate = {};
    for (const d of dates) byDate[d] = { date: d, status: 'unmarked', volume: 0, entries: [] };

    for (const e of slice.entries || []) {
      if (e.habitId !== duku.id) continue;
      if (!byDate[e.date]) continue;
      byDate[e.date].entries.push(e);
    }
    for (const d of dates) {
      const slot = byDate[d];
      if (slot.entries.length === 0) continue;
      // latest entry wins for ambiguous days
      const sorted = slot.entries.slice().sort((a, b) =>
        new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      const latest = sorted[0];
      if (latest.occurred) {
        slot.status = 'slip';
        slot.volume = slot.entries
          .filter(e => e.occurred)
          .reduce((a, e) => a + (e.frequency || 1), 0);
      } else if (latest.resisted) {
        slot.status = 'success';
      }
    }
    return { dates, byDate, today, dukuId: duku.id };
  }

  // ──────────────────────────────────────────────
  // FIND HEATMAP CARD
  // ──────────────────────────────────────────────
  function findHeatmapCard() {
    const host = document.getElementById('bht-analytics');
    if (!host) return null;
    const cards = host.querySelectorAll('.bht-an-card');
    for (const c of cards) {
      if (c.querySelector('svg[aria-label*="contribution"]')) return c;
      if (c.querySelector('.bht-glass-grid-wrap')) return c;
    }
    return cards[0] || null;
  }

  // ──────────────────────────────────────────────
  // RENDER · idempotent, disconnects observer during own mutations
  // ──────────────────────────────────────────────
  let _renderTimer = null;
  let _observer = null;
  function scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(renderGrid, 40);
  }
  function attachObserver() {
    const target = document.getElementById('bht-body') || document.body;
    if (_observer) _observer.disconnect();
    _observer.observe(target, { childList: true, subtree: true });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function renderGrid() {
    const card = findHeatmapCard();
    if (!card) return;
    const data = buildDayMap();
    if (!data) return;

    // Detach observer so our own mutations don't fire infinite re-renders.
    // The Store.set inside writeMetrics fires the rerender chain
    // synchronously; we re-attach after that settles.
    if (_observer) _observer.disconnect();

    // Strip the legacy SVG / legend / stat row from the card
    const svg = card.querySelector('.bht-an-svg'); if (svg) svg.remove();
    const legend = card.querySelector('.bht-an-legend'); if (legend) legend.remove();
    const oldStat = card.querySelector('.bht-an-stat-row'); if (oldStat) oldStat.remove();

    let wrap = card.querySelector('.bht-glass-grid-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'bht-glass-grid-wrap';
      card.appendChild(wrap);
    }

    const { dates, byDate, today } = data;
    const firstDate  = dates[0];
    const firstJsDay = new Date(firstDate + 'T00:00:00').getDay();
    const firstMon   = (firstJsDay + 6) % 7;

    const colLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      .map(d => `<span class="bht-glass-col-l">${d}</span>`).join('');

    const cellHtml = [];
    for (let i = 0; i < firstMon; i++) {
      cellHtml.push('<span class="bht-glass-cell-pad"></span>');
    }
    for (const date of dates) {
      const d = byDate[date];
      const isToday = (date === today);
      const dayNum = parseInt(date.slice(8, 10), 10);
      const aria = `${date} — ${d.status === 'unmarked' ? 'no entry' : d.status}${d.volume > 0 ? ', ' + d.volume + ' times' : ''}. Click to edit.`;
      cellHtml.push(
        `<button class="bht-glass-cell ${d.status}${isToday ? ' is-today' : ''}" ` +
        `type="button" data-date="${esc(date)}" title="${esc(date)}" aria-label="${esc(aria)}">` +
        `<span class="bht-glass-cell-day">${dayNum}</span>` +
        (d.volume > 1 ? `<span class="bht-glass-cell-vol">${d.volume}</span>` : '') +
        `</button>`
      );
    }

    const cleanDays = dates.filter(d => byDate[d].status === 'success').length;
    const slipDays  = dates.filter(d => byDate[d].status === 'slip').length;
    const totalVol  = dates.reduce((a, d) => a + (byDate[d].volume || 0), 0);
    const streak    = computeStreak();

    wrap.innerHTML = `
      <div class="bht-glass-col-labels">${colLabels}</div>
      <div class="bht-glass-cells">${cellHtml.join('')}</div>
      <div class="bht-glass-stats">
        <div class="bht-glass-stat"><div class="l">Clean streak</div><div class="v"><em>${streak === null ? '—' : streak + 'd'}</em></div></div>
        <div class="bht-glass-stat"><div class="l">30d clean</div><div class="v">${cleanDays}</div></div>
        <div class="bht-glass-stat"><div class="l">30d slips</div><div class="v">${slipDays}</div></div>
        <div class="bht-glass-stat"><div class="l">Total volume</div><div class="v">${totalVol}</div></div>
      </div>
    `;

    wrap.querySelectorAll('.bht-glass-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        openPopover(cell, cell.dataset.date, data);
      });
    });

    writeMetrics({ streak, cleanDays, slipDays, totalVol });

    // Re-attach observer after the synchronous Store.set notify chain settles
    setTimeout(attachObserver, 120);
  }

  function computeStreak() {
    const duku = getDuku();
    if (!duku) return null;
    const slice = global.Store.get('bht') || {};
    const slips = (slice.entries || [])
      .filter(e => e.habitId === duku.id && e.occurred)
      .map(e => e.date)
      .sort();
    if (slips.length === 0) return null;
    const last = slips[slips.length - 1];
    const today = todayYMD();
    const ms = new Date(today + 'T00:00:00') - new Date(last + 'T00:00:00');
    return Math.max(0, Math.floor(ms / 86400000));
  }

  function writeMetrics(m) {
    const cur = global.Store.get('bht.metrics') || {};
    const next = {
      cleanStreakDays: m.streak === null ? null : m.streak,
      windowCleanDays: m.cleanDays,
      windowSlips: m.slipDays,
      windowVolume: m.totalVol,
      windowDays: WINDOW_DAYS,
      updatedAt: nowISO()
    };
    // skip if nothing of substance changed (ignore updatedAt for compare)
    const sameShape =
      cur.cleanStreakDays === next.cleanStreakDays &&
      cur.windowCleanDays === next.windowCleanDays &&
      cur.windowSlips     === next.windowSlips &&
      cur.windowVolume    === next.windowVolume &&
      cur.windowDays      === next.windowDays;
    if (sameShape) return;
    global.Store.set('bht.metrics', next);
  }

  // ──────────────────────────────────────────────
  // POPOVER
  // ──────────────────────────────────────────────
  function closePopover() {
    const p = document.getElementById('bht-glass-pop');
    if (p) p.remove();
    document.removeEventListener('click', outsideClickClose, true);
    document.removeEventListener('keydown', escClose);
  }
  function outsideClickClose(e) {
    const p = document.getElementById('bht-glass-pop');
    if (!p) return;
    if (p.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.bht-glass-cell')) return;
    closePopover();
  }
  function escClose(e) { if (e.key === 'Escape') closePopover(); }

  function positionPopover(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    const popW = 244;
    const popH = pop.offsetHeight || 150;
    let left = r.left + r.width / 2 - popW / 2;
    let top  = r.bottom + 8;
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (top + popH > window.innerHeight - 8) top = r.top - popH - 8;
    if (top < 8) top = 8;
    pop.style.left = left + 'px';
    pop.style.top  = top + 'px';
  }

  function openPopover(cell, date, data) {
    closePopover();
    const d = data.byDate[date] || { status: 'unmarked', volume: 0 };
    const pop = document.createElement('div');
    pop.id = 'bht-glass-pop';
    pop.className = 'bht-glass-pop';
    const dateLabel = (date === data.today ? 'Today · ' : '') + fmtNice(date);
    const startingVol = Math.max(1, d.volume || 1);
    pop.innerHTML = `
      <div class="bht-glass-pop-date">${esc(dateLabel)}</div>
      <div class="bht-glass-pop-btns">
        <button class="bht-glass-pop-btn green${d.status === 'success' ? ' is-on' : ''}" type="button" data-act="clean">✓ Clean day</button>
        <button class="bht-glass-pop-btn red${d.status === 'slip' ? ' is-on' : ''}" type="button" data-act="slip">✗ Slip</button>
      </div>
      <div class="bht-glass-pop-vol${d.status === 'slip' ? '' : ' is-hidden'}" id="bht-glass-vol-row">
        <span class="lbl">times</span>
        <button class="bht-glass-pop-vb" type="button" data-act="vol-dec" aria-label="decrease">−</button>
        <span class="bht-glass-pop-vn" id="bht-glass-vn">${startingVol}</span>
        <button class="bht-glass-pop-vb" type="button" data-act="vol-inc" aria-label="increase">+</button>
      </div>
      <button class="bht-glass-pop-clear" type="button" data-act="clear">clear this day</button>
    `;
    document.body.appendChild(pop);
    positionPopover(pop, cell);
    wirePopover(pop, date, data);
    setTimeout(() => {
      document.addEventListener('click', outsideClickClose, true);
      document.addEventListener('keydown', escClose);
    }, 0);
  }

  function wirePopover(pop, date, data) {
    pop.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === 'clean') {
          actClean(date, data.dukuId);
          closePopover();
        } else if (act === 'slip') {
          const vn = pop.querySelector('#bht-glass-vn');
          const vol = parseInt(vn ? vn.textContent : '1', 10) || 1;
          actSlip(date, data.dukuId, vol);
          // Show volume row, keep popover open
          const volRow = pop.querySelector('#bht-glass-vol-row');
          if (volRow) volRow.classList.remove('is-hidden');
          pop.querySelector('.bht-glass-pop-btn.green').classList.remove('is-on');
          pop.querySelector('.bht-glass-pop-btn.red').classList.add('is-on');
        } else if (act === 'vol-inc' || act === 'vol-dec') {
          const vn = pop.querySelector('#bht-glass-vn');
          let cur = parseInt(vn.textContent, 10) || 1;
          cur = act === 'vol-inc' ? cur + 1 : Math.max(1, cur - 1);
          vn.textContent = cur;
          actSetVolume(date, data.dukuId, cur);
        } else if (act === 'clear') {
          actClear(date, data.dukuId);
          closePopover();
        }
      });
    });
  }

  // ──────────────────────────────────────────────
  // ACTIONS · single Store.update per click = single notify
  // ──────────────────────────────────────────────
  function entryFor(habitId, date, opts) {
    return {
      id: uid('e'),
      habitId, date,
      occurred: !!opts.occurred,
      frequency: Math.max(1, opts.frequency || 1),
      severity: 'minor',
      urgeIntensity: 0,
      resisted: !!opts.resisted,
      copingMethod: '',
      moodBefore: [], moodAfter: [],
      triggers: [], notes: '',
      automaticThoughts: '', rationalChallenge: '',
      location: '', company: '',
      timeOfDay: 'Evening',
      sleepHours: null, stressLevel: null, energyLevel: null, confidenceLevel: null,
      entryMethod: 'quick-log',
      lifeEventId: null,
      recoveryActions: [],
      createdAt: nowISO(), updatedAt: nowISO()
    };
  }
  function actClean(date, habitId) {
    global.Store.update('bht.entries', list => {
      const kept = (list || []).filter(e => !(e.habitId === habitId && e.date === date));
      return kept.concat([entryFor(habitId, date, { occurred: false, resisted: true })]);
    });
  }
  function actSlip(date, habitId, volume) {
    global.Store.update('bht.entries', list => {
      const kept = (list || []).filter(e => !(e.habitId === habitId && e.date === date));
      return kept.concat([entryFor(habitId, date, { occurred: true, resisted: false, frequency: volume || 1 })]);
    });
  }
  function actSetVolume(date, habitId, volume) {
    global.Store.update('bht.entries', list => {
      let touched = false;
      const out = (list || []).map(e => {
        if (e.habitId === habitId && e.date === date && e.occurred) {
          touched = true;
          return Object.assign({}, e, { frequency: Math.max(1, volume), updatedAt: nowISO() });
        }
        return e;
      });
      if (!touched) {
        return out.concat([entryFor(habitId, date, { occurred: true, resisted: false, frequency: volume })]);
      }
      return out;
    });
  }
  function actClear(date, habitId) {
    global.Store.update('bht.entries', list =>
      (list || []).filter(e => !(e.habitId === habitId && e.date === date)));
  }

  // ──────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────
  function boot() {
    const origRerender = global.BHT_UI.rerender;
    global.BHT_UI.rerender = function () {
      origRerender();
      scheduleRender();
    };

    // Catch async analytics SVG paints
    _observer = new MutationObserver(scheduleRender);
    attachObserver();

    // Close popover on resize / scroll
    window.addEventListener('resize', closePopover);
    window.addEventListener('scroll', closePopover, { passive: true });

    scheduleRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_GRID = {
    renderGrid, buildDayMap, computeStreak,
    actClean, actSlip, actSetVolume, actClear,
    HABIT_NAME, WINDOW_DAYS
  };
})(window);
