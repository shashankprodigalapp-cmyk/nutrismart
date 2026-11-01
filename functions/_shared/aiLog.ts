import type { Env } from './auth';
import { getSupabaseAdmin } from './auth';

export type AiEndpoint = 'name' | 'describe' | 'vision' | 'vision_lookup' | 'embed' | 'review';
export type AiProvider = 'gemini' | 'claude';

/** Pull the model name out of a Gemini URL, or out of a Claude request body. Never reads the API key. */
export function modelFrom(provider: AiProvider, url: string, init?: RequestInit): string {
  if (provider === 'gemini') return /models\/([^:/?]+)/.exec(url)?.[1] ?? 'gemini';
  try { return JSON.parse(String(init?.body ?? '{}')).model ?? 'claude'; } catch { return 'claude'; }
}

/** Gemini accepts the key as a header for every key type (the newer "AQ." keys need it) and it keeps the key out of URLs and logs.
 *  Takes a URL that still carries ?key=..., returns the clean URL and the request settings with the trimmed key in x-goog-api-key. */
export function withGeminiKey(url: string, init: RequestInit): { url: string; init: RequestInit } {
  const m = /([?&])key=([^&]*)/.exec(url);
  if (!m) return { url, init };
  let key = m[2]; try { key = decodeURIComponent(key); } catch { /* keep as is */ }
  key = key.trim().replace(/^["']|["']$/g, '');
  const clean = url.replace(/([?&])key=[^&]*&?/, (_all, sep) => (sep === '?' ? '?' : '')).replace(/[?&]$/, '');
  return { url: clean, init: { ...init, headers: { ...(init.headers as Record<string, string> | undefined), 'x-goog-api-key': key } } };
}

export function geminiFetch(url: string, init: RequestInit): Promise<Response> { const g = withGeminiKey(url, init); return fetch(g.url, g.init); }

export function usageFrom(provider: AiProvider, json: any): { input?: number; output?: number } {
  if (provider === 'gemini') {
    const u = json?.usageMetadata;
    return { input: u?.promptTokenCount, output: u?.candidatesTokenCount };
  }
  return { input: json?.usage?.input_tokens, output: json?.usage?.output_tokens };
}

export function outcomeFor(status: number): 'ok' | 'rate_limited' | 'http_error' {
  if (status >= 200 && status < 300) return 'ok';
  return status === 429 ? 'rate_limited' : 'http_error';
}

async function record(env: Env, row: Record<string, unknown>): Promise<void> {
  try {
    await getSupabaseAdmin(env).from('ai_call_log').insert(row);
  } catch { /* logging must never break a food search */ }
}

/**
 * Drop-in replacement for fetch() on AI calls. Same response, but every real call
 * to Gemini or Claude is written to ai_call_log (no prompts, no keys, no food text).
 */
export async function aiFetch(
  env: Env, endpoint: AiEndpoint, provider: AiProvider, url: string, init: RequestInit,
): Promise<Response> {
  const t0 = Date.now();
  const model = modelFrom(provider, url, init);
  let res: Response;
  try {
    if (provider === 'gemini') { const g = withGeminiKey(url, init); res = await fetch(g.url, g.init); } else res = await fetch(url, init);
  } catch (e) {
    await record(env, { endpoint, provider, model, outcome: 'network_error', latency_ms: Date.now() - t0 });
    throw e;
  }
  let usage: { input?: number; output?: number } = {};
  if (res.ok && endpoint !== 'embed') {
    try { usage = usageFrom(provider, await res.clone().json()); } catch { /* ignore */ }
  }
  await record(env, {
    endpoint, provider, model, outcome: outcomeFor(res.status), http_status: res.status,
    input_tokens: usage.input ?? null, output_tokens: usage.output ?? null, latency_ms: Date.now() - t0,
  });
  return res;
}
