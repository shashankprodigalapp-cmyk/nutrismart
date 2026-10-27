import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, flagOn, requireRole } from '../_shared/roles';
import { inviteProblem, normalizeScope, sha256Hex } from '../_shared/coachLogic';

// POST /api/coach-accept {token, share_scope?, preview?}
// preview:true only tells the client who is inviting. Otherwise the client joins and decides what the coach may see.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  if (!(await flagOn(env, 'v2_coach'))) return jsonResponse(env, 403, { error: 'coach_disabled' });
  const who = await requireRole(request, env, 'client');
  if ('error' in who) return who.error;
  let body: { token?: string; share_scope?: unknown; preview?: boolean };
  try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const token = String(body.token ?? '').slice(0, 100);
  if (token.length < 20) return jsonResponse(env, 400, { error: 'invalid_invite', message: 'This invite link is not valid.' });
  const admin = getSupabaseAdmin(env);
  const hash = await sha256Hex(token);
  const { data: rel } = await admin.from('coach_client_relationships')
    .select('id, coach_id, status, invite_expires_at').eq('invite_token_hash', hash).maybeSingle();
  const problem = inviteProblem(rel, who.userId);
  const messages: Record<string, string> = {
    not_found: 'This invite link is not valid.', expired: 'This invite has expired. Ask your coach for a new one.',
    used: 'This invite has already been used.', own_invite: 'You cannot accept your own invite.',
  };
  if (problem) return jsonResponse(env, 400, { error: problem, message: messages[problem] });
  const { data: coach } = await admin.from('coach_profiles').select('display_name, credentials, status').eq('user_id', rel!.coach_id).maybeSingle();
  if (!coach || coach.status !== 'active') return jsonResponse(env, 400, { error: 'coach_inactive', message: 'This coach is not active right now.' });
  if (body.preview) return jsonResponse(env, 200, { ok: true, coach: { display_name: coach.display_name, credentials: coach.credentials } });

  const { error } = await admin.from('coach_client_relationships').update({
    client_id: who.userId, status: 'active', accepted_at: new Date().toISOString(),
    share_scope: normalizeScope(body.share_scope), invite_token_hash: null,
  }).eq('id', rel!.id).eq('status', 'invited');
  if (error) {
    const dup = /uq_ccr_active_pair|duplicate/i.test(error.message);
    return jsonResponse(env, dup ? 409 : 500, { error: dup ? 'already_linked' : 'save_failed', message: dup ? 'You are already linked to this coach.' : undefined });
  }
  await audit(env, who.userId, 'client', 'invite_accepted', who.userId, { coach_id: rel!.coach_id });
  return jsonResponse(env, 200, { ok: true, coach: { display_name: coach.display_name } });
};
