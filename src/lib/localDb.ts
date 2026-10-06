/**
 * localDb.ts — NutriSmart IndexedDB Schema via Dexie.js 4
 * Module 2, Step 2.1
 *
 * VERSION HISTORY:
 *   v1 — Core schema (logs, water, energy, templates, custom_foods, sync, streak, prefs)
 *   v2 — food_analytics store (recents + frequency cache — client-only, never synced)
 *
 * All field names match Supabase column names exactly for direct spread assignment.
 */

import Dexie, { type Table } from 'dexie';

// ── FOOD ──────────────────────────────────────────────────────────────────────

export interface Food {
  id: string;
  name: string;
  name_hi?: string;
  name_gu?: string;
  portion: string;
  weight_g?: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  gl: number;
  gi?: number;
  type: 'R' | 'MR' | 'OR' | 'NR';
  source?: string;
  verified?: boolean;
}

// ── LOG ENTRY ─────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: string;
  user_id: string;
  log_date: string;
  meal: 'breakfast' | 'lunch' | 'snack' | 'dinner';
  food_id?: string;
  food_name: string;
  portion: string;
  qty: number;
  is_home: boolean;
  multiplier: number;
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
  gl: number;
  anomaly?: boolean;
  synced_at?: string;
  created_at: string;
}

// ── WATER LOG ─────────────────────────────────────────────────────────────────

export interface WaterLog {
  user_id: string;
  log_date: string;
  glasses: number;
}

// ── ENERGY LOG ────────────────────────────────────────────────────────────────

export interface EnergyLog {
  id: string;
  user_id: string;
  log_date: string;
  log_time: string;
  level: 'low' | 'steady' | 'high';
  meal_before?: string;
  total_gl?: number;
  total_cal?: number;
  skipped?: boolean;   // TRUE when user tapped Skip — written to server so cron doesn't re-notify
  synced_at?: string;
  created_at: string;
}

// ── MEAL TEMPLATE ─────────────────────────────────────────────────────────────

export interface MealTemplate {
  id: string;
  user_id: string;
  name: string;
  total_cal?: number;
  items: Array<Pick<LogEntry, 'food_name' | 'portion' | 'qty' | 'is_home' | 'cal' | 'protein' | 'carbs' | 'fat' | 'gl'>>;
  use_count: number;
  created_at: string;
}

// ── STREAK ────────────────────────────────────────────────────────────────────

export interface StreakData {
  user_id: string;
  current_streak: number;
  longest_streak: number;
  shields: number;
  shields_used: number;
  last_log_date?: string;
  updated_at: string;
}

// ── KITCHEN PROFILE ───────────────────────────────────────────────────────────

export interface KitchenAnswers {
  oil: 'very_light' | 'moderate' | 'regular' | 'heavy';
  cook: 'me' | 'maid' | 'mix';
  style: 'health' | 'traditional' | 'mixed';
}

export interface KitchenProfile {
  home_mult: number;
  rest_mult: number;
  initial_home_mult: number;
  answers: KitchenAnswers;
  calibration_count: number;
  calibrated_at?: string;
  manual_override?: boolean;
}

// ── USER PREFS ────────────────────────────────────────────────────────────────

export interface UserPref {
  key: string;
  value: unknown;
}

// ── SYNC QUEUE ────────────────────────────────────────────────────────────────

export type SyncAction =
  | 'insert_log'
  | 'delete_log'  | 'update_log'
  | 'update_water'
  | 'update_kitchen_profile'
  | 'insert_energy'
  | 'insert_event'
  | 'upsert_template'
  | 'delete_template' | 'promote_popular_food';

export interface SyncQueueItem {
  id?: number;
  user_id: string;
  action: SyncAction;
  payload: unknown;
  device_id: string;
  created_at: string;
  synced:      0 | 1;          // 0=pending 1=done — indexed (audit fix R1)
  synced_at?: string;
  failed?: boolean;
  retry_count: number;
}

// ── FOOD ANALYTICS (client-only, never synced to Supabase) ───────────────────

export interface FoodAnalytic {
  food_id:        string;
  food_name:      string;
  food_source:    'master' | 'custom';
  use_count:      number;
  last_used_at:   string;
  last_used_date: string;
  /** Most recently used meal context ('breakfast'|'lunch'|'snack'|'dinner') — for contextual ranking */
  last_meal?:     string;
  /** Calorie value from the most recent log entry — shown in My Usuals card */
  usual_cal?:     number;
}

