/**
 * netlify/functions/submit-payment.ts — UPI Payment Submission (Module 5)
 *
 * Replaces the Razorpay checkout flow entirely.
 * Inserts a payment_submissions record with status='pending'.
 * Admin approves via approve_upi_payment RPC → Pro activates.
 *
 * Also fires 'payment_submissions_created' analytics event (Module 8).
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  verifyJWT,
  supabaseAdmin,
  preflightResponse,
  jsonResponse,
} from './_shared/auth';

const UTR_REGEX = /^[A-Za-z0-9]{10,22}$/;
const MAX_PROOF_URL_LEN = 2000;

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST')   return jsonResponse(405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  if (auth.plan === 'pro') {
    return jsonResponse(200, { success: true, already_pro: true });
  }

  let body: { transaction_id?: string; proof_url?: string };
  try { body = JSON.parse(event.body ?? '{}'); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const cleanUTR = (body.transaction_id ?? '').trim().toUpperCase();
  if (!UTR_REGEX.test(cleanUTR)) {
    return jsonResponse(400, {
      error:   'invalid_utr',
      message: 'Transaction ID looks incorrect (10–22 letters/numbers). Check your UPI app history.',
    });
  }

  const proofUrl = (body.proof_url ?? '').trim().slice(0, MAX_PROOF_URL_LEN) || null;
  if (proofUrl && !/^https?:\/\//.test(proofUrl)) {
    return jsonResponse(400, { error: 'invalid_proof_url', message: 'Proof URL must start with http(s)://' });
  }

  // Does this user already have a pending submission?
  const { data: pending } = await supabaseAdmin
    .from('payment_submissions')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (pending) {
    return jsonResponse(200, {
      success: true,
      status:  'pending',
      message: 'Your payment is already submitted and awaiting validation.',
    });
  }

  // Insert — UNIQUE(transaction_id) rejects reused UTRs across all users
  const { error: insertErr } = await supabaseAdmin
    .from('payment_submissions')
    .insert({
      user_id:        auth.userId,
      transaction_id: cleanUTR,
      proof_url:      proofUrl,
      amount_inr:     99,
      status:         'pending',
    });

  if (insertErr) {
    if (insertErr.code === '23505') {
      return jsonResponse(409, {
        error:   'utr_already_used',
        message: 'This transaction ID was already submitted. If you believe this is an error, contact support.',
      });
    }
    console.error('[submit-payment]', insertErr.message);
    return jsonResponse(500, { error: 'save_failed', message: 'Could not save. Please retry or contact support.' });
  }

  // AUDIT FIX R3 — "Pro-while-pending": grant 24h provisional Pro instantly.
  // The user's money is already gone; making them wait inverts every UPI
  // expectation. Trust first — a rejected UTR revokes within the window.
  const { data: prov } = await supabaseAdmin.rpc('grant_provisional_pro', {
    p_target_user_id: auth.userId,
    p_hours:          24,
  });

  // Module 8 analytics
  await supabaseAdmin.from('events').insert({
    user_id:    auth.userId,
    event_name: 'payment_submissions_created',
    properties: { utr: cleanUTR, has_proof: !!proofUrl, amount_inr: 99, provisional: true },
    created_at: new Date().toISOString(),
  });

  return jsonResponse(200, {
    success:            true,
    status:             'pending',
    provisional_pro:    true,
    provisional_until:  prov?.provisional_until ?? null,
    message:            '🎉 Pro unlocked instantly! We\'ll verify your payment within 24 hours.',
  });
};
