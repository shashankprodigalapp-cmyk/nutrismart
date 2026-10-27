import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useFlag } from '../../lib/useFlag';
import { findPatterns, emptyReason, type MealOutcome } from '../../lib/patterns';

const num = (v: unknown) => Number(v) || 0;

/** Meal patterns from the person's own meals and after-meal notes. Read only; works for the person and (with sharing) their coach. */
export function PatternsSection({ clientId }: { clientId?: string }) {
  const on = useFlag('v2_patterns');
  const [meals, setMeals] = useState<MealOutcome[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!on) return;
    let live = true;
    (async () => {
      let uid = clientId;
      if (!uid) { const { data } = await supabase.auth.getUser(); uid = data.user?.id; }
      if (!uid) { setError(true); return; }
      const { data, error: e } = await supabase.rpc('meal_outcomes', { p_user: uid, p_days: 60 });
      if (!live) return;
      if (e) { setError(true); return; }
      setMeals(((data ?? []) as Array<Record<string, unknown>>).map(r => ({
        log_date: String(r.log_date), meal: String(r.meal), cal: num(r.cal), protein: num(r.protein), carbs: num(r.carbs), fat: num(r.fat), gl: num(r.gl),
        logged_hour: r.logged_hour == null ? null : Number(r.logged_hour),
        energy_level: (r.energy_level as MealOutcome['energy_level']) ?? null, energy_change: (r.energy_change as MealOutcome['energy_change']) ?? null,
        fullness: (r.fullness as MealOutcome['fullness']) ?? null, mood_change: (r.mood_change as MealOutcome['mood_change']) ?? null,
      })));
    })();
    return () => { live = false; };
  }, [on, clientId]);

  const result = useMemo(() => (meals ? findPatterns(meals) : null), [meals]);
  if (!on) return null;
  if (error) return <p className="text-xs text-[#8E8E93]">Meal patterns are not available right now.</p>;
  if (!result) return <p className="text-xs text-[#8E8E93]">Looking for patterns…</p>;
  return (
    <section className="space-y-2" aria-label="Meal patterns">
      <h2 className="text-sm font-semibold">Meal patterns</h2>
      {result.patterns.length === 0 ? (
        <p className="bg-[#1C1C1E] rounded-2xl p-4 text-sm text-[#8E8E93]">{emptyReason(result.observed)}</p>
      ) : (
        <ul className="space-y-2">
          {result.patterns.map(p => (
            <li key={p.id} className="bg-[#1C1C1E] rounded-2xl p-4">
              <p className="text-sm">{p.text}</p>
              <p className="text-[11px] text-[#8E8E93] mt-1">{p.confidence === 'early' ? 'Early signal' : p.confidence === 'emerging' ? 'Emerging pattern' : 'Repeated pattern'}</p>
              <details className="mt-1"><summary className="text-[11px] text-[#8E8E93] cursor-pointer min-h-[24px]">Based on</summary><p className="text-[11px] text-[#8E8E93]">{p.evidence}</p></details>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-[#636366]">Based on the last 60 days of your own meals. Time is when the meal was logged. These are observations, not medical advice.</p>
    </section>
  );
}
