import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { throttle, audit, flagOn, requireRole } from '../_shared/roles';
import { cleanText } from '../_shared/coachLogic';

// POST /api/coach-apply {display_name, credentials?, bio?}  -> creates a coach profile (pending unless auto-approve is on)
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'client');
  if ('error' in who) return who.error;
  const slow = await throttle(env, who.userId, 'coach_apply', 3600, 3);
  if (slow) return slow;
  if (!(await flagOn(env, 'v2_coach')) || !(await flagOn(env, 'v2_coach_signup'))) {
    return jsonResponse(env, 403, { error: 'coach_signup_closed', message: 'Coach sign-up is not open yet.' });
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const display_name = cleanText(body.display_name, 80);
  if (display_name.length < 2) return jsonResponse(env, 400, { error: 'name_required', message: 'Please enter your name (2 letters or more).' });
  const admin = getSupabaseAdmin(env);
  const { data: existing } = await admin.from('coach_profiles').select('status').eq('user_id', who.userId).maybeSingle();
  if (existing) return jsonResponse(env, 200, { ok: true, status: existing.status, already: true });
  const auto = await flagOn(env, 'v2_coach_auto_approve');
  const status = auto ? 'active' : 'pending';
  const { error } = await admin.from('coach_profiles').insert({
    user_id: who.userId, display_name,
    credentials: cleanText(body.credentials, 200) || null, bio: cleanText(body.bio, 1000) || null,
    status, approved_at: auto ? new Date().toISOString() : null,
  });
  if (error) return jsonResponse(env, 500, { error: 'save_failed' });
  await audit(env, who.userId, 'client', 'coach_applied', who.userId, { status });
  return jsonResponse(env, 200, { ok: true, status });
};
