/**
 * SyncManager.ts — NutriSmart Offline Sync Controller
 * Module 2, Step 2.2
 *
 * ARCHITECTURE:
 *   Every write goes to Dexie first, then to the sync_queue.
 *   When the network is available, flush() sends queued operations to Supabase
 *   in sequential order (by id ASC — insertion order guarantee).
 *
 * ISESSION_REFRESHING INTEGRATION:
 *   Before each flush attempt, SyncManager checks the AuthContext's
 *   isSessionRefreshing flag. If true, it defers the flush by 600ms and
 *   retries. This prevents 401 errors during silent JWT renewals.
 *
 * QUICK WATER BYPASS:
 *   quickAddWaterLocal() updates the water_logs table directly in Dexie
 *   without opening a full modal or re-rendering the entire log view.
 *   Used by the inline water tap button on the dashboard ring.
 *   A sync_queue entry is still enqueued so the count reaches Supabase.
 *
 * BACKGROUND SYNC:
 *   Registers a service worker background sync tag ('sync-logs') so the
 *   queue can flush even when the app tab is closed (Android Chrome).
 */

import { supabase } from './supabase';
import {
  localDb,
  type SyncQueueItem,
  type LogEntry,
  type WaterLog,
  type EnergyLog,
  type KitchenProfile,
} from './localDb';

// ── TYPES ─────────────────────────────────────────────────────────────────────

type RefreshCheck = () => boolean;

interface SyncManagerOptions {
  userId:          string;
  deviceId:        string;
  /**
   * Callback that returns the current value of isSessionRefreshing from
   * AuthContext. SyncManager cannot import useAuth() directly (hook rules)
   * so the caller injects this getter.
   */
  getIsRefreshing: RefreshCheck;
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const MAX_RETRY = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const REFRESH_WAIT_MS = 600;
const FLUSH_DEBOUNCE_MS = 400;

// ── SYNC MANAGER CLASS ────────────────────────────────────────────────────────

export class SyncManager {
  private userId:          string;
  private deviceId:        string;
  private getIsRefreshing: RefreshCheck;
  private isFlushing:      boolean = false;
  private flushTimer:      ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SyncManagerOptions) {
    this.userId          = opts.userId;
    this.deviceId        = opts.deviceId;
    this.getIsRefreshing = opts.getIsRefreshing;
  }

  // ── INITIALIZATION ────────────────────────────────────────────────────────

