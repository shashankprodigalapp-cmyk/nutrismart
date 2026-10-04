/**
 * VerdictDashboard.tsx — STRATEGIC REFACTOR R4 (client half)
 *
 * Renders the Morning Verdict card at the top of the log tab.
 * Rules:
 *   - Only shows for users with ≥3 days of account age (new users have no
 *     data worth a verdict; showing an empty one cheapens the feature)
 *   - Fetched once per IST day, cached in Dexie user_prefs — reopening the
 *     app the same day costs zero network
 *   - Dismissible; dismissal also persists for the day
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { localDb }  from '../lib/localDb';
import { useAuth }  from '../context/AuthContext';

interface Verdict {
  date_ist:      string;
  yesterday_gl:  number | null;
  yesterday_cal: number | null;
  crash_pattern: string | null;
  suggestion:    string;
  headline:      string;
  variant?:      string;
}

const MIN_ACCOUNT_AGE_DAYS = 3;

const todayIST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function VerdictDashboard() {
  const { user } = useAuth();
  const [verdict,   setVerdict]   = useState<Verdict | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;

    // Account-age gate: created_at from auth metadata
    const createdAt = user.created_at ? new Date(user.created_at) : null;
    if (!createdAt || Date.now() - createdAt.getTime() < MIN_ACCOUNT_AGE_DAYS * 86_400_000) {
      return;
    }

    const today = todayIST();

    // Day-cache in Dexie: dismissal + verdict both persist for the IST day
    const cached = await localDb.user_prefs.get('morning_verdict');
    const cv = cached?.value as any;
    if (cv?.date === today) {
      if (cv.dismissed) { setDismissed(true); return; }
      if (cv.verdict)   { setVerdict(cv.verdict); return; }
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/.netlify/functions/cron-morning-verdict', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.verdict) {
        setVerdict(data.verdict);
        await localDb.user_prefs.put({
          key:   'morning_verdict',
          value: { date: today, verdict: data.verdict, dismissed: false },
        });
        // Retention signal: this event is what retention_health_check counts.
        // A logger with zero verdict_viewed events for 3 days = flywheel stalled.
        supabase.from('events').insert({
          user_id:    user.id,
          event_name: 'verdict_viewed',
          properties: { variant: data.verdict.variant ?? null, date: today },
        }).then(() => {});
      }
    } catch { /* silent — verdict is a bonus, never an error state */ }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // "opened app but ignored verdict" vs "interacted": verdict_viewed fires on
  // render (passive); verdict_interacted fires on first tap of the card body
  // (active). Dismiss-without-interaction carries interacted:false — the
  // ignored cohort is (viewed=1, interacted=0) in the events table.
  const interactedRef = React.useRef(false);

  const trackInteraction = () => {
    if (interactedRef.current || !user) return;
    interactedRef.current = true;
    supabase.from('events').insert({
      user_id:    user.id,
      event_name: 'verdict_interacted',
      properties: { variant: verdict?.variant ?? null, date: todayIST() },
    }).then(() => {});
  };

  const dismiss = async () => {
    setDismissed(true);
    if (user) {
      supabase.from('events').insert({
        user_id:    user.id,
        event_name: 'verdict_dismissed',
        properties: {
          variant:    verdict?.variant ?? null,
          interacted: interactedRef.current,   // false = opened app, ignored verdict
          date:       todayIST(),
        },
      }).then(() => {});
    }
    await localDb.user_prefs.put({
      key:   'morning_verdict',
      value: { date: todayIST(), verdict, dismissed: true },
    });
  };

  if (!verdict || dismissed) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '☀️ Morning verdict' : hour < 17 ? '🌤 Today\'s verdict' : '🌙 Your verdict';

  return (
    <div onClick={trackInteraction}
      className="mx-4 mb-3 bg-gradient-to-br from-[#C8F75E]/12 to-[#C8F75E]/4 border border-[#C8F75E]/30 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-[10px] font-bold text-[#C8F75E] uppercase tracking-[1px]">{greeting}</p>
        <button onClick={dismiss} aria-label="Dismiss"
          className="text-[#636366] text-[16px] leading-none flex-shrink-0">×</button>
      </div>

      <h2 className="font-['Playfair_Display'] text-[18px] font-black text-[#F5F5F5] leading-tight mb-2">
        {verdict.headline}
      </h2>

      {/* Yesterday stats row */}
      {(verdict.yesterday_gl !== null || verdict.yesterday_cal !== null) && (
        <div className="flex gap-3 mb-2">
          {verdict.yesterday_cal !== null && (
            <span className="text-[11px] text-[#A1A1A1]">
              Yesterday: <strong className="text-[#E8D5B0]">{verdict.yesterday_cal} kcal</strong>
            </span>
          )}
          {verdict.yesterday_gl !== null && (
            <span className="text-[11px] text-[#A1A1A1]">
              GL <strong className={verdict.yesterday_gl > 45 ? 'text-[#FF6B6B]' : 'text-[#C4A8FF]'}>
                {verdict.yesterday_gl}
              </strong>
            </span>
          )}
        </div>
      )}

      {/* Crash pattern callout */}
      {verdict.crash_pattern && (
        <div className="bg-[#FF6B6B]/10 border border-[#FF6B6B]/20 rounded-lg px-3 py-2 mb-2">
          <p className="text-[11px] text-[#FF6B6B]">📉 {verdict.crash_pattern}</p>
        </div>
      )}

      <p className="text-[12px] text-[#A1A1A1] leading-relaxed">{verdict.suggestion}</p>
    </div>
  );
}

export default VerdictDashboard;
