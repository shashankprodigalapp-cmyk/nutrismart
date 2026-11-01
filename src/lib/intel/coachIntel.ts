/**
 * Coach intelligence (2.1 P7): who needs attention, why, what changed, what evidence, what to ask, what to do, and what happened after the last intervention.
 */
import type { DayRow, Targets } from './types';
import type { FeatureIndex } from './features';
import { addDays, daysBetween } from './dates';
import { cleanDraft } from './draft';

export interface Intervention { at: string; kind: 'message' | 'nudge' | 'recommendation'; label: string }
export interface InterventionOutcome {
  at: string; label: string; status: 'too_early' | 'improved' | 'no_change' | 'declined';
  before: { loggedDays: number; avgProtein: number | null }; after: { loggedDays: number; avgProtein: number | null }; text: string;
}
const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;

/** Compare the 7 days before an intervention with the 7 days after. Needs 7 full days after, otherwise "too early". */
export function interventionOutcome(rows: DayRow[], iv: Intervention, today: string): InterventionOutcome {
  const win = (from: string, to: string) => rows.filter(r => r.day >= from && r.day <= to && r.items > 0);
  const b = win(addDays(iv.at, -7), addDays(iv.at, -1)), a = win(addDays(iv.at, 1), addDays(iv.at, 7));
  const before = { loggedDays: b.length, avgProtein: avg(b.map(r => r.protein_g)) }, after = { loggedDays: a.length, avgProtein: avg(a.map(r => r.protein_g)) };
  const base = { at: iv.at, label: iv.label, before, after };
  if (daysBetween(iv.at, today) < 8) return { ...base, status: 'too_early', text: 'Too early to tell. Check again after a full week.' };
  const dLog = after.loggedDays - before.loggedDays;
  const dPro = after.avgProtein != null && before.avgProtein != null ? after.avgProtein - before.avgProtein : 0;
  const status = dLog >= 1 || dPro >= 5 ? 'improved' : dLog <= -1 || dPro <= -5 ? 'declined' : 'no_change';
  const text = `Logged days: ${before.loggedDays} before, ${after.loggedDays} after.` + (before.avgProtein != null && after.avgProtein != null ? ` Protein: ${before.avgProtein}g before, ${after.avgProtein}g after.` : '');
  return { ...base, status, text };
}

export interface CoachBrief {
  needsAttention: boolean; headline: string; reasons: string[]; whatChanged: string[]; evidence: string[]; questions: string[]; actions: string[];
  draft: string | null; outcomes: InterventionOutcome[];
}

export function coachBrief(inp: { features: FeatureIndex; rows: DayRow[]; targets: Targets; today: string; interventions?: Intervention[]; firstName?: string }): CoachBrief {
  const F = inp.features, reasons: string[] = [], changed: string[] = [], evidence: string[] = [], questions: string[] = [], actions: string[] = [];
  const lc = F.logging_consistency_pct?.[7], pro = F.protein_vs_target_pct?.[7], cal = F.calorie_vs_target_pct?.[7], en = F.energy_avg?.[7], hu = F.hunger_avg?.[7];
  let draftReason: string | null = null;

  if (lc?.value != null && lc.baseline != null && lc.baseline - lc.value >= 28) {
    const now = Math.round((lc.value / 100) * 7), was = Math.round((lc.baseline / 100) * 7);
    reasons.push('Logging dropped.'); changed.push(`Logged days fell from ${was} to ${now} of 7.`); evidence.push(`${now} of the last 7 days have entries; the 7 days before had ${was}.`);
    questions.push('What got in the way of logging this week?'); actions.push('Send a short, friendly message and ask for one meal a day.'); draftReason = 'logging';
  }
  if (pro?.value != null && pro.sample_size >= 4 && pro.value < 70) {
    reasons.push('Protein is well under the goal.'); evidence.push(`Protein averaged ${Math.round(pro.value)}% of goal over ${pro.sample_size} logged days.`);
    if (pro.delta != null && Math.abs(pro.delta) >= 5) changed.push(`Protein vs goal moved ${pro.delta > 0 ? 'up' : 'down'} by ${Math.abs(Math.round(pro.delta))} points.`);
    questions.push('Which meal has the least protein, and what do they usually eat there?'); actions.push('Agree one familiar protein food to add at that meal.'); draftReason ??= 'protein';
  }
  if (cal?.value != null && cal.sample_size >= 4 && (cal.value > 120 || cal.value < 70)) {
    reasons.push(cal.value > 120 ? 'Calories are above the goal.' : 'Logged calories look low.'); evidence.push(`Calories averaged ${Math.round(cal.value)}% of goal over ${cal.sample_size} logged days.`);
    questions.push(cal.value > 120 ? 'Which meals or days run highest?' : 'Are some meals going unlogged?'); actions.push(cal.value > 120 ? 'Look at the biggest repeated item and agree a smaller portion.' : 'Check whether the goal is realistic or entries are missing.');
  }
  if (en?.value != null && en.trend === 'down' && en.sample_size >= 4) {
    reasons.push('Energy ratings are lower.'); changed.push(`Average energy moved from ${en.baseline} to ${en.value} out of 5.`); evidence.push(`${en.sample_size} energy check-ins this week.`);
    questions.push('How have sleep and meal timing been this week?'); actions.push('Ask how they feel; suggest a doctor or dietitian if it continues.');
  }
  if (hu?.value != null && hu.value >= 4 && hu.sample_size >= 4) { reasons.push('Hunger is often high.'); evidence.push(`Average hunger ${hu.value} out of 5 over ${hu.sample_size} check-ins.`); questions.push('When in the day is hunger highest?'); }

  const outcomes = (inp.interventions ?? []).map(iv => interventionOutcome(inp.rows, iv, inp.today)).sort((a, b) => b.at.localeCompare(a.at));
  const last = outcomes[0];
  if (last && last.status === 'no_change') actions.push('Your last message did not change much. Try a different, smaller ask.');
  const name = inp.firstName ? ` ${inp.firstName}` : '';
  const draft = draftReason === 'logging' ? cleanDraft(`Hi${name}, I noticed fewer logs this week. Could you log just one meal a day? It helps me help you.`)
    : draftReason === 'protein' ? cleanDraft(`Hi${name}, your protein looks a bit low. Could we add one protein food you like to your lunch?`) : null;
  return {
    needsAttention: reasons.length > 0, headline: reasons[0] ?? 'On track. Nothing needs you today.', reasons, whatChanged: changed, evidence, questions: questions.slice(0, 3), actions: actions.slice(0, 3), draft, outcomes,
  };
}
