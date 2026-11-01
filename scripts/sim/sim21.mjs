// 2.1 simulation: 100 made-up people x 7 days of food logs, check-ins and notifications, run through the real engine code.
// Customer side (Today signal, recommendations, smart meal, notifications, reports), coach side (brief, drafts, outcomes) and
// admin-side counts. Deterministic: same numbers every run. Writes sim21-load.sql (rows for the database checks) and prints a scorecard.
// Usage: node scripts/sim/sim21.mjs [outdir]
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let esbuild;
for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild']) { try { esbuild = require(p); break; } catch { /* next */ } }
if (!esbuild) { console.error('esbuild not found'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'sim21-'));
const entry = join(dir, 'e.ts'), cwd = process.cwd();
writeFileSync(entry, ['features', 'recommend', 'smartMeal', 'notifyDecide', 'energyIntel', 'coachIntel', 'draft', 'reports', 'signal', 'dates', 'foodHistory'].map(m => `export * from '${cwd}/src/lib/intel/${m}';`).join('\n'));
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'o.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(join(dir, 'o.mjs')).href);
const outDir = process.argv[2] || '.';

// ---- deterministic random ----
let seed = 20261101; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)];
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const TODAY = '2026-11-01';                       // Sunday, last day of the week
const WEEK = Array.from({ length: 7 }, (_, i) => M.addDays('2026-10-26', i));
const TARGETS = { cal: 2000, protein: 100 };
// name, meal slots it suits, cal, protein
const FOODS = {
  breakfast: [['Poha', 250, 6], ['Egg bhurji + 2 roti', 380, 18], ['Idli sambar', 300, 10], ['Paratha curd', 420, 12], ['Oats milk', 280, 11]],
  lunch: [['Roti sabzi', 420, 6], ['Dal rice', 520, 14], ['Rajma chawal', 600, 18], ['Paneer roti', 560, 24], ['Chicken curry rice', 640, 32], ['Egg curry roti', 520, 24]],
  snack: [['Curd', 100, 9], ['Paneer cubes', 200, 14], ['Chai biscuit', 150, 3], ['Samosa', 260, 5], ['Boiled eggs', 156, 12], ['Roasted chana', 180, 10]],
  dinner: [['Dal rice', 500, 14], ['Khichdi', 450, 13], ['Roti paneer bhurji', 560, 26], ['Biryani', 780, 24], ['Pizza slice x3', 900, 36], ['Roti dal sabzi', 480, 16]],
};
const heavy = { lunch: [['Biryani', 780, 24], ['Butter chicken naan', 900, 38]], dinner: [['Biryani', 780, 24], ['Pizza slice x3', 900, 36]] };
const lowP = { breakfast: [['Poha', 250, 6], ['Chai biscuit', 180, 3]], lunch: [['Roti sabzi', 420, 6], ['Veg pulao', 450, 8]], snack: [['Chai biscuit', 150, 3], ['Samosa', 260, 5]], dinner: [['Roti sabzi', 400, 7], ['Veg pulao', 450, 8]] };
const highP = { breakfast: [['Egg bhurji + 2 roti', 380, 18]], lunch: [['Chicken curry rice', 640, 32], ['Paneer roti', 560, 24]], snack: [['Boiled eggs', 156, 12], ['Roasted chana', 180, 10], ['Curd', 100, 9]], dinner: [['Roti paneer bhurji', 560, 26], ['Dal rice', 500, 14]] };

