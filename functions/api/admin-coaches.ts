import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, requireRole } from '../_shared/roles';

// GET  /api/admin-coaches                    -> coaches and their client counts (admins only)
// POST /api/admin-coaches {user_id, action: 'approve'|'suspend'}
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const admin = getSupabaseAdmin(env);
  if (request.method === 'POST') {
    let body: { user_id?: string; action?: string };
    try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
    const uid = String(body.user_id ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(uid)) return jsonResponse(env, 400, { error: 'bad_id' });
    if (body.action !== 'approve' && body.action !== 'suspend') return jsonResponse(env, 400, { error: 'bad_action' });
    const patch = body.action === 'approve'
      ? { status: 'active', approved_by: who.userId, approved_at: new Date().toISOString() }
      : { status: 'suspended' };
    const { error } = await admin.from('coach_profiles').update({ ...patch, updated_at: new Date().toISOString() }).eq('user_id', uid);
    if (error) return jsonResponse(env, 500, { error: 'save_failed' });
    await audit(env, who.userId, 'admin', `coach_${body.action}`, uid, {});
    return jsonResponse(env, 200, { ok: true });
  }
  const { data: coaches } = await admin.from('coach_profiles').select('user_id, display_name, credentials, status, created_at').order('created_at', { ascending: false }).limit(200);
  const { data: rels } = await admin.from('coach_client_relationships').select('coach_id').eq('status', 'active');
  const counts = new Map<string, number>();
  for (const r of rels ?? []) counts.set(r.coach_id, (counts.get(r.coach_id) ?? 0) + 1);
  return jsonResponse(env, 200, { coaches: (coaches ?? []).map(c => ({ ...c, active_clients: counts.get(c.user_id) ?? 0 })) });
};
