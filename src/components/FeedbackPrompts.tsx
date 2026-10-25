/**
 * FeedbackPrompts.tsx: two one-tap questions, each shown at most a few times.
 *  1. Welcome back after 14+ quiet days: "What kept you away?"
 *  2. Day 30+: "How would you feel if you could no longer use NutriSmart?"
 * Answers are stored as plain events (counts only, no free text).
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { track } from '../lib/analytics';

type Kind = 'exit' | 'sean';

const EXIT_OPTIONS = [
  { v: 'forgot',      label: 'I forgot' },
  { v: 'effort',      label: 'Too much effort to log' },
  { v: 'numbers',     label: 'The numbers felt wrong' },
  { v: 'missing',     label: 'My foods were missing' },
  { v: 'no_results',  label: "I didn't see results" },
  { v: 'other',       label: 'Something else' },
];
const SEAN_OPTIONS = [
  { v: 'very',     label: 'Very disappointed' },
  { v: 'somewhat', label: 'Somewhat disappointed' },
  { v: 'not',      label: 'Not disappointed' },
];

const DAY = 86_400_000;
const get = (k: string): number => { try { return Number(localStorage.getItem(k) ?? 0) || 0; } catch { return 0; } };
const set = (k: string, v: number | string) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

export default function FeedbackPrompts() {
  const { user } = useAuth();
  const [kind, setKind] = useState<Kind | null>(null);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    if (!user) return;
    const now = Date.now();
    const lastOpen = get('ns_last_open');
    set('ns_last_open', now);

    let pick: Kind | null = null;
    const gapDays = lastOpen ? (now - lastOpen) / DAY : 0;
    if (gapDays >= 14 && now - get('ns_exit_asked') > 90 * DAY) pick = 'exit';
    else {
      const ageDays = user.created_at ? (now - new Date(user.created_at).getTime()) / DAY : 0;
      const answered = get('ns_sean_done') === 1;
      const asked = get('ns_sean_count');
      if (!answered && ageDays >= 30 && asked < 3 && now - get('ns_sean_asked') > 7 * DAY) pick = 'sean';
    }
    if (!pick) return;
    const t = setTimeout(() => setKind(pick), 8000);
    return () => clearTimeout(t);
  }, [user?.id]);

  if (!kind) return null;

  const options = kind === 'exit' ? EXIT_OPTIONS : SEAN_OPTIONS;
  const close = () => setKind(null);

  const answer = (v: string) => {
    if (kind === 'exit') { track('feedback_exit', { reason: v }); set('ns_exit_asked', Date.now()); }
    else { track('feedback_sean_ellis', { answer: v }); set('ns_sean_done', 1); }
    setThanks(true);
    setTimeout(() => { setThanks(false); close(); }, 1800);
  };

  const notNow = () => {
    if (kind === 'exit') set('ns_exit_asked', Date.now());
    else { set('ns_sean_asked', Date.now()); set('ns_sean_count', get('ns_sean_count') + 1); }
    close();
  };

  return (
    <div role="dialog" aria-label="Quick question"
      className="fixed inset-x-3 bottom-24 md:bottom-6 md:left-auto md:right-6 md:w-96 z-40 rounded-2xl bg-[#1C1C1E] border border-white/[0.1] p-4 shadow-xl">
      {thanks ? (
        <p className="text-sm text-[#C8F75E] font-semibold">Thank you. This really helps.</p>
      ) : (
        <>
          <p className="text-sm font-bold text-white">
            {kind === 'exit' ? 'Welcome back! What kept you away?' : 'How would you feel if you could no longer use NutriSmart?'}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {options.map(o => (
              <button key={o.v} onClick={() => answer(o.v)}
                className="text-left text-sm text-white bg-white/[0.06] hover:bg-white/[0.1] rounded-xl px-3 py-2.5 active:scale-[0.98] transition-transform">
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={notNow} className="mt-3 text-xs text-[#8E8E93] underline">Not now</button>
        </>
      )}
    </div>
  );
}