// ── DEXIE DATABASE ────────────────────────────────────────────────────────────

export class NutriSmartDB extends Dexie {
  daily_logs!:     Table<LogEntry,      string>;
  water_logs!:     Table<WaterLog,      [string, string]>;
  energy_logs!:    Table<EnergyLog,     string>;
  meal_templates!: Table<MealTemplate,  string>;
  custom_foods!:   Table<Food,          string>;
  sync_queue!:     Table<SyncQueueItem, number>;
  streak!:         Table<StreakData,    string>;
  user_prefs!:     Table<UserPref,      string>;
  food_analytics!: Table<FoodAnalytic,  string>;

  constructor() {
    super('nutrismart-v1');

    // Version 1: core tables
    this.version(1).stores({
      daily_logs:     'id, log_date, meal, food_name, user_id, created_at',
      water_logs:     '[user_id+log_date], user_id, log_date',
      energy_logs:    'id, log_date, user_id',
      meal_templates: 'id, user_id, name',
      custom_foods:   'id, user_id, name',
      sync_queue:     '++id, action, synced_at, user_id',
      streak:         'user_id',
      user_prefs:     'key',
    });

    // Version 2: food_analytics for Recents & Frequents panel
    this.version(2).stores({
      daily_logs:     'id, log_date, meal, food_name, user_id, created_at',
      water_logs:     '[user_id+log_date], user_id, log_date',
      energy_logs:    'id, log_date, user_id',
      meal_templates: 'id, user_id, name',
      custom_foods:   'id, user_id, name',
      sync_queue:     '++id, action, synced_at, user_id',
      streak:         'user_id',
      user_prefs:     'key',
      food_analytics: 'food_id, use_count, last_used_at, last_used_date',
    });

    // v3 — AUDIT FIX R1: Dexie does not index undefined values, so the old
    // synced_at index silently missed every pending item (the .filter()
    // fallback was doing all the work — a full scan wearing an index costume).
    // Replace with an explicit integer flag: 0 = pending, 1 = synced.
    this.version(3).stores({
      daily_logs:     'id, log_date, meal, food_name, user_id, created_at',
      water_logs:     '[user_id+log_date], user_id, log_date',
      energy_logs:    'id, log_date, user_id',
      meal_templates: 'id, user_id, name',
      custom_foods:   'id, user_id, name',
      sync_queue:     '++id, action, synced, user_id',   // ← indexed 0/1 flag
      streak:         'user_id',
      user_prefs:     'key',
      food_analytics: 'food_id, use_count, last_used_at, last_used_date',
    }).upgrade(async (tx) => {
      // Migrate existing rows: derive flag from legacy synced_at field
      await tx.table('sync_queue').toCollection().modify((item: any) => {
        item.synced = item.synced_at ? 1 : 0;
      });
    });

    // v4 — Phase 2C.1: My Usuals
    // Adds last_meal and usual_cal to food_analytics rows.
    // No schema change to the store definition — Dexie stores unindexed fields
    // automatically. The upgrade pass is a no-op (new fields start undefined
    // on existing rows; getUsualFoods treats undefined last_meal as no meal context).
    this.version(4).stores({
      daily_logs:     'id, log_date, meal, food_name, user_id, created_at',
      water_logs:     '[user_id+log_date], user_id, log_date',
      energy_logs:    'id, log_date, user_id',
      meal_templates: 'id, user_id, name',
      custom_foods:   'id, user_id, name',
      sync_queue:     '++id, action, synced, user_id',
      streak:         'user_id',
      user_prefs:     'key',
      food_analytics: 'food_id, use_count, last_used_at, last_used_date',
      // last_meal and usual_cal are stored but not indexed — full-table scan
      // is fine for food_analytics (typically <200 rows per user)
    });
  }
}

export const localDb = new NutriSmartDB();

// ── ANALYTICS HELPERS ─────────────────────────────────────────────────────────

