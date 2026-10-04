/**
 * personalFoodIntelligence.ts — Personal Food Intelligence Engine
 *
 * Derives a rich FoodProfile for each food the user has logged,
 * then ranks recommendations for the current context.
 *
 * DATA SOURCES (all Dexie, all local, no network):
 *   daily_logs  → use counts, meal distribution, companions, distinct days
 *   food_analytics → use_count, last_meal, usual_cal (fast lookup cache)
 *   energy_logs → energy correlation via shared energyCorrelation.ts
 *   meal_templates → My Usual Meals (for dashboard priority)
 *
 * NO NEW SCHEMA: everything derives from existing Dexie tables.
 *
 * FOOD → MEAL RELATIONSHIPS:
 *   Scans daily_logs grouped by (log_date, meal) to count how often each food
 *   appears in each meal slot. "usual_meal" = the slot with the highest count.
 *
 * FOOD → FOOD RELATIONSHIPS:
 *   Reuses canonicalKey logic from mealPatterns.ts to find companions.
 *   For food X, companion_count[Y] = number of distinct days X and Y appeared
 *   in the same meal slot.
 *
 * ENERGY SIGNAL:
 *   Uses shared correlateEnergyToFoods() from energyCorrelation.ts.
 *   Same thresholds as analyze-energy.ts (the server).
 *
 * RECOMMENDATION SCORING:
 *   score = (use_count × 2)
 *         + recency_bonus          (0–5)
 *         + meal_match_bonus       (0–4, if last_meal matches context)
 *         + energy_bonus           (0–3, if signal = steady_association)
 *         + energy_penalty         (0–2, if signal = low_energy_association)
 *
 * This is deterministic and traceable — every score component is documented.
 */

import { localDb, type LogEntry, type EnergyLog, type FoodAnalytic, type MealTemplate } from './localDb';
import {
  correlateEnergyToFoods,
  getEnergySignalForFood,
  type EnergySignal,
  type FoodEnergyCorrelation,
  ENERGY_LOOKBACK_DAYS,
} from './energyCorrelation';
import { canonicalKeyFromNames } from './mealPatterns';

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface MealDistribution {
  breakfast: number;
  lunch:     number;
  snack:     number;
  dinner:    number;
}

export interface FoodCompanion {
  food_name:   string;
  day_count:   number;  // distinct days co-logged
}

export interface FoodProfile {
  food_id:           string;        // from food_analytics
  food_name:         string;
  food_source:       string;
  use_count:         number;        // total logs ever
  recent_use_count:  number;        // logs in last 14 days
  distinct_days:     number;        // distinct log_dates
  first_logged:      string;        // ISO date
  last_logged:       string;        // ISO date
  last_meal:         string | undefined;
  usual_meal:        string | null; // the meal slot with most appearances
  meal_distribution: MealDistribution;
  usual_cal:         number | undefined;
  companions:        FoodCompanion[]; // top companions (distinct day co-occurrences)
  energy_signal:     EnergySignal;
  energy_obs_count:  number;
  crash_rate:        number;
}

export interface RecommendationContext {
  currentMeal:     string;   // 'breakfast' | 'lunch' | 'snack' | 'dinner'
  hiddenIds:       Set<string>;
  energyCorr:      FoodEnergyCorrelation[];   // from correlateEnergyToFoods
}

