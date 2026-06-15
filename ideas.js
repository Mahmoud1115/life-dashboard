// ============================================================
// DUNE LIFE OS — IDEAS · parking lot for what's next
// Standalone nav tab + section. Lives inside state.ideas.
// No cross-module wiring. Editable cards, persists with Gist sync.
// ============================================================

(function (global) {
  'use strict';

  if (!global.Store) { console.error('[IDEAS] core.js missing'); return; }

  const GROUP_KEY  = 'ideas';
  const SECTION_ID = 'ideas';
  const NAV_LABEL  = 'Ideas';
  const NAV_EMOJI  = '✦';
  const SEED_KEY   = 'ideasSeeded';

  // Pre-seed from the conversation that spawned this section.
  // Only runs once — gated on meta.ideasSeeded.
  const SEED_IDEAS = [
    {
      title: 'Stretch savings target — $1,000 / month',
      body: 'Beyond the 55k baseline: push monthly savings toward $1,000 (~70–100k ₽). Compounds to ~1.2M ₽ over the year. Decide where the extra 15–45k comes from — side income, expense compression, or both.',
      tag: 'finance',
      status: 'parked',
      pinned: true
    },
    {
      title: 'Side job on the two days off',
      body: 'The shift pattern leaves two full off-days each cycle. Could carry a low-friction second income — short freelance, weekend gig, or tutoring engineering English. Direct lever for the $1,000/mo target above.',
      tag: 'finance',
      status: 'parked',
      pinned: false
    },
    {
      title: 'Gym — build a real training habit',
      body: 'Shift work plus study eats the body. A gym routine that fits around АэроТраст shifts protects the engine (you) that the whole plan depends on.',
      tag: 'health',
      status: 'parked',
      pinned: false
    },
    {
      title: 'Engine certifications — focused study path',
      body: 'Beyond the EASA Part-66 modules: build a deliberate certificate stack (type courses, HF, FTS, EWIS) for CFM56 and adjacent engines. Each cert compounds the licensing position.',
      tag: 'career',
      status: 'parked',
      pinned: false
    },
    {
      title: 'Archery — pick it up as a weekly practice',
      body: 'A regular archery block as the third anchor of the week: focused, quiet, hand-eye sport. Different texture from gym work — precision rather than load. Fits well around shift days.',
      tag: 'health',
      status: 'parked',
      pinned: false
    }
  ];

  const TAGS = ['finance', 'health', 'career', 'legal', 'other'];
  const STATUSES = ['parked', 'exploring', 'active', 'shelved'];

  // ──────────────────────────────────────────────
  // STYLES
  // ──────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('ideas-styles')) return;
    const css = `
#${SECTION_ID} .ideas-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 14px; margin-top: 18px; flex-wrap: wrap;
}
#${SECTION_ID} .ideas-count {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.5px; text-transform: uppercase; color: var(--tx3);
}
#${SECTION_ID} .ideas-add {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: var(--gold); color: var(--bg2);
  border: 1px solid var(--gold2); border-radius: 4px;
  padding: 9px 16px; cursor: pointer;
  transition: background 120ms ease;
}
#${SECTION_ID} .ideas-add:hover { background: var(--gold2); }

#${SECTION_ID} .ideas-form {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 18px 20px;
  margin-top: 14px;
  display: none;
}
#${SECTION_ID} .ideas-form.is-open { display: block; }
#${SECTION_ID} .ideas-form-row { margin-bottom: 10px; }
#${SECTION_ID} .ideas-form-row:last-child { margin-bottom: 0; }
#${SECTION_ID} .ideas-form-l {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--tx3); margin-bottom: 4px; display: block;
}
#${SECTION_ID} .ideas-input,
#${SECTION_ID} .ideas-textarea,
#${SECTION_ID} .ideas-select {
  width: 100%; box-sizing: border-box;
  background: var(--bg); border: 1px solid var(--bdr);
  border-radius: 4px; padding: 9px 11px;
  font-family: var(--serif); font-size: 14.5px;
  color: var(--tx); line-height: 1.5; outline: none;
  transition: border-color 100ms ease, background 100ms ease;
}
#${SECTION_ID} .ideas-input:focus,
#${SECTION_ID} .ideas-textarea:focus,
#${SECTION_ID} .ideas-select:focus {
  border-color: var(--gold); background: var(--bg2);
}
#${SECTION_ID} .ideas-textarea { min-height: 80px; resize: vertical; }
#${SECTION_ID} .ideas-select {
  font-family: var(--mono); font-size: 12px;
  appearance: none; -webkit-appearance: none;
  background-image: linear-gradient(45deg, transparent 50%, var(--tx3) 50%),
                    linear-gradient(135deg, var(--tx3) 50%, transparent 50%);
  background-position: calc(100% - 14px) 50%, calc(100% - 9px) 50%;
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
  padding-right: 28px;
}
#${SECTION_ID} .ideas-form-pair {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
@media (max-width: 540px) { #${SECTION_ID} .ideas-form-pair { grid-template-columns: 1fr; } }
#${SECTION_ID} .ideas-form-foot {
  display: flex; gap: 8px; justify-content: flex-end;
  margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--bdr);
}
#${SECTION_ID} .ideas-btn-ghost {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1.2px; text-transform: uppercase;
  background: transparent; color: var(--tx2);
  border: 1px solid var(--bdr2);
  padding: 8px 14px; border-radius: 4px; cursor: pointer;
}
#${SECTION_ID} .ideas-btn-ghost:hover { background: var(--bg3); }

#${SECTION_ID} .ideas-list {
  margin-top: 18px;
  display: grid; gap: 14px;
}
#${SECTION_ID} .ideas-card {
  background: var(--bg2); border: 1px solid var(--bdr);
  border-radius: 6px; padding: 20px 22px;
  display: grid; gap: 10px;
}
#${SECTION_ID} .ideas-card.is-pinned {
  border-color: rgba(154,120,50,0.36);
  background: rgba(255,255,255,0.85);
}
#${SECTION_ID} .ideas-card.is-shelved {
  opacity: 0.55;
}
#${SECTION_ID} .ideas-card-hd {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
}
#${SECTION_ID} .ideas-card-meta {
  display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
}
#${SECTION_ID} .ideas-tag {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.4px; text-transform: uppercase;
  background: var(--gold3); color: var(--gold2);
  border: 1px solid rgba(154,120,50,0.20);
  border-radius: 100px; padding: 3px 10px;
}
#${SECTION_ID} .ideas-status {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1.4px; text-transform: uppercase;
  color: var(--tx3);
}
#${SECTION_ID} .ideas-pin {
  background: transparent; border: none; cursor: pointer;
  font-size: 14px; color: var(--tx3); padding: 4px 6px;
  border-radius: 4px;
}
#${SECTION_ID} .ideas-pin:hover { background: var(--bg3); }
#${SECTION_ID} .ideas-pin.is-on { color: var(--gold); }
#${SECTION_ID} .ideas-card-title {
  font-family: var(--serif); font-size: 21px;
  color: var(--tx); margin: 0; font-weight: 500; line-height: 1.25;
}
#${SECTION_ID} .ideas-card-title em { font-style: italic; color: var(--gold); }
#${SECTION_ID} .ideas-card-body {
  font-family: var(--serif); font-size: 15px;
  color: var(--tx2); line-height: 1.6;
  margin: 0; max-width: 68ch;
  white-space: pre-wrap;
}
#${SECTION_ID} .ideas-card-foot {
  display: flex; justify-content: space-between; align-items: center;
  gap: 10px; margin-top: 6px; padding-top: 10px;
  border-top: 1px dashed var(--bdr);
  flex-wrap: wrap;
}
#${SECTION_ID} .ideas-card-when {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 1px; color: var(--tx3);
  text-transform: uppercase;
}
#${SECTION_ID} .ideas-card-actions { display: flex; gap: 6px; }
#${SECTION_ID} .ideas-card-actions button {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 1px; text-transform: uppercase;
  background: transparent; color: var(--tx2);
  border: 1px solid var(--bdr2);
  padding: 6px 11px; border-radius: 4px; cursor: pointer;
  transition: background 100ms ease, color 100ms ease, border-color 100ms ease;
}
#${SECTION_ID} .ideas-card-actions button:hover { background: var(--bg3); color: var(--tx); }
#${SECTION_ID} .ideas-card-actions .ideas-delete:hover {
  color: #a04040; border-color: rgba(160,64,64,0.40);
  background: rgba(160,64,64,0.04);
}

#${SECTION_ID} .ideas-empty {
  font-family: var(--serif); font-style: italic;
  color: var(--tx3); font-size: 15px;
  text-align: center; padding: 30px 0;
}
    `;
    const tag = document.createElement('style');
    tag.id = 'ideas-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ──────────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────────
  function nowISO() { return new Date().toISOString(); }
  function uid() {
    return 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // ──────────────────────────────────────────────
  // SEED ONCE
  // ──────────────────────────────────────────────
  function seedIfNeeded() {
    const cur = global.Store.get('ideas') || [];
    const meta = global.Store.get('meta') || {};
    if (meta[SEED_KEY]) return;
    if (cur.length > 0) {
      // user already has ideas — just mark seeded so we don't double-add
      meta[SEED_KEY] = true;
      global.Store.set('meta', meta);
      return;
    }
    const t = nowISO();
    const seeded = SEED_IDEAS.map(s => Object.assign({
      id: uid(), createdAt: t, updatedAt: t
    }, s));
    global.Store.set('ideas', seeded);
    meta[SEED_KEY] = true;
    global.Store.set('meta', meta);
  }

  // ──────────────────────────────────────────────
  // NAV BUTTON
  // ──────────────────────────────────────────────
  function injectNavButton() {
    const navMain = document.querySelector('.nav .nav-main');
    if (!navMain) return;
    if (document.querySelector('.nmb[data-group="' + GROUP_KEY + '"]')) return;

    const btn = document.createElement('button');
    btn.className = 'nmb';
    btn.dataset.group = GROUP_KEY;
    btn.setAttribute('onclick', "IDEAS.goto()");
    btn.innerHTML =
      '<span class="nmb-emoji">' + NAV_EMOJI + '</span>' +
      '<span class="nmb-label">' + NAV_LABEL + '</span>';

    // Insert before Review so the order reads: ... Behavior · Ideas · Review · Sync
    const reviewBtn = navMain.querySelector('.nmb[data-group="review"]');
    if (reviewBtn) navMain.insertBefore(btn, reviewBtn);
    else {
      const utilBtn = navMain.querySelector('.nmb.nmb-util');
      if (utilBtn) navMain.insertBefore(btn, utilBtn);
      else navMain.appendChild(btn);
    }
  }

  // ──────────────────────────────────────────────
  // SECTION
  // ──────────────────────────────────────────────
  function injectSection() {
    if (document.getElementById(SECTION_ID)) return;
    const main = document.querySelector('main.main');
    if (!main) return;
    const sec = document.createElement('section');
    sec.className = 'sec';
    sec.id = SECTION_ID;
    sec.innerHTML = `
      <div class="sec-hd">
        <div class="sec-num">${NAV_EMOJI} Ideas</div>
        <h2 class="sec-title">Ideas —<br><em>parking lot for what's next</em></h2>
        <p class="sec-intro">Things on your mind that aren't decisions yet. Park them here so the active sections stay focused. Edit, pin, shelve, or promote into a real plan when the time comes.</p>
      </div>
      <div id="ideas-body"></div>
    `;
    main.appendChild(sec);
  }

  function goto() {
    if (typeof global.show === 'function') global.show(SECTION_ID);
    else {
      document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
      const sec = document.getElementById(SECTION_ID);
      if (sec) sec.classList.add('active');
    }
    document.querySelectorAll('.nmb').forEach(b => { b.classList.remove('active'); b.removeAttribute('aria-current'); });
    const btn = document.querySelector('.nmb[data-group="' + GROUP_KEY + '"]');
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-current', 'page'); }
    const sub = document.getElementById('nav-sub');
    if (sub) { sub.innerHTML = ''; sub.dataset.group = GROUP_KEY; }
    try { localStorage.setItem('dune_activesec', JSON.stringify(SECTION_ID)); } catch (e) {}
  }

  // ──────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────
  let formOpen = false;
  let editingId = null;

  function renderHead(ideas) {
    const parked = ideas.filter(i => i.status === 'parked').length;
    const exploring = ideas.filter(i => i.status === 'exploring').length;
    const counts = [];
    if (parked)    counts.push(parked + ' parked');
    if (exploring) counts.push(exploring + ' exploring');
    counts.push(ideas.length + ' total');
    return `
      <div class="ideas-head">
        <div class="ideas-count">${counts.join(' · ')}</div>
        <button class="ideas-add" type="button" data-action="toggle-form">${formOpen ? 'close' : '+ add idea'}</button>
      </div>
    `;
  }

  function renderForm(editing) {
    const ed = editing || { title: '', body: '', tag: 'other', status: 'parked' };
    const isEdit = !!editing;
    return `
      <div class="ideas-form ${formOpen ? 'is-open' : ''}" id="ideas-form">
        <div class="ideas-form-row">
          <label class="ideas-form-l">Title</label>
          <input class="ideas-input" type="text" data-field="title" value="${esc(ed.title)}" placeholder="One short line — the idea itself" maxlength="120">
        </div>
        <div class="ideas-form-row">
          <label class="ideas-form-l">Body (optional)</label>
          <textarea class="ideas-textarea" data-field="body" placeholder="Why it matters · what it would look like · what's blocking it…">${esc(ed.body)}</textarea>
        </div>
        <div class="ideas-form-row ideas-form-pair">
          <div>
            <label class="ideas-form-l">Tag</label>
            <select class="ideas-select" data-field="tag">
              ${TAGS.map(t => `<option value="${t}" ${ed.tag === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="ideas-form-l">Status</label>
            <select class="ideas-select" data-field="status">
              ${STATUSES.map(s => `<option value="${s}" ${ed.status === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="ideas-form-foot">
          <button class="ideas-btn-ghost" type="button" data-action="cancel">cancel</button>
          <button class="ideas-add" type="button" data-action="save">${isEdit ? 'save changes' : 'park this idea'}</button>
        </div>
      </div>
    `;
  }

  function renderCard(idea) {
    return `
      <div class="ideas-card ${idea.pinned ? 'is-pinned' : ''} ${idea.status === 'shelved' ? 'is-shelved' : ''}" data-id="${esc(idea.id)}">
        <div class="ideas-card-hd">
          <div class="ideas-card-meta">
            <span class="ideas-tag">${esc(idea.tag || 'other')}</span>
            <span class="ideas-status">· ${esc(idea.status || 'parked')}</span>
          </div>
          <button class="ideas-pin ${idea.pinned ? 'is-on' : ''}" type="button" data-action="pin" data-id="${esc(idea.id)}" aria-label="${idea.pinned ? 'Unpin' : 'Pin'}" title="${idea.pinned ? 'Unpin' : 'Pin'}">★</button>
        </div>
        <h3 class="ideas-card-title">${esc(idea.title)}</h3>
        ${idea.body ? `<p class="ideas-card-body">${esc(idea.body)}</p>` : ''}
        <div class="ideas-card-foot">
          <span class="ideas-card-when">${esc(fmtDate(idea.createdAt))}${idea.updatedAt && idea.updatedAt !== idea.createdAt ? ' · edited ' + esc(fmtDate(idea.updatedAt)) : ''}</span>
          <div class="ideas-card-actions">
            <button type="button" data-action="edit" data-id="${esc(idea.id)}">edit</button>
            <button type="button" class="ideas-delete" data-action="delete" data-id="${esc(idea.id)}">delete</button>
          </div>
        </div>
      </div>
    `;
  }

  function sortIdeas(arr) {
    const order = { parked: 0, exploring: 1, active: 2, shelved: 3 };
    return arr.slice().sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      const ka = order[a.status] != null ? order[a.status] : 99;
      const kb = order[b.status] != null ? order[b.status] : 99;
      if (ka !== kb) return ka - kb;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }

  function renderBody() {
    const body = document.getElementById('ideas-body');
    if (!body) return;
    const ideas = global.Store.get('ideas') || [];
    const editing = editingId ? ideas.find(i => i.id === editingId) : null;
    const sorted = sortIdeas(ideas);
    body.innerHTML = `
      ${renderHead(ideas)}
      ${renderForm(editing)}
      <div class="ideas-list">
        ${ideas.length === 0
          ? `<div class="ideas-empty">Nothing parked yet. Click <strong>+ add idea</strong> to start.</div>`
          : sorted.map(renderCard).join('')}
      </div>
    `;
    wireBody(body);
  }

  function wireBody(body) {
    body.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        const act = el.dataset.action;
        const id = el.dataset.id;
        if (act === 'toggle-form') {
          formOpen = !formOpen;
          editingId = null;
          renderBody();
          if (formOpen) {
            const t = document.querySelector('#ideas-form [data-field="title"]');
            if (t) t.focus();
          }
        } else if (act === 'cancel') {
          formOpen = false;
          editingId = null;
          renderBody();
        } else if (act === 'save') {
          saveFromForm();
        } else if (act === 'edit') {
          editingId = id;
          formOpen = true;
          renderBody();
          const t = document.querySelector('#ideas-form [data-field="title"]');
          if (t) t.focus();
        } else if (act === 'delete') {
          if (!confirm('Delete this idea?')) return;
          removeIdea(id);
        } else if (act === 'pin') {
          togglePin(id);
        }
      });
    });
  }

  function readForm() {
    const form = document.getElementById('ideas-form');
    if (!form) return null;
    return {
      title:  form.querySelector('[data-field="title"]').value.trim(),
      body:   form.querySelector('[data-field="body"]').value,
      tag:    form.querySelector('[data-field="tag"]').value,
      status: form.querySelector('[data-field="status"]').value
    };
  }

  function saveFromForm() {
    const data = readForm();
    if (!data) return;
    if (!data.title) {
      alert('Give it a title — even a rough one.');
      return;
    }
    if (editingId) {
      updateIdea(editingId, data);
    } else {
      addIdea(data);
    }
    formOpen = false;
    editingId = null;
    renderBody();
  }

  // ──────────────────────────────────────────────
  // ACTIONS
  // ──────────────────────────────────────────────
  function addIdea(data) {
    const t = nowISO();
    const idea = {
      id: uid(),
      title: data.title.slice(0, 200),
      body: data.body || '',
      tag: TAGS.indexOf(data.tag) !== -1 ? data.tag : 'other',
      status: STATUSES.indexOf(data.status) !== -1 ? data.status : 'parked',
      pinned: false,
      createdAt: t,
      updatedAt: t
    };
    global.Store.update('ideas', list => (list || []).concat([idea]));
    return idea;
  }
  function updateIdea(id, patch) {
    global.Store.update('ideas', list =>
      (list || []).map(i => i.id === id ? Object.assign({}, i, patch, { updatedAt: nowISO() }) : i));
  }
  function removeIdea(id) {
    global.Store.update('ideas', list => (list || []).filter(i => i.id !== id));
  }
  function togglePin(id) {
    global.Store.update('ideas', list =>
      (list || []).map(i => i.id === id ? Object.assign({}, i, { pinned: !i.pinned, updatedAt: nowISO() }) : i));
  }

  // ──────────────────────────────────────────────
  // BOOT
  // ──────────────────────────────────────────────
  // One-shot fixup: the original seed misread voice input ("archery" → "Arseny").
  // Update any existing card that still carries the old title. Idempotent —
  // gated on meta.ideasArcheryFix so it only ever runs once per device.
  function fixupArchery() {
    const meta = global.Store.get('meta') || {};
    if (meta.ideasArcheryFix) return;
    const ideas = global.Store.get('ideas') || [];
    let changed = false;
    const next = ideas.map(i => {
      if (i.title === 'Padel / sport with Arseny') {
        changed = true;
        return Object.assign({}, i, {
          title: 'Archery — pick it up as a weekly practice',
          body:  'A regular archery block as the third anchor of the week: focused, quiet, hand-eye sport. Different texture from gym work — precision rather than load. Fits well around shift days.',
          updatedAt: nowISO()
        });
      }
      return i;
    });
    if (changed) global.Store.set('ideas', next);
    meta.ideasArcheryFix = true;
    global.Store.set('meta', meta);
  }

  function boot() {
    injectStyles();
    injectNavButton();
    injectSection();
    seedIfNeeded();
    fixupArchery();
    renderBody();
    global.Store.subscribe('ideas', renderBody);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.IDEAS = {
    goto, addIdea, updateIdea, removeIdea, togglePin,
    TAGS, STATUSES
  };
})(window);
