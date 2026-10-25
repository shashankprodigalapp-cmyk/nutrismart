import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { FREE_TIER, GEMINI_MODELS, statusFor, worst, pacificDayFraction, buildModelMeters, resolveLimits, type Status, type ModelLimit } from '../_shared/freeTier';

// GET  /api/admin-insights?days=30  -> every number the admin dashboards need (admins only)
// POST /api/admin-insights          -> save the per-model Gemini limits from Google AI Studio (admins only)

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
    let body: { model_limits?: Record<string, { rpd?: number | null; rpm?: number | null }> };
    try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
    const incoming = body.model_limits;
    if (!incoming || typeof incoming !== 'object') return jsonResponse(env, 400, { error: 'model_limits_required' });
    const clean: Record<string, ModelLimit> = {};
    for (const m of GEMINI_MODELS) {
      const v = incoming[m.model];
      if (!v) continue;
      for (const k of ['rpd', 'rpm'] as const) {
        const n = v[k];
        if (n !== null && n !== undefined && !(typeof n === 'number' && n > 0 && n < 1e9)) {
          return jsonResponse(env, 400, { error: 'bad_value', key: `${m.model}.${k}` });
        }
      }
      clean[m.model] = { rpd: v.rpd ?? null, rpm: v.rpm ?? null };
    }
    await admin.from('admin_settings').upsert(
      { key: 'gemini_model_limits', value: clean, updated_at: new Date().toISOString(), updated_by: who.userId },
      { onConflict: 'key' });
    return jsonResponse(env, 200, { ok: true });
  }

  const days = Math.max(1, Math.min(180, parseInt(new URL(request.url).searchParams.get('days') ?? '30', 10) || 30));

  try {
    const { data: insights, error } = await admin.rpc('admin_insights', { p_days: days });
    if (error || !insights) {
      console.error('[admin-insights] rpc failed', error?.message);
      return jsonResponse(env, 500, { error: 'insights_unavailable', hint: 'Run migration 013_admin_insights.sql in Supabase.' });
    }

    const { data: setRow } = await admin.from('admin_settings').select('value').eq('key', 'gemini_model_limits').maybeSingle();
    const limits = resolveLimits((setRow?.value ?? null) as Record<string, Partial<ModelLimit>> | null);

    const { data: byModel, error: bmErr } = await admin.rpc('admin_ai_by_model');
    if (bmErr) console.error('[admin-insights] admin_ai_by_model failed (run migration 014)', bmErr.message);

    const sys = insights.system ?? {};
    const fraction = pacificDayFraction(new Date());
    const geminiMeters: Meter[] = buildModelMeters(Array.isArray(byModel) ? byModel : [], limits, fraction).map(m => ({
      key: m.key, label: m.label, used: m.used, limit: m.limit, unit: 'count' as const,
      status: m.status, projected: m.projected, note: bmErr ? 'Run migration 014_ai_by_model.sql in Supabase to see this.' : m.note,
      link: 'https://aistudio.google.com/rate-limit',
    }));

    const meters: Meter[] = [
      ...geminiMeters,
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
      settings: { model_limits: limits },
      meters,
      insights,
    });
  } catch (err) {
    console.error('[admin-insights] error', err);
    return jsonResponse(env, 500, { error: 'internal_error' });
  }
};
