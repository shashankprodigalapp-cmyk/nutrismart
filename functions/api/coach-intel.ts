import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle, flagOn, getRoles } from '../_shared/roles';
import { loadSnapshot, forecastFlags, forecastsFor } from '../_shared/intelServer';
import { coachBrief, type Intervention } from '../../src/lib/intel/coachIntel';

// POST /api/coach-intel {client_id}  (active coach of that client, food shared)
// Who needs attention, why, what changed, the evidence, what to ask, what to do, and what happened after earlier messages.
// Energy facts are included only if the client shares energy with the coach.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  if (!(await getRoles(env, auth.userId)).coach) return jsonResponse(env, 403, { error: 'forbidden' });
  const slow = await throttle(env, auth.userId, 'coach_intel', 3600, 120);
  if (slow) return slow;
  if (!(await flagOn(env, 'analytics_engine'))) return jsonResponse(env, 403, { error: 'off', message: 'This is not switched on yet.' });
  let b: { client_id?: string };
  try { b = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const client = String(b.client_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(client)) return jsonResponse(env, 400, { error: 'bad_id' });
  const admin = getSupabaseAdmin(env);
  const { data: rel } = await admin.from('coach_client_relationships').select('share_scope').eq('coach_id', auth.userId).eq('client_id', client).eq('status', 'active').maybeSingle();
  const { data: cp } = await admin.from('coach_profiles').select('status').eq('user_id', auth.userId).maybeSingle();
  if (!rel || cp?.status !== 'active' || !rel.share_scope?.food) return jsonResponse(env, 404, { error: 'not_found' });

  const now = new Date();
  const snap = await loadSnapshot(admin, client, now, { food: true, energy: !!rel.share_scope?.energy });
  const { data: sent } = await admin.from('intel_messages').select('sent_at, reason').eq('sender_id', auth.userId).eq('user_id', client).eq('status', 'sent').order('sent_at', { ascending: false }).limit(5);
  const { data: nud } = await admin.from('nudges').select('sent_at, body').eq('sent_by', auth.userId).eq('user_id', client).eq('status', 'sent').order('sent_at', { ascending: false }).limit(5);
  const interventions: Intervention[] = [
    ...(sent ?? []).map((m: any) => ({ at: String(m.sent_at).slice(0, 10), kind: 'message' as const, label: `Message (${m.reason})` })),
    ...(nud ?? []).map((n: any) => ({ at: String(n.sent_at).slice(0, 10), kind: 'nudge' as const, label: 'Nudge' })),
  ];
  const { data: cl } = await admin.from('users').select('name').eq('id', client).maybeSingle();
  const brief = coachBrief({ features: snap.index, rows: snap.rows, targets: snap.targets, today: snap.today, interventions, firstName: String(cl?.name ?? '').split(' ')[0] || undefined });
  const fon = await forecastFlags(admin);
  const forecasts = forecastsFor(snap, now, fon, { food: true, energy: !!rel.share_scope?.energy }).filter(f => f.status === 'ready' && f.key !== 'protein_catchup').map(f => ({ key: f.key, headline: f.headline, evidence: f.evidence, confidence: f.confidence }));
  return jsonResponse(env, 200, { ok: true, brief, forecasts, shares_energy: !!rel.share_scope?.energy });
};
