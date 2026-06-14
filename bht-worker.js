// ============================================================
// DUNE LIFE OS — BHT · WEB WORKER (Phase 4)
// Pure compute · no DOM · no Store
// ============================================================

'use strict';

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type !== 'compute') return;
  try {
    const result = compute(msg.payload || {});
    self.postMessage({ id: msg.id, type: 'result', payload: result });
  } catch (err) {
    self.postMessage({
      id: msg.id, type: 'error',
      payload: { message: String((err && err.message) || err) }
    });
  }
});

function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d)  { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseYMD(s) { return new Date(s + 'T00:00:00'); }
function daysBack(todayKey, n) {
  const today = parseYMD(todayKey);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    out.push(ymd(d));
  }
  return out;
}
function weekdayIdx(ymdStr) {
  return (parseYMD(ymdStr).getDay() + 6) % 7;
}
function isoWeekStart(ymdStr) {
  const d = parseYMD(ymdStr);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}
function severityMult(s) {
  return s === 'major' ? 3 : s === 'moderate' ? 2 : 1;
}

function compute(payload) {
  const entries    = Array.isArray(payload.entries)    ? payload.entries    : [];
  const habits     = Array.isArray(payload.habits)     ? payload.habits     : [];
  const lifeEvents = Array.isArray(payload.lifeEvents) ? payload.lifeEvents : [];
  const todayKey   = payload.todayKey || ymd(new Date());
  const days       = payload.days || 90;

  const habitsById = {};
  for (const h of habits) habitsById[h.id] = h;

  return {
    generatedAt: new Date().toISOString(),
    todayKey, days,
    heatmap:   buildHeatmap(entries, habitsById, todayKey, days),
    todMatrix: buildTodMatrix(entries, habitsById, todayKey, days),
    timeline:  buildTimeline(entries, lifeEvents, todayKey, days),
    risk:      buildRisk(entries, habitsById, todayKey),
    summary:   buildSummary(entries, habitsById, todayKey, days)
  };
}

function buildHeatmap(entries, habitsById, todayKey, days) {
  const dates = daysBack(todayKey, days);
  const byDate = {};
  for (const d of dates) byDate[d] = { date: d, count: 0, severityScore: 0, resisted: 0 };

  for (const e of entries) {
    if (!byDate.hasOwnProperty(e.date)) continue;
    const slot = byDate[e.date];
    if (e.resisted) slot.resisted += 1;
    if (e.occurred === false) continue;
    slot.count += 1;
    const h = habitsById[e.habitId];
    const w = (h && typeof h.severityWeight === 'number') ? h.severityWeight : 3;
    slot.severityScore += w * severityMult(e.severity);
  }

  const scores = dates.map(d => byDate[d].severityScore).filter(s => s > 0).sort((a,b) => a - b);
  const q = (frac) => scores.length ? scores[Math.min(scores.length - 1, Math.floor(scores.length * frac))] : 0;
  const q25 = q(0.25), q50 = q(0.50), q75 = q(0.75);

  const cells = dates.map(d => {
    const s = byDate[d].severityScore;
    let intensity = 0;
    if (s > 0)   intensity = 1;
    if (s > q25) intensity = 2;
    if (s > q50) intensity = 3;
    if (s > q75) intensity = 4;
    return {
      date: d, count: byDate[d].count, resisted: byDate[d].resisted,
      severityScore: s, intensity
    };
  });

  return {
    days, cells,
    totals: {
      slips:     cells.reduce((a, c) => a + c.count, 0),
      resists:   cells.reduce((a, c) => a + c.resisted, 0),
      cleanDays: cells.filter(c => c.count === 0).length,
      heaviest:  cells.reduce((a, c) => c.severityScore > a.severityScore ? c : a, cells[0])
    }
  };
}

function buildTodMatrix(entries, habitsById, todayKey, days) {
  const rows = ['Morning', 'Afternoon', 'Evening', 'Night'];
  const cols = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const grid = rows.map(() => cols.map(() => ({ count: 0, severityScore: 0 })));

  const cutoff = parseYMD(daysBack(todayKey, days)[0]);
  for (const e of entries) {
    if (e.occurred === false) continue;
    const d = parseYMD(e.date);
    if (d < cutoff) continue;
    const r = rows.indexOf(e.timeOfDay);
    const c = weekdayIdx(e.date);
    if (r === -1 || c < 0 || c > 6) continue;
    const h = habitsById[e.habitId];
    const w = (h && typeof h.severityWeight === 'number') ? h.severityWeight : 3;
    grid[r][c].count += 1;
    grid[r][c].severityScore += w * severityMult(e.severity);
  }

  let peak = { row: 0, col: 0, score: 0 };
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < cols.length; c++) {
    if (grid[r][c].severityScore > peak.score) peak = { row: r, col: c, score: grid[r][c].severityScore };
  }
  const maxScore = peak.score || 1;
  return { rows, cols, grid, peak, maxScore };
}

