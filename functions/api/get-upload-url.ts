import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  getSupabaseAdmin,
  preflightResponse,
  jsonResponse,
} from '../_shared/auth';

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

  if (purpose === 'meal-photo' && auth.plan !== 'pro') {
    return jsonResponse(env, 403, {
      error:   'pro_required',
      message: 'Photo food recognition is a Pro feature.',
    });
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
