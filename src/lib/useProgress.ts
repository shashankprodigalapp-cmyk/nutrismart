/**
 * useProgress.ts — Sparks, level and quests for the Today header and rows. Reads /api/progress, which awards from real logs on the server.
 * Same rules as the Sparks card: it only reads; it also shows the one-time level-up line.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { coachApi } from './coachApi';
import { LOGGED_EVENT } from './delight';
import { levelUpLine, shouldShowLevelUp, type LevelInfo, type Quest } from './sparks';

export interface Progress { total: number; today: number; cap: number; level: LevelInfo; quests: Quest[]; }
const SEEN_KEY = 'ns-level-seen';
const getSeen = (): number | null => { try { const v = localStorage.getItem(SEEN_KEY); return v === null ? null : Number(v); } catch { return null; } };
const setSeen = (n: number) => { try { localStorage.setItem(SEEN_KEY, String(n)); } catch { /* ignore */ } };

export function useProgress(enabled: boolean): { p: Progress | null; up: string | null } {
  const { user } = useAuth();
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
    if (!enabled || !user) return;
    void refresh();
    let t: ReturnType<typeof setTimeout> | undefined;
    const onLogged = () => { if (t) clearTimeout(t); t = setTimeout(() => { void refresh(); }, 6000); };
    window.addEventListener(LOGGED_EVENT, onLogged);
    return () => { window.removeEventListener(LOGGED_EVENT, onLogged); if (t) clearTimeout(t); };
  }, [enabled, user, refresh]);

  return { p: enabled ? p : null, up: enabled ? up : null };
}
