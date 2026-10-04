/**
 * PushPermissionPrompt.tsx — Permission request for energy check-in reminders
 *
 * WHEN IT APPEARS:
 *   After the user's FIRST successful food log in this session, AND only if:
 *   - Push is supported by the browser
 *   - Permission has not already been granted or denied
 *   - The user has not dismissed this prompt before (tracked in user_prefs)
 *
 * WHAT IT DOES NOT DO:
 *   - Does NOT request permission on app launch
 *   - Does NOT block food logging
 *   - Does NOT show more than once per session if dismissed
 *   - Does NOT retry after explicit denial
 *
 * COPY:
 *   "Want reminders when it's time to check your energy?"
 *   This explains the benefit (energy check-in timing) without promising
 *   notifications for other purposes.
 *
 * SECURITY:
 *   Registration calls registerPushSubscription(user.id) which writes
 *   only to push_subscriptions (RLS: own rows only). No food data is exposed.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { localDb } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';
import {
  isPushSupported,
  getCurrentPermission,
  registerPushSubscription,
} from '../lib/pushRegistration';

const DISMISSED_KEY = 'push_prompt_dismissed';

export interface PushPermissionPromptProps {
  /** Set to true after the user's first successful food log this session */
  shouldPrompt: boolean;
}

export function PushPermissionPrompt({ shouldPrompt }: PushPermissionPromptProps) {
  const { user }                  = useAuth();
  const [visible,   setVisible]   = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [result,    setResult]    = useState<'idle' | 'granted' | 'denied'>('idle');

  // ── Decide whether to show ─────────────────────────────────────────────────
  useEffect(() => {
    if (!shouldPrompt || !user) return;

    async function check() {
      // Already granted or denied at the OS level — don't prompt
      const current = getCurrentPermission();
      if (current === 'granted' || current === 'denied') return;

      // Not supported — don't prompt
      if (!isPushSupported()) return;

      // User already dismissed this prompt in a previous session
      const dismissed = await localDb.user_prefs.get(DISMISSED_KEY);
      if (dismissed?.value) return;

      // All checks passed — show prompt with a 1.5s delay
      // (lets the food-log confirmation animation finish first)
      setTimeout(() => setVisible(true), 1500);
    }

    check();
  }, [shouldPrompt, user]);

  // ── Dismiss — remember so it doesn't appear again ─────────────────────────
  const handleDismiss = useCallback(async () => {
    setVisible(false);
    await localDb.user_prefs.put({ key: DISMISSED_KEY, value: true });
  }, []);

  // ── Enable — trigger the native permission prompt then register ─────────────
  const handleEnable = useCallback(async () => {
    if (!user || loading) return;
    setLoading(true);
    try {
      const res = await registerPushSubscription(user.id);
      if (!res.supported || !res.granted) {
        setResult('denied');
        // Remember as dismissed so we don't show the in-app prompt again
        await localDb.user_prefs.put({ key: DISMISSED_KEY, value: true });
        setTimeout(() => setVisible(false), 2000);
      } else {
        setResult('granted');
        setTimeout(() => setVisible(false), 1500);
      }
    } catch {
      setVisible(false);
    } finally {
      setLoading(false);
    }
  }, [user, loading]);

  if (!visible) return null;

  return (
    <>
      {/* Backdrop — tap to dismiss */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={handleDismiss}
        aria-hidden="true"
      />

      {/* Prompt card — positioned near bottom, above nav */}
      <div className="fixed bottom-20 inset-x-4 z-50 bg-[#1C1C1E] border border-[#C8F75E]/20 rounded-2xl px-4 py-4 shadow-xl">
        {result === 'idle' && (
          <>
            <div className="flex items-start gap-3 mb-3">
              <span className="text-[22px] flex-shrink-0 mt-0.5">🔔</span>
              <div>
                <p className="text-[13px] font-bold text-[#F5F5F5] leading-snug">
                  Want reminders when it's time to check your energy?
                </p>
                <p className="text-[11px] text-[#636366] mt-1 leading-snug">
                  We'll nudge you ~60 min after a meal — so your energy check-in
                  is timed perfectly for the correlation to work.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleEnable}
                disabled={loading}
                className="flex-1 bg-[#C8F75E] text-[#111113] font-bold text-[13px] rounded-xl py-2.5 active:scale-[0.97] transition-transform disabled:opacity-60"
              >
                {loading ? 'Setting up…' : 'Enable reminders'}
              </button>
              <button
                onClick={handleDismiss}
                className="px-4 py-2.5 text-[13px] text-[#636366] font-medium"
              >
                Not now
              </button>
            </div>
          </>
        )}

        {result === 'granted' && (
          <div className="flex items-center gap-3">
            <span className="text-[22px]">✅</span>
            <p className="text-[13px] font-semibold text-[#6BCB77]">
              Reminders enabled — we'll nudge you after meals.
            </p>
          </div>
        )}

        {result === 'denied' && (
          <div className="flex items-center gap-3">
            <span className="text-[20px]">💡</span>
            <p className="text-[12px] text-[#A1A1A1] leading-snug">
              No problem. Energy check-ins still work when the app is open.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

export default PushPermissionPrompt;
