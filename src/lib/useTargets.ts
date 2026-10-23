import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

export interface Targets { cal: number; protein: number; }
const DEFAULTS: Targets = { cal: 1400, protein: 150 };

/** The user's own daily goals (same source as the Log screen). */
export function useTargets(): Targets {
  const { user } = useAuth();
  const [t, setT] = useState<Targets>(DEFAULTS);
  useEffect(() => {
    if (!user) return;
    const load = () => {
      supabase.from('users').select('target_cal, target_protein').eq('id', user.id).maybeSingle()
        .then(({ data }) => {
          if (data) setT({ cal: data.target_cal ?? DEFAULTS.cal, protein: data.target_protein ?? DEFAULTS.protein });
        });
    };
    load();
    window.addEventListener('nutrismart:targets-updated', load);
    return () => window.removeEventListener('nutrismart:targets-updated', load);
  }, [user]);
  return t;
}
