// DUNE LIFE OS — Structured Data Layer
// All module data lives here. Edit this file to update content.
// Version: 2.0 — Built May 2026

const D = {};

// ═══════════════════════════════════════════
// DEADLINES
// ═══════════════════════════════════════════
D.deadlines = [
  { id:'dl01', title:'Interview 1 — Аэрофлот Техникс', date:'2026-06-02', cat:'career', importance:'critical', consequence:'Miss career-defining opportunity', note:'Building 6, Room 108, 15:30. Ask fleet first.', private:false },
  { id:'dl02', title:'Interview 2 — АэроТраст', date:'2026-06-04', cat:'career', importance:'critical', consequence:'Miss backup offer — no fallback', note:'Sky Point, Beta Building, 12:00. Confirm engine count.', private:false },
  { id:'dl03', title:'Job decision deadline', date:'2026-06-06', cat:'career', importance:'critical', consequence:'Both offers may expire or cool', note:'A320/Boeing + 95k+ = Timeline A. SSJ = АэроТраст. Compare logbook breadth.', private:false },
  { id:'dl04', title:'MAI application deadline (estimated)', date:'2026-07-15', cat:'education', importance:'high', consequence:'Miss September intake — delays passport timeline 6 months', note:'Call MAI: +7 499 158-43-36. Confirm exact date.', private:false },
  { id:'dl05', title:'Buy engagement ring', date:'2026-07-31', cat:'relationship', importance:'high', consequence:'Signal loss. Delays proposal intention.', note:'25,000–35,000 RUB. Sunlight, 585 Gold, Pandora, Arbat.', private:true },
  { id:'dl06', title:'MAI enrollment confirmed', date:'2026-09-01', cat:'education', importance:'critical', consequence:'No passport shield for military status question at embassy', note:'Get enrollment certificate immediately upon enrollment.', private:false },
  { id:'dl07', title:'ВНЖ renewal paperwork start', date:'2026-12-01', cat:'legal', importance:'high', consequence:'Legal status risk, no airport badge', note:'Start 3 months early. ВНЖ due March 2027.', private:false },
  { id:'dl08', title:'ВНЖ renewal deadline', date:'2027-03-01', cat:'legal', importance:'critical', consequence:'Illegal status, no airport badge, no clean Russia exit', note:'NOT citizenship — just residence permit renewal.', private:false },
  { id:'dl09', title:'Egyptian passport renewal target', date:'2027-06-01', cat:'passport', importance:'critical', consequence:'Risk crossing age-28 wall with military complications', note:'Routine renewal. No Gulf mention. MAI cert only if asked about army.', private:false },
  { id:'dl10', title:'IELTS exam', date:'2027-06-01', cat:'immigration', importance:'high', consequence:'Delays Australian 482 and 186 applications', note:'Q2 2027. ~$270 USD. CLB 7+ = IELTS 6.0. C1 English = easy pass.', private:false },
  { id:'dl11', title:'WES credential evaluation submit', date:'2027-09-01', cat:'immigration', importance:'high', consequence:'2-4 month processing delays immigration timeline', note:'~$250 USD. Samara University degree. Submit early.', private:false },
  { id:'dl12', title:'IAA pre-assessment contact', date:'2027-09-01', cat:'licensing', importance:'high', consequence:'EASA strategy built on unverified assumptions', note:'Irish Aviation Authority. Written pre-assessment of Russian experience.', private:false },
  { id:'dl13', title:'Gulf job applications start', date:'2027-09-01', cat:'career', importance:'critical', consequence:'Delays entire Gulf move and 10-year plan', note:'Etihad first → wait 6 weeks → Emirates → Air Arabia + Qatar.', private:false },
  { id:'dl14', title:'Apostille English logbook entries', date:'2027-09-01', cat:'legal', importance:'high', consequence:'EASA/CASA/immigration won\'t formally recognize Russian experience', note:'Via Минюст or МИД. Budget ~15,000–25,000 RUB.', private:false },
  { id:'dl15', title:'⚠ PASSPORT HARD WALL — Age 28', date:'2028-01-21', cat:'passport', importance:'critical', consequence:'Military clearance required for renewal — extremely complex process', note:'DO NOT cross this without a valid renewed passport. Everything depends on this.', private:false },
  { id:'dl16', title:'Marriage registration start', date:'2027-12-01', cat:'relationship', importance:'high', consequence:'3-4 month chain delays Gulf departure by same amount', note:'Start same week Gulf offer arrives. 30-60 days + apostille + translations + UAE visa.', private:true },
  { id:'dl17', title:'Gulf move — depart Russia', date:'2028-06-01', cat:'career', importance:'high', consequence:'Delays entire 10-year plan', note:'Both armies zero obligation. Passport valid. Elisa as spouse.', private:false },
];

// ═══════════════════════════════════════════
// LEGAL CLAIMS REGISTER
// ═══════════════════════════════════════════
D.claims = [
  { id:'cl01', title:'Egyptian passport renewable at 27 without military clearance', text:'At age 27, routine renewal as Egyptian citizen abroad. Military clearance only required after age 28.', cat:'passport', confidence:'likely', sourceType:'AI', sourceNote:'Multiple AI consensus. Not yet confirmed directly with Embassy.', lastChecked:'2026-05-27', recheckDate:'2026-07-01', consequence:'If wrong: complex military paperwork, may miss the pre-28 window entirely', nextAction:'Call Embassy +7 495 246-0442 — confirm in writing', private:false },
  { id:'cl02', title:'MAI enrollment satisfies embassy military status question', text:'Student enrollment at Russian university = valid deferral answer if embassy asks about army service during passport renewal.', cat:'passport', confidence:'uncertain', sourceType:'AI', sourceNote:'Reasonable assumption, not officially confirmed by embassy.', lastChecked:'2026-05-27', recheckDate:'2026-07-01', consequence:'If wrong: enrollment certificate useless — need different documentation entirely', nextAction:'Get written answer from Embassy BEFORE paying MAI tuition', private:false },
  { id:'cl03', title:'Russian citizenship triggers conscription under Law 53-FZ at age 27', text:'Federal Law 53-FZ: all male Russian citizens 18-30 subject to conscription. Presidential Decree №821 (2025) requires military service proof to finalize citizenship.', cat:'army', confidence:'verified', sourceType:'official', sourceNote:'Multiple official Russian legal sources + AI consensus. Widely documented.', lastChecked:'2026-05-27', recheckDate:'2027-01-01', consequence:'If underestimated: trapped in Russia, army obligation, blocked from Gulf move', nextAction:'Decision already made: skip citizenship, renew ВНЖ only', private:false },
  { id:'cl04', title:'IAA (Irish Aviation Authority) accepts non-EASA Russian experience for Part-66', text:'IAA may allow Part-66 B1.1 application based on non-EASA experience + Part-145 Gulf work. Varies by NAA discretion.', cat:'easa', confidence:'uncertain', sourceType:'AI', sourceNote:'Not confirmed. NAA policies vary significantly.', lastChecked:'2026-05-27', recheckDate:'2027-09-01', consequence:'If rejected: need supplemental EASA-org experience — adds 2-4 years to licensing timeline', nextAction:'Contact IAA Q3 2027 for written pre-assessment before committing', private:false },
  { id:'cl05', title:'Etihad Engineering holds both EASA.145.0073 and Part-147', text:'Etihad Engineering Abu Dhabi confirmed with EASA Part-145 AND Part-147 training org. Work = EASA experience, sit exams in-house.', cat:'easa', confidence:'verified', sourceType:'official', sourceNote:'EASA approved orgs list. Verify directly in 2027 that coverage includes your modules.', lastChecked:'2026-05-27', recheckDate:'2027-06-01', consequence:'If approval lapsed: Gulf experience may not directly contribute to EASA Part-66', nextAction:'Verify Etihad EASA status directly when applying 2027', private:false },
  { id:'cl06', title:'UAE Golden Visa threshold = basic salary only (not total package)', text:'From May 2024: AED 30,000 monthly basic salary required. Housing/transport/food allowances excluded from threshold.', cat:'uae', confidence:'likely', sourceType:'official', sourceNote:'UAE ICP policy update May 2024. Verify exact rules when eligible.', lastChecked:'2026-05-27', recheckDate:'2028-06-01', consequence:'If threshold changes: may not qualify when expected — delays stable UAE residency plan', nextAction:'Negotiate highest possible basic salary in Gulf contract. Verify ICP portal 2028.', private:false },
  { id:'cl07', title:'Australia ANZSCO 323112 on Core Skills Occupation List', text:'Aircraft Maintenance Engineer Mechanical confirmed on CSOL as of 2026 — enables employer-sponsored 482 and 186 visas.', cat:'australia', confidence:'likely', sourceType:'official', sourceNote:'CSOL reviewed annually. Must be checked every 6 months from 2028.', lastChecked:'2026-05-27', recheckDate:'2027-06-01', consequence:'If removed: no employer-sponsored pathway — need alternative visa category', nextAction:'Check immi.homeaffairs.gov.au CSOL every 6 months from 2028', private:false },
  { id:'cl08', title:'Canada job offer no longer adds CRS points (post-March 2025)', text:'IRCC removed arranged employment CRS boost from Express Entry March 2025. Strategy now relies on French + PNP, not job offer points.', cat:'canada', confidence:'likely', sourceType:'AI', sourceNote:'Multiple AI sources. Verify at canada.ca when building Express Entry profile.', lastChecked:'2026-05-27', recheckDate:'2029-01-01', consequence:'If wrong: Canada pathway calculations off — but overestimating difficulty not harmful', nextAction:'Verify current IRCC rules when building Express Entry profile 2029+', private:false },
  { id:'cl09', title:'French CLB 7 achievable in 12-18 months of structured study', text:'TEF Canada or TCF Canada CLB 7 requires real structured study, not Duolingo alone. 12-18 months consistent study during Gulf years.', cat:'canada', confidence:'likely', sourceType:'AI', sourceNote:'Based on language learning research, varies by individual effort and consistency.', lastChecked:'2026-05-27', recheckDate:'2028-06-01', consequence:'If underestimated: Canada pathway fails — one passport country instead of two', nextAction:'Begin structured French study Q1 2028. Alliance Française + tutor.', private:false },
];

// ═══════════════════════════════════════════
// RISKS
// ═══════════════════════════════════════════
D.risks = [
  { id:'rk01', title:'Egyptian passport expires before Gulf move', cat:'passport', prob:2, impact:5, mitigation:'Renew mid-2027 at age 27. MAI cert as shield. Hard deadline Jan 21 2028.', status:'active', nextReview:'2027-01-01', private:false },
  { id:'rk02', title:'Аэрофлот assigns Superjet-only position', cat:'career', prob:3, impact:4, mitigation:'Ask fleet question directly June 2. SSJ = decline immediately, contact АэроТраст same day.', status:'active', nextReview:'2026-06-03', private:false },
  { id:'rk03', title:'АэроТраст collapses (new company, 8 months old)', cat:'career', prob:2, impact:3, mitigation:'Primary reason Timeline A preferred. If on Timeline B, monitor quarterly.', status:'active', nextReview:'2026-09-01', private:false },
  { id:'rk04', title:'English logbook weak, Russian-language, missing supervisor stamps', cat:'licensing', prob:3, impact:5, mitigation:'English from day one. Every ATA chapter. Every stamp. Monthly self-audit.', status:'active', nextReview:'2026-09-01', private:false },
  { id:'rk05', title:'Elisa not aligned with Gulf move or city choice', cat:'relationship', prob:3, impact:4, mitigation:'Have real conversation now. Show plan. Her input on Abu Dhabi vs Dubai matters.', status:'active', nextReview:'2026-07-01', private:true },
  { id:'rk06', title:'Gulf entry salary too low to sponsor spouse visa immediately', cat:'money', prob:3, impact:3, mitigation:'UAE threshold ~AED 16,500 basic. Arrive alone, save 6-12 months, then bring Elisa. Or negotiate higher basic.', status:'planned', nextReview:'2027-12-01', private:true },
  { id:'rk07', title:'EASA NAA rejects non-EASA Russian maintenance experience', cat:'licensing', prob:3, impact:5, mitigation:'Contact IAA Q3 2027 for written pre-assessment before committing to this licensing path.', status:'planned', nextReview:'2027-09-01', private:false },
  { id:'rk08', title:'Australia ANZSCO 323112 removed from Core Skills list', cat:'immigration', prob:2, impact:4, mitigation:'Check CSOL every 6 months from 2028. Build Canada as parallel pathway.', status:'planned', nextReview:'2028-01-01', private:false },
  { id:'rk09', title:'Russia sanctions block financial transfers / Bybit restricted', cat:'money', prob:3, impact:3, mitigation:'30% physical USD/bank. Don\'t rely solely on Bybit. Diversify storage across platforms.', status:'active', nextReview:'2026-09-01', private:false },
  { id:'rk10', title:'Gulf MRO applications all ignored — no response', cat:'career', prob:2, impact:4, mitigation:'Apply all 4 simultaneously by Dec 2027. Direct HR email not just portal. Use referrals.', status:'planned', nextReview:'2027-12-01', private:false },
  { id:'rk11', title:'CFM56 obsolescence devalues Timeline B engine experience', cat:'career', prob:4, impact:3, mitigation:'If Timeline B: add LEAP-1A/1B training. Borescope. Engine health monitoring during Gulf years.', status:'planned', nextReview:'2028-01-01', private:false },
  { id:'rk12', title:'Aeroflot sanctions trigger CV screening issues at Gulf/Western MROs', cat:'career', prob:3, impact:2, mitigation:'CV focuses on aircraft types, ATA chapters, English logbook — not employer brand name.', status:'active', nextReview:'2027-06-01', private:false },
];
D.risks.forEach(r => { r.score = r.prob * r.impact; });

