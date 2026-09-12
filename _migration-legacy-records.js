// DUNE LIFE OS — PRV-0.5 migration-only legacy record seed.
//
// This module carries the pre-sanitization record identity for four
// domains (deadlines, goals, claims, risks) so that the one-shot
// hydration in app.js can copy them into durable Store storage on
// browsers that still hold the pre-migration state shape.
//
// It exists solely as a preservation bridge:
//
//   1. Runtime renderers MUST NOT read from here — they read from
//      Store paths `records.deadlines / .goals / .claims / .risks`
//      populated by hydration.
//   2. Hydration is idempotent and gated by the sticky Gen-1 flag
//      `dune_records_hydrated_v1`, which survives Reset. Once the
//      flag is set, this seed is never consulted again on that
//      browser.
//   3. PRV-1 remains responsible for removing personal content from
//      the public repository; this module is deliberately public
//      during PRV-0.5 and will be sanitized/removed in a later
//      explicitly-approved cleanup step after PRV-1 lands.
//
// Do NOT duplicate this corpus elsewhere. Do NOT read it at render
// time. Do NOT extend it — new records go through the Store writers
// documented in ADR-015.
//
// See docs/lifeos/DECISIONS.md ADR-015 for the full authority model.

(function (global) {
  'use strict';

  const LEGACY_RECORDS = {
    deadlines: [
      { id:'dl01', title:'АэроТраст — contract terms confirmed in writing', date:'2026-06-20', cat:'career', importance:'critical', consequence:'Start work without written 130k net / white salary confirmation', note:'130,000 ₽ net, official white contract, position title, schedule — all in writing before day one.', private:false },
      { id:'dl02', title:'First 55k ₽ saved — prove the system works', date:'2026-07-10', cat:'finance', importance:'high', consequence:'Savings habit never starts — lifestyle eats the salary', note:'Auto-transfer 55,000 ₽ on payday. Pay yourself first, live on the rest.', private:false },
      { id:'dl03', title:'MAI application deadline (estimated)', date:'2026-07-15', cat:'education', importance:'high', consequence:'Miss September intake — passport shield delayed 6 months', note:'Call MAI: +7 499 158-43-36. Confirm exact date.', private:false },
      { id:'dl04', title:'MAI enrollment confirmed', date:'2026-09-01', cat:'education', importance:'critical', consequence:'No shield for military status question at embassy', note:'Get enrollment certificate immediately upon enrollment.', private:false },
      { id:'dl05', title:'EASA Module 15 — self-study complete', date:'2026-10-01', cat:'education', importance:'high', consequence:'Module pipeline slips — 2 modules per 4 months target breaks', note:'Gas Turbines first — strongest area with engine background.', private:false },
      { id:'dl06', title:'Emergency fund — 3 months expenses (~225k ₽)', date:'2026-12-31', cat:'finance', importance:'high', consequence:'One bad month forces you to break the 55k system', note:'Build from the 55k monthly savings. Never touch except genuine emergency.', private:false },
      { id:'dl07', title:'ВНЖ renewal paperwork start', date:'2026-12-01', cat:'legal', importance:'high', consequence:'Legal status risk, no airport badge', note:'Start 3 months early. ВНЖ due March 2027.', private:false },
      { id:'dl08', title:'ВНЖ renewal deadline', date:'2027-03-01', cat:'legal', importance:'critical', consequence:'Illegal status, no airport badge', note:'NOT citizenship — just residence permit renewal.', private:false },
      { id:'dl09', title:'Egyptian passport renewal target', date:'2027-06-01', cat:'passport', importance:'critical', consequence:'Risk crossing age-28 wall with military complications', note:'Routine renewal. MAI cert only if asked about army.', private:false },
      { id:'dl10', title:'CFM56-5B engine certifying authorization — apply after 1 year', date:'2027-09-01', cat:'career', importance:'high', consequence:'First official engine credential slips', note:'Company / Part-145 certifying authorization for engine tasks. Requires complete stamped logbook + type training.', private:false },
      { id:'dl11', title:'⚠ PASSPORT HARD WALL — Age 28', date:'2028-01-21', cat:'passport', importance:'critical', consequence:'Military clearance required for renewal — extremely complex process', note:'DO NOT cross this without a valid renewed passport.', private:false }
    ],

    claims: [
      { id:'cl01', title:'Egyptian passport renewable at 27 without military clearance', text:'At age 27, routine renewal as Egyptian citizen abroad. Military clearance only required after age 28.', cat:'passport', confidence:'likely', sourceType:'AI', sourceNote:'Multiple AI consensus. Not yet confirmed directly with Embassy.', lastChecked:'2026-05-27', recheckDate:'2026-07-01', consequence:'If wrong: complex military paperwork, may miss the pre-28 window entirely', nextAction:'Call Embassy +7 495 246-0442 — confirm in writing', private:false },
      { id:'cl02', title:'MAI enrollment satisfies embassy military status question', text:'Student enrollment at Russian university = valid deferral answer if embassy asks about army service during passport renewal.', cat:'passport', confidence:'uncertain', sourceType:'AI', sourceNote:'Reasonable assumption, not officially confirmed by embassy.', lastChecked:'2026-05-27', recheckDate:'2026-07-01', consequence:'If wrong: enrollment certificate useless — need different documentation entirely', nextAction:'Get written answer from Embassy BEFORE paying MAI tuition', private:false },
      { id:'cl03', title:'Russian citizenship triggers conscription under Law 53-FZ at age 27', text:'Federal Law 53-FZ: all male Russian citizens 18-30 subject to conscription. Presidential Decree №821 (2025) requires military service proof to finalize citizenship.', cat:'army', confidence:'verified', sourceType:'official', sourceNote:'Multiple official Russian legal sources + AI consensus. Widely documented.', lastChecked:'2026-05-27', recheckDate:'2027-01-01', consequence:'If underestimated: army obligation', nextAction:'Decision already made: skip citizenship, renew ВНЖ only', private:false }
    ],

    risks: [
      { id:'rk01', title:'Egyptian passport not renewed before age-28 wall', cat:'passport', prob:2, impact:5, mitigation:'Renew mid-2027 at age 27. MAI cert as shield. Hard deadline Jan 21 2028.', status:'active', nextReview:'2027-01-01', private:false },
      { id:'rk02', title:'АэроТраст instability — young company', cat:'career', prob:2, impact:4, mitigation:'Watch payroll regularity. Keep CV and English logbook always current. Document every task — your record stays valuable even if the company doesn\'t.', status:'active', nextReview:'2026-09-01', private:false },
      { id:'rk03', title:'Savings discipline fails — lifestyle eats the 130k', cat:'money', prob:3, impact:4, mitigation:'Auto-transfer 55k on payday before anything else. Rent ceiling 28k. Track every month in the Finance tab.', status:'active', nextReview:'2026-07-10', private:false },
      { id:'rk04', title:'Logbook weak — Russian-language, vague tasks, missing stamps', cat:'licensing', prob:3, impact:5, mitigation:'English from day one. Every ATA chapter. Every stamp. Monthly self-audit.', status:'active', nextReview:'2026-09-01', private:false },
      { id:'rk05', title:'EASA module study stalls under 2/2 shift fatigue', cat:'education', prob:3, impact:4, mitigation:'Fixed study blocks on off days. 2 modules per 4 months. M15 first — strongest area. Track in EASA tab.', status:'active', nextReview:'2026-10-01', private:false },
      { id:'rk06', title:'Sanctions block transfers / Bybit restricted', cat:'money', prob:3, impact:3, mitigation:'Split savings: 60% USDT, 30% physical USD/bank, 10% RUB buffer. Never one platform.', status:'active', nextReview:'2026-09-01', private:false },
      { id:'rk07', title:'ВНЖ renewal missed — March 2027', cat:'legal', prob:1, impact:5, mitigation:'Start paperwork December 2026. Continuous official employment at АэроТраст covers the requirement.', status:'active', nextReview:'2026-12-01', private:false },
      { id:'rk08', title:'Burnout — shift work + study + everything alone', cat:'health', prob:3, impact:3, mitigation:'Protect sleep on shift transitions. One full rest day per off-block. Deen, gym, real food — non-negotiable basics.', status:'active', nextReview:'2026-08-01', private:false }
    ],

    goals: [
      { id:'go01', title:'Excel at АэроТраст — CFM56-5B overhaul competence', cat:'career', status:'active', progress:5, deadline:'2027-06-01', risk:'low', note:'130k ₽ net. Learn the engine from disassembly to test. Volunteer for borescope, defectation, assembly.', nextAction:'First 90 days: AMM before every task, ask why not just what' },
      { id:'go02', title:'English logbook — every task from day one', cat:'career', status:'active', progress:0, deadline:'2026-07-01', risk:'high', note:'Date, engine/aircraft, ATA, description, hours, supervisor stamp. No exceptions.', nextAction:'First day of work — first entry' },
      { id:'go03', title:'CFM56-5B engine certifying authorization (Part-145)', cat:'career', status:'planned', progress:0, deadline:'2027-12-01', risk:'low', note:'Engine-shop credential — NOT Category A (that needs whole-aircraft line work, which engine-only does not cover). Company authorization to certify CFM56 tasks.', nextAction:'Complete CFM56 type training + stamped logbook, then apply through АэроТраст quality dept' },
      { id:'go04', title:'EASA Part-66 — 15 module exams', cat:'career', status:'active', progress:5, deadline:'2029-06-01', risk:'medium', note:'2 modules per 4 months. M15 → M9 → M10 → M7 → M11A → rest. Budget €3,000–5,000.', nextAction:'M15 study blocks on off days — already 20% in' },
      { id:'go05', title:'MAI Master\'s enrolled', cat:'education', status:'active', progress:25, deadline:'2026-07-15', risk:'medium', note:'September 2026 intake. Part-time aviation Master\'s. Passport shield + real qualification.', nextAction:'Call MAI: +7 499 158-43-36' },
      { id:'go06', title:'Certificates portfolio — type courses, HF, FTS, EWIS', cat:'education', status:'planned', progress:0, deadline:'2027-12-01', risk:'low', note:'Collect every training certificate АэроТраст offers. Each one compounds.', nextAction:'Ask training department what courses are available to you' },
      { id:'go07', title:'Egyptian passport renewed before Jan 21, 2028', cat:'documents', status:'active', progress:15, deadline:'2027-06-01', risk:'high', note:'Renew mid-2027 at age 27. Routine renewal, no elaborate story.', nextAction:'Confirm docs with Embassy, then enroll MAI September' },
      { id:'go08', title:'ВНЖ renewed', cat:'documents', status:'planned', progress:0, deadline:'2027-03-01', risk:'high', note:'NOT citizenship. Start paperwork December 2026.', nextAction:'Calendar reminder December 2026' },
      { id:'go09', title:'Egyptian military settlement paid', cat:'documents', status:'blocked', progress:0, deadline:null, risk:'high', note:'Program CLOSED. Monitor mfa.gov.eg monthly. Pay the day it opens.', nextAction:'Register on mfa.gov.eg. Keep $7,000+ fund ready.' },
      { id:'go10', title:'Save 55,000 ₽ every single month', cat:'finance', status:'active', progress:0, deadline:null, risk:'medium', note:'42% of 130k net. Auto-transfer on payday. 660,000 ₽/year.', nextAction:'Set up the auto-transfer before first salary' },
      { id:'go11', title:'Emergency fund — 3-6 months (~225–450k ₽)', cat:'finance', status:'active', progress:0, deadline:'2026-12-31', risk:'medium', note:'First bucket the 55k fills. Never touch except genuine emergency.', nextAction:'First 4 months of savings go here' },
      { id:'go12', title:'Egypt settlement fund: $7,000+ USD', cat:'finance', status:'active', progress:0, deadline:null, risk:'high', note:'Pay same day program opens. Second bucket after emergency fund.', nextAction:'~$500/month equivalent after emergency fund done' },
      { id:'go13', title:'EASA exam & certificates fund: €3,000–5,000', cat:'finance', status:'planned', progress:0, deadline:'2028-06-01', risk:'low', note:'15 modules × €200–300 per attempt + course fees. Investing in yourself.', nextAction:'Third bucket — start once settlement fund is on track' }
    ]
  };

  // Freeze so no code path can mutate the seed in place.
  try {
    Object.freeze(LEGACY_RECORDS);
    Object.freeze(LEGACY_RECORDS.deadlines);
    Object.freeze(LEGACY_RECORDS.claims);
    Object.freeze(LEGACY_RECORDS.risks);
    Object.freeze(LEGACY_RECORDS.goals);
  } catch (e) { /* frozen not supported — hydration still copies via slice/map */ }

  global.LEGACY_RECORDS = LEGACY_RECORDS;
})(typeof window !== 'undefined' ? window : globalThis);
