/**
 * todayAction.ts — the ONE next step shown on the Today hero. Pure rules, no AI, no network.
 * Rules that must not change: suggest an action, never restraint; never judge calories, carbs or fat;
 * never mention weight, streaks or other people.
 */
import type { PlateSector } from './delight';

export interface NextAction { id: string; title: string; body: string; cta: string; to: string; n?: number; }

function pctOf(sectors: PlateSector[], key: PlateSector['key']): number {
  return sectors.find(s => s.key === key)?.pct ?? 0;
}

export function nextAction(sectors: PlateSector[], hourIST: number, meals: number): NextAction {
  const protein = pctOf(sectors, 'protein');
  const water = pctOf(sectors, 'water');
  if (meals === 0) {
    return { id: 'first-meal', title: 'Start with one meal', body: 'Log what you ate, even a small one. Your plate fills in from there.', cta: 'Log a meal', to: '/app/log' };
  }
  if (hourIST >= 14 && protein < 40) {
    return { id: 'protein', n: protein, title: 'Add some protein', body: `Protein is at ${protein}%. Dal, paneer, eggs or curd are easy options.`, cta: 'Log a meal', to: '/app/log' };
  }
  if (hourIST >= 11 && water < 40) {
    return { id: 'water', n: water, title: 'Time for a glass of water', body: `Water is at ${water}%. A glass now would help.`, cta: 'Open Log', to: '/app/log' };
  }
  if (protein >= 100) {
    return { id: 'protein-done', title: 'Protein is covered', body: 'Nicely done. See what your week is telling you.', cta: 'See Insights', to: '/app/insights' };
  }
  return { id: 'steady', title: 'Looking steady', body: 'Log your next meal when you have it.', cta: 'Log a meal', to: '/app/log' };
}