// ═══════════════════════════════════════════
// JOB APPLICATION CRM
// ═══════════════════════════════════════════
D.companies = [
  { id:'jb01', company:'Etihad Engineering', country:'UAE', city:'Abu Dhabi', role:'Aircraft Maintenance Engineer', aircraft:'A320/A330/A350/A380/B777', salary:'AED 18,000–28,000', region:'gulf', status:'target', notes:'EASA.145.0073 + Part-147. Priority #1. Muslim-friendly city.', fit:9, applied:'', contact:'', nextFollowup:'' },
  { id:'jb02', company:'Emirates Engineering', country:'UAE', city:'Dubai', role:'AME / Line Maintenance', aircraft:'B777/A380', salary:'AED 20,000–32,000', region:'gulf', status:'target', notes:'Apply after Etihad (6 weeks no response). Strong EASA brand.', fit:8, applied:'', contact:'', nextFollowup:'' },
  { id:'jb03', company:'Sanad (Mubadala)', country:'UAE', city:'Abu Dhabi', role:'Engine Technician / AME', aircraft:'CFM56/LEAP/GE90', salary:'AED 16,000–24,000', region:'gulf', status:'target', notes:'Engine MRO. Strong if АэроТраст CFM56 experience path taken.', fit:7, applied:'', contact:'', nextFollowup:'' },
  { id:'jb04', company:'Air Arabia Technic', country:'UAE', city:'Sharjah', role:'Aircraft Maintenance Engineer', aircraft:'A320neo family', salary:'AED 14,000–20,000', region:'gulf', status:'target', notes:'Lower salary. Easier entry. Sharjah more conservative than Dubai.', fit:6, applied:'', contact:'', nextFollowup:'' },
  { id:'jb05', company:'flydubai Engineering', country:'UAE', city:'Dubai', role:'AME / Line Maintenance', aircraft:'B737 MAX', salary:'AED 16,000–22,000', region:'gulf', status:'target', notes:'Boeing 737 MAX. Good with Аэрофлот Boeing experience.', fit:7, applied:'', contact:'', nextFollowup:'' },
  { id:'jb06', company:'Qatar Airways Technical', country:'Qatar', city:'Doha', role:'Maintenance Technician', aircraft:'B777/A320/A350', salary:'QAR 12,000–18,000', region:'gulf', status:'target', notes:'Apply simultaneously with Emirates in fallback wave. Housing package strong.', fit:7, applied:'', contact:'', nextFollowup:'' },
  { id:'jb07', company:'Saudia Technic', country:'KSA', city:'Jeddah', role:'Aircraft Maintenance Engineer', aircraft:'B777/A320', salary:'SAR 15,000–22,000', region:'gulf', status:'target', notes:'Backup option. Housing included. Less EASA-friendly path.', fit:5, applied:'', contact:'', nextFollowup:'' },
  { id:'jb08', company:'Turkish Technic', country:'Turkey', city:'Istanbul', role:'AME / Base Maintenance', aircraft:'Mixed fleet', salary:'USD 2,000–3,500', region:'gulf', status:'target', notes:'Backup if Gulf delayed. EASA.145 experience. Not Gulf salary level.', fit:4, applied:'', contact:'', nextFollowup:'' },
  { id:'jb09', company:'Qantas Engineering', country:'Australia', city:'Sydney/Melbourne', role:'Licensed AME (LAME)', aircraft:'B737/A380/B787', salary:'AUD 90k–130k/yr', region:'australia', status:'target', notes:'CASA license required. Top target. Strict criteria — smaller MRO may sponsor faster.', fit:8, applied:'', contact:'', nextFollowup:'' },
  { id:'jb10', company:'Virgin Australia Technical Ops', country:'Australia', city:'Brisbane', role:'Aircraft Maintenance Engineer', aircraft:'B737', salary:'AUD 80k–110k/yr', region:'australia', status:'target', notes:'Boeing-focused. Brisbane HQ. Apply from Gulf 2031+.', fit:7, applied:'', contact:'', nextFollowup:'' },
  { id:'jb11', company:'Air Canada Technical Ops', country:'Canada', city:'Various', role:'Aircraft Maintenance Engineer', aircraft:'B777/B787/A220', salary:'CAD 85k–120k/yr', region:'canada', status:'target', notes:'Transport Canada AME license needed. Apply 2032+.', fit:7, applied:'', contact:'', nextFollowup:'' },
  { id:'jb12', company:'StandardAero', country:'Canada', city:'Winnipeg', role:'Engine Technician / AME', aircraft:'CFM56/LEAP/PT6', salary:'CAD 70k–100k/yr', region:'canada', status:'target', notes:'Engine MRO focus. Strong if engine background. Manitoba PNP connection.', fit:6, applied:'', contact:'', nextFollowup:'' },
];

// ═══════════════════════════════════════════
// GOALS / PROGRESS TRACKER
// ═══════════════════════════════════════════
D.goals = [
  // Career
  { id:'go01', title:'Moscow job secured', cat:'career', status:'active', progress:80, deadline:'2026-06-06', risk:'medium', note:'Interviews June 2 & 4', nextAction:'Decision by June 6' },
  { id:'go02', title:'Western aircraft exposure (A320/B737/B777)', cat:'career', status:'active', progress:0, deadline:'2027-06-01', risk:'medium', note:'Depends on job choice and fleet assignment', nextAction:'Confirm aircraft type at interview' },
  { id:'go03', title:'English logbook — started day one', cat:'career', status:'planned', progress:0, deadline:'2026-07-01', risk:'high', note:'Every task: date, aircraft, ATA, description, hours, supervisor stamp', nextAction:'First day of work — no exceptions' },
  { id:'go04', title:'Russian ФАВТ Category A license', cat:'career', status:'planned', progress:0, deadline:'2027-12-01', risk:'low', note:'1 year minimum experience required', nextAction:'Accumulate hours, apply at CAA after year one' },
  { id:'go05', title:'Gulf job applications submitted', cat:'career', status:'planned', progress:0, deadline:'2027-09-01', risk:'medium', note:'Etihad first, then fallback sequence. All four active by Dec 2027.', nextAction:'Build LinkedIn, optimize CV by Q2 2027' },
  { id:'go06', title:'Gulf job offer received', cat:'career', status:'planned', progress:0, deadline:'2028-01-01', risk:'high', note:'Target December 2027. Etihad Engineering as priority.', nextAction:'Applications start Q3 2027' },
  { id:'go07', title:'EASA Part-66 B1.1 license', cat:'career', status:'planned', progress:5, deadline:'2031-12-01', risk:'high', note:'15 modules. Via IAA or Gulf EASA.145. Budget €3,000–5,000.', nextAction:'Contact IAA Q3 2027 for written pre-assessment' },
  { id:'go08', title:'GCAA CAR-66 (UAE license)', cat:'career', status:'planned', progress:0, deadline:'2032-06-01', risk:'medium', note:'Aviation Legislation exam only — after EASA Part-66 received.', nextAction:'Plan when in Gulf with EASA B1.1 in hand' },
  // Documents
  { id:'go09', title:'Egyptian passport renewed', cat:'documents', status:'active', progress:15, deadline:'2027-06-01', risk:'high', note:'Target mid-2027 at age 27. Must be before Jan 21, 2028.', nextAction:'Confirm docs with Embassy, then enroll MAI September' },
  { id:'go10', title:'ВНЖ renewed', cat:'documents', status:'planned', progress:0, deadline:'2027-03-01', risk:'high', note:'NOT citizenship. Start paperwork December 2026.', nextAction:'Calendar reminder December 2026' },
  { id:'go11', "title":'MAI Master\'s enrolled', cat:'documents', status:'active', progress:25, deadline:'2026-07-15', risk:'medium', note:'September 2026 intake. Part-time aviation Master\'s.', nextAction:'Call MAI: +7 499 158-43-36' },
  { id:'go12', title:'Egyptian military settlement paid', cat:'documents', status:'blocked', progress:0, deadline:null, risk:'high', note:'Program CLOSED. Monitor mfa.gov.eg monthly.', nextAction:'Register on mfa.gov.eg. Pay immediately when program opens.' },
  { id:'go13', title:'IELTS exam passed (CLB 7+)', cat:'documents', status:'planned', progress:0, deadline:'2027-06-01', risk:'low', note:'Q2 2027. ~$270 USD. IELTS 6.0+ = CLB 7. C1 English = easy.', nextAction:'Book exam Q2 2027 when ready' },
  { id:'go14', title:'WES credential evaluation complete', cat:'documents', status:'planned', progress:0, deadline:'2027-09-01', risk:'medium', note:'Samara University degree. ~$250 USD. 2-4 months processing.', nextAction:'Submit Q3 2027' },
  { id:'go15', title:'Marriage documents (Russia → UAE)', cat:'documents', status:'planned', progress:0, deadline:'2028-03-01', risk:'medium', note:'30-60 days + apostille + translations. Start with Gulf offer.', nextAction:'Start same week as Gulf offer arrives', private:true },
  // Finance
  { id:'go16', title:'Ring fund: 25,000–35,000 RUB', cat:'finance', status:'active', progress:0, deadline:'2026-07-31', risk:'medium', note:'Sunlight, 585 Gold, Pandora, Arbat. Gesture > price.', nextAction:'Allocate 40% savings for ring', private:true },
  { id:'go17', title:'Gulf move fund: 120,000+ RUB', cat:'finance', status:'planned', progress:0, deadline:'2027-12-01', risk:'medium', note:'First month expenses, deposit, docs, flights for two.', nextAction:'Start saving after June salary' },
  { id:'go18', title:'Egypt settlement fund: ~$7,000+ USD', cat:'finance', status:'active', progress:0, deadline:null, risk:'high', note:'Pay same day program opens. Highest priority after emergency fund.', nextAction:'$500–700 USD/month toward this goal' },
  { id:'go19', title:'Emergency fund: 3-6 months expenses', cat:'finance', status:'planned', progress:0, deadline:'2026-12-01', risk:'medium', note:'Moscow ~$3–4k, Gulf ~$8–10k. Never touch except genuine emergency.', nextAction:'Allocate 20% of savings monthly' },
  { id:'go20', title:'EASA exam fund: ~€3,000–5,000', cat:'finance', status:'planned', progress:0, deadline:'2029-01-01', risk:'low', note:'15 modules × ~€200–300 per attempt. Budget for retakes.', nextAction:'Start fund after emergency fund complete' },
];

