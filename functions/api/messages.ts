import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle, flagOn, getRoles, audit } from '../_shared/roles';
import { istParts } from '../_shared/nudgeRules';
import { deliverNudge } from '../_shared/nudgeSend';
import { loadSnapshot } from '../_shared/intelServer';
import { coachBrief } from '../../src/lib/intel/coachIntel';
import { cleanDraft } from '../../src/lib/intel/draft';

// POST /api/messages {action, ...}
//   coach  'draft'   {client_id}                    -> AI-drafted message saved as a DRAFT (nothing is sent)
//   coach  'review'  {message_id, decision: 'approve'|'reject', text?}  -> approve sends it through the nudge pipeline; the coach may edit first
//   coach  'list'    {client_id}                    -> drafts and sent messages for that client
//   client 'respond' {message_id, response: 'read'|'done'|'not_now'}
// A message reaches a client only after a coach approves it. The text rules are the same as for nudges.
const UUID = /^[0-9a-f-]{36}$/i;
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  const slow = await throttle(env, auth.userId, 'messages', 3600, 60);
  if (slow) return slow;
  if (!(await flagOn(env, 'messaging'))) return jsonResponse(env, 403, { error: 'off', message: 'Messages are not switched on yet.' });
  let b: { action?: string; client_id?: string; message_id?: string; decision?: string; text?: unknown; response?: string };
  try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const admin = getSupabaseAdmin(env);

  if (b.action === 'respond') {
    if (!UUID.test(String(b.message_id)) || !['read', 'done', 'not_now'].includes(String(b.response))) return jsonResponse(env, 400, { error: 'bad_request' });
    const { data } = await admin.from('intel_messages').update({ response: b.response, responded_at: new Date().toISOString() }).eq('id', b.message_id).eq('user_id', auth.userId).eq('status', 'sent').select('id').maybeSingle();
    return data ? jsonResponse(env, 200, { ok: true }) : jsonResponse(env, 404, { error: 'not_found' });
  }

  if (!(await getRoles(env, auth.userId)).coach) return jsonResponse(env, 403, { error: 'forbidden' });
  const link = async (client: string) => {
    if (!UUID.test(client)) return null;
    const { data: rel } = await admin.from('coach_client_relationships').select('share_scope').eq('coach_id', auth.userId).eq('client_id', client).eq('status', 'active').maybeSingle();
    const { data: cp } = await admin.from('coach_profiles').select('status, display_name').eq('user_id', auth.userId).maybeSingle();
    return rel && cp?.status === 'active' ? { scope: rel.share_scope as Record<string, boolean>, name: cp.display_name as string | null } : null;
  };

  if (b.action === 'list') {
    const client = String(b.client_id ?? ''); if (!(await link(client))) return jsonResponse(env, 404, { error: 'not_found' });
    const { data } = await admin.from('intel_messages').select('id, sender_type, reason, body, status, delivery, response, outcome, created_at, sent_at').eq('sender_id', auth.userId).eq('user_id', client).order('created_at', { ascending: false }).limit(20);
    return jsonResponse(env, 200, { ok: true, messages: data ?? [] });
  }

  if (b.action === 'draft') {
    const client = String(b.client_id ?? ''); const l = await link(client);
    if (!l || !l.scope?.food) return jsonResponse(env, 404, { error: 'not_found' });
    const snap = await loadSnapshot(admin, client, new Date(), { food: true, energy: false });
    const { data: cl } = await admin.from('users').select('name').eq('id', client).maybeSingle();
    const brief = coachBrief({ features: snap.index, rows: snap.rows, targets: snap.targets, today: snap.today, firstName: String(cl?.name ?? '').split(' ')[0] || undefined });
    if (!brief.draft) return jsonResponse(env, 200, { ok: true, draft: null, message: 'Nothing needs a message right now.' });
    const { data: row, error } = await admin.from('intel_messages').insert({ user_id: client, sender_type: 'ai_draft', sender_id: auth.userId, reason: brief.reasons[0] ?? 'check-in', body: brief.draft, status: 'draft' }).select('id, body, reason').single();
    if (error) return jsonResponse(env, 500, { error: 'save_failed' });
    await audit(env, auth.userId, 'coach', 'message_drafted', client, { message: row.id });
    return jsonResponse(env, 200, { ok: true, draft: row });
  }

  if (b.action === 'review') {
    if (!UUID.test(String(b.message_id)) || !['approve', 'reject'].includes(String(b.decision))) return jsonResponse(env, 400, { error: 'bad_request' });
    const { data: m } = await admin.from('intel_messages').select('id, user_id, body, status, reason').eq('id', b.message_id).eq('sender_id', auth.userId).maybeSingle();
    if (!m || m.status !== 'draft') return jsonResponse(env, 404, { error: 'not_found' });
    const l = await link(m.user_id); if (!l) return jsonResponse(env, 404, { error: 'not_found' });
    if (b.decision === 'reject') { await admin.from('intel_messages').update({ status: 'rejected' }).eq('id', m.id); return jsonResponse(env, 200, { ok: true, state: 'rejected' }); }
    const text = cleanDraft(b.text ?? m.body);
    if (!text) return jsonResponse(env, 400, { error: 'bad_text', message: 'Keep it under 140 characters with no links.' });
    const now = new Date();
    const { data: nudge, error } = await admin.from('nudges').insert({ user_id: m.user_id, kind: 'coach_message', sent_by: auth.userId, title: `Message from ${l.name ?? 'your coach'}`, body: text, dedupe_key: `coach:${auth.userId}:${m.user_id}:${istParts(now).day}` }).select('id, user_id, kind, title, body').single();
    if (error) return error.code === '23505' ? jsonResponse(env, 429, { error: 'already_sent_today', message: 'You already sent this client a message today. Try again tomorrow.' }) : jsonResponse(env, 500, { error: 'save_failed' });
    const out = await deliverNudge(env, admin, nudge, now);
    await admin.from('intel_messages').update({ body: text, status: 'sent', sender_type: 'coach', delivery: out.state, sent_at: now.toISOString() }).eq('id', m.id);
    await audit(env, auth.userId, 'coach', 'message_approved', m.user_id, { message: m.id, outcome: out.state, edited: text !== m.body });
    return jsonResponse(env, 200, { ok: true, state: out.state });
  }
  return jsonResponse(env, 400, { error: 'bad_action' });
};
