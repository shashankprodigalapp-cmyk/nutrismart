// Runs the app's own TypeScript rules (coach status, needs-attention, nudges) against the simulated people.
// Needs the scratch database from scripts/db-test.sh style setup with supabase/sim/01_seed_100.sql loaded.
// Usage: PGHOST=... PGPORT=... PGUSER=postgres PGDATABASE=t node scripts/sim/ts-checks.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let esbuild;
for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild']) { try { esbuild = require(p); break; } catch { /* next */ } }
if (!esbuild) { console.error('esbuild not found'); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), 'simts-'));
const entry = join(dir, 'e.ts');
writeFileSync(entry, `export * from '${process.cwd()}/src/lib/coachMetrics'; export * from '${process.cwd()}/src/lib/attention'; export * from '${process.cwd()}/functions/_shared/nudgeRules';`);
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: join(dir, 'o.mjs'), logLevel: 'silent' });
const M = await import(pathToFileURL(join(dir, 'o.mjs')).href);
const sql = (q) => execFileSync('psql', ['-d', process.env.PGDATABASE || 't', '-Atc', q], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

const results = []; const check = (name, ok, detail = '') => results.push({ name, ok, detail });
const coaches = sql(`select id||'|'||email from auth.users where email like 'coach_@sim.nutrismart.invalid' and exists(select 1 from coach_profiles c where c.user_id=auth.users.id and c.status='active') order by email`).split('\n').filter(Boolean);
check('three active sim coaches found', coaches.length === 3, String(coaches.length));
const now = new Date();
let all = [];
for (const c of coaches) {
  const [id] = c.split('|');
  const json = sql(`begin; select set_config('request.jwt.claim.sub','${id}',true); select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select d.*, u.name as uname from coach_dashboard(7) d join users u on u.id=d.client_id) t; rollback;`).split('\n').find(l => l.startsWith('['));
  for (const r of JSON.parse(json)) all.push({ coach: id, ...r });
}
check('coaches see 32 clients (33 linked, 1 ended is hidden)', all.length === 32, String(all.length));
const arch = (r) => String(r.uname).replace(/^Sim \d+ /, '');
const num = (r) => Number(String(r.uname).match(/^Sim (\d+)/)?.[1]);
const scored = all.map(r => {
  const m = { share_scope: r.share_scope, link_status: r.link_status, days_in_window: r.days_in_window, days_eligible: r.days_eligible, days_logged: r.days_logged,
    avg_cal: r.avg_cal == null ? null : Number(r.avg_cal), avg_protein: r.avg_protein == null ? null : Number(r.avg_protein),
    target_cal: r.target_cal, target_protein: r.target_protein, energy_checkins: r.energy_checkins,
    energy_avg: r.energy_avg == null ? null : Number(r.energy_avg), energy_prev_avg: r.energy_prev_avg == null ? null : Number(r.energy_prev_avg), last_activity: r.last_activity };
  return { r, a: arch(r), n: num(r), ...M.classify(m, now) };
});
const by = {};
for (const s of scored) (by[s.a] ??= []).push(s);
const sig = (s) => s.reasons.map(x => x.signal);
const dist = Object.entries(by).map(([k, v]) => `${k}: ${v.map(s => s.status).join(',')}`);
console.log(dist.join('\n'));

for (const s of by['new_today'] ?? []) check(`new_today #${s.n} is not flagged for logging days`, !sig(s).includes('logging_decline'), sig(s).join('+') + ' eligible ' + s.r.days_eligible);
const foodShared = (s) => !!s.r.share_scope?.food && s.r.link_status === 'active';
for (const s of by['silent'] ?? []) if (foodShared(s)) check(`silent #${s.n} is flagged (no_activity/attention)`, ['no_activity', 'attention'].includes(s.status), s.status);
for (const s of by['sparse'] ?? []) if (foodShared(s)) check(`sparse #${s.n} flagged for logging`, sig(s).includes('logging_decline') || s.status === 'no_activity', sig(s).join('+'));
for (const s of by['over_eater'] ?? []) if (foodShared(s)) check(`over_eater #${s.n} flagged for calories`, sig(s).includes('calorie_deviation'), sig(s).join('+') + ' ' + s.r.avg_cal + '/' + s.r.target_cal);
for (const s of by['low_protein_under'] ?? []) if (foodShared(s)) check(`low_protein #${s.n} flagged for protein`, sig(s).includes('protein_deviation'), sig(s).join('+'));
for (const s of by['energy_dropper'] ?? []) if (s.r.share_scope?.energy && s.r.link_status === 'active') check(`energy_dropper #${s.n} flagged for energy`, sig(s).includes('energy_decline'), sig(s).join('+'));
for (const s of by['steady'] ?? []) if (foodShared(s)) check(`steady #${s.n} is not attention`, s.status !== 'attention', s.status + ' ' + sig(s).join('+'));
for (const s of scored) if (s.r.link_status === 'paused') check(`paused #${s.n} has paused status`, s.status === 'paused');

// Needs attention list
const att = M.buildAttention(scored.map(s => ({ client_id: s.r.client_id, client_name: s.r.uname, status: s.status, reasons: s.reasons, last_activity: s.r.last_activity })), [], now);
check('attention list is sorted high to low', att.every((x, i) => i === 0 || att[i - 1].priority >= x.priority));
check('attention list holds only flagged people', att.every(x => x.reasons.length > 0));
const okNames = new Set(scored.filter(s => s.status === 'on_track').map(s => s.r.client_id));
check('no on-track person appears in attention list', att.every(x => !okNames.has(x.client_id)));
if (att.length) {
  const first = att[0]; const act = [{ client_id: first.client_id, signal: first.reasons[0].signal, action: 'snoozed', severity: first.reasons[0].severity, until_at: new Date(now.getTime() + 86400000).toISOString() }];
  const att2 = M.buildAttention(scored.map(s => ({ client_id: s.r.client_id, client_name: s.r.uname, status: s.status, reasons: s.reasons, last_activity: s.r.last_activity })), act, now);
  const still = att2.find(x => x.client_id === first.client_id);
  check('snoozing a signal hides it', !still || !still.reasons.some(r => r.signal === act[0].signal));
}

// Nudges
const prefs = { log_reminders: true, coach_nudges: true, max_per_day: 2, quiet_start: 22 * 60, quiet_end: 7 * 60 };
const noon = new Date('2026-10-30T07:00:00Z'); // 12:30 IST
const night = new Date('2026-10-30T18:00:00Z'); // 23:30 IST
check('nudge allowed at midday', M.decideNudge({ kind: 'coach_message', now: noon, prefs, sentToday: 0, lastSentAt: null, hasDevice: true }).ok === true);
check('nudge held in quiet hours', M.decideNudge({ kind: 'coach_message', now: night, prefs, sentToday: 0, lastSentAt: null, hasDevice: true }).reason === 'quiet_hours');
check('nudge stops at daily cap', M.decideNudge({ kind: 'coach_message', now: noon, prefs, sentToday: 2, lastSentAt: null, hasDevice: true }).reason === 'daily_cap');
check('nudge needs a device', M.decideNudge({ kind: 'coach_message', now: noon, prefs, sentToday: 0, lastSentAt: null, hasDevice: false }).reason === 'no_device');
check('muted reminders respected', M.decideNudge({ kind: 'log_reminder', now: noon, prefs: { ...prefs, log_reminders: false }, sentToday: 0, lastSentAt: null, hasDevice: true }).reason === 'muted');
check('coach nudge text rejects links', M.cleanNudgeText('see www.x.com').ok === false);
// Evening reminder using real sim data: people with reminders, who logged >=3 days of last 7
const rem = sql(`select count(*) from nudge_preferences where log_reminders`).split('\n')[0];
check('sim has people with reminders on', Number(rem) > 0, rem);

const fails = results.filter(r => !r.ok);
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.ok ? '' : '  -> ' + r.detail));
console.log(`\n${results.length - fails.length}/${results.length} TypeScript-level checks passed`);
process.exit(fails.length ? 1 : 0);
