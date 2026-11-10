import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|losing|weight|kg|burn|skip|skipped|less|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner|avoid)\b/i;
describe('Moments restyle', () => {
  const cel = read('src/components/delight/CelebrationHost.tsx');
  const wb = read('src/components/delight/WelcomeBackCard.tsx');
  const up = read('src/components/sparks/LevelUpCard.tsx');
  const today = read('src/pages/tabs/TodayTab.tsx');
  it('the celebration keeps its switch, test id, reduced-motion rule and off button', () => {
    expect(cel).toContain("useFlag('ui_celebrations')");
    expect(cel).toContain('data-testid="celebration"');
    expect(cel).toContain('prefersReducedMotion()');
    expect(cel).toContain('Not for me, turn these off');
    expect(cel).toContain('pointer-events-none');
    expect(cel).not.toMatch(/#1C1C1E|#8E8E93|#EBEBF5/);
    expect(cel).toContain('nm-card');
  });
  it('welcome back keeps its test id and dismiss, and uses the design look', () => {
    expect(wb).toContain('data-testid="welcome-back"');
    expect(wb).toContain('dismissWelcomeFor(today)');
    expect(wb).toContain('nm-welcome');
    expect(wb).not.toMatch(/#1C1C1E|#2C2C2E|#C8F75E/);
  });
  it('level up is a card on Today, not a full screen, and it links to the journey', () => {
    expect(up).toContain('data-testid="level-up"');
    expect(up).toContain('/app/journey');
    expect(up).not.toMatch(/fixed|inset-0|position:\s*fixed/);
    expect(BAN.test(up.replace(/skip/gi, ''))).toBe(false);
    expect(today).toContain('<LevelUpCard');
    expect(today).toContain("import { LevelUpCard }");
    expect(today).not.toContain('className="ns-note">{prog.up}');
  });
  it('the css never hides anything and no layer covers the screen', () => {
    const css = read('src/styles/moments.css');
    expect(css).not.toMatch(/display\s*:\s*none|position\s*:\s*fixed/);
    expect(css).toContain('.nm-btn { display: flex; align-items: center; min-height: 54px');
  });
});
