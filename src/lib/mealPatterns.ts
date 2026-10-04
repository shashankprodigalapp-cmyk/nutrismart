/**
 * mealPatterns.ts — Meal pattern detection for Phase 2C.2
 *
 * WHAT THIS DOES:
 *   Scans the user's daily_logs (Dexie, local) to find food combinations
 *   they repeatedly eat together within a single meal slot on different days.
 *   When a combination appears ≥ PATTERN_THRESHOLD times, it's surfaced as
 *   a suggestion: "You eat this together often. Save as a usual meal?"
 *
 * ALGORITHM:
 *   1. Fetch daily_logs from the last LOOKBACK_DAYS grouped by (log_date, meal).
 *   2. For each group, sort food names alphabetically → canonical key.
 *   3. Count how many DISTINCT log_dates each key appears on.
 *      (Multiple appearances on the same day count as one — we're looking for
 *      the user's eating pattern, not logging artifacts.)
 *   4. Keys with count ≥ PATTERN_THRESHOLD are "detected patterns".
 *   5. Patterns already saved as meal_templates are excluded from suggestions.
 *
 * THRESHOLDS:
 *   PATTERN_THRESHOLD = 3 distinct days — same as USUAL_THRESHOLD.
 *   LOOKBACK_DAYS = 60 — matches analyze-energy.ts lookback window.
 *
 * NO AI / NO ML: purely deterministic set intersection and counting.
 *
 * NOTE ON SUBSETS:
 *   If the user eats [Dal, Roti, Sabzi] on 5 days, the pattern detector will
 *   also find [Dal, Roti] (3 of 5 days) and [Dal, Sabzi] as sub-patterns.
 *   We show only the LARGEST matching set for any given day to avoid noise.
 *   "Largest" = most food items in the combination.
 */

import { localDb, type LogEntry, type MealTemplate } from './localDb';
import { todayIST } from './kitchenIntelligence';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

