/**
 * Personal pattern engine (deterministic). Looks at one person's meals and how they felt afterwards.
 * Minimum observation rules: under 3 occasions nothing is said; 3-6 early signal; 7-14 emerging; 15+ repeated.
 * Each side of a comparison needs at least 3 meals, and the gap must be at least 25 percentage points.
 * In a pattern, `a` is the side where the outcome was more common and `b` is the comparison side.
 * Wording is cautious ("appeared alongside", "we observed") and never says a food caused anything.
 */
export type Confidence = 'insufficient' | 'early' | 'emerging' | 'repeated';
export interface MealOutcome {
  log_date: string; meal: string; cal: number; protein: number; carbs: number; fat: number; gl: number; logged_hour: number | null;
  energy_level: 'low' | 'steady' | 'high' | null; energy_change: 'better' | 'same' | 'lower' | null;
  fullness: 'hungry' | 'comfortable' | 'full' | null; mood_change: 'better' | 'same' | 'lower' | null;
}
export interface Pattern {
  id: string; outcome: 'low_energy' | 'hungry_after' | 'low_mood'; text: string; confidence: Confidence;
  a: { label: string; n: number; hits: number }; b: { label: string; n: number; hits: number }; evidence: string;
}

export const MIN_GROUP = 3;
export const MIN_GAP = 0.25;
export const THRESHOLDS = { proteinRich: 25, highCarbShare: 0.6, largeMeal: 700, lateHour: 21, highGl: 20 } as const;

export function confidenceFor(n: number): Confidence { return n < 3 ? 'insufficient' : n < 7 ? 'early' : n < 15 ? 'emerging' : 'repeated'; }

const lowEnergy = (m: MealOutcome): boolean | null => (m.energy_change ? m.energy_change === 'lower' : m.energy_level ? m.energy_level === 'low' : null);
const hungry = (m: MealOutcome): boolean | null => (m.fullness ? m.fullness === 'hungry' : null);
const lowMood = (m: MealOutcome): boolean | null => (m.mood_change ? m.mood_change === 'lower' : null);
const carbShare = (m: MealOutcome) => (m.cal > 0 ? (m.carbs * 4) / m.cal : 0);

interface Feature { id: string; a: string; b: string; inA: (m: MealOutcome) => boolean | null }
const FEATURES: Feature[] = [
  { id: 'protein', a: `meals with ${THRESHOLDS.proteinRich}g or more protein`, b: 'meals with less protein', inA: m => m.protein >= THRESHOLDS.proteinRich },
  { id: 'carbs', a: 'carb-heavy meals (over 60% of calories from carbs)', b: 'other meals', inA: m => m.cal > 0 && carbShare(m) >= THRESHOLDS.highCarbShare },
  { id: 'size', a: `large meals (${THRESHOLDS.largeMeal} kcal or more)`, b: 'smaller meals', inA: m => m.cal >= THRESHOLDS.largeMeal },
  { id: 'late', a: `meals logged after ${THRESHOLDS.lateHour - 12} pm`, b: 'earlier meals', inA: m => (m.logged_hour == null ? null : m.logged_hour >= THRESHOLDS.lateHour) },
  { id: 'gl', a: 'high glycaemic load meals', b: 'lower glycaemic load meals', inA: m => (m.gl > 0 ? m.gl >= THRESHOLDS.highGl : null) },
];
const OUTCOMES: Array<{ id: Pattern['outcome']; fn: (m: MealOutcome) => boolean | null; phrase: string }> = [
  { id: 'low_energy', fn: lowEnergy, phrase: 'energy felt lower afterwards' },
  { id: 'hungry_after', fn: hungry, phrase: 'you were still hungry afterwards' },
  { id: 'low_mood', fn: lowMood, phrase: 'mood felt lower afterwards' },
];

export function findPatterns(meals: MealOutcome[]): { patterns: Pattern[]; observed: Record<Pattern['outcome'], number> } {
  const patterns: Pattern[] = [];
  const observed = { low_energy: 0, hungry_after: 0, low_mood: 0 } as Record<Pattern['outcome'], number>;
  for (const o of OUTCOMES) {
    observed[o.id] = meals.filter(m => o.fn(m) != null).length;
    if (observed[o.id] < 3) continue;
    for (const f of FEATURES) {
      let nA = 0, hA = 0, nB = 0, hB = 0;
      for (const m of meals) {
        const out = o.fn(m); const inA = f.inA(m);
        if (out == null || inA == null) continue;
        if (inA) { nA++; if (out) hA++; } else { nB++; if (out) hB++; }
      }
      if (nA < MIN_GROUP || nB < MIN_GROUP) continue;
      const rA = hA / nA, rB = hB / nB;
      if (Math.abs(rA - rB) < MIN_GAP) continue;
      // "a" is always the side where the outcome was more common (the one worth a look)
      const aWorse = rA > rB;
      const w = aWorse ? { label: f.a, n: nA, hits: hA } : { label: f.b, n: nB, hits: hB };
      const c = aWorse ? { label: f.b, n: nB, hits: hB } : { label: f.a, n: nA, hits: hA };
      patterns.push({
        id: `${o.id}:${f.id}`, outcome: o.id, confidence: confidenceFor(nA + nB),
        text: `After ${w.label}, ${o.phrase} on ${w.hits} of ${w.n} occasions, compared with ${c.hits} of ${c.n} after ${c.label}. We observed this; it may or may not be linked to the food itself.`,
        a: w, b: c,
        evidence: `${w.label}: ${w.hits} of ${w.n}. ${c.label}: ${c.hits} of ${c.n}.`,
      });
    }
  }
  patterns.sort((x, y) => (y.a.hits / y.a.n - y.b.hits / y.b.n) - (x.a.hits / x.a.n - x.b.hits / x.b.n) || (y.a.n + y.b.n) - (x.a.n + x.b.n));
  return { patterns: patterns.slice(0, 5), observed };
}

/** Plain explanation for the empty state, so the person knows what to do next. */
export function emptyReason(observed: Record<Pattern['outcome'], number>): string {
  const most = Math.max(observed.low_energy, observed.hungry_after, observed.low_mood);
  if (most < 3) return `Not enough data yet. Patterns need at least 3 meals with an after-meal note (you have ${most}). Use the "How did your meals feel?" card after eating.`;
  return 'No clear pattern yet. A pattern needs at least 3 meals on each side of a comparison and a clear difference between them.';
}
