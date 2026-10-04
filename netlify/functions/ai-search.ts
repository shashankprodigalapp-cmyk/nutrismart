/**
 * netlify/functions/ai-search.ts — AI Food Search Proxy
 * Module 4, Steps 4.1 + 4.2
 *
 * Modes:
 *   name    → Gemini 1.5 Flash text lookup
 *   describe → Claude Haiku NL parsing (Hinglish support)
 *
 * Security: JWT verified → plan checked → rate limited before any AI call.
 * All API keys stay server-side. Response validated before returning to client.
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  verifyJWT,
  checkRateLimit,
  logEvent,
  preflightResponse,
  jsonResponse,
  CORS_HEADERS,
  supabaseAdmin,
} from './_shared/auth';
import {
  validateNutrition,
  safeParseJSON,
  type ValidNutrition,
} from './_shared/nutritionValidator';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

const CLAUDE_URL = 'https://api.anthropic.com/v1/messages';

const REQUEST_TIMEOUT_MS = 8000;

// ── SEMANTIC CACHE (TASK 1: Cache-First) ─────────────────────────────────────
// Before spending a Gemini call, embed the query (text-embedding-004, ~10× cheaper
// than a generation call) and look for a >0.9 cosine match in food_semantic_cache.
// Cache hits return in <50ms with zero generation cost.

const EMBED_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`;

const CACHE_SIMILARITY_THRESHOLD = 0.9;

async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(EMBED_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:   'models/text-embedding-004',
        content: { parts: [{ text: text.toLowerCase().trim() }] },
      }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    const values = data?.embedding?.values;
    return Array.isArray(values) && values.length === 768 ? values : null;
  } catch {
    return null; // embedding failure = cache miss, fall through to Gemini
  }
}

interface CacheHit {
  id:                string;
  food_name:         string;
  nutritional_jsonb: ValidNutrition;
  similarity:        number;
}

async function checkSemanticCache(embedding: number[]): Promise<CacheHit | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('match_cached_food', {
      p_embedding: JSON.stringify(embedding),
      p_threshold: CACHE_SIMILARITY_THRESHOLD,
    });
    if (error || !data?.length) return null;
    return data[0] as CacheHit;
  } catch {
    return null;
  }
}

async function saveToSemanticCache(
  query: string, embedding: number[], result: ValidNutrition, source: 'gemini' | 'claude',
): Promise<void> {
  try {
    // upsert on lower(food_name) unique index — ignore conflicts
    await supabaseAdmin.from('food_semantic_cache').upsert({
      food_name:         query.toLowerCase().trim(),
      embedding:         JSON.stringify(embedding),
      nutritional_jsonb: result,
      source,
    }, { onConflict: 'food_name', ignoreDuplicates: true });
  } catch {
    // Cache write failure never blocks the response
  }
}


// Common Hinglish fallback map — returned when Claude times out
const HINGLISH_FALLBACK: Record<string, Partial<ValidNutrition>> = {
  'dal chawal':     { name: 'Dal Chawal', portion: '1 plate (dal + rice)', calories: 450, protein: 14, carbs: 70, fat: 10, gl: 30 },
  'roti sabzi':     { name: 'Roti Sabzi', portion: '2 roti + 1 katori sabzi', calories: 320, protein: 10, carbs: 52, fat: 8, gl: 20 },
  'poha':           { name: 'Poha', portion: '1 plate - 200g', calories: 250, protein: 5, carbs: 40, fat: 8, gl: 20 },
  'upma':           { name: 'Upma', portion: '1 plate - 200g', calories: 220, protein: 5, carbs: 36, fat: 7, gl: 18 },
  'idli sambar':    { name: 'Idli Sambar', portion: '3 idli + sambar', calories: 310, protein: 10, carbs: 56, fat: 5, gl: 22 },
  'curd rice':      { name: 'Curd Rice', portion: '1 plate - 250g', calories: 280, protein: 8, carbs: 48, fat: 6, gl: 24 },
  'pav bhaji':      { name: 'Pav Bhaji', portion: '2 pav + bhaji', calories: 520, protein: 12, carbs: 80, fat: 14, gl: 38 },
  'vada pav':       { name: 'Vada Pav', portion: '1 piece', calories: 290, protein: 6, carbs: 42, fat: 10, gl: 28 },
  'chai':           { name: 'Chai (with milk and sugar)', portion: '1 cup - 150ml', calories: 60, protein: 2, carbs: 8, fat: 2, gl: 6 },
};

function getHinglishFallback(description: string): ValidNutrition[] {
  const lower = description.toLowerCase();
  return Object.entries(HINGLISH_FALLBACK)
    .filter(([key]) => lower.includes(key))
    .map(([, val]) => ({
      name: '', portion: '1 serving', calories: 200, protein: 6,
      carbs: 30, fat: 5, gl: 15, confidence: 'low' as const,
      source: 'NutriSmart estimate',
      ...val,
    }));
}

// ── GEMINI TEXT LOOKUP ────────────────────────────────────────────────────────

async function geminiNameLookup(foodName: string): Promise<ValidNutrition | null> {
  const prompt = `You are a nutrition database for Indian cuisine. Return ONLY valid JSON, no markdown.
Food: "${foodName}"
Return exactly this schema:
{"name":"","portion":"","weight_g":0,"calories":0,"protein":0,"carbs":0,"fat":0,"fiber":0,"gl":0,"gi":0,"confidence":"medium","source":"IFCT","notes":""}
Use IFCT values where available. confidence: high=IFCT verified, medium=estimate, low=guess.
Calories must be > 0. Protein must be less than calories/4.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_URL, {
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
    try {
      parsed = safeParseJSON(text);
    } catch {
      // Retry with stricter instruction
      const retryPrompt = prompt + '\nIMPORTANT: Your previous response was not valid JSON. Return ONLY the JSON object, absolutely nothing else.';
      const retryRes = await fetch(GEMINI_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: retryPrompt }] }],
          generationConfig: { temperature: 0.0, maxOutputTokens: 400 },
        }),
      });
      if (!retryRes.ok) return null;
      const retryData = await retryRes.json();
      const retryText = retryData.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      try { parsed = safeParseJSON(retryText); } catch { return null; }
    }

    const validation = validateNutrition(parsed);
    return validation.valid ? validation.data : null;
  } catch (err: any) {
    if (err.name === 'AbortError') return null; // timeout
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── CLAUDE HINGLISH DESCRIPTION LOOKUP ───────────────────────────────────────

async function claudeDescriptionLookup(description: string): Promise<ValidNutrition[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(CLAUDE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.CLAUDE_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 600,
        system: `You are a nutrition expert for Indian food. Parse casual Hinglish descriptions.
Return ONLY a JSON array (never a single object). Each item:
{"name":"","portion":"","calories":0,"protein":0,"carbs":0,"fat":0,"gl":0,"confidence":"medium","source":"Claude estimate","notes":""}
Be specific: say "Dal Tadka" not "curry". Estimate portions from context.
Protein must be less than calories/4. Return [] if you truly cannot identify any food.`,
        messages: [{ role: 'user', content: `What did I eat: "${description}"` }],
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) return getHinglishFallback(description);

    const data = await res.json();
    const text = data.content?.[0]?.text ?? '';

    let parsed: unknown;
    try { parsed = safeParseJSON(text); } catch {
      return getHinglishFallback(description);
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];
    const valid: ValidNutrition[] = [];
    for (const item of arr) {
      const v = validateNutrition(item);
      if (v.valid) valid.push(v.data);
    }

    return valid.length > 0 ? valid : getHinglishFallback(description);
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') return getHinglishFallback(description);
    return getHinglishFallback(description);
  }
}

// ── HANDLER ───────────────────────────────────────────────────────────────────

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') return preflightResponse();
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await verifyJWT(event);
  if (!auth) return jsonResponse(401, { error: 'unauthorized' });

  // ── Rate limit ────────────────────────────────────────────────────────────
  const { allowed, resetAt } = await checkRateLimit(auth.userId, auth.plan);
  if (!allowed) {
    return jsonResponse(429, {
      error:    'rate_limit_exceeded',
      plan:     auth.plan,
      reset_at: resetAt,
      message:  auth.plan === 'free'
        ? 'Free plan allows 5 AI searches/day. Upgrade to Pro for 200/day.'
        : 'You have used 200 AI searches today. Limit resets at midnight IST.',
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: { mode?: string; query?: string };
  try {
    body = JSON.parse(event.body ?? '{}');
  } catch {
    return jsonResponse(400, { error: 'invalid_json' });
  }

  const { mode, query } = body;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return jsonResponse(400, { error: 'query_required' });
  }
  if (query.length > 500) {
    return jsonResponse(400, { error: 'query_too_long', max: 500 });
  }

  // ── Route by mode ─────────────────────────────────────────────────────────
  try {
    if (mode === 'name') {
      // ── CACHE-FIRST: embed query, check pgvector cache before Gemini ──────
      const embedding = await embedQuery(query.trim());
      if (embedding) {
        const hit = await checkSemanticCache(embedding);
        if (hit) {
          // Fire-and-forget hit counter (no await — keep latency low)
          supabaseAdmin.rpc('record_cache_hit', { p_cache_id: hit.id }).then(() => {});
          await logEvent(auth.userId, 'ai_search_name', {
            query: query.trim().slice(0, 100),
            found: true, cache_hit: true, similarity: hit.similarity,
          });
          return jsonResponse(200, {
            found: true, result: hit.nutritional_jsonb,
            cached: true, similarity: Math.round(hit.similarity * 1000) / 1000,
          });
        }
      }

      const result = await geminiNameLookup(query.trim());
      if (!result) {
        return jsonResponse(200, {
          found:   false,
          error:   'not_found',
          message: 'Could not identify this food. Try describing it instead.',
        });
      }
      // Populate cache for next time (embedding may be null if embed failed)
      if (embedding && result.confidence !== 'low') {
        await saveToSemanticCache(query.trim(), embedding, result, 'gemini');
      }
      await logEvent(auth.userId, 'ai_search_name', {
        query: query.trim().slice(0, 100),
        found: true, cache_hit: false,
        confidence: result.confidence,
      });
      return jsonResponse(200, { found: true, result });
    }

    if (mode === 'describe') {
      const results = await claudeDescriptionLookup(query.trim());
      if (results.length === 0) {
        return jsonResponse(200, {
          found:   false,
          error:   'too_vague',
          message: 'Could not identify specific foods. Try including the dish name or portion size.',
        });
      }
      await logEvent(auth.userId, 'ai_search_describe', {
        query:  query.trim().slice(0, 100),
        count:  results.length,
      });
      return jsonResponse(200, { found: true, results });
    }

    return jsonResponse(400, {
      error:   'invalid_mode',
      message: 'mode must be "name" or "describe". For photos, use the ai-photo endpoint.',
    });
  } catch (err) {
    console.error('[ai-search] Unhandled error:', err);
    return jsonResponse(500, { error: 'internal_error' });
  }
};
