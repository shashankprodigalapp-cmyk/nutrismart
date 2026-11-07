import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { flagOn, throttle } from '../_shared/roles';
import { istDay } from '../../src/lib/intel/dates';
import { DAILY_CAP, levelFor, planAwards, quests, type Facts } from '../../src/lib/sparks';

// POST /api/progress  (signed-in user; switch ui_sparks)
// Works out today's Sparks from the person's OWN saved logs and returns their total, level and quests.
// The request body is ignored on purpose: the app can never claim points, the server decides from the logs.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST' && request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  const slow = await throttle(env, auth.userId, 'progress', 3600, 120);
  if (slow) return slow;
  if (!(await flagOn(env, 'ui_sparks'))) return jsonResponse(env, 404, { error: 'off' });

  const admin = getSupabaseAdmin(env);
  const day = istDay(new Date());
  const [logs, water, today] = await Promise.all([
    admin.from('daily_logs').select('meal').eq('user_id', auth.userId).eq('log_date', day),
    admin.from('water_logs').select('glasses').eq('user_id', auth.userId).eq('log_date', day).maybeSingle(),
    admin.from('sparks_ledger').select('kind, ref, points').eq('user_id', auth.userId).eq('day', day),
  ]);
  if (logs.error || today.error) return jsonResponse(env, 500, { error: 'load_failed' });
  const facts: Facts = {
    meals: [...new Set((logs.data ?? []).map(r => String(r.meal)))],
    glasses: Number(water.data?.glasses ?? 0),
  };
  const owed = planAwards(facts, today.data ?? []);
  if (owed.length) {
    const { error } = await admin.from('sparks_ledger').upsert(
      owed.map(a => ({ user_id: auth.userId, day, kind: a.kind, ref: a.ref, points: a.points })),
      { onConflict: 'user_id,day,kind,ref', ignoreDuplicates: true },
    );
    if (error) return jsonResponse(env, 500, { error: 'save_failed' });
  }
  const all = await admin.from('sparks_ledger').select('day, points').eq('user_id', auth.userId);
  if (all.error) return jsonResponse(env, 500, { error: 'load_failed' });
  const total = (all.data ?? []).reduce((s, r) => s + Number(r.points), 0);
  const todayPts = (all.data ?? []).filter(r => r.day === day).reduce((s, r) => s + Number(r.points), 0);
  return jsonResponse(env, 200, { total, today: todayPts, cap: DAILY_CAP, level: levelFor(total), quests: quests(facts) });
};
