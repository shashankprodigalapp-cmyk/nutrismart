import type { Env } from './auth';
import { getSupabaseAdmin, verifyJWT, jsonResponse } from './auth';

export type Role = 'client' | 'coach' | 'admin';
export interface RoleInfo { client: boolean; coach: boolean; coach_pending: boolean; admin: boolean }

/** Roles come from the database, never from the browser. */
export async function getRoles(env: Env, userId: string): Promise<RoleInfo> {
  const { data } = await getSupabaseAdmin(env).rpc('app_roles', { p_user: userId });
  return { client: true, coach: !!data?.coach, coach_pending: !!data?.coach_pending, admin: !!data?.admin };
}

export async function flagOn(env: Env, key: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin(env).from('feature_flags').select('enabled').eq('key', key).maybeSingle();
  return !!data?.enabled;
}

export async function audit(
  env: Env, actorId: string | null, actorRole: string, action: string, targetUser: string | null, meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await getSupabaseAdmin(env).from('audit_logs').insert({ actor_id: actorId, actor_role: actorRole, action, target_user: targetUser, meta });
  } catch { /* an audit failure is logged by the platform; it must not block the request */ }
}

/** Authenticate and require a role. Returns the user id or a ready-made error response. */
export async function requireRole(
  request: Request, env: Env, role: Role,
): Promise<{ userId: string } | { error: Response }> {
  const auth = await verifyJWT(request, env);
  if (!auth) return { error: jsonResponse(env, 401, { error: 'unauthorized' }) };
  if (role !== 'client') {
    const r = await getRoles(env, auth.userId);
    if (!r[role]) return { error: jsonResponse(env, 403, { error: 'forbidden', message: `${role} access required` }) };
  }
  return { userId: auth.userId };
}

/** Per-person limit in a short window. Returns a 429 response when over, otherwise null. Fails open if the counter is unavailable. */
export async function throttle(env: Env, userId: string, bucket: string, windowSecs: number, max: number): Promise<Response | null> {
  try {
    const { data, error } = await getSupabaseAdmin(env).rpc('v2_hit', { p_user: userId, p_bucket: bucket, p_window_secs: windowSecs, p_max: max });
    if (error || !data) return null;
    if (data.allowed === false) {
      const res = jsonResponse(env, 429, { error: 'slow_down', message: 'That is too many tries in a short time. Please wait a little and try again.', retry_after: data.retry_after });
      res.headers.set('Retry-After', String(data.retry_after ?? 60));
      return res;
    }
  } catch { /* never block a request because the counter failed */ }
  return null;
}
