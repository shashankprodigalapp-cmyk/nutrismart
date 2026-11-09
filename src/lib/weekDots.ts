/**
 * weekDots.ts — the seven dots under "This week" on the Journey screen. Pure: no network, no database.
 * A missed day just stays empty. Nothing resets, nothing is taken away, and there is no streak.
 */
export type DotState = 'done' | 'empty' | 'today' | 'today_done' | 'future';
export interface WeekDot { date: string; label: string; state: DotState; }
const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday to Sunday of the week that holds `today` (YYYY-MM-DD, India time), with each day marked. */
export function weekDots(today: string, logged: string[]): WeekDot[] {
  const base = new Date(today + 'T00:00:00Z');
  if (!Number.isFinite(base.getTime())) return [];
  const dow = (base.getUTCDay() + 6) % 7;
  const have = new Set(logged);
  return LABELS.map((label, i) => {
    const d = new Date(base.getTime() + (i - dow) * 86_400_000).toISOString().slice(0, 10);
    const isToday = i === dow;
    const state: DotState = isToday ? (have.has(d) ? 'today_done' : 'today') : i > dow ? 'future' : have.has(d) ? 'done' : 'empty';
    return { date: d, label: isToday ? 'Today' : label, state };
  });
}

/** How many days of this week have something logged (today included). */
export function daysLogged(dots: WeekDot[]): number {
  return dots.filter(d => d.state === 'done' || d.state === 'today_done').length;
}

export function weekLine(n: number): string {
  if (n <= 0) return 'Nothing logged yet this week. Any day you log is a good day to start.';
  return `${n} ${n === 1 ? 'day' : 'days'} logged this week. A missed day just stays empty. Nothing resets and nothing is lost.`;
}
