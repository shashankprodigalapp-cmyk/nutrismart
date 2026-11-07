/**
 * CelebrationHost.tsx — a short, friendly pop after a meal is logged.
 * Mounted once in the app shell. Does nothing unless the switch 'ui_celebrations' is on.
 * Respects reduced motion, can be turned off by the user, and never blocks logging.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { localDb } from '../../lib/localDb';
import { useFlag } from '../../lib/useFlag';
import { useTargets } from '../../lib/useTargets';
import {
  LOGGED_EVENT, canCelebrate, celebrationFor, celebrationsOff, setCelebrationsOff,
  prefersReducedMotion, type Celebration,
} from '../../lib/delight';

const SHOW_MS = 3800;
const CONFETTI = [
  { l: 8, c: '#C8F75E', d: 0, r: 20 }, { l: 20, c: '#FF9F0A', d: 60, r: -30 }, { l: 32, c: '#BF5AF2', d: 20, r: 45 },
  { l: 44, c: '#30D158', d: 90, r: -15 }, { l: 56, c: '#FFD60A', d: 40, r: 35 }, { l: 68, c: '#FF6B6B', d: 10, r: -40 },
  { l: 80, c: '#C8F75E', d: 70, r: 25 }, { l: 92, c: '#64D2FF', d: 30, r: -25 },
];

export function CelebrationHost() {
  const { user } = useAuth();
  const on = useFlag('ui_celebrations');
  const { protein: proteinGoal } = useTargets();
  const [pop, setPop] = useState<Celebration | null>(null);
  const lastAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = prefersReducedMotion();

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPop(null);
  }, []);

  useEffect(() => {
    if (!on || !user) return;
    const handler = async (ev: Event) => {
      const now = Date.now();
      if (!canCelebrate(now, lastAt.current, celebrationsOff())) return;
      lastAt.current = now;
      const meal = (ev as CustomEvent<{ meal: string | null }>).detail?.meal ?? undefined;
      let pct: number | null = null;
      try {
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const logs = await localDb.daily_logs.where('log_date').equals(today).toArray();
        const protein = logs.filter(l => l.user_id === user.id).reduce((s, l) => s + (l.protein ?? 0), 0);
        pct = proteinGoal > 0 ? Math.round((protein / proteinGoal) * 100) : null;
      } catch { pct = null; }
      setPop(celebrationFor(meal, pct));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPop(null), SHOW_MS);
    };
    window.addEventListener(LOGGED_EVENT, handler);
    return () => { window.removeEventListener(LOGGED_EVENT, handler); if (timer.current) clearTimeout(timer.current); };
  }, [on, user, proteinGoal]);

  if (!on || !pop) return null;
  return (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 pointer-events-none" data-testid="celebration">
      <style>{`@keyframes nsFall{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(90px) rotate(240deg);opacity:0}}@keyframes nsPop{0%{transform:translateY(16px) scale(.96);opacity:0}100%{transform:translateY(0) scale(1);opacity:1}}`}</style>
      <div
        role="status" aria-live="polite"
        className="relative pointer-events-auto w-full max-w-sm rounded-2xl bg-[#1C1C1E] border border-[#C8F75E]/30 p-4 shadow-xl"
        style={reduced ? undefined : { animation: 'nsPop .25s ease-out' }}
      >
        {!reduced && (
          <div aria-hidden="true" className="absolute inset-x-0 -top-2 h-24 overflow-hidden pointer-events-none">
            {CONFETTI.map((c, i) => (
              <span key={i} style={{ position: 'absolute', left: `${c.l}%`, top: 0, width: 8, height: 8, borderRadius: i % 2 ? 2 : 4, background: c.c, transform: `rotate(${c.r}deg)`, animation: `nsFall 1.1s ease-in ${c.d}ms 1 both` }} />
            ))}
          </div>
        )}
        <div className="flex items-start gap-3">
          <div className="text-3xl" aria-hidden="true">{pop.emoji}</div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-white">{pop.title}</p>
            <p className="text-sm text-[#EBEBF5]/70 mt-0.5">{pop.line}</p>
            <button
              type="button"
              onClick={() => { setCelebrationsOff(true); close(); }}
              className="mt-2 text-xs text-[#8E8E93] underline min-h-[44px]"
            >
              Not for me, turn these off
            </button>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="w-11 h-11 -mr-2 -mt-2 text-[#8E8E93] text-lg">×</button>
        </div>
      </div>
    </div>
  );
}
