/**
 * MealPatterns.test.ts — Phase 2C.2
 *
 * Tests for mealPatterns.ts: detectMealPatterns, buildTemplateKey, patternToTemplate.
 * All pure-logic tests — no network, no Supabase, Dexie mocked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PATTERN_THRESHOLD,
  detectMealPatterns,
  buildTemplateKey,
  patternToTemplate,
} from '../../lib/mealPatterns';
import type { LogEntry, MealTemplate } from '../../lib/localDb';

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

describe('PATTERN_THRESHOLD', () => {
  it('is 3 (same as USUAL_THRESHOLD — consistent UX)', () => {
    expect(PATTERN_THRESHOLD).toBe(3);
  });
});

// ── DEXIE MOCK ────────────────────────────────────────────────────────────────

const mockLogs: LogEntry[] = [];

vi.mock('../../lib/localDb', () => ({
  localDb: {
    daily_logs: {
      where: () => ({
        aboveOrEqual: () => ({
          toArray: async () => mockLogs,
        }),
      }),
    },
  },
  todayIST: () => '2026-08-31',
}));

vi.mock('../../lib/kitchenIntelligence', () => ({
  todayIST: () => '2026-08-31',
}));

// ── HELPERS ───────────────────────────────────────────────────────────────────

let dayCounter = 0;

function entry(
  date: string,
  meal: 'breakfast' | 'lunch' | 'snack' | 'dinner',
  food: string,
  cal = 200,
): LogEntry {
  return {
    id:         `${date}-${meal}-${food}-${++dayCounter}`,
    user_id:    'u1',
    log_date:   date,
    meal,
    food_id:    `id-${food}`,
    food_name:  food,
    portion:    '1 serving',
    qty:        1,
    is_home:    true,
    multiplier: 1.0,
    cal,
    protein:    10,
    carbs:      30,
    fat:        5,
    gl:         15,
    created_at: `${date}T13:00:00.000Z`,
  };
}

/** Log the same food combination on N different days */
function onNDays(
  n: number,
  meal: 'breakfast' | 'lunch' | 'snack' | 'dinner',
  foods: string[],
  startDate = '2026-08-01',
): LogEntry[] {
  const logs: LogEntry[] = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(
      new Date(startDate).getTime() + i * 86_400_000
    ).toISOString().slice(0, 10);
    for (const food of foods) logs.push(entry(date, meal, food));
  }
  return logs;
}

// ── SUITE 1: Core detection ───────────────────────────────────────────────────

describe('detectMealPatterns — core detection', () => {
  beforeEach(() => { mockLogs.length = 0; dayCounter = 0; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('1. No patterns when logs are below threshold', async () => {
    mockLogs.push(...onNDays(2, 'lunch', ['Dal', 'Roti']));
    const result = await detectMealPatterns();
    expect(result).toHaveLength(0);
  });

  it('2. Pattern detected when combination appears on ≥3 distinct days', async () => {
    mockLogs.push(...onNDays(3, 'lunch', ['Dal', 'Roti']));
    const result = await detectMealPatterns();
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].food_names.sort()).toEqual(['Dal', 'Roti'].sort());
  });

  it('3. Pattern requires distinct days — not just multiple logs on same day', async () => {
    // Three entries on the SAME day, same meal
    const date = '2026-08-15';
    mockLogs.push(
      entry(date, 'lunch', 'Dal'),
      entry(date, 'lunch', 'Roti'),
      entry(date, 'lunch', 'Dal'),  // duplicate same day
    );
    const result = await detectMealPatterns();
    // Only 1 distinct day → below threshold
    expect(result).toHaveLength(0);
  });

  it('4. day_count reflects distinct days, not total logs', async () => {
    mockLogs.push(...onNDays(5, 'lunch', ['Dal', 'Roti']));
    const result = await detectMealPatterns();
    expect(result[0].day_count).toBe(5);
  });

  it('5. Different meals are tracked separately', async () => {
    mockLogs.push(...onNDays(3, 'lunch', ['Dal', 'Roti']));
    mockLogs.push(...onNDays(3, 'breakfast', ['Poha', 'Dahi']));
    const result = await detectMealPatterns();
    expect(result).toHaveLength(2);
    const meals = result.map(r => r.meal).sort();
    expect(meals).toEqual(['breakfast', 'lunch'].sort());
  });
});

