import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle, flagOn } from '../_shared/roles';
import { loadSnapshot, think } from '../_shared/intelServer';
import { dailyReport, weeklyReport, monthlyReport, personalLearning, type RecRecord, type Report } from '../../src/lib/intel/reports';
import { addDays, weekStart, monthStart } from '../../src/lib/intel/dates';

// POST /api/intel-report {period: 'daily'|'weekly'|'monthly'|'learning'}  (own report only)
// Built from stored numbers. The report is saved once per period and regenerated on request.
const FLAG: Record<string, string> = { daily: 'analytics_engine', weekly: 'weekly_reports', monthly: 'monthly_reports', learning: 'personal_model' };
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  const slow = await throttle(env, auth.userId, 'intel_report', 3600, 30);
  if (slow) return slow;
  let b: { period?: string } = {};
  try { b = await request.json(); } catch { /* default */ }
  const period = String(b.period ?? 'weekly');
  if (!FLAG[period]) return jsonResponse(env, 400, { error: 'bad_period' });
  if (!(await flagOn(env, FLAG[period]))) return jsonResponse(env, 403, { error: 'off', message: 'This report is not switched on yet.' });

  const admin = getSupabaseAdmin(env);
  const now = new Date();
  const snap = await loadSnapshot(admin, auth.userId, now);
  const brief = think(snap, now, { adaptive: false, energy: await flagOn(env, 'energy_intelligence') });
  const { data: rr } = await admin.from('recommendations').select('rec_type, rec_key, status, action, outcome, window_day').eq('user_id', auth.userId).gte('window_day', addDays(snap.today, -35)).limit(300);
  const recs: RecRecord[] = (rr ?? []).map((r: any) => ({ rec_type: r.rec_type, rec_key: r.rec_key, status: r.status, action: r.action, outcome: r.outcome, created_day: String(r.window_day) }));
  const obs = brief.observations.map(o => o.text);

  let report: Report, periodStart: string;
  if (period === 'daily') { periodStart = snap.today; report = dailyReport({ today: snap.today, features: snap.index, topAction: brief.recommendations[0]?.action, smartMealText: brief.smartMeal ? `${brief.smartMeal.meal}: ${brief.smartMeal.items.map(i => i.name).join(' with ')}` : undefined }); }
  else if (period === 'weekly') { periodStart = weekStart(addDays(snap.today, snap.today === weekStart(snap.today) ? -7 : 0)); report = weeklyReport({ weekStart: periodStart, rows: snap.rows, features: snap.index, targets: snap.targets, recs, observations: obs }); }
  else if (period === 'monthly') {
    periodStart = monthStart(snap.today);
    const { data: ms } = await admin.from('intel_messages').select('sender_type, sent_at, outcome').eq('user_id', auth.userId).eq('status', 'sent').gte('sent_at', periodStart).limit(300);
    report = monthlyReport({ monthStart: periodStart, monthEnd: snap.today, features: snap.index, recs, messages: (ms ?? []).map((m: any) => ({ sender_type: m.sender_type, sent_day: String(m.sent_at).slice(0, 10), outcome: m.outcome })), targets: snap.targets, rows: snap.rows });
  } else { periodStart = snap.today; report = personalLearning({ today: snap.today, features: snap.index, meals: snap.meals, recs, observations: obs }); }

  await admin.from('intel_reports').upsert({ user_id: auth.userId, period, period_start: periodStart, payload: report, generated_at: now.toISOString() }, { onConflict: 'user_id,period,period_start' });
  return jsonResponse(env, 200, { ok: true, report });
};