// ═══════════════════════════════════════════
// EASA MODULE TRACKER
// ═══════════════════════════════════════════
D.easa = [
  { id:'ea01', num:'M1',  title:'Mathematics',                           status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea02', num:'M2',  title:'Physics',                               status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea03', num:'M3',  title:'Electrical Fundamentals',               status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea04', num:'M4',  title:'Electronic Fundamentals',               status:'not_started', progress:0,  priority:'low',    note:'' },
  { id:'ea05', num:'M5',  title:'Digital Techniques & Computer Systems', status:'not_started', progress:0,  priority:'low',    note:'' },
  { id:'ea06', num:'M6',  title:'Materials & Hardware',                  status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea07', num:'M7',  title:'Maintenance Practices',                 status:'not_started', progress:0,  priority:'high',   note:'Strong area — practical experience applies directly' },
  { id:'ea08', num:'M8',  title:'Basic Aerodynamics',                    status:'not_started', progress:0,  priority:'medium', note:'' },
  { id:'ea09', num:'M9',  title:'Human Factors',                         status:'not_started', progress:0,  priority:'high',   note:'Short module, high pass rate. Start early.' },
  { id:'ea10', num:'M10', title:'Aviation Legislation',                  status:'not_started', progress:0,  priority:'high',   note:'Critical for license application. Do not skip.' },
  { id:'ea11', num:'M11A',title:'Turbine Aeroplane Aero & Structures',   status:'not_started', progress:0,  priority:'high',   note:'A320/B737 directly relevant' },
  { id:'ea12', num:'M13', title:'Aircraft Aerodynamics, Structures & Systems', status:'not_started', progress:0, priority:'medium', note:'' },
  { id:'ea13', num:'M14', title:'Propulsion',                            status:'not_started', progress:0,  priority:'high',   note:'' },
  { id:'ea14', num:'M15', title:'Gas Turbine Engine',                    status:'studying',    progress:20, priority:'high',   note:'START HERE — strongest area with CFM56/LEAP background' },
  { id:'ea15', num:'M17A',title:'Propeller',                             status:'not_started', progress:0,  priority:'low',    note:'Least critical for turbine path' },
];

// ═══════════════════════════════════════════
// DECISION ENGINE — CRITERIA
// ═══════════════════════════════════════════
D.decision = {
  title: 'Аэрофлот Техникс vs АэроТраст',
  optA: 'Аэрофлот Техникс',
  optB: 'АэроТраст',
  criteria: [
    { id:'dc01', label:'Western aircraft exposure (A320/B737/B777)', weight:10, a:8, b:4, note:'Full aircraft at Аэрофлот vs engines-only at АэроТраст' },
    { id:'dc02', label:'B1.1 logbook breadth (all systems)', weight:10, a:9, b:4, note:'Whole aircraft vs engine-only ATA 71-80' },
    { id:'dc03', label:'Engine task depth (ATA 71-80)', weight:7, a:5, b:10, note:'АэроТраст wins on pure engine depth' },
    { id:'dc04', label:'Salary (official, white)', weight:6, a:6, b:8, note:'АэроТраст confirmed 90k+, Аэрофлот 85k negotiable to 100k' },
    { id:'dc05', label:'Company stability', weight:8, a:9, b:3, note:'Аэрофлот established vs АэроТраст 8 months old' },
    { id:'dc06', label:'English logbook policy', weight:8, a:6, b:7, note:'Both likely Russian-primary — parallel English log needed' },
    { id:'dc07', label:'Gulf employer CV relevance', weight:9, a:9, b:6, note:'A320/Boeing vastly more recognized than CFM56-only shop' },
    { id:'dc08', label:'EASA Part-66 B1.1 fit', weight:9, a:9, b:5, note:'Full aircraft scope maps directly to B1.1 requirements' },
    { id:'dc09', label:'Risk of Superjet assignment', weight:8, a:3, b:10, note:'Аэрофлот SSJ risk real — walk if confirmed. АэроТраст zero SSJ.' },
    { id:'dc10', label:'Commute / life quality (Moscow)', weight:4, a:7, b:7, note:'Both require SVO area — similar commute' },
    { id:'dc11', label:'10-year salary ceiling', weight:9, a:9, b:6, note:'B1.1 breadth → faster Gulf LAE → AED 28-40k vs AED 16-25k ceiling' },
  ]
};

// ═══════════════════════════════════════════
// FINANCE DEFAULTS
// ═══════════════════════════════════════════
D.finance = {
  russia: {
    salary: 100000, rent: 26000, food: 15000, transport: 5000,
    utilities: 3500, phone: 1500, family_transfer: 0,
    other: 5000, mai: 0, ring_save: 0, usd_rate: 88
  },
  gulf: {
    salary_aed: 12000, housing: 6000, transport: 1200, food: 2000,
    dep_cost: 0, remittance: 500, easa_monthly: 300, usd_rate: 3.67
  }
};

// ═══════════════════════════════════════════
// INTERVIEW Q&A MASTER
// ═══════════════════════════════════════════
D.interview_parts = [
  { id:'p0', title:'Расскажите о себе', title_en:'Tell Me About Yourself', tag:'OPENER', order:0 },
  { id:'p1', title:'HR / Личные вопросы', title_en:'HR & Personal', tag:'HR', order:1 },
  { id:'p3', title:'Переход: турбовинт → турбовентилятор', title_en:'The Transition', tag:'TRANSITION', order:2 },
  { id:'p2', title:'Мой самолёт: Ан-28 / ТВД-10Б', title_en:'Current Aircraft', tag:'AN-28', order:3 },
  { id:'p5', title:'Двигатель CFM56 — глубоко', title_en:'CFM56 Deep Dive', tag:'CFM56', order:4 },
  { id:'p4', title:'Системы A320 / Boeing 737', title_en:'Aircraft Systems', tag:'SYSTEMS', order:5 },
  { id:'p7', title:'Документация, безопасность, регулирование', title_en:'Docs / Safety / Regs', tag:'REGS', order:6 },
  { id:'p6', title:'LEAP-1A и будущие двигатели', title_en:'Future Engines', tag:'LEAP', order:7 },
];

D.interview_qa = [

/* ─── PART 0 — OPENER ─────────────────────────────────────────────── */
{
  id:'iq_p0_01', part:'p0', company:'both', difficulty:'high', tag:'OPENER',
  q_ru:'Расскажите о себе.',
  q_en:'Tell me about yourself.',
  answer_ru:`Меня зовут Махмуд, мне 26 лет. Я египетский авиационный инженер, получил образование в России, имею вид на жительство. Сейчас работаю в Рязани на воздушных судах Ан-28 с турбовинтовыми двигателями ТВД-10Б. В мои задачи входит предполётный осмотр, техническое обслуживание по регламенту, работа с топливной и гидравлической системами, ведение технической документации. За это время я научился точно следовать процедурам, работать с АММ, и понимать, что выпуск самолёта в полёт — это личная ответственность каждого техника. Сейчас я целенаправленно перехожу на турбовентиляторные двигатели и самолёты западного производства — A320 и CFM56 — потому что это международный стандарт, и именно на этой платформе я хочу строить дальнейшую карьеру в авиационном MRO. Моя цель — получить лицензию EASA Part-66 B1.1 и работать в крупном международном MRO. Ваша компания — правильный следующий шаг на этом пути.`,
  answer_en:`Name: Mahmoud, 26, Egyptian AME, educated in Russia, ВНЖ holder. Currently: An-28 / TVD-10B turboprop, Ryazan. Tasks: pre-flight, scheduled maintenance, hydraulics, fuel, documentation. Transitioning to: A320 / CFM56 / Western fleet. Goal: EASA B1.1 → international MRO.`,
},

/* ─── PART 1 — HR / PERSONAL ──────────────────────────────────────── */
{
  id:'iq_p1_01', part:'p1', company:'both', difficulty:'med', tag:'HR',
  q_ru:'Почему вы уходите с текущего места работы?',
  q_en:'Why are you leaving your current job?',
  answer_ru:`Я благодарен за опыт, который получил в Рязани — он дал мне реальную техническую базу, дисциплину и понимание ответственности в авиации. Но Ан-28 — это региональный турбовинтовой самолёт, и я вижу потолок профессионального роста на этой платформе. Моя цель — EASA Part-66 B1.1 и работа на воздушных судах западного производства. Это требует опыта на A320, CFM56, Boeing. Ваша компания — именно та среда, где этот рост возможен.`,
  answer_en:`Platform ceiling on turboprop. Goal: EASA B1.1 → Western fleet MRO. Your company is the next step.`,
},
{
  id:'iq_p1_02', part:'p1', company:'both', difficulty:'med', tag:'HR',
  q_ru:'Какие ваши сильные стороны?',
  q_en:'What are your strengths?',
  answer_ru:`Первое — дисциплина и точность: в авиационном техническом обслуживании нет места приблизительности, и я это понимаю с первого дня работы. Второе — умение работать с технической документацией на русском и английском языках. Третье — техническое мышление: я понимаю, как работает двигатель изнутри, от компрессора до турбины, что помогает находить причину неисправности, а не только устранять симптом. И четвёртое — долгосрочная мотивация: у меня есть чёткий план на 10 лет, и эта работа — часть этого плана.`,
  answer_en:`Discipline/precision, bilingual documentation (RU+EN), systems-level thinking, long-term motivated.`,
},
{
  id:'iq_p1_03', part:'p1', company:'both', difficulty:'med', tag:'HR',
  q_ru:'Какие ваши слабые стороны?',
  q_en:'What are your weaknesses?',
  answer_ru:`Честно — у меня пока нет практического опыта на A320 и CFM56. Я это осознаю и именно поэтому здесь. Я изучил схему CFM56-5B, основные системы A320, AMM-структуру. Я готов к интенсивному обучению и понимаю, что первые месяцы буду учеником, а не специалистом. Также иногда я слишком детально вникаю в технические детали там, где нужна скорость — работаю над балансом.`,
  answer_en:`No hands-on CFM56/A320 experience yet — honest, studying actively. Sometimes over-detailed — working on speed.`,
},
{
  id:'iq_p1_04', part:'p1', company:'both', difficulty:'high', tag:'HR',
  q_ru:'Где вы видите себя через 5 лет?',
  q_en:'Where do you see yourself in 5 years?',
  answer_ru:`Через 5 лет — 2031 год. К этому времени я планирую получить лицензию EASA Part-66 B1.1 и работать в крупном международном MRO на Ближнем Востоке — в идеале в Etihad Engineering или аналогичной компании. Это требует двух лет здесь, чтобы построить качественный логбук на западном флоте, затем сдачи всех 15 модульных экзаменов EASA. Каждый год в вашей компании — это прямой вклад в этот план. Я не ищу место на 6 месяцев.`,
  answer_en:`2031: EASA Part-66 B1.1 → Gulf MRO (Etihad Engineering target). 2 years here = logbook quality. Long-term hire.`,
},
{
  id:'iq_p1_05', part:'p1', company:'aeroflot', difficulty:'med', tag:'HR',
  q_ru:'Почему именно Аэрофлот Техникс?',
  q_en:'Why Aeroflot Technics specifically?',
  answer_ru:`Аэрофлот Техникс — это обслуживание A320, Boeing 737 и Boeing 777 под крылом крупнейшей авиакомпании России. Это значит широкий логбук: гидравлика, топливо, пневматика, двигатели на нескольких типах ВС. Именно широта опыта, а не узкая специализация, нужна для EASA B1.1. Также вы расширяете компетенции по CFM56-5B прямо сейчас — я хочу быть частью этого роста с первого дня.`,
  answer_en:`A320+B737+B777 breadth = full B1.1 logbook. Expanding CFM56-5B capability now — want to be part of that.`,
},
{
  id:'iq_p1_06', part:'p1', company:'aerotrust', difficulty:'med', tag:'HR',
  q_ru:'Почему именно АэроТраст?',
  q_en:'Why AeroTrust specifically?',
  answer_ru:`АэроТраст — это глубокая специализация на CFM56-5B: от разборки до сборки, от дефектации до испытания. Это именно тот двигатель, на котором летает весь мировой парк A320ceo, и именно на нём строится международная карьера в MRO. Компания молодая, но это значит возможность расти вместе с ней с нуля, строить процессы. Для меня это ценнее, чем быть одним из сотни техников в большой структуре.`,
  answer_en:`CFM56-5B deep overhaul = engine expertise. Young company = grow together. A320ceo fleet = international relevance.`,
},
{
  id:'iq_p1_07', part:'p1', company:'both', difficulty:'low', tag:'HR',
  q_ru:'Каковы ваши ожидания по зарплате?',
  q_en:'What are your salary expectations?',
  answer_ru:`Я ориентируюсь на диапазон 90 000–100 000 рублей официально по трудовому договору. У меня есть параллельное предложение, и именно такой уровень я рассматриваю. При этом я понимаю, что на начальном этапе зарплата — не единственный критерий: для меня важнее качество опыта, который я получу за эти два года, и официальность трудоустройства для ВНЖ.`,
  answer_en:`90–100k RUB official white contract. Have competing offer. Quality of experience and official employment matter more than salary max.`,
},
{
  id:'iq_p1_08', part:'p1', company:'both', difficulty:'low', tag:'HR',
  q_ru:'Когда вы готовы приступить к работе?',
  q_en:'When can you start?',
  answer_ru:`Готов приступить в течение 1–2 недель после получения оффера — мне нужно завершить формальности с текущим местом работы и переезд в Москву. Регистрацию по новому адресу готов сделать сразу — это важно для моего ВНЖ, и я понимаю, что для аэропортового пропуска она тоже нужна.`,
  answer_en:`Ready in 1–2 weeks after offer. Need relocation to Moscow. Registration at new address = priority for ВНЖ and airport badge.`,
},
{
  id:'iq_p1_09', part:'p1', company:'both', difficulty:'med', tag:'HR',
  q_ru:'У вас есть разрешение на работу? Нужен ли патент?',
  q_en:'Do you have a work permit? Do you need a patent?',
  answer_ru:`У меня вид на жительство (ВНЖ) — это не патент и не разрешение на работу в стандартном смысле. ВНЖ даёт право работать по трудовому договору на территории России на тех же основаниях, что и гражданин РФ, без каких-либо дополнительных разрешений, без квот. Работодателю не нужно получать разрешение на привлечение иностранного работника. Единственное требование — уведомление МВД о заключении трудового договора, что является стандартной процедурой.`,
  answer_en:`ВНЖ = full work rights, same as Russian citizen. No patent needed. No employer quota. Standard МВД notification only.`,
},
{
  id:'iq_p1_10', part:'p1', company:'both', difficulty:'low', tag:'HR',
  q_ru:'ВНЖ — до какого срока действует? Нужно ли продление в ближайшее время?',
  q_en:'When does your ВНЖ expire? Do you need renewal soon?',
  answer_ru:`Мой ВНЖ действителен, ближайшее продление — март 2027 года. Это стандартная процедура, которую я выполняю самостоятельно. Для продления требуется непрерывная официальная трудовая деятельность — именно поэтому для меня критически важно официальное трудоустройство по белой зарплате и трудовому договору без разрыва.`,
  answer_en:`ВНЖ renewal: March 2027. Self-managed. Requires continuous official employment — that's why white contract with no gap is critical.`,
},
{
  id:'iq_p1_11', part:'p1', company:'both', difficulty:'low', tag:'HR',
  q_ru:'Потребуется ли компании что-то дополнительно оформлять для вашего трудоустройства?',
  q_en:'Will the company need to do any additional paperwork for your employment?',
  answer_ru:`Минимум. При ВНЖ работодатель подаёт стандартное уведомление в МВД о заключении и расторжении трудового договора — это занимает несколько дней и является рутинной процедурой для любого HR-отдела. Никаких специальных разрешений, квот, согласований с миграционными органами не требуется. Я также обеспечу миграционную регистрацию по новому московскому адресу в течение 7 рабочих дней с момента переезда.`,
  answer_en:`Minimal: standard МВД notification on contract. No special permits. I handle migration registration within 7 working days of move.`,
},
{
  id:'iq_p1_12', part:'p1', company:'both', difficulty:'med', tag:'HR',
  q_ru:'Готовы ли вы работать в ночные смены, по графику 2/2 или в ротацию?',
  q_en:'Are you ready for night shifts, 2/2 schedule, or rotation?',
  answer_ru:`Да, полностью готов. Авиационное техническое обслуживание — это круглосуточный процесс, и я это понимаю. У меня уже есть опыт работы вне стандартного офисного графика. График 2/2 или ночные смены — это часть профессии, а не неожиданность. Главное — стабильный официальный договор, остальное я готов выстраивать под нужды компании.`,
  answer_en:`Ready for any schedule. 24/7 aviation maintenance is normal. 2/2, nights — part of the job, not a surprise.`,
},
{
  id:'iq_p1_13', part:'p1', company:'both', difficulty:'med', tag:'HR',
  q_ru:'Есть ли ограничения по медицинской комиссии ВЛЭК? Как со здоровьем?',
  q_en:'Any limitations for the medical examination? Health status?',
  answer_ru:`Нет никаких ограничений. Готов пройти ВЛЭК в любое время. Со здоровьем всё в порядке, зрение и физическая форма соответствуют требованиям для работы в ангаре и на перроне. Я понимаю, что допуск к воздушным судам требует медицинского подтверждения, и готов его пройти до выхода на работу.`,
  answer_en:`No limitations. Ready for ВЛЭК anytime. Vision and physical condition meet ramp/hangar requirements.`,
},

/* ─── PART 3 — TRANSITION ─────────────────────────────────────────── */
{
  id:'iq_p3_01', part:'p3', company:'both', difficulty:'high', tag:'TRANSITION',
  q_ru:'Вы работали только на турбовинтовых двигателях — почему мы должны вас взять на турбовентиляторный?',
  q_en:'You only worked on turboprops — why should we hire you for a turbofan?',
  answer_ru:`Термодинамический цикл Брайтона — один для обоих типов двигателей: сжатие, горение, расширение. На ТВД-10Б я работал с компрессором (6 ступеней осевых + 1 центробежная), кольцевой камерой сгорания, двухступенчатой турбиной компрессора и свободной силовой турбиной. Я понимаю, что такое EGT, N1 и N2, расход масла, чип-детектор, параметры запуска. Переход с 960-сильного турбовинта на CFM56-5B — это переход на другой масштаб и другую степень двухконтурности, но не на другую физику. Кроме того, я целенаправленно изучал CFM56-5B: архитектуру двигателя, принцип работы FADEC, основные секции — вентилятор, компрессор низкого давления, компрессор высокого давления, камеру сгорания, турбины. Я готов к обучению, и фундамент у меня есть.`,
  answer_en:`Same Brayton cycle. TVD-10B gave real compressor/turbine/combustor/EGT hands-on. Scale is different, physics identical. Also studied CFM56-5B architecture, FADEC, sections specifically. Foundation exists.`,
},
{
  id:'iq_p3_02', part:'p3', company:'both', difficulty:'med', tag:'TRANSITION',
  q_ru:'В чём принципиальная разница между турбовинтовым и турбовентиляторным двигателем?',
  q_en:'What is the fundamental difference between a turboprop and a turbofan?',
  answer_ru:`В турбовинтовом двигателе — ТВД-10Б — основная тяга создаётся воздушным винтом. Турбина расширяется максимально, чтобы отдать всю мощность на редуктор и вал винта. Реактивная составляющая минимальна. В турбовентиляторном — CFM56 — тяга делится: часть от большого вентилятора, который прогоняет воздух через внешний контур (bypass), и часть от реактивного сопла. У CFM56-5B степень двухконтурности около 6:1 — значит, 6 частей воздуха обходят ядро двигателя на каждую 1 часть, проходящую через него. Это даёт лучшую экономичность и меньший шум на высоких скоростях полёта. Турбовинт эффективен на скоростях до 600 км/ч, турбовентилятор — выше 700 км/ч.`,
  answer_en:`Turboprop: propeller = main thrust. Max turbine extraction → gearbox → prop. Turbofan: bypass fan + core jet. BPR 6:1 on CFM56-5B. Better efficiency at 700+ km/h cruise vs turboprop optimal <600 km/h.`,
},
{
  id:'iq_p3_03', part:'p3', company:'both', difficulty:'med', tag:'TRANSITION',
  q_ru:'Что такое степень двухконтурности (bypass ratio) и почему она важна?',
  q_en:'What is bypass ratio and why does it matter?',
  answer_ru:`Степень двухконтурности — это отношение массового расхода воздуха через внешний контур (мимо ядра) к расходу через ядро. У CFM56-5B — около 5.9:1, у LEAP-1A — около 11:1. Чем выше BPR, тем больше воздуха разгоняется вентилятором, тем ниже скорость реактивной струи относительно скорости самолёта, тем выше пропульсивный КПД. На практике это означает меньший расход топлива и меньший шум. Именно поэтому LEAP потребляет на 15–16% меньше топлива, чем CFM56.`,
  answer_en:`BPR = bypass airflow / core airflow. CFM56-5B ~5.9:1, LEAP-1A ~11:1. Higher BPR = lower jet velocity relative to aircraft = higher propulsive efficiency = lower fuel burn, less noise.`,
},
{
  id:'iq_p3_04', part:'p3', company:'both', difficulty:'med', tag:'TRANSITION',
  q_ru:'Что из опыта на Ан-28 напрямую применимо к обслуживанию A320?',
  q_en:'What from your An-28 experience transfers directly to A320 maintenance?',
  answer_ru:`Несколько вещей. Первое — работа с техническими документами: AMM-структура, карточки задач, документирование. Второе — гидравлические системы: на Ан-28 гидравлика питает тормоза, рулевое управление носовой стойкой, закрылки. Принцип работы с давлением, уровнем жидкости, поиском утечек — я делал это реально. Третье — топливная система: баки, питание двигателей, расход. Четвёртое — электросистема 28V DC: я работал с ней практически. И самое главное — профессиональная культура: понимание того, что каждый выпуск — это ответственность, и нет мелочей в документировании.`,
  answer_en:`Documentation (AMM structure), hydraulics (pressure/level/leak checks), fuel system, 28V DC electrical — all hands-on. Core professional culture: every release = personal responsibility.`,
},
{
  id:'iq_p3_05', part:'p3', company:'both', difficulty:'high', tag:'TRANSITION',
  q_ru:'Изучали ли вы CFM56 или документацию A320 самостоятельно?',
  q_en:'Have you studied the CFM56 or A320 AMM on your own?',
  answer_ru:`Да, целенаправленно. Я изучил архитектуру CFM56-5B: секции двигателя от вентилятора до реактивного сопла, систему FADEC (двойной канал A и B), масляную систему, систему запуска. Изучил основные системы A320: трёхконтурную гидравлику (Green, Blue, Yellow), систему кондиционирования воздуха (пневматика), топливную систему с центральным баком и перекрёстным питанием. Работал с открытыми AMM-документами онлайн для понимания структуры. Это не заменяет практики — я это понимаю — но когда мне дадут задачу, я буду знать, где искать и что ожидать.`,
  answer_en:`Self-studied: CFM56-5B sections, FADEC A/B channels, oil system, start system. A320: Green/Blue/Yellow hydraulics, bleed air, fuel crossfeed. AMM structure from open sources. Theory ≠ practice — know the difference.`,
},
{
  id:'iq_p3_06', part:'p3', company:'both', difficulty:'med', tag:'TRANSITION',
  q_ru:'Что бы вы делали в первые три месяца на этой позиции?',
  q_en:'What would you do in your first three months here?',
  answer_ru:`Первое — слушать и наблюдать. Изучить, как работает смена здесь: процедуры, культура, цепочка подчинения. Второе — изучить конкретные процедуры АММ для задач, которые мне назначают, прежде чем начинать работу — никакой работы по памяти. Третье — задавать правильные вопросы старшим техникам: не "что делать", а "почему так". Четвёртое — фиксировать каждую задачу в логбуке в день выполнения: тип ВС, ATA-глава, описание, часы. Пятое — в свободное время — продолжить самоподготовку по модулям EASA. Я понимаю, что первые три месяца — это инвестиция в следующие два года.`,
  answer_en:`1) Observe shift culture/procedures. 2) AMM before every task — no memory work. 3) Ask why, not just what. 4) Log every task same day: AC type, ATA, description, hours. 5) Self-study EASA modules on off time.`,
},
{
  id:'iq_p3_07', part:'p3', company:'both', difficulty:'med', tag:'TRANSITION',
  q_ru:'Какой у вас уровень английского? Работали ли с английской документацией?',
  q_en:'What is your English level? Have you worked with English documentation?',
  answer_ru:`Уровень — уверенный B2, технический. Я читаю AMM, SRM и IPC на английском без словаря для стандартных технических процедур. Использовал открытые AMM-документы CFM56 и A320 для самоподготовки — именно на английском. Говорю по-английски достаточно, чтобы пройти собеседование в Gulf MRO — это часть моего плана. Свой логбук я веду на английском с первого дня работы, потому что это требование EASA и Gulf MRO. ICAO Language Proficiency Level 4+ — мой текущий уровень.`,
  answer_en:`B2 technical English. Read AMM/SRM/IPC without dictionary. Self-studied CFM56+A320 docs in English. Logbook in English from day 1. ICAO Level 4+. Gulf MRO interviews conducted in English — that's the plan.`,
},

/* ─── PART 2 — АН-28 / ТВД-10Б ───────────────────────────────────── */
{
  id:'iq_p2_crit', part:'p2', company:'aerotrust', difficulty:'high', tag:'CRITICAL',
  q_ru:'⚠ Сколько двигателей вы лично ремонтировали? Какова была ваша роль?',
  q_en:'How many engines have you personally repaired? What was your role?',
  answer_ru:`Честно: я работал на турбовинтовых двигателях ТВД-10Б в составе Ан-28. Мой опыт — это эксплуатационное техническое обслуживание: предполётные и послеполётные проверки, замена фильтров, контроль уровня масла, проверка параметров запуска, устранение текущих неисправностей. Это не цеховой overhaul в понимании АэроТраст — я это понимаю и не пытаюсь это приукрасить. Что я умею: работать с двигателем руками, читать его параметры, работать с документацией. CFM56-5B — это другой масштаб, и я здесь именно для того, чтобы получить настоящий overhaul-опыт под руководством ваших специалистов. Я прихожу учиться и работать, а не заявлять опыт, которого у меня нет.`,
  answer_en:`⚠ HONEST ANSWER: Line maintenance on TVD-10B (An-28) — pre/post flight checks, filter replacement, oil level, start parameters, fault finding. NOT shop overhaul. I know the difference. Here to learn CFM56-5B overhaul under your specialists. Won't pretend experience I don't have.`,
},
{
  id:'iq_p2_01', part:'p2', company:'both', difficulty:'high', tag:'AN-28',
  q_ru:'Опишите архитектуру двигателя ТВД-10Б.',
  q_en:'Describe the TVD-10B engine architecture.',
  answer_ru:`ТВД-10Б — двухвальный турбовинтовой двигатель разработки ОМКБ имени П.И. Баранова, мощностью 960 л.с. (1025 л.с. чрезвычайный режим). Компрессор: шесть осевых ступеней и одна центробежная — всего 7 ступеней. Камера сгорания: кольцевого типа с одной центробежной форсункой и двумя свечами зажигания. Турбина: двухступенчатая турбина компрессора (несёт нагрузку от компрессора) и одноступенчатая свободная силовая турбина (передаёт мощность через редуктор на воздушный винт). Масса сухого двигателя — около 230 кг. Устанавливается на Ан-28, рассматривается для модернизированного Ан-2.`,
  answer_en:`Twin-shaft turboprop. 960 hp (1025 hp emergency). Compressor: 6 axial + 1 centrifugal stages. Combustor: annular, 1 centrifugal nozzle, 2 spark plugs. Turbine: 2-stage gas generator turbine + 1-stage free power turbine → gearbox → propeller. Dry weight ~230 kg.`,
},
{
  id:'iq_p2_02', part:'p2', company:'both', difficulty:'med', tag:'AN-28',
  q_ru:'Что такое свободная турбина и как она отличается от турбины компрессора?',
  q_en:'What is a free power turbine and how does it differ from the compressor turbine?',
  answer_ru:`Турбина компрессора механически связана с валом компрессора и работает как единый газогенератор: сжатие + горение + расширение для поддержания работы компрессора. Свободная силовая турбина — отдельный вал, не связанный механически с газогенератором. Она принимает кинетическую энергию газов, выходящих из турбины компрессора, и передаёт мощность через редуктор на воздушный винт. "Свободная" — потому что скорость её вращения может отличаться от скорости газогенератора в зависимости от нагрузки на винт. Это ключевое отличие от турбовентиляторного двигателя, где вентилятор и компрессор низкого давления связаны механически на одном валу.`,
  answer_en:`Compressor turbine: mechanically coupled to compressor shaft — forms gas generator. Free power turbine: separate shaft, mechanically independent. Absorbs exhaust energy → gearbox → propeller. "Free" = its RPM can vary with prop load. Unlike turbofan where fan and LPC share one shaft.`,
},
{
  id:'iq_p2_03', part:'p2', company:'both', difficulty:'med', tag:'AN-28',
  q_ru:'Как работает регулятор частоты вращения воздушного винта на ТВД-10Б?',
  q_en:'How does the propeller governor work on the TVD-10B?',
  answer_ru:`Регулятор поддерживает постоянную частоту вращения воздушного винта, изменяя шаг (угол установки) лопастей. При увеличении скорости полёта или снижении нагрузки центробежные грузики в регуляторе расходятся, открывают клапан, масло подаётся в цилиндр изменения шага — угол лопастей увеличивается (укрупнение шага), нагрузка на двигатель растёт, обороты возвращаются к заданному значению. При уменьшении нагрузки — процесс обратный. Флюгирование винта — перевод лопастей на максимальный шаг (к потоку) при отказе двигателя для минимизации лобового сопротивления.`,
  answer_en:`Constant-speed governor: maintains fixed prop RPM by varying blade pitch. Overspeed → centrifugal weights open valve → oil increases pitch → more load → RPM drops back. Underspeed → reverse. Feathering = max pitch (edge-on to flow) on engine failure → minimum drag.`,
},
{
  id:'iq_p2_04', part:'p2', company:'both', difficulty:'low', tag:'AN-28',
  q_ru:'Основные характеристики Ан-28: взлётная масса, крейсерская скорость, дальность.',
  q_en:'Main An-28 specs: MTOW, cruise speed, range.',
  answer_ru:`Ан-28 — лёгкий многоцелевой транспортный самолёт с укороченным взлётом и посадкой (КВП). Максимальная взлётная масса — около 6 500 кг. Крейсерская скорость — 300–350 км/ч. Практический потолок — 7 500 м. Расход топлива — около 220 кг/час на двигатель при крейсерском режиме. Размах крыла — 22,06 м, длина — 13,1 м. Вместимость — до 17 пассажиров или 1 750 кг груза. Два двигателя ТВД-10Б по 960 л.с. каждый. Широко применяется в России для региональных и труднодоступных маршрутов.`,
  answer_en:`MTOW ~6,500 kg. Cruise 300–350 km/h. Ceiling 7,500 m. Fuel ~220 kg/hr/engine at cruise. Span 22.06 m, length 13.1 m. 17 pax or 1,750 kg cargo. 2×TVD-10B, 960 hp each.`,
},
{
  id:'iq_p2_05', part:'p2', company:'both', difficulty:'med', tag:'AN-28',
  q_ru:'Опишите гидравлическую систему Ан-28.',
  q_en:'Describe the An-28 hydraulic system.',
  answer_ru:`На Ан-28 гидравлическая система относительно простая по сравнению с A320: один основной насос с приводом от двигателя. Система питает: закрылки (механизм выпуска/уборки), рулевое управление передней стойкой шасси и основные тормоза колёс. При отказе электропитания шасси выпускается механически — под действием силы тяжести (gravity extension) — это важная особенность КВП-самолётов. Рабочая жидкость — авиационное гидравлическое масло АМГ-10. Давление в системе значительно ниже, чем у A320 (3 000 PSI) — этот самолёт работает в диапазоне нескольких сотен бар.`,
  answer_en:`Simple single-pump system (engine-driven). Powers: flaps, nosewheel steering, main brakes. Gear gravity extension on power failure. Fluid: АМГ-10. Lower pressure than A320's 3,000 PSI. STOL aircraft simplicity.`,
},
{
  id:'iq_p2_06', part:'p2', company:'both', difficulty:'low', tag:'AN-28',
  q_ru:'Расскажите о топливной системе Ан-28 и расходе топлива.',
  q_en:'Tell me about the An-28 fuel system and consumption.',
  answer_ru:`Ан-28 оснащён топливными баками в крыльях. Топливо — авиационный керосин ТС-1 или Jet A-1. Расход — около 220 кг на двигатель в час при крейсерском режиме. Система простая: прямая подача от топливных насосов к двигателям. Заправка через горловины в крыле. Важный момент при обслуживании — контроль за суммарным остатком топлива и балансировкой между баками. Я проводил предполётный контроль уровня топлива, визуальную проверку на наличие воды (отстой), контроль герметичности соединений.`,
  answer_en:`Wing tanks. Fuel: ТС-1 / Jet A-1. Consumption ~220 kg/hr/engine at cruise. Straight supply to engines. Pre-flight: quantity check, water drain (sump check), connection leak visual.`,
},
{
  id:'iq_p2_07', part:'p2', company:'both', difficulty:'low', tag:'AN-28',
  q_ru:'Электрическая система Ан-28 — опишите кратко.',
  q_en:'Describe the An-28 electrical system briefly.',
  answer_ru:`Система постоянного тока 28В. Два генератора с приводом от двигателей мощностью 28 кВА каждый. Аккумуляторная батарея 24В в качестве резервного источника и для запуска. Сеть питает авионику, навигационное и связное оборудование, освещение, системы управления и экологическое оборудование. Простая и надёжная архитектура — типичная для советских самолётов регионального класса.`,
  answer_en:`28V DC network. 2×28 kVA engine-driven generators. 24V battery for backup and start. Powers avionics, nav/comm, lighting, environmental. Classic Soviet DC architecture for regional aircraft.`,
},
{
  id:'iq_p2_08', part:'p2', company:'both', difficulty:'med', tag:'AN-28',
  q_ru:'Какие типичные неисправности вы встречали на ТВД-10Б в эксплуатации?',
  q_en:'What common faults did you encounter on the TVD-10B in service?',
  answer_ru:`Из того, с чем сталкивался на практике: отклонения в работе регулятора частоты вращения воздушного винта (нестабильные обороты при определённых режимах — потребовало регулировки), утечки масла через уплотнения редуктора, нестабильный запуск при низких температурах (проблема с подачей топлива при прогреве), отклонения показаний EGT на приборах (выход из строя термопары), износ деталей в узлах крепления двигателя при вибрационных нагрузках. Все работы — по AMM, с документированием и контрольным осмотром.`,
  answer_en:`Real faults encountered: propeller governor RPM instability (required adjustment), gearbox seal oil leaks, cold-temperature start issues (fuel/ignition), EGT sensor failures (thermocouple), engine mount wear under vibration. All rectified per AMM with documentation.`,
},

/* ─── PART 5 — CFM56 DEEP DIVE ───────────────────────────────────── */
{
  id:'iq_p5_01', part:'p5', company:'both', difficulty:'high', tag:'CFM56',
  q_ru:'Каковы основные массогабаритные характеристики CFM56-5B?',
  q_en:'What are the main weight and size parameters of the CFM56-5B?',
  answer_ru:`CFM56-5B — турбовентиляторный двигатель совместного производства CFM International (SNECMA + GE). Сухая масса — около 2 380 кг (5 250 фунтов). Для сравнения: ТВД-10Б весит ~230 кг — CFM56-5B тяжелее в 10 раз. Диаметр вентилятора — около 1 735 мм (68,3 дюйма). Тяга: зависит от варианта — от 22 000 до 27 000 фунтов-сил (100–120 кН). Степень двухконтурности — 5.7–6:1. Устанавливается на A320, A321, A319. CFM56-7B — аналог для Boeing 737 NG, несколько иной конструкции в части входного устройства.`,
  answer_en:`Dry weight ~2,380 kg (5,250 lbs) — 10× heavier than TVD-10B. Fan diameter ~1,735 mm. Thrust 22,000–27,000 lbf by variant. BPR 5.7–6:1. Powers A320/A321/A319 (ceo family).`,
},
{
  id:'iq_p5_02', part:'p5', company:'both', difficulty:'high', tag:'CFM56',
  q_ru:'Опишите архитектуру CFM56-5B — все основные секции.',
  q_en:'Describe the CFM56-5B architecture — all major sections.',
  answer_ru:`CFM56-5B — двухвальный двухконтурный турбовентиляторный двигатель. Секции по потоку воздуха: 1) Вентилятор (Fan) — одна ступень, 36 лопаток из титанового сплава, диаметр 1 735 мм. Создаёт основную тягу через внешний контур. 2) Компрессор низкого давления (LPC / Booster) — 4 ступени осевые. 3) Компрессор высокого давления (HPC) — 9 ступеней осевые. 4) Камера сгорания (Combustor) — кольцевого типа. 5) Турбина высокого давления (HPT) — 1 ступень, охлаждаемые лопатки. 6) Турбина низкого давления (LPT) — 4 ступени, связана с валом вентилятора и LPC. Внешний контур: воздух, прошедший через вентилятор, минует ядро и выходит через смешивающее сопло. Два вала: низкого давления (N1) и высокого давления (N2).`,
  answer_en:`Twin-spool turbofan. In flow order: Fan (1 stage, 36 Ti blades, 1,735mm) → LPC/Booster (4 axial stages) → HPC (9 axial stages) → Annular combustor → HPT (1 stage, cooled blades) → LPT (4 stages). Two shafts: N1 (fan+LPC+LPT), N2 (HPC+HPT). Bypass: fan air bypasses core through mixed exhaust nozzle.`,
},
{
  id:'iq_p5_03', part:'p5', company:'both', difficulty:'high', tag:'CFM56',
  q_ru:'Что такое N1 и N2 на CFM56? Каковы типичные значения на взлёте и крейсере?',
  q_en:'What are N1 and N2 on the CFM56? Typical values at takeoff and cruise?',
  answer_ru:`N1 — частота вращения вала низкого давления: вентилятор + компрессор низкого давления + турбина низкого давления. Выражается в процентах от максимальных оборотов. На взлёте — около 90–100% (зависит от температуры и высоты). На крейсере — 80–88%. Это основной параметр тяги, который пилот контролирует на взлёте. N2 — частота вращения вала высокого давления: HPC + HPT. На взлёте — 95–100%. На крейсере — 86–92%. На земле у технического персонала: минимальные обороты на холостом ходу — N1 около 22–24%, N2 около 60–62%. N2 важен для оценки работы газогенератора и параметров FADEC.`,
  answer_en:`N1 = fan+LPC+LPT shaft RPM (% of max). Takeoff ~90–100%, cruise ~80–88%. Primary thrust indicator. N2 = HPC+HPT shaft RPM. Takeoff ~95–100%, cruise ~86–92%. Ground idle: N1 ~22–24%, N2 ~60–62%. N2 = gas generator health indicator.`,
},
{
  id:'iq_p5_04', part:'p5', company:'both', difficulty:'high', tag:'CFM56',
  q_ru:'Что такое EGT на CFM56? Где измеряется и что означает его превышение?',
  q_en:'What is EGT on the CFM56? Where is it measured and what does an exceedance mean?',
  answer_ru:`EGT (Exhaust Gas Temperature) — температура газов за турбиной низкого давления. На CFM56-5B измеряется на станции T49.5 — за LPT. Отображается в кабине экипажа и записывается FADEC. Высокий EGT при нормальных N1/N2 означает деградацию двигателя: износ лопаток HPT, отложения в камере сгорания, потерю эффективности компрессора. Превышение предела EGT на взлёте требует записи в MEL или технический журнал и проверки по AMM — обычно это бороскопия и анализ параметрического тренда. Я знаю этот параметр с ТВД-10Б — EGT за силовой турбиной был ключевым параметром контроля и там тоже.`,
  answer_en:`EGT = exhaust gas temp after LPT, measured at station T49.5. High EGT at normal N1/N2 = engine deterioration (HPT blade wear, combustor deposits, compressor efficiency loss). Takeoff exceedance → AMM check → usually borescope + trend monitoring. Same concept on TVD-10B — EGT was key there too.`,
},
{
  id:'iq_p5_05', part:'p5', company:'both', difficulty:'high', tag:'CFM56',
  q_ru:'Что такое FADEC на CFM56-5B? Что происходит при отказе одного канала?',
  q_en:'What is FADEC on the CFM56-5B? What happens if one channel fails?',
  answer_ru:`FADEC — Full Authority Digital Engine Control — полностью цифровая система управления двигателем. На CFM56-5B FADEC имеет два независимых канала: A и B. Каждый канал контролирует: подачу топлива (топливный дозатор), изменяемую геометрию компрессора (VSV — variable stator vanes, VBV — variable bleed valves), запуск и зажигание, защиту от помпажа, мониторинг параметров (N1, N2, EGT, давление масла). При отказе одного канала FADEC автоматически переключается на второй канал без прерывания работы двигателя. При отказе обоих каналов двигатель сохраняет тягу фиксированного уровня (freeze mode). Отказ FADEC отображается на ECAM. Важно: FADEC — не вспомогательная система, а единственная система управления; механического резерва нет.`,
  answer_en:`Full Authority Digital Engine Control. Dual channel (A+B): controls fuel metering, VSV/VBV geometry, start/ignition, surge protection, parameter monitoring. Single channel failure → auto switchover to other channel, seamless. Dual failure → freeze mode (fixed thrust). FADEC is the ONLY control — no mechanical backup. ECAM alerts on failure.`,
},
{
  id:'iq_p5_06', part:'p5', company:'both', difficulty:'med', tag:'CFM56',
  q_ru:'Масляная система CFM56-5B: тип масла, норма расхода, что контролировать.',
  q_en:'CFM56-5B oil system: oil type, consumption limits, what to monitor.',
  answer_ru:`Тип масла: синтетическое авиационное масло 5-го класса вязкости — наиболее распространённые марки Mobil Jet Oil II или Castrol 5000. Допустимый расход масла: не более 0,5 квт/час (0.5 qt/hr). Превышение нормы расхода — повод для дефектного акта и проверки по AMM. При техническом обслуживании контролировать: уровень масла (через sight glass или dipstick), состояние масла (цвет, наличие металлических частиц), состояние чип-детектора. Чип-детектор — магнитный пробник в маслосистеме: фиксирует металлические частицы от износа подшипников. Нахождение стружки на чип-детекторе = немедленная проверка подшипниковых узлов.`,
  answer_en:`Oil type: MIL-PRF-23699, Grade 5 — Mobil Jet Oil II or Castrol 5000. Max consumption: 0.5 qt/hr. Monitor: oil level (sight glass/dipstick), color, chip detector (magnetic plug captures bearing wear particles). Chips on detector = immediate bearing inspection. High consumption = AMM check.`,
},
{
  id:'iq_p5_07', part:'p5', company:'aerotrust', difficulty:'high', tag:'CFM56',
  q_ru:'Бороскопия на CFM56: когда требуется, что ищем, каковы пределы?',
  q_en:'Borescope inspection on CFM56: when required, what to look for, limits.',
  answer_ru:`Бороскопия (Borescope Inspection) требуется в следующих случаях: жёсткая посадка (hard landing) — по AMM-параметрам перегрузки, попадание посторонних предметов (FOD — Foreign Object Damage), превышение EGT при взлёте, необычный шум или вибрация, попадание птиц (bird strike), при плановом ТО в определённых интервалах по циклам и часам. Что ищем: повреждения лопаток вентилятора (забоины, засечки, деформации), эрозию лопаток LPC/HPC, трещины и горелые участки лопаток HPT, отложения в камере сгорания, повреждения уплотнений и статорных лопаток LPT. Пределы повреждений (limits): задаются в AMM, главе 72 (Powerplant). Повреждение в рамках допуска — запись в журнал, мониторинг. Повреждение за пределом — двигатель на shop visit.`,
  answer_en:`Required after: hard landing (per AMM G-load), FOD, EGT exceedance, bird strike, unusual noise/vibration, periodic per cycle/hour limits. Look for: fan blade nicks/dents, LPC/HPC erosion, HPT blade cracks/burns, combustor deposits, LPT seal damage. Limits in AMM Chapter 72. In-limit → log + monitor. Beyond limit → shop visit.`,
},
{
  id:'iq_p5_08', part:'p5', company:'both', difficulty:'med', tag:'CFM56',
  q_ru:'Чем CFM56-7B отличается от CFM56-5B?',
  q_en:'How does the CFM56-7B differ from the CFM56-5B?',
  answer_ru:`Оба двигателя — семейство CFM56, схожая базовая архитектура. Ключевые отличия: Конструкция входного устройства: CFM56-5B имеет классический прямой воздухозаборник на A320. CFM56-7B на Boeing 737 NG имеет уплощённую (splayed) конструкцию — двигатель расположен ближе к земле из-за низкого клиренса шасси 737, поэтому воздухозаборник слегка смещён и асимметричен. Тяга: 7B — 18 500–27 300 фунтов-сил, 5B — 22 000–27 000 фунтов-сил. Применение: 5B — семейство A320 (ceo), 7B — Boeing 737 NG. Сертификационная база: 5B — EASA/FAA на Airbus, 7B — FAA/EASA на Boeing. В остальном — схожая система FADEC, масляная система, бороскопический доступ.`,
  answer_en:`Same CFM56 family. Key diff: intake design — 7B has flattened/splayed inlet (737 NG low-clearance gear → offset engine). 5B = straight inlet on A320. Thrust ranges similar (18,500–27,300 lbf vs 22,000–27,000 lbf). Application: 5B→A320ceo, 7B→737 NG. FADEC, oil system, borescope access — essentially identical.`,
},
{
  id:'iq_p5_09', part:'p5', company:'both', difficulty:'med', tag:'CFM56',
  q_ru:'On-wing maintenance vs shop visit — что и когда?',
  q_en:'On-wing maintenance vs shop visit — what and when?',
  answer_ru:`On-wing (на крыле) — техническое обслуживание двигателя без снятия с воздушного судна: замена компонентов (fuel nozzles, actuators, sensors, oil filters), бороскопия, устранение утечек, работы по бюллетеням (SB). Выполняется в рамках линейного и базового ТО. Shop visit (цеховой ремонт) — двигатель снимается с самолёта и отправляется на ремонтный завод. Типы: Performance Restoration — восстановление параметров (EGT margin, компрессорная часть), Repair — устранение повреждений, отдельные замены секций. Инициируется при: исчерпании ресурса по циклам (LLP — Life Limited Parts), выходе за пределы допусков при бороскопии, деградации параметров EGT/N2 ниже установленного EGT margin, серьёзных механических повреждениях.`,
  answer_en:`On-wing: maintenance without removal — nozzle/sensor/actuator swap, borescope, SB work. Part of line/base maintenance. Shop visit: engine removed → MRO facility. Types: Performance Restoration (EGT margin, compressor work), Repair (damage), LLP replacement. Triggered by: LLP cycle limits, borescope limits exceeded, EGT margin depletion, mechanical damage.`,
},

/* ─── PART 4 — AIRCRAFT SYSTEMS ──────────────────────────────────── */
{
  id:'iq_p4_01', part:'p4', company:'aeroflot', difficulty:'high', tag:'SYSTEMS',
  q_ru:'Опишите гидравлическую систему A320 — три контура.',
  q_en:'Describe the A320 hydraulic system — three circuits.',
  answer_ru:`A320 имеет три независимых гидравлических контура, каждый работает при давлении 3 000 PSI (207 бар), рабочая жидкость — Skydrol (тип IV или 500B). Контур Green (зелёный): источник — насос с приводом от двигателя 1 (Engine Driven Pump, EDP). Питает: основные тормоза, шасси выпуск/уборка, закрылки/предкрылки (совместно с Yellow), руль направления, интерцепторы. Контур Blue (синий): источник — электрический насос (Electric Motor Pump, EMP). Питает: стабилизатор, часть элеронов, элементы ELAC/SFCC. В аварийном режиме — от RAT (Ram Air Turbine). Контур Yellow (жёлтый): источник — насос с приводом от двигателя 2 + электрический насос + ручной насос. Питает: закрылки/предкрылки (совместно с Green), аварийные тормоза, грузовые двери. PTU (Power Transfer Unit) — гидравлическая связь между Green и Yellow без перемешивания жидкостей: при разнице давлений ≥500 PSI автоматически компенсирует давление.`,
  answer_en:`3 independent circuits at 3,000 PSI / 207 bar. Fluid: Skydrol IV or 500B. GREEN: EDP (eng 1) → main brakes, gear, slats/flaps (shared), rudder, spoilers. BLUE: EMP (electric) → stabilizer, ailerons, ELAC. Emergency: RAT. YELLOW: EDP (eng 2) + EMP + hand pump → slats/flaps (shared), emergency brakes, cargo doors. PTU: hydraulic link Green↔Yellow (no fluid transfer) — auto-activates at >500 PSI differential.`,
},
{
  id:'iq_p4_02', part:'p4', company:'aeroflot', difficulty:'high', tag:'SYSTEMS',
  q_ru:'Тормозная система A320 — тип тормозов, антиюзовая система, режимы автоторможения.',
  q_en:'A320 braking system — brake type, anti-skid, autobrake modes.',
  answer_ru:`A320 оснащён многодисковыми тормозами с углеродными (карбоновыми) дисками. Углеродные диски легче стальных, выдерживают более высокие температуры, но требуют прогрева для нормальной работы в холодную погоду. Антиюзовая система (Anti-Skid) работает автоматически: датчики угловой скорости на колёсах определяют начало блокировки и сбрасывают давление тормозов по отдельным каналам. Режимы автоторможения (Autobrake): LO — умеренное замедление для длинных ВПП, MED — среднее замедление, MAX — максимальное замедление на посадке, RTO (Rejected Takeoff) — максимальное торможение при прерванном взлёте (применяется автоматически при сбросе тяги на скоростях выше 72 уз). Нормальное торможение — от Green контура. Аварийное — от Yellow контура через аккумуляторы (12 независимых торможений гарантированы).`,
  answer_en:`Carbon multi-disc brakes. Lighter than steel, higher temp tolerance, need warm-up in cold. Anti-skid: wheel speed sensors → modulate pressure per wheel to prevent lock. Autobrake modes: LO (gentle, long runway), MED (medium), MAX (short/contaminated), RTO (rejected takeoff, auto-activates >72 kts if thrust reduced). Normal braking: Green circuit. Emergency: Yellow circuit via accumulators (12 applications guaranteed).`,
},
{
  id:'iq_p4_03', part:'p4', company:'aeroflot', difficulty:'med', tag:'SYSTEMS',
  q_ru:'Топливная система A320 — баки, перекачка, кросс-питание.',
  q_en:'A320 fuel system — tanks, transfer, crossfeed.',
  answer_ru:`A320 имеет три основных топливных отсека: два крыльевых бака (левый и правый, по ~8 250 кг каждый на A320) и центральный бак (~6 300 кг). Принцип работы: сначала используется топливо центрального бака (inner-to-outer sequence для сохранения центровки), затем — крыльевых. Центральный бак перекачивается автоматически центробежными насосами при условии, что крыльевые баки не полные. Кросс-питание (Crossfeed): клапан позволяет питать оба двигателя от одного бака (одного борта) — используется при отказе двигателя или насоса. Дополнительный центральный бак (ACT — Additional Center Tank) устанавливается на дальнемагистральных вариантах. Топливо — Jet A-1. Измерение — ультразвуковые датчики уровня, выдающие показания в кг на ECAM.`,
  answer_en:`3 tanks: L/R wing (~8,250 kg each) + center (~6,300 kg). Sequence: center first → wing tanks (maintains CG). Center transfer: auto via centrifugal pumps when wing tanks not full. Crossfeed valve: both engines from one side tank — used on engine failure or pump failure. Fuel: Jet A-1. ECAM displays in kg. ACT (additional center tank) on longer-range variants.`,
},
{
  id:'iq_p4_04', part:'p4', company:'aeroflot', difficulty:'med', tag:'SYSTEMS',
  q_ru:'Пневматика A320 — отборный воздух: откуда берётся и для чего используется.',
  q_en:'A320 pneumatics — bleed air: sources and uses.',
  answer_ru:`Отборный воздух (Bleed Air) на A320 берётся из компрессора двигателя CFM56 или APU. Из двигателя: обычно с 5-й ступени HPC при малой мощности и с 9-й ступени при высокой нагрузке — FADEC управляет переключением автоматически. Из APU: при стоянке или в аварийной ситуации. Применение: кондиционирование воздуха (Air Conditioning / Packs — ATA 21), противообледенительная система крыла и двигателя (Wing Anti-Ice / Engine Anti-Ice — ATA 30), запуск двигателя (стартер-генератор), герметизация самолёта (Pressurization — ATA 21). Система BLEED AIR управляется автоматически, но техник должен знать последствия утечки из пневматической системы: потеря кондиционирования, дым в кабине (при попадании масла в тракт), отказ запуска двигателя.`,
  answer_en:`Bleed air source: CFM56 HPC (5th stage low power, 9th stage high) — FADEC switches auto. APU at ground or emergency. Uses: air conditioning packs (ATA 21), wing+engine anti-ice (ATA 30), engine start, pressurization. Bleed leak consequences: loss of A/C, cabin smoke (oil contamination), failed engine start — know these for troubleshooting.`,
},
{
  id:'iq_p4_05', part:'p4', company:'aeroflot', difficulty:'med', tag:'SYSTEMS',
  q_ru:'Ключевые весовые данные A320 и Boeing 737-800.',
  q_en:'Key weight data for A320 and Boeing 737-800.',
  answer_ru:`A320-200 (CFM56-5B): Максимальная взлётная масса (MTOW) — 78 000 кг. Максимальная посадочная масса (MLW) — 66 000 кг. Максимальная масса без топлива (MZFW) — 62 500 кг. Операционная пустая масса (OEW) — около 42 200 кг. Топлива максимально — около 18 480 кг (крыльевые + центральный). Boeing 737-800 (CFM56-7B): MTOW — около 79 015 кг. MLW — 66 360 кг. OEW — около 41 400 кг. Важно для технического персонала: знать MTOW для проверки нагрузки на шасси при стоянке, понимать MZFW для контроля топливного баланса и выпуска бюллетеней по шасси и конструкции.`,
  answer_en:`A320: MTOW 78,000 kg, MLW 66,000 kg, MZFW 62,500 kg, OEW ~42,200 kg, max fuel ~18,480 kg. B737-800: MTOW ~79,015 kg, MLW 66,360 kg, OEW ~41,400 kg. Relevant to: gear load check on ground, MZFW for structural SB applicability, fuel balance.`,
},
{
  id:'iq_p4_06', part:'p4', company:'aeroflot', difficulty:'med', tag:'SYSTEMS',
  q_ru:'Что такое IDG (Integrated Drive Generator) и почему он важен для технического персонала?',
  q_en:'What is the IDG and why is it important for maintenance?',
  answer_ru:`IDG (Integrated Drive Generator) — интегральный привод-генератор. На A320 каждый двигатель имеет один IDG. Устройство объединяет две функции: постоянную скоростную передачу (CSD — Constant Speed Drive) и генератор переменного тока. CSD обеспечивает постоянную частоту вращения генератора (400 Гц, 115/200В переменного тока) независимо от оборотов двигателя. IDG охлаждается и смазывается отдельным масляным контуром. Критический параметр для техника: температура масла IDG — при перегреве система автоматически отключает IDG. IDG нельзя повторно включить в воздухе, только на земле. Типичная задача при обслуживании: проверка уровня масла IDG, визуальная проверка на утечки, контроль магнитного пробника. Дорогостоящий агрегат — замена IDG в рамках ТО требует точного соблюдения процедуры по AMM.`,
  answer_en:`IDG = CSD (constant speed drive) + AC generator in one unit. Per engine on A320. Provides constant 400 Hz / 115V AC regardless of engine RPM. Has own oil cooling circuit. Key maintenance: IDG oil level check, leak inspection, magnetic chip plug. Overheat → auto disconnect, cannot reconnect in flight (only ground reset). Expensive component — AMM procedure critical for removal/installation.`,
},
{
  id:'iq_p4_07', part:'p4', company:'aeroflot', difficulty:'med', tag:'SYSTEMS',
  q_ru:'Что такое ECAM на A320 и почему он важен для технического персонала?',
  q_en:'What is ECAM and why does it matter for maintenance?',
  answer_ru:`ECAM (Electronic Centralized Aircraft Monitor) — централизованная электронная система контроля самолёта. Отображает на двух экранах в кабине: верхний — Engine/Warning Display (EWD): тяга (N1), EGT, топливо, предупреждения; нижний — System Display (SD): гидравлика, электросистема, пневматика, кондиционирование, шасси и другие системы. Для технического персонала: ECAM-сообщения при запуске двигателя позволяют сразу выявить отказы систем; при дефектовании ECAM-отчёт из системы ACARS или бортового журнала даёт точный перечень зафиксированных неисправностей для поиска по AMM. В отличие от EICAS (Boeing) ECAM более агрессивен в предупреждениях — генерирует рекомендуемые процедуры экипажу.`,
  answer_en:`ECAM = 2-screen centralized monitoring. EWD (upper): N1, EGT, fuel, warnings. SD (lower): hydraulics, electrical, bleed, conditioning, gear etc. For maintenance: ECAM fault messages on start-up → direct AMM fault isolation. ACARS/logbook ECAM dump → exact fault list for rectification. More warning-aggressive than Boeing EICAS — generates crew action procedures automatically.`,
},

/* ─── PART 7 — DOCS / SAFETY / REGS ─────────────────────────────── */
{
  id:'iq_p7_01', part:'p7', company:'both', difficulty:'med', tag:'REGS',
  q_ru:'Чем AMM отличается от SRM и CMM?',
  q_en:'What is the difference between AMM, SRM and CMM?',
  answer_ru:`AMM (Aircraft Maintenance Manual) — руководство по техническому обслуживанию воздушного судна. Охватывает все задачи ТО на воздушном судне в целом: обслуживание систем, замену агрегатов, проверки. Разбит по ATA-главам. Основной документ линейного и базового ТО. SRM (Structural Repair Manual) — руководство по ремонту конструкции. Применяется при обнаружении повреждений обшивки, силовых элементов: допуски на повреждения, схемы ремонта, материалы и технология. CMM (Component Maintenance Manual) — руководство по ТО компонента. Это документ производителя конкретного агрегата (LRU): насоса, клапана, actuator. Применяется в цеховых условиях при ремонте снятых компонентов. Для техника на стоянке главное — AMM. При повреждении конструкции — SRM. Для цехового ремонта агрегата — CMM.`,
  answer_en:`AMM: whole-aircraft maintenance tasks, ATA-chapters, all systems — main tool for line/base maintenance. SRM: structural damage assessment and repair schemes — used when you find damage to skin, frames, stringers. CMM: component-level (from manufacturer of that specific part) — used in shop, after LRU removal. Line tech: AMM. Damage found: SRM. Component shop work: CMM.`,
},
{
  id:'iq_p7_02', part:'p7', company:'both', difficulty:'high', tag:'REGS',
  q_ru:'Что такое MEL и как работает дефектование по MEL?',
  q_en:'What is MEL and how does MEL deferral work?',
  answer_ru:`MEL (Minimum Equipment List) — перечень минимального оборудования. Документ, утверждённый авиационным регулятором (на основе MMEL производителя), который определяет, с какими неисправными системами или оборудованием воздушное судно может выполнять полёты в течение ограниченного времени. Как работает: техник обнаруживает неисправность → ищет позицию в MEL → если позиция есть и выполнены условия (O-items — задачи экипажа, M-items — задачи технического персонала) → выпускает самолёт с дефектом в журнал АО и ставит срок устранения (категории: A — немедленно, B — 3 дня, C — 10 дней, D — 120 дней). Задачи технического персонала по MEL: выполнить установленные M-процедуры, сделать запись в технический журнал, поставить срок. Если позиции в MEL нет — самолёт НЕ вылетает до устранения.`,
  answer_en:`MEL = approved list of items that can be inoperative for limited periods with conditions. Regulator-approved (based on MMEL). Deferral: fault found → check MEL → if listed: complete O-items (crew) and M-items (maintenance) → release with entry in tech log + defer deadline. Categories: A=immediate, B=3 days, C=10 days, D=120 days. If NOT in MEL → aircraft stays grounded.`,
},
{
  id:'iq_p7_03', part:'p7', company:'both', difficulty:'high', tag:'REGS',
  q_ru:'Что такое CDCCL и почему это критически важно?',
  q_en:'What is CDCCL and why is it critical?',
  answer_ru:`CDCCL (Critical Design Configuration Control Limitations) — ограничения на контроль критической конфигурации конструкции. Это перечень конкретных задач технического обслуживания и компонентов, в которых несоблюдение процедур или замена несертифицированными деталями могут привести к катастрофическому отказу (критические узлы систем топлива, электрических жгутов, конструктивных элементов). CDCCL обязателен для самолётов, перевозящих более 60 пассажиров. Задачи, помеченные как CDCCL в AMM, должны выполняться строго по процедуре, документироваться, проходить независимую проверку. Нарушение CDCCL — немедленный прекращение задачи, оформление дефектного акта, уведомление технического директора. Практически: это задачи с пометкой CDCCL в AMM — не пропускай проверку, не упрощай процедуру, документируй полностью.`,
  answer_en:`CDCCL = list of maintenance tasks/components where non-compliance can cause catastrophic failure (fuel system, wiring, structure). Mandatory for aircraft >60 pax. AMM tasks marked CDCCL: must be performed per procedure exactly, documented, independently inspected. Violation → stop task immediately, raise defect, notify quality/tech director. In practice: see CDCCL marking in AMM → never skip the check, never simplify, document fully.`,
},
{
  id:'iq_p7_04', part:'p7', company:'both', difficulty:'med', tag:'REGS',
  q_ru:'Чем бюллетень (SB) отличается от директивы лётной годности (AD)?',
  q_en:'What is the difference between a Service Bulletin (SB) and an Airworthiness Directive (AD)?',
  answer_ru:`SB (Service Bulletin / Бюллетень) — документ от производителя воздушного судна или двигателя. Носит рекомендательный характер. Описывает улучшения, модификации, ремонты, обновление компонентов. Эксплуатант может выбрать: включить в программу ТО или нет. AD (Airworthiness Directive / Директива лётной годности) — регуляторный документ от авиационного органа (EASA, FAA, Росавиация). Обязателен к исполнению в установленные сроки и лётно-технические ограничения. Как правило, выпускается на основе SB, когда регулятор признаёт тему небезопасной. Отличие: SB — рекомендация производителя, AD — обязательное предписание регулятора с юридической силой. Неисполнение AD = воздушное судно не имеет Certificate of Airworthiness.`,
  answer_en:`SB: manufacturer document — recommended modifications/improvements/repairs. Optional for operator. AD: regulatory authority (EASA/FAA/Росавиация) mandatory directive — issued when safety issue confirmed, usually based on SB. Legally binding, specific compliance time/cycle limits. Non-compliance = loss of Certificate of Airworthiness. Rule: SB = optional, AD = compulsory.`,
},
{
  id:'iq_p7_05', part:'p7', company:'both', difficulty:'high', tag:'REGS',
  q_ru:'Что вы сделаете, если старший инженер говорит ускориться и пропустить шаг процедуры из-за давления времени?',
  q_en:'What do you do if a senior engineer tells you to skip a procedure step due to time pressure?',
  answer_ru:`Остановлюсь. Авиационное техническое обслуживание не допускает упрощения процедур, независимо от источника давления. Конкретно: спокойно скажу старшему, что не могу пропустить этот шаг, так как он является частью утверждённой процедуры AMM / CDCCL. Если он настаивает — зафиксирую ситуацию устно при свидетеле и обращусь к техническому директору или Quality Manager. Подпись под неправильно выполненной задачей означает мою личную ответственность за исход. Никакое давление сроков или авторитет старшего не переносит эту ответственность. Это не упрямство — это то, как работает авиационная безопасность. Я готов объяснить это любому коллеге профессионально и без конфликта.`,
  answer_en:`STOP the task. In aviation maintenance, no time pressure justifies skipping an AMM/CDCCL step. Calmly tell the senior: cannot skip — this step is mandatory per AMM. If they insist: document verbally with witness, escalate to QM/Tech Director. My signature = my personal liability for the outcome. No seniority transfers that responsibility. Will explain this professionally without conflict.`,
},
{
  id:'iq_p7_06', part:'p7', company:'both', difficulty:'med', tag:'REGS',
  q_ru:'Human Factors — что это такое и как это применяется в ТО?',
  q_en:'Human Factors — what is it and how does it apply in maintenance?',
  answer_ru:`Human Factors — область изучения того, как человеческие факторы (усталость, стресс, отвлечение, коммуникация, давление) влияют на ошибки в технических работах. В авиационном ТО применяются модели из EASA Part-66 Module 9. Концепция "Dirty Dozen" (12 типичных факторов ошибок): недостаточное знание, стресс, усталость, самоуверенность, отвлечение, отсутствие командной работы, давление, недостаток ресурсов, давление нормы, недостаток коммуникации, недостаток знаний, несоблюдение норм. На практике: перед началом сложной задачи — оценить своё состояние. После любого прерывания задачи — вернуться к месту останова, подтвердить статус всех шагов. Всегда делать визуальный осмотр перед закрытием доступа (closing inspection). NEVER: работать по памяти, торопиться при переходе от одной задачи к другой, делать исключения из-за привычки.`,
  answer_en:`HF: study of how human factors cause maintenance errors. EASA M9. The Dirty Dozen: lack of knowledge, stress, fatigue, complacency, distraction, lack of teamwork, pressure, lack of resources, norms pressure, poor communication. In practice: pre-task self-check. After interruption: return to stop point, confirm all steps. Closing inspection before every panel closure. Never work from memory. Never rush task transitions.`,
},
{
  id:'iq_p7_07', part:'p7', company:'both', difficulty:'med', tag:'REGS',
  q_ru:'Был ли у вас случай технической ошибки или ситуации, близкой к ошибке?',
  q_en:'Have you experienced a technical error or near-miss in maintenance?',
  answer_ru:`Да, был случай, когда я едва не выпустил самолёт без финального контрольного осмотра крышки маслозаливной горловины — сделал заправку масла, отвлёкся на вопрос коллеги, и едва не закрыл капот. Заметил это при выполнении closing inspection — крышка была незатянута. Что я вынес: closing inspection — это не формальность, это последняя линия защиты. С тех пор: never close access until physically confirmed closure of all caps, panels, fittings — по чек-листу, без исключений. Этот случай вошёл в мою личную практику нулевой терпимости к "почти закрыл".`,
  answer_en:`Real example: Almost released aircraft without tightening oil filler cap after servicing — distracted by colleague question, caught at closing inspection. Oil cap not secured. Lesson: closing inspection is the last defense line. Since then: never close access until every cap/panel physically confirmed by checklist — no exceptions. Personal zero-tolerance for "almost closed".`,
},

/* ─── PART 6 — LEAP-1A / FUTURE ENGINES ─────────────────────────── */
{
  id:'iq_p6_01', part:'p6', company:'both', difficulty:'med', tag:'LEAP',
  q_ru:'Что такое LEAP-1A и на каких воздушных судах он применяется?',
  q_en:'What is the LEAP-1A and which aircraft does it power?',
  answer_ru:`LEAP (Leading Edge Aviation Propulsion) — семейство турбовентиляторных двигателей нового поколения CFM International, разработанное совместно GE Aviation и Safran Aircraft Engines. Пришёл на смену CFM56. Три варианта: LEAP-1A — для семейства A320neo (Airbus New Engine Option): A319neo, A320neo, A321neo. LEAP-1B — для Boeing 737 MAX. LEAP-1C — для COMAC C919 (китайский узкофюзеляжный). LEAP-1A поступил в эксплуатацию в 2016 году. Масса мокрая — около 3 153 кг. Тяга — до 32 160 фунтов-сил. Степень двухконтурности — около 11:1 (против 5.7–6:1 у CFM56-5B). Экономия топлива — 15–16% против CFM56-5B.`,
  answer_en:`LEAP = CFM International next-gen turbofan (GE + Safran). Replaces CFM56. LEAP-1A: A320neo family (A319/320/321neo) from 2016. LEAP-1B: Boeing 737 MAX. LEAP-1C: COMAC C919. Weight ~3,153 kg wet. Thrust up to 32,160 lbf. BPR ~11:1 vs CFM56-5B's 5.7:1. Fuel savings 15–16% vs CFM56.`,
},
{
  id:'iq_p6_02', part:'p6', company:'both', difficulty:'high', tag:'LEAP',
  q_ru:'Три ключевых технических отличия LEAP-1A от CFM56-5B.',
  q_en:'Three key technical differences between LEAP-1A and CFM56-5B.',
  answer_ru:`Первое — лопатки вентилятора. CFM56-5B: 36 цельнотитановых лопаток. LEAP-1A: 18 лопаток из трёхмерно-тканого углеродного волокна в полимерной матрице (3D-woven CFRP). Каждая лопатка LEAP тяжелее, но на 18 штук при больше диаметре — меньше суммарный вес. Повышенная степень двухконтурности (11:1 vs 6:1) дала возможность использовать больший вентилятор. Второе — детали горячей секции из CMC (Ceramic Matrix Composite — керамокомпозитный материал). Кольца статора HPT и лопатки HPT shrouds у LEAP выполнены из CMC: в 1/3 легче никелевых суперсплавов, выдерживают температуры выше +1 200°C без дополнительного охлаждения. Для техника: CMC — хрупкий материал, требует особой осторожности при бороскопии и обращении. Третье — камера сгорания TAPS (Twin Annular Pre-Swirl): две концентрических форсуночных секции с предварительным завихрением топливовоздушной смеси. Снижает выброс NOx на 50% по сравнению с CFM56.`,
  answer_en:`1) Fan blades: CFM56 = 36 solid Ti blades. LEAP = 18 × 3D-woven CFRP (carbon fiber composite). Larger fan, fewer blades, lower weight. Higher BPR (11:1) enabled larger fan. 2) CMC (Ceramic Matrix Composite) HPT shrouds: 1/3 weight of nickel superalloys, handles >1,200°C without cooling air. Maintenance note: CMC is brittle — extreme care during borescope and handling. 3) TAPS combustor (Twin Annular Pre-Swirl): dual concentric swirl zones → 50% less NOx vs CFM56.`,
},
{
  id:'iq_p6_03', part:'p6', company:'both', difficulty:'med', tag:'LEAP',
  q_ru:'Почему опыт CFM56 останется востребованным ещё 10+ лет?',
  q_en:'Why will CFM56 experience remain valuable for 10+ years?',
  answer_ru:`Глобальный флот A320ceo и Boeing 737 NG насчитывает тысячи самолётов в эксплуатации по всему миру. Эти самолёты будут летать до 2035–2040 года. Пик спроса на shop visit для CFM56-5B приходится на 2025–2032 год — именно сейчас открываются новые CFM56-специализированные MRO по всему миру, включая АэроТраст в России. Аэрофлот сейчас активно расширяет компетенции по CFM56-5B. Это значит, что специалисты по CFM56 на рынке нужны прямо сейчас и будут нужны как минимум до 2033–2035. После — часть из них перейдёт на LEAP, другая часть будет обслуживать стареющий флот. Лицензия на CFM56 + переход на LEAP — это 20-летняя карьера в двигателестроении.`,
  answer_en:`Global A320ceo + 737 NG fleet = thousands of aircraft flying until 2035–2040. CFM56 shop visit demand peaks 2025–2032. New CFM56 MROs opening worldwide now (including AeroTrust). CFM56 specialists needed immediately and for 10+ years. After: LEAP training builds on CFM56 fundamentals. CFM56 now + LEAP later = 20-year engine career.`,
},
{
  id:'iq_p6_04', part:'p6', company:'both', difficulty:'med', tag:'LEAP',
  q_ru:'Что такое GTF (Geared Turbofan) — двигатель PW1100G на A320neo?',
  q_en:'What is the GTF (Geared Turbofan) — the PW1100G on the A320neo?',
  answer_ru:`GTF (Geared Turbofan — редукторный турбовентилятор) — Pratt & Whitney PW1100G-JM. Это альтернативный двигатель для A320neo наряду с LEAP-1A. Ключевое отличие от CFM56 и LEAP: редуктор (planetary gearbox) между валом низкого давления и вентилятором. Вентилятор вращается медленнее (около 3 000 об/мин), чем турбина низкого давления (~10 000 об/мин). Это позволяет обоим работать на оптимальных оборотах. Степень двухконтурности: 12:1. Экономия топлива: около 16% против CFM56-5B. Для технического персонала: редуктор — дополнительный сложный узел, требующий контроля масляной системы редуктора отдельно от основной масляной системы двигателя. История ранних PW1100G: проблемы с покрытиями лопаток и маслосистемой в начальный период эксплуатации — накоплен опыт доработок.`,
  answer_en:`GTF = planetary gearbox between LPT shaft and fan. Fan ~3,000 RPM, LPT ~10,000 RPM — both at optimal speed. BPR ~12:1. Fuel savings ~16% vs CFM56. Maintenance complexity: gearbox = additional oil system to monitor (separate from main engine oil). Early PW1100G had blade coating and oil system issues — now resolved via SBs. A320neo: choice between LEAP-1A and PW1100G-JM.`,
},
{
  id:'iq_p6_05', part:'p6', company:'both', difficulty:'low', tag:'LEAP',
  q_ru:'Что такое CMC-детали и почему они требуют особого внимания при ТО?',
  q_en:'What are CMC parts and why do they require special care in maintenance?',
  answer_ru:`CMC (Ceramic Matrix Composite) — керамокомпозитный материал: керамические волокна (SiC — карбид кремния) в керамической матрице. На LEAP-1A применяется в кольцах статора HPT и тепловых экранах. Преимущества: в 1/3 легче никелевых суперсплавов, работает при температурах выше 1 200°C без охлаждающего воздуха — экономия воздуха идёт на повышение КПД. Для технического персонала критически важно: CMC — хрупкий материал, в отличие от металлических сплавов. Не допускает ударов, инструментального контакта, нагрузок, не предусмотренных AMM. При бороскопии CMC-зон: смотреть на признаки расслоения, сколы, трещины — пределы более строгие, чем для металла. Хранение и транспортировка снятых CMC-деталей: только в специальных упаковочных ложементах. Любое повреждение CMC-детали при ТО — немедленный дефектный акт.`,
  answer_en:`CMC = SiC fibers in ceramic matrix. On LEAP: HPT stage 1 shrouds. 1/3 weight of nickel, handles >1,200°C without cooling air. Critical for maintenance: CMC is BRITTLE — no impact, no tool contact, no unauthorized load. Borescope: look for delamination, chips, cracks — limits stricter than metal. Removed CMC parts: dedicated foam-lined packaging only. Any CMC damage during maintenance → immediate defect notice.`,
},
{
  id:'iq_p6_06', part:'p6', company:'both', difficulty:'low', tag:'LEAP',
  q_ru:'Если попадётся на работу с LEAP-1A — с чего начнёте изучение?',
  q_en:'If assigned to work on LEAP-1A — where would you start your training?',
  answer_ru:`Первое — CFM LEAP-1A Type Training по EASA/FAA, который выдаёт разрешение на обслуживание конкретного типа двигателя. Затем — детальное изучение AMM LEAP-1A, особенно: глава по работе с CMC-деталями (Special Processes), система FADEC нового поколения (Dual Channel FADEC с иной логикой, чем у CFM56), особенности бороскопии (зоны CMC, новые доступы). Параллельно — изучение отличий в инструментах и специальных приспособлениях (GSE): LEAP требует специфических borescope-адаптеров. Базовые принципы из CFM56 полностью переносятся: схема двигателя, параметры, маслосистема, fuel system — разница в деталях, не в фундаменте.`,
  answer_en:`Start: CFM LEAP-1A type training (EASA/FAA approved) → maintenance authorization for type. Then: AMM LEAP-1A deep study — CMC special processes, new FADEC logic, borescope access points for CMC zones. Special tooling/GSE (LEAP-specific borescope adapters). Foundation from CFM56 transfers completely — difference is in details, not fundamentals.`,
},

]; // end D.interview_qa

// ═══════════════════════════════════════════
// INTERVIEW DAY CHECKLISTS
// ═══════════════════════════════════════════
D.interview_checklists = [
  {
    id:'june2', company:'Аэрофлот Техникс',
    address:'Building 6, Room 108', time:'15:30',
    date:'2026-06-02', border:'red',
    items:[
      {id:'j2_0', text:'Паспорт + ВНЖ в сумке'},
      {id:'j2_1', text:'Распечатан CV — 2 копии'},
      {id:'j2_2', text:'Телефон заряжен + беззвучный'},
      {id:'j2_3', text:'Прийти за 20 минут'},
      {id:'j2_4', text:'Вопрос флота готов: "A320/Boeing или Superjet?"'},
      {id:'j2_5', text:'Скрипт зарплаты заучен: 85k → push 100k'},
      {id:'j2_6', text:'Вопрос по зарплате на пробации готов'},
      {id:'j2_7', text:'Ответ на оффер: "Отвечу до пятницы 6 июня"'}
    ]
  },
  {
    id:'june4', company:'АэроТраст',
    address:'Sky Point Building Beta', time:'12:00',
    date:'2026-06-04', border:'amber',
    items:[
      {id:'j4_0', text:'Паспорт + ВНЖ в сумке'},
      {id:'j4_1', text:'Распечатан CV — 2 копии'},
      {id:'j4_2', text:'Телефон заряжен + беззвучный'},
      {id:'j4_3', text:'Прийти за 20 минут'},
      {id:'j4_4', text:'Честный ответ: ТВД-10Б line maintenance (не CFM56 overhaul)'},
      {id:'j4_5', text:'Подтверждение должности письменно готово'},
      {id:'j4_6', text:'Зарплата 90k+ — держать позицию'},
      {id:'j4_7', text:'Вопрос по зарплате на пробации готов'}
    ]
  }
];