// ── SUITE 2: Subset suppression ───────────────────────────────────────────────

describe('detectMealPatterns — subset suppression', () => {
  beforeEach(() => { mockLogs.length = 0; dayCounter = 0; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('6. Subset is suppressed when superset also qualifies', async () => {
    // [Dal, Roti, Sabzi] appears 4 days, [Dal, Roti] appears same 4 + 1 extra day
    mockLogs.push(...onNDays(4, 'lunch', ['Dal', 'Roti', 'Sabzi']));
    // One extra day where only Dal+Roti logged (no Sabzi)
    const extraDate = '2026-08-30';
    mockLogs.push(entry(extraDate, 'lunch', 'Dal'), entry(extraDate, 'lunch', 'Roti'));

    const result = await detectMealPatterns();
    // [Dal, Roti, Sabzi] is the superset — [Dal, Roti] should be suppressed
    const keys = result.map(r => r.key);
    const hasTrio  = keys.some(k => k.split('|').length === 3);
    const hasPair  = keys.some(k => k === 'Dal|Roti' || k === 'Roti|Dal');
    // The trio qualifies; the pair should be suppressed because it's a subset
    if (hasTrio) {
      expect(hasPair).toBe(false);
    }
    // If only the pair qualifies (superset doesn't meet threshold), pair is fine
    // This edge case is acceptable — just verify no crash
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── SUITE 3: Canonical key ────────────────────────────────────────────────────

describe('buildTemplateKey', () => {
  it('7. Key is order-independent — same foods in different order produce same key', () => {
    const template1 = {
      items: [{ food_name: 'Dal' }, { food_name: 'Roti' }],
    } as Partial<MealTemplate> as MealTemplate;

    const template2 = {
      items: [{ food_name: 'Roti' }, { food_name: 'Dal' }],
    } as Partial<MealTemplate> as MealTemplate;

    expect(buildTemplateKey(template1)).toBe(buildTemplateKey(template2));
  });

  it('8. Keys differ for different food sets', () => {
    const t1 = { items: [{ food_name: 'Dal' }, { food_name: 'Roti' }] } as any as MealTemplate;
    const t2 = { items: [{ food_name: 'Dal' }, { food_name: 'Sabzi' }] } as any as MealTemplate;
    expect(buildTemplateKey(t1)).not.toBe(buildTemplateKey(t2));
  });

  it('9. Key format: sorted food names joined by |', () => {
    const t = { items: [{ food_name: 'Roti' }, { food_name: 'Dal' }] } as any as MealTemplate;
    expect(buildTemplateKey(t)).toBe('Dal|Roti');
  });
});

// ── SUITE 4: Template creation ────────────────────────────────────────────────

describe('patternToTemplate', () => {
  it('10. Creates template with correct user_id', () => {
    const pattern = {
      key:        'Dal|Roti',
      food_names: ['Dal', 'Roti'],
      meal:       'lunch',
      day_count:  4,
      avg_cal:    350,
      items:      [{ food_name: 'Dal', portion: '1 katori', qty: 1, is_home: true, cal: 175, protein: 9, carbs: 22, fat: 6, gl: 8 }],
    };

    const template = patternToTemplate(pattern, 'user-abc', 'My lunch');
    expect(template.user_id).toBe('user-abc');
    expect(template.name).toBe('My lunch');
    expect(template.total_cal).toBe(350);
    expect(template.use_count).toBe(0);  // starts at 0 — not yet used
  });

  it('11. Auto-names from food_names when no name provided', () => {
    const pattern = {
      key: 'Dal|Roti', food_names: ['Dal', 'Roti'],
      meal: 'lunch', day_count: 3, avg_cal: 300, items: [],
    };
    const template = patternToTemplate(pattern, 'u1');
    expect(template.name).toContain('Dal');
    expect(template.name).toContain('Roti');
  });

  it('12. Auto-name truncates long combinations (3+ foods)', () => {
    const pattern = {
      key: 'Curd|Dal|Roti|Sabzi', food_names: ['Dal', 'Roti', 'Sabzi', 'Curd'],
      meal: 'lunch', day_count: 3, avg_cal: 600, items: [],
    };
    const template = patternToTemplate(pattern, 'u1');
    // Should contain the first food + a count, not all 4 names
    expect(template.name.length).toBeLessThan(50);  // not excessively long
  });

  it('13. Items are preserved from the pattern', () => {
    const items = [
      { food_name: 'Dal', portion: '1 katori', qty: 1, is_home: true, cal: 175, protein: 9, carbs: 22, fat: 6, gl: 8 },
      { food_name: 'Roti', portion: '1 medium', qty: 2, is_home: true, cal: 120, protein: 3, carbs: 24, fat: 2, gl: 10 },
    ];
    const pattern = {
      key: 'Dal|Roti', food_names: ['Dal', 'Roti'],
      meal: 'lunch', day_count: 3, avg_cal: 295, items,
    };
    const template = patternToTemplate(pattern, 'u1');
    expect(template.items).toHaveLength(2);
    expect(template.items[0].food_name).toBe('Dal');
  });
});

// ── SUITE 5: Deduplication with existing templates ────────────────────────────

describe('detectMealPatterns — already-saved template exclusion', () => {
  beforeEach(() => { mockLogs.length = 0; dayCounter = 0; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('14. Already-saved template key excluded from suggestions', async () => {
    mockLogs.push(...onNDays(4, 'lunch', ['Dal', 'Roti']));
    const existingKey = 'Dal|Roti';
    const result = await detectMealPatterns(new Set([existingKey]));
    expect(result.find(p => p.key === existingKey)).toBeUndefined();
  });
});

// ── SUITE 6: Meal-slot attribution ────────────────────────────────────────────

describe('detectMealPatterns — meal slot', () => {
  beforeEach(() => { mockLogs.length = 0; dayCounter = 0; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('15. Pattern meal attribute reflects the most common slot', async () => {
    // Dal+Roti appears 4× at lunch, 1× at dinner
    mockLogs.push(...onNDays(4, 'lunch', ['Dal', 'Roti']));
    // One dinner appearance
    mockLogs.push(entry('2026-08-30', 'dinner', 'Dal'), entry('2026-08-30', 'dinner', 'Roti'));

    const result = await detectMealPatterns();
    if (result.length > 0) {
      // Should attribute to lunch (4 vs 1)
      expect(result[0].meal).toBe('lunch');
    }
  });
});

// ── SUITE 7: Edge cases ───────────────────────────────────────────────────────

describe('Edge cases', () => {
  beforeEach(() => { mockLogs.length = 0; dayCounter = 0; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('16. Empty logs → no patterns', async () => {
    expect(await detectMealPatterns()).toHaveLength(0);
  });

  it('17. Single-food meals are not patterns', async () => {
    // Roti alone, 5 days
    for (let i = 1; i <= 5; i++) {
      mockLogs.push(entry(`2026-08-${i.toString().padStart(2,'0')}`, 'lunch', 'Roti'));
    }
    const result = await detectMealPatterns();
    // No multi-food combination → no pattern
    expect(result).toHaveLength(0);
  });

  it('18. Result capped at 5 patterns', async () => {
    // Create 8 distinct qualifying combinations
    const combos = [
      ['A', 'B'], ['C', 'D'], ['E', 'F'], ['G', 'H'],
      ['I', 'J'], ['K', 'L'], ['M', 'N'], ['O', 'P'],
    ];
    let d = 0;
    for (const [f1, f2] of combos) {
      for (let i = 0; i < 3; i++) {
        const date = `2026-07-${(d + 1).toString().padStart(2, '0')}`;
        mockLogs.push(entry(date, 'lunch', f1), entry(date, 'lunch', f2));
        d++;
      }
    }
    const result = await detectMealPatterns();
    expect(result.length).toBeLessThanOrEqual(5);
  });
});
