// ============================================================
// DUNE LIFE OS — BHT · COMPONENTS (Phase 3)
// Quick-logger tile grid · long-press reflect modal · CBT form
// Autosave on blur + debounced input · 60fps optimistic updates
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store || !global.BHT || !global.BHT_UI) {
    console.error('[BHT-COMP] Phase 1 + Phase 2 files must load first.');
    return;
  }

  const LONG_PRESS_MS    = 480;
  const AUTOSAVE_INPUT_MS = 350;
  const TAP_FLASH_MS     = 700;

  function injectStyles() {
    if (document.getElementById('bht-comp-styles')) return;
    const css = `
.bht-grid-wrap { margin-top: 18px; }
.bht-grid-eyebrow {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.8px; text-transform: uppercase; color: var(--tx3);
  display: flex; justify-content: space-between; align-items: baseline;
  margin-bottom: 10px;
}
.bht-grid-eyebrow .bht-ge-right { color: var(--gold2); }
.bht-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
}
@media (max-width: 540px) { .bht-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
.bht-tile {
  position: relative;
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 16px 16px 14px;
  cursor: pointer; user-select: none; -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
  display: flex; flex-direction: column; gap: 6px; min-height: 108px;
}
.bht-tile:hover { background: var(--bg); border-color: var(--bdr2); }
.bht-tile:active { transform: scale(0.985); }
.bht-tile.is-pressing { background: var(--gold3); border-color: rgba(154,120,50,0.32); }
.bht-tile.is-flash {
  background: var(--gold3); border-color: var(--gold);
  animation: bht-tile-pulse 700ms ease;
}
@keyframes bht-tile-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(154,120,50,0.35); }
  60%  { box-shadow: 0 0 0 10px rgba(154,120,50,0); }
  100% { box-shadow: 0 0 0 0 rgba(154,120,50,0); }
}
.bht-tile-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.bht-tile-name {
  font-family: var(--serif); font-size: 17px; line-height: 1.2;
  color: var(--tx); margin: 0; font-weight: 500;
}
.bht-tile-cat {
  font-family: var(--mono); font-size: 8.5px;
  letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--tx3); margin-top: 2px;
}
.bht-tile-reflect {
  background: transparent; border: 1px solid var(--bdr2);
  color: var(--tx3); border-radius: 4px;
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 14px; flex-shrink: 0;
  transition: background 100ms ease, color 100ms ease;
}
.bht-tile-reflect:hover { background: var(--bg3); color: var(--gold2); }
.bht-tile-foot {
  margin-top: auto;
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  font-family: var(--mono); font-size: 10px; color: var(--tx3); letter-spacing: 0.5px;
}
.bht-tile-count {
  background: var(--gold3); color: var(--gold2); font-weight: 600;
  padding: 2px 8px; border-radius: 100px; font-size: 10px;
}
.bht-tile-count.is-zero {
  background: transparent; color: var(--tx3); border: 1px solid var(--bdr);
}
.bht-tile-last { color: var(--tx2); }

#bht-reflect {
  position: fixed; inset: 0; z-index: 9200;
  background: rgba(26,24,20,0.48);
  display: none; align-items: flex-end; justify-content: center;
}
#bht-reflect.is-open { display: flex; }
#bht-reflect .bht-r-sheet {
  background: var(--bg2); width: 100%; max-width: 640px;
  max-height: 92vh; overflow-y: auto;
  border-radius: 10px 10px 0 0; border: 1px solid var(--bdr);
  padding: 24px 26px 26px;
  box-shadow: 0 -10px 32px rgba(26,24,20,0.22);
  animation: bht-sheet-up 200ms ease;
}
@media (min-width: 720px) {
  #bht-reflect { align-items: center; padding: 24px; }
  #bht-reflect .bht-r-sheet { border-radius: 10px; }
}
.bht-r-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
.bht-r-eyebrow {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.8px; text-transform: uppercase; color: var(--gold2);
  margin-bottom: 4px;
}
.bht-r-title {
  font-family: var(--serif); font-size: 24px; color: var(--tx);
  margin: 0; line-height: 1.2;
}
.bht-r-title em { font-style: italic; color: var(--gold); }
.bht-r-close {
  background: transparent; border: none; cursor: pointer;
  font-family: var(--mono); font-size: 18px; color: var(--tx3);
  padding: 4px 8px; border-radius: 4px;
}
.bht-r-close:hover { background: var(--bg3); color: var(--tx); }
.bht-r-saved {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.2px; color: var(--tx3); text-transform: uppercase;
  transition: color 200ms ease;
}
.bht-r-saved.is-active { color: var(--gold2); }

.bht-r-section { margin: 18px 0 0; }
.bht-r-section:first-of-type { margin-top: 0; }
.bht-r-label {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 8px;
  display: flex; align-items: baseline; justify-content: space-between;
}
.bht-r-label .bht-r-hint {
  font-family: var(--serif); font-style: italic;
  font-size: 12px; letter-spacing: 0; text-transform: none; color: var(--tx3);
  font-weight: 400;
}
.bht-r-chiprow { display: flex; flex-wrap: wrap; gap: 6px; }
.bht-r-chip {
  font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.4px;
  background: var(--bg); border: 1px solid var(--bdr2); color: var(--tx2);
  padding: 5px 11px; border-radius: 100px; cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
.bht-r-chip:hover { background: var(--bg3); color: var(--tx); }
.bht-r-chip.is-on {
  background: var(--gold3); color: var(--gold2);
  border-color: rgba(154,120,50,0.36);
}
.bht-r-chip-add {
  font-style: italic; font-family: var(--serif); font-size: 12px;
  color: var(--tx3); border-style: dashed;
}
.bht-r-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
@media (max-width: 540px) { .bht-r-pair { grid-template-columns: 1fr; } }
.bht-r-input, .bht-r-textarea, .bht-r-select {
  width: 100%; background: var(--bg); border: 1px solid var(--bdr);
  border-radius: 4px; padding: 9px 11px;
  font-family: var(--serif); font-size: 14.5px; color: var(--tx);
  line-height: 1.5; outline: none;
  transition: border-color 100ms ease, background 100ms ease;
  box-sizing: border-box;
}
.bht-r-input:focus, .bht-r-textarea:focus, .bht-r-select:focus {
  border-color: var(--gold); background: var(--bg2);
}
.bht-r-textarea { min-height: 84px; resize: vertical; }
.bht-r-select {
  font-family: var(--mono); font-size: 12px;
  -webkit-appearance: none; appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--tx3) 50%),
                    linear-gradient(135deg, var(--tx3) 50%, transparent 50%);
  background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 28px;
}
.bht-r-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
@media (max-width: 540px) { .bht-r-row3 { grid-template-columns: 1fr 1fr; } }
.bht-r-recovery-row {
  display: flex; gap: 8px; align-items: center; margin-bottom: 6px;
}
.bht-r-recovery-row input[type="checkbox"] { accent-color: var(--gold); flex-shrink: 0; }
.bht-r-recovery-row .bht-r-input { flex: 1; }
.bht-r-recovery-row .bht-r-rm {
  background: transparent; border: none; color: var(--tx3);
  cursor: pointer; font-family: var(--mono); font-size: 14px; padding: 4px 6px;
}
.bht-r-recovery-row .bht-r-rm:hover { color: var(--red); }
.bht-r-add-row {
  font-family: var(--serif); font-style: italic; font-size: 12.5px;
  color: var(--gold2); background: transparent; border: none;
  cursor: pointer; padding: 4px 0; margin-top: 4px;
}
.bht-r-foot {
  margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--bdr);
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  flex-wrap: wrap;
}
.bht-r-discard {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1px; text-transform: uppercase;
  background: transparent; border: 1px solid var(--bdr2); color: var(--tx3);
  padding: 8px 14px; border-radius: 4px; cursor: pointer;
}
.bht-r-discard:hover { color: var(--red); border-color: var(--red); }
.bht-r-done {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: var(--gold); color: var(--bg2);
  border: 1px solid var(--gold2);
  padding: 10px 22px; border-radius: 4px; cursor: pointer;
}
.bht-r-done:hover { background: var(--gold2); }
    `;
    const tag = document.createElement('style');
    tag.id = 'bht-comp-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function relTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 45)       return 'just now';
    if (s < 90)       return '1m ago';
    if (s < 3600)     return Math.floor(s / 60) + 'm ago';
    if (s < 5400)     return '1h ago';
    if (s < 86400)    return Math.floor(s / 3600) + 'h ago';
    if (s < 172800)   return 'yesterday';
    return Math.floor(s / 86400) + 'd ago';
  }
  function tilesFor(slice) {
    const habits = (slice.habits || []).filter(h => !h.archived);
    const entries = slice.entries || [];
    const today = global.BHT.todayKey();
    return habits.map(h => {
      const hisEntries = entries.filter(e => e.habitId === h.id);
      const todays = hisEntries.filter(e => e.date === today && e.occurred);
      const last = hisEntries.length
        ? hisEntries.reduce((a, b) =>
            (new Date(a.updatedAt || a.createdAt) > new Date(b.updatedAt || b.createdAt)) ? a : b)
        : null;
      return {
        id: h.id, name: h.name, category: h.category,
        countToday: todays.length,
        lastAt: last ? (last.updatedAt || last.createdAt) : null
      };
    });
  }

  function renderGridHTML(slice) {
    const tiles = tilesFor(slice);
    if (tiles.length === 0) {
      return `<div class="bht-grid-wrap"><div class="bht-grid-eyebrow"><span>Quick Logger</span></div>
        <div class="bht-ready-card" style="text-align:center">
          <p style="font-family:var(--serif);font-size:15px;color:var(--tx2);margin:0">
            No active habits yet.
          </p></div></div>`;
    }
    const today = global.BHT.todayKey();
    const tilesHTML = tiles.map(t => `
      <div class="bht-tile" data-habit-id="${escapeHtml(t.id)}" role="button" tabindex="0"
           aria-label="Log ${escapeHtml(t.name)}">
        <div class="bht-tile-hd">
          <div>
            <h4 class="bht-tile-name">${escapeHtml(t.name)}</h4>
            <div class="bht-tile-cat">${escapeHtml(t.category)}</div>
          </div>
          <button class="bht-tile-reflect" type="button"
                  aria-label="Open reflection for ${escapeHtml(t.name)}"
                  data-reflect-habit="${escapeHtml(t.id)}">⋯</button>
        </div>
        <div class="bht-tile-foot">
          <span class="bht-tile-count ${t.countToday === 0 ? 'is-zero' : ''}">${t.countToday} today</span>
          <span class="bht-tile-last">${relTime(t.lastAt)}</span>
        </div>
      </div>
    `).join('');
    return `
      <div class="bht-grid-wrap">
        <div class="bht-grid-eyebrow">
          <span>Quick Logger · ${escapeHtml(today)}</span>
          <span class="bht-ge-right">Tap = log · long-press or ⋯ = reflect</span>
        </div>
        <div class="bht-grid">${tilesHTML}</div>
      </div>
    `;
  }

  function wireTiles(scopeEl) {
    if (!scopeEl) return;
    scopeEl.querySelectorAll('.bht-tile').forEach(tile => {
      const habitId = tile.dataset.habitId;
      attachPressGestures(tile, habitId);
    });
    scopeEl.querySelectorAll('.bht-tile-reflect').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        openReflectModal(btn.dataset.reflectHabit);
      });
    });
  }

  function attachPressGestures(tile, habitId) {
    let timer = null;
    let longFired = false;
    let startX = 0, startY = 0;
    const MOVE_TOLERANCE = 10;

    function start(x, y) {
      longFired = false;
      startX = x; startY = y;
      tile.classList.add('is-pressing');
      timer = setTimeout(() => {
        longFired = true;
        tile.classList.remove('is-pressing');
        openReflectModal(habitId);
      }, LONG_PRESS_MS);
    }
    function cancel() {
      clearTimeout(timer); timer = null;
      tile.classList.remove('is-pressing');
    }
    function end() {
      const wasLong = longFired;
      cancel();
      if (!wasLong) tapLog(tile, habitId);
    }
    function move(x, y) {
      if (Math.abs(x - startX) > MOVE_TOLERANCE || Math.abs(y - startY) > MOVE_TOLERANCE) cancel();
    }

    tile.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.bht-tile-reflect')) return;
      start(e.clientX, e.clientY);
    });
    tile.addEventListener('mouseup', (e) => {
      if (e.target.closest('.bht-tile-reflect')) return;
      if (timer || longFired) end();
    });
    tile.addEventListener('mouseleave', cancel);
    tile.addEventListener('mousemove', (e) => { if (timer) move(e.clientX, e.clientY); });

    tile.addEventListener('touchstart', (e) => {
      if (e.target.closest('.bht-tile-reflect')) return;
      const t = e.touches[0]; if (!t) return;
      start(t.clientX, t.clientY);
    }, { passive: true });
    tile.addEventListener('touchend', (e) => {
      if (e.target.closest('.bht-tile-reflect')) return;
      if (timer || longFired) {
        if (longFired) e.preventDefault();
        end();
      }
    });
    tile.addEventListener('touchmove', (e) => {
      const t = e.touches[0]; if (!t || !timer) return;
      move(t.clientX, t.clientY);
    }, { passive: true });
    tile.addEventListener('touchcancel', cancel);

    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        tapLog(tile, habitId);
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault();
        openReflectModal(habitId);
      }
    });
  }

  function tapLog(tile, habitId) {
    const entry = global.BHT.logEntry({
      habitId, occurred: true, severity: 'minor',
      frequency: 1, entryMethod: 'quick-log'
    });
    if (tile && tile.parentNode) {
      tile.classList.add('is-flash');
      setTimeout(() => tile.classList.remove('is-flash'), TAP_FLASH_MS);
    }
    return entry;
  }

  function injectReflectModal() {
    if (document.getElementById('bht-reflect')) return;
    const m = document.createElement('div');
    m.id = 'bht-reflect';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'bht-r-title');
    m.innerHTML = `<div class="bht-r-sheet" role="document" id="bht-r-sheet"></div>`;
    m.addEventListener('click', (e) => { if (e.target === m) closeReflectModal(); });
    document.body.appendChild(m);
  }

  let _openEntryId = null;
  let _openHabitId = null;
  let _lastFocus   = null;
  let _inputTimer  = null;
  let _savedTimer  = null;

  function chipsHTML(values, selected, kind) {
    return values.map(v => {
      const on = selected.indexOf(v) !== -1;
      return `<button type="button" class="bht-r-chip ${on ? 'is-on' : ''}" data-chip-kind="${kind}" data-chip-val="${escapeHtml(v)}">${escapeHtml(v)}</button>`;
    }).join('') +
    `<button type="button" class="bht-r-chip bht-r-chip-add" data-chip-add="${kind}">+ add</button>`;
  }
  function recoveryRowsHTML(actions) {
    if (!actions || actions.length === 0) actions = [{ text: '', done: false }];
    return actions.map((a, i) => `
      <div class="bht-r-recovery-row" data-rec-idx="${i}">
        <input type="checkbox" class="bht-r-rec-done" ${a.done ? 'checked' : ''} aria-label="Done">
        <input type="text" class="bht-r-input bht-r-rec-text" value="${escapeHtml(a.text)}" placeholder="Next small step (e.g. wudu + walk · phone in drawer · sleep at 22:30)">
        <button type="button" class="bht-r-rm" aria-label="Remove">✕</button>
      </div>
    `).join('');
  }

  function modalHTML(habit, entry, vocab) {
    const moodsBefore = entry.moodBefore || [];
    const moodsAfter  = entry.moodAfter  || [];
    const triggers    = entry.triggers   || [];
    const recovery    = entry.recoveryActions || [];
    return `
      <div class="bht-r-hd">
        <div>
          <div class="bht-r-eyebrow">Reflection · ${escapeHtml(habit.category)}</div>
          <h3 class="bht-r-title" id="bht-r-title">${escapeHtml(habit.name)} — <em>what happened?</em></h3>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <button class="bht-r-close" type="button" aria-label="Close" data-action="close">✕</button>
          <span class="bht-r-saved" id="bht-r-saved">draft autosaving</span>
        </div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Context <span class="bht-r-hint">when, how strong, how serious</span></div>
        <div class="bht-r-row3">
          <select class="bht-r-select" data-field="timeOfDay" aria-label="Time of day">
            ${['Morning','Afternoon','Evening','Night'].map(t =>
              `<option value="${t}" ${entry.timeOfDay === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
          <select class="bht-r-select" data-field="severity" aria-label="Severity">
            ${['minor','moderate','major'].map(s =>
              `<option value="${s}" ${entry.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
          <select class="bht-r-select" data-field="urgeIntensity" aria-label="Urge intensity">
            ${[0,1,2,3,4,5,6,7,8,9,10].map(n =>
              `<option value="${n}" ${entry.urgeIntensity === n ? 'selected' : ''}>urge ${n}/10</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Mood before <span class="bht-r-hint">what state were you in?</span></div>
        <div class="bht-r-chiprow" data-chip-container="moodBefore">${chipsHTML(vocab.moods, moodsBefore, 'moodBefore')}</div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Triggers <span class="bht-r-hint">what pulled you toward it?</span></div>
        <div class="bht-r-chiprow" data-chip-container="triggers">${chipsHTML(vocab.triggers, triggers, 'triggers')}</div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-pair">
          <div>
            <div class="bht-r-label">Location</div>
            <input class="bht-r-input" type="text" data-field="location" value="${escapeHtml(entry.location)}" placeholder="home · cafe · shift room…">
          </div>
          <div>
            <div class="bht-r-label">Company</div>
            <input class="bht-r-input" type="text" data-field="company" value="${escapeHtml(entry.company)}" placeholder="alone · with X…">
          </div>
        </div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Automatic thoughts <span class="bht-r-hint">what was the voice in your head?</span></div>
        <textarea class="bht-r-textarea" data-field="automaticThoughts" placeholder="“just one won't matter” · “I'll start fresh tomorrow”…">${escapeHtml(entry.automaticThoughts)}</textarea>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Rational challenge <span class="bht-r-hint">if a friend told you this, what would you say back?</span></div>
        <textarea class="bht-r-textarea" data-field="rationalChallenge" placeholder="evidence for / against · what a kinder, sharper version of you would say…">${escapeHtml(entry.rationalChallenge)}</textarea>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Mood after <span class="bht-r-hint">how do you feel right now?</span></div>
        <div class="bht-r-chiprow" data-chip-container="moodAfter">${chipsHTML(vocab.moods, moodsAfter, 'moodAfter')}</div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-pair">
          <div>
            <div class="bht-r-label">Coping method used</div>
            <input class="bht-r-input" type="text" data-field="copingMethod" value="${escapeHtml(entry.copingMethod)}" list="bht-r-coping-list" placeholder="${vocab.coping.slice(0,3).join(' · ')}…">
            <datalist id="bht-r-coping-list">
              ${vocab.coping.map(c => `<option value="${escapeHtml(c)}">`).join('')}
            </datalist>
          </div>
          <div>
            <div class="bht-r-label">Resisted the urge?</div>
            <select class="bht-r-select" data-field="resisted">
              <option value="false" ${!entry.resisted ? 'selected' : ''}>no — it happened</option>
              <option value="true"  ${ entry.resisted ? 'selected' : ''}>yes — resisted</option>
            </select>
          </div>
        </div>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Recovery actions <span class="bht-r-hint">what small steps come next?</span></div>
        <div id="bht-r-recovery">${recoveryRowsHTML(recovery)}</div>
        <button type="button" class="bht-r-add-row" data-action="add-recovery">+ add another step</button>
      </div>

      <div class="bht-r-section">
        <div class="bht-r-label">Notes</div>
        <textarea class="bht-r-textarea" data-field="notes" placeholder="anything else worth keeping…">${escapeHtml(entry.notes)}</textarea>
      </div>

      <div class="bht-r-foot">
        <button class="bht-r-discard" type="button" data-action="discard">discard entry</button>
        <button class="bht-r-done"    type="button" data-action="close">done</button>
      </div>
    `;
  }

  function openReflectModal(habitId, existingEntryId) {
    injectReflectModal();
    const slice  = global.Store.get('bht') || {};
    const habit  = (slice.habits || []).find(h => h.id === habitId);
    if (!habit) return;
    const vocab  = slice.vocab || { moods: [], triggers: [], coping: [] };

    let entry;
    if (existingEntryId) {
      entry = (slice.entries || []).find(e => e.id === existingEntryId);
    }
    if (!entry) {
      entry = global.BHT.logEntry({
        habitId, occurred: true, severity: 'moderate',
        frequency: 1, entryMethod: 'manual'
      });
    }
    _openEntryId = entry.id;
    _openHabitId = habitId;

    const sheet = document.getElementById('bht-r-sheet');
    sheet.innerHTML = modalHTML(habit, entry, vocab);
    wireModal(sheet);

    _lastFocus = document.activeElement;
    document.getElementById('bht-reflect').classList.add('is-open');
    document.body.style.overflow = 'hidden';
    const firstChip = sheet.querySelector('.bht-r-chip');
    if (firstChip) firstChip.focus();
  }

  function closeReflectModal() {
    flushPending();
    const m = document.getElementById('bht-reflect');
    if (m) m.classList.remove('is-open');
    document.body.style.overflow = '';
    _openEntryId = null;
    _openHabitId = null;
    if (_lastFocus && typeof _lastFocus.focus === 'function') {
      try { _lastFocus.focus(); } catch (e) {}
    }
  }

  function discardEntry() {
    if (_openEntryId) global.BHT.removeEntry(_openEntryId);
    _openEntryId = null;
    closeReflectModal();
  }

  function flashSaved() {
    const el = document.getElementById('bht-r-saved');
    if (!el) return;
    el.textContent = 'saved';
    el.classList.add('is-active');
    clearTimeout(_savedTimer);
    _savedTimer = setTimeout(() => {
      if (!el) return;
      el.textContent = 'draft autosaving';
      el.classList.remove('is-active');
    }, 1200);
  }
  function flushPending() {
    if (_inputTimer) { clearTimeout(_inputTimer); _inputTimer = null; }
  }
  function patchEntry(patch) {
    if (!_openEntryId) return;
    global.BHT.updateEntry(_openEntryId, patch);
    flashSaved();
  }
  function scheduleTextPatch(field, value) {
    if (_inputTimer) clearTimeout(_inputTimer);
    _inputTimer = setTimeout(() => patchEntry({ [field]: value }), AUTOSAVE_INPUT_MS);
  }

  function readChips(sheet, kind) {
    return Array.from(sheet.querySelectorAll(`[data-chip-container="${kind}"] .bht-r-chip.is-on`))
      .map(b => b.dataset.chipVal);
  }
  function readRecovery(sheet) {
    return Array.from(sheet.querySelectorAll('#bht-r-recovery .bht-r-recovery-row'))
      .map(row => ({
        text: row.querySelector('.bht-r-rec-text').value.trim(),
        done: row.querySelector('.bht-r-rec-done').checked
      }))
      .filter(r => r.text.length > 0 || r.done);
  }
  function persistRecovery(sheet) {
    patchEntry({ recoveryActions: readRecovery(sheet) });
  }
  function persistChips(sheet, kind) {
    patchEntry({ [kind]: readChips(sheet, kind) });
  }

  function addVocab(kind, value) {
    const path = (kind === 'moodBefore' || kind === 'moodAfter') ? 'bht.vocab.moods' :
                 kind === 'triggers'                              ? 'bht.vocab.triggers' :
                 null;
    if (!path) return;
    const cur = global.Store.get(path) || [];
    if (cur.indexOf(value) === -1) global.Store.set(path, cur.concat([value]));
  }

  function wireModal(sheet) {
    sheet.querySelectorAll('[data-action="close"]').forEach(b =>
      b.addEventListener('click', () => closeReflectModal()));
    const discard = sheet.querySelector('[data-action="discard"]');
    if (discard) discard.addEventListener('click', () => discardEntry());

    sheet.querySelectorAll('[data-field]').forEach(el => {
      const field = el.dataset.field;
      const isNumeric = (field === 'urgeIntensity');
      const isBool    = (field === 'resisted');
      const coerce = (v) => isNumeric ? parseInt(v, 10) : isBool ? (v === 'true') : v;

      if (el.tagName === 'SELECT') {
        el.addEventListener('change', () => patchEntry({ [field]: coerce(el.value) }));
      } else {
        el.addEventListener('input', () => scheduleTextPatch(field, el.value));
        el.addEventListener('blur',  () => { flushPending(); patchEntry({ [field]: el.value }); });
      }
    });

    sheet.querySelectorAll('.bht-r-chip[data-chip-kind]').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('is-on');
        persistChips(sheet, chip.dataset.chipKind);
      });
    });

    sheet.querySelectorAll('.bht-r-chip[data-chip-add]').forEach(addBtn => {
      addBtn.addEventListener('click', () => {
        const kind = addBtn.dataset.chipAdd;
        const v = (prompt('Add a new tag') || '').trim().slice(0, 28);
        if (!v) return;
        addVocab(kind, v);
        const slice = global.Store.get('bht');
        const entry = (slice.entries || []).find(e => e.id === _openEntryId);
        const vocabList = (kind === 'triggers') ? slice.vocab.triggers : slice.vocab.moods;
        const selected = (entry && entry[kind]) ? entry[kind].concat([v]) : [v];
        const container = sheet.querySelector(`[data-chip-container="${kind}"]`);
        container.innerHTML = chipsHTML(vocabList, selected, kind);
        container.querySelectorAll('.bht-r-chip[data-chip-kind]').forEach(chip => {
          chip.addEventListener('click', () => {
            chip.classList.toggle('is-on');
            persistChips(sheet, chip.dataset.chipKind);
          });
        });
        const newAdd = container.querySelector('.bht-r-chip[data-chip-add]');
        if (newAdd) {
          const clone = newAdd.cloneNode(true);
          newAdd.parentNode.replaceChild(clone, newAdd);
          clone.addEventListener('click', () => addBtn.click());
        }
        persistChips(sheet, kind);
      });
    });

    const recovery = sheet.querySelector('#bht-r-recovery');
    function wireRow(row) {
      row.querySelector('.bht-r-rec-done').addEventListener('change', () => persistRecovery(sheet));
      const txt = row.querySelector('.bht-r-rec-text');
      txt.addEventListener('input', () => {
        if (_inputTimer) clearTimeout(_inputTimer);
        _inputTimer = setTimeout(() => persistRecovery(sheet), AUTOSAVE_INPUT_MS);
      });
      txt.addEventListener('blur', () => { flushPending(); persistRecovery(sheet); });
      row.querySelector('.bht-r-rm').addEventListener('click', () => {
        row.parentNode.removeChild(row);
        persistRecovery(sheet);
      });
    }
    recovery.querySelectorAll('.bht-r-recovery-row').forEach(wireRow);

    sheet.querySelector('[data-action="add-recovery"]').addEventListener('click', () => {
      const idx = recovery.querySelectorAll('.bht-r-recovery-row').length;
      const wrap = document.createElement('div');
      wrap.innerHTML = recoveryRowsHTML([{ text: '', done: false }]);
      const row = wrap.firstElementChild;
      row.dataset.recIdx = String(idx);
      recovery.appendChild(row);
      wireRow(row);
      row.querySelector('.bht-r-rec-text').focus();
    });
  }

  const _origRerender = global.BHT_UI.rerender;

  function isOnboarding() {
    const slice = global.Store.get('bht') || {};
    const entries = Array.isArray(slice.entries) ? slice.entries : [];
    const initialized = slice.meta && slice.meta.initialized;
    return entries.length === 0 && !initialized;
  }

  function renderSectionBody() {
    const body = document.getElementById('bht-body');
    if (!body) return;
    if (isOnboarding()) {
      _origRerender();
      return;
    }
    const slice = global.Store.get('bht') || {};
    const today = global.BHT.todayKey();
    const todays = (slice.entries || []).filter(e => e.date === today && e.occurred).length;
    body.innerHTML = `
      <div class="bht-ready-card" style="padding:18px 22px">
        <div class="bht-ready-sub">${slice.entries.length} entries · ${todays} today</div>
        <h3 class="bht-ready-title" style="margin-bottom:0">Ledger is live.</h3>
      </div>
      ${renderGridHTML(slice)}
    `;
    wireTiles(body);
  }

  function renderOverlayBody() {
    const overlayBody = document.getElementById('bht-sheet-body');
    if (!overlayBody) return;
    const slice = global.Store.get('bht') || {};
    overlayBody.innerHTML = renderGridHTML(slice);
    wireTiles(overlayBody);
  }

  global.BHT_UI.rerender = function () { renderSectionBody(); renderOverlayBody(); };

  const _origOpen = global.BHT_UI.openQuickLog;
  global.BHT_UI.openQuickLog = function () {
    renderOverlayBody();
    _origOpen();
  };

  function boot() {
    injectStyles();
    injectReflectModal();
    global.Store.subscribe('bht', () => global.BHT_UI.rerender());
    global.BHT_UI.rerender();
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = document.getElementById('bht-reflect');
      if (m && m.classList.contains('is-open')) {
        e.preventDefault();
        closeReflectModal();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_COMPONENTS = {
    renderGridHTML, wireTiles,
    openReflectModal, closeReflectModal, discardEntry,
    LONG_PRESS_MS, AUTOSAVE_INPUT_MS
  };
})(window);