  /**
   * Call once after auth is confirmed.
   * Registers network listeners and pulls today's server data.
   */
  async init(): Promise<void> {
    // Pull today's data from Supabase into Dexie on startup
    await this.pullToday();

    // Flush any pending items immediately if online
    if (navigator.onLine) {
      this.scheduleFlush();
    }

    // Listen for network restoration
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // Register Background Sync (Android Chrome)
    this.registerBackgroundSync();

    // Flush when app returns to foreground
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  destroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  // ── EVENT HANDLERS ────────────────────────────────────────────────────────

  private handleOnline = (): void => {
    this.scheduleFlush();
  };

  private handleOffline = (): void => {
    // Nothing to do — writes continue to Dexie, queue accumulates
  };

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      this.pullToday();
      this.scheduleFlush();
    }
  };

  // ── PULL TODAY FROM SUPABASE ──────────────────────────────────────────────

  /**
   * Fetches today's data from Supabase and merges into Dexie.
   * Uses IST date for the log_date boundary.
   */
  async pullToday(): Promise<void> {
    const today = this.todayIST();
    try {
      // AUDIT FIX R1 — Queue-Aware Pull: a server row must never overwrite a
      // local row whose insert/update is still pending in the sync_queue
      // ("server stale" race: local is newer, server hasn't seen it yet).
      const pendingItems = (await localDb.sync_queue
        .where('synced').equals(0)
        .toArray())
        .filter(i => !i.failed);
      const pendingIds = new Set<string>(
        pendingItems
          .map(i => (i.payload as any)?.id)
          .filter((id): id is string => typeof id === 'string')
      );
      const pendingWaterDates = new Set<string>(
        pendingItems
          .filter(i => i.action === 'update_water')
          .map(i => (i.payload as any)?.log_date)
          .filter((d): d is string => typeof d === 'string')
      );

      // daily_logs — skip any row with a pending local mutation
      const { data: logs } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('user_id', this.userId)
        .eq('log_date', today);

      if (logs?.length) {
        const safe = (logs as LogEntry[]).filter(l => !pendingIds.has(l.id));
        if (safe.length) await localDb.daily_logs.bulkPut(safe);
      }

      // water_logs
      const { data: water } = await supabase
        .from('water_logs')
        .select('*')
        .eq('user_id', this.userId)
        .eq('log_date', today)
        .maybeSingle();

      if (water && !pendingWaterDates.has((water as WaterLog).log_date)) {
        await localDb.water_logs.put(water as WaterLog);
      }

      // energy_logs
      const { data: energy } = await supabase
        .from('energy_logs')
        .select('*')
        .eq('user_id', this.userId)
        .eq('log_date', today);

      if (energy?.length) {
        const safeEnergy = (energy as EnergyLog[]).filter(e => !pendingIds.has(e.id));
        if (safeEnergy.length) await localDb.energy_logs.bulkPut(safeEnergy);
      }

      // Update last_sync timestamp
      await localDb.user_prefs.put({
        key:   'last_sync',
        value: new Date().toISOString(),
      });
    } catch {
      // Network error — continue with local data silently
    }
  }

  // ── ENQUEUE ───────────────────────────────────────────────────────────────

  /**
   * Adds an operation to the sync_queue.
   * Call this after every successful Dexie write.
   */
  async enqueue(action: SyncQueueItem['action'], payload: unknown): Promise<void> {
    await localDb.sync_queue.add({
      user_id:    this.userId,
      action,
      payload,
      device_id:  this.deviceId,
      created_at: new Date().toISOString(),
      retry_count: 0,
      synced:      0,   // indexed pending flag (audit fix R1)
    });
    if (navigator.onLine) {
      this.scheduleFlush();
    }
  }

  // ── FLUSH ─────────────────────────────────────────────────────────────────

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  /**
   * Flushes all pending sync_queue items to Supabase in order (id ASC).
   * Sequential — never parallel — to preserve insert-before-delete ordering.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || !navigator.onLine) return;

    // Cross-tab exclusivity: two open tabs must not double-flush the same
    // queue (upserts make logs idempotent, but events/deletes are not).
    if ('locks' in navigator) {
      return navigator.locks.request(
        'ns-sync-flush',
        { ifAvailable: true },
        async (lock) => { if (lock) await this.flushInternal(); }
      );
    }
    return this.flushInternal();
  }

  private async flushInternal(): Promise<void> {
    if (this.isFlushing || !navigator.onLine) return;

    // Wait for token refresh if one is in progress
    if (this.getIsRefreshing()) {
      setTimeout(() => this.flush(), REFRESH_WAIT_MS);
      return;
    }

    this.isFlushing = true;
    try {
      // AUDIT FIX R1: proper indexed query — no undefined-value semantics.
      // sortBy('id') preserves insertion order (sequential flush invariant).
      const pending = (await localDb.sync_queue
        .where('synced').equals(0)
        .sortBy('id'))
        .filter(item => !item.failed);

      for (const item of pending) {
        await this.processQueueItem(item);
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async processQueueItem(item: SyncQueueItem): Promise<void> {
    const attempt = async (): Promise<void> => {
      const { error } = await this.executeAction(item);

      if (!error) {
        // Mark synced
        await localDb.sync_queue.update(item.id!, {
          synced:    1,
          synced_at: new Date().toISOString(),
        });
        return;
      }

      // 4xx: data error — mark failed, do not retry
      if (error.status && error.status >= 400 && error.status < 500) {
        await localDb.sync_queue.update(item.id!, { failed: true });
        return;
      }

      // 5xx / network: retry with exponential backoff
      const retries = item.retry_count;
      if (retries >= MAX_RETRY) {
        await localDb.sync_queue.update(item.id!, { failed: true });
        return;
      }

      await localDb.sync_queue.update(item.id!, {
        retry_count: retries + 1,
      });

      const delay = RETRY_DELAYS_MS[Math.min(retries, RETRY_DELAYS_MS.length - 1)];
      await new Promise(r => setTimeout(r, delay));
      await attempt();
    };

    await attempt();
  }

  private async executeAction(item: SyncQueueItem): Promise<{ error: any }> {
    const p = item.payload as any;

    switch (item.action) {
      case 'promote_popular_food': {
        // TASK 3.2: user's custom food crossed the popularity threshold.
        // POST to server function which embeds + inserts into food_semantic_cache
        // (service-role only — clients can't write vectors directly, by RLS design).
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error('no_session');
        const res = await fetch('/.netlify/functions/promote-food-cache', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(item.payload),
        });
        if (!res.ok && res.status >= 500) throw new Error(`server_${res.status}`);
        return { error: null };
      }

      case 'insert_log':
        return supabase.from('daily_logs').upsert(p, { onConflict: 'id' });

      case 'delete_log':
        return supabase.from('daily_logs')
          .delete()
          .eq('id', p.id)
          .eq('user_id', this.userId);

      case 'update_log':
        return supabase.from('daily_logs')
          .update({
            meal:     p.meal,
            qty:      p.qty,
            cal:      p.cal,
            protein:  p.protein,
            carbs:    p.carbs,
            fat:      p.fat,
            gl:       p.gl,
            portion:  p.portion,
          })
          .eq('id', p.id)
          .eq('user_id', this.userId);

      case 'update_water':
        return supabase.from('water_logs').upsert(p, {
          onConflict: 'user_id,log_date',
        });

      case 'update_kitchen_profile':
        return supabase.from('kitchen_profiles').upsert(
          { ...p, user_id: this.userId },
          { onConflict: 'user_id' }
        );

      case 'insert_energy':
        // Also used as a generic event channel
        if (p?.event_name) {
          return supabase.from('events').insert({
            user_id:     this.userId,
            event_name:  p.event_name,
            properties:  p.properties ?? {},
            created_at:  p.created_at,
          });
        }
        return supabase.from('energy_logs').upsert(p, { onConflict: 'id' });

      case 'insert_event':
        return supabase.from('events').insert({
          user_id:    this.userId,
          event_name: p.event_name,
          properties: p.properties ?? {},
          created_at: p.created_at ?? new Date().toISOString(),
        });

      case 'upsert_template':
        return supabase.from('meal_templates').upsert(p, { onConflict: 'id' });

      case 'delete_template':
        return supabase.from('meal_templates')
          .delete()
          .eq('id', p.id)
          .eq('user_id', this.userId);

      default:
        return { error: { message: `Unknown action: ${item.action}`, status: 400 } };
    }
  }

  // ── QUICK WATER (bypass full view) ────────────────────────────────────────

  /**
   * Increments today's water count by 1 directly in Dexie.
   * Called by the inline tap button on the dashboard water ring.
   * Does NOT trigger a full component re-render cycle.
   * Enqueues a sync item so the count reaches Supabase eventually.
   *
   * Returns the new glass count.
   */
  async quickAddWaterLocal(delta: 1 | -1 = 1): Promise<number> {
    const today = this.todayIST();
    const key: [string, string] = [this.userId, today];

    const existing = await localDb.water_logs.get(key);
    const current  = existing?.glasses ?? 0;
    const next     = Math.max(0, Math.min(20, current + delta));

    const updated: WaterLog = {
      user_id:  this.userId,
      log_date: today,
      glasses:  next,
    };

    // Atomic UPSERT — compound key enforces one row per day
    await localDb.water_logs.put(updated);

    // Enqueue server sync
    await this.enqueue('update_water', updated);

    return next;
  }

  // ── BACKGROUND SYNC REGISTRATION ─────────────────────────────────────────

  private async registerBackgroundSync(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
      const sw = await navigator.serviceWorker.ready;
      await (sw as any).sync.register('sync-logs');
    } catch {
      // Background sync not supported — graceful degradation
    }
  }

  // ── PENDING COUNT ─────────────────────────────────────────────────────────

  /**
   * Returns count of items not yet synced.
   * Displayed in the offline banner: "3 items pending sync".
   */
  async getPendingCount(): Promise<number> {
    const pending = await localDb.sync_queue
      .where('synced').equals(0)
      .toArray();
    return pending.filter(item => !item.failed && item.user_id === this.userId).length;
  }

  // ── UTILITIES ─────────────────────────────────────────────────────────────

  /**
   * Returns today's date string in IST (Asia/Kolkata) as "YYYY-MM-DD".
   * Uses Intl.DateTimeFormat to correctly handle midnight boundary in IST.
   */
  private todayIST(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year:  'numeric',
      month: '2-digit',
      day:   '2-digit',
    }).format(new Date());
  }

  /** Real connectivity check — navigator.onLine can lie on some networks */
  static async checkRealConnectivity(): Promise<boolean> {
    try {
      const res = await fetch('/favicon.ico', {
        method: 'HEAD',
        cache: 'no-store',
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

// ── SINGLETON FACTORY ─────────────────────────────────────────────────────────

let _instance: SyncManager | null = null;

export function getSyncManager(): SyncManager {
  if (!_instance) {
    throw new Error(
      'SyncManager not initialized. Call initSyncManager() after auth.'
    );
  }
  return _instance;
}

export function initSyncManager(opts: SyncManagerOptions): SyncManager {
  _instance?.destroy();
  _instance = new SyncManager(opts);
  return _instance;
}

export function destroySyncManager(): void {
  _instance?.destroy();
  _instance = null;
}
