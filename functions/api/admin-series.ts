import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { requireRole } from '../_shared/roles';

// GET /api/admin-series?days=30 -> day-by-day counts for the admin charts (admins only). Counts only, no names.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const days = Math.max(7, Math.min(120, Number(new URL(request.url).searchParams.get('days')) || 30));
  const { data, error } = await getSupabaseAdmin(env).rpc('admin_daily_series', { p_days: days });
  if (error || !data) return jsonResponse(env, 500, { error: 'series_unavailable', message: 'The chart numbers are not installed yet. Run migration 038 in Supabase, then refresh.' });
  return jsonResponse(env, 200, { series: data });
};
