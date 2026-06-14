// ============================================================
// DUNE LIFE OS — BHT · BEHAVIORAL COACH (Phase 5)
// Multi-provider AI router · Ollama · Anthropic · OpenRouter
// Deterministic offline fallback · weekly snapshot canvas UI
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store || !global.BHT || !global.BHT_UI || !global.BHT_COMPONENTS || !global.BHT_ANALYTICS) {
    console.error('[BHT-COACH] Phases 1-4 must load first.');
    return;
  }

  const DEFAULTS = {
    ollama:     { url: 'http://localhost:11434', model: 'llama3.1:8b' },
    anthropic:  { model: 'claude-sonnet-4-6',    apiVersion: '2023-06-01' },
    openrouter: { model: 'anthropic/claude-sonnet-4-6' }
  };

  const SYSTEM_PROMPT =
    'You are a compassionate behavioral coach embedded in a single-user personal OS. ' +
    'The user is a 26-year-old aviation engineer in Moscow on a focused career/savings/EASA plan; he is the author of his own plan. ' +
    'Your job: read the structured weekly analytics JSON and produce a calm, sharp, non-punitive review. ' +
    'Tone: editorial, warm, specific, never preachy. Avoid streak language ("you broke your streak"); use progress framing. ' +
    'Output ONLY a single JSON object — no prose outside it, no markdown fences — matching this exact schema: ' +
    '{ "summary": string (2-4 sentences), "trends": string[] (3-5 short phrases), ' +
    '  "primaryTriggers": string[] (max 4), "wins": string[] (1-3), ' +
    '  "recommendations": string[] (2-4 concrete next steps, each under 18 words), ' +
    '  "riskScore": integer 0-100 (your own read, not necessarily the input score) }';

  function injectStyles() {
    if (document.getElementById('bht-coach-styles')) return;
    const css = `
.bht-coach { margin-top: 18px; }
.bht-coach-card {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 22px 24px 22px;
}
.bht-coach-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
.bht-coach-eyebrow {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.8px; text-transform: uppercase;
  color: var(--gold2); margin-bottom: 4px;
}
.bht-coach-title {
  font-family: var(--serif); font-size: 22px; color: var(--tx);
  margin: 0 0 4px; font-weight: 500;
}
.bht-coach-title em { font-style: italic; color: var(--gold); }
.bht-coach-sub {
  font-family: var(--mono); font-size: 10px; color: var(--tx3);
  letter-spacing: 0.5px; margin: 0;
}
.bht-coach-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.bht-coach-go {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: var(--gold); color: var(--bg2);
  border: 1px solid var(--gold2);
  padding: 10px 18px; border-radius: 4px; cursor: pointer;
  transition: background 120ms ease;
}
.bht-coach-go:hover:not(:disabled) { background: var(--gold2); }
.bht-coach-go:disabled { opacity: 0.55; cursor: progress; }
.bht-coach-cfg {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1px; text-transform: uppercase;
  background: transparent; color: var(--tx2);
  border: 1px solid var(--bdr2);
  padding: 9px 14px; border-radius: 4px; cursor: pointer;
}
.bht-coach-cfg:hover { background: var(--bg3); }
.bht-coach-providerpill {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: var(--gold3); color: var(--gold2);
  border: 1px solid rgba(154,120,50,0.22);
  padding: 4px 10px; border-radius: 100px;
}
.bht-coach-settings {
  margin-top: 16px; padding: 16px 18px;
  background: var(--bg); border: 1px solid var(--bdr);
  border-radius: 4px; display: none;
}
.bht-coach-settings.is-open { display: block; }
.bht-coach-settings .row {
  display: grid; grid-template-columns: 130px 1fr;
  gap: 12px; align-items: center; margin-bottom: 10px;
}
.bht-coach-settings .row:last-child { margin-bottom: 0; }
.bht-coach-settings label {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.2px; text-transform: uppercase;
  color: var(--tx3);
}
.bht-coach-settings input, .bht-coach-settings select {
  width: 100%; box-sizing: border-box;
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 4px; padding: 8px 10px;
  font-family: var(--mono); font-size: 12px;
  color: var(--tx); outline: none;
}
.bht-coach-settings input:focus, .bht-coach-settings select:focus { border-color: var(--gold); }
.bht-coach-settings .note {
  font-family: var(--serif); font-style: italic; font-size: 12px;
  color: var(--tx3); margin-top: 6px;
}
.bht-coach-settings .small {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1px; color: var(--tx3); text-transform: uppercase;
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--bdr);
}
.bht-coach-output {
  margin-top: 18px; padding-top: 18px;
  border-top: 1px solid var(--bdr);
}
.bht-coach-summary {
  font-family: var(--serif); font-size: 16.5px; line-height: 1.6;
  color: var(--tx); margin: 0 0 16px; max-width: 68ch;
}
.bht-coach-block { margin-top: 16px; }
.bht-coach-block .l {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 8px;
}
.bht-coach-list { margin: 0; padding: 0; list-style: none; }
.bht-coach-list li {
  font-family: var(--serif); font-size: 14.5px; line-height: 1.55;
  color: var(--tx2); padding: 6px 0;
  border-bottom: 1px dashed var(--bdr);
}
.bht-coach-list li:last-child { border-bottom: none; }
.bht-coach-list li::before {
  content: '— '; color: var(--gold2); font-family: var(--mono);
}
.bht-coach-snapfoot {
  display: flex; justify-content: space-between; gap: 10px;
  margin-top: 14px; padding-top: 12px;
  border-top: 1px solid var(--bdr);
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1px; color: var(--tx3);
  text-transform: uppercase; flex-wrap: wrap;
}
.bht-coach-snapfoot .right { color: var(--gold2); }
.bht-coach-error {
  margin-top: 14px;
  font-family: var(--mono); font-size: 11px;
  color: var(--red, #a04040);
  background: var(--red2, rgba(160,64,64,0.06));
  border: 1px solid rgba(160,64,64,0.20);
  padding: 8px 12px; border-radius: 4px;
}
.bht-coach-history {
  margin-top: 18px; padding-top: 14px;
  border-top: 1px solid var(--bdr);
}
.bht-coach-history-hd {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 8px;
}
.bht-coach-history-row {
  display: flex; justify-content: space-between; gap: 12px;
  font-family: var(--serif); font-size: 13.5px; color: var(--tx2);
  padding: 6px 0; border-bottom: 1px dashed var(--bdr);
  cursor: pointer;
}
.bht-coach-history-row:hover { color: var(--tx); background: var(--bg); }
.bht-coach-history-row:last-child { border-bottom: none; }
.bht-coach-history-row .when {
  font-family: var(--mono); font-size: 10px; color: var(--tx3);
  letter-spacing: 0.5px; flex-shrink: 0;
}
    `;
    const tag = document.createElement('style');
    tag.id = 'bht-coach-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
           ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  function clamp01_100(n) { n = parseInt(n, 10); return isFinite(n) ? Math.max(0, Math.min(100, n)) : 0; }
  function strList(arr, max) {
    if (!Array.isArray(arr)) return [];
    return arr.map(x => String(x || '').trim()).filter(Boolean).slice(0, max || 8);
  }

  function buildPayload() {
    const analytics = global.BHT_ANALYTICS.lastResult();
    if (!analytics) return null;
    const slice = global.Store.get('bht') || {};
    const habits = (slice.habits || []).filter(h => !h.archived).map(h => ({
      name: h.name, category: h.category, severityWeight: h.severityWeight
    }));

    const peak = analytics.todMatrix && analytics.todMatrix.peak;
    const peakWindow = (peak && peak.score > 0)
      ? `${analytics.todMatrix.rows[peak.row]} · ${analytics.todMatrix.cols[peak.col]}`
      : null;

    const lifeEvents = (analytics.timeline.events || []).map(ev => ({
      title: ev.title, startDate: ev.startDate, endDate: ev.endDate, impact: ev.impact
    }));

    const perHabit = analytics.summary.perHabit || {};
    const habitLines = Object.values(perHabit).map(h => ({
      name: h.name, cleanStreakDays: h.cleanStreak,
      lastSlip: h.lastSlip, windowSlips: h.windowSlips
    }));

    return {
      window: { todayKey: analytics.todayKey, days: analytics.days },
      habits, perHabit: habitLines,
      totals: analytics.heatmap.totals,
      todaySlips: analytics.summary.todaySlips,
      windowSlips: analytics.summary.windowSlips,
      windowResists: analytics.summary.windowResists,
      peakWindow,
      risk: {
        score: analytics.risk.score, level: analytics.risk.level,
        factors: analytics.risk.factors, topTriggers: analytics.risk.topTriggers
      },
      clusters: (analytics.timeline.clusters || []).map(c => ({
        kind: c.kind, from: c.from, to: c.to, weeks: c.weeks, slips: c.slips
      })),
      lifeEvents, generatedAt: analytics.generatedAt
    };
  }

  function extractJson(text) {
    if (!text) return null;
    let t = String(text).trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    try { return JSON.parse(t); }
    catch (e) {
      const m = t.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    }
    return null;
  }

  function userMessage(payload) {
    return 'Weekly analytics snapshot (read carefully, then respond with the JSON object):\n\n' +
           '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
  }

  async function callOllama(cfg, payload) {
    const url  = (cfg.ollamaUrl || DEFAULTS.ollama.url).replace(/\/+$/, '') + '/api/chat';
    const model = cfg.model || DEFAULTS.ollama.model;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, stream: false, format: 'json',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage(payload) }
        ]
      })
    });
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
    const data = await res.json();
    const text = data && data.message && data.message.content;
    return extractJson(text);
  }

  async function callAnthropic(cfg, payload) {
    const key   = cfg.apiKey;
    const model = cfg.model || DEFAULTS.anthropic.model;
    if (!key) throw new Error('Missing Anthropic API key');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': DEFAULTS.anthropic.apiVersion,
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model, max_tokens: 1200, system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage(payload) }]
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('Anthropic HTTP ' + res.status + (t ? ' · ' + t.slice(0,160) : ''));
    }
    const data = await res.json();
    const text = (data && data.content && data.content[0] && data.content[0].text) || '';
    return extractJson(text);
  }

  async function callOpenRouter(cfg, payload) {
    const key   = cfg.apiKey;
    const model = cfg.model || DEFAULTS.openrouter.model;
    if (!key) throw new Error('Missing OpenRouter API key');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key,
        'HTTP-Referer': location.origin || 'https://dune-life-os.local',
        'X-Title': 'Dune Life OS — BHT'
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: userMessage(payload) }
        ]
      })
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('OpenRouter HTTP ' + res.status + (t ? ' · ' + t.slice(0,160) : ''));
    }
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    return extractJson(text);
  }

  function callProvider(cfg, payload) {
    switch ((cfg.provider || 'fallback').toLowerCase()) {
      case 'ollama':     return callOllama(cfg, payload);
      case 'anthropic':  return callAnthropic(cfg, payload);
      case 'openrouter': return callOpenRouter(cfg, payload);
      default:           return Promise.resolve(null);
    }
  }

  function offlineGenerate(payload) {
    const r = payload.risk || { score: 0, level: 'low', factors: {}, topTriggers: [] };
    const totals = payload.totals || { slips: 0, resists: 0, cleanDays: 0 };
    const per = payload.perHabit || [];
    const clusters = payload.clusters || [];
    const heavyClusters = clusters.filter(c => c.kind === 'heavy');
    const cleanClusters = clusters.filter(c => c.kind === 'clean');

    const trends = [];
    if (totals.cleanDays > 0) trends.push(`${totals.cleanDays} clean days in the last 90.`);
    if (totals.slips > 0)     trends.push(`${totals.slips} slip${totals.slips===1?'':'s'} logged · ${totals.resists} resist${totals.resists===1?'':'s'}.`);
    if (payload.peakWindow)   trends.push(`Peak window: ${payload.peakWindow}.`);
    if (heavyClusters.length) trends.push(`${heavyClusters.length} heavy stretch${heavyClusters.length===1?'':'es'} in the timeline.`);
    if (cleanClusters.length) trends.push(`${cleanClusters.length} clean stretch${cleanClusters.length===1?'':'es'} on the line.`);
    if (r.factors && r.factors.avgSleep14d != null) trends.push(`Avg sleep over 14d: ${r.factors.avgSleep14d.toFixed(1)}h.`);

    const wins = [];
    if (totals.resists > 0) wins.push(`${totals.resists} urge${totals.resists===1?'':'s'} resisted on the record.`);
    const longestClean = per.filter(h => h.cleanStreakDays != null)
      .sort((a, b) => (b.cleanStreakDays || 0) - (a.cleanStreakDays || 0))[0];
    if (longestClean && longestClean.cleanStreakDays >= 3) {
      wins.push(`${longestClean.cleanStreakDays} clean days on ${longestClean.name}.`);
    }
    if (totals.cleanDays >= 60) wins.push('Two-thirds of the quarter logged as clean — the baseline is healthy.');
    if (wins.length === 0) wins.push('You opened the ledger — that itself is the win this week.');

    const primaryTriggers = (r.topTriggers || []).map(t => t.trigger).slice(0, 4);

    const recommendations = [];
    if (payload.peakWindow) {
      recommendations.push(`Pre-decide the move for ${payload.peakWindow.toLowerCase()} — phone in another room, water within reach.`);
    }
    if (r.factors && r.factors.avgSleep14d != null && r.factors.avgSleep14d < 6.5) {
      recommendations.push(`Sleep is sitting under 6.5h — the easiest single lever this week.`);
    }
    if (primaryTriggers.length) {
      recommendations.push(`Triggers stacking on "${primaryTriggers[0]}" — name one replacement habit for it.`);
    }
    if (heavyClusters.length && heavyClusters[heavyClusters.length-1]) {
      recommendations.push(`Last heavy stretch ran ${heavyClusters[heavyClusters.length-1].weeks} week${heavyClusters[heavyClusters.length-1].weeks===1?'':'s'} — schedule one anchor activity per off-day.`);
    }
    if (recommendations.length === 0) {
      recommendations.push('Keep logging — even quiet weeks are signal.');
    }

    const levelLine =
      r.level === 'high'     ? 'Composite risk is reading high right now —' :
      r.level === 'elevated' ? 'Composite risk is elevated —'              :
      r.level === 'moderate' ? 'Composite risk is moderate —'              :
                               'Composite risk is low —';
    const sleepLine = (r.factors && r.factors.avgSleep14d != null)
      ? ` 14-day sleep average sits at ${r.factors.avgSleep14d.toFixed(1)}h.`
      : '';
    const trigLine = primaryTriggers.length
      ? ` The pattern is clustering around ${primaryTriggers.slice(0,2).join(' and ')}.`
      : '';
    const peakLine = payload.peakWindow
      ? ` It tends to land on ${payload.peakWindow}.`
      : '';
    const winLine = wins[0] ? ' ' + wins[0] : '';
    const summary = `${levelLine} ${r.factors && r.factors.recentSlips != null ? r.factors.recentSlips : 0} slip${(r.factors && r.factors.recentSlips === 1) ? '' : 's'} in the last 14 days, ${r.factors && r.factors.resists != null ? r.factors.resists : 0} resists logged.${peakLine}${trigLine}${sleepLine}${winLine}`.trim();

    return {
      summary, trends: trends.slice(0, 5),
      primaryTriggers, wins: wins.slice(0, 3),
      recommendations: recommendations.slice(0, 4),
      riskScore: r.score || 0
    };
  }

  function normalizeResponse(obj, payload) {
    const fallback = offlineGenerate(payload);
    if (!obj || typeof obj !== 'object') return { snapshot: fallback, fellBack: true };
    const snap = {
      summary: typeof obj.summary === 'string' && obj.summary.trim() ? obj.summary.trim() : fallback.summary,
      trends:  strList(obj.trends,  5).length ? strList(obj.trends, 5) : fallback.trends,
      primaryTriggers: strList(obj.primaryTriggers, 4),
      wins: strList(obj.wins, 3).length ? strList(obj.wins, 3) : fallback.wins,
      recommendations: strList(obj.recommendations, 4).length ? strList(obj.recommendations, 4) : fallback.recommendations,
      riskScore: clamp01_100(obj.riskScore != null ? obj.riskScore : (payload.risk && payload.risk.score) || 0)
    };
    if (!snap.primaryTriggers.length && fallback.primaryTriggers.length) {
      snap.primaryTriggers = fallback.primaryTriggers;
    }
    return { snapshot: snap, fellBack: false };
  }

  let lastError = null;
  let isGenerating = false;
  let lastGenerated = null;

  async function generateSnapshot() {
    if (isGenerating) return;
    isGenerating = true; lastError = null; renderCard();

    try {
      global.BHT_ANALYTICS.recompute();
      await new Promise(r => setTimeout(r, 260));

      const payload = buildPayload();
      if (!payload) {
        lastError = 'No analytics available yet — log at least one entry.';
        return;
      }

      const cfg = global.Store.get('bht.ai') || { provider: 'fallback' };
      let snapshot, fellBack = false, generatedBy = cfg.provider;
      try {
        const raw = await callProvider(cfg, payload);
        if (!raw) { snapshot = offlineGenerate(payload); fellBack = true; generatedBy = cfg.provider + '→fallback'; }
        else {
          const norm = normalizeResponse(raw, payload);
          snapshot = norm.snapshot;
          fellBack = norm.fellBack;
          if (fellBack) generatedBy = cfg.provider + '→fallback';
        }
      } catch (err) {
        console.warn('[BHT-COACH] provider failed, using deterministic fallback', err);
        lastError = (cfg.provider !== 'fallback')
          ? (cfg.provider + ': ' + (err.message || 'network error') + ' — used offline engine.')
          : null;
        snapshot = offlineGenerate(payload);
        fellBack = true;
        generatedBy = (cfg.provider || 'fallback') + '→fallback';
      }

      const saved = global.BHT.addSnapshot({
        weekStart: global.BHT.weekStartOf(payload.window.todayKey),
        summary: snapshot.summary,
        trends:  snapshot.trends,
        riskScore: snapshot.riskScore,
        primaryTriggers: snapshot.primaryTriggers,
        wins: snapshot.wins,
        recommendations: snapshot.recommendations,
        generatedBy
      });
      lastGenerated = { snapshot, generatedBy, at: saved.createdAt, fellBack, id: saved.id };
    } finally {
      isGenerating = false;
      renderCard();
    }
  }

  let settingsOpen = false;
  function toggleSettings() { settingsOpen = !settingsOpen; renderCard(); }
  function saveSettings(form) {
    const provider = form.querySelector('[data-cfg="provider"]').value;
    const model    = form.querySelector('[data-cfg="model"]').value.trim();
    const apiKey   = form.querySelector('[data-cfg="apiKey"]').value;
    const ollamaUrl = form.querySelector('[data-cfg="ollamaUrl"]').value.trim();
    global.BHT.setAIConfig({
      provider,
      model: model || (provider === 'ollama'     ? DEFAULTS.ollama.model
                     : provider === 'anthropic'  ? DEFAULTS.anthropic.model
                     : provider === 'openrouter' ? DEFAULTS.openrouter.model
                     : ''),
      apiKey,
      ollamaUrl: ollamaUrl || DEFAULTS.ollama.url
    });
    settingsOpen = false;
    renderCard();
  }
  function settingsHTML(cfg) {
    const provider = cfg.provider || 'fallback';
    return `
      <div class="bht-coach-settings ${settingsOpen ? 'is-open' : ''}" id="bht-coach-settings">
        <div class="row">
          <label>Provider</label>
          <select data-cfg="provider">
            <option value="fallback"   ${provider==='fallback'  ?'selected':''}>Offline · deterministic JS</option>
            <option value="ollama"     ${provider==='ollama'    ?'selected':''}>Ollama · local</option>
            <option value="anthropic"  ${provider==='anthropic' ?'selected':''}>Anthropic · direct</option>
            <option value="openrouter" ${provider==='openrouter'?'selected':''}>OpenRouter · unified</option>
          </select>
        </div>
        <div class="row">
          <label>Model</label>
          <input type="text" data-cfg="model" value="${esc(cfg.model || '')}" placeholder="(defaults applied if blank)">
        </div>
        <div class="row">
          <label>API key</label>
          <input type="password" data-cfg="apiKey" value="${esc(cfg.apiKey || '')}" placeholder="local only · stored in dune_state_v4" autocomplete="off">
        </div>
        <div class="row">
          <label>Ollama URL</label>
          <input type="text" data-cfg="ollamaUrl" value="${esc(cfg.ollamaUrl || DEFAULTS.ollama.url)}">
        </div>
        <p class="note">Keys never leave this device. They ship with the same Gist sync as the rest of <code style="font-family:var(--mono)">dune_state_v4</code> — keep the Gist private.</p>
        <div class="small">
          <button class="bht-coach-go" type="button" data-action="save-settings">save settings</button>
        </div>
      </div>
    `;
  }

  function isOnboarding() {
    const slice = global.Store.get('bht') || {};
    const entries = Array.isArray(slice.entries) ? slice.entries : [];
    const initialized = slice.meta && slice.meta.initialized;
    return entries.length === 0 && !initialized;
  }

  function ensureCoachHost() {
    const body = document.getElementById('bht-body');
    if (!body) return null;
    let host = document.getElementById('bht-coach');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bht-coach';
      host.className = 'bht-coach';
      body.appendChild(host);
    }
    return host;
  }

  function snapshotHTML(s) {
    if (!s) return '';
    const trends = s.trends.map(t => `<li>${esc(t)}</li>`).join('');
    const wins   = s.wins.map(t => `<li>${esc(t)}</li>`).join('');
    const recs   = s.recommendations.map(t => `<li>${esc(t)}</li>`).join('');
    const trigs  = s.primaryTriggers.length
      ? `<div class="bht-coach-block"><div class="l">Triggers in the foreground</div>
           <ul class="bht-coach-list">${s.primaryTriggers.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`
      : '';
    return `
      <div class="bht-coach-output">
        <p class="bht-coach-summary">${esc(s.summary)}</p>
        <div class="bht-coach-block"><div class="l">Trends</div><ul class="bht-coach-list">${trends}</ul></div>
        ${trigs}
        <div class="bht-coach-block"><div class="l">Wins</div><ul class="bht-coach-list">${wins}</ul></div>
        <div class="bht-coach-block"><div class="l">Recommendations</div><ul class="bht-coach-list">${recs}</ul></div>
      </div>
    `;
  }

  function historyHTML() {
    const slice = global.Store.get('bht') || {};
    const snaps = (slice.snapshots || []).slice().sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    if (snaps.length === 0) return '';
    const rows = snaps.map(s => `
      <div class="bht-coach-history-row" data-snap-id="${esc(s.id)}">
        <span>${esc((s.summary || '').slice(0, 110))}${(s.summary && s.summary.length > 110)?'…':''}</span>
        <span class="when">${esc(fmtDate(s.createdAt))} · ${esc(s.generatedBy || 'fallback')}</span>
      </div>
    `).join('');
    return `
      <div class="bht-coach-history">
        <div class="bht-coach-history-hd">Recent snapshots · click to load</div>
        ${rows}
      </div>
    `;
  }

  function renderCard() {
    if (isOnboarding()) {
      const host = document.getElementById('bht-coach');
      if (host) host.remove();
      return;
    }
    const host = ensureCoachHost();
    if (!host) return;
    const cfg = global.Store.get('bht.ai') || { provider: 'fallback' };
    const providerLabel =
      cfg.provider === 'ollama'     ? 'Ollama · ' + (cfg.model || DEFAULTS.ollama.model)     :
      cfg.provider === 'anthropic'  ? 'Anthropic · ' + (cfg.model || DEFAULTS.anthropic.model) :
      cfg.provider === 'openrouter' ? 'OpenRouter · ' + (cfg.model || DEFAULTS.openrouter.model) :
                                      'Offline · deterministic';
    const slice = global.Store.get('bht') || {};
    const mostRecent = (slice.snapshots || []).slice().sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt))[0];
    const view = lastGenerated && lastGenerated.snapshot
      ? { snapshot: lastGenerated.snapshot, generatedBy: lastGenerated.generatedBy, at: lastGenerated.at, fellBack: lastGenerated.fellBack }
      : (mostRecent ? { snapshot: mostRecent, generatedBy: mostRecent.generatedBy, at: mostRecent.createdAt, fellBack: false } : null);

    host.innerHTML = `
      <div class="bht-coach-card">
        <div class="bht-coach-hd">
          <div>
            <div class="bht-coach-eyebrow">Weekly AI Review · Strategy Canvas</div>
            <h3 class="bht-coach-title">What the patterns <em>are really saying</em></h3>
            <p class="bht-coach-sub">A compassionate read of the last 90 days. Click Generate to refresh.</p>
          </div>
          <div class="bht-coach-actions">
            <span class="bht-coach-providerpill">${esc(providerLabel)}</span>
            <button class="bht-coach-go" type="button" data-action="generate" ${isGenerating ? 'disabled' : ''}>
              ${isGenerating ? 'thinking…' : 'generate snapshot'}
            </button>
            <button class="bht-coach-cfg" type="button" data-action="toggle-settings">${settingsOpen ? 'close' : 'configure'}</button>
          </div>
        </div>

        ${settingsHTML(cfg)}

        ${lastError ? `<div class="bht-coach-error">${esc(lastError)}</div>` : ''}

        ${view ? snapshotHTML(view.snapshot) : `
          <div class="bht-coach-output" style="font-family:var(--serif);font-style:italic;color:var(--tx3);font-size:14px">
            No snapshot generated yet. The deterministic engine works without any network or key — try it first.
          </div>`}

        ${view ? `
          <div class="bht-coach-snapfoot">
            <span>generated ${esc(fmtDate(view.at))}</span>
            <span class="right">${esc(view.generatedBy || 'fallback')}${view.fellBack ? ' · offline fallback engaged' : ''}</span>
          </div>` : ''}

        ${historyHTML()}
      </div>
    `;

    const generateBtn = host.querySelector('[data-action="generate"]');
    if (generateBtn) generateBtn.addEventListener('click', () => generateSnapshot());

    const cfgBtn = host.querySelector('[data-action="toggle-settings"]');
    if (cfgBtn) cfgBtn.addEventListener('click', toggleSettings);

    const saveBtn = host.querySelector('[data-action="save-settings"]');
    if (saveBtn) saveBtn.addEventListener('click', () => {
      const panel = host.querySelector('#bht-coach-settings');
      if (panel) saveSettings(panel);
    });

    host.querySelectorAll('.bht-coach-history-row').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.snapId;
        const s = (global.Store.get('bht.snapshots') || []).find(x => x.id === id);
        if (!s) return;
        lastGenerated = { snapshot: s, generatedBy: s.generatedBy, at: s.createdAt, fellBack: false, id: s.id };
        renderCard();
      });
    });
  }

  const _origRerender = global.BHT_UI.rerender;
  global.BHT_UI.rerender = function () {
    _origRerender();
    renderCard();
  };

  function boot() {
    injectStyles();
    global.BHT_UI.rerender();
    global.Store.subscribe('bht', () => renderCard());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.BHT_COACH = {
    generate: generateSnapshot,
    offlineGenerate, buildPayload,
    lastGenerated: () => lastGenerated,
    callProvider
  };
})(window);
