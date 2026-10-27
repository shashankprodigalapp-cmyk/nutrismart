import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, requireRole } from '../_shared/roles';
import { allowedTransition, normalizeScope, type RelAction } from '../_shared/coachLogic';

// POST /api/coach-relationship {id, action: 'pause'|'resume'|'end'|'scope', share_scope?}
// Either side may end a link. Only the client may pause, resume, or change what is shared.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'client');
  if ('error' in who) return who.error;
  let body: { id?: string; action?: string; share_scope?: unknown };
  try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const id = String(body.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse(env, 400, { error: 'bad_id' });
  const admin = getSupabaseAdmin(env);
  const { data: rel } = await admin.from('coach_client_relationships').select('id, coach_id, client_id, status').eq('id', id).maybeSingle();
  // The caller must be one of the two people in this link. Same answer for "missing" and "not yours".
  if (!rel || (rel.coach_id !== who.userId && rel.client_id !== who.userId)) return jsonResponse(env, 404, { error: 'not_found' });
  const actor = rel.client_id === who.userId ? 'client' : 'coach';

  if (body.action === 'scope') {
    if (actor !== 'client') return jsonResponse(env, 403, { error: 'forbidden', message: 'Only the client can change what is shared.' });
    await admin.from('coach_client_relationships').update({ share_scope: normalizeScope(body.share_scope) }).eq('id', id);
    await audit(env, who.userId, actor, 'share_scope_changed', rel.client_id, { relationship: id });
    return jsonResponse(env, 200, { ok: true });
  }
  const action = body.action as RelAction;
  const next = allowedTransition(rel.status, action, actor);
  if (!next) return jsonResponse(env, 409, { error: 'not_allowed', message: 'That change is not available right now.' });
  const patch: Record<string, unknown> = { status: next };
  if (next === 'ended') { patch.ended_at = new Date().toISOString(); patch.ended_by = who.userId; }
  await admin.from('coach_client_relationships').update(patch).eq('id', id);
  await audit(env, who.userId, actor, `relationship_${next}`, rel.client_id, { relationship: id });
  return jsonResponse(env, 200, { ok: true, status: next });
};
