import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { todayIST } from '../../lib/kitchenIntelligence';
import { track } from '../../lib/analytics';

type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner';
interface F { energy_change: 'better' | 'same' | 'lower' | null; fullness: 'hungry' | 'comfortable' | 'full' | null; mood_change: 'better' | 'same' | 'lower' | null }
const ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];

function Row<T extends string>({ label, value, options, onChange }: { label: string; value: T | null; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <span className="w-16 text-[11px] text-[#8E8E93]">{label}</span>
      {options.map(([v, t]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
          className={`flex-1 min-h-[40px] rounded-xl text-xs ${value === v ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{t}</button>
      ))}
    </div>
  );
}

/** "How did that meal feel?" for the meals logged today. Saves per meal. */
export function MealFeelingCard() {
  const day = todayIST();
  const [meals, setMeals] = useState<Meal[]>([]);
  const [done, setDone] = useState<Record<string, F>>({});
  const [draft, setDraft] = useState<Record<string, F>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [a, b] = await Promise.all([
        supabase.from('daily_logs').select('meal').eq('log_date', day),
        supabase.from('meal_feelings').select('meal, energy_change, fullness, mood_change').eq('log_date', day),
      ]);
      if (a.error || b.error) { setState('error'); return; }
      const set = new Set((a.data ?? []).map(r => r.meal as Meal));
      setMeals(ORDER.filter(m => set.has(m)));
      const d: Record<string, F> = {}; for (const r of b.data ?? []) d[r.meal as string] = r as F;
      setDone(d); setState('ready');
    })();
  }, [day]);

  async function save(meal: Meal) {
    setErr(null);
    const f = draft[meal]; if (!f) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from('meal_feelings').upsert({ user_id: u.user.id, log_date: day, meal, ...f }, { onConflict: 'user_id,log_date,meal' });
    if (error) { setErr('Could not save. Try again.'); return; }
    track('meal_feeling_saved', { meal });
    setDone(d => ({ ...d, [meal]: f }));
  }
  const set = (meal: Meal, patch: Partial<F>) => setDraft(d => ({ ...d, [meal]: { energy_change: null, fullness: null, mood_change: null, ...d[meal], ...patch } }));

  if (state !== 'ready') return null;
  const pending = meals.filter(m => !done[m]);
  if (meals.length === 0) return <p className="bg-[#1C1C1E] rounded-2xl p-4 text-sm text-[#8E8E93]">Log a meal first, then come back to say how it felt.</p>;
  if (pending.length === 0) return <p className="bg-[#1C1C1E] rounded-2xl p-4 text-sm text-[#8E8E93]">Thanks. Today's meals all have a note.</p>;
  return (
    <section aria-label="How did your meals feel" className="bg-[#1C1C1E] rounded-2xl p-4 space-y-4">
      <p className="text-sm font-semibold">How did your meals feel?</p>
      {pending.map(m => {
        const f = draft[m];
        return (
          <div key={m} className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-[#8E8E93]">{m}</p>
            <Row label="Energy" value={f?.energy_change ?? null} options={[['better', 'Better'], ['same', 'Same'], ['lower', 'Lower']]} onChange={v => set(m, { energy_change: v })} />
            <Row label="Fullness" value={f?.fullness ?? null} options={[['hungry', 'Still hungry'], ['comfortable', 'Comfortable'], ['full', 'Too full']]} onChange={v => set(m, { fullness: v })} />
            <Row label="Mood" value={f?.mood_change ?? null} options={[['better', 'Better'], ['same', 'Same'], ['lower', 'Lower']]} onChange={v => set(m, { mood_change: v })} />
            <button disabled={!f || (!f.energy_change && !f.fullness && !f.mood_change)} onClick={() => save(m)} className="px-4 min-h-[40px] rounded-full bg-[#C8F75E] text-[#111113] text-sm font-semibold disabled:opacity-40">Save {m}</button>
          </div>
        );
      })}
      {err && <p role="alert" className="text-xs text-[#FF6B6B]">{err}</p>}
    </section>
  );
}
