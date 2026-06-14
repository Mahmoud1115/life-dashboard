// ============================================================
// DUNE LIFE OS — BHT · ANALYTICS (Phase 4 + Phase 6 hooks)
// Worker boot · debounced snapshot push · inline SVG rendering
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store || !global.BHT || !global.BHT_UI || !global.BHT_COMPONENTS) {
    console.error('[BHT-ANALYTICS] Phases 1-3 must load first.');
    return;
  }

  const WORKER_PATH = 'bht-worker.js?v=phase4d';
  const RECOMPUTE_DEBOUNCE_MS = 220;

  function injectStyles() {
    if (document.getElementById('bht-analytics-styles')) return;
    const css = `
.bht-analytics { margin-top: 22px; display: grid; gap: 16px; }
.bht-analytics .bht-an-row {
  display: grid; gap: 16px; grid-template-columns: 1fr 1fr;
}
@media (max-width: 880px) { .bht-analytics .bht-an-row { grid-template-columns: 1fr; } }
.bht-an-card {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 18px 20px 20px;
}
.bht-an-eyebrow {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--gold2); margin-bottom: 4px;
}
.bht-an-title {
  font-family: var(--serif); font-size: 19px;
  color: var(--tx); margin: 0 0 4px; font-weight: 500;
}
.bht-an-title em { font-style: italic; color: var(--gold); }
.bht-an-sub {
  font-family: var(--mono); font-size: 10px;
  color: var(--tx3); letter-spacing: 0.5px; margin: 0 0 14px;
}
.bht-an-stat-row {
  display: flex; gap: 18px; flex-wrap: wrap;
  margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--bdr);
}
.bht-an-stat .l {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 2px;
}
.bht-an-stat .v {
  font-family: var(--serif); font-size: 18px; color: var(--tx); line-height: 1;
}
.bht-an-stat .v em { font-style: italic; color: var(--gold); }

.bht-an-legend {
  display: flex; align-items: center; gap: 6px;
  font-family: var(--mono); font-size: 9px; color: var(--tx3);
  letter-spacing: 0.8px; margin-top: 10px;
}
.bht-an-legend .sw {
  display: inline-block; width: 12px; height: 12px;
  border: 1px solid var(--bdr2); border-radius: 2px;
}

.bht-an-svg { display: block; width: 100%; height: auto; }
.bht-an-svg text { font-family: var(--mono); }

.bht-an-risk-grid {
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px; margin-top: 14px;
}
@media (max-width: 540px) { .bht-an-risk-grid { grid-template-columns: 1fr 1fr; } }
.bht-an-risk-grid .cell {
  background: var(--bg); border: 1px solid var(--bdr);
  border-radius: 4px; padding: 8px 10px;
}
.bht-an-risk-grid .cell .l {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.3px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 2px;
}
.bht-an-risk-grid .cell .v {
  font-family: var(--serif); font-size: 16px; color: var(--tx);
}

.bht-an-empty {
  font-family: var(--serif); font-style: italic;
  font-size: 14px; color: var(--tx3);
  padding: 20px 0; text-align: center;
}

.bht-an-stamp {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1px; color: var(--tx3);
  text-align: right; margin-top: 6px;
}

.bht-an-trigchips {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px;
}
.bht-an-trigchip {
  font-family: var(--mono); font-size: 10px;
  background: var(--gold3); color: var(--gold2);
  border: 1px solid rgba(154,120,50,0.22);
  border-radius: 100px; padding: 3px 9px;
}
.bht-an-trigchip .n { opacity: 0.65; margin-left: 6px; }
    `;
    const tag = document.createElement('style');
    tag.id = 'bht-analytics-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  let worker = null;
  let workerOk = false;
  let nextId = 1;
  const pending = {};
  let inlineFallback = null;

  function bootWorker() {
    if (worker) return;
    try {
      worker = new Worker(WORKER_PATH);
      workerOk = true;
      worker.addEventListener('message', (e) => {
        const m = e.data || {};
        const cb = pending[m.id];
        if (!cb) return;
        delete pending[m.id];
        if (m.type === 'result') cb.resolve(m.payload);
        else cb.reject(new Error((m.payload && m.payload.message) || 'worker error'));
      });
      worker.addEventListener('error', (err) => {
        console.warn('[BHT-ANALYTICS] worker error — falling back to inline', err);
        workerOk = false;
        try { worker.terminate(); } catch (e) {}
        worker = null;
      });
    } catch (e) {
      console.warn('[BHT-ANALYTICS] Worker unavailable, using inline fallback', e);
      worker = null; workerOk = false;
    }
  }

  function ensureInlineFallback() {
    if (inlineFallback) return Promise.resolve(inlineFallback);
    return fetch(WORKER_PATH).then(r => r.text()).then(src => {
      const stub = { addEventListener: () => {}, postMessage: () => {} };
      const factory = new Function('self', src + '\nreturn { compute };');
      inlineFallback = factory(stub);
      return inlineFallback;
    });
  }

  function postCompute(snapshot) {
    return new Promise((resolve, reject) => {
      if (workerOk && worker) {
        const id = nextId++;
        pending[id] = { resolve, reject };
        worker.postMessage({ id, type: 'compute', payload: snapshot });
      } else {
        ensureInlineFallback().then(mod => {
          try { resolve(mod.compute(snapshot)); }
          catch (e) { reject(e); }
        }).catch(reject);
      }
    });
  }

  function buildSnapshot() {
    const s = global.Store.get('bht') || {};
    let entries = s.entries || [];
    if (global.BHT_SENSORS && typeof global.BHT_SENSORS.enrichEntries === 'function') {
      entries = global.BHT_SENSORS.enrichEntries(entries);
    }
    return {
      entries,
      habits:     s.habits     || [],
      lifeEvents: s.lifeEvents || [],
      todayKey:   global.BHT.todayKey(),
      days:       90
    };
  }

  let computeTimer = null;
  let lastResult = null;
  let inflight = false;
  function scheduleCompute() {
    clearTimeout(computeTimer);
    computeTimer = setTimeout(runCompute, RECOMPUTE_DEBOUNCE_MS);
  }
  function runCompute() {
    if (inflight) { scheduleCompute(); return; }
    inflight = true;
    // Read via the public ref so layered modules (e.g. bht-duku) can override
    // the snapshot shape without editing this file again.
    const snap = (global.BHT_ANALYTICS && global.BHT_ANALYTICS.buildSnapshot)
      ? global.BHT_ANALYTICS.buildSnapshot()
      : buildSnapshot();
    postCompute(snap).then(result => {
      lastResult = result;
      renderAll();
    }).catch(err => {
      console.warn('[BHT-ANALYTICS] compute failed', err);
    }).then(() => { inflight = false; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function goldShade(intensity) {
    const shades = [
      'var(--bg3)',
      'rgba(154,120,50,0.18)',
      'rgba(154,120,50,0.34)',
      'rgba(154,120,50,0.58)',
      'var(--gold)'
    ];
    return shades[Math.max(0, Math.min(4, intensity))];
  }

  function renderHeatmap(h) {
    if (!h || !h.cells || h.cells.length === 0) {
      return `<div class="bht-an-empty">No data yet — log a few entries and this lights up.</div>`;
    }
    const cells = h.cells;
    const cellSize = 13, gap = 3;
    const firstWeekday = (new Date(cells[0].date + 'T00:00:00').getDay() + 6) % 7;
    const positions = cells.map((c, i) => {
      const absIdx = i + firstWeekday;
      return { ...c, col: Math.floor(absIdx / 7), row: absIdx % 7 };
    });
    const cols = Math.max(...positions.map(p => p.col)) + 1;
    const w = cols * (cellSize + gap) + 30;
    const hh = 7 * (cellSize + gap) + 28;

    const dayLabels = ['M','','W','','F','',''];
    const dayLabelsSvg = dayLabels.map((d, i) =>
      d ? `<text x="0" y="${24 + i * (cellSize + gap) + 10}" font-size="8" fill="var(--tx3)" letter-spacing="0.5">${d}</text>` : ''
    ).join('');

    const monthLabels = [];
    let lastMonth = -1;
    for (const p of positions) {
      const m = new Date(p.date + 'T00:00:00').getMonth();
      if (m !== lastMonth) {
        lastMonth = m;
        const x = 26 + p.col * (cellSize + gap);
        const name = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m];
        monthLabels.push(`<text x="${x}" y="10" font-size="9" fill="var(--tx3)" letter-spacing="1">${name}</text>`);
      }
    }

    const rects = positions.map(p => {
      const x = 26 + p.col * (cellSize + gap);
      const y = 18 + p.row * (cellSize + gap);
      const title = `${p.date} · ${p.count} slip${p.count===1?'':'s'} · score ${p.severityScore.toFixed(1)}${p.resisted?` · resisted ${p.resisted}`:''}`;
      return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="2" ry="2" fill="${goldShade(p.intensity)}" stroke="var(--bdr)" stroke-width="0.5"><title>${esc(title)}</title></rect>`;
    }).join('');

    const t = h.totals;
    return `
      <svg class="bht-an-svg" viewBox="0 0 ${w} ${hh}" role="img" aria-label="90-day contribution heatmap">
        ${monthLabels.join('')}
        ${dayLabelsSvg}
        ${rects}
      </svg>
      <div class="bht-an-legend">
        less
        <span class="sw" style="background:${goldShade(0)}"></span>
        <span class="sw" style="background:${goldShade(1)}"></span>
        <span class="sw" style="background:${goldShade(2)}"></span>
        <span class="sw" style="background:${goldShade(3)}"></span>
        <span class="sw" style="background:${goldShade(4)}"></span>
        more
      </div>
      <div class="bht-an-stat-row">
        <div class="bht-an-stat"><div class="l">90d slips</div><div class="v">${t.slips}</div></div>
        <div class="bht-an-stat"><div class="l">90d resists</div><div class="v">${t.resists}</div></div>
        <div class="bht-an-stat"><div class="l">Clean days</div><div class="v"><em>${t.cleanDays}</em></div></div>
        <div class="bht-an-stat"><div class="l">Heaviest</div><div class="v" style="font-size:14px">${esc(t.heaviest ? t.heaviest.date : '—')}</div></div>
      </div>
    `;
  }

  function renderTod(m) {
    if (!m || !m.grid) return `<div class="bht-an-empty">Needs a few entries to plot.</div>`;
    const rows = m.rows, cols = m.cols, grid = m.grid;
    const cellW = 44, cellH = 30, labelW = 70, labelH = 16;
    const w = labelW + cols.length * cellW + 8;
    const h = labelH + rows.length * cellH + 8;

    const colLabels = cols.map((c, i) =>
      `<text x="${labelW + i * cellW + cellW/2}" y="${labelH - 4}" font-size="9" text-anchor="middle" fill="var(--tx3)" letter-spacing="1">${c}</text>`
    ).join('');
    const rowLabels = rows.map((r, i) =>
      `<text x="${labelW - 8}" y="${labelH + i * cellH + cellH/2 + 3}" font-size="9" text-anchor="end" fill="var(--tx3)" letter-spacing="0.8">${r}</text>`
    ).join('');

    const cellRects = [];
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols.length; c++) {
        const cell = grid[r][c];
        const ratio = m.maxScore ? cell.severityScore / m.maxScore : 0;
        const intensity = ratio === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
        const x = labelW + c * cellW;
        const y = labelH + r * cellH;
        const isPeak = (r === m.peak.row && c === m.peak.col && cell.severityScore > 0);
        const title = `${rows[r]} · ${cols[c]} — ${cell.count} slip${cell.count===1?'':'s'} · score ${cell.severityScore.toFixed(1)}`;
        cellRects.push(`<rect x="${x+1}" y="${y+1}" width="${cellW-2}" height="${cellH-2}" rx="3" fill="${goldShade(intensity)}" stroke="${isPeak?'var(--gold)':'var(--bdr)'}" stroke-width="${isPeak?1.4:0.5}"><title>${esc(title)}</title></rect>`);
        if (cell.count > 0) {
          cellRects.push(`<text x="${x + cellW/2}" y="${y + cellH/2 + 3}" font-size="10" text-anchor="middle" fill="${intensity >= 3 ? 'var(--bg2)' : 'var(--tx2)'}">${cell.count}</text>`);
        }
      }
    }

    return `
      <svg class="bht-an-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Time-of-day by day-of-week risk matrix">
        ${colLabels}${rowLabels}${cellRects.join('')}
      </svg>
      <div class="bht-an-sub" style="margin-top:8px">
        ${m.peak.score > 0 ? `Peak window: <strong style="color:var(--tx2)">${rows[m.peak.row]} · ${cols[m.peak.col]}</strong>` : 'No peak — clear matrix.'}
      </div>
    `;
  }

  function renderTimeline(t) {
    if (!t || !t.weeks || t.weeks.length === 0) {
      return `<div class="bht-an-empty">Timeline assembles itself after a few weeks of logs.</div>`;
    }
    const weeks = t.weeks;
    const W = 640, H = 150, padL = 30, padR = 14, padT = 18, padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const maxSlips = Math.max(1, ...weeks.map(w => w.slips));
    const stepX = innerW / Math.max(1, weeks.length - 1);

    const baseline = padT + innerH;
    const yMid = padT + innerH / 2;
    const grid = `
      <line x1="${padL}" y1="${baseline}" x2="${W-padR}" y2="${baseline}" stroke="var(--bdr2)" stroke-width="0.6"/>
      <line x1="${padL}" y1="${yMid}"     x2="${W-padR}" y2="${yMid}"     stroke="var(--bdr)"  stroke-width="0.5" stroke-dasharray="2,3"/>
      <line x1="${padL}" y1="${padT}"     x2="${W-padR}" y2="${padT}"     stroke="var(--bdr)"  stroke-width="0.5" stroke-dasharray="2,3"/>
      <text x="${padL-6}" y="${baseline+3}" font-size="8" text-anchor="end" fill="var(--tx3)">0</text>
      <text x="${padL-6}" y="${yMid+3}"     font-size="8" text-anchor="end" fill="var(--tx3)">${Math.round(maxSlips/2)}</text>
      <text x="${padL-6}" y="${padT+3}"     font-size="8" text-anchor="end" fill="var(--tx3)">${maxSlips}</text>
    `;

    const clusterBands = (t.clusters || []).map(c => {
      const fromIdx = weeks.findIndex(w => w.weekStart === c.from);
      const toIdx   = weeks.findIndex(w => w.weekStart === c.to);
      if (fromIdx < 0 || toIdx < 0) return '';
      const x1 = padL + fromIdx * stepX;
      const x2 = padL + toIdx   * stepX + stepX * 0.6;
      const fill = c.kind === 'clean' ? 'rgba(154,120,50,0.06)' :
                   c.kind === 'heavy' ? 'rgba(154,120,50,0.20)' :
                                        'rgba(154,120,50,0.10)';
      return `<rect x="${x1}" y="${padT}" width="${Math.max(2, x2-x1)}" height="${innerH}" fill="${fill}"/>`;
    }).join('');

    const pts = weeks.map((w, i) => {
      const x = padL + i * stepX;
      const y = baseline - (w.slips / maxSlips) * innerH;
      return `${x},${y}`;
    });
    const path = `<polyline points="${pts.join(' ')}" fill="none" stroke="var(--gold)" stroke-width="1.6" stroke-linejoin="round"/>`;
    const dots = weeks.map((w, i) => {
      const x = padL + i * stepX;
      const y = baseline - (w.slips / maxSlips) * innerH;
      return `<circle cx="${x}" cy="${y}" r="2.6" fill="var(--gold2)"><title>${esc(w.weekStart)} · ${w.slips} slips · ${w.resists} resists</title></circle>`;
    }).join('');

    const eventMarks = (t.events || []).map(ev => {
      const wkIdx = weeks.findIndex(w => w.weekStart > ev.startDate) - 1;
      const idx = wkIdx < 0 ? (ev.startDate <= weeks[0].weekStart ? 0 : weeks.length - 1) : wkIdx;
      const x = padL + idx * stepX;
      const impact = ev.impact || 5;
      const r = 3 + impact / 3;
      return `
        <line x1="${x}" y1="${padT}" x2="${x}" y2="${baseline}" stroke="var(--tx3)" stroke-width="0.6" stroke-dasharray="2,2"/>
        <circle cx="${x}" cy="${padT-4}" r="${r}" fill="var(--bg2)" stroke="var(--tx2)" stroke-width="0.8"><title>${esc(ev.startDate)} · ${esc(ev.title)} · impact ${impact}/10</title></circle>
      `;
    }).join('');

    const firstW = weeks[0].weekStart;
    const lastW  = weeks[weeks.length - 1].weekStart;
    const midW   = weeks[Math.floor(weeks.length / 2)].weekStart;
    const xAxis = `
      <text x="${padL}" y="${H-8}" font-size="9" fill="var(--tx3)" text-anchor="start">${firstW}</text>
      <text x="${padL + innerW/2}" y="${H-8}" font-size="9" fill="var(--tx3)" text-anchor="middle">${midW}</text>
      <text x="${W-padR}" y="${H-8}" font-size="9" fill="var(--tx3)" text-anchor="end">${lastW}</text>
    `;

    return `
      <svg class="bht-an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly slip timeline with life event overlay">
        ${clusterBands}
        ${grid}
        ${path}
        ${dots}
        ${eventMarks}
        ${xAxis}
      </svg>
      <div class="bht-an-sub" style="margin-top:8px">
        ${t.clusters && t.clusters.length
          ? `${t.clusters.length} cluster${t.clusters.length===1?'':'s'} — gold bands mark heavy weeks, light bands mark clean stretches.`
          : 'Bands appear once weekly patterns emerge.'}
      </div>
    `;
  }

  function renderRisk(r) {
    if (!r) return `<div class="bht-an-empty">Risk model warms up with your first week of entries.</div>`;
    const score = r.score, level = r.level;
    const W = 220, H = 130, cx = W/2, cy = 100, R = 70;
    const angle = Math.PI * (1 - score / 100);
    const px = cx + R * Math.cos(angle);
    const py = cy - R * Math.sin(angle);
    const seg = (frac0, frac1, color) => {
      const a0 = Math.PI * (1 - frac0), a1 = Math.PI * (1 - frac1);
      const x0 = cx + R * Math.cos(a0), y0 = cy - R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy - R * Math.sin(a1);
      return `<path d="M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="butt"/>`;
    };
    const arcs =
      seg(0,    0.40, 'rgba(154,120,50,0.18)') +
      seg(0.40, 0.70, 'rgba(154,120,50,0.45)') +
      seg(0.70, 1.00, 'var(--gold)');
    const needle = `
      <line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="var(--tx)" stroke-width="2" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="var(--tx)"/>
    `;

    const f = r.factors;
    const factors = `
      <div class="bht-an-risk-grid">
        <div class="cell"><div class="l">Level</div><div class="v" style="text-transform:capitalize">${esc(level)}</div></div>
        <div class="cell"><div class="l">14d slips</div><div class="v">${f.recentSlips}</div></div>
        <div class="cell"><div class="l">14d resists</div><div class="v">${f.resists}</div></div>
        <div class="cell"><div class="l">Avg sleep</div><div class="v">${f.avgSleep14d != null ? f.avgSleep14d.toFixed(1) + 'h' : '—'}</div></div>
      </div>
    `;
    const trigs = (r.topTriggers && r.topTriggers.length) ? `
      <div class="bht-an-trigchips">
        ${r.topTriggers.map(t => `<span class="bht-an-trigchip">${esc(t.trigger)}<span class="n">${t.count}</span></span>`).join('')}
      </div>
    ` : '';

    return `
      <svg class="bht-an-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Composite behavioral risk gauge">
        ${arcs}
        ${needle}
        <text x="${cx}" y="${cy + 28}" text-anchor="middle" font-family="var(--serif)" font-size="32" fill="var(--tx)">${score}</text>
        <text x="${cx-32}" y="${cy + 12}" font-size="9" fill="var(--tx3)">0</text>
        <text x="${cx+32}" y="${cy + 12}" font-size="9" fill="var(--tx3)">100</text>
      </svg>
      ${factors}
      ${trigs}
    `;
  }

  const _origRerender = global.BHT_UI.rerender;

  function isOnboarding() {
    const slice = global.Store.get('bht') || {};
    const entries = Array.isArray(slice.entries) ? slice.entries : [];
    const initialized = slice.meta && slice.meta.initialized;
    return entries.length === 0 && !initialized;
  }

  function ensureAnalyticsContainer() {
    const body = document.getElementById('bht-body');
    if (!body) return null;
    let host = document.getElementById('bht-analytics');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bht-analytics';
      host.className = 'bht-analytics';
      const grid = body.querySelector('.bht-grid-wrap');
      if (grid) body.insertBefore(host, grid);
      else body.appendChild(host);
    }
    return host;
  }

  function renderAll() {
    if (isOnboarding()) return;
    const host = ensureAnalyticsContainer();
    if (!host) return;
    if (!lastResult) {
      host.innerHTML = `
        <div class="bht-an-card">
          <div class="bht-an-eyebrow">Behavioral Intelligence</div>
          <h3 class="bht-an-title">Warming up <em>the engine</em></h3>
          <p class="bht-an-sub">Worker is computing the first pass…</p>
        </div>`;
      return;
    }
    const stamp = new Date(lastResult.generatedAt).toLocaleTimeString();
    host.innerHTML = `
      <div class="bht-an-card">
        <div class="bht-an-eyebrow">Last 90 days · contribution</div>
        <h3 class="bht-an-title">The shape of <em>the last quarter</em></h3>
        <p class="bht-an-sub">Each cell is a day. Deeper gold = heavier severity-weighted score.</p>
        ${renderHeatmap(lastResult.heatmap)}
      </div>

      <div class="bht-an-row">
        <div class="bht-an-card">
          <div class="bht-an-eyebrow">When it tends to happen</div>
          <h3 class="bht-an-title">Time of day <em>×</em> day of week</h3>
          <p class="bht-an-sub">Where to put friction. Bordered gold cell is your peak window.</p>
          ${renderTod(lastResult.todMatrix)}
        </div>
        <div class="bht-an-card">
          <div class="bht-an-eyebrow">Composite signal · 14d weighted</div>
          <h3 class="bht-an-title">Behavioral risk <em>right now</em></h3>
          <p class="bht-an-sub">Severity × recency × sleep × stress. Updates with every log.</p>
          ${renderRisk(lastResult.risk)}
        </div>
      </div>

      <div class="bht-an-card">
        <div class="bht-an-eyebrow">Timeline replay · weekly</div>
        <h3 class="bht-an-title">${lastResult.timeline.weeks.length} weeks <em>of pattern</em></h3>
        <p class="bht-an-sub">Slips per week with life-event markers above the line and cluster bands behind it.</p>
        ${renderTimeline(lastResult.timeline)}
        <div class="bht-an-stamp">computed ${esc(stamp)} · ${workerOk ? 'worker thread' : 'inline fallback'}</div>
      </div>
    `;
  }

  function patchRerender() {
    global.BHT_UI.rerender = function () {
      _origRerender();
      if (!isOnboarding()) {
        ensureAnalyticsContainer();
        renderAll();
        scheduleCompute();
      }
    };
  }

  function boot() {
    injectStyles();
    bootWorker();
    patchRerender();
    global.BHT_UI.rerender();
    global.Store.subscribe('bht', () => scheduleCompute());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_ANALYTICS = {
    recompute: scheduleCompute,
    lastResult: () => lastResult,
    workerOk:   () => workerOk,
    buildSnapshot
  };
})(window);
