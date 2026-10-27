import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { requireRole } from '../_shared/roles';

// GET /api/admin-platform -> all 2.0 numbers (admins only), counted by the database.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const { data, error } = await getSupabaseAdmin(env).rpc('admin_platform_metrics');
  if (error || !data) return jsonResponse(env, 500, { error: 'metrics_unavailable', message: 'The admin numbers are not installed yet. Run migration 033 in Supabase, then refresh.' });
  return jsonResponse(env, 200, { metrics: data });
};
