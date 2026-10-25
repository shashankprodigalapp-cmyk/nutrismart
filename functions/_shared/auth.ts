import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_URL?: string;
  GEMINI_API_KEY: string;
  CLAUDE_API_KEY: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  CRON_SECRET?: string;
  RAZORPAY_WEBHOOK_SECRET: string;
}

export function getSupabaseAdmin(env: Env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export function corsHeaders(env: Env): Record<string, string> {
  const origin = env.APP_URL ?? 'https://nutrismart-3bb.pages.dev';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export function preflightResponse(env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(env) });
}

export function jsonResponse(env: Env, statusCode: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { ...corsHeaders(env), 'Content-Type': 'application/json' },
  });
}

export interface AuthResult {
  userId: string;
  plan: 'free' | 'pro';
}

export async function verifyJWT(request: Request, env: Env): Promise<AuthResult | null> {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const supabaseAdmin = getSupabaseAdmin(env);
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;

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

// Two separate daily allowances (reset at IST midnight): AI searches and photo searches.
export type RateKind = 'search' | 'photo';
const RATE_LIMITS = { search: { free: 5, pro: 200 }, photo: { free: 1, pro: 20 } } as const;

// The photo counter lives in the same table, one second after midnight, so it is a different row from the search counter.
function windowStartFor(istDate: string, kind: RateKind): string {
  return new Date(new Date(istDate + 'T00:00:00+05:30').getTime() + (kind === 'photo' ? 1000 : 0)).toISOString();
}

export async function checkRateLimit(
  env: Env,
  userId: string,
  plan: 'free' | 'pro',
  kind: RateKind = 'search',
): Promise<{ allowed: boolean; resetAt?: string }> {
  const supabaseAdmin = getSupabaseAdmin(env);
  const limit = RATE_LIMITS[kind][plan];
  const now = new Date();

  const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const windowStart = windowStartFor(istDate, kind);
  const resetAt = new Date(new Date(now.toDateString()).getTime() + 86_400_000).toISOString();

  const { data, error } = await supabaseAdmin.rpc('increment_rate_limit', {
    p_user_id: userId,
    p_window_start: windowStart,
    p_limit: limit,
  });

  if (error) {
    console.error('[rate_limit] RPC error:', error.message);
    return { allowed: true };
  }
  return { allowed: data?.allowed ?? true, resetAt };
}

/** Give one search back when our side failed (Google error, unreadable result), so the person does not lose their allowance for nothing. */
export async function refundRateLimit(env: Env, userId: string, kind: RateKind = 'search'): Promise<void> {
  try {
    const admin = getSupabaseAdmin(env);
    const istDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const windowStart = windowStartFor(istDate, kind);
    const { data } = await admin.from('rate_limits').select('count').eq('user_id', userId).eq('window_start', windowStart).maybeSingle();
    if (data && data.count > 0) {
      await admin.from('rate_limits').update({ count: data.count - 1 }).eq('user_id', userId).eq('window_start', windowStart);
    }
  } catch { /* never block a response over a refund */ }
}

export async function logEvent(
  env: Env,
  userId: string,
  eventName: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabaseAdmin = getSupabaseAdmin(env);
    await supabaseAdmin.from('events').insert({
      user_id: userId,
      event_name: eventName,
      properties,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Non-fatal
  }
}
