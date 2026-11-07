/**
 * SparksCard.tsx — Sparks, level and today's two quests, on the Today tab.
 * Shown when the switch 'ui_sparks' is on. The numbers come from the server (/api/progress), which awards from real logs.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useFlag } from '../../lib/useFlag';
import { coachApi } from '../../lib/coachApi';
import { LOGGED_EVENT } from '../../lib/delight';
import { POINTS_NAME, SPARKS_NOTE, levelUpLine, shouldShowLevelUp, type LevelInfo, type Quest } from '../../lib/sparks';

interface Progress { total: number; today: number; cap: number; level: LevelInfo; quests: Quest[]; }
const SEEN_KEY = 'ns-level-seen';
const getSeen = (): number | null => { try { const v = localStorage.getItem(SEEN_KEY); return v === null ? null : Number(v); } catch { return null; } };
const setSeen = (n: number) => { try { localStorage.setItem(SEEN_KEY, String(n)); } catch { /* ignore */ } };

export function SparksCard() {
  const { user } = useAuth();
  const on = useFlag('ui_sparks');
  const [p, setP] = useState<Progress | null>(null);
  const [up, setUp] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await coachApi<Progress>('/api/progress', {});
    if (!r.ok || typeof r.data.total !== 'number') return;
    const data = r.data as Progress;
    if (shouldShowLevelUp(getSeen(), data.level.n)) setUp(levelUpLine(data.level.name));
    setSeen(Math.max(getSeen() ?? 0, data.level.n));
    setP(data);
  }, []);

  useEffect(() => {
    if (!on || !user) return;
    void refresh();
    // A saved meal reaches the server a moment later, so ask again shortly after each log.
    let t: ReturnType<typeof setTimeout> | undefined;
    const onLogged = () => { if (t) clearTimeout(t); t = setTimeout(() => { void refresh(); }, 6000); };
    window.addEventListener(LOGGED_EVENT, onLogged);
    return () => { window.removeEventListener(LOGGED_EVENT, onLogged); if (t) clearTimeout(t); };
  }, [on, user, refresh]);

  if (!on || !p) return null;
  const l = p.level;
  return (
    <section data-testid="sparks-card" className="bg-[#1C1C1E] rounded-2xl p-4" aria-label={POINTS_NAME}>
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Your {POINTS_NAME}</h2>
        <span className="text-sm font-semibold">✨ {p.total}</span>
      </div>
      {up && <p role="status" className="mt-2 rounded-xl bg-[#C8F75E]/15 px-3 py-2 text-sm font-medium">{up}</p>}
      <p className="mt-2 text-base font-semibold">{l.name}</p>
      <div className="mt-2 h-2 rounded-full bg-[#2C2C2E] overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={l.pct} aria-label={`Progress to the next level, ${l.pct} percent`}>
        <div className="h-full rounded-full bg-[#C8F75E]" style={{ width: `${l.pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-[#8E8E93]">{l.toNext === null ? 'You are at the top level.' : `${l.toNext} ${POINTS_NAME} to ${l.nextName}`}</p>
      <p className="mt-3 text-[11px] uppercase tracking-wide text-[#8E8E93]">Today · {p.today} of {p.cap}</p>
      <ul className="mt-1 space-y-1">
        {p.quests.map(q => (
          <li key={q.id} className="flex items-center gap-2 text-sm">
            <span aria-hidden="true">{q.done ? '✅' : '○'}</span>
            <span className={q.done ? 'text-[#8E8E93]' : ''}>{q.label}</span>
            <span className="sr-only">{q.done ? 'done' : 'not yet'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-[#8E8E93]">{SPARKS_NOTE}</p>
    </section>
  );
}
