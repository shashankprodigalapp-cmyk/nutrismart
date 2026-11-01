import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle, flagOn } from '../_shared/roles';
import { loadSnapshot, think, persist } from '../_shared/intelServer';
import { todaySignal } from '../../src/lib/intel/signal';
import { personalLearning } from '../../src/lib/intel/reports';

// POST /api/intel-refresh  (signed-in person, for themselves only)
// Recomputes the person's features, makes today's recommendations, and returns what the new Today screen shows.
// Needs the analytics_engine switch. Recommendations are saved only with the recommendations switch.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  const slow = await throttle(env, auth.userId, 'intel_refresh', 3600, 40);
  if (slow) return slow;
  if (!(await flagOn(env, 'analytics_engine'))) return jsonResponse(env, 403, { error: 'off', message: 'This is not switched on yet.' });

  const admin = getSupabaseAdmin(env);
  const now = new Date();
  const [recsOn, adaptive, energy, model] = await Promise.all([flagOn(env, 'recommendations'), flagOn(env, 'adaptive_meal_plan'), flagOn(env, 'energy_intelligence'), flagOn(env, 'personal_model')]);
  const snap = await loadSnapshot(admin, auth.userId, now);
  const brief = think(snap, now, { adaptive, energy });
  const saved = await persist(admin, auth.userId, snap, brief, recsOn);

  const hour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
  const top = recsOn ? (saved[0] ?? null) : null;
  const signal = todaySignal({ hour, targets: snap.targets, totals: { calories: snap.todayTotals.calories, protein: snap.todayTotals.protein, meals: snap.todayTotals.meals.length }, flexReservedCal: snap.flexReservedCal, topReason: top?.reason, streak: snap.streak });
  let learned: string | null = null;
  if (model) {
    const lines = personalLearning({ today: snap.today, features: snap.index, meals: snap.meals, recs: [], observations: brief.observations.map(o => o.text) }).sections[0].lines;
    learned = lines.find(l => l !== 'Not enough data yet.') ?? null;
  }
  return jsonResponse(env, 200, {
    ok: true, today: snap.today, signal,
    progress: { calories: Math.round(snap.todayTotals.calories), protein: Math.round(snap.todayTotals.protein), target_cal: snap.targets.cal, target_protein: snap.targets.protein },
    learned, recommendations: saved.slice(0, 2), smart_meal: adaptive ? brief.smartMeal : null, observations: energy ? brief.observations : [],
  });
};
