/**
 * promote-food-cache.ts — TASK 3.2: popular custom food → semantic cache
 *
 * Called by SyncManager when a user's custom food reaches 10 uses.
 * Embeds the food name (text-embedding-004) and inserts into
 * food_semantic_cache using the service role — the only path allowed
 * to write vectors (clients have zero RLS policies on that table).
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import { verifyJWT, supabaseAdmin, preflightResponse, jsonResponse } from './_shared/auth';
import { validateNutrition } from './_shared/nutritionValidator';

const EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST')   return jsonResponse(405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  let body: any;
  try { body = JSON.parse(event.body ?? '{}'); }
  catch { return jsonResponse(400, { error: 'invalid_json' }); }

  const { food_name, calories, protein, carbs, fat, gl, portion } = body;
  if (!food_name?.trim()) return jsonResponse(400, { error: 'food_name_required' });

  // Validate nutrition before it can pollute the shared cache
  const validation = validateNutrition({ name: food_name, calories, protein, carbs, fat, gl, portion });
  if (!validation.valid) {
    return jsonResponse(422, { error: 'invalid_nutrition', issues: validation.errors });
  }

  // Embed the name
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
      const data = await res.json();
      const v = data?.embedding?.values;
      if (Array.isArray(v) && v.length === 768) embedding = v;
    }
  } catch { /* fall through */ }

  if (!embedding) return jsonResponse(502, { error: 'embedding_failed' });

  const { error } = await supabaseAdmin.from('food_semantic_cache').upsert({
    food_name:         food_name.toLowerCase().trim(),
    embedding:         JSON.stringify(embedding),
    nutritional_jsonb: validation.data,
    source:            'popular_custom',
  }, { onConflict: 'food_name', ignoreDuplicates: true });

  if (error) {
    console.error('[promote-food-cache]', error.message);
    return jsonResponse(500, { error: 'cache_insert_failed' });
  }

  return jsonResponse(200, { success: true, promoted: food_name });
};