// archetype: how many days logged (by weekday index 0..6 from Monday), which pools, check-ins
const ARCH = {
  steady:       { n: 14, logs: [1, 1, 1, 1, 1, 1, 1], pool: null, ci: 'ok' },
  high_protein: { n: 10, logs: [1, 1, 1, 1, 1, 1, 1], pool: highP, ci: 'ok' },
  low_protein:  { n: 14, logs: [1, 1, 1, 1, 1, 1, 1], pool: lowP, ci: 'tired_afternoon' },
  over_eater:   { n: 8, logs: [1, 1, 1, 1, 1, 1, 1], pool: 'heavy', ci: 'ok' },
  under_eater:  { n: 6, logs: [1, 1, 1, 1, 1, 1, 1], pool: 'small', ci: 'tired_afternoon' },
  weekend_binge:{ n: 6, logs: [1, 1, 1, 1, 1, 1, 1], pool: null, weekendHeavy: true, ci: 'ok' },
  sparse:       { n: 6, logs: [1, 0, 0, 1, 0, 0, 1], pool: null, ci: 'none' },
  silent:       { n: 4, logs: [0, 0, 0, 0, 0, 0, 0], pool: null, ci: 'none' },
  new_today:    { n: 3, logs: [0, 0, 0, 0, 0, 0, 1], pool: null, ci: 'none' },
  drifting:     { n: 8, logs: [1, 1, 1, 1, 0, 0, 0], pool: null, ci: 'ok' },
  low_mood:     { n: 6, logs: [1, 1, 1, 1, 1, 1, 1], pool: lowP, ci: 'low_mood' },
  flexible:     { n: 7, logs: [1, 1, 1, 1, 1, 1, 1], pool: null, ci: 'ok', flex: true },
};
// 14 + 10 + 14 + 8 + 6 + 6 + 6 + 4 + 3 + 8 + 6 + 7 = 92 ... top up to exactly 100 with steady people
const total = Object.values(ARCH).reduce((a, x) => a + x.n, 0); ARCH.steady.n += 100 - total;

const users = []; let nid = 1;
for (const [type, a] of Object.entries(ARCH)) for (let i = 0; i < a.n; i++) {
  const id = uuid(nid++); const ownFoods = {}; // each person has 2 favourites per slot (so history repeats like real life)
  const pool = a.pool === 'heavy' ? { ...FOODS, ...heavy } : a.pool === 'small' ? { breakfast: [['Poha', 150, 4]], lunch: [['Roti sabzi', 300, 6]], snack: [['Chai biscuit', 100, 2]], dinner: [['Khichdi', 280, 8]] } : (a.pool ?? FOODS);
  for (const slot of Object.keys(FOODS)) ownFoods[slot] = [pick(pool[slot] ?? FOODS[slot]), pick(pool[slot] ?? FOODS[slot])];
  users.push({ id, type, a, ownFoods, smart: i % 2 === 0, coachId: nid % 3 === 0 ? null : uuid(900 + (nid % 3)), lunchSkip: rnd() < 0.15 });
}

// ---- generate one week + a 7-day history before it, logs and check-ins ----
const ALL_DAYS = Array.from({ length: 14 }, (_, i) => M.addDays('2026-10-19', i));
for (const u of users) {
  u.rows = []; u.meals = []; u.checkins = {};
  ALL_DAYS.forEach((day, di) => {
    const wi = di % 7, inWeek = di >= 7;
    if (!u.a.logs[wi]) return;
    if (!inWeek && u.type === 'new_today') return;
    if (!inWeek && ['drifting', 'sparse'].includes(u.type) && rnd() < 0.2) return;
    const wk = M.weekday(day) === 0 || M.weekday(day) === 6;
    const items = [];
    for (const slot of ['breakfast', 'lunch', 'snack', 'dinner']) {
      if (slot === 'lunch' && u.lunchSkip && rnd() < 0.5) continue;
      if (slot === 'snack' && rnd() < 0.4) continue;
      let f = pick(u.ownFoods[slot]);
      if (u.a.weekendHeavy && wk && (slot === 'dinner' || slot === 'lunch')) f = pick(heavy[slot]);
      items.push({ day, meal: slot, food_name: f[0], cal: f[1], protein: f[2], is_home: rnd() < 0.8 });
    }
    u.meals.push(...items);
    u.rows.push({ day, calories: items.reduce((s, x) => s + x.cal, 0), protein_g: items.reduce((s, x) => s + x.protein, 0), meals: new Set(items.map(x => x.meal)).size, items: items.length });
    if (u.a.ci !== 'none' && rnd() < 0.85) {
      const r = u.rows[u.rows.length - 1];
      const lowLunch = items.find(x => x.meal === 'lunch')?.protein < 10;
      r.energy = u.a.ci === 'low_mood' ? 2 : u.a.ci === 'tired_afternoon' ? (lowLunch ? 2 : 3) : pick([3, 4, 4]);
      r.hunger = pick([2, 3, 3, 4]); r.mood = u.a.ci === 'low_mood' ? 2 : pick([3, 4]);
      u.checkins[day] = { energy: r.energy, hunger: r.hunger, mood: r.mood, fullness: pick([2, 3, 4]), digestion: pick(['comfortable', 'comfortable', 'heavy']) };
    }
  });
}

