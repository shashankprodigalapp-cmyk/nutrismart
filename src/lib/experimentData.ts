import { supabase } from './supabase';
import { addDays, type DayValues } from './experiments';

/** Gathers the numbers an experiment compares, one record per day. Row-level security decides what a coach may see. */
export async function loadDayValues(userId: string | undefined, from: string, to: string): Promise<Record<string, DayValues>> {
  let uid = userId;
  if (!uid) uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return {};
  const [c, n, a, m] = await Promise.all([
    supabase.from('daily_checkins').select('log_date, energy, mood, hunger').eq('user_id', uid).gte('log_date', from).lte('log_date', to),
    supabase.from('daily_nutrition_metrics').select('day, protein_g, items').eq('user_id', uid).gte('day', from).lte('day', to),
    supabase.from('daily_adherence').select('day, logging_adherence').eq('user_id', uid).gte('day', from).lte('day', to),
    supabase.rpc('meal_outcomes', { p_user: uid, p_days: 120 }),
  ]);
  const out: Record<string, DayValues> = {};
  const row = (d: string) => (out[d] ??= {});
  for (const r of c.data ?? []) Object.assign(row(String(r.log_date)), { energy: r.energy, mood: r.mood, hunger: r.hunger });
  for (const r of n.data ?? []) if (Number(r.items) > 0) row(String(r.day)).protein = Number(r.protein_g);
  for (const r of a.data ?? []) if (r.logging_adherence != null) row(String(r.day)).logging = Number(r.logging_adherence);
  const byDay = new Map<string, { lower: number; known: number }>();
  for (const r of (m.data ?? []) as Array<Record<string, unknown>>) {
    const d = String(r.log_date); if (d < from || d > to) continue;
    const known = r.energy_change != null || r.energy_level != null;
    if (!known) continue;
    const lower = r.energy_change != null ? r.energy_change === 'lower' : r.energy_level === 'low';
    const cur = byDay.get(d) ?? { lower: 0, known: 0 };
    cur.known++; if (lower) cur.lower++; byDay.set(d, cur);
  }
  for (const [d, v] of byDay) row(d).lower_energy_share = (v.lower / v.known) * 100;
  return out;
}
export const windowFor = (startDate: string, baseline: number, endDate: string) => ({ from: addDays(startDate, -baseline), to: endDate });
