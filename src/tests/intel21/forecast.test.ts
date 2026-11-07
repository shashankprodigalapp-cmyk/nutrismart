import { describe, it, expect } from 'vitest';
import { weekLanding, hardWeekdays, energyPatterns, lapseRisk, proteinCatchup, runForecasts, forecastHash, FORECAST_FLAGS, FORECAST_KEYS } from '../../lib/intel/forecast';
import { days, meal, TODAY, TARGETS } from './fixtures';
import { addDays, weekday } from '../../lib/intel/dates';

const NOW = new Date('2026-11-01T10:00:00Z');
const inp = (rows: ReturnType<typeof days>, meals: ReturnType<typeof meal>[] = [], hour = 15) => ({ rows, meals, targets: TARGETS, today: TODAY, now: NOW, hour });
const BAN = /\b(lose|gain|weight|kg|fat loss|will lose|diagnos|disease|cure)\b/i;

describe('1. week landing', () => {
  it('says not enough data below 3 finished days, and does not guess', () => {
    const f = weekLanding(inp(days(8, (i) => i >= 1 && i <= 2 ? {} : null)));
    expect(f.status).toBe('insufficient'); expect(f.confidence).toBe('none'); expect(f.data).toEqual({});
  });
  it('projects from finished days only and ignores today', () => {
    const f = weekLanding(inp(days(7, (i) => i === 0 ? { calories: 9999 } : { calories: 2000 })));
    expect(f.status).toBe('ready'); expect(f.data.avg_cal).toBe(2000); expect(f.data.days_counted).toBe(6);
    expect(f.headline).toContain('close to'); expect(f.confidence).toBe('high');
  });
  it('flags above target, with low confidence on 3 days', () => {
    const f = weekLanding(inp(days(7, (i) => i >= 4 ? { calories: 2600 } : null)));
    expect(f.data.days_counted).toBe(3); expect(f.confidence).toBe('low'); expect(f.headline).toContain('above');
  });
  it('days with no meals do not count as logged', () => {
    const f = weekLanding(inp(days(7, (i) => i === 0 ? null : i % 2 ? { meals: 0, calories: 0 } : {})));
    expect(f.data.days_counted ?? 0).toBeLessThan(6);
  });
});

describe('2. hard weekdays', () => {
  it('needs about 3 weeks', () => { expect(hardWeekdays(inp(days(14, () => ({})))).status).toBe('insufficient'); });
  it('finds the weekday that runs over, with sample sizes', () => {
    const f = hardWeekdays(inp(days(57, (i, d) => i === 0 ? null : weekday(d) === 6 ? { calories: 2700 } : { calories: 1900, protein_g: 100 })));
    expect(f.status).toBe('ready'); expect((f.data.days as any[])[0].name).toBe('Saturday'); expect(f.evidence[0]).toMatch(/\d+ days/);
  });
  it('reports no standout day when nothing stands out', () => {
    const f = hardWeekdays(inp(days(57, (i) => i === 0 ? null : { calories: 1900, protein_g: 100 })));
    expect(f.status).toBe('ready'); expect(f.data.days).toEqual([]);
  });
  it('ignores a weekday with fewer than 3 samples', () => {
    const rows = days(57, (i, d) => i === 0 || weekday(d) === 3 ? null : { calories: 1900, protein_g: 100 });
    rows.push({ day: addDays(TODAY, -4), calories: 4000, protein_g: 10, meals: 3, items: 3 });
    expect(JSON.stringify(hardWeekdays(inp(rows)).data)).not.toContain('Wednesday');
  });
});

describe('3. energy patterns', () => {
  const rows = (hitE: number, missE: number) => days(40, (i) => i === 0 ? null : i % 2 ? { protein_g: 100, energy: hitE, hunger: 2 } : { protein_g: 40, energy: missE, hunger: 4 });
  it('insufficient with few check-ins', () => { expect(energyPatterns(inp(days(40, () => ({})))).status).toBe('insufficient'); });
  it('insufficient when one group is too small', () => {
    expect(energyPatterns(inp(days(40, (i) => i === 0 ? null : i < 4 ? { protein_g: 100, energy: 4 } : { protein_g: 30, energy: 2 }))).status).toBe('insufficient');
  });
  it('reports the difference as a pattern, not a cause', () => {
    const f = energyPatterns(inp(rows(4, 2.5)));
    expect(f.status).toBe('ready'); expect(f.headline).toMatch(/pattern, not a cause/); expect(f.data.energy).toBeTruthy();
  });
  it('says no clear difference when the gap is small', () => {
    expect(energyPatterns(inp(days(40, (i) => i === 0 ? null : { protein_g: i % 2 ? 100 : 40, energy: 3, hunger: 3 }))).headline).toMatch(/No clear difference/);
  });
  it('is skipped unless energy is shared', () => {
    const on = { energy_patterns: true };
    expect(runForecasts(inp(rows(4, 2)), on, { food: true, energy: false })).toHaveLength(0);
    expect(runForecasts(inp(rows(4, 2)), on, { food: true, energy: true })).toHaveLength(1);
  });
});

