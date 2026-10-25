import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';
import { fitMacros } from './macroMath';

export interface Targets { cal: number; protein: number; fat: number; carbs: number; gl: number; water: number; }

// Same defaults as the database columns.
const DB_DEFAULTS = { cal: 1400, protein: 150, fat: 65, gl: 50, water: 8 };

function build(row: { target_cal?: number | null; target_protein?: number | null; target_fat?: number | null; target_gl?: number | null; target_water?: number | null } | null): Targets {
  const fit = fitMacros(row?.target_cal ?? DB_DEFAULTS.cal, row?.target_protein ?? DB_DEFAULTS.protein, row?.target_fat ?? DB_DEFAULTS.fat);
  return { cal: fit.cal, protein: fit.protein, fat: fit.fat, carbs: fit.carbs, gl: row?.target_gl ?? DB_DEFAULTS.gl, water: row?.target_water ?? DB_DEFAULTS.water };
}

/** The user's own daily goals, with protein / fat / carbs made consistent with the calorie goal. */
export function useTargets(): Targets {
  const { user } = useAuth();
  const [t, setT] = useState<Targets>(() => build(null));
  useEffect(() => {
    if (!user) return;
    const load = () => {
      supabase.from('users').select('target_cal, target_protein, target_fat, target_gl, target_water').eq('id', user.id).maybeSingle()
        .then(({ data }) => { if (data) setT(build(data)); });
    };
    load();
    window.addEventListener('nutrismart:targets-updated', load);
    return () => window.removeEventListener('nutrismart:targets-updated', load);
  }, [user]);
  return t;
}
