import type { Env } from '../_shared/auth';
import { verifyJWT, getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { sendWebPush } from '../_shared/webPush';

// POST /api/send-test-push  (signed-in user) -> sends one test notification to that user's devices.
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return jsonResponse(env, 500, { error: 'vapid_not_configured' });
  }

  const admin = getSupabaseAdmin(env);
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth_key')
    .eq('user_id', auth.userId);

  if (!subs?.length) return jsonResponse(env, 200, { success: false, error: 'no_subscription', devices: 0 });

  let sent = 0;
  const statuses: number[] = [];
  for (const s of subs) {
    try {
      const { ok, status } = await sendWebPush(env, s, {
        title: 'NutriSmart',
        body:  'Notifications are working. You will get your morning verdict and check-ins here.',
        tag:   'test-push',
        url:   '/app/today',
      });
      statuses.push(status);
      if (ok) sent++;
      else if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    } catch (e) {
      statuses.push(-1);
    }
  }
  return jsonResponse(env, 200, { success: sent > 0, sent, devices: subs.length, statuses });
};
