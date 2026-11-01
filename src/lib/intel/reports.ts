/**
 * Reports (2.1 P5). Built only from the structured numbers: features, day rows, recommendations, observations.
 * Plain sentences from templates. The language model is never the source of a number.
 */
import type { DayRow, MealRow, Targets } from './types';
import type { FeatureIndex } from './features';
import { knownFoods, plural } from './foodHistory';
import { addDays } from './dates';

export interface Section { heading: string; lines: string[] }
export interface Report { kind: 'daily' | 'weekly' | 'monthly' | 'learning'; title: string; period_start: string; period_end: string; next_action?: string; sections: Section[]; based_on_days: number }
export interface RecRecord { rec_type: string; rec_key: string; status: 'new' | 'seen' | 'accepted' | 'dismissed' | 'done' | 'expired'; action: string; outcome?: { result?: 'helped' | 'no_change' } | null; created_day: string }

const pct = (n: number | null | undefined) => (n == null ? null : `${Math.round(n)}%`);
const sec = (heading: string, lines: string[]) => ({ heading, lines: lines.length ? lines : ['Not enough data yet.'] });
const inRange = (d: string, a: string, b: string) => d >= a && d <= b;

export function dailyReport(a: { today: string; features: FeatureIndex; topAction?: string; smartMealText?: string }): Report {
  const cal = a.features.calorie_vs_target_pct?.[1], pro = a.features.protein_vs_target_pct?.[1];
  const lines: string[] = [];
  if (cal?.value != null) lines.push(`Calories so far: ${pct(cal.value)} of your goal.`);
  if (pro?.value != null) lines.push(`Protein so far: ${pct(pro.value)} of your goal.`);
  if (a.smartMealText) lines.push(a.smartMealText);
  return {
    kind: 'daily', title: 'Today', period_start: a.today, period_end: a.today, based_on_days: 1,
    next_action: a.topAction ?? 'Log your next meal to keep today accurate.', sections: [sec('Today so far', lines)],
  };
}

export function weeklyReport(a: {
  weekStart: string; rows: DayRow[]; features: FeatureIndex; targets: Targets; recs: RecRecord[]; observations: string[]; mood?: boolean;
}): Report {
  const end = addDays(a.weekStart, 6), F = a.features;
  const week = a.rows.filter(r => inRange(r.day, a.weekStart, end) && r.items > 0);
  const n = week.length;
  const nutrition: string[] = [];
  if (n) {
    nutrition.push(`Average calories: ${F.calories_avg?.[7]?.value ?? '-'} (goal ${a.targets.cal}).`);
    nutrition.push(`Average protein: ${F.protein_avg?.[7]?.value ?? '-'}g (goal ${a.targets.protein}g).`);
    if (F.meals_per_day?.[7]?.value != null) nutrition.push(`Meals logged per day: ${F.meals_per_day[7].value}.`);
  }
  const calOk = week.filter(r => a.targets.cal > 0 && Math.abs(r.calories - a.targets.cal) <= a.targets.cal * 0.15).length;
  const proOk = week.filter(r => a.targets.protein > 0 && r.protein_g >= a.targets.protein * 0.9).length;
  const adherence = [`Logged ${n} of 7 days.`, ...(n ? [`Calories within 15% of goal on ${calOk} of ${n} days.`, `Protein at 90% of goal or more on ${proOk} of ${n} days.`] : [])];
  const feel: string[] = [];
  for (const [k, label] of [['energy_avg', 'Energy'], ['hunger_avg', 'Hunger'], ['mood_avg', 'Mood']] as const) {
    const x = F[k]?.[7]; if (x?.value != null) feel.push(`${label}: ${x.value} out of 5 on average (${x.sample_size} check-ins).`);
  }
  const moved = Object.values(F).map(w => w[7]).filter(x => x && x.delta != null && x.trend !== 'flat' && x.trend !== 'unknown' && x.confidence !== 'none' && x.confidence !== 'low')
    .sort((x, y) => Math.abs((y!.delta as number) / Math.max(Math.abs(y!.baseline ?? 1), 1)) - Math.abs((x!.delta as number) / Math.max(Math.abs(x!.baseline ?? 1), 1))).slice(0, 4);
  const label: Record<string, string> = { calories_avg: 'Average calories', protein_avg: 'Average protein', logging_consistency_pct: 'Logging consistency', energy_avg: 'Energy', hunger_avg: 'Hunger', mood_avg: 'Mood', calorie_vs_target_pct: 'Calories vs goal', protein_vs_target_pct: 'Protein vs goal', meals_per_day: 'Meals per day', lunch_protein_avg: 'Lunch protein', dinner_protein_avg: 'Dinner protein', breakfast_protein_avg: 'Breakfast protein' };
  const changed = moved.map(x => `${label[x!.key] ?? x!.key} ${x!.trend === 'up' ? 'went up' : 'went down'} by ${Math.abs(x!.delta as number)} (from ${x!.baseline} to ${x!.value}).`);
  const wr = a.recs.filter(r => inRange(r.created_day, a.weekStart, end) || r.status === 'accepted' || r.status === 'done');
  const recLines = wr.length ? [
    `${wr.filter(r => r.status === 'accepted' || r.status === 'done').length} of ${wr.length} suggestions taken, ${wr.filter(r => r.status === 'dismissed').length} set aside.`,
    ...wr.filter(r => r.outcome?.result === 'helped').map(r => `Helped: ${r.action}`),
  ] : [];
  return {
    kind: 'weekly', title: 'Your week', period_start: a.weekStart, period_end: end, based_on_days: n,
    sections: [sec('Nutrition', nutrition), sec('Adherence', adherence), sec('Energy, hunger and mood', feel.length ? feel : ['No check-ins this week.']),
      sec('What changed', changed.length ? changed : ['Nothing moved much compared with the week before.']),
      sec('Patterns', a.observations), sec('Suggestions', recLines)],
  };
}

