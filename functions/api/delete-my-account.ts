import type { Env } from '../_shared/auth';
import { verifyJWT, getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';

// POST /api/delete-my-account {confirm: 'DELETE'}  (signed-in user) -> permanently deletes that user.
// Deleting the sign-in record removes the profile and every row linked to it (meals, goals, devices, plan).
// Past usage events stay, but with no link to the person.
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });

  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });

  let body: { confirm?: string } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  if (body.confirm !== 'DELETE') return jsonResponse(env, 400, { error: 'confirm_required' });

  const admin = getSupabaseAdmin(env);
  const { data: adminRow } = await admin.from('admin_users').select('user_id').eq('user_id', auth.userId).maybeSingle();
  if (adminRow) return jsonResponse(env, 403, { error: 'admin_account' });

  // Remove this person's id from rows that must stay (audit log, review decisions). A failure here must not block deletion.
  try { await admin.rpc('erase_user_traces', { p_user: auth.userId }); } catch { /* keep going */ }
  const { error } = await admin.auth.admin.deleteUser(auth.userId);
  if (error) {
    console.error('[delete-my-account] failed', error.message);
    return jsonResponse(env, 500, { error: 'delete_failed' });
  }
  return jsonResponse(env, 200, { ok: true });
};
