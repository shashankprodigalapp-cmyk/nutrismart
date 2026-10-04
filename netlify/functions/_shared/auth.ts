/**
 * netlify/functions/_shared/auth.ts
 * Shared middleware for all Netlify Functions.
 * Validates Supabase JWTs, enforces plan-based rate limits, and normalizes
 * CORS headers. Every protected endpoint imports from here.
 */

import { createClient } from '@supabase/supabase-js';
import type { HandlerEvent, HandlerResponse } from '@netlify/functions';

// Service-role client — bypasses RLS for server-side operations
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export { supabaseAdmin };

// ── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGIN = process.env.APP_URL ?? 'https://nutrismart-app.netlify.app';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age':       '86400',
} as const;

export function preflightResponse(): HandlerResponse {
  return { statusCode: 204, headers: CORS_HEADERS, body: '' };
}

export function jsonResponse(
  statusCode: number,
  body: unknown,
): HandlerResponse {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── JWT VERIFICATION ──────────────────────────────────────────────────────────

export interface AuthResult {
  userId: string;
  plan:   'free' | 'pro';
}

/**
 * Extracts and validates the Bearer JWT from the Authorization header.
 * Returns AuthResult on success, null on failure.
 * Plan is read from the subscriptions table (not from the JWT claim)
 * to prevent clients from self-elevating by forging claims.
 */
export async function verifyJWT(
  event: HandlerEvent,
): Promise<AuthResult | null> {
  const authHeader = event.headers.authorization ?? event.headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);

  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;

    // Fetch current plan from subscriptions (server-authoritative, not JWT)
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('plan, status, valid_until')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const isPro =
      sub?.plan === 'pro' &&
      sub?.status === 'active' &&
      new Date(sub.valid_until) > new Date();

    return { userId: user.id, plan: isPro ? 'pro' : 'free' };
  } catch {
    return null;
  }
}

// ── RATE LIMITING ─────────────────────────────────────────────────────────────

const RATE_LIMITS = { free: 5, pro: 200 } as const;

/**
 * Checks and increments the AI API rate limit for a user.
 * Uses an atomic upsert — safe under concurrent requests.
 * Returns { allowed: true } if under limit, { allowed: false, resetAt } if over.
 */
export async function checkRateLimit(
  userId: string,
  plan:   'free' | 'pro',
): Promise<{ allowed: boolean; resetAt?: string }> {
  const limit = RATE_LIMITS[plan];
  const now   = new Date();

  // Window start = today 00:00:00 IST (Asia/Kolkata — resets at Indian midnight)
  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const windowStart = new Date(istDate + 'T00:00:00+05:30').toISOString();
  const resetAt     = new Date(
    new Date(now.toDateString()).getTime() + 86_400_000
  ).toISOString();

  // Try atomic upsert with conditional check
  const { data, error } = await supabaseAdmin.rpc('increment_rate_limit', {
    p_user_id:      userId,
    p_window_start: windowStart,
    p_limit:        limit,
  });

  if (error) {
    // RPC failed — fail open (allow request) to avoid blocking users on infra issues
    console.error('[rate_limit] RPC error:', error.message);
    return { allowed: true };
  }

  return { allowed: data?.allowed ?? true, resetAt };
}

// ── ANALYTICS EVENT ───────────────────────────────────────────────────────────

export async function logEvent(
  userId:     string,
  eventName:  string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabaseAdmin.from('events').insert({
      user_id:    userId,
      event_name: eventName,
      properties,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal — analytics must never break the primary request flow
  }
}