function buildTimeline(entries, lifeEvents, todayKey, days) {
  const startKey = daysBack(todayKey, days)[0];
  const startDate = parseYMD(startKey);
  const weeks = [];
  const seen = {};
  for (let i = 0; i < Math.ceil(days / 7) + 1; i++) {
    const wd = new Date(startDate); wd.setDate(startDate.getDate() + i * 7);
    const wk = isoWeekStart(ymd(wd));
    if (seen[wk]) continue;
    seen[wk] = true;
    weeks.push({ weekStart: wk, slips: 0, resists: 0, severityScore: 0 });
  }
  const wkIndex = {};
  weeks.forEach((w, i) => { wkIndex[w.weekStart] = i; });

  for (const e of entries) {
    if (e.date < startKey) continue;
    const wk = isoWeekStart(e.date);
    const idx = wkIndex[wk];
    if (idx == null) continue;
    if (e.resisted) weeks[idx].resists += 1;
    if (e.occurred === false) continue;
    weeks[idx].slips += 1;
  }

  const clusters = [];
  let cur = null;
  for (const w of weeks) {
    const kind = w.slips === 0 ? 'clean' : w.slips >= 4 ? 'heavy' : 'mixed';
    if (!cur || cur.kind !== kind) {
      if (cur) clusters.push(cur);
      cur = { kind, from: w.weekStart, to: w.weekStart, weeks: 1, slips: w.slips };
    } else {
      cur.to = w.weekStart;
      cur.weeks += 1;
      cur.slips += w.slips;
    }
  }
  if (cur) clusters.push(cur);

  const events = (lifeEvents || []).filter(ev => {
    if (!ev.startDate) return false;
    return ev.startDate <= todayKey && (!ev.endDate || ev.endDate >= startKey);
  }).map(ev => ({
    id: ev.id, title: ev.title,
    startDate: ev.startDate, endDate: ev.endDate || null,
    impact: typeof ev.perceivedStressImpact === 'number' ? ev.perceivedStressImpact : 5
  }));

  return { weeks, clusters, events, windowStart: startKey, windowEnd: todayKey };
}

function buildRisk(entries, habitsById, todayKey) {
  const lookback = 14;
  const cutoffArr = daysBack(todayKey, lookback);
  const cutoffKey = cutoffArr[0];
  const today = parseYMD(todayKey);
  const recent = entries.filter(e => e.date >= cutoffKey && e.occurred !== false);

  let raw = 0;
  let resistCredit = 0;
  let stressSum = 0, stressN = 0;
  let sleepSum  = 0, sleepN  = 0;

  for (const e of entries) {
    if (e.date < cutoffKey) continue;
    if (typeof e.stressLevel === 'number') { stressSum += e.stressLevel; stressN += 1; }
    if (typeof e.sleepHours  === 'number') { sleepSum  += e.sleepHours;  sleepN  += 1; }
    if (e.resisted) resistCredit += 1;
  }
  for (const e of recent) {
    const h = habitsById[e.habitId];
    const w = (h && typeof h.severityWeight === 'number') ? h.severityWeight : 3;
    const ageDays = Math.max(0, Math.round((today - parseYMD(e.date)) / 86400000));
    const decay = Math.exp(-ageDays / 6);
    raw += w * severityMult(e.severity) * decay;
  }

  const avgStress = stressN ? stressSum / stressN : null;
  const avgSleep  = sleepN  ? sleepSum  / sleepN  : null;
  let mult = 1;
  if (avgStress != null) mult *= (0.7 + (avgStress - 1) * 0.06);
  if (avgSleep  != null) mult *= (avgSleep < 6 ? 1.25 : avgSleep > 8 ? 0.9 : 1);

  let score = raw * mult - resistCredit * 0.6;
  score = Math.max(0, Math.min(100, Math.round(score * 2)));

  const level =
    score >= 70 ? 'high' :
    score >= 40 ? 'elevated' :
    score >= 15 ? 'moderate' : 'low';

  const trigCounts = {};
  for (const e of recent) {
    for (const t of (e.triggers || [])) trigCounts[t] = (trigCounts[t] || 0) + 1;
  }
  const topTriggers = Object.keys(trigCounts)
    .sort((a, b) => trigCounts[b] - trigCounts[a]).slice(0, 4)
    .map(t => ({ trigger: t, count: trigCounts[t] }));

  return {
    score, level,
    factors: {
      recentSlips:  recent.length,
      resists:      resistCredit,
      avgStress14d: avgStress,
      avgSleep14d:  avgSleep
    },
    topTriggers,
    lookbackDays: lookback
  };
}

function buildSummary(entries, habitsById, todayKey, days) {
  const windowArr = daysBack(todayKey, days);
  const inWindow = entries.filter(e => windowArr.indexOf(e.date) !== -1);
  const today = entries.filter(e => e.date === todayKey && e.occurred !== false).length;

  const perHabit = {};
  for (const id of Object.keys(habitsById)) {
    const slips = entries.filter(e => e.habitId === id && e.occurred !== false)
      .map(e => e.date).sort();
    if (slips.length === 0) {
      perHabit[id] = { name: habitsById[id].name, cleanStreak: null, lastSlip: null, windowSlips: 0 };
    } else {
      const last = slips[slips.length - 1];
      const ageMs = parseYMD(todayKey) - parseYMD(last);
      perHabit[id] = {
        name: habitsById[id].name,
        cleanStreak: Math.floor(ageMs / 86400000),
        lastSlip: last,
        windowSlips: slips.filter(s => windowArr.indexOf(s) !== -1).length
      };
    }
  }

  return {
    todaySlips: today,
    windowSlips: inWindow.filter(e => e.occurred !== false).length,
    windowResists: inWindow.filter(e => e.resisted).length,
    perHabit
  };
}
