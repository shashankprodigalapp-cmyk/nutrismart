import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { requireRole } from '../_shared/roles';

// GET /api/plans -> {plans: active client plans, mine: {plan, name, entitlements}}. Signed-in users only.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'client');
  if ('error' in who) return who.error;
  const admin = getSupabaseAdmin(env);
  const [{ data: plans }, { data: mine }] = await Promise.all([
    admin.from('plans').select('key, name, description, price_inr_month, price_inr_year, entitlements').eq('audience', 'client').eq('is_active', true).order('sort_order'),
    admin.rpc('entitlements_for', { p_user: who.userId }),
  ]);
  return jsonResponse(env, 200, { plans: plans ?? [], mine: mine ?? null });
};
