/**
 * verify-upi-payment.ts
 *
 * HONEST FLOW (pending verification):
 *   1. User pays ₹99 via UPI
 *   2. User submits their UTR / transaction ID
 *   3. This function saves it as status='pending_verification'
 *   4. Admin sees it in the Users panel → verifies in their UPI app
 *   5. Admin clicks "Activate Pro" → Pro unlocks instantly for that user
 *
 * WHY NOT AUTO-ACTIVATE:
 *   UPI has no public verification API. There is no way to confirm
 *   a UTR was paid to a specific UPI ID without checking your bank.
 *   Auto-activating on UTR alone would allow fraud (fake UTRs).
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  verifyJWT,
  supabaseAdmin,
  preflightResponse,
  jsonResponse,
} from './_shared/auth';

const UTR_REGEX = /^[A-Za-z0-9]{10,22}$/;

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST')   return jsonResponse(405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  // Already Pro?
  if (auth.plan === 'pro') {
    return jsonResponse(200, { success: true, already_pro: true });
  }

  let body: { utr_number?: string; amount_confirmed?: boolean; upi_id_used?: string };
  try { body = JSON.parse(event.body ?? '{}'); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const { utr_number, amount_confirmed, upi_id_used } = body;

  if (!utr_number?.trim())
    return jsonResponse(400, { error: 'utr_required', message: 'Please enter the UTR / transaction ID.' });

  const cleanUTR = utr_number.trim().toUpperCase();

  if (!UTR_REGEX.test(cleanUTR))
    return jsonResponse(400, { error: 'invalid_utr', message: 'Transaction ID looks incorrect — check your UPI app payment history.' });

  if (!amount_confirmed)
    return jsonResponse(400, { error: 'amount_not_confirmed', message: 'Please confirm you paid exactly ₹99.' });

  // Check this UTR hasn't already been submitted
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, status')
    .eq('upi_transaction_id', cleanUTR)
    .maybeSingle();

  if (existing) {
    if (existing.user_id === auth.userId) {
      return jsonResponse(200, {
        success: true,
        status:  existing.status,
        message: existing.status === 'active'
          ? 'Your Pro is already active!'
          : 'Your payment is already submitted and pending verification.',
      });
    }
    // Another user already submitted this UTR
    return jsonResponse(409, {
      error:   'utr_already_used',
      message: 'This transaction ID has already been submitted. If you think this is wrong, contact support.',
    });
  }

  // Save as pending_verification — admin will verify and activate
  const { error: subError } = await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id:            auth.userId,
      plan:               'free',           // stays free until admin verifies
      status:             'pending_verification',
      payment_method:     'upi',
      payment_source:     'upi_auto',
      upi_transaction_id: cleanUTR,
      upi_payment_ref:    upi_id_used ?? null,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (subError) {
    console.error('[verify-upi] error:', subError.message);
    return jsonResponse(500, { error: 'save_failed', message: 'Could not save your payment details. Please try again or contact support.' });
  }

  // Log for analytics + admin visibility
  await supabaseAdmin.from('events').insert({
    user_id:    auth.userId,
    event_name: 'upi_payment_submitted',
    properties: { utr: cleanUTR, upi_id: upi_id_used },
    created_at: new Date().toISOString(),
  });

  return jsonResponse(200, {
    success: true,
    status:  'pending_verification',
    message: 'Payment details saved. We will verify your payment and activate Pro within a few hours.',
  });
};
