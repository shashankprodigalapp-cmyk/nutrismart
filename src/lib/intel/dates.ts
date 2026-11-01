/** Small date helpers on IST day strings. Pure. */
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000);
}
/** 0 = Sunday ... 6 = Saturday */
export function weekday(day: string): number { return new Date(day + 'T00:00:00Z').getUTCDay(); }
export function isWeekend(day: string): boolean { const w = weekday(day); return w === 0 || w === 6; }
/** Monday of the week containing `day`. */
export function weekStart(day: string): string { const w = weekday(day); return addDays(day, -((w + 6) % 7)); }
export function monthStart(day: string): string { return day.slice(0, 8) + '01'; }
export function istDay(now: Date): string { return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10); }
export function istHour(now: Date): number { return new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours(); }
