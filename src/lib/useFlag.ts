import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

/** Reads one feature switch from the database. False while loading, on error, or when off. */
export function useFlag(key: string): boolean {
  const { user } = useAuth();
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!user) { setOn(false); return; }
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.from('feature_flags').select('enabled').eq('key', key).maybeSingle();
        if (live) setOn(!!data?.enabled);
      } catch { if (live) setOn(false); }
    })();
    return () => { live = false; };
  }, [user, key]);
  return on;
}
