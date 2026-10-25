/**
 * analytics.ts: tiny, privacy-safe usage events.
 * Writes one row to the app's own `events` table (no third parties). Counts and
 * labels only: never meal contents, never free text beyond a short food search term.
 * Always silent: a failed event must never affect the app.
 */
import { supabase } from './supabase';

const lastSent = new Map<string, number>();

export function track(name: string, props: Record<string, string | number | boolean> = {}, minGapMs = 0): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const key = name + JSON.stringify(props);
    const now = Date.now();
    if (minGapMs > 0 && now - (lastSent.get(key) ?? 0) < minGapMs) return;
    lastSent.set(key, now);
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      return supabase.from('events').insert({ user_id: uid, event_name: name, properties: props });
    }).catch(() => {});
  } catch { /* never throw */ }
}