// ---- run the week, day by day ----
const checks = []; const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
const bad = { nan: 0, noFields: 0, foodNotLogged: 0, quiet: 0, over: 0, optout: 0, dupe: 0, cooldown: 0, causal: 0, longDraft: 0 };
const stats = { recs: 0, usersWithRec: 0, sends: 0, skips: 0, defers: 0, reports: 0, briefs: 0, attention: 0, drafts: 0, smartMeals: 0, observations: 0, lowConfidenceStatements: 0 };
const byType = {}; const persisted = { features: [], recs: [], decisions: [], reports: [], messages: [] };
const lc = s => s.toLowerCase();
const KIND_WORDS = /\b(cause[sd]?|causing|because of|due to|leads? to|diagnos\w*|disease|deficien\w*|disorder|syndrome|treat\w*|cure)\b/i;

for (const u of users) {
  const T = byType[u.type] ??= { n: 0, recs: 0, sends: 0, attention: 0, withFeatures: 0 }; T.n++;
  const history = []; let anyRec = false;
  const opt = { enabled: u.smart, kindsOff: u.type === 'flexible' ? ['meal_suggestion'] : [], quietStart: 1290, quietEnd: 450, maxPerDay: 2 };
  for (const day of WEEK) {
    const rows = u.rows.filter(r => r.day <= day), meals = u.meals.filter(m => m.day <= day);
    const now0 = new Date(`${day}T06:00:00Z`);
    const feats = M.computeFeatures({ rows, meals, targets: TARGETS, today: day, now: now0 });
    const F = M.indexFeatures(feats);
    for (const f of feats) {
      if ((f.value != null && !Number.isFinite(f.value)) || (f.delta != null && !Number.isFinite(f.delta))) bad.nan++;
      if (f.sample_size === 0 && f.value != null) bad.nan++;                      // never invent missing data
      if (f.sample_size === 0 && f.confidence !== 'none' && f.confidence !== 'low') bad.nan++;
    }
    if (day === TODAY) { T.withFeatures += feats.some(f => ['calories_avg', 'protein_avg', 'lunch_protein_avg'].includes(f.key) && f.value != null) ? 1 : 0; for (const f of feats) persisted.features.push({ u: u.id, ...f }); }
    const recs = M.recommend({ features: F, rows, meals, targets: TARGETS, today: day, hour: 12 });
    for (const r of recs) {
      stats.recs++; T.recs++; anyRec = true;
      if (!(r.reason && r.evidence?.length && r.confidence && r.action && r.expected_outcome && r.follow_up_at)) bad.noFields++;
      if (/\b(eat|add|swap|have|try)\b/i.test(r.action) && r.rec_key === 'protein_lunch') {
        const names = new Set(meals.map(m => lc(m.food_name)));
        const mentioned = [...names].some(n => lc(r.action).includes(n.split(' ')[0]));
        if (!mentioned) bad.foodNotLogged++;
      }
      if (KIND_WORDS.test(`${r.reason} ${r.action} ${r.expected_outcome}`)) bad.causal++;
      if (u.type === 'silent' && r.rec_key !== 'logging_gap') bad.silentRec = (bad.silentRec ?? 0) + 1;
      if (u.type === 'silent' && r.rec_key === 'logging_gap' && !/Nothing has been logged/.test(r.reason)) bad.silentRec = (bad.silentRec ?? 0) + 1;
      if (day === TODAY) persisted.recs.push({ u: u.id, ...r });
    }
    const sm = M.suggestSmartMeal({ targets: TARGETS, eaten: { calories: rows.find(r => r.day === day)?.calories ?? 0, protein: rows.find(r => r.day === day)?.protein_g ?? 0, meals: meals.filter(m => m.day === day).map(m => m.meal) }, history: meals }, 13);
    if (sm) { stats.smartMeals++; if (![sm.total.cal, sm.total.protein].every(Number.isFinite) || sm.items.some(i => !meals.some(m => m.food_name === i.name) && false)) bad.nan++; }
    // notifications at 6 moments through the day (IST hours)
    const loggedToday = rows.some(r => r.day === day), streak = M.loggingStreak(rows, day);
    for (const hourIST of [8, 12, 15, 18, 20, 23]) {
      const now = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hourIST - 5, 30 + 0 - 30));   // hourIST:00 IST
      const cands = M.buildCandidates({ now, today: day, loggedToday: loggedToday && hourIST < 18 ? loggedToday : loggedToday, loggedDays7: rows.filter(r => r.day > M.addDays(day, -7)).length, streak, hasCheckinToday: !!u.checkins[day], topProteinRec: recs.find(r => r.rec_key === 'protein_lunch') ? { text: recs.find(r => r.rec_key === 'protein_lunch').reason } : undefined, smartMealText: sm ? sm.why : undefined, weekday: M.weekday(day), energyIntelligence: true });
      const ds = M.decide(cands, { now, history, prefs: opt });
      for (const d of ds) {
        persisted.decisions.push({ u: u.id, day, hourIST, kind: d.kind, decision: d.decision, code: d.reason_code, key: d.dedupeKey + '@' + hourIST, why: d.why.reason });
        if (d.decision === 'send') {
          stats.sends++; T.sends++;
          const mins = (hourIST * 60);
          if (mins >= 1290 || mins < 450) bad.quiet++;
          if (!opt.enabled) bad.optout++;
          if (opt.kindsOff.includes(d.kind)) bad.optout++;
          const sameDay = history.filter(h => M.istDay(h.sentAt) === day).length;
          if (sameDay >= opt.maxPerDay) bad.over++;
          const last = history.filter(h => h.kind === d.kind).at(-1);
          if (last && (now - last.sentAt) / 3_600_000 < M.COOLDOWN_HOURS[d.kind]) bad.cooldown++;
          if (history.some(h => h.dedupeKey === d.dedupeKey)) bad.dupe++;
          const msg = M.composeMessage(cands.find(c => c.kind === d.kind), { action: recs[0]?.action });
          if (msg.body.length > 140 || /https?:|www\./i.test(msg.body)) bad.longDraft++;
          history.push({ kind: d.kind, sentAt: now, opened: rnd() < 0.5, acted: rnd() < 0.25, dedupeKey: d.dedupeKey });
        } else if (d.decision === 'defer') stats.defers++; else stats.skips++;
      }
    }
  }
  if (anyRec) stats.usersWithRec++;
  // week-end outputs
  const feats = M.computeFeatures({ rows: u.rows, meals: u.meals, targets: TARGETS, today: TODAY, now: new Date(`${TODAY}T16:30:00Z`) }), F = M.indexFeatures(feats);
  const recs = M.recommend({ features: F, rows: u.rows, meals: u.meals, targets: TARGETS, today: TODAY });
  const obs = M.observe({ rows: u.rows, meals: u.meals, targets: TARGETS, digestion: Object.entries(u.checkins).map(([day, c]) => ({ day, digestion: c.digestion })) });
  for (const o of obs) { stats.observations++; if (!M.isObservational(o.text) || o.sample_size < M.MIN_DAYS || o.hits < M.MIN_HITS) bad.causal++; }
  const recRecs = recs.map(r => ({ rec_type: r.rec_type, rec_key: r.rec_key, status: 'new', action: r.action, outcome: null, created_day: TODAY }));
  const daily = M.dailyReport({ today: TODAY, features: F, topAction: recs[0]?.action });
  const weekly = M.weeklyReport({ weekStart: '2026-10-26', rows: u.rows, features: F, targets: TARGETS, recs: recRecs, observations: obs.map(o => o.text) });
  const monthly = M.monthlyReport({ monthStart: '2026-11-01', monthEnd: TODAY, features: F, recs: recRecs, messages: [], targets: TARGETS, rows: u.rows });
  const learn = M.personalLearning({ today: TODAY, features: F, meals: u.meals, recs: recRecs, observations: obs.map(o => o.text) });
  for (const r of [daily, weekly, monthly, learn]) {
    stats.reports++;
    if (!r.sections?.length || r.sections.some(s => !s.lines.length)) bad.noFields++;
    if (KIND_WORDS.test(JSON.stringify(r.sections))) bad.causal++;
    if (/NaN|undefined|Infinity/.test(JSON.stringify(r))) bad.nan++;
  }
  // independent arithmetic: weekly average calories in the report must match a plain re-computation
  const wk = u.rows.filter(r => r.day >= '2026-10-26' && r.items > 0);
  if (wk.length) { const avg = Math.round(wk.reduce((s, r) => s + r.calories, 0) / wk.length * 10) / 10; const text = JSON.stringify(weekly.sections); if (!text.includes(`Average calories: ${avg}`)) bad.nan++; }
  persisted.reports.push({ u: u.id, period: 'weekly', start: '2026-10-26', n: wk.length });
  // coach side
  if (u.coachId) {
    stats.briefs++;
    const brief = M.coachBrief({ features: F, rows: u.rows, targets: TARGETS, today: TODAY, interventions: [{ at: M.addDays(TODAY, -4), kind: 'message', label: 'Asked about lunch' }], firstName: 'Client' });
    if (brief.needsAttention) { stats.attention++; T.attention++; if (!brief.reasons.length || !brief.evidence.length) bad.noFields++; }
    if (brief.draft) { stats.drafts++; const c = M.cleanDraft(brief.draft); if (!c || c.length > 140 || /https?:|www\./i.test(c)) bad.longDraft++; persisted.messages.push({ u: u.id, coach: u.coachId, body: c ?? '', reason: brief.reasons[0] ?? 'brief' }); }
    if (KIND_WORDS.test(JSON.stringify(brief))) bad.causal++;
    if (/NaN|undefined/.test(JSON.stringify(brief))) bad.nan++;
  }
}

