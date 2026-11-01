import { describe, it, expect } from 'vitest';
import { observe, isObservational } from '../../lib/intel/energyIntel';
import { coachBrief, interventionOutcome } from '../../lib/intel/coachIntel';
import { dailyReport, weeklyReport, monthlyReport, personalLearning, type RecRecord } from '../../lib/intel/reports';
import { computeFeatures, indexFeatures } from '../../lib/intel/features';
import { cleanDraft } from '../../lib/intel/draft';
import { days, meal, TODAY, TARGETS } from './fixtures';
import { addDays, weekStart } from '../../lib/intel/dates';

const NOW = new Date('2026-11-01T10:00:00Z');
const feats = (rows: ReturnType<typeof days>, meals: ReturnType<typeof meal>[] = []) => indexFeatures(computeFeatures({ rows, meals, targets: TARGETS, today: TODAY, now: NOW }));

describe('2.1 energy and mood observations', () => {
  it('reports the pattern with its sample size and observational words', () => {
    const rows = days(12, i => (i < 6 ? { protein_g: 40, energy: 2 } : { protein_g: 95, energy: 4 }));
    const o = observe({ rows, targets: TARGETS }).find(x => x.key === 'energy_low_protein')!;
    expect(o.text).toMatch(/On 6 of your 6 days/); expect(o.text).toMatch(/observation/); expect(isObservational(o.text)).toBe(true);
  });
  it('stays silent below the minimum number of days or hits', () => {
    expect(observe({ rows: days(5, () => ({ protein_g: 40, energy: 2 })), targets: TARGETS })).toHaveLength(0);
    expect(observe({ rows: days(12, i => ({ protein_g: i === 0 ? 40 : 95, energy: i === 0 ? 2 : 4 })), targets: TARGETS })).toHaveLength(0);
  });
  it('never uses causal or medical words, and rejects text that does', () => {
    expect(isObservational('Low protein causes your fatigue.')).toBe(false);
    expect(isObservational('You may have a deficiency.')).toBe(false);
    expect(isObservational('You reported lower energy on 4 of 6 days.')).toBe(true);
  });
  it('links high hunger to light lunches only as a pairing, and needs meals', () => {
    const rows = days(12, i => ({ hunger: i < 5 ? 5 : 2 }));
    const meals = days(12, () => ({})).map(r => meal(r.day, 'lunch', 'Roti', 400, rows.findIndex(x => x.day === r.day) >= 7 ? 5 : 30));
    const o = observe({ rows, meals, targets: TARGETS });
    expect(o.every(x => isObservational(x.text))).toBe(true);
  });
  it('digestion notes suggest talking to a professional without diagnosing', () => {
    const dg = days(8, () => ({})).map((r, i) => ({ day: r.day, digestion: (i < 4 ? 'heavy' : 'comfortable') as 'heavy' | 'comfortable' }));
    const o = observe({ rows: days(8, () => ({})), targets: TARGETS, digestion: dg }).find(x => x.key === 'digestion_heavy')!;
    expect(o.text).toMatch(/doctor or dietitian/); expect(o.text).not.toMatch(/diagnos|disease/i);
  });
});

describe('2.1 coach intelligence', () => {
  const slipping = days(14, (i) => (i < 7 ? (i % 4 === 0 ? { protein_g: 45 } : null) : { protein_g: 90 }));
  it('explains who needs attention, why, what changed, the evidence, what to ask and what to do', () => {
    const b = coachBrief({ features: feats(slipping), rows: slipping, targets: TARGETS, today: TODAY, firstName: 'Asha' });
    expect(b.needsAttention).toBe(true); expect(b.reasons).toContain('Logging dropped.');
    expect(b.whatChanged[0]).toMatch(/fell from 7 to 2 of 7/); expect(b.evidence[0]).toMatch(/2 of the last 7 days/);
    expect(b.questions.length).toBeGreaterThan(0); expect(b.actions.length).toBeGreaterThan(0);
    expect(b.draft).toMatch(/Hi Asha/); expect(cleanDraft(b.draft)).toBe(b.draft);
  });
  it('a steady client does not need attention', () => {
    const ok = days(14, () => ({ protein_g: 95, calories: 2000 }));
    const b = coachBrief({ features: feats(ok), rows: ok, targets: TARGETS, today: TODAY });
    expect(b.needsAttention).toBe(false); expect(b.headline).toMatch(/Nothing needs you/); expect(b.draft).toBeNull();
  });
  it('measures what happened after an intervention: too early, improved, no change', () => {
    const at = addDays(TODAY, -10);
    const improved = days(30, i => (i > 10 ? { protein_g: 50 } : i < 10 && i > 2 ? { protein_g: 85 } : null));
    const r = interventionOutcome(improved, { at, kind: 'message', label: 'Protein message' }, TODAY);
    expect(r.status).toBe('improved'); expect(r.text).toMatch(/Logged days/);
    expect(interventionOutcome(improved, { at: addDays(TODAY, -3), kind: 'message', label: 'x' }, TODAY).status).toBe('too_early');
    const same = days(30, () => ({ protein_g: 80 }));
    expect(interventionOutcome(same, { at, kind: 'nudge', label: 'x' }, TODAY).status).toBe('no_change');
  });
  it('when the last message changed nothing the brief says to try something smaller', () => {
    const same = days(30, () => ({ protein_g: 40 }));
    const b = coachBrief({ features: feats(same), rows: same, targets: TARGETS, today: TODAY, interventions: [{ at: addDays(TODAY, -12), kind: 'message', label: 'Protein message' }] });
    expect(b.outcomes[0].status).toBe('no_change'); expect(b.actions.join(' ')).toMatch(/different, smaller ask/);
  });
  it('draft text rules: short, no links', () => {
    expect(cleanDraft('Hi, see https://x.com')).toBeNull(); expect(cleanDraft('x'.repeat(141))).toBeNull(); expect(cleanDraft('  Hello  there ')).toBe('Hello there');
  });
});

