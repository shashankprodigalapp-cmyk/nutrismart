import { describe, it, expect } from 'vitest';
import { buildFacts, ruleSections, validItem, validateAi, aiAcceptable, confidenceFor, buildAiContext, hashFacts, normalizeRow, type WeeklyRow } from '../../../functions/_shared/weeklyReview';

const row = (p: Partial<WeeklyRow> = {}): WeeklyRow => ({
  week_start: '2026-10-19', days_elapsed: 7, days_logged: 5, avg_calories: 1850, avg_protein: 84, calorie_adherence: 92, protein_adherence: 72,
  macro_adherence: 75, logging_adherence: 71.4, checkin_adherence: 42.9, flexible_adherence: null, energy_checkins: 3, energy_avg: 2.1, water_avg: 6, flexible_planned: 0, flexible_consumed: 0, ...p,
});
const prev = row({ protein_adherence: 60, energy_avg: 2.4, days_logged: 4 });
const t = { calories: 2000, protein: 120 };

describe('buildFacts', () => {
  const facts = buildFacts(row(), prev, t);
  it('states the numbers and the change from last week', () => {
    expect(facts.find(f => f.id === 'protein_adherence')!.text).toBe('Protein adherence was 72%, up 12 points from last week');
    expect(facts.find(f => f.id === 'logging')!.text).toBe('Food was logged on 5 of 7 days');
    expect(facts.find(f => f.id === 'energy')!.text).toContain('down 0.3');
  });
  it('has no calorie or protein facts when nothing was logged', () => {
    const f = buildFacts(row({ days_logged: 0 }), null, t);
    expect(f.some(x => x.id === 'protein_adherence')).toBe(false);
  });
  it('mentions flexible meals only when there were some', () => {
    expect(buildFacts(row(), null, t).some(f => f.id === 'flexible')).toBe(false);
    expect(buildFacts(row({ flexible_planned: 1, flexible_consumed: 1 }), null, t).find(f => f.id === 'flexible')!.text).toBe('1 flexible meal was planned and 1 eaten');
  });
});

describe('ruleSections', () => {
  it('builds a full review from facts alone, every item citing facts', () => {
    const facts = buildFacts(row(), prev, t); const s = ruleSections(facts, row());
    expect(s.headline.fact_ids.length).toBeGreaterThan(0);
    expect(s.next_week_focus[0].text.length).toBeGreaterThan(5);
    for (const it of [...s.wins, ...s.challenges, ...s.nutrition, ...s.adherence]) expect(it.fact_ids.length).toBeGreaterThan(0);
  });
  it('says there is too little data with few logged days', () => {
    const r = row({ days_logged: 1, logging_adherence: 14 });
    expect(ruleSections(buildFacts(r, null, t), r).headline.text).toContain('too little');
  });
});

describe('AI output checks', () => {
  const facts = buildFacts(row(), prev, t);
  it('accepts a sentence that repeats only cited numbers', () => {
    expect(validItem({ text: 'Protein adherence reached 72% this week, up 12 points.', fact_ids: ['protein_adherence'] }, facts)).not.toBeNull();
  });
  it('rejects invented numbers', () => { expect(validItem({ text: 'Protein adherence reached 85%.', fact_ids: ['protein_adherence'] }, facts)).toBeNull(); });
  it('rejects unknown fact ids and missing citations', () => {
    expect(validItem({ text: 'Good week.', fact_ids: ['nope'] }, facts)).toBeNull();
    expect(validItem({ text: 'Good week.', fact_ids: [] }, facts)).toBeNull();
  });
  it('rejects causal and medical claims', () => {
    expect(validItem({ text: 'Low protein caused your fatigue.', fact_ids: ['protein_adherence'] }, facts)).toBeNull();
    expect(validItem({ text: 'This may be a sign of anxiety.', fact_ids: ['energy'] }, facts)).toBeNull();
  });
  it('falls back to the rule wording for anything dropped, and judges acceptability', () => {
    const fb = ruleSections(facts, row());
    const r = validateAi({ headline: { text: 'A steady week.', fact_ids: ['logging'] }, wins: [{ text: 'Protein 99%.', fact_ids: ['protein_adherence'] }], challenges: [], next_week_focus: [], coach_conversation: null }, facts, fb);
    expect(r.sections.wins).toEqual(fb.wins); expect(r.dropped).toBeGreaterThan(0);
    expect(aiAcceptable(r.kept, r.dropped)).toBe(false);
    expect(aiAcceptable(4, 1)).toBe(true);
  });
  it('garbage from the AI never crashes', () => { expect(validateAi('nonsense', facts, ruleSections(facts, row())).kept).toBe(0); });
});

describe('context, hash, confidence, row', () => {
  it('context has facts and week only: no identity fields', () => {
    const c = buildAiContext(buildFacts(row(), null, t), row(), 'lose_fat');
    expect(Object.keys(c).sort()).toEqual(['client_goal', 'facts', 'period']);
    expect(JSON.stringify(c)).not.toMatch(/@|user_id|email|name/i);
  });
  it('the hash changes only when the facts change', async () => {
    const a = await hashFacts(buildFacts(row(), null, t)); const b = await hashFacts(buildFacts(row(), null, t)); const c = await hashFacts(buildFacts(row({ days_logged: 6 }), null, t));
    expect(a).toBe(b); expect(a).not.toBe(c);
  });
  it('confidence follows the data rules', () => {
    expect(confidenceFor(2)).toBe('insufficient'); expect(confidenceFor(3)).toBe('early'); expect(confidenceFor(7)).toBe('emerging'); expect(confidenceFor(15)).toBe('repeated');
  });
  it('normalizeRow turns database strings into numbers', () => { expect(normalizeRow({ week_start: '2026-10-19', days_logged: '4', avg_protein: '80.5', energy_avg: null })!.avg_protein).toBe(80.5); });
});
