import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse,
} from '../_shared/auth';

const UTR_REGEX = /^[A-Za-z0-9]{10,22}$/;
const MAX_PROOF_URL_LEN = 2000;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST')   return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  if (auth.plan === 'pro') {
    return jsonResponse(env, 200, { success: true, already_pro: true });
  }

  let body: { transaction_id?: string; proof_url?: string };
  try { body = await request.json(); }
  catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }

  const cleanUTR = (body.transaction_id ?? '').trim().toUpperCase();
  if (!UTR_REGEX.test(cleanUTR)) {
    return jsonResponse(env, 400, {
      error:   'invalid_utr',
      message: 'Transaction ID looks incorrect (10–22 letters/numbers). Check your UPI app history.',
    });
  }

  const proofUrl = (body.proof_url ?? '').trim().slice(0, MAX_PROOF_URL_LEN) || null;
  if (proofUrl && !/^https?:\/\//.test(proofUrl)) {
    return jsonResponse(env, 400, { error: 'invalid_proof_url', message: 'Proof URL must start with http(s)://' });
  }

  const supabaseAdmin = getSupabaseAdmin(env);

  const { data: pending } = await supabaseAdmin
    .from('payment_submissions')
    .select('id')
    .eq('user_id', auth.userId)
    .eq('status', 'pending')
    .maybeSingle();

  if (pending) {
    return jsonResponse(env, 200, {
      success: true,
      status:  'pending',
      message: 'Your payment is already submitted and awaiting validation.',
    });
  }

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
      return jsonResponse(env, 409, {
        error:   'utr_already_used',
        message: 'This transaction ID was already submitted. If you believe this is an error, contact support.',
      });
    }
    console.error('[submit-payment]', insertErr.message);
    return jsonResponse(env, 500, { error: 'save_failed', message: 'Could not save. Please retry or contact support.' });
  }

  const { data: prov } = await supabaseAdmin.rpc('grant_provisional_pro', {
    p_target_user_id: auth.userId,
    p_hours:          24,
  });

  await supabaseAdmin.from('events').insert({
    user_id:    auth.userId,
    event_name: 'payment_submissions_created',
    properties: { utr: cleanUTR, has_proof: !!proofUrl, amount_inr: 99, provisional: true },
    created_at: new Date().toISOString(),
  });

  return jsonResponse(env, 200, {
    success:            true,
    status:             'pending',
    provisional_pro:    true,
    provisional_until:  prov?.provisional_until ?? null,
    message:            '🎉 Pro unlocked instantly! We\'ll verify your payment within 24 hours.',
  });
};
