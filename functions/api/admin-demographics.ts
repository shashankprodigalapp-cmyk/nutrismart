import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';

// GET /api/admin-demographics -> profile answers (who the users are) for the admin screen (admins only).
// Aggregates only: counts and percentages, never one person's food.

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  const admin = getSupabaseAdmin(env);
  const { data: row } = await admin.from('admin_users').select('role').eq('user_id', auth.userId).maybeSingle();
  if (!row) return jsonResponse(env, 403, { error: 'forbidden', message: 'Admin access required' });

    try {
    const { data, error } = await admin.rpc('admin_demographics');
    if (error || !data) {
      console.error('[admin-demographics] rpc failed', error?.message);
      return jsonResponse(env, 500, { error: 'demographics_unavailable', hint: 'Run migration 016_user_profile.sql in Supabase.' });
    }

    const { data: last } = await admin.from('admin_audit').select('created_at')
      .eq('admin_id', auth.userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!last || Date.now() - new Date(last.created_at as string).getTime() > 10 * 60_000) {
      await admin.from('admin_audit').insert({ admin_id: auth.userId, action: 'view_demographics' });
    }

    return jsonResponse(env, 200, { generated_at: new Date().toISOString(), demographics: data });
  } catch (err) {
    console.error('[admin-demographics] error', err);
    return jsonResponse(env, 500, { error: 'internal_error' });
  }
};
