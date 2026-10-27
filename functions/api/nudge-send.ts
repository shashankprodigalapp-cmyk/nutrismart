import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, flagOn, requireRole } from '../_shared/roles';
import { cleanNudgeText, istParts } from '../_shared/nudgeRules';
import { deliverNudge } from '../_shared/nudgeSend';

// POST /api/nudge-send {client_id, text}  (active coach only; one nudge per coach per client per day)
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'coach');
  if ('error' in who) return who.error;
  if (!(await flagOn(env, 'v2_nudges'))) return jsonResponse(env, 403, { error: 'nudges_off', message: 'Nudges are not switched on yet.' });
  let b: { client_id?: string; text?: unknown };
  try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const client = String(b.client_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(client)) return jsonResponse(env, 400, { error: 'bad_id' });
  const text = cleanNudgeText(b.text);
  if (!text.ok) return jsonResponse(env, 400, { error: 'bad_text', message: text.error });

  const admin = getSupabaseAdmin(env);
  const { data: rel } = await admin.from('coach_client_relationships').select('id').eq('coach_id', who.userId).eq('client_id', client).eq('status', 'active').maybeSingle();
  if (!rel) return jsonResponse(env, 404, { error: 'not_found' });
  const { data: cp } = await admin.from('coach_profiles').select('display_name').eq('user_id', who.userId).maybeSingle();

  const now = new Date();
  const { data: row, error } = await admin.from('nudges').insert({
    user_id: client, kind: 'coach_message', sent_by: who.userId, title: `Message from ${cp?.display_name ?? 'your coach'}`, body: text.text,
    dedupe_key: `coach:${who.userId}:${client}:${istParts(now).day}`,
  }).select('id, user_id, kind, title, body').single();
  if (error) {
    if (error.code === '23505') return jsonResponse(env, 429, { error: 'already_sent_today', message: 'You already sent this client a nudge today. Try again tomorrow.' });
    return jsonResponse(env, 500, { error: 'save_failed' });
  }
  const out = await deliverNudge(env, admin, row, now);
  await audit(env, who.userId, 'coach', 'nudge_sent', client, { nudge: row.id, outcome: out.state });
  const msg = out.state === 'sent' ? 'Sent.'
    : out.state === 'queued' ? (out.reason === 'quiet_hours' ? 'Saved. It will arrive after the client\'s quiet hours.' : 'Saved. It will be sent shortly.')
    : out.state === 'skipped' ? (out.reason === 'muted' ? 'This client has turned coach nudges off.' : out.reason === 'no_device' ? 'This client has not turned on notifications on any device.' : 'This client has already had enough nudges today.')
    : 'Could not reach the client\'s device.';
  return jsonResponse(env, 200, { ok: out.state === 'sent' || out.state === 'queued', state: out.state, message: msg });
};
