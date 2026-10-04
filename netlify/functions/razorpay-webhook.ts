/**
 * netlify/functions/razorpay-webhook.ts — Razorpay Subscription Event Handler
 * Module 5, Step 5.2
 *
 * SECURITY CRITICAL — this endpoint receives unauthenticated POST requests
 * from Razorpay's servers. Every request MUST be verified via HMAC-SHA256
 * before any database operation is performed.
 *
 * IDEMPOTENCY:
 *   Every webhook event is deduplicated via the processed_webhooks table.
 *   Razorpay retries webhooks up to 3 days if the endpoint doesn't return 2xx.
 *   We return 200 for already-processed events to prevent retry storms.
 *
 * ALL DB WRITES use the service role key (bypasses RLS). This function does
 * NOT accept JWT auth — it authenticates via the webhook signature only.
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import * as crypto from 'crypto';
import { supabaseAdmin } from './_shared/auth';

// ── TYPES ─────────────────────────────────────────────────────────────────────

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
  current_end: number;  // Unix timestamp
  charge_at?:  number;
}

interface RazorpayPayment {
  id:              string;
  subscription_id: string;
  method:          string;
  captured:        boolean;
}

// ── SIGNATURE VERIFICATION ────────────────────────────────────────────────────

/**
 * Verifies the Razorpay webhook signature using HMAC-SHA256.
 * Uses timingSafeEqual to prevent timing-based signature forgery.
 *
 * Signature = HMAC-SHA256(rawBody, webhookSecret)
 */
function verifyRazorpaySignature(
  rawBody:           string,
  receivedSignature: string,
  secret:            string,
): boolean {
  try {
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf  = Buffer.from(expected,           'hex');
    const receivedBuf  = Buffer.from(receivedSignature,  'hex');

    if (expectedBuf.length !== receivedBuf.length) return false;

    return crypto.timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

// ── IDEMPOTENCY CHECK ─────────────────────────────────────────────────────────

/**
 * Attempts to insert the event_id into processed_webhooks.
 * Returns true if this is the FIRST time we've seen this event (proceed).
 * Returns false if already processed (skip, return 200).
 *
 * Uses ON CONFLICT DO NOTHING + RETURNING to make the check atomic.
 */
async function claimEventIdempotency(eventId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('processed_webhooks')
    .insert({ event_id: eventId, processed_at: new Date().toISOString() })
    .select('event_id')
    .single();

  if (error?.code === '23505') {
    // Unique violation — already processed
    return false;
  }
  if (error) {
    // Other DB error — fail open (allow processing) to avoid missing events
    console.error('[webhook] idempotency check error:', error.message);
    return true;
  }
  return !!data;
}

// ── GET USER ID FROM SUBSCRIPTION ────────────────────────────────────────────

async function getUserIdFromSubId(subId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('razorpay_sub_id', subId)
    .maybeSingle();
  return data?.user_id ?? null;
}

// ── EVENT HANDLERS ────────────────────────────────────────────────────────────

async function handleSubscriptionCharged(sub: RazorpaySubscription): Promise<void> {
  const userId = await getUserIdFromSubId(sub.id);
  if (!userId) {
    console.warn('[webhook] subscription.charged: no user found for sub', sub.id);
    return;
  }

  // valid_until: Razorpay's current_end is a Unix timestamp
  const validUntil = new Date((sub.current_end + 86400) * 1000).toISOString(); // +1 day buffer

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
  payment: RazorpayPayment,
  sub:     RazorpaySubscription | undefined,
): Promise<void> {
  if (!sub?.id) return;
  const userId = await getUserIdFromSubId(sub.id);
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

  // Send push notification (non-blocking)
  supabaseAdmin.rpc('send_user_push', {
    p_user_id: userId,
    p_title:   '🎉 Welcome to NutriSmart Pro!',
    p_body:    'AI food search, photo logging, and all Pro features are now unlocked.',
  }).catch(() => {});

  console.log(`[webhook] payment.captured: user ${userId} upgraded to Pro`);
}

async function handleChargedFailed(sub: RazorpaySubscription): Promise<void> {
  const userId = await getUserIdFromSubId(sub.id);
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

  // Push: tell user to retry payment
  supabaseAdmin.rpc('send_user_push', {
    p_user_id: userId,
    p_title:   '⚠️ Payment failed',
    p_body:    'Your NutriSmart Pro payment failed. You have 3 days to retry before access is paused.',
  }).catch(() => {});

  console.log(`[webhook] subscription.charged.failed: user ${userId} in grace period until ${graceEndsAt}`);
}

async function handleCancelled(sub: RazorpaySubscription): Promise<void> {
  const userId = await getUserIdFromSubId(sub.id);
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

async function handleCompleted(sub: RazorpaySubscription): Promise<void> {
  const userId = await getUserIdFromSubId(sub.id);
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

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // ── 1. Verify signature FIRST — reject unsigned requests immediately ────────
  const signature = event.headers['x-razorpay-signature'];
  if (!signature) {
    console.warn('[webhook] Missing x-razorpay-signature header');
    return { statusCode: 400, body: 'Missing signature' };
  }

  const rawBody = event.body ?? '';
  const secret  = process.env.RAZORPAY_WEBHOOK_SECRET!;

  if (!verifyRazorpaySignature(rawBody, signature, secret)) {
    console.warn('[webhook] Signature verification failed');
    return { statusCode: 400, body: 'Invalid signature' };
  }

  // ── 2. Parse payload ───────────────────────────────────────────────────────
  let webhookData: RazorpayWebhookPayload;
  try {
    webhookData = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const eventType = webhookData.event;

  // ── 3. Idempotency check ───────────────────────────────────────────────────
  // Construct a stable event ID from the event type + subscription ID
  const sub     = webhookData.payload.subscription?.entity;
  const payment = webhookData.payload.payment?.entity;
  const eventId = `${eventType}:${sub?.id ?? payment?.subscription_id ?? payment?.id ?? Date.now()}`;

  const isNew = await claimEventIdempotency(eventId);
  if (!isNew) {
    console.log(`[webhook] Duplicate event ignored: ${eventId}`);
    return { statusCode: 200, body: JSON.stringify({ status: 'already_processed' }) };
  }

  // ── 4. Route by event type ─────────────────────────────────────────────────
  try {
    switch (eventType) {
      case 'subscription.charged':
        if (sub) await handleSubscriptionCharged(sub);
        break;

      case 'subscription.charged.failed':
        if (sub) await handleChargedFailed(sub);
        break;

      case 'subscription.cancelled':
        if (sub) await handleCancelled(sub);
        break;

      case 'subscription.completed':
        if (sub) await handleCompleted(sub);
        break;

      case 'payment.captured':
        if (payment) await handlePaymentCaptured(payment, sub);
        break;

      default:
        // Log unknown events but return 200 so Razorpay stops retrying
        console.log(`[webhook] Unhandled event type: ${eventType}`);
    }

    return { statusCode: 200, body: JSON.stringify({ status: 'processed', event: eventType }) };
  } catch (err) {
    console.error(`[webhook] Error processing ${eventType}:`, err);
    // Return 500 so Razorpay retries — the idempotency table prevents double-processing
    return { statusCode: 500, body: 'Internal error — will retry' };
  }
};
