import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle, audit, flagOn, requireRole } from '../_shared/roles';
import { INVITE_DAYS, cleanText, newInviteToken, sha256Hex } from '../_shared/coachLogic';

// POST /api/coach-invite {label?}  (active coaches only) -> {link}. The raw token is shown once; only its hash is stored.
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'coach');
  if ('error' in who) return who.error;
  if (!(await flagOn(env, 'v2_coach'))) return jsonResponse(env, 403, { error: 'coach_disabled' });
  const slow = await throttle(env, who.userId, 'coach_invite', 3600, 20);
  if (slow) return slow;
  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { /* label is optional */ }
  const admin = getSupabaseAdmin(env);
  // Keep a coach from flooding invites: at most 50 open ones.
  const { count } = await admin.from('coach_client_relationships').select('id', { count: 'exact', head: true })
    .eq('coach_id', who.userId).eq('status', 'invited');
  if ((count ?? 0) >= 50) return jsonResponse(env, 429, { error: 'too_many_open_invites', message: 'You have 50 open invites. Cancel some first.' });
  const token = newInviteToken();
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  const { error } = await admin.from('coach_client_relationships').insert({
    coach_id: who.userId, status: 'invited', invite_token_hash: await sha256Hex(token),
    invite_label: cleanText(body.label, 80) || null, invite_expires_at: expires,
  });
  if (error) return jsonResponse(env, 500, { error: 'save_failed' });
  await audit(env, who.userId, 'coach', 'client_invited', null, {});
  const base = env.APP_URL ?? 'https://nutrismart-3bb.pages.dev';
  return jsonResponse(env, 200, { ok: true, link: `${base}/join/${token}`, expires_at: expires });
};
