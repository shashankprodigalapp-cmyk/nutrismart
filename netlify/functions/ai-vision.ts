/**
 * netlify/functions/ai-vision.ts — AI Photo Food Recognition (Pro only)
 * Module 4, Step 4.3
 *
 * Flow:
 *   1. Verify JWT → confirm Pro plan
 *   2. Validate image (size, mime type)
 *   3. Gemini Vision: identify dishes from photo → [{name, portion, confidence, ask_clarification}]
 *   4. For each identified dish (max 5): call Gemini text lookup for nutrition
 *   5. Validate each nutrition result
 *   6. Return structured array — client shows review card before logging
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  verifyJWT,
  checkRateLimit,
  logEvent,
  preflightResponse,
  jsonResponse,
  supabaseAdmin,
} from './_shared/auth';
import {
  validateNutrition,
  safeParseJSON,
  type ValidNutrition,
} from './_shared/nutritionValidator';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const GEMINI_VISION_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
const MAX_DISHES      = 5;
const TIMEOUT_MS      = 12_000; // vision calls are slower than text

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface IdentifiedDish {
  name:               string;
  estimated_portion:  string;
  confidence:         'high' | 'medium' | 'low';
  ask_clarification?: string;  // e.g. "White or brown rice?"
}

interface DishWithNutrition extends IdentifiedDish {
  nutrition: ValidNutrition | null;
}

// ── GEMINI VISION: IDENTIFY DISHES ────────────────────────────────────────────

async function identifyDishesFromPhoto(
  base64:   string,
  mimeType: string,
): Promise<IdentifiedDish[]> {
  const prompt = `You are an expert in identifying Indian food from photos.
Identify ALL food items visible in this image.
Return ONLY a valid JSON array:
[{"name":"exact Indian dish name","estimated_portion":"e.g. 1 katori - 150g","confidence":"high|medium|low","ask_clarification":"optional question if unclear"}]

Rules:
- Be specific: "Dal Tadka" not "curry", "2 Chapatis" not "bread"
- If no food is visible: return [{"error":"no_food_detected"}]
- If image is too dark/blurry to identify: return [{"error":"image_unclear"}]
- Maximum 5 distinct items
- Do not include condiments (salt, chutney as dip) unless they are the primary item`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_VISION_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) return [];

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    let parsed: unknown;
    try { parsed = safeParseJSON(text); } catch { return []; }

    if (!Array.isArray(parsed)) return [];
    return parsed as IdentifiedDish[];
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

// ── GEMINI TEXT: NUTRITION FOR IDENTIFIED DISH ────────────────────────────────

async function getNutritionForDish(
  name:    string,
  portion: string,
): Promise<ValidNutrition | null> {
  const prompt = `Nutrition for Indian dish: "${name}" (${portion}).
Return ONLY valid JSON:
{"name":"${name}","portion":"${portion}","weight_g":0,"calories":0,"protein":0,"carbs":0,"fat":0,"gl":0,"gi":0,"confidence":"medium","source":"IFCT","notes":""}
Use IFCT values. Protein must be less than calories/4.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(GEMINI_VISION_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: unknown;
    try { parsed = safeParseJSON(text); } catch { return null; }
    const v = validateNutrition(parsed);
    return v.valid ? v.data : null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  // ── Pro-only gate ─────────────────────────────────────────────────────────
  if (auth.plan !== 'pro') {
    return jsonResponse(403, {
      error:   'pro_required',
      feature: 'photo_recognition',
      message: 'Photo food recognition is a Pro feature. Upgrade to NutriSmart Pro for ₹99/month.',
    });
  }

  // ── Rate limit (counts toward same daily AI budget as text search) ─────────
  const { allowed, resetAt } = await checkRateLimit(auth.userId, 'pro');
  if (!allowed) {
    return jsonResponse(429, {
      error:    'rate_limit_exceeded',
      reset_at: resetAt,
    });
  }

  // ── AUDIT FIX R2: image arrives via Supabase Storage path, not base64 body.
  // Client flow: POST /get-upload-url → PUT image directly to storage →
  // send only the ~60-byte path here. Function payload drops 5MB → 100B;
  // the Netlify 6MB cap and slow-4G timeout cliff are gone.
  let body: { image_path?: string; mime_type?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const { image_path, mime_type = 'image/jpeg' } = body;

  if (!image_path) {
    return jsonResponse(400, {
      error:   'image_path_required',
      message: 'Upload the image via /get-upload-url first, then send its path.',
    });
  }

  // Path must belong to the calling user — prevents reading other users' photos
  if (!image_path.startsWith(`${auth.userId}/`)) {
    return jsonResponse(403, { error: 'path_not_owned' });
  }

  if (!ALLOWED_MIME_TYPES.has(mime_type)) {
    return jsonResponse(400, {
      error:   'unsupported_image_type',
      allowed: Array.from(ALLOWED_MIME_TYPES),
    });
  }

  // ── Download from storage (server-side, service role) ────────────────────
  const { data: blob, error: dlError } = await supabaseAdmin.storage
    .from('meal-photos')
    .download(image_path);

  if (dlError || !blob) {
    return jsonResponse(404, {
      error:   'image_not_found',
      message: 'Uploaded image not found — the upload may have failed. Please retry.',
    });
  }

  const imageBuffer = Buffer.from(await blob.arrayBuffer());
  if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
    return jsonResponse(413, {
      error:   'image_too_large',
      max_mb:  4,
      message: 'Image must be under 4MB. Please compress or crop before uploading.',
    });
  }
  const image_base64 = imageBuffer.toString('base64');

  // ── Phase 1: Identify dishes ──────────────────────────────────────────────
  const identified = await identifyDishesFromPhoto(image_base64, mime_type);

  // Fire-and-forget cleanup — photo not needed after analysis (privacy + storage cost)
  supabaseAdmin.storage.from('meal-photos').remove([image_path]).then(() => {});

  // Check for error sentinels from Gemini
  if (identified.length === 0 || (identified[0] as any).error === 'no_food_detected') {
    return jsonResponse(200, {
      found:   false,
      error:   'no_food_detected',
      message: 'No food was detected in this photo. Try better lighting or use the "Describe" mode instead.',
    });
  }

  if ((identified[0] as any).error === 'image_unclear') {
    return jsonResponse(200, {
      found:   false,
      error:   'image_unclear',
      message: 'Image is too dark or blurry to identify dishes. Try better lighting, or describe what you ate.',
    });
  }

  // ── Phase 2: Get nutrition for each identified dish ───────────────────────
  const dishes = identified
    .filter(d => !('error' in d))
    .slice(0, MAX_DISHES);

  const results: DishWithNutrition[] = [];
  for (const dish of dishes) {
    const nutrition = await getNutritionForDish(
      dish.name,
      dish.estimated_portion,
    );
    results.push({ ...dish, nutrition });
  }

  // Filter out dishes where nutrition lookup completely failed
  const successful = results.filter(r => r.nutrition !== null);

  if (successful.length === 0) {
    return jsonResponse(200, {
      found:   false,
      error:   'nutrition_lookup_failed',
      message: 'Dishes identified but nutrition data unavailable. Please search by name.',
      identified_names: dishes.map(d => d.name),
    });
  }

  // ── Analytics ─────────────────────────────────────────────────────────────
  await logEvent(auth.userId, 'photo_search', {
    dish_count:       successful.length,
    avg_confidence:   successful.reduce(
      (sum, d) => sum + (d.confidence === 'high' ? 3 : d.confidence === 'medium' ? 2 : 1), 0
    ) / successful.length,
    had_clarification: successful.some(d => d.ask_clarification),
  });

  return jsonResponse(200, {
    found:   true,
    count:   successful.length,
    results: successful,
  });
};
