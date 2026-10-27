import { supabase } from './supabase';

export interface ApiResult<T = Record<string, unknown>> { ok: boolean; status: number; data: T & { error?: string; message?: string } }

export async function coachApi<T = Record<string, unknown>>(path: string, body?: unknown, method: 'POST' | 'GET' = 'POST'): Promise<ApiResult<T>> {
  const { data: s } = await supabase.auth.getSession();
  try {
    const res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network', message: 'Could not reach the server. Check your connection and try again.' } as ApiResult<T>['data'] };
  }
}
