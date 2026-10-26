import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { normalizeFoodKey } from '../_shared/foodQuery';

// GET  /api/admin-search-review          -> words the AI said are not foods (pending) and the blocked list (admins only)
// POST /api/admin-search-review {term, action: 'block' | 'dismiss' | 'unblock'}
// POST {food_id, action: 'food_verify' | 'food_delete'}: approve or remove a food the AI added (unverified master_foods row).
// The list holds the typed words only. It never says who typed them.

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'GET' && request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  const admin = getSupabaseAdmin(env);
  const { data: row } = await admin.from('admin_users').select('role').eq('user_id', auth.userId).maybeSingle();
  if (!row) return jsonResponse(env, 403, { error: 'forbidden', message: 'Admin access required' });

  try {
    if (request.method === 'POST') {
      let body: { term?: string; action?: string };
      try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
      if (body.action === 'food_verify' || body.action === 'food_delete') {
        const id = String((body as { food_id?: string }).food_id ?? '');
        if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse(env, 400, { error: 'bad_food_id' });
        const q = body.action === 'food_verify'
          ? admin.from('master_foods').update({ verified: true }).eq('id', id).eq('verified', false)
          : admin.from('master_foods').delete().eq('id', id).eq('verified', false);
        const { error } = await q;
        if (error) return jsonResponse(env, 409, { error: 'food_change_failed', message: 'Could not change this food. It may already be used in logs; approve it instead.' });
        await admin.from('admin_audit').insert({ admin_id: auth.userId, action: 'ai_' + body.action });
        return jsonResponse(env, 200, { ok: true });
      }
      const term = normalizeFoodKey(String(body.term ?? '')).slice(0, 80);
      if (!term) return jsonResponse(env, 400, { error: 'term_required' });
      const status = body.action === 'block' ? 'blocked' : body.action === 'dismiss' ? 'dismissed' : body.action === 'unblock' ? 'pending' : null;
      if (!status) return jsonResponse(env, 400, { error: 'bad_action' });
      const { error } = await admin.from('search_review').update({ status, decided_at: new Date().toISOString() }).eq('term', term);
      if (error) return jsonResponse(env, 500, { error: 'save_failed' });
      await admin.from('admin_audit').insert({ admin_id: auth.userId, action: 'search_review_' + body.action });
      return jsonResponse(env, 200, { ok: true });
    }

    const { data, error } = await admin.from('search_review').select('term, source, hits, status, last_seen')
      .in('status', ['pending', 'blocked']).order('hits', { ascending: false }).order('last_seen', { ascending: false }).limit(300);
    if (error) return jsonResponse(env, 500, { error: 'review_unavailable', hint: 'Run migration 019_search_review.sql in Supabase.' });
    const rows = data ?? [];
    const { data: foods } = await admin.from('master_foods').select('id, name, portion, calories, protein, carbs, fat, source, created_at')
      .eq('verified', false).order('created_at', { ascending: false }).limit(100);
    return jsonResponse(env, 200, { pending: rows.filter(r => r.status === 'pending'), blocked: rows.filter(r => r.status === 'blocked'), foods: foods ?? [] });
  } catch (err) {
    console.error('[admin-search-review] error', err);
    return jsonResponse(env, 500, { error: 'internal_error' });
  }
};
