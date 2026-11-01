/**
 * Recommendation engine (2.1 P3). Deterministic rules over the personal feature store and the person's own food history.
 * Every recommendation carries: Reason, Evidence, Confidence, Action, Expected outcome, Follow-up.
 * Prefers foods the person already logs. Falls back to a generic line only when there is no history to use.
 */
import type { DayRow, MealRow, Meal, Targets, Recommendation } from './types';
import { loggingStreak, type FeatureIndex } from './features';
import { knownFoods, plural } from './foodHistory';
import { suggestSmartMeal } from './smartMeal';
import { addDays, weekStart } from './dates';

const SHARE: Record<Meal, number> = { breakfast: 0.25, lunch: 0.35, snack: 0.10, dinner: 0.30 };
const CONF_W = { low: 0.5, medium: 0.8, high: 1 } as const;
const toConf = (c: string): 'low' | 'medium' | 'high' => (c === 'high' ? 'high' : c === 'medium' ? 'medium' : 'low');

export interface RecInput {
  features: FeatureIndex; rows: DayRow[]; meals: MealRow[]; targets: Targets; today: string; hour?: number;
  today_totals?: { calories: number; protein: number; meals: Meal[] };
  flexReservedCal?: number;
  recent?: Array<{ rec_key: string; status: string; day: string }>;
  max?: number;
}

const f = (idx: FeatureIndex, key: string, w: number) => idx[key]?.[w];