export const PATTERN_THRESHOLD = 3;   // distinct days a combination must appear
export const LOOKBACK_DAYS     = 60;

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface DetectedMealPattern {
  /** Canonical key: sorted food names joined by '|' */
  key:          string;
  /** Sorted food names */
  food_names:   string[];
  /** The meal slot it most often appears in */
  meal:         string;
  /** How many distinct days this combination was logged */
  day_count:    number;
  /** Total kcal (average across observations) */
  avg_cal:      number;
  /** Representative items (from most recent observation of this pattern) */
  items:        MealTemplate['items'];
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function canonicalKey(foodNames: string[]): string {
  return [...foodNames].sort().join('|');
}

/** Exported alias — reused by personalFoodIntelligence.ts */
export function canonicalKeyFromNames(foodNames: string[]): string {
  return canonicalKey(foodNames);
}

function daysBefore(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

/**
 * detectMealPatterns — returns food combinations the user repeatedly eats together.
 *
 * @param existingTemplateKeys — Set of canonical keys already saved as templates
 *                               (these are excluded from suggestions)
 */
export async function detectMealPatterns(
  existingTemplateKeys: Set<string> = new Set(),
): Promise<DetectedMealPattern[]> {
  const since = daysBefore(LOOKBACK_DAYS);

  // Fetch logs from the last 60 days, ordered by date
  const logs = await localDb.daily_logs
    .where('log_date')
    .aboveOrEqual(since)
    .toArray();

  if (logs.length < PATTERN_THRESHOLD * 2) return [];  // not enough data

  // Group logs by (log_date, meal) → Map<"date|meal", LogEntry[]>
  const bySlot = new Map<string, LogEntry[]>();
  for (const log of logs) {
    const key = `${log.log_date}|${log.meal}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key)!.push(log);
  }

  // For each slot with ≥ 2 foods, compute the canonical combination key
  // Map: canonical_key → { meal_counts, day_set, representative_items, total_cal }
  type PatternAcc = {
    meal_counts: Record<string, number>;
    day_set:     Set<string>;  // distinct log_dates
    latest_date: string;
    rep_items:   MealTemplate['items'];
    total_cal:   number;
    obs_count:   number;
  };
  const patterns = new Map<string, PatternAcc>();

  for (const [slotKey, entries] of bySlot) {
    if (entries.length < 2) continue;  // single-food slots don't make "meals"

    const [date, meal] = slotKey.split('|');
    const foodNames    = entries.map(e => e.food_name);
    const ck           = canonicalKey(foodNames);

    if (!patterns.has(ck)) {
      patterns.set(ck, {
        meal_counts: {},
        day_set:     new Set(),
        latest_date: date,
        rep_items:   [],
        total_cal:   0,
        obs_count:   0,
      });
    }

    const acc = patterns.get(ck)!;
    acc.meal_counts[meal] = (acc.meal_counts[meal] ?? 0) + 1;
    acc.day_set.add(date);
    acc.total_cal  += entries.reduce((s, e) => s + e.cal, 0);
    acc.obs_count  += 1;

    // Track representative items from the most recent observation
    if (date >= acc.latest_date) {
      acc.latest_date = date;
      acc.rep_items   = entries.map(e => ({
        food_name: e.food_name,
        portion:   e.portion,
        qty:       e.qty,
        is_home:   e.is_home,
        cal:       e.cal,
        protein:   e.protein,
        carbs:     e.carbs,
        fat:       e.fat,
        gl:        e.gl,
      }));
    }
  }

  // Filter patterns by threshold, exclude already-saved templates, build results
  const results: DetectedMealPattern[] = [];

  for (const [ck, acc] of patterns) {
    if (acc.day_set.size < PATTERN_THRESHOLD) continue;
    if (existingTemplateKeys.has(ck)) continue;

    // Most common meal slot
    const meal = Object.entries(acc.meal_counts)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'lunch';

    results.push({
      key:        ck,
      food_names: ck.split('|'),
      meal,
      day_count:  acc.day_set.size,
      avg_cal:    Math.round(acc.total_cal / acc.obs_count),
      items:      acc.rep_items,
    });
  }

  // Sort by day_count DESC (most frequent patterns first), then by most items
  results.sort((a, b) =>
    b.day_count !== a.day_count
      ? b.day_count - a.day_count
      : b.food_names.length - a.food_names.length
  );

  // Suppress sub-patterns: if [Dal, Roti, Sabzi] appears, don't also show [Dal, Roti]
  // for the same user patterns. Keep only the largest superset for each subset.
  const suppressed = new Set<string>();
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const bigger  = results[i].food_names;
      const smaller = results[j].food_names;
      // smaller is a subset of bigger if every item in smaller is in bigger
      if (smaller.every(f => bigger.includes(f))) {
        suppressed.add(results[j].key);
      }
    }
  }

  return results.filter(r => !suppressed.has(r.key)).slice(0, 5);
}

/**
 * buildTemplateKey — compute the canonical key for a MealTemplate.
 * Used to check if a pattern is already saved.
 */
export function buildTemplateKey(template: MealTemplate): string {
  return canonicalKey(template.items.map(i => i.food_name));
}

/**
 * patternToTemplate — convert a DetectedMealPattern to a MealTemplate.
 * The caller supplies user_id and generates the id.
 */
export function patternToTemplate(
  pattern:  DetectedMealPattern,
  userId:   string,
  name?:    string,
): MealTemplate {
  const defaultName = pattern.food_names.length <= 3
    ? pattern.food_names.join(' + ')
    : `${pattern.food_names[0]} + ${pattern.food_names[1]} + ${pattern.food_names.length - 2} more`;

  return {
    id:        crypto.randomUUID(),
    user_id:   userId,
    name:      name ?? defaultName,
    total_cal: pattern.avg_cal,
    items:     pattern.items,
    use_count: 0,
    created_at: new Date().toISOString(),
  };
}
