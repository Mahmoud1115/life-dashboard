// DUNE LIFE OS — Application Logic v2.0
// All JS lives here. data.js must load first.

/* ═══════════════════════════════════════════
   STORAGE HELPERS
   ═══════════════════════════════════════════ */
const LS = {
  get:(k,def)=>{ try{ const v=localStorage.getItem(k); return v===null?def:JSON.parse(v); }catch(e){return def;} },
  set:(k,v)=>{ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};

/* ═══════════════════════════════════════════
   SCROLL PROGRESS BAR
   ═══════════════════════════════════════════ */
window.addEventListener('scroll',()=>{
  const el=document.getElementById('prog');
  if(!el)return;
  const pct=window.scrollY/(document.body.scrollHeight-window.innerHeight)*100;
  el.style.width=Math.min(100,pct)+'%';
});

/* ═══════════════════════════════════════════
   NAVIGATION — 9-GROUP STRUCTURE
   ═══════════════════════════════════════════ */
const NAV_GROUPS={
  home:      {primary:'home',           subs:[]},
  money:     {primary:'finance',        subs:[]},
  goals:     {primary:'qatar',          subs:[{id:'progress',label:'All Goals'}]},
  career:    {primary:'career-tracker', subs:[{id:'easa',label:'EASA Modules'},{id:'logbook',label:'Logbook'}]},
  documents: {primary:'passport',       subs:[{id:'claims',label:'Claims'},{id:'deadlines',label:'Deadlines'}]},
  about:     {primary:'aboutyou',       subs:[{id:'timeline',label:'Life Timeline'}]},
  review:    {primary:'review',         subs:[]},
};
const SEC_TO_GROUP={};
Object.entries(NAV_GROUPS).forEach(([k,g])=>{
  if(!SEC_TO_GROUP[g.primary]) SEC_TO_GROUP[g.primary]=k;
  g.subs.forEach(s=>{if(!SEC_TO_GROUP[s.id]) SEC_TO_GROUP[s.id]=k;});
});

function getSectionName(sid){
  const nsb=document.querySelector('.nsb[data-sec="'+sid+'"]');
  if(nsb) return nsb.textContent.trim();
  const gk=SEC_TO_GROUP[sid];
  if(gk&&NAV_GROUPS[gk]&&NAV_GROUPS[gk].primary===sid) return gk.charAt(0).toUpperCase()+gk.slice(1);
  return sid;
}
function renderSubNav(groupKey){
  const sub=document.getElementById('nav-sub');
  if(!sub) return;
  const g=NAV_GROUPS[groupKey];
  if(!g||!g.subs.length){sub.innerHTML='';return;}
  sub.innerHTML=g.subs.map(s=>'<button class="nsb" data-sec="'+s.id+'" onclick="show(\''+s.id+'\')">'+s.label+'</button>').join('');
}
function syncGroupNav(secId){
  const gk=SEC_TO_GROUP[secId];
  if(!gk) return;
  document.querySelectorAll('.nmb').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current');});
  const mb=document.querySelector('.nmb[data-group="'+gk+'"]');
  if(mb){mb.classList.add('active');mb.setAttribute('aria-current','page');}
  const sub=document.getElementById('nav-sub');
  if(sub&&sub.dataset.group!==gk){sub.dataset.group=gk;renderSubNav(gk);}
  document.querySelectorAll('.nsb').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current');});
  const sb=document.querySelector('.nsb[data-sec="'+secId+'"]');
  if(sb){sb.classList.add('active');sb.setAttribute('aria-current','page');}
}
function showGroup(groupKey){
  const g=NAV_GROUPS[groupKey];
  if(!g) return;
  const sub=document.getElementById('nav-sub');
  if(sub){sub.dataset.group=groupKey;renderSubNav(groupKey);}
  show(g.primary);
  LS.set('dune_activegroup',groupKey);
}
const _secScroll={};
function show(id,e){
  if(e && typeof e.preventDefault==='function') e.preventDefault();

  const prevY=window.scrollY;
  const cur=document.querySelector('.sec.active');
  if(cur) _secScroll[cur.id]=prevY;

  // Pin body (not .main) so the browser viewport engine sees a constant
  // document length throughout the section swap and never resets scrollY.
  document.body.style.minHeight=document.documentElement.scrollHeight+'px';

  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  let sec=document.getElementById(id);
  if(!sec){id='home';sec=document.getElementById('home');} // stale saved section from old plan
  if(sec) sec.classList.add('active');

  const pos=_secScroll[id]!==undefined?_secScroll[id]:prevY;
  window.scrollTo(0,pos);

  requestAnimationFrame(()=>{
    document.body.style.minHeight='';
    // If the new section is short and scroll snapped above the nav, clamp below it.
    const nav=document.querySelector('.nav');
    const navBottom=nav?nav.offsetTop+nav.offsetHeight:0;
    if(window.scrollY<navBottom && prevY>=navBottom){
      window.scrollTo(0,navBottom);
    }
  });

  LS.set('dune_activesec',id);
  syncGroupNav(id);
  document.querySelectorAll('.mob-nb').forEach(mb=>mb.classList.remove('active'));
  document.querySelectorAll('.mob-nb[data-sec="'+id+'"]').forEach(b=>b.classList.add('active'));
}

/* ═══════════════════════════════════════════
   PLAN HEALTH BAR
   ═══════════════════════════════════════════ */
(function(){
  function days(iso){return Math.ceil((new Date(iso)-new Date())/(864e5));}
  function pill(label,val,bg,col){
    return '<span style="display:inline-flex;align-items:center;gap:4px;background:'+bg+';border-radius:100px;padding:3px 11px;white-space:nowrap">'
      +'<span style="font-family:var(--mono);font-size:9px;color:'+col+';opacity:.75">'+label+'</span>'
      +'<span style="font-family:var(--mono);font-size:9px;font-weight:600;color:'+col+'">'+val+'</span>'
      +'</span>';
  }
  function countdown(label,iso){
    const d=days(iso);
    if(d<0)return pill(label,'DONE','var(--green2)','var(--green)');
    if(d<=7)return pill(label,d+'d','var(--red2)','var(--red)');
    if(d<=60)return pill(label,d+'d','var(--amber2)','var(--amber)');
    return pill(label,d+'d','var(--bg3)','var(--tx2)');
  }
  function render(){
    const el=document.getElementById('phb');
    if(!el)return;
    el.innerHTML=[
      pill('Savings','55K/MO','var(--gold3)','var(--gold2)'),
      pill('Settlement','CLOSED','var(--bg3)','var(--tx3)'),
      countdown('MAI Deadline','2026-07-15'),
      countdown('M15 Target','2026-10-01'),
      countdown('ВНЖ Renewal','2027-03-01'),
      countdown('Passport Wall','2028-01-21'),
    ].join('');
  }
  render();
  setInterval(render,60000);
})();

/* ═══════════════════════════════════════════
   PRIVATE / PUBLIC MODE
   ═══════════════════════════════════════════ */
(function(){
  let isPublic=LS.get('dune_privacy',false);
  function maskNodes(){
    document.querySelectorAll('[data-private-val]').forEach(el=>{
      el.textContent=el.getAttribute('data-mask')||'••••••';
    });
  }
  function unmaskNodes(){
    document.querySelectorAll('[data-private-val]').forEach(el=>{
      el.textContent=el.getAttribute('data-private-val');
    });
  }
  function apply(){
    document.body.classList.toggle('public-mode',isPublic);
    document.body.classList.toggle('private-mode-active',isPublic);
    isPublic?maskNodes():unmaskNodes();
    const btn=document.getElementById('privacy-btn');
    const ind=document.getElementById('privacy-ind');
    if(btn){
      const emojiEl=btn.querySelector('.nmb-emoji');
      const labelEl=btn.querySelector('.nmb-label');
      if(emojiEl) emojiEl.textContent=isPublic?'🔒':'👁';
      if(labelEl) labelEl.textContent=isPublic?'Public':'Private';
      btn.classList.toggle('public-mode',isPublic);
    }
    if(ind) ind.classList.toggle('show',isPublic);
  }
  window.togglePrivacy=function(state){
    isPublic=(state!==undefined)?state:!isPublic;
    LS.set('dune_privacy',isPublic);
    apply();
  };
  document.addEventListener('DOMContentLoaded',apply);
})();

/* ═══════════════════════════════════════════
   GLOBAL SEARCH
   ═══════════════════════════════════════════ */
(function(){
  let idx=[];
  function buildIndex(){
    idx=[];
    document.querySelectorAll('.sec').forEach(sec=>{
      const sid=sec.id;
      const sname=getSectionName(sid);
      // collect all text nodes from cards and titles
      sec.querySelectorAll('.ctitle,.dec-title,.tl-title,.mc-title,.kif-title,.claim-title,.goal-title,.risk-mon-title,.dl-title,.crm-card-company').forEach(el=>{
        const txt=el.textContent.trim();
        if(txt) idx.push({id:sid,label:sname,text:txt,el});
      });
      sec.querySelectorAll('.card p,.tl-body,.mc-body,.rb,.dec-body,.kif-body').forEach(el=>{
        const txt=el.textContent.trim().slice(0,120);
        if(txt) idx.push({id:sid,label:sname,text:txt,el});
      });
    });
  }
  function search(q){
    if(!q||q.length<2) return [];
    const lq=q.toLowerCase();
    const seen=new Set();
    return idx.filter(item=>{
      if(item.text.toLowerCase().includes(lq) && !seen.has(item.text)){
        seen.add(item.text);
        return true;
      }
      return false;
    }).slice(0,12);
  }
  window.toggleSearch=function(){
    const bar=document.getElementById('search-wrap');
    if(!bar) return;
    bar.classList.toggle('open');
    if(bar.classList.contains('open')){
      buildIndex();
      document.getElementById('search-input').focus();
    } else {
      document.getElementById('search-input').value='';
      document.getElementById('search-results').innerHTML='';
    }
  };
  window.doSearch=function(e){
    const q=e.target.value.trim();
    const res=document.getElementById('search-results');
    if(!res)return;
    if(!q||q.length<2){res.innerHTML='';return;}
    const results=search(q);
    if(!results.length){res.innerHTML='<div class="sr-empty">No results for "'+q+'"</div>';return;}
    res.innerHTML=results.map(r=>
      '<div class="sr-item" onclick="show(\''+r.id+'\');toggleSearch()">'
      +'<div class="sr-section">'+r.label+'</div>'
      +'<div class="sr-text">'+r.text+'</div>'
      +'</div>'
    ).join('');
  };
})();

/* ═══════════════════════════════════════════
   COLLAPSIBLE CARDS
   ═══════════════════════════════════════════ */
(function(){
  const state=LS.get('dune_cards',{});
  function initCards(){
    document.querySelectorAll('.card.collapsible').forEach(card=>{
      const id=card.dataset.cardId;
      if(!id)return;
      const isCollapsed=state[id]===true;
      if(isCollapsed) card.classList.add('collapsed');
      const ctitle=card.querySelector('.ctitle');
      if(ctitle){
        ctitle.addEventListener('click',()=>{
          card.classList.toggle('collapsed');
          state[id]=card.classList.contains('collapsed');
          LS.set('dune_cards',state);
        });
      }
    });
  }
  document.addEventListener('DOMContentLoaded',initCards);
})();

/* ═══════════════════════════════════════════
   MISSION CONTROL (SB-TASK BOARD — EXISTING)
   ═══════════════════════════════════════════ */
(function(){
  const STORE_KEY='dune_sb_v1';
  function save(id,state,note){
    const d=LS.get(STORE_KEY,{});
    d[id]={state,note:note||''};
    LS.set(STORE_KEY,d);
  }
  function load(){return LS.get(STORE_KEY,{});}
  function updateProgress(){
    const tasks=document.querySelectorAll('.sb-task');
    const done=document.querySelectorAll('.sb-task.state-done,.sb-task.state-noted').length;
    const total=tasks.length;
    const pct=total?Math.round(done/total*100):0;
    const counter=document.getElementById('sb-counter');
    const fill=document.getElementById('sb-fill');
    if(counter) counter.textContent=done+' / '+total+' done ('+pct+'%)';
    if(fill){
      fill.style.transform='scaleX('+(pct/100)+')';
      fill.style.background=pct===100?'var(--green)':pct>50?'var(--amber)':'var(--gold)';
    }
    // per-phase progress
    document.querySelectorAll('.sb-phase').forEach((ph,i)=>{
      const pTasks=ph.querySelectorAll('.sb-task');
      const pDone=ph.querySelectorAll('.sb-task.state-done,.sb-task.state-noted').length;
      const prog=document.getElementById('p'+i+'-prog');
      if(prog) prog.textContent=pDone+'/'+pTasks.length;
    });
  }
  window.cycleTask=function(e,el){
    if(e.target.classList.contains('sb-note')) return;
    const id=el.dataset.id;
    const cur=el.dataset.state||'';
    let next='';
    if(cur==='') next='done';
    else if(cur==='done') next='noted';
    else next='';
    el.dataset.state=next;
    el.className='sb-task'+(next?' state-'+next:'');
    el.querySelector('.sb-state').textContent=next?'✓':'';
    const note=el.querySelector('.sb-note');
    const saved=el.querySelector('.sb-note-saved');
    save(id,next,note?note.value:'');
    updateProgress();
  };
  window.saveNote=function(textarea){
    const task=textarea.closest('.sb-task');
    if(!task)return;
    const id=task.dataset.id;
    const savedEl=document.getElementById('saved-'+id);
    save(id,task.dataset.state||'',textarea.value);
    if(savedEl){savedEl.style.display='block';setTimeout(()=>savedEl.style.display='none',1500);}
  };
  window.resetBoard=function(){
    if(!confirm('Reset all tasks to not done? Notes will be cleared.'))return;
    LS.set(STORE_KEY,{});
    document.querySelectorAll('.sb-task').forEach(el=>{
      el.dataset.state='';
      el.className='sb-task';
      el.querySelector('.sb-state').textContent='';
      const note=el.querySelector('.sb-note');
      if(note) note.value='';
    });
    updateProgress();
  };
  window.openReport=function(){
    const modal=document.getElementById('sb-modal');
    if(!modal) return;
    let txt='DUNE PLAN STATUS REPORT\n';
    txt+='Generated: '+new Date().toLocaleDateString('en-GB')+'\n\n';
    document.querySelectorAll('.sb-phase').forEach(ph=>{
      const pTitle=ph.querySelector('.sb-phase-title');
      if(pTitle) txt+='── '+pTitle.textContent.trim().split('\n')[0]+' ──\n';
      ph.querySelectorAll('.sb-task').forEach(t=>{
        const state=t.dataset.state||'pending';
        const title=t.querySelector('.sb-title').textContent.replace(/\s+/g,' ').trim();
        const note=t.querySelector('.sb-note');
        const noteVal=note&&note.value.trim();
        txt+=(state==='done'||state==='noted'?'✓':'○')+' '+title+'\n';
        if(noteVal) txt+='  → '+noteVal+'\n';
      });
      txt+='\n';
    });
    document.getElementById('sb-report-text').textContent=txt;
    modal.classList.add('open');
  };
  window.closeReport=function(){
    const modal=document.getElementById('sb-modal');
    if(modal) modal.classList.remove('open');
  };
  window.copyReport=function(){
    const txt=document.getElementById('sb-report-text').textContent;
    navigator.clipboard.writeText(txt).then(()=>{
      const btn=document.querySelector('.sb-modal-copy');
      if(btn){btn.textContent='Copied!';setTimeout(()=>btn.textContent='Copy to clipboard',1500);}
    });
  };
  // restore on load
  document.addEventListener('DOMContentLoaded',()=>{
    const saved=load();
    document.querySelectorAll('.sb-task').forEach(el=>{
      const id=el.dataset.id;
      const d=saved[id];
      if(d&&d.state){
        el.dataset.state=d.state;
        el.className='sb-task state-'+d.state;
        el.querySelector('.sb-state').textContent='✓';
        const note=el.querySelector('.sb-note');
        if(note&&d.note) note.value=d.note;
      }
    });
    updateProgress();
  });
})();

/* ═══════════════════════════════════════════
   PHASE 3 — SECTION LABELS & GROUP PILLS
   ═══════════════════════════════════════════ */
const SEC_LABELS={
  home:'📅 Today',
  qatar:'🎯 Visit Mom in Qatar',
  progress:'🎯 All Goals',
  'career-tracker':'✈️ Career Tracker',
  easa:'✈️ EASA Modules',
  logbook:'✈️ Logbook',
  passport:'🛂 Documents',
  claims:'🛂 Claims Register',
  deadlines:'🛂 Deadlines',
  finance:'💰 Money',
  aboutyou:'🧭 About You',
  timeline:'🧭 Life Timeline',
  review:'📓 Weekly Review & Decisions',
};

const GROUP_PILLS={
  qatar:[{id:'progress',label:'All Goals'}],
  'career-tracker':[{id:'easa',label:'EASA Modules'},{id:'logbook',label:'Logbook'}],
  passport:[{id:'claims',label:'Claims'},{id:'deadlines',label:'Deadlines'}],
  aboutyou:[{id:'timeline',label:'Life Timeline'}],
};

function updateSectionLabels(){
  Object.entries(SEC_LABELS).forEach(([id,label])=>{
    const sec=document.getElementById(id);
    if(!sec) return;
    const el=sec.querySelector('.sec-num');
    if(el) el.textContent=label;
  });
}

function addGroupPills(){
  Object.entries(GROUP_PILLS).forEach(([secId,subs])=>{
    const sec=document.getElementById(secId);
    if(!sec||sec.querySelector('.group-pills')) return;
    const hd=sec.querySelector('.sec-hd');
    if(!hd) return;
    const el=document.createElement('div');
    el.className='group-pills';
    el.innerHTML=subs.map(s=>'<button class="group-pill" onclick="show(\''+s.id+'\')">'+s.label+'</button>').join('');
    hd.insertAdjacentElement('afterend',el);
  });
}

function addBreadcrumbs(){
  // for every section that is a sub-section (not a primary), inject a breadcrumb
  const primaries=new Set(Object.values(NAV_GROUPS).map(g=>g.primary));
  primaries.add('home'); // home is always its own primary
  document.querySelectorAll('.sec').forEach(sec=>{
    const id=sec.id;
    if(primaries.has(id)||id==='home') return;
    if(sec.querySelector('.sec-breadcrumb')) return; // already added
    const gk=SEC_TO_GROUP[id];
    if(!gk) return;
    const g=NAV_GROUPS[gk];
    if(!g) return;
    const hd=sec.querySelector('.sec-hd');
    if(!hd) return;
    const bc=document.createElement('button');
    bc.className='sec-breadcrumb';
    bc.textContent=g.primary.charAt(0).toUpperCase()+g.primary.slice(1);
    // use emoji from nav button
    const nmb=document.querySelector('.nmb[data-group="'+gk+'"]');
    const emoji=nmb?nmb.querySelector('.nmb-emoji').textContent:'';
    const label=nmb?nmb.querySelector('.nmb-label').textContent:'';
    bc.textContent=emoji+' '+label;
    bc.onclick=()=>showGroup(gk);
    sec.insertBefore(bc,sec.firstChild);
  });
}

/* ═══════════════════════════════════════════
   HOME — CALENDAR
   ═══════════════════════════════════════════ */
let calYear=new Date().getFullYear();
let calMonth=new Date().getMonth();

function renderCalendar(){
  const gridEl=document.getElementById('cal-grid');
  const labelEl=document.getElementById('cal-month-label');
  if(!gridEl) return;
  const now=new Date();
  const firstDayRaw=new Date(calYear,calMonth,1).getDay(); // 0=Sun
  const startOffset=(firstDayRaw+6)%7; // Mon-first offset
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const monthName=new Date(calYear,calMonth,1).toLocaleDateString('en-GB',{month:'long'});
  if(labelEl) labelEl.textContent=monthName+' '+calYear;
  // build event map
  const ev={};
  D.deadlines.forEach(d=>{
    const dt=new Date(d.date);
    if(dt.getFullYear()===calYear&&dt.getMonth()===calMonth){
      const day=dt.getDate();
      if(!ev[day]) ev[day]=[];
      ev[day].push(d);
    }
  });
  let html='';
  for(let i=0;i<startOffset;i++) html+='<div class="cal-day"></div>';
  for(let day=1;day<=daysInMonth;day++){
    const isToday=now.getFullYear()===calYear&&now.getMonth()===calMonth&&now.getDate()===day;
    const events=ev[day]||[];
    const hasCrit=events.some(e=>e.importance==='critical');
    const hasHigh=events.some(e=>e.importance==='high');
    const tip=events.map(e=>e.title).join('\n');
    const dotCls='cal-dot'+(hasCrit?' critical':hasHigh?' high':'');
    html+='<div class="cal-day'+(isToday?' today':'')+(events.length?' has-event':'')+'"'+(tip?' title="'+tip+'"':'')+'>'+
      '<div class="cal-day-num">'+day+'</div>'+
      (events.length?'<div class="'+dotCls+'"></div>':'')+
    '</div>';
  }
  gridEl.innerHTML=html;
}

function calNav(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  renderCalendar();
}

function renderUpcoming(){
  const el=document.getElementById('home-upcoming-list');
  if(!el) return;
  const now=new Date();
  const items=D.deadlines
    .map(d=>({...d,daysLeft:Math.ceil((new Date(d.date)-now)/864e5)}))
    .filter(d=>d.daysLeft>=-1) // include today
    .sort((a,b)=>a.daysLeft-b.daysLeft)
    .slice(0,9);
  el.innerHTML=items.map(d=>{
    const cls=d.daysLeft<=0?'done':d.daysLeft<=7?'urgent':d.daysLeft<=30?'soon':'ok';
    const dayTxt=d.daysLeft<=0?'done':d.daysLeft+'d';
    const dateStr=new Date(d.date).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
    const priv=d.private?' data-private="true"':'';
    return '<div class="home-up-item"'+priv+'>'+
      '<div class="home-up-days '+cls+'">'+dayTxt+'</div>'+
      '<div>'+
        '<div class="home-up-title">'+d.title+'</div>'+
        '<div class="home-up-meta">'+dateStr+' · '+d.cat+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}

/* ═══════════════════════════════════════════
   HOME — METRIC CARDS
   ═══════════════════════════════════════════ */
function renderMetricCards(){
  const el=document.getElementById('home-metrics');
  if(!el) return;
  const now=new Date();
  function daysTo(iso){return Math.ceil((new Date(iso)-now)/864e5);}

  // EASA
  const easaSt=LS.get('dune_easa_v1',{});
  const easaDone=D.easa.filter(m=>{const s=easaSt[m.id]||{};return (s.status||m.status)==='done';}).length;

  // Logbook
  const lb=LS.get('dune_logbook_v1',[]);
  const lbHours=lb.reduce((a,e)=>a+(parseFloat(e.hours)||0),0);

  // Finance monthly savings
  const fin=LS.get('dune_finance_v1',D.finance);
  const r=fin.russia||D.finance.russia;
  const mSav=(parseFloat(r.salary)||0)-(parseFloat(r.rent)||0)-(parseFloat(r.food)||0)-(parseFloat(r.transport)||0)-(parseFloat(r.utilities)||0)-(parseFloat(r.phone)||0)-(parseFloat(r.family_transfer)||0)-(parseFloat(r.other)||0)-(parseFloat(r.mai)||0);
  const mSavUSD=Math.round(mSav/(parseFloat(r.usd_rate)||88));
  const target=parseFloat(r.save_target)||55000;
  const targetPct=Math.max(0,Math.round(mSav/target*100));

  function card(emoji,label,value,sub,color,priv){
    return '<div class="metric-card"'+(priv?' data-private="true"':'')+'>'+
      '<div class="metric-emoji">'+emoji+'</div>'+
      '<div class="metric-value" style="color:'+color+'">'+value+'</div>'+
      '<div class="metric-label">'+label+'</div>'+
      '<div class="metric-sub">'+sub+'</div>'+
    '</div>';
  }

  const dPass=daysTo('2028-01-21');
  const dMAI=daysTo('2026-07-15');
  const dM15=daysTo('2026-10-01');

  el.innerHTML=[
    card('💼','АэроТраст',
      'Active',
      'CFM56-5B overhaul · 130k ₽ net',
      'var(--green)',true),
    card('💰','Savings vs 55k',
      mSav>0?'₽'+Math.round(mSav/1000)+'k':'₽—',
      mSav>0?targetPct+'% of target · ≈ $'+mSavUSD+'/mo':'Set numbers in Finance tab',
      mSav>=target?'var(--green)':mSav>=target*0.7?'var(--amber)':mSav>0?'var(--red)':'var(--tx3)',true),
    card('📚','EASA B1.1',
      easaDone+'/15',
      easaDone===0?'M15 in progress · exam-ready Oct':easaDone+' done · '+(15-easaDone)+' remaining',
      easaDone>=10?'var(--green)':easaDone>=5?'var(--amber)':'var(--tx3)',false),
    card('⏱','M15 Target',
      dM15<0?'✓':dM15+'d',
      dM15<0?'Done':'Oct 1 · Gas Turbines exam-ready',
      dM15<0?'var(--green)':dM15<=14?'var(--red)':dM15<=45?'var(--amber)':'var(--tx2)',false),
    card('✈️','Logbook',
      lb.length===0?'0h':parseFloat(lbHours.toFixed(1))+'h',
      lb.length===0?'No entries · start day one':lb.length+' entries logged',
      lbHours>500?'var(--green)':lbHours>0?'var(--amber)':'var(--tx3)',false),
    card('🎓','MAI Deadline',
      dMAI<0?'✓':dMAI+'d',
      dMAI<0?'Done':'July 15 · enrollment application',
      dMAI<0?'var(--green)':dMAI<=14?'var(--red)':dMAI<=30?'var(--amber)':'var(--tx2)',false),
    card('🛂','Passport Wall',
      dPass+'d',
      'Jan 21, 2028 · renew before age 28',
      dPass<=90?'var(--red)':dPass<=365?'var(--amber)':'var(--tx2)',false),
  ].join('');
}

/* ═══════════════════════════════════════════
   HOME — MISSION CONTROL WIDGETS
   ═══════════════════════════════════════════ */
function renderHome(){
  // Phase widget
  const now=new Date();
  const foundationEnd=new Date('2026-09-01');
  let phase,phaseSub;
  if(now<foundationEnd){phase='Foundation';phaseSub='АэроТраст start · 55k system live · logbook day one · MAI application';}
  else{phase='Build Mode';phaseSub='CFM56 mastery · EASA modules · certificates · 55k every month';}
  const phEl=document.getElementById('home-phase-name');
  const phSub=document.getElementById('home-phase-sub');
  if(phEl) phEl.textContent=phase;
  if(phSub) phSub.textContent=phaseSub;

  // Next critical deadline
  const upcoming=D.deadlines
    .filter(d=>d.importance==='critical')
    .map(d=>({...d,days:Math.ceil((new Date(d.date)-now)/(864e5))}))
    .filter(d=>d.days>=0)
    .sort((a,b)=>a.days-b.days)[0];
  const ndCount=document.getElementById('home-nd-count');
  const ndTitle=document.getElementById('home-nd-title');
  if(upcoming&&ndCount){
    ndCount.textContent=upcoming.days+'d';
    ndCount.style.color=upcoming.days<=7?'var(--red)':upcoming.days<=30?'var(--amber)':'var(--gold2)';
    if(ndTitle) ndTitle.textContent=upcoming.title;
  }

  // Savings widgets
  const goals=LS.get('dune_goals_v1',{});
  ['go10','go11','go12','go13'].forEach(gid=>{
    const stored=goals[gid]||{};
    const g=D.goals.find(x=>x.id===gid);
    if(!g) return;
    const pct=stored.progress!==undefined?stored.progress:g.progress;
    const el=document.getElementById('home-savings-'+gid);
    const fillEl=document.getElementById('home-savings-fill-'+gid);
    if(el) el.textContent=pct+'%';
    if(fillEl) fillEl.style.width=pct+'%';
  });

  // Top risks
  const sorted=[...D.risks].sort((a,b)=>b.score-a.score).slice(0,4);
  const riskList=document.getElementById('home-risk-list');
  if(riskList){
    riskList.innerHTML=sorted.map(r=>{
      const cls=r.score>=12?'rs-high':r.score>=6?'rs-med':'rs-low';
      return '<div class="home-risk-item"'+(r.private?' data-private="true"':'')+'>'+
        '<div class="risk-score-badge '+cls+'">'+r.score+'</div>'+
        '<div class="home-risk-title">'+r.title+'</div>'+
      '</div>';
    }).join('');
  }
  // Metric cards + calendar + upcoming — isolated so one crash can't freeze the others
  try{renderMetricCards();}catch(e){console.warn('renderMetricCards:',e);}
  try{renderCalendar();}catch(e){console.warn('renderCalendar:',e);}
  try{renderUpcoming();}catch(e){console.warn('renderUpcoming:',e);}
}
document.addEventListener('DOMContentLoaded',renderHome);

/* ═══════════════════════════════════════════
   PROGRESS TRACKER
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_goals_v1';
  let curFilter='all';
  function getStored(){return LS.get(STORE,{});}
  function saveGoal(id,pct,status){
    const d=getStored();
    if(!d[id]) d[id]={};
    if(pct!==undefined) d[id].progress=pct;
    if(status!==undefined) d[id].status=status;
    LS.set(STORE,d);
  }
  function statusLabel(s){
    return {active:'Active',planned:'Planned',done:'Done',blocked:'Blocked'}[s]||s;
  }
  function renderGoals(filter){
    curFilter=filter||curFilter;
    const stored=getStored();
    const container=document.getElementById('goals-list');
    if(!container) return;
    const filtered=D.goals.filter(g=>curFilter==='all'||g.cat===curFilter);
    container.innerHTML=filtered.map(g=>{
      const s=stored[g.id]||{};
      const pct=s.progress!==undefined?s.progress:g.progress;
      const status=s.status||g.status;
      const dotClass={active:'gs-active',planned:'gs-planned',done:'gs-done',blocked:'gs-blocked'}[status]||'gs-planned';
      const deadlineStr=g.deadline?'Due: '+g.deadline:'No fixed deadline';
      const catClass='gt-'+g.cat;
      const isPrivate=g.private?' data-private="true"':'';
      return '<div class="goal-card"'+isPrivate+'>'+
        '<div class="goal-status-dot '+dotClass+'"></div>'+
        '<div class="goal-main">'+
          '<div class="goal-title">'+g.title+'</div>'+
          '<div class="goal-progress-wrap">'+
            '<div class="goal-pbar"><div class="goal-pfill" style="transform:scaleX('+(pct/100)+')"></div></div>'+
            '<input class="goal-pct-input" type="number" min="0" max="100" value="'+pct+'" title="Edit progress %" onchange="updateGoalProgress(\''+g.id+'\',this.value)" />'+
          '</div>'+
          '<div class="goal-meta">'+
            '<span class="goal-tag '+catClass+'">'+g.cat+'</span>'+
            '<span class="goal-deadline">'+deadlineStr+'</span>'+
            '<select class="goal-pct-input" style="width:90px" onchange="updateGoalStatus(\''+g.id+'\',this.value)">'+
              ['active','planned','done','blocked'].map(s=>'<option value="'+s+'"'+(status===s?' selected':'')+'>'+statusLabel(s)+'</option>').join('')+
            '</select>'+
          '</div>'+
          (g.nextAction?'<div class="goal-next">→ '+g.nextAction+'</div>':'')+
          (g.note?'<div class="goal-note">'+g.note+'</div>':'')+
        '</div>'+
      '</div>';
    }).join('');
  }
  window.updateGoalProgress=function(id,val){
    const pct=Math.min(100,Math.max(0,parseInt(val)||0));
    saveGoal(id,pct,undefined);
    renderGoals();
    renderHome();
  };
  window.updateGoalStatus=function(id,val){
    saveGoal(id,undefined,val);
    renderGoals();
  };
  window.filterGoals=function(cat,btn){
    document.querySelectorAll('.pt-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderGoals(cat);
  };
  document.addEventListener('DOMContentLoaded',()=>renderGoals());
})();

/* ═══════════════════════════════════════════
   EASA MODULE TRACKER
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_easa_v1';
  function getStored(){return LS.get(STORE,{});}
  function renderEasa(){
    const stored=getStored();
    const container=document.getElementById('easa-grid');
    if(!container) return;
    const notDone=D.easa.filter(m=>m.status!=='done'||(stored[m.id]&&stored[m.id].status!=='done'));
    const done=D.easa.filter(m=>{ const s=stored[m.id]||{}; return (s.status||m.status)==='done'; });
    // stats
    const totalDone=D.easa.filter(m=>{ const s=stored[m.id]||{}; return (s.status||m.status)==='done'; }).length;
    const totalStudying=D.easa.filter(m=>{ const s=stored[m.id]||{}; return (s.status||m.status)==='studying'; }).length;
    const totalPct=Math.round(D.easa.reduce((a,m)=>{ const s=stored[m.id]||{}; return a+(s.progress!==undefined?s.progress:m.progress); },0)/D.easa.length);
    const statsEl=document.getElementById('easa-stats');
    if(statsEl) statsEl.innerHTML=
      '<div class="lb-stat"><div class="lb-stat-val">'+totalDone+'/15</div><div class="lb-stat-label">Modules Done</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+totalStudying+'</div><div class="lb-stat-label">Studying</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+totalPct+'%</div><div class="lb-stat-label">Avg Progress</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+(15-totalDone-totalStudying)+'</div><div class="lb-stat-label">Not Started</div></div>';
    container.innerHTML=D.easa.map(m=>{
      const s=stored[m.id]||{};
      const pct=s.progress!==undefined?s.progress:m.progress;
      const status=s.status||m.status;
      const priClass='ep-'+(m.priority||'medium');
      const stClass='ebs-'+status;
      const cardClass='es-'+status;
      return '<div class="easa-card '+cardClass+'">'+
        '<div class="easa-num">'+m.num+'</div>'+
        '<div class="easa-title">'+m.title+'</div>'+
        '<div class="easa-bar-wrap"><div class="easa-bar-fill" style="transform:scaleX('+(pct/100)+')"></div></div>'+
        '<div class="easa-meta">'+
          '<select class="easa-status-select" onchange="updateEasaStatus(\''+m.id+'\',this.value)">'+
            ['not_started','studying','done'].map(st=>'<option value="'+st+'"'+(status===st?' selected':'')+'>'+st.replace('_',' ')+'</option>').join('')+
          '</select>'+
          '<input class="easa-pct-input" type="number" min="0" max="100" value="'+pct+'" title="Progress %" onchange="updateEasaPct(\''+m.id+'\',this.value)" />'+
          '<span class="easa-priority '+priClass+'">'+m.priority+'</span>'+
        '</div>'+
        (m.note?'<div class="easa-note">'+m.note+'</div>':'')+
      '</div>';
    }).join('');
  }
  window.updateEasaPct=function(id,val){
    const d=getStored();
    if(!d[id])d[id]={};
    d[id].progress=Math.min(100,Math.max(0,parseInt(val)||0));
    LS.set('dune_easa_v1',d);
    renderEasa();
  };
  window.updateEasaStatus=function(id,val){
    const d=getStored();
    if(!d[id])d[id]={};
    d[id].status=val;
    if(val==='done') d[id].progress=100;
    LS.set('dune_easa_v1',d);
    renderEasa();
  };
  document.addEventListener('DOMContentLoaded',renderEasa);
})();

/* ═══════════════════════════════════════════
   LOGBOOK — ATA COVERAGE GRID
   ═══════════════════════════════════════════ */
function renderATACoverage(entries){
  const el=document.getElementById('lb-ata-coverage');
  if(!el) return;
  const chapters=[
    {n:'20',l:'Standard'},{n:'21',l:'Air Cond'},{n:'22',l:'AutoFlight'},
    {n:'23',l:'Comms'},{n:'24',l:'Electrical'},{n:'25',l:'Equipment'},
    {n:'26',l:'Fire Prot'},{n:'27',l:'Flt Controls'},{n:'28',l:'Fuel'},
    {n:'29',l:'Hydraulic'},{n:'30',l:'Ice & Rain'},{n:'31',l:'Indicating'},
    {n:'32',l:'Ldg Gear'},{n:'33',l:'Lights'},{n:'34',l:'Navigation'},
    {n:'35',l:'Oxygen'},{n:'36',l:'Pneumatic'},{n:'49',l:'APU'},
    {n:'51',l:'Structures'},{n:'71',l:'Power Plant'},{n:'72',l:'Engine'},
    {n:'73',l:'Eng Fuel'},{n:'74',l:'Ignition'},{n:'75',l:'Air'},
    {n:'76',l:'Eng Controls'},{n:'77',l:'Eng Ind.'},{n:'78',l:'Exhaust'},
    {n:'79',l:'Oil'},{n:'80',l:'Starting'},
  ];
  const counts={};
  (entries||[]).forEach(e=>{
    const ch=(e.ata_chapter||'').toString().split('.')[0].trim();
    if(ch) counts[ch]=(counts[ch]||0)+1;
  });
  const covered=chapters.filter(c=>counts[c.n]>0).length;
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  const isEngine=n=>parseInt(n)>=71&&parseInt(n)<=80;
  el.innerHTML=
    '<div class="ata-coverage-header">'+
      '<span class="ata-cov-title">ATA Chapter Coverage — B1.1</span>'+
      '<span class="ata-cov-stats">'+covered+'/'+chapters.length+' chapters · '+total+' entries</span>'+
    '</div>'+
    '<div class="ata-grid">'+
    chapters.map(c=>{
      const cnt=counts[c.n]||0;
      const cls='ata-cell'+(cnt>=3?' filled':cnt>=1?' partial':'')+(isEngine(c.n)?' ata-engine':'');
      return '<div class="'+cls+'" title="ATA '+c.n+' — '+c.l+(cnt?' ('+cnt+' entr'+( cnt===1?'y':'ies')+')':' — none yet')+'">'+
        '<div class="ata-num">'+c.n+'</div>'+
        '<div class="ata-lbl">'+c.l+'</div>'+
        (cnt?'<div class="ata-count">'+cnt+'×</div>':'')+
      '</div>';
    }).join('')+
    '</div>';
}

/* ═══════════════════════════════════════════
   AVIATION LOGBOOK TRACKER
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_logbook_v1';
  let showForm=false;
  let view='table';
  function getEntries(){return LS.get(STORE,[]);}
  function saveEntries(arr){LS.set(STORE,arr);}
  function renderStats(entries){
    const statsEl=document.getElementById('lb-stats');
    if(!statsEl) return;
    const totalHours=entries.reduce((a,e)=>a+(parseFloat(e.hours)||0),0).toFixed(1);
    const types=[...new Set(entries.map(e=>e.aircraft_type).filter(Boolean))].length;
    const stamped=entries.filter(e=>e.stamp_status==='stamped').length;
    const ata71_80=entries.filter(e=>{const c=parseInt(e.ata_chapter);return c>=71&&c<=80;}).length;
    statsEl.innerHTML=
      '<div class="lb-stat"><div class="lb-stat-val">'+entries.length+'</div><div class="lb-stat-label">Total Entries</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+totalHours+'</div><div class="lb-stat-label">Total Hours</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+types+'</div><div class="lb-stat-label">Aircraft Types</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+stamped+'</div><div class="lb-stat-label">Stamped</div></div>'+
      '<div class="lb-stat"><div class="lb-stat-val">'+ata71_80+'</div><div class="lb-stat-label">Engine Tasks (71-80)</div></div>';
  }
  function renderTable(entries){
    const tbody=document.getElementById('lb-tbody');
    if(!tbody) return;
    if(!entries.length){tbody.innerHTML='<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--tx3);font-family:var(--mono);font-size:11px">No entries yet. Add your first logbook entry.</td></tr>';return;}
    tbody.innerHTML=[...entries].reverse().map((e,ri)=>{
      const i=entries.length-1-ri;
      return '<tr>'+
        '<td>'+e.date+'</td>'+
        '<td>'+e.company+'</td>'+
        '<td>'+e.aircraft_type+' '+e.registration+'</td>'+
        '<td><span style="font-family:var(--mono);font-size:10px">ATA '+e.ata_chapter+'</span></td>'+
        '<td style="max-width:200px">'+e.task_description.slice(0,60)+(e.task_description.length>60?'…':'')+'</td>'+
        '<td style="font-family:var(--mono)">'+e.hours+'h</td>'+
        '<td><span style="font-family:var(--mono);font-size:9px;padding:2px 9px;border-radius:100px;background:'+(e.stamp_status==='stamped'?'var(--green2)':'var(--amber2)')+';color:'+(e.stamp_status==='stamped'?'var(--green)':'var(--amber)')+'">'+e.stamp_status+'</span></td>'+
        '<td><div class="lb-row-actions"><button class="lb-row-del" onclick="deleteLogEntry('+i+')">×</button></div></td>'+
      '</tr>';
    }).join('');
  }
  function renderLogbook(){
    const entries=getEntries();
    renderStats(entries);
    renderTable(entries);
    renderATACoverage(entries);
    const form=document.getElementById('lb-form');
    if(form) form.style.display=showForm?'block':'none';
  }
  window.toggleLogForm=function(){
    showForm=!showForm;
    renderLogbook();
  };
  window.submitLogEntry=function(e){
    e.preventDefault();
    const f=e.target;
    const entry={
      id:'lb_'+Date.now(),
      date:f.lb_date.value,
      company:f.lb_company.value,
      aircraft_type:f.lb_aircraft.value,
      registration:f.lb_reg.value,
      engine_type:f.lb_engine.value,
      ata_chapter:f.lb_ata.value,
      system:f.lb_system.value,
      task_description:f.lb_task.value,
      hours:f.lb_hours.value,
      role:f.lb_role.value,
      supervisor:f.lb_supervisor.value,
      stamp_status:f.lb_stamp.value,
      language:f.lb_lang.value,
      b1_relevance:f.lb_b1.value,
    };
    const entries=getEntries();
    entries.push(entry);
    saveEntries(entries);
    f.reset();
    f.lb_date.value=new Date().toISOString().split('T')[0];
    showForm=false;
    renderLogbook();
  };
  window.deleteLogEntry=function(idx){
    if(!confirm('Delete this entry?'))return;
    const entries=getEntries();
    entries.splice(idx,1);
    saveEntries(entries);
    renderLogbook();
  };
  document.addEventListener('DOMContentLoaded',()=>{
    const dateInput=document.getElementById('lb-date-input');
    if(dateInput) dateInput.value=new Date().toISOString().split('T')[0];
    renderLogbook();
  });
})();

/* ═══════════════════════════════════════════
   DEADLINE TRACKER
   ═══════════════════════════════════════════ */
(function(){
  let dlFilter='all';
  function daysBetween(iso){return Math.ceil((new Date(iso)-new Date())/(864e5));}
  function catBadge(cat){
    return '<span class="dl-cat-badge dcat-'+cat+'">'+cat+'</span>';
  }
  function renderDeadlines(filter){
    dlFilter=filter||dlFilter;
    const container=document.getElementById('deadlines-list');
    if(!container) return;
    let items=D.deadlines;
    const now=new Date();
    if(dlFilter==='7') items=items.filter(d=>{ const days=daysBetween(d.date); return days>=0&&days<=7; });
    else if(dlFilter==='30') items=items.filter(d=>{ const days=daysBetween(d.date); return days>=0&&days<=30; });
    else if(dlFilter==='180') items=items.filter(d=>{ const days=daysBetween(d.date); return days>=0&&days<=180; });
    else if(dlFilter==='legal') items=items.filter(d=>['passport','legal','immigration','licensing'].includes(d.cat));
    else if(dlFilter==='overdue') items=items.filter(d=>daysBetween(d.date)<0);
    container.innerHTML=items.map(d=>{
      const days=daysBetween(d.date);
      let numClass,numText;
      if(days<0){numClass='dc-green';numText='DONE';}
      else if(days<=7){numClass='dc-red';numText=days+'d';}
      else if(days<=60){numClass='dc-amber';numText=days+'d';}
      else{numClass='dc-gray';numText=days+'d';}
      const cardClass=d.importance==='critical'?'dl-critical':d.importance==='high'?'dl-high':'';
      const privAttr=d.private?' data-private="true"':'';
      const dateStr=new Date(d.date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      return '<div class="dl-card '+cardClass+'"'+privAttr+'>'+
        '<div class="dl-count '+numClass+'">'+
          '<div class="dl-count-num">'+numText+'</div>'+
          '<div class="dl-count-unit">'+(days<0?'past':'away')+'</div>'+
        '</div>'+
        '<div class="dl-body">'+
          '<div class="dl-title">'+d.title+'</div>'+
          '<div class="dl-meta">'+
            '<span class="dl-date">'+dateStr+'</span>'+
            catBadge(d.cat)+
            '<span class="dl-cat-badge" style="background:var(--bg3);color:var(--tx3)">'+d.importance+'</span>'+
          '</div>'+
          (d.consequence?'<div class="dl-consequence">If missed: '+d.consequence+'</div>':'')+
          (d.note?'<div class="dl-note">'+d.note+'</div>':'')+
          '<button class="dl-ics" onclick="downloadICS(\''+d.id+'\')">+ Add to Calendar</button>'+
        '</div>'+
      '</div>';
    }).join('')||'<div class="lb-empty">No deadlines match this filter.</div>';
  }
  window.filterDeadlines=function(f,btn){
    document.querySelectorAll('.dl-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderDeadlines(f);
  };
  window.downloadICS=function(id){
    const d=D.deadlines.find(x=>x.id===id);
    if(!d) return;
    const dt=d.date.replace(/-/g,'');
    const uid=id+'@dune-life-os';
    const desc=(d.consequence?'If missed: '+d.consequence+'. ':'')+( d.note||'');
    const ics=[
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dune Life OS//EN',
      'BEGIN:VEVENT',
      'UID:'+uid,
      'DTSTART;VALUE=DATE:'+dt,
      'DTEND;VALUE=DATE:'+dt,
      'SUMMARY:'+d.title,
      'DESCRIPTION:'+desc.replace(/\n/g,'\\n'),
      'BEGIN:VALARM','TRIGGER:-P3D','ACTION:DISPLAY','DESCRIPTION:Reminder: '+d.title,'END:VALARM',
      'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY','DESCRIPTION:1 week: '+d.title,'END:VALARM',
      'END:VEVENT','END:VCALENDAR'
    ].join('\r\n');
    const blob=new Blob([ics],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=id+'.ics';
    a.click();
    URL.revokeObjectURL(url);
  };
  window.downloadAllICS=function(){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Dune Life OS//EN'];
    D.deadlines.filter(d=>d.importance==='critical'||d.importance==='high').forEach(d=>{
      const dt=d.date.replace(/-/g,'');
      const desc=(d.consequence?'If missed: '+d.consequence+'. ':'')+( d.note||'');
      lines.push('BEGIN:VEVENT',
        'UID:'+d.id+'@dune-life-os',
        'DTSTART;VALUE=DATE:'+dt,
        'DTEND;VALUE=DATE:'+dt,
        'SUMMARY:'+d.title,
        'DESCRIPTION:'+desc.replace(/\n/g,'\\n'),
        'BEGIN:VALARM','TRIGGER:-P7D','ACTION:DISPLAY','DESCRIPTION:1 week: '+d.title,'END:VALARM',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob=new Blob([lines.join('\r\n')],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download='dune-critical-deadlines.ics'; a.click();
    URL.revokeObjectURL(url);
  };
  document.addEventListener('DOMContentLoaded',()=>renderDeadlines());
})();

/* ═══════════════════════════════════════════
   FINANCE SIMULATOR
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_finance_v1';
  function getInputs(){return LS.get(STORE,D.finance);}
  function saveInputs(v){LS.set(STORE,v);}
  function calcRussia(v){
    const gross=parseFloat(v.salary)||0;
    const expenses=(parseFloat(v.rent)||0)+(parseFloat(v.food)||0)+(parseFloat(v.transport)||0)+(parseFloat(v.utilities)||0)+(parseFloat(v.phone)||0)+(parseFloat(v.family_transfer)||0)+(parseFloat(v.other)||0)+(parseFloat(v.mai)||0);
    const net=gross-expenses;
    const usd=parseFloat(v.usd_rate)||88;
    return {gross,expenses,net,netUSD:(net/usd).toFixed(0),annualUSD:((net*12)/usd).toFixed(0)};
  }
  function renderOutputs(){
    const v=getInputs();
    const rIn=v.russia||D.finance.russia;
    const r=calcRussia(rIn);
    const target=parseFloat(rIn.save_target)||55000;
    const rOut=document.getElementById('fin-russia-out');
    function headline(value,sub,cls){
      return '<div class="fin-headline">'+
        '<div class="fin-headline-label">Monthly Net Savings</div>'+
        '<div class="fin-headline-value '+cls+'">'+value+'</div>'+
        '<div class="fin-headline-sub">'+sub+'</div>'+
      '</div>';
    }
    const hit=r.net>=target;
    if(rOut) rOut.innerHTML=
      headline(
        (r.net>0?'+':'')+Math.round(r.net).toLocaleString()+' ₽',
        '≈ $'+r.netUSD+'/mo · $'+r.annualUSD+'/yr',
        r.net>0?'positive':'negative')+
      '<div class="fin-section-title">Breakdown</div>'+
      row('Net salary',r.gross.toLocaleString()+' ₽')+
      row('Monthly expenses',r.expenses.toLocaleString()+' ₽')+
      row('Monthly surplus',r.net.toLocaleString()+' ₽',r.net>0?'positive':'negative')+
      row('55k target',hit?'✓ HIT — '+Math.round(r.net/target*100)+'%':Math.max(0,Math.round(r.net/target*100))+'% — cut '+Math.max(0,target-r.net).toLocaleString()+' ₽',hit?'positive':'negative')+
      row('Saved per year at 55k','660,000 ₽ · ≈ $'+Math.round(660000/(parseFloat(rIn.usd_rate)||88)).toLocaleString())+
      row('Emergency fund (225k ₽)',r.net>0?Math.ceil(225000/Math.min(r.net,target))+' months':'-');
  }
  function row(label,val,cls){
    return '<div class="fin-result"><span class="fin-result-label">'+label+'</span><span class="fin-result-val'+(cls?' '+cls:'')+'">'+val+'</span></div>';
  }
  function syncInputs(){
    const v=getInputs();
    const rd=D.finance.russia;
    ['salary','rent','food','transport','utilities','phone','family_transfer','other','mai','usd_rate'].forEach(k=>{
      const el=document.getElementById('fin-r-'+k);
      if(!el) return;
      const val=(v.russia&&v.russia[k]!==undefined)?v.russia[k]:rd[k];
      if(val!==undefined) el.value=val;
    });
  }
  let finIndTimer;
  function flashSavedInd(){
    const ind=document.getElementById('fin-saved-ind');
    if(!ind) return;
    ind.style.opacity='1';
    clearTimeout(finIndTimer);
    finIndTimer=setTimeout(()=>{ind.style.opacity='0';},1600);
  }
  window.finInputChange=function(phase,field,val){
    const v=getInputs();
    if(!v[phase]) v[phase]={};
    v[phase][field]=parseFloat(val)||0;
    saveInputs(v);
    renderOutputs();
    flashSavedInd();
    if(typeof bumpChangeCount==='function') bumpChangeCount();
  };
  window.saveFinanceNow=function(){
    // values are already persisted on every keystroke — this re-writes and confirms
    saveInputs(getInputs());
    renderOutputs();
    flashSavedInd();
    if(typeof showBackupToast==='function') showBackupToast('✓ Numbers saved on this device — use ☁ Gist sync to share across devices');
    if(typeof renderHome==='function') try{renderHome();}catch(e){}
  };
  window.setFinScenario=function(s,btn){
    document.querySelectorAll('.fin-scenario').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    const presets={
      conservative:{russia:{salary:130000,rent:30000,food:20000,transport:6000,utilities:4500,phone:1500,family_transfer:0,other:12000,mai:14000}},
      realistic:{russia:{salary:130000,rent:26000,food:16000,transport:5000,utilities:3500,phone:1500,family_transfer:0,other:8000,mai:14000}},
      upside:{russia:{salary:145000,rent:24000,food:14000,transport:4000,utilities:3000,phone:1200,family_transfer:0,other:6000,mai:0}},
    };
    if(presets[s]){
      const v=getInputs();
      if(presets[s].russia) v.russia=Object.assign(v.russia||{},presets[s].russia);
      saveInputs(v);
      syncInputs();
      renderOutputs();
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{ syncInputs(); renderOutputs(); });
})();

/* ═══════════════════════════════════════════
   CLAIMS REGISTER
   ═══════════════════════════════════════════ */
(function(){
  let clFilter='all';
  function renderClaims(filter){
    clFilter=filter||clFilter;
    const container=document.getElementById('claims-list');
    if(!container) return;
    const stored=LS.get('dune_claims_v1',{});
    let items=D.claims;
    if(clFilter!=='all') items=items.filter(c=>c.cat===clFilter||c.confidence===clFilter);
    container.innerHTML=items.map(c=>{
      const s=stored[c.id]||{};
      const conf=s.confidence||c.confidence;
      const isPrivate=c.private?' data-private="true"':'';
      const lastCheck=s.lastChecked||c.lastChecked;
      return '<div class="claim-card conf-'+conf+'"'+isPrivate+'>'+
        '<div class="claim-header">'+
          '<span class="claim-conf-badge">'+conf+'</span>'+
          '<div class="claim-title">'+c.title+'</div>'+
        '</div>'+
        '<div class="claim-text">'+c.text+'</div>'+
        '<div class="claim-meta">'+
          '<span class="claim-meta-item"><strong>Category:</strong> '+c.cat+'</span>'+
          '<span class="claim-meta-item"><strong>Source:</strong> '+c.sourceType+'</span>'+
          '<span class="claim-meta-item"><strong>Checked:</strong> '+lastCheck+'</span>'+
          '<span class="claim-meta-item"><strong>Recheck:</strong> '+c.recheckDate+'</span>'+
        '</div>'+
        '<div class="claim-consequence">'+c.consequence+'</div>'+
        '<div class="claim-next">→ '+c.nextAction+'</div>'+
        '<div style="margin-top:8px;display:flex;gap:8px">'+
          '<select style="font-family:var(--mono);font-size:9px;border:1px solid var(--bdr2);border-radius:2px;padding:3px 6px;background:var(--bg);color:var(--tx);cursor:pointer" onchange="updateClaimConf(\''+c.id+'\',this.value)">'+
            ['verified','likely','uncertain','dangerous'].map(v=>'<option value="'+v+'"'+(conf===v?' selected':'')+'>'+v+'</option>').join('')+
          '</select>'+
          '<button onclick="markClaimChecked(\''+c.id+'\')" style="font-family:var(--mono);font-size:9px;letter-spacing:.5px;text-transform:uppercase;padding:4px 10px;border:1px solid var(--bdr);border-radius:2px;background:none;color:var(--tx3);cursor:pointer">Mark Checked</button>'+
        '</div>'+
      '</div>';
    }).join('');
  }
  window.filterClaims=function(f,btn){
    document.querySelectorAll('.cl-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderClaims(f);
  };
  window.updateClaimConf=function(id,conf){
    const d=LS.get('dune_claims_v1',{});
    if(!d[id])d[id]={};
    d[id].confidence=conf;
    LS.set('dune_claims_v1',d);
    renderClaims();
  };
  window.markClaimChecked=function(id){
    const d=LS.get('dune_claims_v1',{});
    if(!d[id])d[id]={};
    d[id].lastChecked=new Date().toISOString().split('T')[0];
    LS.set('dune_claims_v1',d);
    renderClaims();
  };
  document.addEventListener('DOMContentLoaded',()=>renderClaims());
})();

/* ═══════════════════════════════════════════
   RISK MONITOR (ENHANCED)
   ═══════════════════════════════════════════ */
function renderRiskMonitor(){
  const container=document.getElementById('risk-mon-list');
  if(!container) return;
  const sorted=[...D.risks].sort((a,b)=>b.score-a.score);
  const high=sorted.filter(r=>r.score>=12).length;
  const med=sorted.filter(r=>r.score>=6&&r.score<12).length;
  const low=sorted.filter(r=>r.score<6).length;
  const stats=document.getElementById('risk-mon-stats');
  if(stats) stats.innerHTML=
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--red)">'+high+'</div><div class="risk-stat-label">High Risk (12+)</div></div>'+
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--amber)">'+med+'</div><div class="risk-stat-label">Medium (6-11)</div></div>'+
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--tx3)">'+low+'</div><div class="risk-stat-label">Low (&lt;6)</div></div>'+
    '<div class="risk-stat"><div class="risk-stat-num" style="color:var(--gold2)">'+D.risks.length+'</div><div class="risk-stat-label">Total Tracked</div></div>';
  container.innerHTML=sorted.map(r=>{
    const cls=r.score>=12?'score-high':r.score>=6?'score-med':'score-low';
    const isPrivate=r.private?' data-private="true"':'';
    return '<div class="risk-mon-card"'+isPrivate+'>'+
      '<div class="risk-score '+cls+'">'+r.score+'</div>'+
      '<div class="risk-mon-body">'+
        '<div class="risk-mon-title">'+r.title+'</div>'+
        '<div class="risk-prob-impact">'+
          '<span class="rpi-badge">Prob: '+r.prob+'/5</span>'+
          '<span class="rpi-badge">Impact: '+r.impact+'/5</span>'+
          '<span class="rpi-badge" style="background:var(--bg3);color:var(--tx2)">'+r.cat+'</span>'+
        '</div>'+
        '<div class="risk-mitigation">→ '+r.mitigation+'</div>'+
        '<div class="risk-review">Review: '+r.nextReview+'</div>'+
      '</div>'+
    '</div>';
  }).join('');
}
document.addEventListener('DOMContentLoaded',renderRiskMonitor);

/* ═══════════════════════════════════════════
   FIN TABS
   ═══════════════════════════════════════════ */
window.showFinTab=function(tab,btn){
  document.querySelectorAll('.fin-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.fin-tab').forEach(b=>b.classList.remove('active'));
  const panel=document.getElementById('fin-'+tab);
  if(panel) panel.classList.add('active');
  if(btn) btn.classList.add('active');
};

/* ═══════════════════════════════════════════
   INIT — RESTORE LAST SECTION
   ═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  updateSectionLabels();
  addGroupPills();
  addBreadcrumbs();
  const last=LS.get('dune_activesec','home');
  const lastGroup=LS.get('dune_activegroup','home');
  const sub=document.getElementById('nav-sub');
  if(sub&&NAV_GROUPS[lastGroup]){sub.dataset.group=lastGroup;}
  show(last||'home');
  const savedLbTab=LS.get('dune_logbook_tab_v1','tracker');
  if(savedLbTab!=='tracker') showLbTab(savedLbTab,null);
  renderApartments();
  initBackupSystem();
});

/* ═══════════════════════════════════════════
   FEATURE 2 — BACKUP & RESTORE SYSTEM
   ═══════════════════════════════════════════ */
const BACKUP_KEYS=[
  'dune_finance_v1','dune_sb_v1',
  'dune_goals_v1','dune_easa_v1',
  'dune_logbook_v1','dune_deadlines_ext_v1',
  'dune_apartments_v1','dune_logbook_entries_v1','dune_logbook_tab_v1',
  'dune_claims_v1'
];

function getAllBackupData(){
  const out={};
  BACKUP_KEYS.forEach(k=>{
    const v=localStorage.getItem(k);
    if(v!==null) try{out[k]=JSON.parse(v);}catch(e){out[k]=v;}
  });
  return out;
}
function bumpChangeCount(){
  const c=(parseInt(localStorage.getItem('dune_change_count_v1')||'0'))+1;
  localStorage.setItem('dune_change_count_v1',c);
  updateBackupPill();
}
function initBackupSystem(){
  updateBackupPill();
  checkBackupReminder();
}
function updateBackupPill(){
  const pill=document.getElementById('backup-pill');
  if(!pill) return;
  const last=LS.get('dune_last_backup_v1',null);
  if(!last){pill.textContent='📦 Backup';pill.className='backup-pill bp-red';return;}
  const days=Math.floor((Date.now()-new Date(last).getTime())/86400000);
  pill.textContent='📦 '+(days===0?'Today':days+'d');
  pill.className='backup-pill '+(days<=6?'bp-green':days<=13?'bp-amber':'bp-red');
}
function checkBackupReminder(){
  const last=LS.get('dune_last_backup_v1',null);
  const dismissed=LS.get('dune_backup_dismissed_v1',null);
  const changes=parseInt(localStorage.getItem('dune_change_count_v1')||'0');
  if(dismissed&&(Date.now()-new Date(dismissed).getTime())<3*86400000) return;
  const daysSince=last?Math.floor((Date.now()-new Date(last).getTime())/86400000):999;
  if(daysSince>7||changes>10){
    const rem=document.getElementById('backup-reminder');
    if(rem){
      rem.textContent=last?`📦 Last backed up ${daysSince}d ago · ${changes} changes — Export?`:'📦 No backup yet — export your data';
      rem.style.display='flex';
    }
  }
}
window.dismissBackupReminder=function(){
  LS.set('dune_backup_dismissed_v1',new Date().toISOString());
  const rem=document.getElementById('backup-reminder');
  if(rem) rem.style.display='none';
};
window.openBackupPanel=function(){
  const panel=document.getElementById('backup-panel');
  if(panel) panel.style.display='flex';
  updateGistUI();
};
window.closeBackupPanel=function(){
  const panel=document.getElementById('backup-panel');
  if(panel) panel.style.display='none';
};
window.exportBackup=function(){
  const data=getAllBackupData();
  const backup={version:'2026.1',exported_at:new Date().toISOString(),data};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='dune-backup-'+new Date().toISOString().slice(0,10)+'.json';
  a.click();URL.revokeObjectURL(url);
  LS.set('dune_last_backup_v1',new Date().toISOString());
  localStorage.setItem('dune_change_count_v1','0');
  updateBackupPill();
  const rem=document.getElementById('backup-reminder');
  if(rem) rem.style.display='none';
  showBackupToast('✓ Backup downloaded');
};
window.copyBackupToClipboard=async function(){
  const data=getAllBackupData();
  const json=JSON.stringify({version:'2026.1',exported_at:new Date().toISOString(),data},null,2);
  try{
    await navigator.clipboard.writeText(json);
    showBackupToast('✓ Backup copied to clipboard — paste into Notes on other device');
    LS.set('dune_last_backup_v1',new Date().toISOString());
    updateBackupPill();
  }catch(e){showBackupToast('⚠ Clipboard failed — use JSON download instead');}
};
window.importFromClipboard=async function(){
  try{
    const text=await navigator.clipboard.readText();
    processImport(text);
  }catch(e){showBackupToast('⚠ Cannot read clipboard — use file import instead');}
};
window.triggerImportFile=function(){
  document.getElementById('backup-file-input').click();
};
window.handleImportFile=function(input){
  const file=input.files[0];
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>processImport(e.target.result);
  reader.readAsText(file);
  input.value='';
};
function processImport(text){
  let backup;
  try{backup=JSON.parse(text);}catch(e){showBackupToast('⚠ Invalid file — cannot parse JSON');return;}
  if(!backup.version||!backup.data||Object.keys(backup.data).length<2){showBackupToast('⚠ Invalid backup format');return;}
  const counts=summarizeBackup(backup.data);
  const preview=counts.map(c=>c[0]+': '+c[1]).join(' · ');
  const confirmed=confirm('Restore backup from '+backup.exported_at+'?\n\n'+preview+'\n\n⚠ Overwrites current data. Current data saved as pre-restore backup.');
  if(!confirmed) return;
  // auto-save current before overwrite
  const current=getAllBackupData();
  LS.set('dune_pre_import_backup_v1',{version:'2026.1',exported_at:new Date().toISOString(),data:current});
  // atomic write
  Object.entries(backup.data).forEach(([k,v])=>localStorage.setItem(k,JSON.stringify(v)));
  localStorage.setItem('dune_change_count_v1','0');
  showBackupToast('✓ Restored — '+preview);
  setTimeout(()=>location.reload(),1200);
}
function summarizeBackup(data){
  const out=[];
  if(data.dune_logbook_entries_v1) out.push(['Logbook',(data.dune_logbook_entries_v1||[]).length+' entries']);
  if(data.dune_apartments_v1) out.push(['Apartments',(data.dune_apartments_v1||[]).length]);
  if(data.dune_goals_v1) out.push(['Goals',Object.keys(data.dune_goals_v1||{}).length]);
  return out;
}
function showBackupToast(msg){
  let t=document.getElementById('backup-toast');
  if(!t){t=document.createElement('div');t.id='backup-toast';t.className='backup-toast';document.body.appendChild(t);}
  t.textContent=msg;t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3000);
}

/* ── GITHUB GIST SYNC ── */
function updateGistUI(){
  const sec=document.getElementById('gist-token-section');
  const btns=document.getElementById('gist-action-btns');
  if(!sec) return;
  const token=LS.get('dune_github_token_v1','');
  const gistId=LS.get('dune_gist_id_v1','');
  const lastSync=LS.get('dune_last_gist_sync_v1','');

  if(token){
    sec.innerHTML=`<div class="gist-token-saved">
      <span>🔑 Token saved</span>
      <button class="icl-small-btn icl-del-btn" onclick="clearGistToken()">✕ Remove</button>
    </div>
    ${gistId?`<div class="gist-id-display">Gist ID: <code>${gistId.slice(0,12)}…</code></div>`:''}
    ${lastSync?`<div class="gist-sync-time">Last synced: ${new Date(lastSync).toLocaleString()}</div>`:''}`;
    if(btns) btns.style.display='flex';
  } else {
    sec.innerHTML=`<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <input id="gist-token-input" type="password" class="gist-token-input" placeholder="Paste GitHub token here…">
      <button class="icl-small-btn" onclick="saveGistToken()">Save</button>
    </div>`;
    if(btns) btns.style.display='none';
  }
}

window.saveGistToken=function(){
  const el=document.getElementById('gist-token-input');
  if(!el||!el.value.trim()){showBackupToast('⚠ Paste your token first');return;}
  LS.set('dune_github_token_v1',el.value.trim());
  updateGistUI();
  showBackupToast('✓ Token saved');
};
window.clearGistToken=function(){
  if(!confirm('Remove saved GitHub token?')) return;
  localStorage.removeItem('dune_github_token_v1');
  updateGistUI();
  showBackupToast('Token removed');
};

window.saveToGist=async function(isRetry){
  const token=LS.get('dune_github_token_v1','');
  if(!token){showBackupToast('⚠ No token saved');return;}
  const status=document.getElementById('gist-status');
  if(status) status.textContent='Saving…';
  try{
    const data=getAllBackupData();
    const backup={version:'2026.1',exported_at:new Date().toISOString(),data};
    const content=JSON.stringify(backup,null,2);
    const gistId=LS.get('dune_gist_id_v1','');
    const url=gistId?`https://api.github.com/gists/${gistId}`:'https://api.github.com/gists';
    const method=gistId?'PATCH':'POST';
    const res=await fetch(url,{
      method,
      headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':'application/json'},
      body:JSON.stringify({description:'Dune Life OS — Auto Backup',public:false,files:{'dune-backup.json':{content}}})
    });
    if(!res.ok){
      // 404 with a saved gist id = stale id → clear it and retry ONCE as a create.
      // 404 on create (or on the retry) = token lacks the gist scope — do NOT loop.
      if(res.status===404&&gistId&&!isRetry){LS.set('dune_gist_id_v1','');return window.saveToGist(true);}
      const err=await res.json().catch(()=>({}));
      const msg=(res.status===401||res.status===403||res.status===404)
        ?'Token can\'t access Gists — generate a new token (classic) with the "gist" scope ticked'
        :(err.message||'HTTP '+res.status);
      if(status) status.textContent='⚠ '+msg;
      showBackupToast('⚠ '+msg);return;
    }
    const gist=await res.json();
    LS.set('dune_gist_id_v1',gist.id);
    LS.set('dune_last_backup_v1',new Date().toISOString());
    LS.set('dune_last_gist_sync_v1',new Date().toISOString());
    localStorage.setItem('dune_change_count_v1','0');
    updateBackupPill();
    updateGistUI();
    if(status) status.textContent='';
    showBackupToast('✓ Saved to GitHub Gist');
  }catch(e){
    const msg=e.message||'Network error';
    if(status) status.textContent='⚠ '+msg;
    showBackupToast('⚠ '+msg);
  }
};

window.loadFromGist=async function(){
  const token=LS.get('dune_github_token_v1','');
  if(!token){showBackupToast('⚠ No token saved');return;}
  const status=document.getElementById('gist-status');
  if(status) status.textContent='Loading…';
  try{
    let gistId=LS.get('dune_gist_id_v1','');
    if(!gistId){
      // try to discover by description
      const listRes=await fetch('https://api.github.com/gists?per_page=100',{
        headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}
      });
      if(!listRes.ok){if(status)status.textContent='⚠ Cannot list Gists: '+listRes.status;return;}
      const gists=await listRes.json();
      const found=gists.find(g=>g.description==='Dune Life OS — Auto Backup');
      if(found){gistId=found.id;LS.set('dune_gist_id_v1',gistId);}
      else{
        if(status) status.textContent='';
        const manual=document.getElementById('gist-load-manual');
        if(manual) manual.style.display='block';
        showBackupToast('No backup Gist found — enter Gist ID manually');
        return;
      }
    }
    await loadFromGistId(gistId);
  }catch(e){
    if(status) status.textContent='⚠ '+(e.message||'Network error');
    showBackupToast('⚠ '+(e.message||'Network error'));
  }
};

window.loadFromGistId=async function(gistId){
  const token=LS.get('dune_github_token_v1','');
  const status=document.getElementById('gist-status');
  if(!gistId){showBackupToast('⚠ Enter a Gist ID');return;}
  if(!token){showBackupToast('⚠ No token saved');return;}
  if(status) status.textContent='Loading…';
  try{
    const res=await fetch('https://api.github.com/gists/'+gistId.trim(),{
      headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'}
    });
    if(!res.ok){if(status)status.textContent='⚠ Gist not found: '+res.status;showBackupToast('⚠ Gist not found');return;}
    const gist=await res.json();
    const content=gist.files['dune-backup.json']?.content;
    if(!content){showBackupToast('⚠ dune-backup.json not found in this Gist');return;}
    LS.set('dune_gist_id_v1',gistId.trim());
    updateGistUI();
    if(status) status.textContent='';
    const manual=document.getElementById('gist-load-manual');
    if(manual) manual.style.display='none';
    processImport(content);
  }catch(e){
    if(status) status.textContent='⚠ '+(e.message||'Network error');
    showBackupToast('⚠ '+(e.message||'Network error'));
  }
};

/* ═══════════════════════════════════════════
   FEATURE 3 — LOGBOOK ENTRY BUILDER
   ═══════════════════════════════════════════ */
const LB_ATA=[
  {val:'05',label:'05 — Time Limits'},
  {val:'12',label:'12 — Servicing'},
  {val:'21',label:'21 — Air Conditioning'},
  {val:'24',label:'24 — Electrical Power'},
  {val:'27',label:'27 — Flight Controls'},
  {val:'28',label:'28 — Fuel'},
  {val:'29',label:'29 — Hydraulic Power'},
  {val:'32',label:'32 — Landing Gear'},
  {val:'36',label:'36 — Pneumatic'},
  {val:'71',label:'71 — Powerplant'},
  {val:'72',label:'72 — Engine'},
  {val:'73',label:'73 — Engine Fuel & Control'},
  {val:'74',label:'74 — Ignition'},
  {val:'79',label:'79 — Oil'},
  {val:'80',label:'80 — Starting'},
  {val:'other',label:'Other (specify)'}
];

window.showLbTab=function(tab,btn){
  document.querySelectorAll('.lb-tab-btn').forEach(b=>b.classList.remove('active'));
  const activeBtn=btn||Array.from(document.querySelectorAll('.lb-tab-btn')).find(b=>(b.getAttribute('onclick')||'').includes("'"+tab+"'"));
  if(activeBtn) activeBtn.classList.add('active');
  const t1=document.getElementById('lb-tab-tracker');
  const t2=document.getElementById('lb-tab-builder');
  if(t1) t1.hidden=(tab!=='tracker');
  if(t2) t2.hidden=(tab!=='builder');
  if(tab==='builder') renderLogbookBuilder();
  LS.set('dune_logbook_tab_v1',tab);
};

function renderLogbookBuilder(){
  const root=document.getElementById('lb-builder-root');
  if(!root||root.dataset.rendered==='1') return;
  root.dataset.rendered='1';
  const entries=LS.get('dune_logbook_entries_v1',[]);
  const today=new Date().toISOString().slice(0,10);
  const ataOpts=LB_ATA.map(a=>`<option value="${a.val}">${a.label}</option>`).join('');

  // stats
  const totalHrs=entries.reduce((s,e)=>s+(parseFloat(e.hours)||0),0);
  const now=new Date();
  const monthHrs=entries.filter(e=>{
    const d=new Date(e.date);
    return d.getFullYear()===now.getFullYear()&&d.getMonth()===now.getMonth();
  }).reduce((s,e)=>s+(parseFloat(e.hours)||0),0);
  const ataSet=new Set(entries.map(e=>e.ata).filter(Boolean));

  root.innerHTML=`
  <div class="lbb-stats">
    <div class="lbb-stat"><div class="lbb-stat-val">${entries.length}</div><div class="lbb-stat-lbl">Entries</div></div>
    <div class="lbb-stat"><div class="lbb-stat-val">${totalHrs.toFixed(1)}</div><div class="lbb-stat-lbl">Total hrs</div></div>
    <div class="lbb-stat"><div class="lbb-stat-val">${monthHrs.toFixed(1)}</div><div class="lbb-stat-lbl">This month</div></div>
    <div class="lbb-stat"><div class="lbb-stat-val">${ataSet.size}</div><div class="lbb-stat-lbl">ATA chapters</div></div>
  </div>
  <div class="lbb-form card">
    <div class="ctitle">New Entry</div>
    <div class="lbb-form-grid">
      <div class="lb-field"><label>Date</label><input id="lbb-date" type="date" value="${today}"></div>
      <div class="lb-field"><label>Aircraft Type</label><input id="lbb-aircraft" type="text" placeholder="Airbus A320-200"></div>
      <div class="lb-field"><label>Registration</label><input id="lbb-reg" type="text" placeholder="VP-BQP"></div>
      <div class="lb-field"><label>ATA Chapter</label>
        <select id="lbb-ata" onchange="lbbAtaChange(this)">${ataOpts}</select>
      </div>
      <div class="lb-field" id="lbb-ata-other-wrap" style="display:none"><label>Custom ATA</label><input id="lbb-ata-other" type="text" placeholder="e.g. 30 — Ice & Rain"></div>
      <div class="lb-field"><label>Work Hours</label><input id="lbb-hours" type="number" step="0.5" min="0.5" placeholder="2.5"></div>
      <div class="lb-field"><label>Supervisor</label><input id="lbb-supervisor" type="text" placeholder="Ivan Petrov"></div>
      <div class="lb-field"><label>Task Reference</label><input id="lbb-ref" type="text" placeholder="AMM 72-00-00-200"></div>
      <div class="lb-field" style="grid-column:1/-1"><label>Task Description (English)</label><textarea id="lbb-desc" rows="3" placeholder="Describe what you did — be specific, use ATA language"></textarea></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:8px">
      <button class="lb-btn lb-btn-add" onclick="lbbSaveEntry()">+ Add to Logbook</button>
      <button class="lb-btn lb-btn-view" onclick="lbbClearForm()">Clear</button>
    </div>
  </div>
  <div class="lbb-search-wrap">
    <input class="lbb-search" id="lbb-search" type="text" placeholder="Search entries — aircraft, ATA, description…" oninput="lbbSearch(this.value)">
    <button class="lb-btn lb-btn-view" onclick="lbbExportCSV()" style="white-space:nowrap">⬇ Export CSV</button>
  </div>
  <div id="lbb-entries"></div>`;
  lbbRenderEntries(entries);
}

window.lbbAtaChange=function(sel){
  const wrap=document.getElementById('lbb-ata-other-wrap');
  if(wrap) wrap.style.display=sel.value==='other'?'':'none';
};
window.lbbClearForm=function(){
  ['lbb-aircraft','lbb-reg','lbb-hours','lbb-supervisor','lbb-ref','lbb-desc'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const ata=document.getElementById('lbb-ata');
  if(ata){ata.value='05';lbbAtaChange(ata);}
};
window.lbbSaveEntry=function(){
  const date=document.getElementById('lbb-date')?.value;
  const aircraft=document.getElementById('lbb-aircraft')?.value.trim();
  const reg=document.getElementById('lbb-reg')?.value.trim();
  const ataEl=document.getElementById('lbb-ata');
  const ataOther=document.getElementById('lbb-ata-other')?.value.trim();
  const ata=ataEl?.value==='other'?ataOther:ataEl?.value;
  const ataLabel=ataEl?.value==='other'?ataOther:(LB_ATA.find(a=>a.val===ataEl?.value)?.label||ata);
  const hours=document.getElementById('lbb-hours')?.value;
  const supervisor=document.getElementById('lbb-supervisor')?.value.trim();
  const ref=document.getElementById('lbb-ref')?.value.trim();
  const desc=document.getElementById('lbb-desc')?.value.trim();
  if(!date||!aircraft||!ata||!hours||!desc){alert('Fill in: Date, Aircraft, ATA, Hours, Task Description');return;}
  const entry={id:'lbe_'+Date.now(),date,aircraft,reg,ata,ataLabel,hours:parseFloat(hours),supervisor,ref,desc};
  const entries=LS.get('dune_logbook_entries_v1',[]);
  entries.unshift(entry);
  if(entries.length>50) entries.pop();
  LS.set('dune_logbook_entries_v1',entries);
  bumpChangeCount();
  // update stats
  document.getElementById('lb-builder-root').dataset.rendered='0';
  renderLogbookBuilder();
};
window.lbbDeleteEntry=function(id){
  if(!confirm('Delete this logbook entry? Cannot undo.')) return;
  const entries=LS.get('dune_logbook_entries_v1',[]).filter(e=>e.id!==id);
  LS.set('dune_logbook_entries_v1',entries);
  document.getElementById('lb-builder-root').dataset.rendered='0';
  renderLogbookBuilder();
};
window.lbbReuseEntry=function(id){
  const e=LS.get('dune_logbook_entries_v1',[]).find(x=>x.id===id);
  if(!e) return;
  document.getElementById('lbb-aircraft').value=e.aircraft||'';
  document.getElementById('lbb-reg').value=e.reg||'';
  const ataEl=document.getElementById('lbb-ata');
  if(ataEl){
    const found=LB_ATA.find(a=>a.val===e.ata);
    ataEl.value=found?e.ata:'other';
    lbbAtaChange(ataEl);
    if(!found){const ow=document.getElementById('lbb-ata-other');if(ow)ow.value=e.ataLabel||e.ata||'';}
  }
  document.getElementById('lbb-hours').value=e.hours||'';
  document.getElementById('lbb-supervisor').value=e.supervisor||'';
  document.getElementById('lbb-ref').value=e.ref||'';
  document.getElementById('lbb-desc').value=e.desc||'';
  window.scrollTo({top:document.getElementById('lb-builder-root').offsetTop-100,behavior:'smooth'});
};
window.lbbCopyEntry=async function(id){
  const e=LS.get('dune_logbook_entries_v1',[]).find(x=>x.id===id);
  if(!e) return;
  const text=`${e.date} | ${e.aircraft}${e.reg?' | REG: '+e.reg:''}\nATA ${e.ata} — ${e.ataLabel}\nTask: ${e.desc}\nRef: ${e.ref||'—'} | Hours: ${e.hours} hrs | Supervised by: ${e.supervisor||'—'}`;
  try{await navigator.clipboard.writeText(text);showBackupToast('✓ Entry copied to clipboard');}
  catch(err){alert(text);}
};
function lbbRenderEntries(entries){
  const container=document.getElementById('lbb-entries');
  if(!container) return;
  if(!entries.length){container.innerHTML='<div class="lb-empty">No entries yet. Add your first logbook entry above.</div>';return;}
  container.innerHTML=entries.map(e=>`
    <div class="lbb-entry">
      <div class="lbb-entry-meta">
        <span class="lbb-entry-date">${e.date}</span>
        <span class="lbb-entry-aircraft">${e.aircraft}${e.reg?' · '+e.reg:''}</span>
        <span class="iqa-tag" style="font-size:8px">ATA ${e.ata}</span>
        <span class="lbb-entry-hrs">${e.hours} hrs</span>
      </div>
      <div class="lbb-entry-desc">${e.desc}</div>
      ${e.supervisor?`<div class="lbb-entry-sup">Supervised by: ${e.supervisor}${e.ref?' · '+e.ref:''}</div>`:''}
      <div class="lbb-entry-actions">
        <button class="icl-small-btn" onclick="lbbCopyEntry('${e.id}')">📋 Copy</button>
        <button class="icl-small-btn" onclick="lbbReuseEntry('${e.id}')">♻ Reuse</button>
        <button class="icl-small-btn icl-del-btn" onclick="lbbDeleteEntry('${e.id}')">✕ Delete</button>
      </div>
    </div>`).join('');
}
window.lbbSearch=function(q){
  const entries=LS.get('dune_logbook_entries_v1',[]);
  const filtered=q.trim()?entries.filter(e=>[e.aircraft,e.reg,e.ata,e.desc,e.supervisor].join(' ').toLowerCase().includes(q.toLowerCase())):entries;
  lbbRenderEntries(filtered);
};
window.lbbExportCSV=function(){
  const entries=LS.get('dune_logbook_entries_v1',[]);
  if(!entries.length){alert('No entries to export.');return;}
  const BOM='﻿';
  const header='Date,Aircraft Type,Registration,ATA Chapter,Task Description,Hours,Supervisor,Task Reference\n';
  const rows=entries.map(e=>[e.date,e.aircraft,e.reg||'',e.ataLabel||e.ata,'"'+( e.desc||'').replace(/"/g,'""')+'"',e.hours,e.supervisor||'',e.ref||''].join(',')).join('\n');
  const blob=new Blob([BOM+header+rows],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='logbook-'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
};

/* ═══════════════════════════════════════════
   FEATURE 4 — APARTMENT TRACKER
   ═══════════════════════════════════════════ */
function renderApartments(){
  const root=document.getElementById('apartments-root');
  if(!root) return;
  const apts=LS.get('dune_apartments_v1',[]);
  const filter=root.dataset.filter||'all';
  const sort=root.dataset.sort||'rent_asc';
  const winner=apts.find(a=>a.winner);

  function commuteClass(m){return m<40?'apt-commute-green':m<=60?'apt-commute-amber':'apt-commute-red';}
  function regBadge(r){return r==='yes'?'<span class="apt-reg apt-reg-yes">✓ Reg OK</span>':r==='no'?'<span class="apt-reg apt-reg-no">✗ No Reg</span>':'<span class="apt-reg apt-reg-uk">? Reg Unknown</span>';}
  function statusPill(s){const map={viewing:'apt-s-viewing',applied:'apt-s-applied',rejected:'apt-s-rejected',signed:'apt-s-signed'};return `<span class="apt-status ${map[s]||''}">${s}</span>`;}

  let filtered=apts.filter(a=>{
    if(filter==='all'||filter===a.status) return true;
    if(filter==='reg-yes') return a.registration==='yes';
    if(filter==='reg-no') return a.registration==='no';
    return false;
  });
  filtered=[...filtered].sort((a,b)=>{
    if(sort==='rent_asc') return (a.rent||0)-(b.rent||0);
    if(sort==='commute_asc') return (a.commute_min||0)-(b.commute_min||0);
    return new Date(b.added||0)-new Date(a.added||0);
  });

  const counts={all:apts.length,viewing:0,applied:0,signed:0,rejected:0,'reg-yes':0,'reg-no':0};
  apts.forEach(a=>{if(counts[a.status]!==undefined)counts[a.status]++;if(a.registration==='yes')counts['reg-yes']++;if(a.registration==='no')counts['reg-no']++;});

  root.innerHTML=`
  <div class="ctitle" style="margin-bottom:16px">🏠 Apartment Hunt — Moscow</div>
  ${winner?`<div class="apt-winner-bar">⭐ Top choice: <strong>${winner.address}</strong> · ${winner.rent?winner.rent.toLocaleString()+' ₽':'?'} · ${winner.commute_min?winner.commute_min+' min':'?'} · ${regBadge(winner.registration)}</div>`:''}
  <div class="apt-toolbar">
    <div class="apt-filters">
      ${['all','viewing','applied','signed','reg-yes','reg-no'].map(f=>`<button class="apt-filter-btn ${filter===f?'active':''}" onclick="aptFilter('${f}',this)">${f==='all'?'All':f==='reg-yes'?'✓ Reg OK':f==='reg-no'?'✗ No Reg':f.charAt(0).toUpperCase()+f.slice(1)} <span class="iqa-filter-count">${counts[f]||0}</span></button>`).join('')}
    </div>
    <select class="apt-sort-sel" onchange="aptSort(this.value)">
      <option value="rent_asc" ${sort==='rent_asc'?'selected':''}>Cheapest first</option>
      <option value="commute_asc" ${sort==='commute_asc'?'selected':''}>Shortest commute</option>
      <option value="added_desc" ${sort==='added_desc'?'selected':''}>Newest added</option>
    </select>
  </div>
  <button class="lb-btn lb-btn-add" onclick="aptOpenForm()" style="margin-bottom:16px">+ Add Apartment</button>
  <div id="apt-form-wrap" hidden>
    <div class="card apt-form">
      <div class="ctitle">New Apartment</div>
      <div class="lbb-form-grid">
        <div class="lb-field" style="grid-column:1/-1"><label>Address</label><input id="apt-address" type="text" placeholder="Химки, ул. Панфилова 12, кв. 34"></div>
        <div class="lb-field"><label>Area</label><select id="apt-area"><option value="lobnya">Лобня</option><option value="khimki">Химки</option><option value="mytishchi">Мытищи</option><option value="other">Other</option></select></div>
        <div class="lb-field"><label>Rent (₽/month)</label><input id="apt-rent" type="number" placeholder="26000"></div>
        <div class="lb-field"><label>Rooms</label><select id="apt-rooms"><option value="studio">Studio</option><option value="1">1-room</option><option value="2">2-room</option></select></div>
        <div class="lb-field"><label>Commute to Шереметьево (min)</label><input id="apt-commute" type="number" placeholder="45"></div>
        <div class="lb-field"><label>Migration Registration</label><select id="apt-reg"><option value="unknown">Unknown</option><option value="yes">YES — landlord agrees</option><option value="no">NO — refuses</option></select></div>
        <div class="lb-field"><label>Status</label><select id="apt-status"><option value="viewing">Viewing</option><option value="applied">Applied</option><option value="signed">Signed</option><option value="rejected">Rejected</option></select></div>
        <div class="lb-field" style="grid-column:1/-1"><label>Notes</label><textarea id="apt-notes" rows="2" placeholder="Landlord contact, flexibility on lease, anything important…"></textarea></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:8px">
        <button class="lb-btn lb-btn-add" onclick="aptSave()">Save</button>
        <button class="lb-btn lb-btn-view" onclick="aptCloseForm()">Cancel</button>
      </div>
    </div>
  </div>
  <div class="apt-grid">${filtered.length?filtered.map(a=>{
    const rentColor=a.rent>37000?'color:var(--red);font-weight:700':a.rent>28000?'color:var(--red)':'color:var(--tx)';
    const rentWarn=a.rent>37000?' <span style="color:var(--red)">⚠ Savings collapse</span>':a.rent>28000?' <span style="color:var(--amber)">⚠ Over budget</span>':'';
    const mapsUrl='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(a.address+' Moscow');
    return `<div class="apt-card ${a.winner?'apt-card-winner':''} ${a.registration==='no'?'apt-card-noreg':''}">
      <div class="apt-card-head">
        ${statusPill(a.status)}
        <button class="apt-star ${a.winner?'apt-star-on':''}" onclick="aptToggleWinner('${a.id}')" title="Mark as top choice">⭐</button>
      </div>
      <div class="apt-address">${a.address}</div>
      <div class="apt-meta">
        <span class="apt-area-tag">${a.area}</span>
        <span class="apt-rooms">${a.rooms}-room</span>
      </div>
      <div class="apt-numbers">
        <span class="apt-rent" style="${rentColor}">${a.rent?a.rent.toLocaleString()+' ₽':'-'}${rentWarn}</span>
        <span class="apt-commute ${commuteClass(a.commute_min||99)}">${a.commute_min?a.commute_min+' min':'? min'} to SVO</span>
      </div>
      ${regBadge(a.registration)}
      ${a.notes?`<div class="apt-notes">${a.notes}</div>`:''}
      <div class="apt-actions">
        <a href="${mapsUrl}" target="_blank" class="icl-small-btn">🗺 Maps</a>
        <button class="icl-small-btn icl-del-btn" onclick="aptDelete('${a.id}')">✕ Delete</button>
      </div>
    </div>`;
  }).join(''):'<div class="lb-empty">No apartments yet. Add your first listing above.</div>'}</div>`;
}

window.aptFilter=function(f,btn){
  const root=document.getElementById('apartments-root');
  if(root){root.dataset.filter=f;renderApartments();}
};
window.aptSort=function(s){
  const root=document.getElementById('apartments-root');
  if(root){root.dataset.sort=s;renderApartments();}
};
window.aptOpenForm=function(){const w=document.getElementById('apt-form-wrap');if(w)w.hidden=false;};
window.aptCloseForm=function(){const w=document.getElementById('apt-form-wrap');if(w)w.hidden=true;};
window.aptSave=function(){
  const address=document.getElementById('apt-address')?.value.trim();
  if(!address){alert('Address is required');return;}
  const apts=LS.get('dune_apartments_v1',[]);
  apts.push({
    id:'apt_'+Date.now(),
    address,
    area:document.getElementById('apt-area')?.value||'other',
    rent:parseFloat(document.getElementById('apt-rent')?.value)||0,
    rooms:document.getElementById('apt-rooms')?.value||'1',
    commute_min:parseInt(document.getElementById('apt-commute')?.value)||0,
    registration:document.getElementById('apt-reg')?.value||'unknown',
    status:document.getElementById('apt-status')?.value||'viewing',
    winner:false,
    notes:document.getElementById('apt-notes')?.value.trim()||'',
    added:new Date().toISOString().slice(0,10)
  });
  LS.set('dune_apartments_v1',apts);
  bumpChangeCount();
  aptCloseForm();
  renderApartments();
};
window.aptDelete=function(id){
  if(!confirm('Delete this apartment listing?')) return;
  const apts=LS.get('dune_apartments_v1',[]).filter(a=>a.id!==id);
  LS.set('dune_apartments_v1',apts);
  renderApartments();
};
window.aptToggleWinner=function(id){
  const apts=LS.get('dune_apartments_v1',[]).map(a=>({...a,winner:a.id===id?!a.winner:false}));
  LS.set('dune_apartments_v1',apts);
  renderApartments();
};

/* ════════════════════════════════════════════════════════════
   PHASE 1 — REACTIVE MODULES
   Built on top of Store (core.js). Each module subscribes to a
   slice of state and re-renders. No imperative cross-module calls.
   ════════════════════════════════════════════════════════════ */
(function () {
  if (!window.Store) {
    console.error('[Phase1] Store not loaded — core.js missing');
    return;
  }

  // ─── Utilities ─────────────────────────────────────────────
  function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
  function escapeHTML(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function daysTo(iso) { return Math.ceil((new Date(iso) - new Date()) / 864e5); }
  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
    catch (e) { return iso; }
  }
  function formatMonth(d) {
    try { return d.toLocaleDateString('en-GB', { month:'short', year:'numeric' }); }
    catch (e) { return ''; }
  }
  function flashInd(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 1400);
  }

  // ─── DAILY FOCUS ───────────────────────────────────────────
  function wireFocus() {
    document.querySelectorAll('input[data-focus-idx]').forEach(inp => {
      const idx = parseInt(inp.dataset.focusIdx, 10);
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const cur = (Store.get('todayFocus') || ['','','']).slice();
          while (cur.length < 3) cur.push('');
          cur[idx] = inp.value;
          Store.set('todayFocus', cur);
        }, 200);
      });
    });
    Store.subscribe('todayFocus', s => {
      const focus = s.todayFocus || ['','',''];
      document.querySelectorAll('input[data-focus-idx]').forEach(inp => {
        const idx = parseInt(inp.dataset.focusIdx, 10);
        if (document.activeElement !== inp) inp.value = focus[idx] || '';
      });
    });
  }

  // ─── QATAR VISIT GOAL ──────────────────────────────────────
  function wireQatar() {
    document.querySelectorAll('[data-q-field]').forEach(inp => {
      const field = inp.dataset.qField;
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const val = (inp.type === 'number') ? (parseFloat(inp.value) || 0) : inp.value;
          Store.set('qatarVisit.' + field, val);
        }, 200);
      });
    });
    function syncInputs(s) {
      document.querySelectorAll('[data-q-field]').forEach(inp => {
        const field = inp.dataset.qField;
        const val = s.qatarVisit ? s.qatarVisit[field] : null;
        if (document.activeElement !== inp) inp.value = (val == null ? '' : val);
      });
    }
    function render(s) {
      const d = Store.derive;
      const total = d.qatarTotal(s);
      setText('q-total', total.toLocaleString() + ' ₽');
      setText('q-remaining', d.qatarRemaining(s).toLocaleString() + ' ₽');
      const pct = d.qatarProgressPct(s);
      setText('q-progress-pct', pct + '%');
      const bar = document.getElementById('q-progress-bar');
      if (bar) bar.style.width = Math.min(100, pct) + '%';
      const cap = d.qatarMonthlyCapacity(s);
      setText('q-monthly-cap', cap > 0 ? cap.toLocaleString() + ' ₽/mo' : '—');
      const months = d.qatarMonthsToGo(s);
      setText('q-months-to-go', !isFinite(months) ? '—' : (months === 0 ? 'goal reached ✓' : months + (months === 1 ? ' month' : ' months')));
      const eta = d.qatarETA(s);
      setText('q-eta', eta ? formatMonth(eta) : '—');
      const onTrack = d.qatarOnTrack(s);
      const otEl = document.getElementById('q-on-track');
      if (otEl) {
        if (onTrack === null) { otEl.textContent = 'set travel month'; otEl.className = 'qs-val qs-neutral'; }
        else if (onTrack) { otEl.textContent = '✓ on track'; otEl.className = 'qs-val qs-good'; }
        else { otEl.textContent = '⚠ behind'; otEl.className = 'qs-val qs-bad'; }
      }
    }
    Store.subscribe('qatarVisit', s => { syncInputs(s); render(s); });
    Store.subscribe('money', render);
  }
  window.qatarQuickAdd = function (amount) {
    const cur = Store.get('qatarVisit.saved') || 0;
    Store.set('qatarVisit.saved', Math.max(0, cur + amount));
  };

  // ─── CAREER TRACKER ────────────────────────────────────────
  function wireCareer() {
    ['company','position','started'].forEach(field => {
      const inp = document.getElementById('c-' + field);
      if (!inp) return;
      let t;
      inp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => Store.set('career.' + field, inp.value), 200);
      });
    });
    function syncInputs(s) {
      ['company','position','started'].forEach(field => {
        const inp = document.getElementById('c-' + field);
        if (!inp) return;
        const val = s.career[field] || '';
        if (document.activeElement !== inp) inp.value = val;
      });
    }
    function renderChips(s, kind) {
      const list = s.career[kind] || [];
      const el = document.getElementById('c-' + kind + '-chips');
      if (!el) return;
      el.innerHTML = list.length === 0
        ? '<span style="font-size:11px;color:var(--tx3);font-family:var(--mono)">none yet</span>'
        : list.map((item, i) =>
          '<span class="chip">' + escapeHTML(item) +
          '<button class="chip-x" onclick="removeCareerChip(\'' + kind + '\',' + i + ')">✕</button></span>'
        ).join('');
    }
    function renderLicenses(s) {
      const list = s.career.licenses || [];
      const el = document.getElementById('c-licenses-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<div class="lb-empty">No licenses or milestones yet. Add one below.</div>';
        return;
      }
      el.innerHTML = list.map((l, i) => {
        const days = l.target ? daysTo(l.target) : null;
        const dateBit = l.target ? formatDate(l.target) + (days !== null ? ' · ' + (days >= 0 ? days + 'd' : 'past') : '') : '—';
        const statusCls = 'lic-status-' + (l.status || 'planned');
        return '<div class="license-row ' + statusCls + '">' +
          '<div class="license-name">' + escapeHTML(l.name) + '</div>' +
          '<div class="license-meta">' + dateBit + '</div>' +
          '<select class="license-sel" onchange="updateLicenseStatus(' + i + ',this.value)">' +
            ['planned','in_progress','done'].map(s2 =>
              '<option value="' + s2 + '"' + (l.status === s2 ? ' selected' : '') + '>' +
              ({planned:'Planned','in_progress':'In progress',done:'Done ✓'}[s2]) + '</option>'
            ).join('') +
          '</select>' +
          '<button class="chip-x" onclick="removeLicense(' + i + ')">✕</button>' +
        '</div>';
      }).join('');
    }
    function render(s) {
      syncInputs(s);
      renderChips(s, 'aircraft');
      renderChips(s, 'engines');
      renderLicenses(s);
      const monthsEl = document.getElementById('c-months');
      if (monthsEl) {
        const m = Store.derive.careerMonths(s);
        monthsEl.textContent = m + ' months · ' + (m/12).toFixed(1) + ' years';
      }
    }
    Store.subscribe('career', render);
  }
  window.addCareerChip = function (kind, value) {
    value = String(value || '').trim();
    if (!value) return;
    const cur = Store.get('career.' + kind) || [];
    if (cur.includes(value)) return;
    Store.set('career.' + kind, cur.concat([value]));
  };
  window.removeCareerChip = function (kind, idx) {
    const cur = Store.get('career.' + kind) || [];
    Store.set('career.' + kind, cur.filter((_, i) => i !== idx));
  };
  window.addCareerLicense = function () {
    const name = document.getElementById('lic-name').value.trim();
    if (!name) return;
    const target = document.getElementById('lic-target').value || null;
    const status = document.getElementById('lic-status').value;
    const cur = Store.get('career.licenses') || [];
    Store.set('career.licenses', cur.concat([{ id: 'l_' + Date.now(), name, target, status }]));
    document.getElementById('lic-name').value = '';
    document.getElementById('lic-target').value = '';
  };
  window.updateLicenseStatus = function (i, status) {
    const cur = (Store.get('career.licenses') || []).slice();
    if (!cur[i]) return;
    cur[i] = Object.assign({}, cur[i], { status });
    Store.set('career.licenses', cur);
  };
  window.removeLicense = function (i) {
    const cur = Store.get('career.licenses') || [];
    Store.set('career.licenses', cur.filter((_, idx) => idx !== i));
  };

  // ─── WEEKLY REVIEW + DECISION JOURNAL ──────────────────────
  function wireReview() {
    const wk = document.getElementById('rev-week');
    if (wk && !wk.value) wk.value = new Date().toISOString().slice(0,10);
    function renderReviews(s) {
      const list = (s.reviews || []).slice().reverse();
      const el = document.getElementById('reviews-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<div class="lb-empty">No weekly reviews yet. Try one this Sunday.</div>';
        return;
      }
      el.innerHTML = list.map((r, displayIdx) => {
        const realIdx = (s.reviews.length - 1) - displayIdx;
        const dt = r.week ? formatDate(r.week) : (r.at ? formatDate(r.at) : '');
        return '<div class="review-entry">' +
          '<div class="review-entry-head">' +
            '<span class="review-date">Week of ' + dt + '</span>' +
            '<button class="chip-x" onclick="deleteReview(' + realIdx + ')">✕</button>' +
          '</div>' +
          (r.wins ? '<div class="review-block"><strong>Wins</strong><p>' + escapeHTML(r.wins) + '</p></div>' : '') +
          (r.problems ? '<div class="review-block"><strong>Problems</strong><p>' + escapeHTML(r.problems) + '</p></div>' : '') +
          (r.lessons ? '<div class="review-block"><strong>Lessons</strong><p>' + escapeHTML(r.lessons) + '</p></div>' : '') +
          (r.next ? '<div class="review-block"><strong>Next Week</strong><p>' + escapeHTML(r.next) + '</p></div>' : '') +
        '</div>';
      }).join('');
    }
    function renderDecisions(s) {
      const list = (s.decisions || []).slice().reverse();
      const el = document.getElementById('decisions-list');
      if (!el) return;
      if (list.length === 0) {
        el.innerHTML = '<div class="lb-empty">No decisions journaled yet.</div>';
        return;
      }
      el.innerHTML = list.map((d, displayIdx) => {
        const realIdx = (s.decisions.length - 1) - displayIdx;
        return '<div class="review-entry">' +
          '<div class="review-entry-head">' +
            '<span class="review-date">' + (d.at ? formatDate(d.at) : '') + '</span>' +
            '<span class="review-title">' + escapeHTML(d.title) + '</span>' +
            '<button class="chip-x" onclick="deleteDecision(' + realIdx + ')">✕</button>' +
          '</div>' +
          (d.reasoning ? '<div class="review-block"><strong>Reasoning</strong><p>' + escapeHTML(d.reasoning) + '</p></div>' : '') +
          (d.expected ? '<div class="review-block"><strong>Expected outcome</strong><p>' + escapeHTML(d.expected) + '</p></div>' : '') +
          (d.success ? '<div class="review-block"><strong>Success criteria</strong><p>' + escapeHTML(d.success) + '</p></div>' : '') +
        '</div>';
      }).join('');
    }
    Store.subscribe('reviews', renderReviews);
    Store.subscribe('decisions', renderDecisions);
  }
  window.showReviewTab = function (tab, btn) {
    document.querySelectorAll('.review-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    const w = document.getElementById('review-weekly');
    const d = document.getElementById('review-decisions');
    if (w) w.hidden = tab !== 'weekly';
    if (d) d.hidden = tab !== 'decisions';
  };
  window.saveReview = function () {
    const r = {
      at: new Date().toISOString(),
      week: document.getElementById('rev-week').value,
      wins: document.getElementById('rev-wins').value.trim(),
      problems: document.getElementById('rev-problems').value.trim(),
      lessons: document.getElementById('rev-lessons').value.trim(),
      next: document.getElementById('rev-next').value.trim()
    };
    if (!r.wins && !r.problems && !r.lessons && !r.next) {
      alert('Add at least one note before saving.');
      return;
    }
    const cur = Store.get('reviews') || [];
    Store.set('reviews', cur.concat([r]));
    ['rev-wins','rev-problems','rev-lessons','rev-next'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    flashInd('review-saved-ind');
  };
  window.saveDecision = function () {
    const d = {
      at: new Date().toISOString(),
      title: document.getElementById('dec-title').value.trim(),
      reasoning: document.getElementById('dec-reasoning').value.trim(),
      expected: document.getElementById('dec-expected').value.trim(),
      success: document.getElementById('dec-success').value.trim()
    };
    if (!d.title) { alert('Add a title for the decision.'); return; }
    const cur = Store.get('decisions') || [];
    Store.set('decisions', cur.concat([d]));
    ['dec-title','dec-reasoning','dec-expected','dec-success'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    flashInd('decision-saved-ind');
  };
  window.deleteReview = function (i) {
    if (!confirm('Delete this review?')) return;
    const cur = Store.get('reviews') || [];
    Store.set('reviews', cur.filter((_, idx) => idx !== i));
  };
  window.deleteDecision = function (i) {
    if (!confirm('Delete this decision?')) return;
    const cur = Store.get('decisions') || [];
    Store.set('decisions', cur.filter((_, idx) => idx !== i));
  };

  // ─── LIFE TIMELINE ─────────────────────────────────────────
  function wireTimeline() {
    function render(s) {
      const list = (s.timeline || []).slice().sort((a, b) => new Date(a.at) - new Date(b.at));
      const el = document.getElementById('timeline-list');
      if (!el) return;
      if (list.length === 0) { el.innerHTML = '<div class="lb-empty">Empty timeline.</div>'; return; }
      el.innerHTML = list.map(t => {
        return '<div class="tl-row tl-' + (t.kind || 'past') + '">' +
          '<div class="tl-dot tl-' + (t.kind || 'past') + '-dot"></div>' +
          '<div class="tl-when">' + formatDate(t.at) + '</div>' +
          '<div class="tl-what">' + escapeHTML(t.text) + '</div>' +
          '<button class="chip-x" onclick="deleteTimeline(\'' + t.id + '\')">✕</button>' +
        '</div>';
      }).join('');
    }
    Store.subscribe('timeline', render);
  }
  window.addTimelineEntry = function () {
    const at = document.getElementById('tl-date').value;
    const kind = document.getElementById('tl-kind').value;
    const text = document.getElementById('tl-text').value.trim();
    if (!at || !text) { alert('Date and description required.'); return; }
    const cur = Store.get('timeline') || [];
    Store.set('timeline', cur.concat([{ id: 'tl_' + Date.now(), at, kind, text }]));
    document.getElementById('tl-text').value = '';
  };
  window.deleteTimeline = function (id) {
    if (!confirm('Delete?')) return;
    const cur = Store.get('timeline') || [];
    Store.set('timeline', cur.filter(t => t.id !== id));
  };

  // ─── TODAY — REACTIVE COMMAND CENTER ───────────────────────
  function wireToday() {
    function renderMetrics(s) {
      const el = document.getElementById('home-metrics');
      if (!el) return;
      const d = Store.derive;
      const surplus = d.monthlySurplus(s);
      const target = s.money.save_target || 55000;
      const targetPct = d.saveTargetHitPct(s);
      const easa = d.easaProgress(s);
      const careerM = d.careerMonths(s);
      const qatarPct = d.qatarProgressPct(s);
      const qatarMonths = d.qatarMonthsToGo(s);
      const dPass = daysTo('2028-01-21');
      const dMAI = daysTo('2026-07-15');
      const cards = [
        {emoji:'💰', label:'Monthly Surplus', value: (surplus >= 0 ? '+' : '') + surplus.toLocaleString() + ' ₽',
          sub: targetPct + '% of 55k target',
          color: surplus >= target ? 'var(--green)' : surplus >= target*0.7 ? 'var(--amber)' : 'var(--red)'},
        {emoji:'🎯', label:'Qatar Visit', value: qatarPct + '%',
          sub: !isFinite(qatarMonths) ? 'increase savings to start' : (qatarMonths === 0 ? 'goal reached ✓' : qatarMonths + ' months at pace'),
          color: qatarPct >= 100 ? 'var(--green)' : qatarPct > 0 ? 'var(--amber)' : 'var(--tx3)'},
        {emoji:'📚', label:'EASA B1.1', value: easa.done + '/15',
          sub: easa.pct + '% average progress',
          color: easa.done >= 10 ? 'var(--green)' : easa.done >= 5 ? 'var(--amber)' : 'var(--tx3)'},
        {emoji:'✈️', label:'Career', value: careerM + ' mo',
          sub: (s.career.aircraft||[]).length + ' aircraft · ' + (s.career.engines||[]).length + ' engines',
          color: 'var(--gold2)'},
        {emoji:'🛂', label:'Passport Wall', value: dPass + 'd',
          sub: 'Jan 21 2028 · renew before age 28',
          color: dPass <= 90 ? 'var(--red)' : dPass <= 365 ? 'var(--amber)' : 'var(--tx2)'},
        {emoji:'🎓', label:'MAI Deadline', value: dMAI < 0 ? '✓' : (dMAI + 'd'),
          sub: dMAI < 0 ? 'past · enroll if not yet' : 'July 15 · enrollment app',
          color: dMAI < 0 ? 'var(--green)' : dMAI <= 30 ? 'var(--red)' : 'var(--tx2)'},
      ];
      el.innerHTML = cards.map(c =>
        '<div class="metric-card">' +
          '<div class="metric-emoji">' + c.emoji + '</div>' +
          '<div class="metric-value" style="color:' + c.color + '">' + c.value + '</div>' +
          '<div class="metric-label">' + c.label + '</div>' +
          '<div class="metric-sub">' + c.sub + '</div>' +
        '</div>'
      ).join('');
    }
    function renderGoalsStrip(s) {
      const el = document.getElementById('today-goals-strip');
      if (!el) return;
      const d = Store.derive;
      const qatarPct = d.qatarProgressPct(s);
      const easa = d.easaProgress(s);
      const surplusPct = Math.min(100, d.saveTargetHitPct(s));
      const surplus = d.monthlySurplus(s);
      const target = s.money.save_target || 55000;
      const items = [
        { name: '55k Monthly Savings', pct: surplusPct,
          sub: surplus.toLocaleString() + ' ₽ surplus · target ' + target.toLocaleString() + ' ₽' },
        { name: 'Visit Mom in Qatar', pct: qatarPct,
          sub: d.qatarRemaining(s).toLocaleString() + ' ₽ remaining' +
            (s.qatarVisit.travel_month ? ' · target ' + s.qatarVisit.travel_month : '') },
        { name: 'EASA Part-66 B1.1', pct: easa.pct,
          sub: easa.done + ' of 15 modules done · ' + (15 - easa.done) + ' to go' },
      ];
      el.innerHTML = items.map(g =>
        '<div class="today-goal-row">' +
          '<div class="tg-name">' + g.name + '</div>' +
          '<div class="tg-bar"><div class="tg-fill" style="width:' + Math.min(100, g.pct) + '%"></div></div>' +
          '<div class="tg-pct">' + g.pct + '%</div>' +
          '<div class="tg-sub">' + g.sub + '</div>' +
        '</div>'
      ).join('');
    }
    function renderPhase(s) {
      const now = new Date();
      const foundationEnd = new Date('2026-09-01');
      const phEl = document.getElementById('home-phase-name');
      const subEl = document.getElementById('home-phase-sub');
      if (phEl) phEl.textContent = now < foundationEnd ? 'Foundation' : 'Build Mode';
      if (subEl) subEl.textContent = now < foundationEnd
        ? 'АэроТраст start · 55k system live · logbook day one · MAI application'
        : 'CFM56 mastery · EASA modules · certificates · 55k every month';
    }
    Store.subscribe('*', s => {
      try { renderMetrics(s); renderGoalsStrip(s); renderPhase(s); }
      catch (e) { console.warn('[Today] render:', e); }
    });
  }

  // ─── FINANCE ↔ STORE BRIDGE ────────────────────────────────
  // The existing finance simulator reads/writes localStorage 'dune_finance_v1'.
  // We mirror those changes into Store.money so everything else stays reactive.
  function bridgeFinance() {
    const fieldMap = {
      salary: 'money.salary_net',
      rent: 'money.expenses.rent',
      food: 'money.expenses.food',
      transport: 'money.expenses.transport',
      utilities: 'money.expenses.utilities',
      phone: 'money.expenses.phone',
      family_transfer: 'money.expenses.family_transfer',
      other: 'money.expenses.other',
      mai: 'money.expenses.mai',
      usd_rate: 'money.usd_rate'
    };
    const orig = window.finInputChange;
    window.finInputChange = function (phase, field, val) {
      if (typeof orig === 'function') orig.call(this, phase, field, val);
      if (phase === 'russia' && fieldMap[field]) {
        Store.set(fieldMap[field], parseFloat(val) || 0);
      }
    };
    function pushStoreToInputs(s) {
      const m = s.money;
      const map = [
        ['fin-r-salary', m.salary_net],
        ['fin-r-rent', m.expenses.rent],
        ['fin-r-food', m.expenses.food],
        ['fin-r-transport', m.expenses.transport],
        ['fin-r-utilities', m.expenses.utilities],
        ['fin-r-phone', m.expenses.phone],
        ['fin-r-family_transfer', m.expenses.family_transfer],
        ['fin-r-other', m.expenses.other],
        ['fin-r-mai', m.expenses.mai],
        ['fin-r-usd_rate', m.usd_rate]
      ];
      map.forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (el && document.activeElement !== el && val != null) el.value = val;
      });
      // Also write back to legacy key for the original render function
      try {
        const legacy = JSON.parse(localStorage.getItem('dune_finance_v1') || '{}');
        legacy.russia = legacy.russia || {};
        legacy.russia.salary = m.salary_net;
        legacy.russia.usd_rate = m.usd_rate;
        legacy.russia.save_target = m.save_target;
        Object.assign(legacy.russia, m.expenses);
        localStorage.setItem('dune_finance_v1', JSON.stringify(legacy));
      } catch (e) { /* ignore */ }
    }
    Store.subscribe('money', pushStoreToInputs);
  }

  // ─── ABOUT — META DATA STRIP ───────────────────────────────
  function wireAboutMeta() {
    function inject(s) {
      const sec = document.getElementById('aboutyou');
      if (!sec) return;
      let meta = sec.querySelector('.about-meta-strip');
      const a = s.about || {};
      const html = '<span class="amm-pill">v' + (a.version || 1) + '</span>' +
        '<span class="amm-sep">·</span>' +
        '<span>Created ' + (a.createdAt || '—') + '</span>' +
        '<span class="amm-sep">·</span>' +
        '<span>Last updated ' + (a.lastUpdated || '—') + '</span>';
      if (!meta) {
        meta = document.createElement('div');
        meta.className = 'about-meta-strip';
        const hd = sec.querySelector('.sec-hd');
        if (hd) hd.appendChild(meta);
      }
      meta.innerHTML = html;
    }
    Store.subscribe('about', inject);
  }

  // ─── INIT ──────────────────────────────────────────────────
  function init() {
    try { wireFocus(); } catch (e) { console.error(e); }
    try { wireQatar(); } catch (e) { console.error(e); }
    try { wireCareer(); } catch (e) { console.error(e); }
    try { wireReview(); } catch (e) { console.error(e); }
    try { wireTimeline(); } catch (e) { console.error(e); }
    try { wireToday(); } catch (e) { console.error(e); }
    try { bridgeFinance(); } catch (e) { console.error(e); }
    try { wireAboutMeta(); } catch (e) { console.error(e); }
    console.log('[Phase1] reactive modules wired. Schema v' + Store.SCHEMA_VERSION);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
