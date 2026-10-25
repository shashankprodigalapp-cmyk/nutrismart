import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Status } from './adminUi';

export interface MeterData {
  key: string; label: string; used: number | null; limit: number | null; unit: 'count' | 'bytes';
  status: Status; note: string; link?: string; projected?: number | null;
}

export interface Insights {
  today_ist: string; days: number;
  kpis: { total_users: number; signups_7d: number; signups_30d: number; active_today: number; wau: number; mau: number; logs_today: number; logs_7d: number };
  funnel: { signed_up: number; onboarded: number; first_log: number; first_log_24h: number; logged_2_days: number; logged_3_days: number };
  retention: { week: string; size: number; eligible_d1: number; retained_d1: number; eligible_d7: number; retained_d7: number; eligible_d30: number; retained_d30: number }[];
  daily: { date: string; signups: number; active: number; logs: number }[];
  top_foods: { name: string; logs: number; users: number }[];
  meals: { meal: string; logs: number }[];
  log_methods: { method: string; logs: number }[];
  search_misses: { query: string; searches: number; users: number }[];
  features: { name: string; events: number; users: number }[];
  screens: { screen: string; views: number; users: number }[];
  ai_daily: { day: string; calls: number; ok: number; limited: number; errors: number; input_tokens: number; output_tokens: number }[];
  ai_endpoints: { endpoint: string; provider: string; calls: number; ok: number; avg_ms: number }[];
  ai_today: { pacific_date: string; gemini_calls: number; gemini_limited: number; claude_calls: number; peak_per_minute_24h: number };
  ai_cache: { lookups: number; cache_hits: number; users: number };
  system: {
    db_bytes: number; storage_bytes: number; mau_auth: number; auth_users: number; push_devices: number; push_users: number;
    verdicts_sent_7d: number; energy_ratings: number; tables: { name: string; bytes: number; rows: number }[];
  };
  segments: { daily_loggers: number; casual: number; dormant: number; never_logged: number; ai_heavy: number };
}

export interface AdminInsightsResponse {
  generated_at: string; days: number; health: Status; limits_checked_on: string;
  settings: { gemini_rpd_limit: number | null; gemini_rpm_limit: number | null };
  meters: MeterData[]; insights: Insights;
}

export function useAdminInsights(days: number) {
  const [data, setData] = useState<AdminInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const token = s.session?.access_token ?? '';
      const res = await fetch(`/api/admin-insights?days=${days}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => ({}));
      if (res.status === 403) setError('This account is not an admin.');
      else if (j?.error === 'insights_unavailable') setError('The database part is not installed yet. Run migration 013 in Supabase, then refresh.');
      else if (!res.ok) setError('Could not load the numbers. Try again in a minute.');
      else setData(j as AdminInsightsResponse);
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setLoading(false);
  }, [days]);

  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

export async function saveGeminiLimits(v: { gemini_rpd_limit: number | null; gemini_rpm_limit: number | null }): Promise<boolean> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch('/api/admin-insights', {
      method: 'POST',
      headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    });
    return res.ok;
  } catch { return false; }
}
