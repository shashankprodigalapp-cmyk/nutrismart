import type { Env } from '../_shared/auth';
import { verifyJWT, getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { validateNutrition } from '../_shared/nutritionValidator';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST')   return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  let body: any;
  try { body = await request.json(); }
  catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }

  const { food_name, calories, protein, carbs, fat, gl, portion } = body;
  if (!food_name?.trim()) return jsonResponse(env, 400, { error: 'food_name_required' });

  const validation = validateNutrition({ name: food_name, calories, protein, carbs, fat, gl, portion });
  if (!validation.valid) {
    return jsonResponse(env, 422, { error: 'invalid_nutrition', issues: validation.errors });
  }

  const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${env.GEMINI_API_KEY}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 4000);
  let embedding: number[] | null = null;
  try {
    const res = await fetch(EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: food_name.toLowerCase().trim() }] },
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json() as any;
      const v = data?.embedding?.values;
      if (Array.isArray(v) && v.length === 768) embedding = v;
    }
  } catch { /* fall through */ }

  if (!embedding) return jsonResponse(env, 502, { error: 'embedding_failed' });

  const supabaseAdmin = getSupabaseAdmin(env);
  const { error } = await supabaseAdmin.from('food_semantic_cache').upsert({
    food_name:         food_name.toLowerCase().trim(),
    embedding:         JSON.stringify(embedding),
    nutritional_jsonb: validation.data,
    source:            'popular_custom',
  }, { onConflict: 'food_name', ignoreDuplicates: true });

  if (error) {
    console.error('[promote-food-cache]', error.message);
    return jsonResponse(env, 500, { error: 'cache_insert_failed' });
  }

  return jsonResponse(env, 200, { success: true, promoted: food_name });
};
