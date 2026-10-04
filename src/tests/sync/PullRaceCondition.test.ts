/**
 * PullRaceCondition.test.ts — Module 2 / 12 (CORRECTED)
 *
 * Fix applied: the previous mock used vi.fn().mockReturnThis() for .eq(),
 * which returns the mock fn object itself — not the outer builder with 'then'.
 * Supabase-js chains must be built as a thenable builder where every method
 * returns the SAME builder object (not `this` of the mock fn).
 *
 * Correct pattern: build a plain object where each method returns the object
 * itself, and the object has a 'then' so it is awaitable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NutriSmartDB, type LogEntry, type WaterLog } from '../../lib/localDb';

const TODAY = '2026-07-13';
const USER  = 'user-pull-test';

let mockServerLogs:  LogEntry[] = [];
let mockServerWater: WaterLog | null = null;

// Build a proper thenable query builder: every method returns the same object,
// and the object is awaitable via 'then'. This matches supabase-js's real chain.
function makeQueryBuilder(resolveData: () => unknown) {
  const builder: any = {
    select:      () => builder,
    eq:          () => builder,
    maybeSingle: async () => ({ data: resolveData(), error: null }),
    // Makes the builder itself awaitable
    then: (onFulfilled: any, onRejected: any) =>
      Promise.resolve({ data: resolveData(), error: null }).then(onFulfilled, onRejected),
    catch: (onRejected: any) =>
      Promise.resolve({ data: resolveData(), error: null }).catch(onRejected),
  };
  return builder;
}

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'water_logs') {
        return makeQueryBuilder(() => mockServerWater);
      }
      // daily_logs and energy_logs
      return makeQueryBuilder(() => mockServerLogs);
    },
    auth: { getUser: vi.fn() },
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
  },
}));

import { SyncManager } from '../../lib/SyncManager';

function makeEntry(id: string, cal: number): LogEntry {
  return {
    id, user_id: USER, log_date: TODAY, meal: 'lunch',
    food_id: 'f1', food_name: 'Rice', portion: '1 serving', qty: 1,
    is_home: true, multiplier: 1.0, cal, protein: 4, carbs: 40, fat: 1,
    gl: 18, created_at: new Date().toISOString(),
  };
}

describe('PullRaceCondition — queue-aware pull protection', () => {
  let db: NutriSmartDB;

  beforeEach(async () => {
    db = new NutriSmartDB();
    await db.open();
    mockServerLogs  = [];
    mockServerWater = null;
  });

  afterEach(async () => {
    await db.delete();
    vi.restoreAllMocks();
  });

  it('synced=0 queue entry blocks the stale server row for that ID', async () => {
    const localEntry  = makeEntry('log-pending', 350);
    const serverEntry = makeEntry('log-pending', 100);  // stale 100 kcal

    await db.daily_logs.put(localEntry);
    await db.sync_queue.add({
      user_id: USER, action: 'insert_log',
      payload: { id: 'log-pending' }, device_id: 'd1',
      created_at: '', retry_count: 0, synced: 0,
    });

    mockServerLogs = [serverEntry];   // server would write 100 kcal

    const sm = new SyncManager({ userId: USER, deviceId: 'd1', getIsRefreshing: () => false });
    await (sm as any).pullToday();

    const stored = await db.daily_logs.get('log-pending');
    expect(stored?.cal).toBe(350);   // local value preserved ✓
  });

  it('server row NOT in the queue is written to Dexie normally', async () => {
    const serverEntry = makeEntry('log-server-only', 500);
    mockServerLogs = [serverEntry];

    const sm = new SyncManager({ userId: USER, deviceId: 'd1', getIsRefreshing: () => false });
    await (sm as any).pullToday();

    const stored = await db.daily_logs.get('log-server-only');
    expect(stored?.cal).toBe(500);   // server value written ✓
  });

  it('pending water update blocks server water write for that date', async () => {
    await db.water_logs.put({ user_id: USER, log_date: TODAY, glasses: 7 });
    await db.sync_queue.add({
      user_id: USER, action: 'update_water',
      payload: { log_date: TODAY, glasses: 7 }, device_id: 'd1',
      created_at: '', retry_count: 0, synced: 0,
    });

    mockServerWater = { user_id: USER, log_date: TODAY, glasses: 2 }; // stale

    const sm = new SyncManager({ userId: USER, deviceId: 'd1', getIsRefreshing: () => false });
    await (sm as any).pullToday();

    const w = await db.water_logs.get([USER, TODAY]);
    expect(w?.glasses).toBe(7);   // local preserved ✓
  });
});
