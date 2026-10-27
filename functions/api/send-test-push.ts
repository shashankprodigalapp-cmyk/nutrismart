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
    .select('endpoint, p256dh, auth_key, device_ua')
    .eq('user_id', auth.userId);

  if (!subs?.length) return jsonResponse(env, 200, { success: false, error: 'no_subscription', devices: 0 });

  let sent = 0;
  const statuses: number[] = [];
  const errors: string[] = [];
  const info: { label: string; ok: boolean; status: number }[] = [];
  const labelOf = (ua: string | null) => {
    const u = ua ?? '';
    const dev = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android phone' : /Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows PC' : 'Other device';
    const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
    return br ? `${dev} (${br})` : dev;
  };
  for (const s of subs) {
    try {
      const { ok, status } = await sendWebPush(env, s, {
        title: 'Nutri Smart',
        body:  'Notifications are working. You will get your morning verdict and check-ins here.',
        tag:   'test-push-' + Date.now(),
        url:   '/app/today',
      });
      statuses.push(status);
      info.push({ label: labelOf((s as { device_ua?: string | null }).device_ua ?? null), ok, status });
      if (ok) sent++;
      else if (status === 404 || status === 410) {
        await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    } catch (e) {
      statuses.push(-1);
      info.push({ label: labelOf((s as { device_ua?: string | null }).device_ua ?? null), ok: false, status: -1 });
      errors.push(String((e as Error)?.message ?? e).slice(0, 120));
    }
  }
  return jsonResponse(env, 200, { success: sent > 0, sent, devices: subs.length, statuses, errors, info,
    keyInfo: { pub: (env.VAPID_PUBLIC_KEY || '').length, priv: (env.VAPID_PRIVATE_KEY || '').length } });
};
