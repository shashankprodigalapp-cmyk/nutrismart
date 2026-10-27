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
