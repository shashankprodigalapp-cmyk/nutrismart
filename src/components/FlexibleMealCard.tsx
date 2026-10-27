import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { localDb } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';
import { useTargets } from '../lib/useTargets';
import { planFlexibleMeal, statusText, type PlannerInput, type PlannerOutput } from '../lib/flexibleMeal';
import { track } from '../lib/analytics';

interface Flex { id: string; planned_for: string; planned_time: string | null; label: string | null; reserved_kcal: number; status: string; consumed_kcal: number | null }
const PRESETS = [500, 750, 1000];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Monday of this IST week and how many days lie between it and today. */
function weekStart(): { start: string; daysBefore: number } {
  const t = new Date(today() + 'T00:00:00Z');
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  return { start: new Date(t.getTime() - dow * 86_400_000).toISOString().slice(0, 10), daysBefore: dow };
}

export function FlexibleMealCard() {
  const { user } = useAuth();
  const targets = useTargets();
  const [meals, setMeals] = useState<Flex[] | null>(null);
  const [eaten, setEaten] = useState({ cal: 0, protein: 0, carbs: 0, fat: 0 });
  const [week, setWeek] = useState<{ eaten: number; days: number } | null>(null);
  const [diet, setDiet] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [kcal, setKcal] = useState(750);
  const [time, setTime] = useState('20:00');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [eatenFor, setEatenFor] = useState<{ id: string; kcal: string } | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    const day = today();
    const ws = weekStart();
    const [f, logs, m, p] = await Promise.all([
      supabase.from('flexible_meals').select('id, planned_for, planned_time, label, reserved_kcal, status, consumed_kcal').eq('planned_for', day).order('created_at'),
      localDb.daily_logs.where('log_date').equals(day).toArray(),
      ws.daysBefore > 0 ? supabase.from('daily_nutrition_metrics').select('calories').eq('user_id', user.id).gte('day', ws.start).lt('day', day) : Promise.resolve({ data: [] as Array<{ calories: number }>, error: null }),
      supabase.from('user_profile').select('diet').eq('user_id', user.id).maybeSingle(),
    ]);
    if (f.error) { setError('Could not load your flexible meals. Check your connection.'); return; }
    setMeals((f.data ?? []) as Flex[]);
    const mine = logs.filter(l => l.user_id === user.id);
    setEaten({ cal: mine.reduce((a, l) => a + (l.cal ?? 0), 0), protein: mine.reduce((a, l) => a + (l.protein ?? 0), 0), carbs: mine.reduce((a, l) => a + (l.carbs ?? 0), 0), fat: mine.reduce((a, l) => a + (l.fat ?? 0), 0) });
    if (ws.daysBefore > 0 && !m.error) setWeek({ eaten: (m.data ?? []).reduce((a: number, r: { calories: number }) => a + Number(r.calories), 0), days: ws.daysBefore }); else setWeek(null);
    setDiet(p.data?.diet ?? undefined);
  }, [user]);
  useEffect(() => { void load(); }, [load]);

  const plan: PlannerOutput = useMemo(() => planFlexibleMeal({
    target: { cal: targets.cal, protein: targets.protein, carbs: targets.carbs, fat: targets.fat },
    eaten, reservationCal: kcal, mealTime: time,
    weekEatenBeforeToday: week?.eaten, weekDaysBeforeToday: week?.days,
    dietType: diet as PlannerInput['dietType'],
  }), [targets, eaten, kcal, time, week, diet]);

  const save = async () => {
    if (!user) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.from('flexible_meals').insert({
      user_id: user.id, planned_for: today(), planned_time: time, label: label.trim().slice(0, 60) || null, reserved_kcal: Math.round(kcal), plan_snapshot: plan,
    });
    setBusy(false);
    if (e) { setError('Could not save the plan. Check your connection and try again.'); return; }
    track('flexible_meal_created');
    setOpen(false); setLabel(''); void load();
  };
  const setStatus = async (id: string, status: 'consumed' | 'skipped' | 'cancelled', consumed?: number) => {
    setBusy(true); setError(null);
    const { error: e } = await supabase.from('flexible_meals').update({ status, consumed_kcal: consumed ?? null, updated_at: new Date().toISOString() }).eq('id', id);
    setBusy(false);
    if (e) { setError('That did not save. Please try again.'); return; }
    if (status === 'consumed') track('flexible_meal_consumed');
    setEatenFor(null); void load();
  };

  if (!user) return null;
  const planned = (meals ?? []).filter(m => m.status === 'planned');
  const done = (meals ?? []).filter(m => m.status !== 'planned' && m.status !== 'cancelled');

  return (
    <div className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3" aria-label="Flexible meal">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Flexible meal</h2>
        {!open && <button onClick={() => setOpen(true)} className="text-xs text-[#C8F75E] underline min-h-[32px]">Plan one</button>}
      </div>
      {error && <p role="alert" className="text-xs text-[#FF6B6B]">{error}</p>}
      {meals === null && !error && <p className="text-xs text-[#8E8E93]">Loading…</p>}
      {meals !== null && planned.length === 0 && done.length === 0 && !open && (
        <p className="text-xs text-[#8E8E93]">Planning a bigger meal today? Set some calories aside and we will show what to eat before it.</p>
      )}

      {planned.map(m => (
        <div key={m.id} className="bg-[#242426] rounded-xl p-3 space-y-2">
          <p className="text-sm text-white">{m.label || 'Flexible meal'} · {m.reserved_kcal} kcal{m.planned_time ? ` · ${m.planned_time}` : ''}</p>
          {eatenFor?.id === m.id ? (
            <div className="flex gap-2 items-center">
              <input type="number" inputMode="numeric" min={0} max={6000} value={eatenFor.kcal} onChange={e => setEatenFor({ id: m.id, kcal: e.target.value })} aria-label="Calories you ate" className="w-24 bg-[#1C1C1E] rounded-lg px-2 py-2 text-sm text-white" />
              <button disabled={busy} onClick={() => void setStatus(m.id, 'consumed', Math.max(0, Math.min(6000, Math.round(Number(eatenFor.kcal) || m.reserved_kcal))))} className="bg-[#C8F75E] text-[#111113] font-semibold rounded-lg px-3 py-2 text-xs">Save</button>
              <button onClick={() => setEatenFor(null)} className="text-xs text-[#8E8E93]">Back</button>
            </div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              <button disabled={busy} onClick={() => setEatenFor({ id: m.id, kcal: String(m.reserved_kcal) })} className="bg-[#30D158]/15 text-[#30D158] rounded-lg px-3 min-h-[36px] text-xs">I had it</button>
              <button disabled={busy} onClick={() => void setStatus(m.id, 'skipped')} className="bg-[#2C2C2E] text-[#C7C7CC] rounded-lg px-3 min-h-[36px] text-xs">Skipped</button>
              <button disabled={busy} onClick={() => void setStatus(m.id, 'cancelled')} className="bg-[#2C2C2E] text-[#FF6B6B] rounded-lg px-3 min-h-[36px] text-xs">Cancel plan</button>
            </div>
          )}
        </div>
      ))}
      {done.map(m => (
        <p key={m.id} className="text-xs text-[#8E8E93]">{m.label || 'Flexible meal'}: {m.status === 'consumed' ? `eaten, ${m.consumed_kcal ?? m.reserved_kcal} kcal` : 'skipped'}</p>
      ))}

      {open && (
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Calories to set aside">
            {PRESETS.map(p => (
              <button key={p} onClick={() => setKcal(p)} aria-pressed={kcal === p} className={`px-3 min-h-[36px] rounded-full text-xs ${kcal === p ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{p} kcal</button>
            ))}
            <input type="number" inputMode="numeric" min={100} max={3000} value={kcal} onChange={e => setKcal(Math.max(100, Math.min(3000, Math.round(Number(e.target.value) || 100))))} aria-label="Custom calories" className="w-24 bg-[#242426] rounded-lg px-2 py-1.5 text-sm text-white" />
          </div>
          <div className="flex gap-2">
            <input type="time" value={time} onChange={e => setTime(e.target.value)} aria-label="Meal time" className="bg-[#242426] rounded-lg px-2 py-1.5 text-sm text-white" />
            <input value={label} onChange={e => setLabel(e.target.value)} maxLength={60} placeholder="What is it? (optional)" aria-label="Meal name" className="flex-1 bg-[#242426] rounded-lg px-3 py-1.5 text-sm text-white" />
          </div>

          <div className="bg-[#242426] rounded-xl p-3 space-y-1.5 text-sm">
            <p className="text-white font-medium">Before your planned meal</p>
            <p className="text-[#EBEBF5]/80">Calories: {plan.preMeal.calories[0]}–{plan.preMeal.calories[1]} kcal</p>
            <p className="text-[#EBEBF5]/80">Protein: {plan.preMeal.protein[0]}–{plan.preMeal.protein[1]} g</p>
            <p className="text-[#EBEBF5]/80">Focus: {plan.priorities.join(' · ')}</p>
            <p className="text-[11px] text-[#8E8E93]">Today: {plan.remaining.calories} kcal and {plan.remaining.protein}g protein still to eat. {statusText(plan.dayStatus)}</p>
            {plan.week && <p className="text-[11px] text-[#8E8E93]">This week: {plan.week.overBy <= 0 ? `about ${Math.abs(plan.week.overBy)} kcal under` : `about ${plan.week.overBy} kcal over`} your weekly target if the other days are on target.</p>}
            {plan.warnings.map(w => <p key={w} className="text-[11px] text-[#FFB347]">{w}</p>)}
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => void save()} className="flex-1 bg-[#C8F75E] text-[#111113] font-bold rounded-xl py-2.5 text-sm disabled:opacity-50">{busy ? 'Saving…' : 'Save plan'}</button>
            <button onClick={() => setOpen(false)} className="px-4 text-sm text-[#8E8E93]">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
