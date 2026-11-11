// 28-day persona simulation on the app's own pure rules (Sparks, week dots, wrap lines, energy notes).
// No network and no AI calls: AI lookups are only COUNTED against a budget, so the cost of 4 weeks is known.
// Usage: node scripts/agent/sim.mjs [repoRoot] [outDir]
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2] || process.cwd(); const outDir = process.argv[3] || join(root, 'test-results');
const require = createRequire(import.meta.url); let esbuild;
for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild']) { try { esbuild = require(p); break; } catch { /* next */ } }
if (!esbuild) { console.error('esbuild not found'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'agent-'));
writeFileSync(join(dir, 'e.ts'), `export * from '${root}/src/lib/sparks'; export * from '${root}/src/lib/weekDots'; export * from '${root}/src/lib/wrapData'; export * from '${root}/src/lib/intel/energyIntel';`);
await esbuild.build({ entryPoints: [join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'o.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(join(dir, 'o.mjs')).href);

// deterministic random so runs can be compared
let seed = 42; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const AI_CAP_PER_DAY = 5, DAYS = 28;
// p = chance of logging each meal; water = glasses range; ai = AI food lookups per day; energy = chance of check-in
const PERSONAS = [
  { id: 'consistent', p: .95, water: [4, 8], ai: 1, energy: .9 },
  { id: 'weekend-skipper', p: .85, water: [3, 7], ai: 1, energy: .7, skipDays: d => d % 7 >= 5 },
  { id: 'binge-logger', p: .2, water: [0, 2], ai: 0, energy: .2, bingeDays: d => d % 7 === 0 },
  { id: 'dropout-week2', p: .9, water: [3, 6], ai: 1, energy: .8, dropFrom: 8 },
  { id: 'returner', p: .9, water: [3, 6], ai: 1, energy: .8, gap: [8, 20] },
  { id: 'hinglish-heavy', p: .9, water: [2, 6], ai: 4, energy: .6 },
  { id: 'ai-hammer', p: 1, water: [8, 12], ai: 12, energy: 1 },
  { id: 'never-logs', p: 0, water: [0, 0], ai: 0, energy: 0 },
];
const BAD = /\b(fail(ed|ure)?|lazy|guilt|shame|bad|cheat|punish|lose weight|fat|diet|streak (broken|lost)|you (missed|forgot)|should have|diagnos|cure|treat|disease)\b/i;
const meals = ['breakfast', 'lunch', 'snack', 'dinner'];
const rows = []; const issues = []; let totalAI = 0, blockedAI = 0, texts = 0;
const note = (persona, day, what) => issues.push({ persona, day, what });

for (const P of PERSONAS) {
  let total = 0, logged = [], energyRows = [], aiUsed = 0, peakDay = 0, weekDotsOk = true, last = null;
  const sparkLedger = new Set();
  for (let d = 1; d <= DAYS; d++) {
    const date = new Date(Date.UTC(2026, 10, d)).toISOString().slice(0, 10);
    const away = (P.dropFrom && d >= P.dropFrom) || (P.gap && d >= P.gap[0] && d <= P.gap[1]) || (P.skipDays && P.skipDays(d));
    const done = [];
    if (!away) for (const m of meals) if (rnd() < (P.bingeDays && P.bingeDays(d) ? 1 : P.p)) done.push(m);
    const glasses = away ? 0 : Math.round(P.water[0] + rnd() * (P.water[1] - P.water[0]));
    // AI lookups are counted, and the daily cap is enforced by the agent the same way the app should
    let want = away ? 0 : P.ai; const used = Math.min(want, AI_CAP_PER_DAY); blockedAI += want - used; aiUsed += used; totalAI += used;
    const existing = [...sparkLedger].filter(k => k.startsWith(date)).map(k => { const [, kind, ref] = k.split('|'); return { kind, ref, points: 5 }; });
    const awards = M.planAwards({ meals: done, glasses }, existing);
    let day = 0; for (const a of awards) { sparkLedger.add(`${date}|${a.kind}|${a.ref}`); day += a.points; }
    // run it twice: a second pass must award nothing (no double counting)
    const again = M.planAwards({ meals: done, glasses }, [...sparkLedger].filter(k => k.startsWith(date)).map(k => { const [, kind, ref] = k.split('|'); return { kind, ref, points: 5 }; }));
    if (again.length) note(P.id, d, 'Sparks awarded twice for the same activity');
    const dayTotal = existing.reduce((s, e) => s + e.points, 0) + day;
    if (dayTotal > M.DAILY_CAP) note(P.id, d, `daily Sparks ${dayTotal} is above the cap ${M.DAILY_CAP}`);
    peakDay = Math.max(peakDay, dayTotal); total += day;
    if (done.length) logged.push(date);
    if (rnd() < P.energy && !away) energyRows.push({ day: date, calories: done.length * 450, protein_g: done.length * 20, meals: done.length, items: done.length, energy: 1 + Math.floor(rnd() * 3) });
    // every sentence a person could read today
    const dots = M.weekDots(date, logged); const n = M.daysLogged(dots);
    const lines = [M.weekLine(n), M.wrapTitle({ meals: done.length, glasses, energy: null, sparksToday: day }), ...M.wrapLines({ meals: done.length, glasses, energy: 'steady', sparksToday: day }).map(l => l.text), ...M.quests({ meals: done, glasses }).map(q => q.label)];
    for (const t of lines) { texts++; if (BAD.test(t)) note(P.id, d, `shaming or medical wording: "${t}"`); }
    if (dots.length !== 7) weekDotsOk = false;
  }
  const lv = M.levelFor(total);
  const obs = M.observe({ rows: energyRows, targets: { cal: 1800, protein: 70 } });
  for (const o of obs) { if (!M.isObservational(o.text)) note(P.id, 28, `energy note makes a claim: "${o.text}"`); if (o.sample_size < M.MIN_DAYS) note(P.id, 28, 'energy note shown with too little data'); }
  if (P.id === 'never-logs' && total !== 0) note(P.id, 28, 'Sparks given to a person who never logged');
  if (P.id === 'binge-logger' && peakDay > M.DAILY_CAP) note(P.id, 28, 'binge day beat the cap');
  if (P.id === 'ai-hammer' && aiUsed > AI_CAP_PER_DAY * DAYS) note(P.id, 28, 'AI budget exceeded');
  if (!weekDotsOk) note(P.id, 28, 'week dots were not 7 long');
  rows.push({ persona: P.id, days_logged: logged.length, sparks: total, level: lv.name, peak_day_sparks: peakDay, ai_lookups: aiUsed, energy_notes: obs.length });
}
const report = { when: new Date().toISOString(), days: DAYS, ai_cap_per_person_per_day: AI_CAP_PER_DAY, ai_lookups_total: totalAI, ai_lookups_blocked_by_cap: blockedAI, sentences_scanned: texts, personas: rows, issues, pass: issues.length === 0 };
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'persona-sim.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2)); process.exit(report.pass ? 0 : 1);