describe('2.1 reports come from the numbers', () => {
  const rows = days(30, i => ({ calories: 1900 + (i % 3) * 50, protein_g: 70, energy: 3, hunger: 3 }));
  const meals = days(30, () => ({})).flatMap(r => [meal(r.day, 'lunch', 'Dal', 250, 12), meal(r.day, 'dinner', 'Roti sabzi', 400, 8)]);
  const F = feats(rows, meals);
  const recs: RecRecord[] = [
    { rec_type: 'protein_addition', rec_key: 'protein_lunch', status: 'accepted', action: 'Add curd to lunch', outcome: { result: 'helped' }, created_day: addDays(weekStart(TODAY), 1) },
    { rec_type: 'portion_adjustment', rec_key: 'calories_over', status: 'dismissed', action: 'Smaller biryani', created_day: addDays(weekStart(TODAY), 2) },
  ];
  it('daily: one concise next action', () => {
    const r = dailyReport({ today: TODAY, features: F, topAction: 'Add curd to lunch' });
    expect(r.next_action).toBe('Add curd to lunch'); expect(r.sections[0].lines.join(' ')).toMatch(/Calories so far/);
  });
  it('weekly: numbers match the data, covers every required section', () => {
    const r = weeklyReport({ weekStart: weekStart(TODAY), rows, features: F, targets: TARGETS, recs, observations: ['On 4 of 6 days...'] });
    expect(r.sections.map(s => s.heading)).toEqual(['Nutrition', 'Adherence', 'Energy, hunger and mood', 'What changed', 'Patterns', 'Suggestions']);
    expect(r.sections[1].lines[0]).toBe('Logged 7 of 7 days.');            // 2026-10-26 .. 2026-11-01
    expect(r.sections[0].lines[1]).toMatch(/protein: 70g \(goal 100g\)/);
    expect(r.sections[5].lines.join(' ')).toMatch(/1 of 2 suggestions taken, 1 set aside/); expect(r.sections[5].lines.join(' ')).toMatch(/Helped: Add curd to lunch/);
  });
  it('weekly with no data says so instead of inventing', () => {
    const r = weeklyReport({ weekStart: weekStart(TODAY), rows: [], features: feats([]), targets: TARGETS, recs: [], observations: [] });
    expect(r.sections[0].lines).toEqual(['Not enough data yet.']); expect(r.sections[1].lines[0]).toBe('Logged 0 of 7 days.');
  });
  it('monthly: trends, what worked, what did not, next priorities', () => {
    const r = monthlyReport({ monthStart: '2026-11-01', monthEnd: '2026-11-30', features: F, recs, messages: [{ sender_type: 'coach', sent_day: TODAY }, { sender_type: 'auto', sent_day: TODAY }], targets: TARGETS, rows });
    expect(r.sections.map(s => s.heading)).toEqual(['Trends', 'Suggestions and messages', 'What worked', 'What did not', 'Next priorities']);
    expect(r.sections[2].lines).toEqual(['Add curd to lunch']); expect(r.sections[3].lines).toEqual(['Smaller biryani']);
    expect(r.sections[1].lines[1]).toBe('1 coach messages, 1 automatic.');
  });
  it('personal learning states facts with their sample sizes', () => {
    const r = personalLearning({ today: TODAY, features: F, meals, recs, observations: [] });
    const text = r.sections[0].lines.join('\n');
    expect(text).toMatch(/Your lunches average 12g protein \(from 30 days\)/); expect(text).toMatch(/Foods you log most: .*Dal \(30 times\)/);
  });
});
