import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DELIGHT_FLAGS, MIN_GAP_MS, WELCOME_AFTER_DAYS, WELCOME_COPY,
  canCelebrate, celebrationFor, daysAway, plateLine, plateSectors, shouldWelcomeBack,
} from '../../lib/delight';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
// Words that would turn a celebration into a judgement about the body, restriction or speed of change.
const BAN = /\b(lose|losing|lost|weight|kg|fat loss|burn|burned|skip|skipped|less|under(?:ate)?|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner)\b/i;

describe('celebration copy', () => {
  it('names the meal and stays warm', () => {
    expect(celebrationFor('lunch', null).title).toBe('Lunch logged');
    expect(celebrationFor('snacks', null).title).toBe('Snack logged');
    expect(celebrationFor(undefined, null).title).toBe('Meal logged');
  });
  it('mentions protein only as encouragement and never when unknown', () => {
    expect(celebrationFor('dinner', 120).line).toContain('covered');
    expect(celebrationFor('dinner', 80).line).toContain('nearly there');
    expect(celebrationFor('dinner', 50).line).toContain('filling in');
    expect(celebrationFor('dinner', 10).line).toBe('Every log helps your picture get clearer.');
    expect(celebrationFor('dinner', null).line).toBe('Every log helps your picture get clearer.');
    expect(celebrationFor('dinner', Number.NaN).line).toBe('Every log helps your picture get clearer.');
  });
  it('no celebration line ever talks about weight, restriction, streaks or ranking', () => {
    for (const m of ['breakfast', 'lunch', 'dinner', 'snack', undefined]) {
      for (const p of [null, 0, 30, 55, 85, 130]) {
        const c = celebrationFor(m, p);
        expect(BAN.test(c.title + ' ' + c.line)).toBe(false);
      }
    }
  });
});

describe('how often a pop may appear', () => {
  it('blocks when the user turned it off', () => { expect(canCelebrate(1_000_000, null, true)).toBe(false); });
  it('allows the first one', () => { expect(canCelebrate(1_000_000, null, false)).toBe(true); });
  it('blocks a second one too soon, and allows it after the gap', () => {
    expect(canCelebrate(1_000_000 + MIN_GAP_MS - 1, 1_000_000, false)).toBe(false);
    expect(canCelebrate(1_000_000 + MIN_GAP_MS, 1_000_000, false)).toBe(true);
  });
});

describe('plate', () => {
  const goals = { protein: 100, carbs: 200, fat: 50, water_ml: 2000 };
  it('lists protein first and caps at 100', () => {
    const s = plateSectors({ protein: 150, carbs: 100, fat: 0, water_ml: 1000 }, goals);
    expect(s.map(x => x.key)).toEqual(['protein', 'carbs', 'fat', 'water']);
    expect(s[0].pct).toBe(100);
    expect(s[1].pct).toBe(50);
    expect(s[2].pct).toBe(0);
    expect(s[3].pct).toBe(50);
  });
  it('treats a missing goal as zero, not a crash', () => {
    const s = plateSectors({ protein: 10, carbs: 10, fat: 10, water_ml: 10 }, { protein: 0, carbs: 0, fat: 0, water_ml: 0 });
    expect(s.every(x => x.pct === 0)).toBe(true);
    const bad = plateSectors({ protein: Number.NaN, carbs: -5, fat: 1, water_ml: 1 }, goals);
    expect(bad[0].pct).toBe(0);
    expect(bad[1].pct).toBe(0);
  });
  it('the sentence invites the first log, then looks only at protein and water', () => {
    const none = plateSectors({ protein: 0, carbs: 0, fat: 0, water_ml: 0 }, goals);
    expect(plateLine(none, 9, 0)).toContain('first meal');
    const low = plateSectors({ protein: 20, carbs: 300, fat: 90, water_ml: 1800 }, goals);
    expect(plateLine(low, 14, 2)).toContain('Protein is at 20%');
    const waterLow = plateSectors({ protein: 80, carbs: 1, fat: 1, water_ml: 400 }, goals);
    expect(plateLine(waterLow, 16, 3)).toContain('Water is at 20%');
    const done = plateSectors({ protein: 100, carbs: 1, fat: 1, water_ml: 1 }, goals);
    expect(plateLine(done, 20, 3)).toBe('Protein is covered for today.');
  });
  it('the sentence never judges calories, carbs or fat', () => {
    const heavy = plateSectors({ protein: 80, carbs: 900, fat: 400, water_ml: 1500 }, goals);
    for (const h of [8, 13, 18, 22]) expect(BAN.test(plateLine(heavy, h, 3))).toBe(false);
    expect(plateLine(heavy, 13, 3)).toBe('Looking steady so far.');
  });
});

