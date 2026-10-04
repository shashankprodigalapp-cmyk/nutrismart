/**
 * pushRegistration.ts — Web Push VAPID subscription utility
 *
 * WHAT THIS DOES:
 *   1. Checks browser support (PushManager + serviceWorker)
 *   2. Requests notification permission (called only from a deliberate user action)
 *   3. Calls PushManager.subscribe() with the VAPID public key
 *   4. Persists the subscription to public.push_subscriptions via Supabase RLS
 *   5. Deduplicates — does not create a second row if the endpoint already exists
 *
 * WHAT THIS DOES NOT DO:
 *   • Does not request permission automatically on app load
 *   • Does not send any push notifications (that's the server's job)
 *   • Does not expose any nutrition data to the push payload
 *
 * VAPID KEY:
 *   The public key is safe to expose in the browser — it is not a secret.
 *   The private key lives only in Netlify environment variables.
 *   Exposed via VITE_VAPID_PUBLIC_KEY (added to .env.example).
 *
 * RLS:
 *   push_subscriptions_all_own: authenticated users can INSERT/SELECT/DELETE own rows.
 *   The UNIQUE(user_id, endpoint) constraint prevents duplicate subscriptions.
 *   On conflict we do nothing — the existing row is already correct.
 *
 * IDEMPOTENCY CASES:
 *   • Same device, same user, re-registers: UPSERT on (user_id, endpoint) → no-op
 *   • New device, same user: new row inserted (user has multiple devices)
 *   • Permission denied: returns { granted: false }, no DB write
 *   • Browser doesn't support push: returns { supported: false }
 */

import { supabase } from './supabase';

// ── TYPES ─────────────────────────────────────────────────────────────────────

export type PushRegistrationResult =
  | { supported: false }
  | { supported: true; granted: false; reason: 'denied' | 'dismissed' }
  | { supported: true; granted: true;  endpoint: string };

// ── HELPERS ───────────────────────────────────────────────────────────────────

/**
 * Convert a base64url string (VAPID public key) to a Uint8Array
 * as required by PushManager.subscribe({ applicationServerKey }).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding  = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// ── MAIN API ──────────────────────────────────────────────────────────────────

/**
 * isPushSupported — check before showing the permission prompt.
 * Returns false on iOS Safari < 16.4, older desktop browsers, and non-HTTPS.
 */
export function isPushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager'   in window   &&
    'Notification'  in window
  );
}

/**
 * getCurrentPermission — returns the current notification permission state
 * without triggering a prompt. Safe to call any time.
 */
export function getCurrentPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

/**
 * registerPushSubscription — the full registration flow.
 *
 * Call this ONLY from a deliberate user action (e.g. tapping "Enable reminders").
 * Never call on app load — it will trigger the browser permission prompt.
 *
 * @param userId - The authenticated Supabase user ID (for the DB row)
 */
export async function registerPushSubscription(
  userId: string,
): Promise<PushRegistrationResult> {

  // 1. Browser support check
  if (!isPushSupported()) {
    return { supported: false };
  }

  // 2. Request permission (triggers native browser prompt if 'default')
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return {
      supported: true,
      granted:   false,
      reason:    permission === 'denied' ? 'denied' : 'dismissed',
    };
  }

  // 3. Get the active service worker registration
  const registration = await navigator.serviceWorker.ready;

  // 4. VAPID public key — safe to expose in browser bundle
  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
  if (!vapidPublicKey) {
    console.error('[pushRegistration] VITE_VAPID_PUBLIC_KEY not set');
    return { supported: false };
  }

  // 5. Subscribe via PushManager
  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    });
  } catch (err) {
    // Can happen if permission was revoked between the check and the subscribe call
    console.error('[pushRegistration] PushManager.subscribe failed:', err);
    return { supported: true, granted: false, reason: 'denied' };
  }

  const sub = subscription.toJSON();

  // 6. Persist to Supabase — UPSERT on (user_id, endpoint) to stay idempotent.
  //    The unique constraint prevents duplicate rows.
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id:   userId,
        endpoint:  sub.endpoint!,
        p256dh:    sub.keys!.p256dh,
        auth_key:  sub.keys!.auth,
        device_ua: navigator.userAgent.slice(0, 200), // trimmed for storage
      },
      { onConflict: 'user_id, endpoint', ignoreDuplicates: false },
    );

  if (error) {
    console.error('[pushRegistration] DB upsert failed:', error.message);
    // Return granted=true — subscription is live in the browser even if DB failed
    // The next registration attempt will retry the DB write
  }

  return { supported: true, granted: true, endpoint: sub.endpoint! };
}

/**
 * unregisterPushSubscription — called on sign-out to remove the device
 * from push_subscriptions. The server's 410-cleanup in cron functions
 * handles the case where this is not called (e.g. app uninstall).
 */
export async function unregisterPushSubscription(userId: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription  = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;

    // Remove from browser
    await subscription.unsubscribe();

    // Remove from DB (best-effort — 410 cleanup will catch misses)
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('endpoint', endpoint);
  } catch {
    // Non-fatal — 410 cleanup handles residual subscriptions
  }
}
