import { describe as suite, it, expect } from 'vitest';
import { describe, groupByDay, collapseWater, dayLabel, type TimelineEvent } from '../../lib/timeline';

const ev = (id: string, type: string, iso: string, payload: Record<string, unknown> = {}, scope = 'food'): TimelineEvent => ({ id, event_type: type, scope, occurred_at: iso, payload });

suite('describe', () => {
  it('shows a food line with calories and protein', () => {
    const l = describe(ev('1', 'food_logged', '2026-10-27T03:00:00Z', { meal: 'lunch', food_name: 'Dal', cal: 150.4, protein: 8.2 }));
    expect(l.title).toBe('Lunch logged: Dal'); expect(l.detail).toBe('150 kcal · 8g protein'); expect(l.time).toBe('08:30');
  });
  it('shows energy and water', () => {
    expect(describe(ev('2', 'energy_logged', '2026-10-27T10:00:00Z', { level: 'low', meal_before: 'lunch' }, 'energy')).title).toBe('Energy: Low');
    expect(describe(ev('3', 'water_logged', '2026-10-27T10:00:00Z', { glasses: 5 }, 'water')).title).toBe('Water: 5 glasses today');
  });
  it('shows flexible meal events', () => {
    expect(describe(ev('9', 'flexible_meal_created', '2026-10-27T10:00:00Z', { label: 'Pizza', reserved_kcal: 1000, planned_time: '20:00' })).detail).toBe('1000 kcal set aside for 20:00');
    expect(describe(ev('10', 'flexible_meal_consumed', '2026-10-27T10:00:00Z', { reserved_kcal: 1000, consumed_kcal: 1100 })).detail).toBe('1100 kcal of 1000 planned');
  });
  it('never crashes on unknown events or odd data', () => {
    expect(describe(ev('4', 'weird_thing', '2026-10-27T10:00:00Z')).title).toBe('weird thing');
    expect(describe(ev('5', 'food_logged', '2026-10-27T10:00:00Z', { cal: 'abc' })).detail).toBe('');
  });
});

suite('grouping', () => {
  it('groups by IST day, newest first, and keeps one water row per day', () => {
    const list = [
      ev('a', 'water_logged', '2026-10-27T12:00:00Z', { glasses: 6 }, 'water'),
      ev('b', 'water_logged', '2026-10-27T09:00:00Z', { glasses: 3 }, 'water'),
      ev('c', 'food_logged', '2026-10-27T04:00:00Z', { food_name: 'Roti', meal: 'lunch' }),
      ev('d', 'food_logged', '2026-10-26T04:00:00Z', { food_name: 'Rice', meal: 'lunch' }),
    ];
    expect(collapseWater(list)).toHaveLength(3);
    const g = groupByDay(list);
    expect(g).toHaveLength(2); expect(g[0].lines).toHaveLength(2); expect(g[0].lines[0].title).toBe('Water: 6 glasses today');
  });
  it('a late-night IST event belongs to the next IST day', () => {
    const g = groupByDay([ev('x', 'food_logged', '2026-10-26T19:00:00Z', { food_name: 'Milk' })]); // 00:30 IST on the 27th
    expect(g[0].day).toBe('2026-10-27');
  });
  it('labels today and yesterday', () => {
    const now = new Date('2026-10-27T10:00:00Z');
    expect(dayLabel('2026-10-27', now)).toBe('Today'); expect(dayLabel('2026-10-26', now)).toBe('Yesterday');
  });
});

suite('check-in lines', () => {
  const ev = (event_type: string, payload: Record<string, unknown>) => ({ id: '1', event_type, scope: 'mood', occurred_at: '2026-10-27T02:30:00Z', payload });
  it('describes a morning check-in', () => {
    const l = describe(ev('checkin_logged', { energy: 4, mood: 3, sleep: 'good', stress: null, hunger: null }));
    expect(l.title).toBe('Morning check-in'); expect(l.detail).toBe('energy 4/5, mood 3/5, sleep good');
  });
  it('describes an after-meal note', () => {
    const l = describe(ev('meal_feeling', { meal: 'lunch', energy_change: 'lower', fullness: 'full' }));
    expect(l.title).toBe('After lunch'); expect(l.detail).toBe('energy lower, full');
  });
});