describe('4. lapse risk', () => {
  it('needs a week of logging', () => { expect(lapseRisk(inp(days(5, () => ({})))).status).toBe('insufficient'); });
  it('low when steady', () => { const f = lapseRisk(inp(days(29, (i) => i === 0 ? null : {}))); expect(f.data.level).toBe('low'); });
  it('high after a good month then 3 missed days', () => {
    const f = lapseRisk(inp(days(29, (i) => i === 0 || i <= 3 ? null : {})));
    expect(f.data.level).toBe('high'); expect(f.data.gap_days).toBe(3);
  });
  it('low but noted when only yesterday was missed', () => {
    const f = lapseRisk(inp(days(29, (i) => i <= 1 ? null : {}))); expect(f.data.level).toBe('low'); expect(f.evidence[0]).toMatch(/Yesterday/);
  });
  it('medium after two missed days', () => { expect(lapseRisk(inp(days(29, (i) => i <= 2 ? null : {}))).data.level).toBe('medium'); });
  it('does not call a person who always logs 3 days a week a lapse', () => {
    const f = lapseRisk(inp(days(29, (i) => i === 0 || i % 7 > 2 ? null : {})));
    expect(f.status).toBe('ready'); expect(['low', 'medium']).toContain(f.data.level);
  });
});

describe('5. protein catch-up', () => {
  const hist = [1, 2, 3].flatMap(k => [meal(addDays(TODAY, -k), 'lunch', 'Paneer bhurji', 300, 22), meal(addDays(TODAY, -k), 'dinner', 'Whey shake', 150, 25), meal(addDays(TODAY, -k), 'snack', 'Banana chips', 200, 2)]);
  it('arithmetic: target minus today', () => {
    const f = proteinCatchup(inp(days(1, () => ({ protein_g: 40 })), hist));
    expect(f.data.left).toBe(60); expect(f.status).toBe('ready');
  });
  it('suggests only the person\'s own protein-dense foods', () => {
    const f = proteinCatchup(inp(days(1, () => ({ protein_g: 40 })), hist));
    const names = (f.data.foods as any[]).map(x => x.name); expect(names).toContain('paneer bhurji'); expect(names).not.toContain('banana chips');
  });
  it('target reached', () => { expect(proteinCatchup(inp(days(1, () => ({ protein_g: 120 })))).headline).toMatch(/reached/); });
  it('waits until midday', () => { expect(proteinCatchup(inp(days(1, () => ({ protein_g: 0 })), [], 9)).status).toBe('insufficient'); });
  it('works with nothing logged today and no history', () => {
    const f = proteinCatchup(inp([], [])); expect(f.data.left).toBe(100); expect(f.confidence).toBe('low');
  });
});

describe('all five', () => {
  const all = Object.fromEntries(FORECAST_KEYS.map(k => [k, true]));
  it('each has its own switch', () => { expect(new Set(Object.values(FORECAST_FLAGS)).size).toBe(5); });
  it('runs only switched-on forecasts', () => {
    expect(runForecasts(inp(days(60, () => ({}))), { lapse_risk: true }).map(f => f.key)).toEqual(['lapse_risk']);
    expect(runForecasts(inp([]), {})).toHaveLength(0);
  });
  it('nothing runs without food sharing', () => { expect(runForecasts(inp(days(60, () => ({}))), all, { food: false, energy: false })).toHaveLength(0); });
  it('empty or inconsistent data never throws and never predicts weight or health', () => {
    const weird = [{ day: TODAY, calories: NaN, protein_g: -5, meals: 0, items: 0 }, { day: 'bad', calories: 1e9, protein_g: 1e9, meals: 99, items: 1 }] as any;
    for (const rows of [[], weird]) for (const f of runForecasts(inp(rows), all)) {
      expect(BAN.test(f.headline + f.evidence.join(' '))).toBe(false);
      expect(f.expires_at > f.calculated_at).toBe(true);
    }
  });
  it('every ready/insufficient forecast carries confidence, sample size, minimum and expiry', () => {
    for (const f of runForecasts(inp(days(60, () => ({ energy: 3, hunger: 3 }))), all)) {
      expect(['none', 'low', 'medium', 'high']).toContain(f.confidence); expect(typeof f.sample_size).toBe('number'); expect(f.min_needed).toBeGreaterThanOrEqual(0);
      expect(f.evidence.length).toBeGreaterThan(0); expect(f.version).toBe(1);
    }
  });
  it('insufficient forecasts have no confidence', () => { expect(weekLanding(inp([])).confidence).toBe('none'); });
  it('hash is stable and ignores timestamps, changes with content', () => {
    const a = lapseRisk(inp(days(29, (i) => i === 0 ? null : {}))); const b = { ...a, calculated_at: 'x', expires_at: 'y' };
    expect(forecastHash(a)).toBe(forecastHash(b));
    expect(forecastHash(a)).not.toBe(forecastHash(lapseRisk(inp(days(29, (i) => i <= 3 ? null : {})))));
  });
});

import { readFileSync } from 'node:fs';
describe('cost and safety guards', () => {
  const src = readFileSync('src/lib/intel/forecast.ts', 'utf8');
  it('forecast code never calls the network or an AI model', () => { expect(/fetch\(|gemini|openai|anthropic|import .*supabase/i.test(src)).toBe(false); });
  it('the energy forecast ships switched off in the migration', () => {
    const sql = readFileSync('supabase/migrations/045_forecasts.sql', 'utf8');
    expect(/\('forecast_energy_patterns',\s*FALSE/.test(sql)).toBe(true);
    expect((sql.match(/'forecast_[a-z_]+',\s*FALSE/g) ?? []).length).toBe(5);
  });
  it('the Today card and coach brief show forecasts', () => {
    expect(readFileSync('src/components/intel/DailyIntelligence.tsx', 'utf8')).toContain('data-testid="forecasts"');
    expect(readFileSync('src/components/coach/CoachBrief.tsx', 'utf8')).toContain('coach-forecasts');
  });
  it('the coach path only runs forecasts the client shared', () => {
    expect(readFileSync('functions/api/coach-intel.ts', 'utf8')).toMatch(/forecastsFor\(snap, now, fon, \{ food: true, energy: !!rel\.share_scope\?\.energy \}\)/);
  });
});
