import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { weekDots, daysLogged, weekLine } from '../../lib/weekDots';
import { hiWeekLine, hiLevelGap, hiLevelOf, hiQuestsDone, tr } from '../../lib/copyHi';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|losing|weight|kg|burn|skip|skipped|less|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner|avoid)\b/i;

describe('This week dots', () => {
  it('runs Monday to Sunday and marks today', () => {
    const d = weekDots('2026-11-11', ['2026-11-09', '2026-11-11']); // Wednesday
    expect(d.map(x => x.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    expect(d.map(x => x.state)).toEqual(['done', 'empty', 'today_done', 'future', 'future', 'future', 'future']);
    expect(d[2].label).toBe('Today');
    expect(daysLogged(d)).toBe(2);
  });
  it('Monday and Sunday edges stay inside one week', () => {
    expect(weekDots('2026-11-09', [])[0].state).toBe('today');
    const s = weekDots('2026-11-15', ['2026-11-10']);
    expect(s[6].state).toBe('today');
    expect(s[1].state).toBe('done');
    expect(s[0].date).toBe('2026-11-09');
  });
  it('bad input gives no dots and does not throw', () => { expect(weekDots('nope', [])).toEqual([]); });
  it('a missed day is only empty: no streak, no loss, no blame, in both languages', () => {
    for (const n of [0, 1, 4, 7]) { expect(BAN.test(weekLine(n))).toBe(false); expect(BAN.test(hiWeekLine(n))).toBe(false); }
    expect(weekLine(4)).toContain('Nothing resets');
    expect(weekLine(1)).toContain('1 day logged');
  });
});

describe('Journey Hinglish', () => {
  it('has the new words and number lines', () => {
    expect(tr('hi', 'This week')).toBe('Is hafta');
    expect(tr('hi', 'Mon')).toBe('Som');
    expect(hiLevelOf(2, 6)).toBe('Level 2 / 6');
    expect(hiLevelGap(260, 'Kitchen Detective')).toBe('Kitchen Detective tak 260 Sparks');
    expect(hiQuestsDone(1, 2)).toBe('2 mein se 1 ho gaye');
  });
});

describe('Journey screen', () => {
  const p = read('src/pages/JourneyPage.tsx');
  it('shows the level card, quests, week, and keeps the older cards and their test ids', () => {
    for (const id of ['journey-level-card', 'journey-quests', 'journey-week', 'journey-levels', 'journey-explorer', 'journey-detective']) expect(p).toContain(`data-testid="${id}"`);
    expect(p).toContain("import '../styles/journey.css'");
  });
  it('writes nothing and makes no new network call', () => {
    expect(/supabase\.|\.put\(|\.add\(|\.update\(|\.delete\(|fetch\(/.test(p)).toBe(false);
    expect((p.match(/coachApi</g) ?? []).length).toBe(1);
  });
  it('the level card never mentions lessons that are switched off', () => {
    expect(p).not.toMatch(/needs \d+ Kitchen Detective/);
  });
});
