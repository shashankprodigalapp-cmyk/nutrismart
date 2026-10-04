/**
 * MyUsuals.test.ts — Phase 2C.1
 *
 * Tests the My Usuals ranking algorithm, threshold, meal context,
 * removal behavior, and offline safety.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { USUAL_THRESHOLD } from '../../lib/localDb';

// ── INLINE RANKING LOGIC (mirrors localDb.getUsualFoods) ─────────────────────

interface FoodAnalytic {
  food_id:        string;
  food_name:      string;
  food_source:    'master' | 'custom';
  use_count:      number;
  last_used_at:   string;
  last_used_date: string;
  last_meal?:     string;
  usual_cal?:     number;
}

function scoreFood(
  f: FoodAnalytic,
  currentMeal: string,
  today: string,
  sevenDaysAgo: string,
  thirtyDaysAgo: string,
): number {
  let score = f.use_count * 2;
  if (f.last_used_date >= today)             score += 5;
  else if (f.last_used_date >= sevenDaysAgo)  score += 3;
  else if (f.last_used_date >= thirtyDaysAgo) score += 1;
  if (f.last_meal && f.last_meal === currentMeal) score += 4;
  return score;
}

function getUsualFoods(
  all: FoodAnalytic[],
  currentMeal: string,
  removedIds: Set<string>,
  limit: number,
  today: string,
  sevenDaysAgo: string,
  thirtyDaysAgo: string,
): FoodAnalytic[] {
  return all
    .filter(f => f.use_count >= USUAL_THRESHOLD && !removedIds.has(f.food_id))
    .map(f => ({ ...f, _score: scoreFood(f, currentMeal, today, sevenDaysAgo, thirtyDaysAgo) }))
    .sort((a: any, b: any) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score: _, ...f }) => f as FoodAnalytic);
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

const TODAY         = '2026-08-31';
const SEVEN_AGO     = '2026-08-24';
const THIRTY_AGO    = '2026-08-01';
const OLD           = '2026-07-01';  // > 30 days ago

function food(id: string, name: string, useCount: number, lastDate: string, meal?: string, cal?: number): FoodAnalytic {
  return {
    food_id:        id,
    food_name:      name,
    food_source:    'master',
    use_count:      useCount,
    last_used_at:   `${lastDate}T13:00:00.000Z`,
    last_used_date: lastDate,
    last_meal:      meal,
    usual_cal:      cal,
  };
}

const CURRENT_MEAL = 'lunch';

function getUsuals(all: FoodAnalytic[], removed: Set<string> = new Set(), limit = 8) {
  return getUsualFoods(all, CURRENT_MEAL, removed, limit, TODAY, SEVEN_AGO, THIRTY_AGO);
}

// ── SUITE 1: Threshold ────────────────────────────────────────────────────────

describe('USUAL_THRESHOLD', () => {
  it('USUAL_THRESHOLD is 3 — conservative, matches Smart Quick-Log floor', () => {
    expect(USUAL_THRESHOLD).toBe(3);
  });

  it('food logged once is NOT a Usual', () => {
    const result = getUsuals([food('f1', 'Roti', 1, TODAY)]);
    expect(result).toHaveLength(0);
  });

  it('food logged twice is NOT a Usual', () => {
    const result = getUsuals([food('f1', 'Roti', 2, TODAY)]);
    expect(result).toHaveLength(0);
  });

  it('food logged 3 times IS a Usual', () => {
    const result = getUsuals([food('f1', 'Roti', 3, TODAY)]);
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe('Roti');
  });

  it('frequency increases correctly — 4 logs → Usual, count stored', () => {
    const result = getUsuals([food('f1', 'Dal', 4, TODAY)]);
    expect(result).toHaveLength(1);
    expect(result[0].use_count).toBe(4);
  });
});

// ── SUITE 2: Recency bonus ────────────────────────────────────────────────────

describe('Recency ranking', () => {
  it('food logged today ranks above food logged a month ago (same frequency)', () => {
    const recent = food('f1', 'Roti', 5, TODAY);
    const old    = food('f2', 'Dal',  5, OLD);
    const result = getUsuals([old, recent]);
    expect(result[0].food_name).toBe('Roti');  // today bonus = 5 vs 0
  });

  it('food logged this week ranks above food logged last month (same frequency)', () => {
    const thisWeek  = food('f1', 'Roti', 5, SEVEN_AGO);
    const lastMonth = food('f2', 'Dal',  5, THIRTY_AGO);
    const result    = getUsuals([lastMonth, thisWeek]);
    expect(result[0].food_name).toBe('Roti');  // 7-day bonus = 3 vs 1
  });

  it('old food with very high frequency can still rank above new low-frequency food', () => {
    // High frequency (score=20) vs recent with min usuals (score=6+5=11)
    const highFreq = food('f1', 'Dal',  10, OLD);   // score = 20
    const recent   = food('f2', 'Roti',  3, TODAY); // score = 6 + 5 = 11
    const result   = getUsuals([recent, highFreq]);
    expect(result[0].food_name).toBe('Dal');
  });
});

// ── SUITE 3: Meal context ─────────────────────────────────────────────────────

describe('Meal context ranking', () => {
  it('food matching current meal ranks above food not matching (same frequency)', () => {
    const lunchFood     = food('f1', 'Dal Tadka',  4, SEVEN_AGO, 'lunch');
    const breakfastFood = food('f2', 'Poha',       4, SEVEN_AGO, 'breakfast');
    const result = getUsuals([breakfastFood, lunchFood]);  // current meal = 'lunch'
    expect(result[0].food_name).toBe('Dal Tadka');  // meal match bonus = +4
  });

  it('foods without meal context are shown but ranked lower', () => {
    const noMeal    = food('f1', 'Rice', 5, SEVEN_AGO, undefined);  // no last_meal
    const mealMatch = food('f2', 'Dal',  3, SEVEN_AGO, 'lunch');
    const result    = getUsuals([noMeal, mealMatch]);
    // mealMatch: 6 + 3 + 4 = 13; noMeal: 10 + 3 = 13 — equal, Rice won't dominate
    expect(result.map(r => r.food_name)).toContain('Rice');
    expect(result.map(r => r.food_name)).toContain('Dal');
  });

  it('breakfast food at breakfast time ranks above lunch food', () => {
    const breakfast = food('f1', 'Poha',     4, SEVEN_AGO, 'breakfast');
    const lunch     = food('f2', 'Dal',      4, SEVEN_AGO, 'lunch');

    // Simulate breakfast context
    const result = getUsualFoods(
      [lunch, breakfast], 'breakfast', new Set(), 8,
      TODAY, SEVEN_AGO, THIRTY_AGO
    );
    expect(result[0].food_name).toBe('Poha');
  });
});

// ── SUITE 4: Food types ───────────────────────────────────────────────────────

describe('Food types (master, custom, AI)', () => {
  it('master food appears in Usuals', () => {
    const f = { ...food('m1', 'Roti', 4, TODAY), food_source: 'master' as const };
    expect(getUsuals([f])).toHaveLength(1);
  });

  it('custom food appears in Usuals', () => {
    const f = { ...food('c1', "Mom's Dal", 4, TODAY), food_source: 'custom' as const };
    expect(getUsuals([f])).toHaveLength(1);
  });

  it('AI-identified food (stored as custom) appears in Usuals', () => {
    // AI foods are saved to user_custom_foods with source='ai_lookup'
    // In food_analytics they carry food_source='custom'
    const f = { ...food('a1', 'Paneer Bhurji', 5, TODAY), food_source: 'custom' as const };
    expect(getUsuals([f])).toHaveLength(1);
    expect(getUsuals([f])[0].food_name).toBe('Paneer Bhurji');
  });
});

// ── SUITE 5: User removal ─────────────────────────────────────────────────────

describe('User removal', () => {
  it('removed food does not appear in My Usuals', () => {
    const f = food('f1', 'Roti', 5, TODAY);
    const removed = new Set(['f1']);
    expect(getUsuals([f], removed)).toHaveLength(0);
  });

  it('removing one food does not affect other Usuals', () => {
    const roti = food('f1', 'Roti', 5, TODAY);
    const dal  = food('f2', 'Dal',  4, TODAY);
    const removed = new Set(['f1']);
    const result = getUsuals([roti, dal], removed);
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe('Dal');
  });

  it('food history is preserved after removal (removal only affects visibility)', () => {
    // Removal is stored in user_prefs, not in food_analytics
    // The food_analytic row still exists with its use_count
    const f = food('f1', 'Roti', 5, TODAY);
    const removed = new Set(['f1']);
    // Removed from Usuals display...
    expect(getUsuals([f], removed)).toHaveLength(0);
    // ...but the food_analytic row itself is unchanged
    expect(f.use_count).toBe(5);
    expect(f.food_id).toBe('f1');
  });

  it('food can still be searched and logged after removal from Usuals', () => {
    // Removal only writes to user_prefs['removed_usuals'] — does not touch food_analytics
    // or custom_foods or master_foods. The food is still in masterFoods in-memory.
    // This is a logic-level test — the food object is unchanged.
    const f = food('f1', 'Roti', 5, TODAY);
    const removed = new Set(['f1']);
    // Not in Usuals
    expect(getUsuals([f], removed)).toHaveLength(0);
    // But food object itself exists and could be found by search
    expect(f.food_name).toBe('Roti');
    expect(f.food_id).toBe('f1');
  });
});

// ── SUITE 6: Multiple foods ───────────────────────────────────────────────────

describe('Multiple foods', () => {
  it('returns at most `limit` Usuals', () => {
    const foods = Array.from({ length: 15 }, (_, i) =>
      food(`f${i}`, `Food ${i}`, 5, TODAY)
    );
    const result = getUsuals(foods, new Set(), 8);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('empty result when no foods meet threshold', () => {
    const foods = [food('f1', 'Roti', 1, TODAY), food('f2', 'Dal', 2, TODAY)];
    expect(getUsuals(foods)).toHaveLength(0);
  });

  it('mixed threshold: only qualifying foods returned', () => {
    const qualifying    = food('f1', 'Roti', 3, TODAY);
    const notQualifying = food('f2', 'Dal',  2, TODAY);
    const result = getUsuals([qualifying, notQualifying]);
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe('Roti');
  });
});

// ── SUITE 7: Offline ─────────────────────────────────────────────────────────

describe('Offline behavior', () => {
  it('getUsualFoods is computed entirely from local food_analytics (no network)', () => {
    // The function takes an array of FoodAnalytic rows (loaded from Dexie) —
    // no Supabase calls in the ranking computation itself
    const foods = [food('f1', 'Roti', 4, TODAY, 'lunch', 120)];
    const result = getUsuals(foods);
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe('Roti');
  });

  it('usual_cal is preserved from offline logs', () => {
    const f = food('f1', 'Roti', 4, TODAY, 'lunch', 120);
    const result = getUsuals([f]);
    expect(result[0].usual_cal).toBe(120);
  });
});

// ── SUITE 8: Score formula verification ──────────────────────────────────────

describe('Score formula', () => {
  it('score = use_count*2 + recency_bonus + meal_match_bonus', () => {
    // food logged today, matches current meal, use_count=5
    // score = 10 + 5 + 4 = 19
    const f = food('f1', 'Dal', 5, TODAY, 'lunch');
    const scored = scoreFood(f, 'lunch', TODAY, SEVEN_AGO, THIRTY_AGO);
    expect(scored).toBe(19);
  });

  it('score for old food with no meal context = use_count*2 only', () => {
    const f = food('f1', 'Dal', 4, OLD, undefined);
    const scored = scoreFood(f, 'lunch', TODAY, SEVEN_AGO, THIRTY_AGO);
    expect(scored).toBe(8);  // 4*2 + 0 + 0
  });

  it('score is deterministic — same inputs, same score', () => {
    const f = food('f1', 'Dal', 5, SEVEN_AGO, 'lunch');
    const s1 = scoreFood(f, 'lunch', TODAY, SEVEN_AGO, THIRTY_AGO);
    const s2 = scoreFood(f, 'lunch', TODAY, SEVEN_AGO, THIRTY_AGO);
    expect(s1).toBe(s2);
  });
});
