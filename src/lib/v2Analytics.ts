/** Small helpers for the 2.0 analytics screen. Plain arithmetic; the database does the counting. */
export function pct(part: number, whole: number): number | null {
  if (!(whole > 0) || part < 0) return null;
  return Math.round((part / whole) * 100);
}

export interface FunnelStep { label: string; count: number; ofPrevious: number | null; ofFirst: number | null }

/** Each step against the one before it and against the first. A later step can never be shown above 100%. */
export function funnel(steps: Array<[string, number]>): FunnelStep[] {
  const first = steps[0]?.[1] ?? 0;
  return steps.map(([label, count], i) => ({
    label, count,
    ofPrevious: i === 0 ? null : (steps[i - 1][1] > 0 ? Math.min(100, pct(count, steps[i - 1][1]) ?? 0) : null),
    ofFirst: i === 0 ? null : (first > 0 ? Math.min(100, pct(count, first) ?? 0) : null),
  }));
}

/** Share of a review outcome among decided reviews (drafts do not count as decided). */
export function reviewOutcome(byStatus: Record<string, number>): { decided: number; approvedPct: number | null; editedPct: number | null; rejectedPct: number | null } {
  const a = byStatus.approved ?? 0, e = byStatus.edited ?? 0, r = byStatus.rejected ?? 0;
  const decided = a + e + r;
  return { decided, approvedPct: pct(a, decided), editedPct: pct(e, decided), rejectedPct: pct(r, decided) };
}

/** Small cohorts say little: under this many people, show the counts without a percentage. */
export const MIN_COHORT = 5;
export function cohortRate(n: number, size: number): string {
  if (size < MIN_COHORT) return `${n} of ${size}`;
  return `${pct(n, size)}%`;
}
