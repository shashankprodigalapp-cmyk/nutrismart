import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse, peekRateLimit } from '../_shared/auth';

const BUCKET = 'meal-photos';
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST')   return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  let body: { ext?: string; purpose?: 'meal-photo' | 'payment-proof' };
  try { body = await request.json(); }
  catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }

  const purpose = body.purpose ?? 'meal-photo';

  // Photo search is open to everyone, with a daily allowance (1 free, 20 Pro). Stop here if today's is used,
  // so no photo is uploaded for nothing.
  if (purpose === 'meal-photo') {
    const { used, limit } = await peekRateLimit(env, auth.userId, auth.plan === 'pro' ? 'pro' : 'free', 'photo');
    if (used >= limit) {
      return jsonResponse(env, 429, {
        error:   'photo_limit',
        message: auth.plan === 'pro'
          ? 'You have used all of today\'s photo searches. They reset at midnight. You can still search by typing the food name.'
          : 'You have used today\'s free photo search. It resets at midnight. You can still search by typing the food name.',
      });
    }
  }

  const ext = (body.ext ?? 'jpg').toLowerCase().replace('.', '');
  if (!ALLOWED_EXT.has(ext)) {
    return jsonResponse(env, 400, { error: 'invalid_ext', allowed: [...ALLOWED_EXT] });
  }

  const path = `${auth.userId}/${Date.now()}.${ext}`;

  const supabaseAdmin = getSupabaseAdmin(env);
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error('[get-upload-url]', error?.message);
    return jsonResponse(env, 500, {
      error:   'signed_url_failed',
      message: 'Could not prepare upload. Ensure the meal-photos bucket exists.',
    });
  }

  return jsonResponse(env, 200, {
    success:    true,
    upload_url: data.signedUrl,
    token:      data.token,
    path,
    bucket:     BUCKET,
  });
};
