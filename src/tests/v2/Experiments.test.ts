import { describe, it, expect } from 'vitest';
import { evaluate, addDays, TEMPLATES, type DayValues, type Exp } from '../../lib/experiments';

const exp = (p: Partial<Exp> = {}): Exp => ({ start_date: '2026-10-10', duration_days: 7, baseline_days: 7, status: 'active', metrics: ['energy', 'hunger'], actions: ['a', 'b'], ...p });
function series(from: string, n: number, v: DayValues): Record<string, DayValues> { const o: Record<string, DayValues> = {}; for (let i = 0; i < n; i++) o[addDays(from, i)] = v; return o; }

describe('evaluate', () => {
  const values = { ...series('2026-10-03', 7, { energy: 2.9, hunger: 4 }), ...series('2026-10-10', 7, { energy: 3.6, hunger: 3 }) };
  it('compares before and during with the real averages', () => {
    const r = evaluate(exp(), values, {}, '2026-10-16');
    const e = r.metrics.find(m => m.key === 'energy')!;
    expect(e.before).toBe(2.9); expect(e.during).toBe(3.6); expect(e.verdict).toBe('higher');
    expect(e.text).toContain('2.9 before and 3.6 during');
    expect(r.phase).toBe('running'); expect(r.dayNumber).toBe(7);
  });
  it('treats a lower hunger score as the hoped-for direction', () => {
    expect(evaluate(exp(), values, {}, '2026-10-16').summary).toMatch(/less hunger/);
  });
  it('always says it is not proof', () => { expect(evaluate(exp(), values, {}, '2026-10-16').summary).toMatch(/not proof/); });
  it('needs 3 days of each', () => {
    const few = { ...series('2026-10-03', 7, { energy: 3 }), ...series('2026-10-10', 2, { energy: 4 }) };
    const e = evaluate(exp(), few, {}, '2026-10-12').metrics[0];
    expect(e.verdict).toBe('not_enough_data'); expect(e.change).toBeNull();
  });
  it('small changes are about the same', () => {
    const same = { ...series('2026-10-03', 7, { energy: 3 }), ...series('2026-10-10', 7, { energy: 3.1 }) };
    expect(evaluate(exp(), same, {}, '2026-10-16').metrics[0].verdict).toBe('same');
  });
  it('knows the phase and days left', () => {
    expect(evaluate(exp(), {}, {}, '2026-10-08').phase).toBe('not_started');
    const r = evaluate(exp(), {}, {}, '2026-10-12');
    expect(r.dayNumber).toBe(3); expect(r.daysLeft).toBe(4);
    expect(evaluate(exp(), {}, {}, '2026-10-17').phase).toBe('finished');
    expect(evaluate(exp({ status: 'cancelled' }), {}, {}, '2026-10-12').phase).toBe('finished');
  });
  it('works out how many steps were done', () => {
    const ticks: Record<string, number[]> = { '2026-10-10': [0, 1], '2026-10-11': [0] };
    expect(evaluate(exp(), {}, ticks, '2026-10-11').adherencePct).toBe(75);
  });
  it('warns when few steps were done', () => {
    const r = evaluate(exp(), values, { '2026-10-10': [0] }, '2026-10-16');
    expect(r.adherencePct).toBeLessThan(50); expect(r.summary).toMatch(/says little/);
  });
  it('says so when nothing can be compared', () => {
    expect(evaluate(exp(), {}, {}, '2026-10-12').summary).toMatch(/Not enough data/);
  });
  it('does not claim a cause', () => { expect(evaluate(exp(), values, {}, '2026-10-16').summary).not.toMatch(/\bbecause\b|\bdue to\b|\bled to\b|\bresulted in\b|\bworked\b/i); });
});

describe('templates', () => {
  it('are valid for the database limits', () => {
    for (const t of TEMPLATES) { expect(t.actions.length).toBeGreaterThanOrEqual(1); expect(t.actions.length).toBeLessThanOrEqual(6); expect(t.metrics.length).toBeLessThanOrEqual(6); expect(t.title.length).toBeGreaterThanOrEqual(3); expect(t.key.length).toBeLessThanOrEqual(40); }
  });
});
