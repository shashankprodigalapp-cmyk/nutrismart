/**
 * netlify/functions/extract-utr.ts — AUDIT FIX R3 "kill the typing"
 *
 * The funnel's cliff is UTR transcription: find a 12-digit reference in a
 * payment app and retype it, after your money is already gone. Instead:
 * user pastes/uploads the payment screenshot → Gemini Vision extracts the
 * UTR + amount → pre-fills the form. Manual entry remains the fallback.
 *
 * Reuses the R2 storage flow: client uploads via /get-upload-url first
 * (bucket meal-photos works fine — same 5MB/private config), sends path here.
 * NOTE: this endpoint must NOT be Pro-gated — the caller is by definition
 * not yet Pro. Rate-limited by the standard per-user limiter instead.
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import { verifyJWT, supabaseAdmin, preflightResponse, jsonResponse } from './_shared/auth';

const GEMINI_VISION_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const UTR_REGEX = /[A-Za-z0-9]{10,22}/;

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST')   return jsonResponse(405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  let body: { image_path?: string };
  try { body = JSON.parse(event.body ?? '{}'); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const { image_path } = body;
  if (!image_path) return jsonResponse(400, { error: 'image_path_required' });
  if (!image_path.startsWith(`${auth.userId}/`)) {
    return jsonResponse(403, { error: 'path_not_owned' });
  }

  const { data: blob, error: dlError } = await supabaseAdmin.storage
    .from('meal-photos')
    .download(image_path);
  if (dlError || !blob) return jsonResponse(404, { error: 'image_not_found' });

  const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');

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
        generationConfig: { temperature: 0, maxOutputTokens: 100 },
      }),
    });
    clearTimeout(t);
    if (!res.ok) return jsonResponse(502, { error: 'vision_failed' });

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const utr = typeof parsed.utr === 'string' && UTR_REGEX.test(parsed.utr)
      ? parsed.utr.toUpperCase() : null;

    // Cleanup the screenshot regardless of outcome
    supabaseAdmin.storage.from('meal-photos').remove([image_path]).then(() => {});

    return jsonResponse(200, {
      success:       true,
      utr,
      amount:        typeof parsed.amount === 'number' ? parsed.amount : null,
      amount_matches: parsed.amount === 99,
    });
  } catch {
    return jsonResponse(502, { error: 'extraction_failed', message: 'Could not read the screenshot — please type the UTR manually.' });
  }
};
