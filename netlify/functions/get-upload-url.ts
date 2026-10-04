/**
 * netlify/functions/get-upload-url.ts — AUDIT FIX R2, Step A
 *
 * Creates a short-lived Supabase Storage signed upload URL so the client
 * uploads the meal photo DIRECTLY to storage — the image never passes
 * through a Netlify function body (old flow: 4MB image → ~5.3MB base64
 * JSON → payload cap + timeout cliff on slow 4G).
 *
 * Bucket: 'meal-photos' (private). Create once in Supabase dashboard:
 *   Storage → New bucket → name 'meal-photos' → Public OFF → 5MB file limit.
 *
 * Path scheme: {userId}/{timestamp}.{ext} — user-scoped for cleanup & audit.
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  verifyJWT,
  supabaseAdmin,
  preflightResponse,
  jsonResponse,
} from './_shared/auth';

const BUCKET = 'meal-photos';
const ALLOWED_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST')   return jsonResponse(405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  let body: { ext?: string; purpose?: 'meal-photo' | 'payment-proof' };
  try { body = JSON.parse(event.body ?? '{}'); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const purpose = body.purpose ?? 'meal-photo';

  // Meal-photo recognition is Pro-only. Payment-proof uploads must stay open
  // to free users — the whole point is that they aren't Pro yet.
  if (purpose === 'meal-photo' && auth.plan !== 'pro') {
    return jsonResponse(403, {
      error:   'pro_required',
      message: 'Photo food recognition is a Pro feature.',
    });
  }

  const ext = (body.ext ?? 'jpg').toLowerCase().replace('.', '');
  if (!ALLOWED_EXT.has(ext)) {
    return jsonResponse(400, { error: 'invalid_ext', allowed: [...ALLOWED_EXT] });
  }

  const path = `${auth.userId}/${Date.now()}.${ext}`;

  // Signed upload URL — client PUTs the file here directly (valid ~2h default;
  // client uses it within seconds)
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error('[get-upload-url]', error?.message);
    return jsonResponse(500, {
      error:   'signed_url_failed',
      message: 'Could not prepare upload. Ensure the meal-photos bucket exists.',
    });
  }

  return jsonResponse(200, {
    success:    true,
    upload_url: data.signedUrl,
    token:      data.token,
    path,        // client sends this path to ai-vision after upload
    bucket:     BUCKET,
  });
};
