import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { FREE_TIER, statusFor, worst, pacificDayFraction, projectToEndOfDay, type Status } from '../_shared/freeTier';

// GET  /api/admin-insights?days=30  -> every number the admin dashboards need (admins only)
// POST /api/admin-insights          -> save the Gemini limits you read from Google AI Studio (admins only)

interface Meter {
  key: string; label: string; used: number | null; limit: number | null; unit: 'count' | 'bytes';
  status: Status; note: string; link?: string; projected?: number | null;
}

async function requireAdmin(request: Request, env: Env) {
  const auth = await verifyJWT(request, env);
  if (!auth) return { error: jsonResponse(env, 401, { error: 'unauthorized' }) } as const;
  const { data: row } = await getSupabaseAdmin(env)
    .from('admin_users').select('role').eq('user_id', auth.userId).maybeSingle();
  if (!row) return { error: jsonResponse(env, 403, { error: 'forbidden', message: 'Admin access required' }) } as const;
  return { userId: auth.userId } as const;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const who = await requireAdmin(request, env);
  if ('error' in who) return who.error;
  const admin = getSupabaseAdmin(env);

  if (request.method === 'POST') {
    let body: { gemini_rpd_limit?: number | null; gemini_rpm_limit?: number | null };
    try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
    const rows = (['gemini_rpd_limit', 'gemini_rpm_limit'] as const)
      .filter(k => k in body)
      .map(k => ({ key: k, value: body[k] ?? null, updated_at: new Date().toISOString(), updated_by: who.userId }));
    for (const r of rows) {
      if (r.value !== null && !(typeof r.value === 'number' && r.value > 0 && r.value < 1e9)) {
        return jsonResponse(env, 400, { error: 'bad_value', key: r.key });
      }
    }
    if (rows.length) await admin.from('admin_settings').upsert(rows, { onConflict: 'key' });
    return jsonResponse(env, 200, { ok: true });
  }

  const days = Math.max(1, Math.min(180, parseInt(new URL(request.url).searchParams.get('days') ?? '30', 10) || 30));

  try {
    const { data: insights, error } = await admin.rpc('admin_insights', { p_days: days });
    if (error || !insights) {
      console.error('[admin-insights] rpc failed', error?.message);
      return jsonResponse(env, 500, { error: 'insights_unavailable', hint: 'Run migration 013_admin_insights.sql in Supabase.' });
    }

    const { data: setRows } = await admin.from('admin_settings').select('key, value')
      .in('key', ['gemini_rpd_limit', 'gemini_rpm_limit']);
    const settings: Record<string, number | null> = { gemini_rpd_limit: null, gemini_rpm_limit: null };
    for (const r of setRows ?? []) settings[r.key] = typeof r.value === 'number' ? r.value : null;

    const sys = insights.system ?? {};
    const today = insights.ai_today ?? {};
    const geminiToday = Number(today.gemini_calls ?? 0);
    const limited = Number(today.gemini_limited ?? 0);
    const fraction = pacificDayFraction(new Date());
    const projected = projectToEndOfDay(geminiToday, fraction);

    let rpdStatus = statusFor(Math.max(geminiToday, projected ?? 0), settings.gemini_rpd_limit);
    if (limited > 0) rpdStatus = 'critical';

    const meters: Meter[] = [
      {
        key: 'gemini_rpd', label: 'Gemini requests today', used: geminiToday, limit: settings.gemini_rpd_limit, unit: 'count',
        status: rpdStatus, projected,
        note: limited > 0
          ? `Google refused ${limited} request(s) today. The free daily limit has been hit.`
          : settings.gemini_rpd_limit ? 'Counts every real Gemini call today (US Pacific day, resets 12:30 or 13:30 IST).'
          : 'Enter your daily limit from Google AI Studio to turn this into a percentage.',
        link: 'https://aistudio.google.com/rate-limit',
      },
      {
        key: 'gemini_rpm', label: 'Gemini busiest minute (last 24h)', used: Number(today.peak_per_minute_24h ?? 0),
        limit: settings.gemini_rpm_limit, unit: 'count', status: statusFor(Number(today.peak_per_minute_24h ?? 0), settings.gemini_rpm_limit),
        note: 'Requests in the busiest single minute. Google also limits per minute.', link: 'https://aistudio.google.com/rate-limit',
      },
      {
        key: 'supabase_db', label: 'Supabase database size', used: Number(sys.db_bytes ?? 0), limit: FREE_TIER.supabase_db_bytes, unit: 'bytes',
        status: statusFor(Number(sys.db_bytes ?? 0), FREE_TIER.supabase_db_bytes),
        note: 'Free plan allows 500 MB. When full, writes can fail.', link: 'https://supabase.com/dashboard/project/_/settings/usage',
      },
      {
        key: 'supabase_storage', label: 'Supabase file storage', used: Number(sys.storage_bytes ?? 0), limit: FREE_TIER.supabase_storage_bytes, unit: 'bytes',
        status: statusFor(Number(sys.storage_bytes ?? 0), FREE_TIER.supabase_storage_bytes), note: 'Free plan allows 1 GB (photo uploads).',
      },
      {
        key: 'supabase_mau', label: 'Supabase monthly active users', used: Number(sys.mau_auth ?? 0), limit: FREE_TIER.supabase_mau, unit: 'count',
        status: statusFor(Number(sys.mau_auth ?? 0), FREE_TIER.supabase_mau), note: 'People who signed in during the last 30 days. Free plan allows 50,000.',
      },
      {
        key: 'supabase_egress', label: 'Supabase data transfer', used: null, limit: FREE_TIER.supabase_egress_bytes, unit: 'bytes',
        status: 'unknown', note: 'Free plan allows 5 GB a month. The app cannot read this. Check it in Supabase.',
        link: 'https://supabase.com/dashboard/project/_/settings/usage',
      },
      {
        key: 'cloudflare', label: 'Cloudflare requests today', used: null, limit: FREE_TIER.cloudflare_requests_per_day, unit: 'count',
        status: 'unknown', note: 'Free plan allows about 100,000 a day, shared by the site functions. Check it in Cloudflare.',
        link: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages',
      },
    ];

    // Remember who looked (at most once every 10 minutes per admin)
    const { data: last } = await admin.from('admin_audit').select('created_at')
      .eq('admin_id', who.userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!last || Date.now() - new Date(last.created_at as string).getTime() > 10 * 60_000) {
      await admin.from('admin_audit').insert({ admin_id: who.userId, action: 'view_insights' });
      await admin.rpc('admin_prune_logs');
    }

    return jsonResponse(env, 200, {
      generated_at: new Date().toISOString(),
      days,
      health: worst(meters.map(m => m.status)),
      limits_checked_on: FREE_TIER.checked_on,
      settings,
      meters,
      insights,
    });
  } catch (err) {
    console.error('[admin-insights] error', err);
    return jsonResponse(env, 500, { error: 'internal_error' });
  }
};