export interface ScoredFood {
  analytic:    FoodAnalytic;
  score:       number;
  score_breakdown: {
    frequency:  number;
    recency:    number;
    meal_match: number;
    energy:     number;
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function daysBefore(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

// ── CORE: BUILD FOOD PROFILES ─────────────────────────────────────────────────

/**
 * buildFoodProfiles — scan daily_logs + food_analytics + energy_logs
 * and produce a rich FoodProfile for every food the user has logged.
 *
 * Deliberately reads from Dexie only (offline-safe, no Supabase calls).
 * The lookback window is ENERGY_LOOKBACK_DAYS (60 days) for energy signal;
 * frequency/distribution uses ALL of daily_logs.
 */
export async function buildFoodProfiles(): Promise<Map<string, FoodProfile>> {
  const since60 = daysBefore(ENERGY_LOOKBACK_DAYS);
  const since14 = daysBefore(14);

  // ── Fetch all daily_logs (no date filter for frequency/distribution) ──────
  const allLogs = await localDb.daily_logs.toArray();

  // ── Fetch 60-day logs for energy correlation ──────────────────────────────
  const recentLogs = allLogs.filter(l => l.log_date >= since60);

  // ── Fetch energy_logs (60-day, skipped excluded) ─────────────────────────
  const energyLogs = await localDb.energy_logs
    .where('log_date').aboveOrEqual(since60)
    .toArray();
  const nonSkippedEnergy = energyLogs.filter((e: any) => !e.skipped);

  // ── Run energy correlation (shared algorithm) ─────────────────────────────
  const energyResult = correlateEnergyToFoods(recentLogs, nonSkippedEnergy);

  // ── Build per-food stats from daily_logs ──────────────────────────────────
  type FoodAcc = {
    log_dates:       Set<string>;
    meal_counts:     Record<string, number>;
    first_logged:    string;
    last_logged:     string;
    recent_count:    number;
    companions:      Map<string, Set<string>>;  // companion_name → Set<log_date>
  };

  const acc = new Map<string, FoodAcc>();

  // Group allLogs by (log_date, meal) for companion computation
  const bySlot = new Map<string, LogEntry[]>();
  for (const l of allLogs) {
    const key = `${l.log_date}|${l.meal}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key)!.push(l);
  }

  for (const l of allLogs) {
    if (!acc.has(l.food_name)) {
      acc.set(l.food_name, {
        log_dates:    new Set(),
        meal_counts:  { breakfast: 0, lunch: 0, snack: 0, dinner: 0 },
        first_logged: l.log_date,
        last_logged:  l.log_date,
        recent_count: 0,
        companions:   new Map(),
      });
    }
    const a = acc.get(l.food_name)!;
    a.log_dates.add(l.log_date);
    a.meal_counts[l.meal as keyof MealDistribution] =
      (a.meal_counts[l.meal as keyof MealDistribution] ?? 0) + 1;
    if (l.log_date < a.first_logged) a.first_logged = l.log_date;
    if (l.log_date > a.last_logged)  a.last_logged  = l.log_date;
    if (l.log_date >= since14)        a.recent_count++;
  }

  // Compute companions from bySlot
  for (const [, entries] of bySlot) {
    if (entries.length < 2) continue;
    const date = entries[0].log_date;
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const nameA = entries[i].food_name;
        const nameB = entries[j].food_name;
        const aAcc  = acc.get(nameA);
        const bAcc  = acc.get(nameB);
        if (aAcc) {
          if (!aAcc.companions.has(nameB)) aAcc.companions.set(nameB, new Set());
          aAcc.companions.get(nameB)!.add(date);
        }
        if (bAcc) {
          if (!bAcc.companions.has(nameA)) bAcc.companions.set(nameA, new Set());
          bAcc.companions.get(nameA)!.add(date);
        }
      }
    }
  }

  // ── Load food_analytics for use_count and food_id ─────────────────────────
  const analytics = await localDb.food_analytics.toArray();
  const analyticsByName = new Map<string, FoodAnalytic>();
  const analyticsById   = new Map<string, FoodAnalytic>();
  for (const fa of analytics) {
    analyticsByName.set(fa.food_name.toLowerCase(), fa);
    analyticsById.set(fa.food_id, fa);
  }

  // ── Build profiles ────────────────────────────────────────────────────────
  const profiles = new Map<string, FoodProfile>();

  for (const [food_name, a] of acc) {
    const fa = analyticsByName.get(food_name.toLowerCase());
    const { signal, total: obs, crash_rate } = getEnergySignalForFood(
      food_name, energyResult.correlations
    );

    // Usual meal = highest meal_counts entry (if it has any logs)
    const mealEntries = Object.entries(a.meal_counts)
      .filter(([, count]) => count > 0)
      .sort((x, y) => y[1] - x[1]);
    const usual_meal = mealEntries.length > 0 ? mealEntries[0][0] : null;

    // Top companions sorted by distinct day co-occurrences
    const companions: FoodCompanion[] = [...a.companions.entries()]
      .map(([name, dates]) => ({ food_name: name, day_count: dates.size }))
      .filter(c => c.day_count >= 2)  // conservative floor
      .sort((x, y) => y.day_count - x.day_count)
      .slice(0, 5);

    const profile: FoodProfile = {
      food_id:           fa?.food_id ?? food_name,
      food_name,
      food_source:       fa?.food_source ?? 'master',
      use_count:         fa?.use_count ?? a.log_dates.size,
      recent_use_count:  a.recent_count,
      distinct_days:     a.log_dates.size,
      first_logged:      a.first_logged,
      last_logged:       a.last_logged,
      last_meal:         fa?.last_meal,
      usual_meal,
      meal_distribution: {
        breakfast: a.meal_counts.breakfast ?? 0,
        lunch:     a.meal_counts.lunch     ?? 0,
        snack:     a.meal_counts.snack     ?? 0,
        dinner:    a.meal_counts.dinner    ?? 0,
      },
      usual_cal:         fa?.usual_cal,
      companions,
      energy_signal:     signal,
      energy_obs_count:  obs,
      crash_rate,
    };

    profiles.set(food_name, profile);
  }

  return profiles;
}

// ── RECOMMENDATION SCORER ─────────────────────────────────────────────────────

/**
 * scoreFood — deterministic scoring for the recommendation ranking.
 *
 * Formula:
 *   score = (use_count × 2)
 *         + recency_bonus    [today=5, 7d=3, 30d=1, older=0]
 *         + meal_match_bonus [last_meal === currentMeal → +4]
 *         + energy_bonus     [steady_association → +3]
 *         + energy_penalty   [low_energy_association → −2]
 */
export function scoreFood(
  analytic:    FoodAnalytic,
  context:     RecommendationContext,
  today:       string,
  sevenAgo:    string,
  thirtyAgo:   string,
): ScoredFood {
  const frequency  = analytic.use_count * 2;
  const recency    =
    analytic.last_used_date >= today     ? 5 :
    analytic.last_used_date >= sevenAgo  ? 3 :
    analytic.last_used_date >= thirtyAgo ? 1 : 0;
  const meal_match = (analytic.last_meal && analytic.last_meal === context.currentMeal) ? 4 : 0;

  const { signal } = getEnergySignalForFood(analytic.food_name, context.energyCorr);
  const energy =
    signal === 'steady_association'   ?  3 :
    signal === 'low_energy_association' ? -2 : 0;

  return {
    analytic,
    score: frequency + recency + meal_match + energy,
    score_breakdown: { frequency, recency, meal_match, energy },
  };
}

/**
 * getPersonalRecommendations — returns ranked FoodAnalytics for the current context.
 *
 * Priority order:
 *   1. My Usual Meals (meal_templates) — returned separately, shown first
 *   2. My Usuals ranked by score (use_count ≥ USUAL_THRESHOLD, not hidden)
 *   3. Recents ranked by score (all other foods)
 *
 * The scoring formula ensures: frequent + recent + meal-context-matched +
 * energy-positive foods surface at the top.
 */
export async function getPersonalRecommendations(
  context: RecommendationContext,
): Promise<{
  templates:    MealTemplate[];
  usuals:       ScoredFood[];
  recents:      ScoredFood[];
}> {
  const { USUAL_THRESHOLD } = await import('./localDb');
  const today     = new Date().toISOString().slice(0, 10);
  const sevenAgo  = daysBefore(7);
  const thirtyAgo = daysBefore(30);

  // Templates — sorted by use_count DESC (most-used meal first)
  const templates = await localDb.meal_templates.toArray();
  templates.sort((a, b) => b.use_count - a.use_count);

  // Food analytics — score every food
  const allAnalytics = await localDb.food_analytics.toArray();
  const scored = allAnalytics
    .filter(f => !context.hiddenIds.has(f.food_id))
    .map(f => scoreFood(f, context, today, sevenAgo, thirtyAgo))
    .sort((a, b) => b.score - a.score);

  const usuals  = scored.filter(s => s.analytic.use_count >= USUAL_THRESHOLD);
  const recents = scored.filter(s => s.analytic.use_count < USUAL_THRESHOLD);

  return { templates, usuals, recents };
}

// ── PERSONAL INSIGHTS GENERATOR ───────────────────────────────────────────────

export interface PersonalInsight {
  text:     string;    // human-readable, first-person
  evidence: string;    // "Based on N lunches"
  type:     'meal_context' | 'companion' | 'energy' | 'frequency';
}

const MIN_EVIDENCE_LOGS = 3;  // minimum logs to state an insight

/**
 * generateInsights — derives human-readable insights from FoodProfiles.
 *
 * Every insight is anchored to observable data.
 * No causal language — uses "Your logs suggest…" framing.
 * No insights generated from fewer than MIN_EVIDENCE_LOGS observations.
 */
export function generateInsights(
  profiles: Map<string, FoodProfile>,
  limit = 8,
): PersonalInsight[] {
  const insights: PersonalInsight[] = [];

  for (const [, p] of profiles) {
    if (insights.length >= limit * 3) break;  // collect extras, then filter

    // Meal context insight
    if (p.usual_meal && p.distinct_days >= MIN_EVIDENCE_LOGS) {
      const count = p.meal_distribution[p.usual_meal as keyof MealDistribution];
      if (count >= MIN_EVIDENCE_LOGS) {
        insights.push({
          text:     `You usually have ${p.food_name} at ${p.usual_meal}`,
          evidence: `Based on ${count} ${p.usual_meal}s`,
          type:     'meal_context',
        });
      }
    }

    // Companion insight (top companion, if strong enough)
    if (p.companions.length > 0 && p.companions[0].day_count >= MIN_EVIDENCE_LOGS) {
      const comp = p.companions[0];
      insights.push({
        text:     `You often pair ${p.food_name} with ${comp.food_name}`,
        evidence: `Together on ${comp.day_count} days`,
        type:     'companion',
      });
    }

    // Energy insight
    if (p.energy_signal === 'steady_association' && p.energy_obs_count >= 5) {
      insights.push({
        text:     `Your logs suggest steadier energy after ${p.food_name}`,
        evidence: `Based on ${p.energy_obs_count} energy check-ins`,
        type:     'energy',
      });
    }
    if (p.energy_signal === 'low_energy_association' && p.energy_obs_count >= 5) {
      insights.push({
        text:     `Your logs suggest lower energy after ${p.food_name}`,
        evidence: `Based on ${p.energy_obs_count} energy check-ins`,
        type:     'energy',
      });
    }
  }

  // Deduplicate by text, prioritise energy > companion > meal_context > frequency
  const typeOrder = { energy: 0, companion: 1, meal_context: 2, frequency: 3 };
  const seen = new Set<string>();
  return insights
    .filter(i => { if (seen.has(i.text)) return false; seen.add(i.text); return true; })
    .sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
    .slice(0, limit);
}
