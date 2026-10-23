import type { Env } from '../_shared/auth';
import { verifyJWT, getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';

const UTR_REGEX = /[A-Za-z0-9]{10,22}/;

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST')   return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  let body: { image_path?: string };
  try { body = await request.json(); }
  catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }

  const { image_path } = body;
  if (!image_path) return jsonResponse(env, 400, { error: 'image_path_required' });
  if (!image_path.startsWith(`${auth.userId}/`)) {
    return jsonResponse(env, 403, { error: 'path_not_owned' });
  }

  const supabaseAdmin = getSupabaseAdmin(env);

  const { data: blob, error: dlError } = await supabaseAdmin.storage
    .from('meal-photos')
    .download(image_path);
  if (dlError || !blob) return jsonResponse(env, 404, { error: 'image_not_found' });

  const arrayBuffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);

  const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${env.GEMINI_API_KEY}`;

  const prompt = `This is a screenshot of a UPI payment confirmation from an Indian
payment app (GPay/PhonePe/Paytm/BHIM). Extract:
1. The UPI transaction ID / UTR / reference number (10-22 alphanumeric characters)
2. The amount paid (number only, in rupees)
Return ONLY valid JSON: {"utr":"...","amount":99}
If no transaction ID is visible: {"utr":null,"amount":null}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(GEMINI_VISION_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    });
    clearTimeout(t);
    if (!res.ok) return jsonResponse(env, 502, { error: 'vision_failed' });

    const data = await res.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const utr = typeof parsed.utr === 'string' && UTR_REGEX.test(parsed.utr)
      ? parsed.utr.toUpperCase() : null;

    supabaseAdmin.storage.from('meal-photos').remove([image_path]).then(() => {});

    return jsonResponse(env, 200, {
      success:       true,
      utr,
      amount:        typeof parsed.amount === 'number' ? parsed.amount : null,
      amount_matches: parsed.amount === 99,
    });
  } catch {
    return jsonResponse(env, 502, { error: 'extraction_failed', message: 'Could not read the screenshot — please type the UTR manually.' });
  }
};
