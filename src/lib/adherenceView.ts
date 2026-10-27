/** Display helpers for stored adherence rows. The scores themselves are computed in the database (migration 022). */
export interface AdherenceRow {
  day: string; calorie_adherence: number | null; protein_adherence: number | null; fat_adherence: number | null;
  macro_adherence: number | null; logging_adherence: number; checkin_adherence: number;
}
export interface AdherenceSummary {
  days: number; loggedDays: number; checkinDays: number;
  calorie: number | null; protein: number | null; macro: number | null; logging: number | null; checkin: number | null;
}

const avg = (xs: Array<number | null | undefined>): number | null => {
  const v = xs.filter((x): x is number => typeof x === 'number' && isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

/** `expectedDays` is the length of the window (7, 14, 30). Days with no row count as not logged. */
export function summarize(rows: AdherenceRow[], expectedDays: number): AdherenceSummary {
  const loggedDays = rows.filter(r => r.logging_adherence >= 100).length;
  const checkinDays = rows.filter(r => r.checkin_adherence >= 100).length;
  return {
    days: expectedDays, loggedDays, checkinDays,
    calorie: avg(rows.map(r => r.calorie_adherence)),
    protein: avg(rows.map(r => r.protein_adherence)),
    macro: avg(rows.map(r => r.macro_adherence)),
    logging: expectedDays > 0 ? Math.round((loggedDays / expectedDays) * 1000) / 10 : null,
    checkin: expectedDays > 0 ? Math.round((checkinDays / expectedDays) * 1000) / 10 : null,
  };
}

export type Band = 'good' | 'fair' | 'low' | 'none';
export const band = (score: number | null): Band => (score == null ? 'none' : score >= 80 ? 'good' : score >= 55 ? 'fair' : 'low');

/** Every day in the window, oldest first, with null scores where nothing was logged. */
export function fillDays(rows: AdherenceRow[], endDay: string, n: number): AdherenceRow[] {
  const byDay = new Map(rows.map(r => [r.day, r]));
  const out: AdherenceRow[] = [];
  const end = new Date(endDay + 'T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(d) ?? { day: d, calorie_adherence: null, protein_adherence: null, fat_adherence: null, macro_adherence: null, logging_adherence: 0, checkin_adherence: 0 });
  }
  return out;
}
