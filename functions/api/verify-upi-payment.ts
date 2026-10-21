import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse,
} from '../_shared/auth';

const UTR_REGEX = /^[A-Za-z0-9]{10,22}$/;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST')   return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  if (auth.plan === 'pro') {
    return jsonResponse(env, 200, { success: true, already_pro: true });
  }

  let body: { utr_number?: string; amount_confirmed?: boolean; upi_id_used?: string };
  try { body = await request.json(); }
  catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }

  const { utr_number, amount_confirmed, upi_id_used } = body;

  if (!utr_number?.trim())
    return jsonResponse(env, 400, { error: 'utr_required', message: 'Please enter the UTR / transaction ID.' });

  const cleanUTR = utr_number.trim().toUpperCase();

  if (!UTR_REGEX.test(cleanUTR))
    return jsonResponse(env, 400, { error: 'invalid_utr', message: 'Transaction ID looks incorrect — check your UPI app payment history.' });

  if (!amount_confirmed)
    return jsonResponse(env, 400, { error: 'amount_not_confirmed', message: 'Please confirm you paid exactly ₹99.' });

  const supabaseAdmin = getSupabaseAdmin(env);

  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, status')
    .eq('upi_transaction_id', cleanUTR)
    .maybeSingle();

  if (existing) {
    if (existing.user_id === auth.userId) {
      return jsonResponse(env, 200, {
        success: true,
        status:  existing.status,
        message: existing.status === 'active'
          ? 'Your Pro is already active!'
          : 'Your payment is already submitted and pending verification.',
      });
    }
    return jsonResponse(env, 409, {
      error:   'utr_already_used',
      message: 'This transaction ID has already been submitted. If you think this is wrong, contact support.',
    });
  }

  const { error: subError } = await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id:            auth.userId,
      plan:               'free',
      status:             'pending_verification',
      payment_method:     'upi',
      payment_source:     'upi_auto',
      upi_transaction_id: cleanUTR,
      upi_payment_ref:    upi_id_used ?? null,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'user_id' });

  if (subError) {
    console.error('[verify-upi] error:', subError.message);
    return jsonResponse(env, 500, { error: 'save_failed', message: 'Could not save your payment details. Please try again or contact support.' });
  }

  await supabaseAdmin.from('events').insert({
    user_id:    auth.userId,
    event_name: 'upi_payment_submitted',
    properties: { utr: cleanUTR, upi_id: upi_id_used },
    created_at: new Date().toISOString(),
  });

  return jsonResponse(env, 200, {
    success: true,
    status:  'pending_verification',
    message: 'Payment details saved. We will verify your payment and activate Pro within a few hours.',
  });
};
