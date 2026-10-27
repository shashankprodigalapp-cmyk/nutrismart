import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, requireRole } from '../_shared/roles';
import { checkPlan, type PlanInput } from '../_shared/plans';

// GET  /api/admin-plans                 -> every plan, with how many people are on each
// POST /api/admin-plans {key, ...}      -> create or edit one plan (admins only, audited). Plans are never deleted: switch them off.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const admin = getSupabaseAdmin(env);
  if (request.method === 'POST') {
    let b: PlanInput;
    try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
    const c = checkPlan(b);
    if (!c.ok) return jsonResponse(env, 400, { error: 'bad_plan', message: c.message });
    const { data: before } = await admin.from('plans').select('*').eq('key', c.value.key).maybeSingle();
    if (before && before.audience !== c.value.audience) return jsonResponse(env, 400, { error: 'bad_plan', message: 'A plan cannot change audience.' });
    if (before && !c.value.is_active && ['free', 'pro', 'coach_standard'].includes(before.key)) return jsonResponse(env, 400, { error: 'bad_plan', message: 'The built-in plans cannot be switched off.' });
    const { error } = await admin.from('plans').upsert({ ...c.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) return jsonResponse(env, 500, { error: 'save_failed' });
    await audit(env, who.userId, 'admin', before ? 'plan_updated' : 'plan_created', null, { key: c.value.key, before: before ? { price: before.price_inr_month, entitlements: before.entitlements, active: before.is_active } : null, after: { price: c.value.price_inr_month, entitlements: c.value.entitlements, active: c.value.is_active } });
    return jsonResponse(env, 200, { ok: true });
  }
  const [{ data: plans }, { data: subs }, { data: coaches }] = await Promise.all([
    admin.from('plans').select('*').order('sort_order'),
    admin.from('subscriptions').select('plan, status').limit(20000),
    admin.from('coach_profiles').select('plan_key').limit(5000),
  ]);
  const paid = (subs ?? []).filter(s => s.status === 'active').length;
  const onCoach = new Map<string, number>();
  for (const c of coaches ?? []) onCoach.set(c.plan_key, (onCoach.get(c.plan_key) ?? 0) + 1);
  return jsonResponse(env, 200, { plans: (plans ?? []).map(p => ({ ...p, coaches_on_plan: onCoach.get(p.key) ?? 0 })), active_paid_subscriptions: paid });
};
