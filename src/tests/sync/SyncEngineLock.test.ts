/**
 * SyncEngineLock.test.ts — Module 2 / 12 (FIXED)
 *
 * Key fix from test run analysis:
 *   SyncManager uses module-level `import { supabase } from './supabase'`
 *   (line 26 of SyncManager.ts), not constructor injection.
 *   Tests must use vi.mock() to intercept the module, not pass supabase
 *   via constructor (SyncManagerOptions has no `supabase` field).
 *
 *   `flushInternal` is TypeScript `private` (compile-time) but a plain
 *   property at runtime — vi.spyOn(sm as any, 'flushInternal') is valid.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Must mock BEFORE any import that transitively imports supabase.ts
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select:      vi.fn().mockReturnThis(),
      eq:          vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert:      vi.fn().mockResolvedValue({ error: null }),
      insert:      vi.fn().mockResolvedValue({ error: null }),
      delete:      vi.fn().mockResolvedValue({ error: null }),
    })),
    channel:       vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { NutriSmartDB } from '../../lib/localDb';
import { SyncManager }  from '../../lib/SyncManager';

function makeSyncManager(): SyncManager {
  return new SyncManager({
    userId:          'user-lock-test',
    deviceId:        'device-1',
    getIsRefreshing: () => false,
  });
}

describe('SyncEngineLock — Web Locks cross-tab exclusivity', () => {
  let sm: SyncManager;
  let flushInternalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sm = makeSyncManager();
    flushInternalSpy = vi.spyOn(sm as any, 'flushInternal').mockResolvedValue(undefined);
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('grants lock to first flush() and denies concurrent call', async () => {
    let innerResolve!: () => void;
    const innerBarrier = new Promise<void>(r => { innerResolve = r; });
    flushInternalSpy.mockImplementationOnce(async () => { await innerBarrier; });

    const firstFlush  = sm.flush();
    const secondFlush = sm.flush();
    innerResolve();
    await Promise.all([firstFlush, secondFlush]);

    expect(flushInternalSpy).toHaveBeenCalledTimes(1);
  });

  it('allows second flush() after lock is released', async () => {
    await sm.flush();
    await sm.flush();
    expect(flushInternalSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to isFlushing when navigator.locks absent', async () => {
    const savedLocks = (navigator as any).locks;
    // Set to undefined — delete leaves prototype property visible to 'in' check
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined, writable: true });
    flushInternalSpy.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 10));
    });
    await Promise.all([sm.flush(), sm.flush()]);
    expect(flushInternalSpy).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: savedLocks, writable: true });
  });

  it('getPendingCount counts only synced=0 items', async () => {
    const db = new NutriSmartDB();
    await db.open();
    await db.sync_queue.bulkAdd([
      { user_id:'user-lock-test', action:'insert_log', payload:{id:'x'}, device_id:'d1', created_at:'', retry_count:0, synced:0 },
      { user_id:'user-lock-test', action:'insert_log', payload:{id:'y'}, device_id:'d1', created_at:'', retry_count:0, synced:1, synced_at:'2026-01-01' },
    ]);
    const count = await sm.getPendingCount();
    expect(count).toBe(1);
    await db.delete();
  });
});
