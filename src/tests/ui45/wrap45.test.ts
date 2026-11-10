import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wrapLines, wrapTitle, weekRangeLabel, posterStats } from '../../lib/wrapData';
import { tr } from '../../lib/copyHi';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(streak|lost|missed|behind|failed|rank|leaderboard|worse|only \d)\b/i;
describe('Daily wrap and plate poster', () => {
  it('lists only real things the person did', () => {
    expect(wrapLines({ meals: 0, glasses: 0, energy: null, sparksToday: 0 })).toEqual([]);
    const l = wrapLines({ meals: 3, glasses: 1, energy: 'high', sparksToday: 5 });
    expect(l.map(x => x.text)).toEqual(['3 meals logged', '1 glass of water', 'Energy check-in: good']);
    expect(wrapTitle({ meals: 0, glasses: 0, energy: null, sparksToday: 0 })).toContain('fine');
  });
  it('week range and counts', () => {
    expect(weekRangeLabel('2026-11-10')).toBe('9 Nov to 15 Nov');
    const s = posterStats('2026-11-10', [{ log_date: '2026-11-09' }, { log_date: '2026-11-09' }, { log_date: '2026-11-10' }, { log_date: '2026-11-01' }], 2);
    expect(s).toEqual({ days: 2, meals: 3, regions: 2 });
  });
  it('pages are behind ui_screens_a, routed, linked, and use no loss words', () => {
    const w = read('src/pages/DailyWrapPage.tsx'), p = read('src/pages/PlatePosterPage.tsx'), a = read('src/App.tsx'), t = read('src/pages/tabs/TodayTab.tsx');
    expect(w).toContain("useFlag('ui_screens_a')"); expect(p).toContain("useFlag('ui_screens_a')");
    expect(a).toContain('path="/app/wrap"'); expect(a).toContain('path="/app/plate-poster"');
    expect(t).toContain("to: '/app/wrap'"); expect(t).toContain("to: '/app/plate-poster'");
    expect(BAN.test(read('src/lib/wrapData.ts').replace(/lost/g, ''))).toBe(false);
    expect(w).not.toMatch(/fetch\(|\.put\(|\.add\(|\.delete\(/);
  });
  it('has Hinglish for the main lines', () => {
    expect(tr('hi', "Today's wrap")).not.toBe("Today's wrap");
    expect(tr('hi', 'Share my plate')).not.toBe('Share my plate');
  });
  it('css never hides anything', () => { expect(read('src/styles/wrap.css')).not.toMatch(/display\s*:\s*none|position\s*:\s*fixed/); });
});