export function monthlyReport(a: { monthStart: string; monthEnd: string; features: FeatureIndex; recs: RecRecord[]; messages: Array<{ sender_type: string; sent_day: string; outcome?: { status?: string } | null }>; targets: Targets; rows: DayRow[] }): Report {
  const F = a.features;
  const days = a.rows.filter(r => inRange(r.day, a.monthStart, a.monthEnd) && r.items > 0).length;
  const t = (k: string, label: string) => { const x = F[k]?.[30]; return x?.value != null ? `${label}: ${x.value}${x.baseline != null ? ` (previous 30 days: ${x.baseline})` : ''}, from ${x.sample_size} days.` : null; };
  const trends = [t('calories_avg', 'Average calories'), t('protein_avg', 'Average protein'), t('logging_consistency_pct', 'Logging consistency, %'), t('energy_avg', 'Energy out of 5')].filter(Boolean) as string[];
  const worked = a.recs.filter(r => r.outcome?.result === 'helped'), notWorked = a.recs.filter(r => r.status === 'dismissed' || r.outcome?.result === 'no_change');
  const interventions = [`${a.recs.length} suggestions made, ${a.recs.filter(r => r.status === 'accepted' || r.status === 'done').length} taken.`, `${a.messages.filter(m => m.sender_type === 'coach').length} coach messages, ${a.messages.filter(m => m.sender_type === 'auto').length} automatic.`];
  const next: string[] = [];
  const lc = F.logging_consistency_pct?.[30], pr = F.protein_vs_target_pct?.[30];
  if (lc?.value != null && lc.value < 60) next.push('Log on more days: it makes every other number more reliable.');
  if (pr?.value != null && pr.value < 85 && pr.sample_size >= 7) next.push(`Raise protein: you averaged ${Math.round(pr.value)}% of your goal.`);
  a.recs.filter(r => r.status === 'new' || r.status === 'seen').slice(0, 2).forEach(r => next.push(r.action));
  return {
    kind: 'monthly', title: 'Your month', period_start: a.monthStart, period_end: a.monthEnd, based_on_days: days,
    sections: [sec('Trends', trends), sec('Suggestions and messages', interventions), sec('What worked', worked.map(r => r.action)), sec('What did not', notWorked.map(r => r.action)), sec('Next priorities', next)],
  };
}

export function personalLearning(a: { today: string; features: FeatureIndex; meals: MealRow[]; recs: RecRecord[]; observations: string[] }): Report {
  const F = a.features, L: string[] = [];
  const mpd = F.meals_per_day?.[30]; if (mpd?.value != null && mpd.confidence !== 'low' && mpd.confidence !== 'none') L.push(`You usually log ${mpd.value} meals on a day you log (from ${mpd.sample_size} days).`);
  for (const m of ['breakfast', 'lunch', 'dinner'] as const) {
    const x = F[`${m}_protein_avg`]?.[30]; if (x?.value != null && x.sample_size >= 5) L.push(`Your ${plural(m)} average ${Math.round(x.value)}g protein (from ${x.sample_size} days).`);
  }
  const gap = F.weekend_calorie_gap?.[90] ?? F.weekend_calorie_gap?.[30];
  if (gap?.value != null && Math.abs(gap.value) >= 150) L.push(`Weekends run about ${Math.abs(Math.round(gap.value))} kcal ${gap.value > 0 ? 'higher' : 'lower'} than weekdays (from ${gap.sample_size} weekend and weekday days each).`);
  const home = F.home_share_pct?.[30]; if (home?.value != null && home.sample_size >= 1) L.push(`About ${Math.round(home.value)}% of your logged food is home-cooked.`);
  const fav = knownFoods(a.meals.filter(m => m.day >= addDays(a.today, -29)), 3).sort((x, y) => y.uses - x.uses).slice(0, 3);
  if (fav.length) L.push(`Foods you log most: ${fav.map(f => `${f.name} (${f.uses} times)`).join(', ')}.`);
  const byType = new Map<string, { shown: number; taken: number }>();
  for (const r of a.recs) { const e = byType.get(r.rec_type) ?? { shown: 0, taken: 0 }; e.shown++; if (r.status === 'accepted' || r.status === 'done') e.taken++; byType.set(r.rec_type, e); }
  for (const [type, e] of byType) if (e.shown >= 3 && e.taken / e.shown >= 0.5) L.push(`You tend to act on ${type.replace(/_/g, ' ')} suggestions (${e.taken} of ${e.shown}).`);
  L.push(...a.observations);
  return { kind: 'learning', title: 'What NutriSmart has learned about you', period_start: addDays(a.today, -89), period_end: a.today, based_on_days: F.logging_consistency_pct?.[90]?.value != null ? Math.round((F.logging_consistency_pct[90].value! / 100) * 90) : 0, sections: [sec('What we have noticed', L)] };
}
