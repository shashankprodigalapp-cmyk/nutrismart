import type { Env } from '../_shared/auth';
import {
  verifyJWT,
  checkRateLimit,
  logEvent,
  preflightResponse,
  jsonResponse,
  getSupabaseAdmin,
} from '../_shared/auth';
import {
  validateNutrition,
  safeParseJSON,
  type ValidNutrition,
} from '../_shared/nutritionValidator';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DISHES      = 5;
const TIMEOUT_MS      = 12_000;

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

interface IdentifiedDish {
  name:               string;
  estimated_portion:  string;
  confidence:         'high' | 'medium' | 'low';
  ask_clarification?: string;
}

interface DishWithNutrition extends IdentifiedDish {
  nutrition: ValidNutrition | null;
}

async function identifyDishesFromPhoto(
  base64:   string,
  mimeType: string,
  env:      Env,
): Promise<IdentifiedDish[]> {
  const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
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

    const data = await res.json() as any;
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

async function getNutritionForDish(
  name:    string,
  portion: string,
  env:     Env,
): Promise<ValidNutrition | null> {
  const GEMINI_VISION_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${env.GEMINI_API_KEY}`;
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
    const data = await res.json() as any;
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

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  if (auth.plan !== 'pro') {
    return jsonResponse(env, 403, {
      error:   'pro_required',
      feature: 'photo_recognition',
      message: 'Photo food recognition is a Pro feature. Upgrade to NutriSmart Pro for ₹99/month.',
    });
  }

  const { allowed, resetAt } = await checkRateLimit(env, auth.userId, 'pro');
  if (!allowed) {
    return jsonResponse(env, 429, {
      error:    'rate_limit_exceeded',
      reset_at: resetAt,
    });
  }

  let body: { image_path?: string; mime_type?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse(env, 400, { error: 'invalid_json' });
  }

  const { image_path, mime_type = 'image/jpeg' } = body;

  if (!image_path) {
    return jsonResponse(env, 400, {
      error:   'image_path_required',
      message: 'Upload the image via /get-upload-url first, then send its path.',
    });
  }

  if (!image_path.startsWith(`${auth.userId}/`)) {
    return jsonResponse(env, 403, { error: 'path_not_owned' });
  }

  if (!ALLOWED_MIME_TYPES.has(mime_type)) {
    return jsonResponse(env, 400, {
      error:   'unsupported_image_type',
      allowed: Array.from(ALLOWED_MIME_TYPES),
    });
  }

  const supabaseAdmin = getSupabaseAdmin(env);

  const { data: blob, error: dlError } = await supabaseAdmin.storage
    .from('meal-photos')
    .download(image_path);

  if (dlError || !blob) {
    return jsonResponse(env, 404, {
      error:   'image_not_found',
      message: 'Uploaded image not found — the upload may have failed. Please retry.',
    });
  }

  const arrayBuffer = await blob.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
    return jsonResponse(env, 413, {
      error:   'image_too_large',
      max_mb:  4,
      message: 'Image must be under 4MB. Please compress or crop before uploading.',
    });
  }

  // Base64-encode without Node's Buffer (works natively in Workers runtime)
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const image_base64 = btoa(binary);

  const identified = await identifyDishesFromPhoto(image_base64, mime_type, env);

  supabaseAdmin.storage.from('meal-photos').remove([image_path]).then(() => {});

  if (identified.length === 0 || (identified[0] as any).error === 'no_food_detected') {
    return jsonResponse(env, 200, {
      found:   false,
      error:   'no_food_detected',
      message: 'No food was detected in this photo. Try better lighting or use the "Describe" mode instead.',
    });
  }

  if ((identified[0] as any).error === 'image_unclear') {
    return jsonResponse(env, 200, {
      found:   false,
      error:   'image_unclear',
      message: 'Image is too dark or blurry to identify dishes. Try better lighting, or describe what you ate.',
    });
  }

  const dishes = identified
    .filter(d => !('error' in d))
    .slice(0, MAX_DISHES);

  const results: DishWithNutrition[] = [];
  for (const dish of dishes) {
    const nutrition = await getNutritionForDish(dish.name, dish.estimated_portion, env);
    results.push({ ...dish, nutrition });
  }

  const successful = results.filter(r => r.nutrition !== null);

  if (successful.length === 0) {
    return jsonResponse(env, 200, {
      found:   false,
      error:   'nutrition_lookup_failed',
      message: 'Dishes identified but nutrition data unavailable. Please search by name.',
      identified_names: dishes.map(d => d.name),
    });
  }

  await logEvent(env, auth.userId, 'photo_search', {
    dish_count:       successful.length,
    avg_confidence:   successful.reduce(
      (sum, d) => sum + (d.confidence === 'high' ? 3 : d.confidence === 'medium' ? 2 : 1), 0
    ) / successful.length,
    had_clarification: successful.some(d => d.ask_clarification),
  });

  return jsonResponse(env, 200, {
    found:   true,
    count:   successful.length,
    results: successful,
  });
};