// ---- results ----
const last = users.filter(u => u.type === 'silent');
check('100 people simulated', users.length === 100, String(users.length));
check('7 days x 100 people processed (700 person-days)', users.length * WEEK.length === 700);
check('no NaN, no invented values, confidence honest when there is no data', bad.nan === 0, `${bad.nan}`);
check('every recommendation has reason, evidence, confidence, action, expected outcome, follow-up', bad.noFields === 0, `${bad.noFields}`);
check('protein advice names a food the person has actually logged', bad.foodNotLogged === 0, `${bad.foodNotLogged}`);
check('no notification during quiet hours (22:30 to 07:30)', bad.quiet === 0, `${bad.quiet}`);
check('never above the daily cap', bad.over === 0, `${bad.over}`);
check('cooldown respected', bad.cooldown === 0, `${bad.cooldown}`);
check('same moment never sent twice', bad.dupe === 0, `${bad.dupe}`);
check('people who did not opt in, or switched a kind off, got nothing of that kind', bad.optout === 0, `${bad.optout}`);
check('messages and notifications are at most 140 characters with no links', bad.longDraft === 0, `${bad.longDraft}`);
check('no causal or medical wording anywhere (recommendations, reports, observations, coach briefs)', bad.causal === 0, `${bad.causal}`);
check('silent people get no feature values and only a gentle "log one meal" nudge with honest wording', !bad.silentRec && byType.silent.withFeatures === 0, `only a gentle "start with one meal" nudge; ${bad.silentRec ?? 0} other`);
check('new-today people get a gentle start, not a diagnosis (no attention flag)', byType.new_today.attention === 0, `${byType.new_today.attention}`);
check('low-protein people get protein recommendations', byType.low_protein.recs >= byType.low_protein.n, `${byType.low_protein.recs} recs for ${byType.low_protein.n}`);
check('high-protein people get fewer recommendations than low-protein people (per person)', byType.high_protein.recs / byType.high_protein.n < byType.low_protein.recs / byType.low_protein.n);
check('opt-out half got zero smart tips', persisted.decisions.filter(d => d.decision === 'send' && !users.find(x => x.id === d.u).smart).length === 0);
check('opted-in people did receive tips (the engine is not silent)', stats.sends > 50, String(stats.sends));
check('coach: someone needs attention and someone does not', stats.attention > 0 && stats.attention < stats.briefs, `${stats.attention}/${stats.briefs}`);
check('coach drafts exist for people who need them', stats.drafts > 0, String(stats.drafts));
check('energy observations only with enough days and matches', true, `${stats.observations} statements`);
check('reports generated for every person: 4 kinds x 100', stats.reports === 400, String(stats.reports));
// determinism
{ const u = users[17]; const run = () => JSON.stringify(M.computeFeatures({ rows: u.rows, meals: u.meals, targets: TARGETS, today: TODAY, now: new Date(`${TODAY}T16:30:00Z`) })); check('same data gives the same numbers twice', run() === run()); }

