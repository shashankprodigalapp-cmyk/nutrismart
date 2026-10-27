import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { requireRole } from '../_shared/roles';

// GET /api/admin-audit?action=prefix&limit=100 -> recent audit log entries (admins only, newest first)
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '100', 10) || 100, 1), 200);
  const prefix = (url.searchParams.get('action') ?? '').replace(/[^a-z0-9_]/gi, '').slice(0, 40);
  let q = getSupabaseAdmin(env).from('audit_logs').select('id, actor_id, actor_role, action, target_user, meta, created_at').order('created_at', { ascending: false }).limit(limit);
  if (prefix) q = q.like('action', `${prefix}%`);
  const { data, error } = await q;
  if (error) return jsonResponse(env, 500, { error: 'load_failed' });
  return jsonResponse(env, 200, { entries: data ?? [] });
};
