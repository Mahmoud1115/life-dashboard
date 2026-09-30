(function () {
  'use strict';

  const ALLOWED_STATES = new Set(['HEALTHY', 'DEGRADED', 'FAILED', 'STALE', 'UNKNOWN']);
  const PRIORITY = { FAILED: 5, UNKNOWN: 4, STALE: 3, DEGRADED: 2, HEALTHY: 1 };
  const SAFE_TEXT = /^[\w .,:;()/+&'-]{1,240}$/;

  function safeText(value, fallback) {
    return typeof value === 'string' && SAFE_TEXT.test(value) ? value : fallback;
  }

  function effectiveState(component, generatedAt, staleAfterSeconds, now) {
    const state = ALLOWED_STATES.has(component && component.status) ? component.status : 'UNKNOWN';
    if (state === 'UNKNOWN' || state === 'FAILED') return state;
    const observed = new Date((component && component.observedAt) || generatedAt || '');
    if (!Number.isFinite(observed.getTime()) || now - observed.getTime() > staleAfterSeconds * 1000) return 'STALE';
    return state;
  }

  function aggregate(states) {
    return states.reduce((worst, state) => PRIORITY[state] > PRIORITY[worst] ? state : worst, 'HEALTHY');
  }

  function stateBadge(state) {
    const badge = document.createElement('span');
    badge.className = 'obs-state obs-' + state.toLowerCase();
    badge.textContent = state;
    return badge;
  }

  function renderUnknown(message) {
    const summary = document.getElementById('obs-summary');
    const components = document.getElementById('obs-components');
    if (!summary || !components) return;
    summary.querySelector('.obs-summary-copy').replaceChildren(stateBadge('UNKNOWN'), Object.assign(document.createElement('p'), { textContent: message }));
    document.getElementById('obs-meta').textContent = 'No verified evidence available';
    components.replaceChildren(Object.assign(document.createElement('p'), { className: 'sr-empty', textContent: 'The manifest could not be verified. Life OS remains available.' }));
  }

  function render(manifest) {
    if (!manifest || manifest.schema !== 1 || manifest.classification !== 'PUBLIC_SAFE' || !Array.isArray(manifest.components)) {
      renderUnknown('Manifest missing or invalid.'); return;
    }
    const staleAfter = Number.isFinite(manifest.staleAfterSeconds) && manifest.staleAfterSeconds > 0 ? manifest.staleAfterSeconds : 86400;
    const now = Date.now();
    const items = manifest.components.map(function (component) {
      return { component: component, state: effectiveState(component, manifest.generatedAt, staleAfter, now) };
    });
    const overall = items.length ? aggregate(items.map(item => item.state)) : 'UNKNOWN';
    const copy = document.querySelector('#obs-summary .obs-summary-copy');
    copy.replaceChildren(stateBadge(overall), Object.assign(document.createElement('p'), { textContent: overall === 'HEALTHY' ? 'All reported evidence is current.' : 'One or more components need attention or fresh evidence.' }));
    document.getElementById('obs-meta').textContent = 'Manifest ' + safeText(manifest.sourceSha, 'unverified SHA') + ' · generated ' + safeText(manifest.generatedAt, 'at unknown time');
    const root = document.getElementById('obs-components');
    root.replaceChildren();
    items.forEach(function (item) {
      const row = document.createElement('article'); row.className = 'obs-component';
      const heading = document.createElement('h3'); heading.textContent = safeText(item.component.label, 'Unnamed component');
      const detail = document.createElement('p'); detail.textContent = safeText(item.component.summary, 'No public-safe summary supplied.');
      const evidence = document.createElement('small'); evidence.textContent = safeText(item.component.evidence, 'Evidence unavailable');
      detail.appendChild(evidence);
      row.append(heading, stateBadge(item.state), detail); root.appendChild(row);
    });
  }

  async function load() {
    try {
      const response = await fetch('system-manifest.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('manifest unavailable');
      render(await response.json());
    } catch (_) { renderUnknown('System evidence is unavailable.'); }
  }

  document.getElementById('obs-refresh')?.addEventListener('click', load);
  window.Observatory = { effectiveState: effectiveState, aggregate: aggregate, render: render, load: load };
  load();
})();
