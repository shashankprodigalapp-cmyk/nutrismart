import type { Env } from '../_shared/auth';
import { getSupabaseAdmin } from '../_shared/auth';

interface RazorpayWebhookPayload {
  entity:  string;
  account_id: string;
  event:   string;
  contains: string[];
  payload: {
    subscription?: { entity: RazorpaySubscription };
    payment?:      { entity: RazorpayPayment };
  };
}

interface RazorpaySubscription {
  id:          string;
  plan_id:     string;
  status:      string;
  notes?:      Record<string, string>;
  current_end: number;
  charge_at?:  number;
}

interface RazorpayPayment {
  id:              string;
  subscription_id: string;
  method:          string;
  captured:        boolean;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifyRazorpaySignature(
  rawBody:           string,
  receivedSignature: string,
  secret:            string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
    const expectedBytes = new Uint8Array(sigBuffer);
    const receivedBytes = hexToBytes(receivedSignature);
    return constantTimeEqual(expectedBytes, receivedBytes);
  } catch {
    return false;
  }
}

async function claimEventIdempotency(env: Env, eventId: string): Promise<boolean> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const { data, error } = await supabaseAdmin
    .from('processed_webhooks')
    .insert({ event_id: eventId, processed_at: new Date().toISOString() })
    .select('event_id')
    .single();

  if (error?.code === '23505') return false;
  if (error) {
    console.error('[webhook] idempotency check error:', error.message);
    return true;
  }
  return !!data;
}

async function getUserIdFromSubId(env: Env, subId: string): Promise<string | null> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('razorpay_sub_id', subId)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function handleSubscriptionCharged(env: Env, sub: RazorpaySubscription): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const userId = await getUserIdFromSubId(env, sub.id);
  if (!userId) {
    console.warn('[webhook] subscription.charged: no user found for sub', sub.id);
    return;
  }

  const validUntil = new Date((sub.current_end + 86400) * 1000).toISOString();

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status:      'active',
      valid_until: validUntil,
      updated_at:  new Date().toISOString(),
    })
    .eq('razorpay_sub_id', sub.id);

  await supabaseAdmin
    .from('users')
    .update({ plan: 'pro', updated_at: new Date().toISOString() })
    .eq('id', userId);

  console.log(`[webhook] subscription.charged: user ${userId} active until ${validUntil}`);
}

async function handlePaymentCaptured(
  env:     Env,
  payment: RazorpayPayment,
  sub:     RazorpaySubscription | undefined,
): Promise<void> {
  if (!sub?.id) return;
  const supabaseAdmin = getSupabaseAdmin(env);
  const userId = await getUserIdFromSubId(env, sub.id);
  if (!userId) return;

  const validUntil = sub.current_end
    ? new Date((sub.current_end + 86400) * 1000).toISOString()
    : new Date(Date.now() + 31 * 86400_000).toISOString();

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status:         'active',
      valid_until:    validUntil,
      activated_at:   new Date().toISOString(),
      payment_method: payment.method,
      updated_at:     new Date().toISOString(),
    })
    .eq('razorpay_sub_id', sub.id);

  await supabaseAdmin
    .from('users')
    .update({ plan: 'pro', updated_at: new Date().toISOString() })
    .eq('id', userId);

  supabaseAdmin.rpc('send_user_push', {
    p_user_id: userId,
    p_title:   '🎉 Welcome to NutriSmart Pro!',
    p_body:    'AI food search, photo logging, and all Pro features are now unlocked.',
  }).then(() => {}, () => {});

  console.log(`[webhook] payment.captured: user ${userId} upgraded to Pro`);
}

async function handleChargedFailed(env: Env, sub: RazorpaySubscription): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const userId = await getUserIdFromSubId(env, sub.id);
  if (!userId) return;

  const graceEndsAt = new Date(Date.now() + 3 * 86400_000).toISOString();

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status:        'grace_period',
      grace_ends_at: graceEndsAt,
      updated_at:    new Date().toISOString(),
    })
    .eq('razorpay_sub_id', sub.id);

  supabaseAdmin.rpc('send_user_push', {
    p_user_id: userId,
    p_title:   '⚠️ Payment failed',
    p_body:    'Your NutriSmart Pro payment failed. You have 3 days to retry before access is paused.',
  }).then(() => {}, () => {});

  console.log(`[webhook] subscription.charged.failed: user ${userId} in grace period until ${graceEndsAt}`);
}

async function handleCancelled(env: Env, sub: RazorpaySubscription): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const userId = await getUserIdFromSubId(env, sub.id);
  if (!userId) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status:       'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq('razorpay_sub_id', sub.id);

  await supabaseAdmin
    .from('users')
    .update({ plan: 'free', updated_at: new Date().toISOString() })
    .eq('id', userId);

  console.log(`[webhook] subscription.cancelled: user ${userId} downgraded to free`);
}

async function handleCompleted(env: Env, sub: RazorpaySubscription): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const userId = await getUserIdFromSubId(env, sub.id);
  if (!userId) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status:     'expired',
      updated_at: new Date().toISOString(),
    })
    .eq('razorpay_sub_id', sub.id);

  await supabaseAdmin
    .from('users')
    .update({ plan: 'free', updated_at: new Date().toISOString() })
    .eq('id', userId);

  console.log(`[webhook] subscription.completed: user ${userId} subscription ended`);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const signature = request.headers.get('x-razorpay-signature');
  if (!signature) {
    console.warn('[webhook] Missing x-razorpay-signature header');
    return new Response('Missing signature', { status: 400 });
  }

  const rawBody = await request.text();
  const secret  = env.RAZORPAY_WEBHOOK_SECRET;

  if (!(await verifyRazorpaySignature(rawBody, signature, secret))) {
    console.warn('[webhook] Signature verification failed');
    return new Response('Invalid signature', { status: 400 });
  }

  let webhookData: RazorpayWebhookPayload;
  try {
    webhookData = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const eventType = webhookData.event;

  const sub     = webhookData.payload.subscription?.entity;
  const payment = webhookData.payload.payment?.entity;
  const eventId = `${eventType}:${sub?.id ?? payment?.subscription_id ?? payment?.id ?? Date.now()}`;

  const isNew = await claimEventIdempotency(env, eventId);
  if (!isNew) {
    console.log(`[webhook] Duplicate event ignored: ${eventId}`);
    return new Response(JSON.stringify({ status: 'already_processed' }), { status: 200 });
  }

  try {
    switch (eventType) {
      case 'subscription.charged':
        if (sub) await handleSubscriptionCharged(env, sub);
        break;

      case 'subscription.charged.failed':
        if (sub) await handleChargedFailed(env, sub);
        break;

      case 'subscription.cancelled':
        if (sub) await handleCancelled(env, sub);
        break;

      case 'subscription.completed':
        if (sub) await handleCompleted(env, sub);
        break;

      case 'payment.captured':
        if (payment) await handlePaymentCaptured(env, payment, sub);
        break;

      default:
        console.log(`[webhook] Unhandled event type: ${eventType}`);
    }

    return new Response(JSON.stringify({ status: 'processed', event: eventType }), { status: 200 });
  } catch (err) {
    console.error(`[webhook] Error processing ${eventType}:`, err);
    return new Response('Internal error — will retry', { status: 500 });
  }
};
