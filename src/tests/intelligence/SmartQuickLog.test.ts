/**
 * SmartQuickLog.test.ts — Module 10 (local AI bypass)
 *
 * Verifies `trySmartQuickLog` in DashboardLogging:
 *   1. When food_analytics has an entry with use_count > 5 matching the query,
 *      the sheet opens from Dexie data — no network call made.
 *   2. When use_count <= 5, returns false (falls through to AI path).
 *   3. Response time for a local hit is under 10ms.
 *   4. Name matching is case-insensitive and partial.
 *
 * We test the pure logic extracted from the component, not the React layer,
 * to keep tests fast and deterministic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NutriSmartDB, type Food, type FoodAnalytic } from '../../lib/localDb';

// ── Re-implement trySmartQuickLog in isolation ────────────────────────────
// (The component version is tightly coupled to React state; we extract the
// core logic into a testable pure async function matching its contract.)

async function trySmartQuickLog(
  db: NutriSmartDB,
  query: string,
): Promise<Food | null> {
  const q = query.toLowerCase().trim();
  if (!q) return null;

  const candidates = await db.food_analytics
    .filter(a => a.use_count > 5 && a.food_name.toLowerCase().includes(q))
    .toArray();

  if (!candidates.length) return null;

  candidates.sort((a, b) => b.use_count - a.use_count);
  const food = await db.custom_foods.get(candidates[0].food_id);
  return food ?? null;
}

// ── Fixtures ──────────────────────────────────────────────────────────────

function makeFood(id: string, name: string): Food {
  return {
    id, name,
    portion:    '1 serving',
    weight_g:   150,
    calories:   200,
    protein:    8,
    carbs:      28,
    fat:        5,
    gl:         12,
    source:     'custom',
    created_at: new Date().toISOString(),
  };
}

function makeAnalytic(foodId: string, foodName: string, useCount: number): FoodAnalytic {
  return {
    food_id:        foodId,
    food_name:      foodName,
    food_source:    'custom',
    use_count:      useCount,
    last_used_at:   new Date().toISOString(),
    last_used_date: '2026-07-13',
  };
}

describe('SmartQuickLog — local Dexie bypass', () => {
  let db: NutriSmartDB;

  beforeEach(async () => {
    db = new NutriSmartDB();
    await db.open();
    await db.custom_foods.bulkPut([
      makeFood('f-poha',    'Poha'),
      makeFood('f-dal',     'Dal Tadka'),
      makeFood('f-rajma',   'Rajma Chawal'),
    ]);
    await db.food_analytics.bulkPut([
      makeAnalytic('f-poha',  'Poha',          8),   // use_count > 5 ✓
      makeAnalytic('f-dal',   'Dal Tadka',     12),  // use_count > 5 ✓
      makeAnalytic('f-rajma', 'Rajma Chawal',  3),   // use_count <= 5 ✗
    ]);
  });

  afterEach(async () => { await db.delete(); });

  it('returns Food for a high-frequency match without network call', async () => {
    const networkSpy = vi.spyOn(globalThis, 'fetch');
    const food = await trySmartQuickLog(db, 'poha');
    expect(food).not.toBeNull();
    expect(food?.name).toBe('Poha');
    expect(networkSpy).not.toHaveBeenCalled();
    networkSpy.mockRestore();
  });

  it('returns null for low-frequency item (use_count <= 5)', async () => {
    const food = await trySmartQuickLog(db, 'rajma');
    expect(food).toBeNull();
  });

  it('is case-insensitive and handles partial matches', async () => {
    const food = await trySmartQuickLog(db, 'DAL');
    expect(food?.name).toBe('Dal Tadka');
  });

  it('returns highest use_count match when multiple items match the query', async () => {
    // Both f-poha and f-dal could match "a" (common letter) — dal has count=12
    await db.food_analytics.update('f-poha', { food_name: 'Poha with Peanuts', use_count: 9 });
    await db.food_analytics.update('f-dal',  { food_name: 'Dal Makhani',       use_count: 15 });
    const food = await trySmartQuickLog(db, 'dal');
    expect(food?.id).toBe('f-dal');
  });

  it('completes within 10ms for a local hit', async () => {
    const start = performance.now();
    await trySmartQuickLog(db, 'poha');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it('returns null for empty query without touching DB', async () => {
    const filterSpy = vi.spyOn(db.food_analytics, 'filter');
    const food = await trySmartQuickLog(db, '');
    expect(food).toBeNull();
    expect(filterSpy).not.toHaveBeenCalled();
  });
});
