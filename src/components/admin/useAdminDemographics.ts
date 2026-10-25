import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

export interface DemoRow { field: 'age_band' | 'gender' | 'state' | 'goal' | 'diet'; k: string; n: number; logged: number | null; habit: number | null }
export interface DemographicsData { users: number; started: number; completed: number; fields: DemoRow[] }

export function useAdminDemographics() {
  const [data, setData] = useState<DemographicsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch('/api/admin-demographics', { headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}` } });
      const j = await res.json().catch(() => ({}));
      if (res.status === 403) setError('This account is not an admin.');
      else if (j?.error === 'demographics_unavailable') setError('The database part is not installed yet. Run migration 016 in Supabase, then refresh.');
      else if (!res.ok) setError('Could not load the numbers. Try again in a minute.');
      else setData(j.demographics as DemographicsData);
    } catch {
      setError('Could not reach the server. Check your connection.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}