export async function recordFoodUsage(food: Food, meal?: string, cal?: number): Promise<void> {
  try {
    const existing = await localDb.food_analytics.get(food.id);
    const now   = new Date().toISOString();
    const today = now.slice(0, 10);
    if (existing) {
      const newCount = existing.use_count + 1;
      await localDb.food_analytics.update(food.id, {
        use_count:      newCount,
        last_used_at:   now,
        last_used_date: today,
        ...(meal !== undefined && { last_meal: meal }),
        ...(cal  !== undefined && { usual_cal: cal  }),
      });
      // TASK 3.2: a user's AI-found custom food just became "popular" (10 uses).
      // Enqueue promotion so the server can embed it into food_semantic_cache —
      // every other user's search for this food becomes a free cache hit.
      if (newCount === 10 && (food as any).source === 'custom') {
        const { getSyncManager } = await import('./SyncManager');
        try {
          await getSyncManager().enqueue('promote_popular_food', {
            food_id: food.id, food_name: food.name,
            calories: food.calories, protein: food.protein,
            carbs: food.carbs, fat: food.fat, gl: food.gl,
            portion: food.portion, weight_g: food.weight_g,
          });
        } catch { /* SyncManager not init — skip, will retry at next threshold */ }
      }
    } else {
      await localDb.food_analytics.add({
        food_id:        food.id,
        food_name:      food.name,
        food_source:    'master',
        use_count:      1,
        last_used_at:   now,
        last_used_date: today,
        ...(meal !== undefined && { last_meal: meal }),
        ...(cal  !== undefined && { usual_cal: cal  }),
      });
    }
  } catch { /* non-fatal */ }
}

// ── MY USUALS ─────────────────────────────────────────────────────────────────

/** Minimum use count for a food to be considered a "Usual" */
export const USUAL_THRESHOLD = 3;

/**
 * getUsualFoods — returns foods the user repeatedly logs, ranked by context.
 *
 * RANKING ALGORITHM (deterministic, no ML):
 *   score = (use_count × 2) + recency_bonus + meal_match_bonus
 *
 *   recency_bonus:
 *     logged today            → +5
 *     logged in last 7 days   → +3
 *     logged in last 30 days  → +1
 *     older                   → +0
 *
 *   meal_match_bonus (time-of-day context):
 *     current meal matches last_meal → +4
 *     no meal stored yet             → +0
 *
 * Only foods with use_count ≥ USUAL_THRESHOLD are returned (they are "Usuals").
 * Removed food_ids (stored in user_prefs['removed_usuals']) are excluded.
 *
 * @param currentMeal  - current meal context ('breakfast'|'lunch'|'snack'|'dinner')
 * @param removedIds   - Set of food_ids the user has removed from Usuals
 * @param limit        - max items to return
 */
export async function getUsualFoods(
  currentMeal: string,
  removedIds:  Set<string> = new Set(),
  limit = 8,
): Promise<FoodAnalytic[]> {
  const all = await localDb.food_analytics.toArray();
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo  = new Date(Date.now() - 7  * 86_400_000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return all
    .filter(f => f.use_count >= USUAL_THRESHOLD && !removedIds.has(f.food_id))
    .map(f => {
      // Recency bonus
      let score = f.use_count * 2;
      if (f.last_used_date >= today)          score += 5;
      else if (f.last_used_date >= sevenDaysAgo) score += 3;
      else if (f.last_used_date >= thirtyDaysAgo) score += 1;

      // Meal-match bonus
      if (f.last_meal && f.last_meal === currentMeal) score += 4;

      return { ...f, _score: score };
    })
    .sort((a: any, b: any) => b._score - a._score)
    .slice(0, limit)
    .map(({ _score: _, ...f }) => f as FoodAnalytic);
}

export async function getFrequentFoods(limit = 12): Promise<FoodAnalytic[]> {
  const all = await localDb.food_analytics.toArray();
  return all
    .sort((a, b) => b.use_count !== a.use_count
      ? b.use_count - a.use_count
      : b.last_used_at.localeCompare(a.last_used_at))
    .slice(0, limit);
}

export async function getTodayFoods(todayIST: string): Promise<FoodAnalytic[]> {
  const rows = await localDb.food_analytics
    .where('last_used_date').equals(todayIST).toArray();
  return rows.sort((a, b) => b.last_used_at.localeCompare(a.last_used_at));
}
