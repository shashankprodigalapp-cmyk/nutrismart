/**
 * WelcomeBackCard.tsx — a gentle card for someone returning after a few days away.
 * Shown on the Today tab when the switch 'ui_welcome_back' is on. No streaks, no loss, no guilt.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { localDb } from '../../lib/localDb';
import {
  WELCOME_COPY, daysAway, dismissWelcomeFor, shouldWelcomeBack, welcomeDismissedFor,
} from '../../lib/delight';

export function WelcomeBackCard() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const mine = (await localDb.daily_logs.toArray()).filter(l => l.user_id === user.id);
        const loggedToday = mine.some(l => l.log_date === today);
        const last = mine.reduce<string | null>((m, l) => (l.log_date && (!m || l.log_date > m) ? l.log_date : m), null);
        // A brand-new account has nothing to come back to, so it never sees this card.
        const gap = daysAway(last, today);
        if (live) setShow(shouldWelcomeBack(gap, loggedToday, welcomeDismissedFor(today)));
      } catch { if (live) setShow(false); }
    })();
    return () => { live = false; };
  }, [user, today]);

  if (!show) return null;
  return (
    <section data-testid="welcome-back" className="bg-[#1C1C1E] rounded-2xl p-4 border border-[#C8F75E]/20">
      <div className="flex items-start justify-between">
        <h2 className="text-base font-semibold">{WELCOME_COPY.title}</h2>
        <button type="button" aria-label="Dismiss" onClick={() => { dismissWelcomeFor(today); setShow(false); }} className="w-11 h-11 -mr-2 -mt-2 text-[#8E8E93] text-lg">×</button>
      </div>
      <p className="text-sm text-[#EBEBF5]/70 mt-1">{WELCOME_COPY.body}</p>
      <div className="mt-3 space-y-2">
        {WELCOME_COPY.actions.map(a => (
          <Link key={a.label} to={a.to} className="block rounded-xl bg-[#2C2C2E] px-4 py-3 text-sm font-medium min-h-[44px]">{a.label}</Link>
        ))}
      </div>
    </section>
  );
}
