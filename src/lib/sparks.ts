/**
 * sparks.ts — the rules behind Sparks (points), levels and daily quests. Pure: no network, no database, no AI.
 * Rules that must not change:
 *   - Sparks come from DOING things (logging a meal, drinking water), never from eating less, skipping, weight or speed.
 *   - A missed day costs nothing: nothing is ever taken away, and there is no streak.
 *   - Nothing compares one person with another.
 *   - A hard daily cap keeps it calm. The server decides every award from the person's real logs.
 */
export const POINTS_NAME = 'Sparks';
export const DAILY_CAP = 30;
export const POINTS = { meal: 5, water: 5, quest_all: 5 } as const;
export const WATER_GLASSES_FOR_SPARK = 4;
export const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;

export type AwardKind = 'meal' | 'water' | 'quest_all';
export interface Facts { meals: string[]; glasses: number; }
export interface Award { kind: AwardKind; ref: string; points: number; }
export interface Existing { kind: string; ref: string; points: number; }
export interface Quest { id: string; label: string; done: boolean; }

export function quests(f: Facts): Quest[] {
  const distinct = new Set(f.meals.filter(m => (MEALS as readonly string[]).includes(m))).size;
  return [
    { id: 'two_meals', label: 'Log two meals', done: distinct >= 2 },
    { id: 'water', label: `Drink ${WATER_GLASSES_FOR_SPARK} glasses of water`, done: Number.isFinite(f.glasses) && f.glasses >= WATER_GLASSES_FOR_SPARK },
  ];
}

/** What is still owed for today. Already-given awards are skipped, and the daily cap is never passed. */
export function planAwards(f: Facts, existing: Existing[]): Award[] {
  const have = new Set(existing.map(e => `${e.kind}:${e.ref}`));
  let used = existing.reduce((s, e) => s + (Number.isFinite(e.points) ? e.points : 0), 0);
  const want: Award[] = [];
  for (const m of MEALS) if (f.meals.includes(m)) want.push({ kind: 'meal', ref: m, points: POINTS.meal });
  if (Number.isFinite(f.glasses) && f.glasses >= WATER_GLASSES_FOR_SPARK) want.push({ kind: 'water', ref: '', points: POINTS.water });
  if (quests(f).every(q => q.done)) want.push({ kind: 'quest_all', ref: '', points: POINTS.quest_all });
  const out: Award[] = [];
  for (const a of want) {
    if (have.has(`${a.kind}:${a.ref}`)) continue;
    if (used + a.points > DAILY_CAP) continue;
    used += a.points; out.push(a);
  }
  return out;
}

export interface Level { n: number; name: string; from: number; }
export const LEVELS: Level[] = [
  { n: 1, name: 'Beginner', from: 0 },
  { n: 2, name: 'Food Explorer', from: 50 },
  { n: 3, name: 'Kitchen Detective', from: 150 },
  { n: 4, name: 'Nutrition Navigator', from: 320 },
  { n: 5, name: 'Habit Master', from: 600 },
  { n: 6, name: 'Nutrition Pro', from: 1000 },
];

export interface LevelInfo { n: number; name: string; pct: number; toNext: number | null; nextName: string | null; }
export function levelFor(total: number): LevelInfo {
  const t = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  let i = 0;
  for (let k = 0; k < LEVELS.length; k++) if (t >= LEVELS[k].from) i = k;
  const cur = LEVELS[i], next = LEVELS[i + 1];
  if (!next) return { n: cur.n, name: cur.name, pct: 100, toNext: null, nextName: null };
  const span = next.from - cur.from;
  return { n: cur.n, name: cur.name, pct: Math.max(0, Math.min(100, Math.round(((t - cur.from) / span) * 100))), toNext: next.from - t, nextName: next.name };
}

/** Show the level-up message once: not on a first visit (nothing seen yet) and never for a lower level. */
export function shouldShowLevelUp(seen: number | null, current: number): boolean {
  return seen !== null && current > seen;
}
export function levelUpLine(name: string): string { return `You reached ${name} 🎉`; }

export const SPARKS_NOTE = 'Sparks come from logging and learning, not from how much you eat. Nothing is ever taken away.';
