import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, requireRole } from '../_shared/roles';

// POST /api/attention-action {client_id, signal, action: 'snooze'|'dismiss'|'clear', severity, days?}
// Only for a coach with an active link to that client. Stores what the coach did, never the signal itself.
const SIGNALS = ['logging_decline', 'logging_stopped', 'protein_deviation', 'calorie_deviation', 'energy_decline'];

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'coach');
  if ('error' in who) return who.error;
  let b: { client_id?: string; signal?: string; action?: string; severity?: string; days?: number };
  try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const client = String(b.client_id ?? ''); const signal = String(b.signal ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(client) || !SIGNALS.includes(signal)) return jsonResponse(env, 400, { error: 'bad_request' });
  const admin = getSupabaseAdmin(env);
  const { data: rel } = await admin.from('coach_client_relationships').select('id').eq('coach_id', who.userId).eq('client_id', client).eq('status', 'active').maybeSingle();
  if (!rel) return jsonResponse(env, 404, { error: 'not_found' });

  if (b.action === 'clear') {
    await admin.from('attention_actions').delete().eq('coach_id', who.userId).eq('client_id', client).eq('signal', signal);
    return jsonResponse(env, 200, { ok: true });
  }
  const severity = b.severity === 'attention' ? 'attention' : b.severity === 'drifting' ? 'drifting' : null;
  if (!severity) return jsonResponse(env, 400, { error: 'bad_severity' });
  let row: Record<string, unknown>;
  if (b.action === 'snooze') {
    const days = Math.min(Math.max(Math.round(Number(b.days) || 3), 1), 30);
    row = { action: 'snoozed', until_at: new Date(Date.now() + days * 86_400_000).toISOString() };
  } else if (b.action === 'dismiss') row = { action: 'dismissed', until_at: null };
  else return jsonResponse(env, 400, { error: 'bad_action' });
  const { error } = await admin.from('attention_actions').upsert({ coach_id: who.userId, client_id: client, signal, severity, created_at: new Date().toISOString(), ...row }, { onConflict: 'coach_id,client_id,signal' });
  if (error) return jsonResponse(env, 500, { error: 'save_failed' });
  await audit(env, who.userId, 'coach', `attention_${b.action}`, client, { signal });
  return jsonResponse(env, 200, { ok: true });
};
