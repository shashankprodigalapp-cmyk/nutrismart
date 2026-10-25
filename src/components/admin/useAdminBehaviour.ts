import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface KV { k: string; n: number }
export interface BehaviourData {
  days: number;
  kpis: { active_7d: number; habit_7d: number; meals_per_active_day: number; full_days_pct: number; active_days: number };
  weekly: { week: string; active: number; habit: number }[];
  streaks: { bucket: string; users: number }[];
  streak_breaks: { dow: string; n: number }[];
  hours: { hour: number; n: number }[];
  features: { feature: string; users_used: number; repeat_users: number; n_with: number; kept_with: number; n_without: number; kept_without: number }[];
  push: {
    verdict_sent_7d: number; verdict_opened_7d: number; reengage_opened_7d: number; checkin_opened_7d: number;
    checkin_answered_7d: number; checkin_skipped_7d: number; state: KV[];
  };
  sources: { ref: string; users: number; logged: number; habit: number }[];
  device: { people: number; os: KV[]; install: KV[]; lang: KV[]; build: KV[] };
  errors: {
    active_days: number; app_errors: number; api_errors: number;
    top_errors: { where: string; msg: string; n: number; users: number }[];
    api_failures: { path: string; status: string; n: number; users: number }[];
    slow: { action: string; n: number; p50_ms: number; p90_ms: number }[];
  };
  feedback: { sean_ellis: KV[]; exit: KV[] };
  edits: { method: string; logged: number; adjusted: number }[];
}
export interface BehaviourResponse { generated_at: string; days: number; behaviour: BehaviourData }

export function useAdminBehaviour(days: number) {
  const [data, setData] = useState<BehaviourResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch(`/api/admin-behaviour?days=${days}`, { headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}` } });
      const j = await res.json().catch(() => ({}));
      if (res.status === 403) setError('This account is not an admin.');
      else if (j?.error === 'behaviour_unavailable') setError('The database part is not installed yet. Run migration 015 in Supabase, then refresh.');
      else if (!res.ok) setError('Could not load the numbers. Try again in a minute.');
      else setData(j as BehaviourResponse);
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}
