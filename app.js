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
  home:     {primary:'home',      subs:[]},
  career:   {primary:'career',    subs:[{id:'interviews',label:'Interviews'},{id:'decisions',label:'Decisions'},{id:'logbook',label:'Logbook'},{id:'easa',label:'EASA'},{id:'jobs',label:'Jobs'}]},
  documents:{primary:'passport',  subs:[{id:'claims',label:'Claims'},{id:'deadlines',label:'Deadlines'}]},
  gulf:     {primary:'gulf',      subs:[{id:'finance',label:'Finance'},{id:'monitor',label:'Monitor'}]},
  passport2:{primary:'australia', subs:[{id:'canada',label:'Canada 🇨🇦'},{id:'usa',label:'USA 🇺🇸'},{id:'myoption',label:'My Opinion'},{id:'timeline',label:'Timeline'}]},
  money:    {primary:'money',     subs:[{id:'finance',label:'Simulator'},{id:'progress',label:'Goals'}]},
  life:     {primary:'moscow',    subs:[{id:'dtbureau',label:'🧸 Elisa'},{id:'cards',label:'Keep In Front'},{id:'questions',label:'Questions'},{id:'aboutyou',label:'About You'}]},
  risks:    {primary:'riskmon',   subs:[{id:'risks',label:'Risk Cards'},{id:'claims',label:'Claims'},{id:'monitor',label:'Monitor'}]},
  mission:  {primary:'todo',      subs:[{id:'timeline',label:'Timeline'},{id:'deadlines',label:'Deadlines'},{id:'progress',label:'Goals'}]},
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
  document.querySelectorAll('.nmb').forEach(b=>b.classList.remove('active'));
  const mb=document.querySelector('.nmb[data-group="'+gk+'"]');
  if(mb) mb.classList.add('active');
  const sub=document.getElementById('nav-sub');
  if(sub&&sub.dataset.group!==gk){sub.dataset.group=gk;renderSubNav(gk);}
  document.querySelectorAll('.nsb').forEach(b=>b.classList.remove('active'));
  const sb=document.querySelector('.nsb[data-sec="'+secId+'"]');
  if(sb) sb.classList.add('active');
}
function showGroup(groupKey){
  const g=NAV_GROUPS[groupKey];
  if(!g) return;
  const sub=document.getElementById('nav-sub');
  if(sub){sub.dataset.group=groupKey;renderSubNav(groupKey);}
  show(g.primary);
  LS.set('dune_activegroup',groupKey);
}
function show(id){
  document.querySelectorAll('.sec').forEach(s=>s.classList.remove('active'));
  const sec=document.getElementById(id);
  if(sec) sec.classList.add('active');
  window.scrollTo(0,0);
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
      countdown('Interview 1','2026-06-02'),
      countdown('Interview 2','2026-06-04'),
      pill('Settlement','CLOSED','var(--bg3)','var(--tx3)'),
      countdown('MAI Deadline','2026-07-15'),
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
  function apply(){
    document.body.classList.toggle('public-mode',isPublic);
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
  window.togglePrivacy=function(){
    isPublic=!isPublic;
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
      fill.style.width=pct+'%';
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
  decisions:'✈️ Career — Decisions',
  moscow:'💍 Life — Moscow',
  interviews:'✈️ Career — Interviews',
  career:'✈️ Career',
  passport:'🛂 Documents',
  gulf:'🇦🇪 Gulf',
  australia:'🌍 2nd Passport',
  canada:'🌍 Canada',
  usa:'🌍 USA',
  myoption:'🌍 My Opinion',
  money:'💰 Money',
  timeline:'✅ Mission — Timeline',
  monitor:'🇦🇪 Gulf — Monitor',
  cards:'💍 Life — Keep In Front',
  risks:'⚠️ Risk Cards',
  questions:'💍 Life — Questions',
  todo:'✅ Mission Control',
  aboutyou:'💍 About You',
  dtbureau:'💍 Life — 🧸',
  progress:'✅ Goals',
  easa:'✈️ EASA Modules',
  logbook:'✈️ Logbook',
  deadlines:'✅ Deadlines',
  finance:'💰 Finance Simulator',
  jobs:'✈️ Job Pipeline',
  claims:'🛂 Claims Register',
  riskmon:'⚠️ Risk Monitor',
};

const GROUP_PILLS={
  career:[{id:'interviews',label:'Interviews'},{id:'decisions',label:'Decisions'},{id:'logbook',label:'Logbook'},{id:'easa',label:'EASA'},{id:'jobs',label:'Jobs'}],
  passport:[{id:'claims',label:'Claims'},{id:'deadlines',label:'Deadlines'}],
  gulf:[{id:'finance',label:'Finance'},{id:'monitor',label:'Monitor'}],
  australia:[{id:'canada',label:'Canada 🇨🇦'},{id:'usa',label:'USA 🇺🇸'},{id:'myoption',label:'My Opinion'},{id:'timeline',label:'Timeline'}],
  money:[{id:'finance',label:'Simulator'},{id:'progress',label:'Goals'}],
  moscow:[{id:'dtbureau',label:'🧸 Elisa'},{id:'cards',label:'Keep In Front'},{id:'questions',label:'Questions'},{id:'aboutyou',label:'About You'}],
  riskmon:[{id:'risks',label:'Risk Cards'},{id:'claims',label:'Claims'},{id:'monitor',label:'Monitor'}],
  todo:[{id:'timeline',label:'Timeline'},{id:'deadlines',label:'Deadlines'},{id:'progress',label:'Goals'}],
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
  const mSav=(parseFloat(r.salary)||0)-(parseFloat(r.rent)||0)-(parseFloat(r.food)||0)-(parseFloat(r.transport)||0)-(parseFloat(r.other)||0)-(parseFloat(r.mai)||0);
  const mSavUSD=Math.round(mSav/(parseFloat(r.usd_rate)||88));

  function card(emoji,label,value,sub,color,priv){
    return '<div class="metric-card"'+(priv?' data-private="true"':'')+'>'+
      '<div class="metric-emoji">'+emoji+'</div>'+
      '<div class="metric-value" style="color:'+color+'">'+value+'</div>'+
      '<div class="metric-label">'+label+'</div>'+
      '<div class="metric-sub">'+sub+'</div>'+
    '</div>';
  }

  const d1=daysTo('2026-06-02');
  const d2=daysTo('2026-06-04');
  const dPass=daysTo('2028-01-21');
  const dMAI=daysTo('2026-07-15');

  el.innerHTML=[
    card('✈️','Interview 1',
      d1<0?'✓':d1+'d',
      d1<0?'Done · Аэрофлот':'June 2 · Аэрофлот Техникс',
      d1<0?'var(--green)':d1<=7?'var(--red)':'var(--amber)',false),
    card('✈️','Interview 2',
      d2<0?'✓':d2+'d',
      d2<0?'Done · АэроТраст':'June 4 · АэроТраст',
      d2<0?'var(--green)':d2<=7?'var(--red)':'var(--amber)',false),
    card('🛂','Passport Wall',
      dPass+'d',
      'Jan 21, 2028 · renew before age 28',
      dPass<=90?'var(--red)':dPass<=365?'var(--amber)':'var(--tx2)',false),
    card('🎓','MAI Deadline',
      dMAI<0?'✓':dMAI+'d',
      dMAI<0?'Done':'July 15 · enrollment application',
      dMAI<0?'var(--green)':dMAI<=14?'var(--red)':dMAI<=30?'var(--amber)':'var(--tx2)',false),
    card('📚','EASA B1.1',
      easaDone+'/15',
      easaDone===0?'Not started · begin Module 7':easaDone+' done · '+(15-easaDone)+' remaining',
      easaDone>=10?'var(--green)':easaDone>=5?'var(--amber)':'var(--tx3)',false),
    card('✈️','Logbook',
      lb.length===0?'0h':parseFloat(lbHours.toFixed(1))+'h',
      lb.length===0?'No entries · start day one':lb.length+' entries logged',
      lbHours>500?'var(--green)':lbHours>0?'var(--amber)':'var(--tx3)',false),
    card('💰','Monthly Savings',
      mSav>0?'₽'+Math.round(mSav/1000)+'k':'₽—',
      mSav>0?'≈ $'+mSavUSD+'/mo · adjust in Finance':'Set salary in Finance tab',
      mSav>=40000?'var(--green)':mSav>=20000?'var(--amber)':mSav>0?'var(--red)':'var(--tx3)',true),
  ].join('');
}

/* ═══════════════════════════════════════════
   HOME — MISSION CONTROL WIDGETS
   ═══════════════════════════════════════════ */
function renderHome(){
  // Phase widget
  const now=new Date();
  const june2026End=new Date('2026-09-01');
  const moscow2028=new Date('2028-06-01');
  let phase,phaseSub;
  if(now<june2026End){phase='Moscow Foundation';phaseSub='June 2026 — Secure job, start logbook, enroll MAI';}
  else if(now<moscow2028){phase='Moscow Build';phaseSub='Building logbook · EASA study · Passport renewal · Gulf prep';}
  else{phase='Gulf Launch';phaseSub='Etihad Engineering · EASA modules · UAE family settled';}
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
  ['go16','go17','go18','go19'].forEach(gid=>{
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
  // Metric cards + calendar + upcoming
  renderMetricCards();
  renderCalendar();
  renderUpcoming();
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
            '<div class="goal-pbar"><div class="goal-pfill" style="width:'+pct+'%"></div></div>'+
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
        '<div class="easa-bar-wrap"><div class="easa-bar-fill" style="width:'+pct+'%"></div></div>'+
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
        '<td><span style="font-family:var(--mono);font-size:9px;padding:2px 6px;border-radius:1px;background:'+(e.stamp_status==='stamped'?'var(--green2)':'var(--amber2)')+';color:'+(e.stamp_status==='stamped'?'var(--green)':'var(--amber)')+'">'+e.stamp_status+'</span></td>'+
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
    const expenses=(parseFloat(v.rent)||0)+(parseFloat(v.food)||0)+(parseFloat(v.transport)||0)+(parseFloat(v.other)||0)+(parseFloat(v.mai)||0);
    const net=gross-expenses;
    const usd=parseFloat(v.usd_rate)||88;
    return {gross,expenses,net,netUSD:(net/usd).toFixed(0),annualUSD:((net*12)/usd).toFixed(0)};
  }
  function calcGulf(v){
    const aed=parseFloat(v.salary_aed)||0;
    const exp=(parseFloat(v.housing)||0)+(parseFloat(v.transport)||0)+(parseFloat(v.food)||0)+(parseFloat(v.dep_cost)||0)+(parseFloat(v.remittance)||0)+(parseFloat(v.easa_monthly)||0);
    const net=aed-exp;
    const rate=parseFloat(v.usd_rate)||3.67;
    return {gross:aed,expenses:exp,net,netUSD:(net/rate).toFixed(0),annualUSD:((net*12)/rate).toFixed(0)};
  }
  function renderOutputs(){
    const v=getInputs();
    const r=calcRussia(v.russia||D.finance.russia);
    const g=calcGulf(v.gulf||D.finance.gulf);
    const rOut=document.getElementById('fin-russia-out');
    const gOut=document.getElementById('fin-gulf-out');
    function headline(value,sub,cls){
      return '<div class="fin-headline">'+
        '<div class="fin-headline-label">Monthly Net Savings</div>'+
        '<div class="fin-headline-value '+cls+'">'+value+'</div>'+
        '<div class="fin-headline-sub">'+sub+'</div>'+
      '</div>';
    }
    if(rOut) rOut.innerHTML=
      headline(
        (r.net>0?'+':'')+Math.round(r.net).toLocaleString()+' ₽',
        '≈ $'+r.netUSD+'/mo · $'+r.annualUSD+'/yr',
        r.net>0?'positive':'negative')+
      '<div class="fin-section-title">Breakdown</div>'+
      row('Monthly gross',r.gross.toLocaleString()+' ₽')+
      row('Monthly expenses',r.expenses.toLocaleString()+' ₽')+
      row('Monthly savings',r.net.toLocaleString()+' ₽',r.net>0?'positive':'negative')+
      row('Gulf move fund (120k ₽)',r.net>0?Math.ceil(120000/r.net)+' months':'-');
    if(gOut) gOut.innerHTML=
      headline(
        (g.net>0?'+':'')+Math.round(g.net).toLocaleString()+' AED',
        '≈ $'+g.netUSD+'/mo · $'+g.annualUSD+'/yr',
        g.net>0?'positive':'negative')+
      '<div class="fin-section-title">Breakdown</div>'+
      row('Monthly gross','AED '+g.gross.toLocaleString())+
      row('Monthly expenses','AED '+g.expenses.toLocaleString())+
      row('Monthly savings','AED '+g.net.toLocaleString(),g.net>0?'positive':'negative')+
      row('2-year savings','$'+(parseInt(g.annualUSD)*2).toLocaleString());
  }
  function row(label,val,cls){
    return '<div class="fin-result"><span class="fin-result-label">'+label+'</span><span class="fin-result-val'+(cls?' '+cls:'')+'">'+val+'</span></div>';
  }
  function syncInputs(){
    const v=getInputs();
    ['salary','rent','food','transport','other','mai','usd_rate'].forEach(k=>{
      const el=document.getElementById('fin-r-'+k);
      if(el&&v.russia&&v.russia[k]!==undefined) el.value=v.russia[k];
    });
    ['salary_aed','housing','transport','food','dep_cost','remittance','easa_monthly'].forEach(k=>{
      const el=document.getElementById('fin-g-'+k);
      if(el&&v.gulf&&v.gulf[k]!==undefined) el.value=v.gulf[k];
    });
  }
  window.finInputChange=function(phase,field,val){
    const v=getInputs();
    if(!v[phase]) v[phase]={};
    v[phase][field]=parseFloat(val)||0;
    saveInputs(v);
    renderOutputs();
  };
  window.setFinScenario=function(s,btn){
    document.querySelectorAll('.fin-scenario').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    const presets={
      conservative:{russia:{salary:85000,rent:28000,food:18000,transport:6000,other:7000,mai:15000},gulf:{salary_aed:10000,housing:6500,transport:1200,food:2500,dep_cost:0,remittance:500,easa_monthly:300}},
      realistic:{russia:{salary:100000,rent:26000,food:15000,transport:5000,other:5000,mai:15000},gulf:{salary_aed:12000,housing:6000,transport:1200,food:2000,dep_cost:0,remittance:500,easa_monthly:300}},
      upside:{russia:{salary:120000,rent:24000,food:12000,transport:4000,other:4000,mai:0},gulf:{salary_aed:16000,housing:6000,transport:1000,food:2000,dep_cost:0,remittance:500,easa_monthly:200}},
      gulf_wife:{russia:{salary:100000,rent:26000,food:15000,transport:5000,other:5000,mai:15000},gulf:{salary_aed:12000,housing:8000,transport:1500,food:3000,dep_cost:2000,remittance:500,easa_monthly:300}},
    };
    if(presets[s]){
      const v=getInputs();
      if(presets[s].russia) v.russia=Object.assign(v.russia||{},presets[s].russia);
      if(presets[s].gulf) v.gulf=Object.assign(v.gulf||{},presets[s].gulf);
      saveInputs(v);
      syncInputs();
      renderOutputs();
    }
  };
  document.addEventListener('DOMContentLoaded',()=>{ syncInputs(); renderOutputs(); });
})();

/* ═══════════════════════════════════════════
   JOB APPLICATION CRM
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_crm_v1';
  let crmFilter='all';
  let selectedJob=null;
  function getData(){
    const stored=LS.get(STORE,null);
    if(!stored) return D.companies.map(c=>({...c}));
    // merge stored status/notes with default data
    return D.companies.map(c=>{
      const s=stored.find(x=>x.id===c.id);
      return s?{...c,...s}:c;
    });
  }
  function saveData(arr){LS.set(STORE,arr);}
  function fitClass(fit){return fit>=8?'crm-fit-high':fit>=6?'crm-fit-med':'crm-fit-low';}
  function statusCols(){return ['target','applied','interview','offer','rejected'];}
  function renderCRM(filter){
    crmFilter=filter||crmFilter;
    const data=getData();
    const container=document.getElementById('crm-pipeline');
    if(!container) return;
    const filtered=crmFilter==='all'?data:data.filter(c=>c.region===crmFilter||c.status===crmFilter);
    container.innerHTML=statusCols().map(status=>{
      const cards=filtered.filter(c=>c.status===status);
      return '<div class="crm-col crm-col-'+status+'">'+
        '<div class="crm-col-title">'+status.charAt(0).toUpperCase()+status.slice(1)+' ('+cards.length+')</div>'+
        cards.map(c=>'<div class="crm-card" onclick="openCRMDetail(\''+c.id+'\')">'+
          '<div class="crm-card-company">'+c.company+'</div>'+
          '<div class="crm-card-role">'+c.city+', '+c.country+'</div>'+
          '<div class="crm-card-meta">'+
            '<span class="crm-fit '+fitClass(c.fit||0)+'">Fit: '+(c.fit||0)+'/10</span>'+
            '<span class="crm-region">'+c.region+'</span>'+
          '</div>'+
        '</div>').join('')+
      '</div>';
    }).join('');
  }
  window.filterCRM=function(f,btn){
    document.querySelectorAll('.crm-filter').forEach(b=>b.classList.remove('active'));
    if(btn) btn.classList.add('active');
    renderCRM(f);
    document.getElementById('crm-detail').classList.remove('open');
  };
  window.openCRMDetail=function(id){
    selectedJob=id;
    const data=getData();
    const c=data.find(x=>x.id===id);
    if(!c) return;
    const det=document.getElementById('crm-detail');
    if(!det) return;
    det.innerHTML=
      '<div class="crm-detail-title">'+c.company+' — '+c.role+'</div>'+
      '<div class="crm-detail-grid">'+
        field('Country',c.country+', '+c.city)+
        field('Aircraft',c.aircraft)+
        field('Salary',c.salary)+
        field('Fit Score',c.fit+'/10')+
        '<div class="crm-detail-field"><div class="crm-detail-label">Status</div>'+
          '<select class="crm-status-select" onchange="updateCRMStatus(\''+id+'\',this.value)">'+
            statusCols().map(s=>'<option value="'+s+'"'+(c.status===s?' selected':'')+'>'+s.charAt(0).toUpperCase()+s.slice(1)+'</option>').join('')+
          '</select>'+
        '</div>'+
        field('Applied',c.applied||'—')+
        field('Contact',c.contact||'—')+
        field('Next Follow-up',c.nextFollowup||'—')+
      '</div>'+
      '<div class="crm-detail-field" style="margin-top:12px"><div class="crm-detail-label">Notes</div>'+
        '<textarea style="width:100%;border:1px solid var(--bdr2);border-radius:2px;padding:8px;font-family:var(--sans);font-size:12.5px;color:var(--tx);background:var(--bg);resize:vertical;min-height:60px;outline:none" onchange="updateCRMNotes(\''+id+'\',this.value)">'+c.notes+'</textarea>'+
      '</div>';
    det.classList.add('open');
  };
  function field(label,val){
    return '<div class="crm-detail-field"><div class="crm-detail-label">'+label+'</div><div class="crm-detail-val">'+val+'</div></div>';
  }
  window.updateCRMStatus=function(id,status){
    const data=getData();
    const c=data.find(x=>x.id===id);
    if(c) c.status=status;
    saveData(data);
    renderCRM();
  };
  window.updateCRMNotes=function(id,notes){
    const data=getData();
    const c=data.find(x=>x.id===id);
    if(c) c.notes=notes;
    saveData(data);
  };
  document.addEventListener('DOMContentLoaded',()=>renderCRM());
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
   DECISION ENGINE
   ═══════════════════════════════════════════ */
(function(){
  const STORE='dune_decide_v1';
  function getData(){
    const stored=LS.get(STORE,null);
    if(!stored) return D.decision.criteria.map(c=>({...c}));
    return D.decision.criteria.map(c=>{
      const s=stored.find(x=>x.id===c.id);
      return s?{...c,...s}:c;
    });
  }
  function saveData(arr){LS.set(STORE,arr);}
  function calcScore(criteria){
    const maxWt=criteria.reduce((a,c)=>a+(c.weight||0),0)||1;
    const scoreA=criteria.reduce((a,c)=>a+(c.weight||0)*(c.a||0),0)/(maxWt*10)*100;
    const scoreB=criteria.reduce((a,c)=>a+(c.weight||0)*(c.b||0),0)/(maxWt*10)*100;
    return {a:Math.round(scoreA),b:Math.round(scoreB)};
  }
  function renderDecide(){
    const criteria=getData();
    const scores=calcScore(criteria);
    const aWins=scores.a>=scores.b;
    const headA=document.getElementById('decide-score-a');
    const headB=document.getElementById('decide-score-b');
    const boxA=document.getElementById('decide-box-a');
    const boxB=document.getElementById('decide-box-b');
    if(headA) headA.textContent=scores.a+'%';
    if(headB) headB.textContent=scores.b+'%';
    if(boxA){boxA.classList.toggle('winner',aWins);}
    if(boxB){boxB.classList.toggle('winner',!aWins);}
    const table=document.getElementById('decide-table');
    if(table) table.innerHTML=criteria.map(c=>{
      const aColor=c.a>=7?'var(--green)':c.a>=4?'var(--amber)':'var(--red)';
      const bColor=c.b>=7?'var(--green)':c.b>=4?'var(--amber)':'var(--red)';
      return '<div class="decide-criteria-row" title="'+c.note+'">'+
        '<div class="dc-label">'+c.label+'</div>'+
        '<div class="dc-weight"><input type="number" min="0" max="10" value="'+c.weight+'" onchange="updateDecideWeight(\''+c.id+'\',this.value)" /></div>'+
        '<div class="dc-score"><input type="number" min="0" max="10" value="'+c.a+'" style="border-color:'+aColor+'" onchange="updateDecideScore(\''+c.id+'\',\'a\',this.value)" /></div>'+
        '<div class="dc-score"><input type="number" min="0" max="10" value="'+c.b+'" style="border-color:'+bColor+'" onchange="updateDecideScore(\''+c.id+'\',\'b\',this.value)" /></div>'+
      '</div>';
    }).join('');
    const rec=document.getElementById('decide-recommend');
    if(rec){
      rec.classList.add('show');
      const winner=aWins?D.decision.optA:D.decision.optB;
      const margin=Math.abs(scores.a-scores.b);
      const strength=margin>=15?'strongly':margin>=8?'clearly':'slightly';
      rec.innerHTML='<div class="decide-rec-title">Recommendation</div>'+
        '<div class="decide-rec-body"><strong>→ '+winner+'</strong> is '+strength+' preferred ('+scores.a+'% vs '+scores.b+'%).<br>'+
        (aWins?'Whole-aircraft B1.1 breadth outweighs engine depth for Gulf and EASA positioning. Unless Аэрофлот confirms Superjet, this remains the correct choice.':
        'Engine depth and salary advantage make АэроТраст the better option at current weights. Verify CFM56 scope and company stability before committing.')+
        '</div>';
    }
  }
  window.updateDecideWeight=function(id,val){
    const data=getData();
    const c=data.find(x=>x.id===id);
    if(c) c.weight=parseInt(val)||0;
    saveData(data);
    renderDecide();
  };
  window.updateDecideScore=function(id,opt,val){
    const data=getData();
    const c=data.find(x=>x.id===id);
    if(c) c[opt]=parseInt(val)||0;
    saveData(data);
    renderDecide();
  };
  document.addEventListener('DOMContentLoaded',renderDecide);
})();

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
});
