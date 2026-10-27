import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, requireRole } from '../_shared/roles';

// GET  /api/admin-flags                      -> every feature switch
// POST /api/admin-flags {key, enabled:bool}  -> change one (admins only, audited). Switches cannot be created or deleted here.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'admin');
  if ('error' in who) return who.error;
  const admin = getSupabaseAdmin(env);
  if (request.method === 'POST') {
    let b: { key?: string; enabled?: unknown };
    try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
    const key = String(b.key ?? '');
    if (!/^[a-z0-9_]{2,60}$/.test(key) || typeof b.enabled !== 'boolean') return jsonResponse(env, 400, { error: 'bad_request' });
    const { data: before } = await admin.from('feature_flags').select('enabled').eq('key', key).maybeSingle();
    if (!before) return jsonResponse(env, 404, { error: 'unknown_flag' });
    if (before.enabled === b.enabled) return jsonResponse(env, 200, { ok: true, unchanged: true });
    const { error } = await admin.from('feature_flags').update({ enabled: b.enabled, updated_at: new Date().toISOString() }).eq('key', key);
    if (error) return jsonResponse(env, 500, { error: 'save_failed' });
    await audit(env, who.userId, 'admin', 'flag_set', null, { key, from: before.enabled, to: b.enabled });
    return jsonResponse(env, 200, { ok: true });
  }
  const { data, error } = await admin.from('feature_flags').select('key, enabled, description, updated_at').order('key');
  if (error) return jsonResponse(env, 500, { error: 'load_failed' });
  return jsonResponse(env, 200, { flags: data ?? [] });
};