export function recommend(inp: RecInput): Recommendation[] {
  const out: Recommendation[] = [];
  const wk = weekStart(inp.today);
  const last30 = inp.meals.filter(m => m.day >= addDays(inp.today, -29));
  const foods = knownFoods(last30);

  // 1. Protein per meal is low (uses foods the person already eats)
  for (const meal of ['lunch', 'dinner', 'breakfast'] as Meal[]) {
    const ft = f(inp.features, `${meal}_protein_avg`, 7);
    if (!ft || ft.value == null || ft.sample_size < 3) continue;
    const target = Math.round(inp.targets.protein * SHARE[meal]);
    if (ft.value >= target * 0.6) continue;
    const gap = Math.round(target - ft.value);
    const picks = foods.filter(x => x.avgProtein >= 8).sort((a, b) => b.avgProtein - a.avgProtein || b.uses - a.uses).slice(0, 2);
    const conf = toConf(ft.confidence);
    const has = picks.length > 0;
    out.push({
      rec_type: has ? 'protein_addition' : 'meal_adjustment', rec_key: `protein_${meal}`, window_day: wk,
      reason: `Your ${plural(meal)} are light on protein.`,
      evidence: [`Your last ${ft.sample_size} logged ${plural(meal)} averaged ${Math.round(ft.value)}g protein, about ${target}g is your share.`],
      confidence: has ? conf : 'low',
      action: has
        ? `Add ${picks.map(p => `${p.name} (about ${Math.round(p.avgProtein)}g)`).join(' or ')} to your ${meal}. You already log ${picks.length > 1 ? 'both' : 'it'}.`
        : `Add a protein-rich food you already use to your ${meal}.`,
      expected_outcome: has ? `About ${Math.round(picks[0].avgProtein)}g more protein at ${meal}, closer to ${target}g.` : `Closer to about ${target}g protein at ${meal}.`,
      follow_up_at: addDays(inp.today, 3), metric: { feature: `${meal}_protein_avg`, window_days: 7, value: ft.value, direction: 'up' },
      score: (gap / Math.max(target, 1)) * CONF_W[has ? conf : 'low'] + (has ? 0.1 : 0),
    });
  }

  // 2. Calories running over target: smaller portion of the biggest repeated item
  const over = f(inp.features, 'calorie_vs_target_pct', 7);
  if (over && over.value != null && over.value >= 115 && over.sample_size >= 4) {
    const last7 = inp.meals.filter(m => m.day >= addDays(inp.today, -6));
    const tot = new Map<string, { cal: number; n: number }>();
    for (const m of last7) { const k = m.food_name.trim(); const e = tot.get(k) ?? { cal: 0, n: 0 }; e.cal += m.cal; e.n++; tot.set(k, e); }
    const top = [...tot.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].cal - a[1].cal)[0];
    const conf = toConf(over.confidence);
    out.push({
      rec_type: top ? 'portion_adjustment' : 'meal_adjustment', rec_key: 'calories_over', window_day: wk,
      reason: 'Your calories have been above your goal.',
      evidence: [`Over ${over.sample_size} logged days you averaged ${Math.round(over.value)}% of your calorie goal.`, ...(top ? [`${top[0]} added ${Math.round(top[1].cal)} kcal in the last 7 days.`] : [])],
      confidence: conf,
      action: top ? `Try three quarters of your usual ${top[0]} portion on most days.` : 'Pick the meal where you usually eat the most and trim its portion a little.',
      expected_outcome: top ? `About ${Math.round((top[1].cal * 0.25) / 7)} kcal less per day.` : 'A little closer to your goal each day.',
      follow_up_at: addDays(inp.today, 7), metric: { feature: 'calorie_vs_target_pct', window_days: 7, value: over.value, direction: 'down' },
      score: Math.min((over.value - 100) / 100, 1) * CONF_W[conf],
    });
  }

  // 3. Calories very low: usually missing entries, not a target to chase. No medical claims.
  const under = f(inp.features, 'calorie_vs_target_pct', 7);
  if (under && under.value != null && under.value < 70 && under.sample_size >= 4) {
    out.push({
      rec_type: 'check_in', rec_key: 'calories_under', window_day: wk,
      reason: 'Your logged calories look low.',
      evidence: [`Over ${under.sample_size} logged days you averaged ${Math.round(under.value)}% of your calorie goal.`],
      confidence: toConf(under.confidence),
      action: 'Check whether some meals or snacks were not logged. If they were all logged, a coach or dietitian can review your goal.',
      expected_outcome: 'A clearer picture of what you really eat.',
      follow_up_at: addDays(inp.today, 3), score: 0.5 * CONF_W[toConf(under.confidence)],
    });
  }

  // 4. Logging gaps
  const lc = f(inp.features, 'logging_consistency_pct', 7);
  if (lc && lc.value != null && lc.value < 50) {
    const days = Math.round((lc.value / 100) * 7);
    out.push({
      rec_type: 'behaviour_nudge', rec_key: 'logging_gap', window_day: wk,
      reason: 'You logged on only some days this week.',
      evidence: [`You logged on ${days} of the last 7 days.`, ...(lc.baseline != null ? [`The 7 days before that: ${Math.round((lc.baseline / 100) * 7)} of 7.`] : [])],
      confidence: 'high',
      action: 'Tomorrow, log just one meal. One entry keeps the picture honest.',
      expected_outcome: 'More days with data, so your tips get more accurate.',
      follow_up_at: addDays(inp.today, 2), metric: { feature: 'logging_consistency_pct', window_days: 7, value: lc.value, direction: 'up' }, score: 0.45 + (lc.baseline != null && lc.baseline > lc.value ? 0.1 : 0),
    });
  }

  // 5. Flexible meal planned today: help the rest of the day fit around it
  if ((inp.flexReservedCal ?? 0) > 0 && inp.today_totals) {
    const sm = suggestSmartMeal({ targets: inp.targets, eaten: inp.today_totals, flexReservedCal: inp.flexReservedCal, history: last30 }, inp.hour ?? 13);
    if (sm) out.push({
      rec_type: 'flexible_meal', rec_key: 'flex_prep', window_day: inp.today,
      reason: `You reserved ${inp.flexReservedCal} kcal for a flexible meal today.`,
      evidence: [sm.why],
      confidence: 'medium',
      action: `For ${sm.meal}, try ${sm.items.map(i => i.name).join(' with ')} (about ${sm.total.cal} kcal, ${Math.round(sm.total.protein)}g protein).`,
      expected_outcome: 'Your flexible meal fits without a crash diet around it.',
      follow_up_at: addDays(inp.today, 1), score: 0.7,
    });
  }

  // 6. A good streak is worth saying so
  const streak = loggingStreak(inp.rows, inp.today);
  if (streak >= 5) out.push({
    rec_type: 'behaviour_nudge', rec_key: 'streak', window_day: wk,
    reason: `You have logged ${streak} days in a row.`, evidence: [`${streak} consecutive days with at least one entry.`], confidence: 'high',
    action: 'Keep it simple. One honest log a day is enough.', expected_outcome: 'Steady data makes every tip sharper.',
    follow_up_at: addDays(inp.today, 7), score: 0.2,
  });

  // 7. Persistent gap worth a human review
  const cal14 = f(inp.features, 'calorie_vs_target_pct', 14), pro14 = f(inp.features, 'protein_vs_target_pct', 14);
  const farOff = (cal14?.value != null && cal14.sample_size >= 7 && (cal14.value < 60 || cal14.value > 140)) || (pro14?.value != null && pro14.sample_size >= 7 && pro14.value < 50);
  if (farOff) out.push({
    rec_type: 'coach_review', rec_key: 'coach_review', window_day: wk,
    reason: 'Your numbers have been far from your goals for two weeks.',
    evidence: [cal14?.value != null ? `Calories: ${Math.round(cal14.value)}% of goal over ${cal14.sample_size} logged days.` : '', pro14?.value != null ? `Protein: ${Math.round(pro14.value)}% of goal over ${pro14.sample_size} logged days.` : ''].filter(Boolean),
    confidence: 'medium', action: 'Ask a coach or dietitian to look at your goals and your week.',
    expected_outcome: 'Goals that fit your real life.', follow_up_at: addDays(inp.today, 7), score: 0.6,
  });

  // Drop what the person already dismissed this week or that was already made for this window
  const recent = inp.recent ?? [];
  const kept = out.filter(r => !recent.some(x => x.rec_key === r.rec_key && ((x.status === 'dismissed' && x.day >= addDays(inp.today, -7)) || x.day === r.window_day)));
  return kept.sort((a, b) => b.score - a.score).slice(0, inp.max ?? 3).map(r => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
}

/** Did it help? Compares the feature now with the value when the recommendation was made. Needs real data on both sides. */
export function recOutcome(metric: NonNullable<Recommendation['metric']>, now: { value: number | null; sample_size: number }): { result: 'helped' | 'no_change'; before: number; after: number } | null {
  if (now.value == null || now.sample_size < 3) return null;
  const moved = metric.direction === 'up' ? now.value - metric.value : metric.value - now.value;
  const need = Math.max(Math.abs(metric.value) * 0.08, 1);
  return { result: moved >= need ? 'helped' : 'no_change', before: metric.value, after: now.value };
}
