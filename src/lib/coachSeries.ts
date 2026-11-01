/** Pure numbers behind the coach charts (no React). */
import { pctOf, mean } from './chartMath';

export interface SeriesRow { client_id: string; day: string; calories: number | null; protein_g: number | null; items: number; target_cal: number | null; target_protein: number | null; energy: number | null }

/** How well a logged day matches the calorie target: 1 within 10%, falling to 0 at 50% off. Nothing logged = 0. No target = a neutral 0.6. */
export function dayScore(calories: number | null, items: number, target: number | null): number {
  if (!items) return 0;
  if (!target || calories == null) return 0.6;
  const r = calories / target;
  return Math.max(0, Math.min(1, 1 - (Math.max(Math.abs(r - 1) - 0.1, 0) / 0.4)));
}

export function summarise(series: SeriesRow[]) {
  const days = [...new Set(series.map(r => String(r.day)))].sort();
  const byDay = days.map(d => series.filter(r => String(r.day) === d));
  const cal = byDay.map(rs => mean(rs.filter(r => r.items > 0).map(r => pctOf(r.calories, r.target_cal))));
  const pro = byDay.map(rs => mean(rs.filter(r => r.items > 0).map(r => pctOf(r.protein_g, r.target_protein))));
  const logging = byDay.map(rs => rs.length ? Math.round((rs.filter(r => r.items > 0).length / rs.length) * 100) : null);
  return { days, cal, pro, logging };
}