describe('welcome back', () => {
  it('counts whole days and rejects bad input', () => {
    expect(daysAway('2026-11-01', '2026-11-05')).toBe(4);
    expect(daysAway('2026-11-05', '2026-11-05')).toBe(0);
    expect(daysAway(null, '2026-11-05')).toBe(null);
    expect(daysAway('nope', '2026-11-05')).toBe(null);
    expect(daysAway('2026-11-09', '2026-11-05')).toBe(null);
  });
  it('shows only after a real gap, on an empty day, once per day', () => {
    expect(WELCOME_AFTER_DAYS).toBe(3);
    expect(shouldWelcomeBack(2, false, false)).toBe(false);
    expect(shouldWelcomeBack(3, false, false)).toBe(true);
    expect(shouldWelcomeBack(10, true, false)).toBe(false);
    expect(shouldWelcomeBack(10, false, true)).toBe(false);
    expect(shouldWelcomeBack(null, false, false)).toBe(false);
  });
  it('the copy is kind: no streaks, no loss, no points that do not exist yet', () => {
    const all = [WELCOME_COPY.title, WELCOME_COPY.body, ...WELCOME_COPY.actions.map(a => a.label)].join(' ');
    expect(BAN.test(all)).toBe(false);
    expect(/sparks|points|level/i.test(all)).toBe(false);
  });
});

describe('wiring', () => {
  it('has exactly three switches, and the migration creates them switched OFF', () => {
    expect(DELIGHT_FLAGS).toHaveLength(3);
    const m = readdirSync(join(process.cwd(), 'supabase/migrations')).find(f => f.startsWith('046_'));
    expect(m).toBeTruthy();
    const sql = read('supabase/migrations/' + m);
    for (const f of DELIGHT_FLAGS) expect(sql).toMatch(new RegExp(`'${f}',\\s*FALSE`));
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(/DROP|DELETE|ALTER\s+TABLE/i.test(sql)).toBe(false);
  });
  it('logging announces a saved meal, but not an edit, and never blocks logging', () => {
    const s = read('src/components/DashboardLogging.tsx');
    expect(s).toContain("announceLogged");
    expect(s).toContain('if (!editEntry) announceLogged(entryData.meal);');
    expect(read('src/lib/delight.ts')).toMatch(/announceLogged[\s\S]*catch \{ \/\* never block logging \*\/ \}/);
  });
  it('the shell mounts the celebration host once, and the Today tab uses the other two cards', () => {
    expect(read('src/pages/AppShell.tsx')).toContain('<CelebrationHost />');
    const t = read('src/pages/tabs/TodayTab.tsx');
    expect(t).toContain("useFlag('ui_plate')");
    expect(t).toContain("useFlag('ui_welcome_back')");
    expect(t).toContain('<PlateCard');
    expect(t).toContain('<WelcomeBackCard />');
  });
  it('the pop respects the flag, reduced motion and the off switch', () => {
    const c = read('src/components/delight/CelebrationHost.tsx');
    expect(c).toContain("useFlag('ui_celebrations')");
    expect(c).toContain('prefersReducedMotion()');
    expect(c).toContain('role="status"');
    expect(c).toContain('Not for me, turn these off');
  });
  it('no network or database writes in the new files', () => {
    for (const f of ['src/lib/delight.ts', 'src/components/delight/CelebrationHost.tsx', 'src/components/delight/PlateCard.tsx', 'src/components/delight/WelcomeBackCard.tsx']) {
      const s = read(f);
      expect(/fetch\(|supabase\.|\.put\(|\.add\(|\.delete\(|\.update\(/.test(s)).toBe(false);
    }
  });
});
