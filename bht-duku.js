// ============================================================
// DUNE LIFE OS — BHT · DUKU MODE (single-habit overlay)
// One habit · 30-day window · clickable heatmap · recent-list delete
// Additive layer over Phases 1-5. No edits to other bht-*.js files.
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store || !global.BHT || !global.BHT_UI || !global.BHT_COMPONENTS || !global.BHT_ANALYTICS) {
    console.error('[BHT-DUKU] earlier phases must load first.');
    return;
  }

  const HABIT_NAME    = 'DUKU';
  const WINDOW_DAYS   = 30;
  const UNDO_MS       = 5000;
  const RECENT_LIMIT  = 12;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  // ──────────────────────────────────────────────
  // ONE-TIME MIGRATION · consolidate to a single DUKU habit
  // ──────────────────────────────────────────────
  function migrateToDuku() {
    const slice = global.Store.get('bht') || {};
    if (slice.meta && slice.meta.dukuMigrated) return;

    let habits = (slice.habits || []).slice();
    if (habits.length === 0) {
      // No habits at all — create DUKU from scratch
      const newHabit = global.BHT.addHabit({
        name: HABIT_NAME,
        category: 'focus',
        severityWeight: 3
      });
      habits = [newHabit];
    } else {
      // Pick a keeper: first non-archived, else first
      const keeperIdx = (() => {
        const i = habits.findIndex(h => !h.archived);
        return i >= 0 ? i : 0;
      })();
      const keeper = habits[keeperIdx];
      const keeperId = keeper.id;

      // Rename keeper to DUKU, archive the rest, re-tag all entries onto keeper
      habits = habits.map(h => {
        if (h.id === keeperId) return Object.assign({}, h, {
          name: HABIT_NAME, category: 'focus', severityWeight: 3, archived: false
        });
        return Object.assign({}, h, { archived: true });
      });
      const entries = (slice.entries || []).map(e =>
        Object.assign({}, e, { habitId: keeperId }));

      global.Store.set('bht.habits', habits);
      global.Store.set('bht.entries', entries);
    }

    const meta = global.Store.get('bht.meta') || {};
    meta.dukuMigrated = true;
    meta.initialized = true;
    global.Store.set('bht.meta', meta);
  }

  // Run synchronously at script load — before any boot() defers
  migrateToDuku();

  // ──────────────────────────────────────────────
  // 30-DAY WINDOW PATCH · narrows analytics scope
  // ──────────────────────────────────────────────
  (function patchWindow() {
    const orig = global.BHT_ANALYTICS.buildSnapshot;
    global.BHT_ANALYTICS.buildSnapshot = function () {
      const s = orig();
      s.days = WINDOW_DAYS;
      return s;
    };
  })();

  // ──────────────────────────────────────────────
  // STYLES
  // ──────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('bht-duku-styles')) return;
    const css = `
.bht-duku-tile {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 30px 32px;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  text-align: center;
  transition: background 140ms ease, transform 80ms ease, border-color 140ms ease;
  position: relative;
  min-height: 150px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px;
  margin-top: 18px;
}
.bht-duku-tile:hover { background: var(--bg); border-color: var(--bdr2); }
.bht-duku-tile:active { transform: scale(0.99); }
.bht-duku-tile.is-flash {
  background: var(--gold3); border-color: var(--gold);
  animation: bht-tile-pulse 700ms ease;
}
.bht-duku-tile:focus-visible { outline: 2px solid var(--gold2); outline-offset: 3px; }
.bht-duku-name {
  font-family: var(--serif); font-size: 38px; font-weight: 500;
  color: var(--tx); letter-spacing: 3px; line-height: 1; margin: 0;
}
.bht-duku-streak {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--gold2);
}
.bht-duku-streak.is-today { color: var(--tx3); }
.bht-duku-cta {
  font-family: var(--serif); font-style: italic; font-size: 14px;
  color: var(--tx3); margin-top: 2px;
}
.bht-duku-today-badge {
  position: absolute; top: 14px; right: 18px;
  font-family: var(--mono); font-size: 10px; font-weight: 600;
  background: var(--gold3); color: var(--gold2);
  padding: 4px 11px; border-radius: 100px;
  border: 1px solid rgba(154,120,50,0.22);
}
.bht-duku-today-badge.is-zero {
  background: transparent; color: var(--tx3); border-color: var(--bdr);
}
.bht-duku-reflect-link {
  position: absolute; top: 14px; left: 18px;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1px; text-transform: uppercase;
  color: var(--tx3); text-decoration: none;
  padding: 4px 10px; border: 1px solid var(--bdr2); border-radius: 4px;
  background: transparent; cursor: pointer;
}
.bht-duku-reflect-link:hover { background: var(--bg3); color: var(--gold2); }

.bht-duku-undo {
  margin-top: 8px;
  font-family: var(--mono); font-size: 10px; color: var(--tx3);
  text-align: center; letter-spacing: 1px; text-transform: uppercase;
  padding: 6px 0;
}
.bht-duku-undo-btn {
  background: transparent; border: none; color: var(--gold2);
  font-family: var(--mono); font-size: 10px;
  cursor: pointer; text-decoration: underline; padding: 0 0 0 4px;
  letter-spacing: 1px; text-transform: uppercase;
}

.bht-duku-recent {
  margin-top: 18px;
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 14px 18px;
}
.bht-duku-recent summary {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); cursor: pointer; outline: none;
  padding: 4px 0;
  list-style: none;
}
.bht-duku-recent summary::-webkit-details-marker { display: none; }
.bht-duku-recent summary::before {
  content: '▸ '; color: var(--gold2); display: inline-block; width: 14px;
  transition: transform 120ms ease;
}
.bht-duku-recent[open] summary::before { content: '▾ '; }
.bht-duku-recent-list { margin-top: 10px; }
.bht-duku-recent-row {
  display: grid;
  grid-template-columns: 1fr 80px 70px 30px;
  gap: 10px; align-items: center;
  padding: 7px 0; border-bottom: 1px dashed var(--bdr);
  font-family: var(--mono); font-size: 11px; color: var(--tx2);
}
.bht-duku-recent-row:last-child { border-bottom: none; }
.bht-duku-r-when { color: var(--tx); }
.bht-duku-r-sev { color: var(--gold2); text-transform: uppercase; letter-spacing: 0.8px; font-size: 9.5px; }
.bht-duku-r-sev.major { color: #a04040; }
.bht-duku-r-tod { color: var(--tx3); text-align: right; }
.bht-duku-r-rm {
  background: transparent; border: 1px solid transparent; color: var(--tx3);
  cursor: pointer; font-size: 14px; padding: 2px 6px;
  border-radius: 4px; line-height: 1;
}
.bht-duku-r-rm:hover { color: #a04040; border-color: #a040401a; background: rgba(160,64,64,0.04); }

/* heatmap clickability cues */
#bht-analytics .bht-an-svg rect[data-cell-date] {
  cursor: pointer;
  transition: opacity 100ms ease;
}
#bht-analytics .bht-an-svg rect[data-cell-date]:hover {
  opacity: 0.78;
}
#bht-analytics .bht-an-svg rect.is-today-cell {
  stroke: var(--gold) !important;
  stroke-width: 1.6 !important;
}
    `;
    const tag = document.createElement('style');
    tag.id = 'bht-duku-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ──────────────────────────────────────────────
  // SINGLE-TILE RENDER · replaces the multi-tile grid
  // ──────────────────────────────────────────────
  function getDukuHabit() {
    const slice = global.Store.get('bht') || {};
    return (slice.habits || []).find(h => h.name === HABIT_NAME && !h.archived);
  }

  function computeCleanStreakDays(entries) {
    const slips = entries.filter(e => e.occurred).map(e => e.date).sort();
    if (slips.length === 0) return null;
    const last = slips[slips.length - 1];
    const today = global.BHT.todayKey();
    const ms = new Date(today + 'T00:00:00') - new Date(last + 'T00:00:00');
    return Math.max(0, Math.floor(ms / 86400000));
  }
  function fmtRelDate(ymd) {
    const today = global.BHT.todayKey();
    if (ymd === today) return 'today';
    const yesterday = (() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    })();
    if (ymd === yesterday) return 'yesterday';
    return ymd;
  }

  function renderDukuMode() {
    const body = document.getElementById('bht-body');
    if (!body) return;
    const duku = getDukuHabit();
    if (!duku) return;
    if (isOnboarding()) return;

    const slice = global.Store.get('bht') || {};
    const entries = (slice.entries || []).filter(e => e.habitId === duku.id);
    const today = global.BHT.todayKey();
    const todayCount = entries.filter(e => e.date === today && e.occurred).length;
    const streak = computeCleanStreakDays(entries);
    const recent = entries.slice().sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)).slice(0, RECENT_LIMIT);

    // Remove the multi-tile grid (still emitted by bht-components.js)
    const oldGrid = body.querySelector('.bht-grid-wrap');
    if (oldGrid) oldGrid.remove();

    // Remove a previous DUKU host (idempotent re-render)
    const oldHost = document.getElementById('bht-duku-host');
    if (oldHost) oldHost.remove();

    const streakLabel = (todayCount > 0)
      ? `logged today · ${todayCount}`
      : streak === null
        ? 'no entries yet'
        : `${streak} day${streak === 1 ? '' : 's'} clean`;

    const host = document.createElement('div');
    host.id = 'bht-duku-host';
    host.innerHTML = `
      <div class="bht-duku-tile" role="button" tabindex="0" id="bht-duku-tile"
           aria-label="DUKU — tap to log today, click reflect for the deep form">
        <button class="bht-duku-reflect-link" type="button" id="bht-duku-reflect"
                aria-label="Open deep reflection">⋯ reflect</button>
        <span class="bht-duku-today-badge ${todayCount === 0 ? 'is-zero' : ''}">${todayCount} today</span>
        <div class="bht-duku-name">${esc(HABIT_NAME)}</div>
        <div class="bht-duku-streak ${todayCount > 0 ? 'is-today' : ''}">${esc(streakLabel)}</div>
        <div class="bht-duku-cta">${todayCount > 0 ? 'tap again to log another' : 'tap to log today'}</div>
      </div>
      <div class="bht-duku-undo" id="bht-duku-undo" style="display:none">
        <span>just logged · </span><button class="bht-duku-undo-btn" type="button">undo</button>
      </div>
      ${recent.length ? `
        <details class="bht-duku-recent" ${recent.length <= 5 ? 'open' : ''}>
          <summary>Recent entries · ${entries.length} total · click ✕ to remove</summary>
          <div class="bht-duku-recent-list">
            ${recent.map(e => `
              <div class="bht-duku-recent-row" data-entry-id="${esc(e.id)}">
                <span class="bht-duku-r-when">${esc(fmtRelDate(e.date))}</span>
                <span class="bht-duku-r-sev ${esc(e.severity)}">${esc(e.severity)}</span>
                <span class="bht-duku-r-tod">${esc(e.timeOfDay)}</span>
                <button class="bht-duku-r-rm" type="button" data-rm="${esc(e.id)}" aria-label="Remove this entry">✕</button>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
    `;
    // Insert before the analytics host so the tile sits at the top of the body
    const analytics = document.getElementById('bht-analytics');
    if (analytics) body.insertBefore(host, analytics);
    else body.appendChild(host);

    wireTile(host, duku);
  }

  function wireTile(host, duku) {
    const tile = host.querySelector('#bht-duku-tile');
    if (tile) {
      tile.addEventListener('click', (e) => {
        if (e.target.closest('#bht-duku-reflect')) return;
        onTapLog(tile, duku.id);
      });
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTapLog(tile, duku.id);
        }
      });
    }
    const reflect = host.querySelector('#bht-duku-reflect');
    if (reflect) {
      reflect.addEventListener('click', (e) => {
        e.stopPropagation();
        if (global.BHT_COMPONENTS && global.BHT_COMPONENTS.openReflectModal) {
          global.BHT_COMPONENTS.openReflectModal(duku.id);
        }
      });
    }
    host.querySelectorAll('.bht-duku-r-rm').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.rm;
        if (id && confirm('Remove this entry?')) {
          global.BHT.removeEntry(id);
        }
      });
    });
  }

  let _lastLoggedId = null;
  let _undoTimer = null;
  function onTapLog(tile, habitId) {
    const entry = global.BHT.logEntry({
      habitId,
      occurred: true,
      severity: 'minor',
      frequency: 1,
      entryMethod: 'quick-log'
    });
    _lastLoggedId = entry.id;
    if (tile) {
      tile.classList.add('is-flash');
      setTimeout(() => tile.classList.remove('is-flash'), 700);
    }
    showUndo();
  }
  function showUndo() {
    const u = document.getElementById('bht-duku-undo');
    if (!u) return;
    u.style.display = '';
    clearTimeout(_undoTimer);
    _undoTimer = setTimeout(() => {
      const el = document.getElementById('bht-duku-undo');
      if (el) el.style.display = 'none';
      _lastLoggedId = null;
    }, UNDO_MS);
    const btn = u.querySelector('.bht-duku-undo-btn');
    if (btn) {
      btn.onclick = () => {
        if (_lastLoggedId) global.BHT.removeEntry(_lastLoggedId);
        _lastLoggedId = null;
        u.style.display = 'none';
      };
    }
  }

  function isOnboarding() {
    const slice = global.Store.get('bht') || {};
    const entries = Array.isArray(slice.entries) ? slice.entries : [];
    const initialized = slice.meta && slice.meta.initialized;
    return entries.length === 0 && !initialized;
  }

  // ──────────────────────────────────────────────
  // HEATMAP CLICKABILITY · tap a cell to log/remove
  // ──────────────────────────────────────────────
  function decorateHeatmap() {
    const host = document.getElementById('bht-analytics');
    if (!host) return;
    const today = global.BHT.todayKey();

    // Update period labels
    host.querySelectorAll('.bht-an-eyebrow').forEach(eb => {
      if (/Last 90 days/.test(eb.textContent)) {
        eb.textContent = eb.textContent.replace(/Last 90 days/, 'Last 30 days');
      }
    });
    host.querySelectorAll('.bht-an-title').forEach(t => {
      if (/the last quarter/i.test(t.innerHTML)) {
        t.innerHTML = t.innerHTML.replace(/the last quarter/i, 'the last month');
      }
    });
    host.querySelectorAll('.bht-an-stat .l').forEach(l => {
      if (l.textContent === '90d slips') l.textContent = '30d slips';
      else if (l.textContent === '90d resists') l.textContent = '30d resists';
    });

    // Tag each cell with its date and wire the click
    const rects = host.querySelectorAll('.bht-an-svg rect');
    rects.forEach(rect => {
      const title = rect.querySelector('title');
      if (!title) return;
      const text = title.textContent || '';
      const m = text.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!m) return;
      const date = m[1];
      rect.setAttribute('data-cell-date', date);
      if (date === today) rect.classList.add('is-today-cell');
      if (rect._dukuWired) return;
      rect._dukuWired = true;
      rect.addEventListener('click', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        onCellClick(date);
      });
    });
  }

  function onCellClick(date) {
    const duku = getDukuHabit();
    if (!duku) return;
    const slice = global.Store.get('bht') || {};
    const existing = (slice.entries || []).filter(e =>
      e.habitId === duku.id && e.date === date && e.occurred);
    if (existing.length > 0) {
      const msg = existing.length === 1
        ? `Remove this day's log? (${date})`
        : `${existing.length} entries on ${date} — remove the most recent?`;
      if (!confirm(msg)) return;
      const target = existing.sort((a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt))[0];
      global.BHT.removeEntry(target.id);
    } else {
      // Quick log for that date — defaults to minor, time-of-day guessed from now
      global.BHT.logEntry({
        habitId: duku.id,
        date,
        occurred: true,
        severity: 'minor',
        frequency: 1,
        entryMethod: 'quick-log'
      });
    }
  }

  // ──────────────────────────────────────────────
  // BOOT · wrap the rerender chain
  // ──────────────────────────────────────────────
  function boot() {
    injectStyles();

    const origRerender = global.BHT_UI.rerender;
    global.BHT_UI.rerender = function () {
      origRerender();
      renderDukuMode();
    };

    // Decorate the heatmap whenever the analytics SVG (re)appears
    const obsTarget = document.getElementById('bht-body') || document.body;
    let decoTimer = null;
    new MutationObserver(() => {
      clearTimeout(decoTimer);
      decoTimer = setTimeout(decorateHeatmap, 40);
    }).observe(obsTarget, { childList: true, subtree: true });

    // First paint after our DUKU layer takes over the rerender chain
    global.BHT_UI.rerender();
    global.BHT_ANALYTICS.recompute();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_DUKU = {
    HABIT_NAME, WINDOW_DAYS,
    migrateToDuku, onTapLog, onCellClick, decorateHeatmap, renderDukuMode
  };
})(window);
