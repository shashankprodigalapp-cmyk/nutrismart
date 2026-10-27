import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { requireRole } from '../_shared/roles';

// GET /api/admin-v2-analytics?days=30 -> 2.0 adoption, coach funnel, review outcomes, cohorts (admins only).
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const days = Math.max(1, Math.min(180, Number(new URL(request.url).searchParams.get('days')) || 30));
  const { data, error } = await getSupabaseAdmin(env).rpc('admin_v2_analytics', { p_days: days });
  if (error || !data) return jsonResponse(env, 500, { error: 'analytics_unavailable', message: 'The 2.0 analytics are not installed yet. Run migration 035 in Supabase, then refresh.' });
  return jsonResponse(env, 200, { analytics: data });
};
