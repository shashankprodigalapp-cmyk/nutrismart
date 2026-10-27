/**
 * Energy and mood insights (deterministic, no AI). Compares a person's OWN days with each other.
 * Rules: groups must have at least 3 days each; differences under 0.5 points are ignored; wording is cautious
 * ("tends to appear alongside", "we observed") and never says one thing caused another. Not medical advice.
 */
export type Confidence = 'insufficient' | 'early' | 'emerging' | 'repeated';
export interface DayRow {
  date: string;
  mood: number | null; energy: number | null; hunger: number | null;      // 1-5
  sleep: 'poor' | 'okay' | 'good' | null; stress: 'low' | 'medium' | 'high' | null;
  protein: number | null; mealsLogged: number; waterGlasses: number | null;
}
export interface MealFeeling { date: string; meal: string; energy_change: 'better' | 'same' | 'lower' | null; fullness: 'hungry' | 'comfortable' | 'full' | null; mood_change: 'better' | 'same' | 'lower' | null }
export interface Finding { id: string; text: string; confidence: Confidence; evidence: string; action?: string }

export const MIN_GROUP = 3;
export const MIN_DIFF = 0.5;

export function confidenceFor(n: number): Confidence { return n < 3 ? 'insufficient' : n < 7 ? 'early' : n < 15 ? 'emerging' : 'repeated'; }
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Cmp { nA: number; nB: number; avgA: number; avgB: number; diff: number }
export function compare(days: DayRow[], metric: 'mood' | 'energy', inA: (d: DayRow) => boolean | null, inB: (d: DayRow) => boolean | null): Cmp | null {
  const a: number[] = [], b: number[] = [];
  for (const d of days) {
    const v = d[metric]; if (v == null) continue;
    if (inA(d) === true) a.push(v); else if (inB(d) === true) b.push(v);
  }
  if (a.length < MIN_GROUP || b.length < MIN_GROUP) return null;
  const avgA = avg(a), avgB = avg(b);
  return { nA: a.length, nB: b.length, avgA: r1(avgA), avgB: r1(avgB), diff: r1(avgA - avgB) };
}

export interface InsightOptions { proteinTarget: number | null; waterGoal: number | null }

export function buildFindings(days: DayRow[], feelings: MealFeeling[], o: InsightOptions): { findings: Finding[]; checkinDays: number; confidence: Confidence } {
  const checkinDays = days.filter(d => d.mood != null || d.energy != null).length;
  const confidence = confidenceFor(checkinDays);
  const out: Finding[] = [];
  if (confidence === 'insufficient') return { findings: out, checkinDays, confidence };

  const word = { mood: 'Mood', energy: 'Energy' } as const;
  const add = (id: string, metric: 'mood' | 'energy', c: Cmp | null, a: string, b: string, action: string) => {
    if (!c || Math.abs(c.diff) < MIN_DIFF) return;
    const hi = c.diff > 0;
    const [better, worse, nBetter, nWorse, avgBetter, avgWorse] = hi ? [a, b, c.nA, c.nB, c.avgA, c.avgB] : [b, a, c.nB, c.nA, c.avgB, c.avgA];
    out.push({
      id, confidence,
      text: `${word[metric]} ratings tended to be higher on ${better} (average ${avgBetter} over ${nBetter} days) than on ${worse} (average ${avgWorse} over ${nWorse} days).`,
      evidence: `${better}: ${nBetter} days, avg ${avgBetter}. ${worse}: ${nWorse} days, avg ${avgWorse}. Scale 1 to 5.`,
      action: hi ? action : undefined,
    });
  };

  for (const m of ['mood', 'energy'] as const) {
    add(`sleep_${m}`, m, compare(days, m, d => d.sleep === 'good', d => d.sleep === 'poor'), 'days after good sleep', 'days after poor sleep', 'Plan an earlier wind-down tonight: screens off 30 minutes before bed.');
    if (o.proteinTarget) {
      const t = o.proteinTarget;
      add(`protein_${m}`, m, compare(days, m, d => (d.protein == null ? null : d.protein >= 0.8 * t), d => (d.protein == null ? null : d.protein < 0.8 * t)), 'days when protein reached 80% of target', 'days when it did not', 'Add a protein source to your first meal tomorrow.');
    }
    add(`meals_${m}`, m, compare(days, m, d => d.mealsLogged >= 3, d => d.mealsLogged > 0 && d.mealsLogged < 3), 'days with 3 or more meals logged', 'days with fewer meals logged', 'Log each meal as you eat it and avoid long gaps between meals.');
    if (o.waterGoal) {
      const g = o.waterGoal;
      add(`water_${m}`, m, compare(days, m, d => (d.waterGlasses == null ? null : d.waterGlasses >= g), d => (d.waterGlasses == null ? null : d.waterGlasses < g)), 'days when the water goal was met', 'days when it was not', 'Keep a water bottle within reach and aim for your goal.');
    }
    add(`stress_${m}`, m, compare(days, m, d => d.stress === 'low', d => d.stress === 'high'), 'low-stress days', 'high-stress days', 'Take a 5 minute break outdoors or away from screens after lunch.');
  }

  // After-meal observations: how often energy felt lower, per meal
  for (const meal of ['breakfast', 'lunch', 'snack', 'dinner']) {
    const f = feelings.filter(x => x.meal === meal && x.energy_change);
    if (f.length < MIN_GROUP) continue;
    const lower = f.filter(x => x.energy_change === 'lower').length;
    if (lower / f.length >= 0.5) {
      out.push({
        id: `after_${meal}`, confidence: confidenceFor(f.length),
        text: `Energy felt lower after ${meal} on ${lower} of ${f.length} days we have notes for. We observed this, and it may or may not be linked to what you ate.`,
        evidence: `${lower} of ${f.length} ${meal} check-ins said "lower".`,
        action: `Next time, add protein or vegetables to ${meal} and note how it feels.`,
      });
    }
  }
  return { findings: out.slice(0, 5), checkinDays, confidence };
}

export function tryTomorrow(findings: Finding[]): string[] {
  const seen = new Set<string>(); const acts: string[] = [];
  for (const f of findings) if (f.action && !seen.has(f.action)) { seen.add(f.action); acts.push(f.action); }
  return acts.slice(0, 3);
}

/** A gentle note when recent mood ratings stay low. Not a diagnosis. */
export function lowMoodNote(days: DayRow[]): string | null {
  const recent = days.filter(d => d.mood != null).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).map(d => d.mood as number);
  if (recent.length < 5 || avg(recent) > 2) return null;
  return 'Your mood ratings have been low for a while. Nutri Smart is not a medical service and cannot diagnose or treat anything. Talking to a doctor, a counsellor or someone you trust can help. If you ever feel unsafe, contact a local emergency number or helpline straight away.';
}

/** Weekly or monthly trend points for a simple chart: one point per day that has data. */
export function trend(days: DayRow[], metric: 'mood' | 'energy' | 'hunger'): Array<{ date: string; value: number }> {
  return days.filter(d => d[metric] != null).map(d => ({ date: d.date, value: d[metric] as number })).sort((a, b) => a.date.localeCompare(b.date));
}
