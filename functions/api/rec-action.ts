import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle } from '../_shared/roles';

// POST /api/rec-action {rec_id, action: 'seen'|'accepted'|'dismissed'|'done'}  or  {decision_id, action: 'opened'|'acted'}
// A person may only change their own rows. Records the response so the engine can learn what works.
const REC_ACTIONS = ['seen', 'accepted', 'dismissed', 'done'];
const UUID = /^[0-9a-f-]{36}$/i;
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  const slow = await throttle(env, auth.userId, 'rec_action', 3600, 120);
  if (slow) return slow;
  let b: { rec_id?: string; decision_id?: string; action?: string };
  try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const admin = getSupabaseAdmin(env);
  const now = new Date().toISOString();
  if (b.rec_id) {
    if (!UUID.test(b.rec_id) || !REC_ACTIONS.includes(String(b.action))) return jsonResponse(env, 400, { error: 'bad_request' });
    const patch: Record<string, unknown> = { status: b.action };
    if (b.action !== 'seen') patch.acted_at = now;
    // never move a finished recommendation backwards
    const { data, error } = await admin.from('recommendations').update(patch).eq('id', b.rec_id).eq('user_id', auth.userId).in('status', b.action === 'seen' ? ['new'] : ['new', 'seen', 'accepted']).select('id').maybeSingle();
    if (error) return jsonResponse(env, 500, { error: 'save_failed' });
    if (!data) return jsonResponse(env, 404, { error: 'not_found' });
    return jsonResponse(env, 200, { ok: true });
  }
  if (b.decision_id) {
    if (!UUID.test(b.decision_id) || !['opened', 'acted'].includes(String(b.action))) return jsonResponse(env, 400, { error: 'bad_request' });
    const patch = b.action === 'opened' ? { opened_at: now } : { acted_at: now, opened_at: now };
    const { data } = await admin.from('notification_decisions').update(patch).eq('id', b.decision_id).eq('user_id', auth.userId).eq('decision', 'send').select('id').maybeSingle();
    if (!data) return jsonResponse(env, 404, { error: 'not_found' });
    return jsonResponse(env, 200, { ok: true });
  }
  return jsonResponse(env, 400, { error: 'bad_request' });
};
