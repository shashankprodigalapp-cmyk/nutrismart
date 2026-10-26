import { buildPushPayload } from '@block65/webcrypto-web-push';
import type { PushMessage, PushSubscription, VapidKeys } from '@block65/webcrypto-web-push';
import type { Env } from './auth';

export interface PushSubRow {
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export async function sendWebPush(
  env: Env,
  sub: PushSubRow,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number }> {
  const vapid: VapidKeys = {
    subject: 'mailto:support@nutrismart.co.in',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  const subscription: PushSubscription = {
    endpoint: sub.endpoint,
    expirationTime: null,
    keys: { p256dh: sub.p256dh, auth: sub.auth_key },
  };

  const message: PushMessage = {
    data: payload as any,
    options: { ttl: 86400 },
  };

  const built = await buildPushPayload(message, subscription, vapid);
  const res = await fetch(sub.endpoint, {
    method: built.method,
    headers: built.headers,
    body: built.body,
  });
  return { ok: res.ok, status: res.status };
}
