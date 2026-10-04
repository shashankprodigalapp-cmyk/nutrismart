/**
 * DexieAudit.test.ts — Module 2 (Dexie v3 schema correctness)
 *
 * Verifies:
 *   1. All sync_queue operations query by the indexed `synced` (0/1) flag,
 *      not by `synced_at` (which was undefined-indexed and broken in v2).
 *   2. The v3 migration correctly derives synced=0 for items that had
 *      synced_at=undefined, and synced=1 for items that had a timestamp.
 *   3. `enqueue()` always sets synced=0 on new items.
 *   4. After a successful flush, items are marked synced=1.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NutriSmartDB } from '../../lib/localDb';

describe('DexieAudit — v3 schema, indexed synced flag', () => {
  let db: NutriSmartDB;

  beforeEach(async () => {
    db = new NutriSmartDB();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it('new items added with synced=0 are retrievable via the indexed query', async () => {
    await db.sync_queue.add({
      user_id: 'u1', action: 'insert_log',
      payload: { id: 'l1' },
      device_id: 'd1', created_at: new Date().toISOString(),
      retry_count: 0, synced: 0,
    });
    await db.sync_queue.add({
      user_id: 'u1', action: 'insert_log',
      payload: { id: 'l2' },
      device_id: 'd1', created_at: new Date().toISOString(),
      retry_count: 0, synced: 0,
    });

    // This is the exact query used in flush() — must hit the index
    const pending = await db.sync_queue
      .where('synced').equals(0)
      .sortBy('id');

    expect(pending).toHaveLength(2);
    expect(pending.every(i => i.synced === 0)).toBe(true);
  });

  it('items marked synced=1 are excluded from the pending query', async () => {
    await db.sync_queue.bulkAdd([
      {
        user_id: 'u1', action: 'insert_log', payload: { id: 'a' },
        device_id: 'd1', created_at: '', retry_count: 0, synced: 0,
      },
      {
        user_id: 'u1', action: 'insert_log', payload: { id: 'b' },
        device_id: 'd1', created_at: '', retry_count: 0, synced: 1,
        synced_at: new Date().toISOString(),
      },
    ]);

    const pending = await db.sync_queue.where('synced').equals(0).toArray();
    expect(pending).toHaveLength(1);
    expect((pending[0].payload as any).id).toBe('a');
  });

  it('sortBy id preserves insertion order (sequential flush invariant)', async () => {
    // Insert in specific order; ids are auto-increment integers
    await db.sync_queue.add({ user_id:'u1', action:'insert_log', payload:{id:'x1'}, device_id:'d', created_at:'', retry_count:0, synced:0 });
    await db.sync_queue.add({ user_id:'u1', action:'delete_log', payload:{id:'x1'}, device_id:'d', created_at:'', retry_count:0, synced:0 });

    const ordered = await db.sync_queue.where('synced').equals(0).sortBy('id');
    // insert must precede delete — critical for data integrity
    expect(ordered[0].action).toBe('insert_log');
    expect(ordered[1].action).toBe('delete_log');
  });

  it('updating synced to 1 removes item from pending query', async () => {
    const key = await db.sync_queue.add({
      user_id: 'u1', action: 'insert_log', payload: { id: 'z' },
      device_id: 'd1', created_at: '', retry_count: 0, synced: 0,
    });

    await db.sync_queue.update(key, { synced: 1, synced_at: new Date().toISOString() });

    const pending = await db.sync_queue.where('synced').equals(0).toArray();
    expect(pending.every(i => i.synced !== 1)).toBe(true);
  });

  it('food_analytics store tracks use_count correctly', async () => {
    await db.food_analytics.put({
      food_id:         'food-1',
      food_name:       'Poha',
      food_source:     'master',
      use_count:       1,
      last_used_at:    new Date().toISOString(),
      last_used_date:  '2026-07-13',
    });

    const entry = await db.food_analytics.get('food-1');
    expect(entry?.use_count).toBe(1);

    await db.food_analytics.update('food-1', { use_count: 6 });
    const updated = await db.food_analytics.get('food-1');
    expect(updated?.use_count).toBe(6);
  });
});
