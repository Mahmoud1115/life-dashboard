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
    other: 5000, mai: 0, ring_save: 0, usd_rate: 88
  },
  gulf: {
    salary_aed: 12000, housing: 6000, transport: 1200, food: 2000,
    dep_cost: 0, remittance: 500, easa_monthly: 300, usd_rate: 3.67
  }
};