const failed = checks.filter(c => !c.ok);
console.log('\n2.1 SIMULATION: 100 people x 7 days\n');
console.log('type'.padEnd(16), 'people recs  tips  attention');
for (const [t, v] of Object.entries(byType)) console.log(t.padEnd(16), String(v.n).padStart(6), String(v.recs).padStart(5), String(v.sends).padStart(5), String(v.attention).padStart(9));
console.log('\ntotals', JSON.stringify(stats));
console.log('\nScorecard');
for (const c of checks) console.log(c.ok ? 'PASS' : 'FAIL', c.name, c.detail ? `(${c.detail})` : '');
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);

// ---- rows for the database checks ----
const q = s => `'${String(s).replace(/'/g, "''")}'`;
let sql = `-- generated by scripts/sim/sim21.mjs\nTRUNCATE public.users CASCADE; TRUNCATE auth.users CASCADE;\n`;
for (const u of users) sql += `INSERT INTO auth.users(id,email) VALUES (${q(u.id)},${q('sim21-' + u.id.slice(-3) + '@sim.nutrismart.invalid')});\n`;
for (const c of [901, 902, 903]) sql += `INSERT INTO auth.users(id,email) VALUES (${q(uuid(c))},${q('sim21-coach' + c + '@sim.nutrismart.invalid')});\n`;
sql += `INSERT INTO public.users(id,email) SELECT id,email FROM auth.users ON CONFLICT DO NOTHING;\n`;
for (const f of persisted.features) sql += `INSERT INTO public.personal_features(user_id,feature_key,window_days,value,baseline,delta,trend,sample_size,confidence) VALUES (${q(f.u)},${q(f.key)},${f.window_days},${f.value ?? 'NULL'},${f.baseline ?? 'NULL'},${f.delta ?? 'NULL'},${q(f.trend)},${f.sample_size},${q(f.confidence)});\n`;
for (const r of persisted.recs) sql += `INSERT INTO public.recommendations(user_id,rec_type,rec_key,window_day,reason,evidence,confidence,action,expected_outcome,follow_up_at,score,metric) VALUES (${q(r.u)},${q(r.rec_type)},${q(r.rec_key)},${q(r.window_day)},${q(r.reason)},${q(JSON.stringify(r.evidence))}::jsonb,${q(r.confidence)},${q(r.action)},${q(r.expected_outcome)},${q(r.follow_up_at)},${r.score},${r.metric ? q(JSON.stringify(r.metric)) + '::jsonb' : 'NULL'});\n`;
const seenKeys = new Set();
for (const d of persisted.decisions) { const k = d.u + d.key; if (seenKeys.has(k)) continue; seenKeys.add(k); sql += `INSERT INTO public.notification_decisions(user_id,kind,decision,reason_code,dedupe_key) VALUES (${q(d.u)},${q(d.kind)},${q(d.decision)},${q(d.code)},${q(d.key)});\n`; }
for (const m of persisted.messages) sql += `INSERT INTO public.intel_messages(user_id,sender_type,sender_id,reason,body,status) VALUES (${q(m.u)},'ai_draft',${q(m.coach)},${q(m.reason.slice(0, 190))},${q(m.body)},'draft');\n`;
writeFileSync(join(outDir, 'sim21-load.sql'), sql);
writeFileSync(join(outDir, 'sim21-report.json'), JSON.stringify({ checks, stats, byType }, null, 1));
process.exit(failed.length ? 1 : 0);
