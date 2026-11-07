/**
 * delight.ts — the small, pure rules behind the celebration, plate and welcome-back features.
 * No network, no database. Everything here is deterministic so it can be tested.
 * Rules that must never change:
 *   - Celebrate actions (logging, learning), never restraint, weight or speed of weight change.
 *   - Nothing here compares one user with another.
 *   - Missing days has no cost: the welcome-back message never mentions streaks or loss.
 */

export const DELIGHT_FLAGS = ['ui_celebrations', 'ui_plate', 'ui_welcome_back'] as const;
export type DelightFlag = (typeof DELIGHT_FLAGS)[number];

export const LOGGED_EVENT = 'nutrismart:logged';
const OFF_KEY = 'ns-celebrations-off';
const HIDE_CAL_KEY = 'ns-hide-calories';
const DISMISS_KEY = 'ns-welcome-dismissed';

/** At most one pop in this many milliseconds, so heavy loggers are not buried in confetti. */
export const MIN_GAP_MS = 8000;

export type MealName = string;

export interface Celebration { emoji: string; title: string; line: string; }

const MEAL_LABEL: Record<string, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', snacks: 'Snack',
};

function mealLabel(meal: MealName | undefined): string {
  const k = String(meal ?? '').trim().toLowerCase();
  return MEAL_LABEL[k] ?? 'Meal';
}

/** What to say after a meal is logged. proteinPct is 0 to 100 or null when unknown. */
export function celebrationFor(meal: MealName | undefined, proteinPct: number | null): Celebration {
  const label = mealLabel(meal);
  let line = 'Every log helps your picture get clearer.';
  if (proteinPct !== null && Number.isFinite(proteinPct)) {
    if (proteinPct >= 100) line = 'Your protein goal for today is covered 💪';
    else if (proteinPct >= 70) line = 'Your protein is nearly there for today 💪';
    else if (proteinPct >= 40) line = 'Your plate is filling in nicely.';
  }
  return { emoji: '🎉', title: `${label} logged`, line };
}

/** True when a pop is allowed: not turned off by the user, and not too soon after the last one. */
export function canCelebrate(now: number, lastAt: number | null, off: boolean): boolean {
  if (off) return false;
  if (lastAt !== null && now - lastAt < MIN_GAP_MS) return false;
  return true;
}

export interface PlateSector { key: 'protein' | 'carbs' | 'fat' | 'water'; label: string; pct: number; }

function pct(v: number, goal: number): number {
  if (!Number.isFinite(v) || !Number.isFinite(goal) || goal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((v / goal) * 100)));
}

/**
 * Today's plate, from totals and the user's own goals. Protein is listed first on purpose.
 * Carbs and fat use goals only when the app has them; otherwise pass 0 and they show as 0.
 */
export function plateSectors(
  t: { protein: number; carbs: number; fat: number; water_ml: number },
  g: { protein: number; carbs: number; fat: number; water_ml: number },
): PlateSector[] {
  return [
    { key: 'protein', label: 'Protein', pct: pct(t.protein, g.protein) },
    { key: 'carbs', label: 'Carbs', pct: pct(t.carbs, g.carbs) },
    { key: 'fat', label: 'Fat', pct: pct(t.fat, g.fat) },
    { key: 'water', label: 'Water', pct: pct(t.water_ml, g.water_ml) },
  ];
}

/** One calm sentence about the plate. Never praises or blames calories; looks only at protein and water. */
export function plateLine(sectors: PlateSector[], hourIST: number, meals: number): string {
  const protein = sectors.find(s => s.key === 'protein')?.pct ?? 0;
  const water = sectors.find(s => s.key === 'water')?.pct ?? 0;
  if (meals === 0) return 'Log your first meal and your plate starts to fill in.';
  if (protein >= 100) return 'Protein is covered for today.';
  if (hourIST >= 12 && protein < 60) return `Protein is at ${protein}%. Dal, eggs, curd or paneer would help.`;
  if (hourIST >= 15 && water < 40) return `Water is at ${water}%. A glass now would help.`;
  return 'Looking steady so far.';
}

/** Whole days since the last logged day, or null when there is nothing to compare. */
export function daysAway(lastLogDate: string | null, todayDate: string): number | null {
  if (!lastLogDate || !/^\d{4}-\d{2}-\d{2}$/.test(lastLogDate) || !/^\d{4}-\d{2}-\d{2}$/.test(todayDate)) return null;
  const a = Date.parse(lastLogDate + 'T00:00:00Z');
  const b = Date.parse(todayDate + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86400000);
}

/** The welcome-back card shows after a gap of this many days or more, and only on a day with nothing logged yet. */
export const WELCOME_AFTER_DAYS = 3;

export function shouldWelcomeBack(gap: number | null, loggedToday: boolean, dismissedToday: boolean): boolean {
  if (gap === null || loggedToday || dismissedToday) return false;
  return gap >= WELCOME_AFTER_DAYS;
}

export const WELCOME_COPY = {
  title: 'Good to see you 👋',
  body: 'It has been a few days, and that is completely fine. Everything you set up is still here.',
  actions: [
    { label: '☕ Just log today\'s chai', to: '/app/log' },
    { label: '🍛 Add yesterday\'s dinner', to: '/app/log' },
  ],
} as const;

/* ---- Small preference helpers. Every read and write is guarded: private windows can throw. ---- */

function getLs(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function setLs(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ } }

export function celebrationsOff(): boolean { return getLs(OFF_KEY) === '1'; }
export function setCelebrationsOff(off: boolean) { setLs(OFF_KEY, off ? '1' : null); }
export function caloriesHidden(): boolean { return getLs(HIDE_CAL_KEY) === '1'; }
export function setCaloriesHidden(hide: boolean) { setLs(HIDE_CAL_KEY, hide ? '1' : null); }
export function welcomeDismissedFor(todayDate: string): boolean { return getLs(DISMISS_KEY) === todayDate; }
export function dismissWelcomeFor(todayDate: string) { setLs(DISMISS_KEY, todayDate); }

export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

/** Tell the app a meal was just logged. Safe to call anywhere; nothing happens unless the feature switch is on. */
export function announceLogged(meal: MealName | undefined): void {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(LOGGED_EVENT, { detail: { meal: meal ?? null } }));
  } catch { /* never block logging */ }
}
