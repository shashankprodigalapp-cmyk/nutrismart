import { describe, it, expect } from 'vitest';
import { computeFeatures, indexFeatures, loggingStreak } from '../../lib/intel/features';
import { recommend, recOutcome } from '../../lib/intel/recommend';
import { buildCandidates, decide, composeMessage, classifyOutcome } from '../../lib/intel/notifyDecide';
import { weeklyReport, personalLearning, type RecRecord } from '../../lib/intel/reports';
import { todaySignal } from '../../lib/intel/signal';
import { days, meal, TARGETS } from './fixtures';
import { addDays, weekStart } from '../../lib/intel/dates';
import type { MealRow, DayRow } from '../../lib/intel/types';

/** The full 2.1 loop in one test: log -> analytics -> recommendation -> notification -> action -> outcome -> weekly report. */
describe('2.1 end-to-end loop (pure)', () => {
  const D1 = '2026-10-25';                      // Sunday, day the advice is given
  const history = (end: string, lunchProtein: number, n: number) => {
    const rows: DayRow[] = [], meals: MealRow[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const day = addDays(end, -i);
      rows.push({ day, calories: 1900, protein_g: 55 + lunchProtein, meals: 3, items: 4, energy: 3, hunger: 3 });
      meals.push(meal(day, 'lunch', 'Roti sabzi', 420, lunchProtein), meal(day, 'dinner', 'Dal rice', 500, 14));
      if (i % 2 === 0) meals.push(meal(day, 'snack', 'Curd', 100, 9), meal(day, 'snack', 'Paneer', 200, 14));
    }
    return { rows, meals };
  };
  const feats = (rows: DayRow[], meals: MealRow[], today: string) => indexFeatures(computeFeatures({ rows, meals, targets: TARGETS, today, now: new Date(today + 'T06:00:00Z') }));

  it('walks the whole loop and every step is explainable', () => {
    // 1-2. The person logs light lunches for two weeks; analytics update.
    const a = history(D1, 6, 14);
    const f1 = feats(a.rows, a.meals, D1);
    expect(f1.lunch_protein_avg[7].value).toBe(6); expect(f1.lunch_protein_avg[7].confidence).toBe('high');

    // 3. A personal recommendation appears, from foods they already log.
    const recs = recommend({ features: f1, rows: a.rows, meals: a.meals, targets: TARGETS, today: D1 });
    const r = recs.find(x => x.rec_key === 'protein_lunch')!;
    expect(r.action).toMatch(/Paneer|Curd/); expect(r.metric).toEqual({ feature: 'lunch_protein_avg', window_days: 7, value: 6, direction: 'up' });

    // 4. A notification is scheduled, with its reason, and passes every control.
    const noon = new Date('2026-10-25T06:30:00Z');       // 12:00 IST
    const cands = buildCandidates({ now: noon, today: D1, loggedToday: true, loggedDays7: 7, streak: loggingStreak(a.rows, D1), hasCheckinToday: true, topProteinRec: { text: r.reason }, weekday: 0, energyIntelligence: false });
    const d = decide(cands, { now: noon, history: [], prefs: { enabled: true, kindsOff: [], quietStart: 1290, quietEnd: 450, maxPerDay: 2 } }).find(x => x.kind === 'protein_reminder')!;
    expect(d.decision).toBe('send'); expect(d.why.reason).toBe(r.reason);
    expect(composeMessage(cands.find(c => c.kind === 'protein_reminder')!, { action: r.action }).body.length).toBeLessThanOrEqual(140);

    // 5. The person acts: next week lunches include paneer, protein goes up.
    const D2 = addDays(D1, 7);
    const b = history(D2, 22, 14);
    const f2 = feats(b.rows, b.meals, D2);
    expect(f2.lunch_protein_avg[7].value).toBe(22);

    // 6. The outcome is recorded.
    const out = recOutcome(r.metric!, { value: f2.lunch_protein_avg[7].value, sample_size: f2.lunch_protein_avg[7].sample_size })!;
    expect(out.result).toBe('helped'); expect([out.before, out.after]).toEqual([6, 22]);
    expect(classifyOutcome({ opened: true, acted: true, loggedWithin24h: true, hoursSince: 30 })).toBe('helped');

    // 7. The weekly report reflects the outcome.
    const rec: RecRecord = { rec_type: r.rec_type, rec_key: r.rec_key, status: 'accepted', action: r.action, outcome: { result: out.result }, created_day: D1 };
    const wk = weeklyReport({ weekStart: weekStart(D2), rows: b.rows, features: f2, targets: TARGETS, recs: [rec], observations: [] });
    expect(wk.sections.find(s => s.heading === 'Suggestions')!.lines.join(' ')).toContain(`Helped: ${r.action}`);
    expect(personalLearning({ today: D2, features: f2, meals: b.meals, recs: [rec], observations: [] }).sections[0].lines.join(' ')).toMatch(/lunches average 22g protein/);
  });

  it('no change is reported honestly, not as a win', () => {
    const out = recOutcome({ feature: 'lunch_protein_avg', window_days: 7, value: 6, direction: 'up' }, { value: 6.5, sample_size: 6 })!;
    expect(out.result).toBe('no_change');
    expect(recOutcome({ feature: 'x', window_days: 7, value: 6, direction: 'up' }, { value: 30, sample_size: 1 })).toBeNull();          // too little data
    expect(recOutcome({ feature: 'x', window_days: 7, value: 6, direction: 'up' }, { value: null, sample_size: 0 })).toBeNull();
    expect(recOutcome({ feature: 'calorie_vs_target_pct', window_days: 7, value: 130, direction: 'down' }, { value: 105, sample_size: 6 })!.result).toBe('helped');
  });

  it('today signal picks the right thing, in plain words', () => {
    const base = { hour: 14, targets: TARGETS, totals: { calories: 800, protein: 40, meals: 2 }, flexReservedCal: 0, streak: 0 };
    expect(todaySignal({ ...base, flexReservedCal: 900 }).headline).toMatch(/flexible meal/);
    expect(todaySignal({ ...base, topReason: 'Your lunches are light on protein.' }).headline).toBe('Your lunches are light on protein.');
    expect(todaySignal({ ...base, totals: { calories: 0, protein: 0, meals: 0 } }).headline).toMatch(/Nothing logged/);
    expect(todaySignal({ ...base, totals: { calories: 2400, protein: 90, meals: 3 } }).detail).toMatch(/No need to skip/);
    expect(todaySignal({ ...base, hour: 18, totals: { calories: 1000, protein: 30, meals: 2 } }).headline).toMatch(/Protein is behind/);
    expect(todaySignal({ ...base, streak: 6 }).headline).toMatch(/6 days/);
    expect(todaySignal(base).headline).toBe('You are on track');
  });
});
