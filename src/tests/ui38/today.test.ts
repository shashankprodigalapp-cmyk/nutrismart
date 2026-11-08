import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|losing|lost|weight|kg|fat loss|burn|burned|skip|skipped|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner|too much)\b/i;

describe('Today follows the design canvas (artboards 03 and 16)', () => {
  const t = read('src/pages/tabs/TodayTab.tsx');
  const h = read('src/components/screens/TodayHero.tsx');
  const m = read('src/components/screens/MoreForToday.tsx');
  const css = read('src/styles/today.css');
  it('has a header with the Sparks pill, the serif greeting and a day-and-time line', () => {
    expect(t).toContain('className="ns-head"');
    expect(t).toContain('data-testid="sparks-pill"');
    expect(t).toContain("tr(lang, 'Hi')");
    expect(css).toContain("'Playfair Display'");
  });
  it('the plate card is deep green with the thali, and the action is one large lime button', () => {
    expect(h).toContain('className="ns-hero"');
    expect(h).toContain('data-testid="today-hero"');
    expect(h).toContain('data-testid="hero-cta"');
    expect(h).toContain('role="img"');
    expect(css).toContain('min-height: 56px');
    expect(css).toContain('#D7F27A');
    expect(css).toContain('--ns-hero: #1F4A3C');
  });
  it('empty sectors are dashed outlines, filled ones are coloured, with a word for each', () => {
    expect(h).toContain("strokeDasharray: '5 4'");
    expect(h).toContain("'khaali'");
  });
  it('the extra cards are rows under "More for today", each row at least 56px high, with the old cards inside', () => {
    expect(m).toContain('data-testid="today-more"');
    expect(m).toContain('data-testid="today-row"');
    expect(css).toContain('min-height: 56px');
    for (const c of ['<DailyIntelligence />', '<DailyCheckInCard />', '<FlexibleMealCard />']) expect(t).toContain(c);
    expect(t).toContain("to: '/app/weekly-review'");
    expect(t).toContain("to: '/app/energy-mood'");
    expect(t).toContain("to: '/app/journey'");
  });
  it('the numbers stay one tap away, with the same labels the tests and people look for', () => {
    expect(t).toContain('Calories today');
    expect(t).toContain('Meals logged');
    expect(t).toContain("tr(lang, \"Today's numbers\")");
  });
  it('the rows can be kept open (used by the browser tests)', () => {
    expect(m).toContain("'ns-today-expanded'");
  });
  it('no new wording judges eating, weight or other people', () => {
    expect(BAN.test(h)).toBe(false);
    expect(BAN.test(m)).toBe(false);
  });
  it('the progress hook only reads, ', () => {
    const p = read('src/lib/useProgress.ts');
    expect(p).toContain("'/api/progress', {}");
    expect(/method:\s*'PUT'|\.upsert\(|\.insert\(/.test(p)).toBe(false);
  });
});
