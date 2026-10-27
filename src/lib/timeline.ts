/** Turns stored timeline events into readable lines, grouped by day (IST). Pure, so it is easy to test. */

export interface TimelineEvent {
  id: string; event_type: string; scope: string; occurred_at: string; payload: Record<string, unknown>;
}
export interface Line { id: string; time: string; icon: string; title: string; detail: string; scope: string }

const MEALS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner' };
const LEVEL: Record<string, string> = { low: 'Low', steady: 'Steady', high: 'High' };
const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && v !== '' && isFinite(Number(v)) ? Number(v) : null);
const r0 = (v: unknown) => { const n = num(v); return n == null ? null : Math.round(n); };

export function istDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
export function istTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function describe(e: TimelineEvent): Line {
  const p = e.payload ?? {};
  const base = { id: e.id, time: istTime(e.occurred_at), scope: e.scope };
  switch (e.event_type) {
    case 'food_logged': {
      const cal = r0(p.cal), prot = r0(p.protein);
      const meal = MEALS[String(p.meal)] ?? 'Meal';
      return { ...base, icon: '🍽️', title: `${meal} logged: ${String(p.food_name ?? 'food')}`, detail: [cal != null ? `${cal} kcal` : '', prot != null ? `${prot}g protein` : ''].filter(Boolean).join(' · ') };
    }
    case 'food_updated': return { ...base, icon: '✏️', title: `Meal edited: ${String(p.food_name ?? 'food')}`, detail: r0(p.cal) != null ? `${r0(p.cal)} kcal` : '' };
    case 'food_deleted': return { ...base, icon: '🗑️', title: `Meal removed: ${String(p.food_name ?? 'food')}`, detail: '' };
    case 'energy_logged': return { ...base, icon: '⚡', title: `Energy: ${LEVEL[String(p.level)] ?? String(p.level ?? '')}`, detail: p.meal_before ? `after ${String(p.meal_before)}` : '' };
    case 'water_logged': return { ...base, icon: '💧', title: `Water: ${num(p.glasses) ?? 0} glasses today`, detail: '' };
    default: return { ...base, icon: '•', title: e.event_type.replace(/_/g, ' '), detail: '' };
  }
}

/** Water is saved every time a glass is added; show only the last entry of each day to keep the timeline readable. */
export function collapseWater(events: TimelineEvent[]): TimelineEvent[] {
  const seen = new Set<string>();
  const out: TimelineEvent[] = [];
  for (const e of events) { // events arrive newest first, so the first water row per day is the latest
    if (e.event_type === 'water_logged') {
      const d = istDay(e.occurred_at);
      if (seen.has(d)) continue;
      seen.add(d);
    }
    out.push(e);
  }
  return out;
}

export function groupByDay(events: TimelineEvent[]): Array<{ day: string; lines: Line[] }> {
  const days: Array<{ day: string; lines: Line[] }> = [];
  for (const e of collapseWater(events)) {
    const d = istDay(e.occurred_at);
    let g = days[days.length - 1];
    if (!g || g.day !== d) { g = { day: d, lines: [] }; days.push(g); }
    g.lines.push(describe(e));
  }
  return days;
}

export function dayLabel(day: string, now: Date = new Date()): string {
  const today = istDay(now.toISOString());
  const yesterday = istDay(new Date(now.getTime() - 86_400_000).toISOString());
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}
