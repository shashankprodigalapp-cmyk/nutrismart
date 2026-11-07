import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

const CACHE = 'ns-flag:';
const readCache = (key: string): boolean => { try { return localStorage.getItem(CACHE + key) === '1'; } catch { return false; } };
const writeCache = (key: string, on: boolean) => { try { localStorage.setItem(CACHE + key, on ? '1' : '0'); } catch { /* ignore */ } };

/**
 * Reads one feature switch from the database. Starts from the last value this device saw, so a screen does not
 * jump when the switch finishes loading. False when never seen, signed out, or off. On a network error it keeps the last known value.
 */
export function useFlag(key: string): boolean {
  const { user } = useAuth();
  const [on, setOn] = useState<boolean>(() => readCache(key));
  useEffect(() => {
    if (!user) { setOn(false); return; }
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.from('feature_flags').select('enabled').eq('key', key).maybeSingle();
        if (error || !live) return;
        const v = !!data?.enabled;
        writeCache(key, v);
        setOn(v);
      } catch { /* keep the last known value */ }
    })();
    return () => { live = false; };
  }, [user, key]);
  return on;
}
