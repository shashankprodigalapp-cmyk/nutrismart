import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { plateSectors } from '../../lib/delight';
import { nextAction } from '../../lib/todayAction';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|losing|lost|weight|kg|fat loss|burn|burned|skip|skipped|less|under(?:ate)?|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner|too much|over)\b/i;
const goals = { protein: 100, carbs: 200, fat: 50, water_ml: 2000 };
const S = (p: number, c: number, f: number, w: number) => plateSectors({ protein: p, carbs: c, fat: f, water_ml: w }, goals);

describe('next step rules', () => {
  it('first meal when nothing is logged', () => { expect(nextAction(S(0, 0, 0, 0), 9, 0).id).toBe('first-meal'); });
  it('protein nudge only after 2 pm and under 40%', () => {
    expect(nextAction(S(20, 50, 10, 2000), 15, 2).id).toBe('protein');
    expect(nextAction(S(20, 50, 10, 2000), 13, 2).id).not.toBe('protein');
    expect(nextAction(S(60, 50, 10, 2000), 15, 2).id).not.toBe('protein');
  });
  it('water nudge only after 11 am and under 40%', () => {
    expect(nextAction(S(60, 50, 10, 400), 12, 2).id).toBe('water');
    expect(nextAction(S(60, 50, 10, 400), 9, 2).id).not.toBe('water');
  });
  it('celebrates covered protein, otherwise steady', () => {
    expect(nextAction(S(100, 50, 10, 2000), 20, 3).id).toBe('protein-done');
    expect(nextAction(S(60, 50, 10, 2000), 20, 3).id).toBe('steady');
  });
  it('never judges calories, carbs or fat, and no banned wording in any outcome', () => {
    for (const p of [0, 20, 60, 100]) for (const w of [0, 400, 2000]) for (const h of [8, 12, 15, 21]) for (const m of [0, 2]) {
      const a = nextAction(S(p, 900, 400, w), h, m);
      expect(BAN.test(a.title + ' ' + a.body + ' ' + a.cta)).toBe(false);
      expect(/^\/app\/(log|insights)$/.test(a.to)).toBe(true);
    }
  });
});

describe('wiring', () => {
  it('migration adds one switch, OFF, additive only', () => {
    const f = readdirSync(join(process.cwd(), 'supabase/migrations')).find(n => n.startsWith('048_'))!;
    const sql = read('supabase/migrations/' + f);
    expect(sql).toMatch(/'ui_screens_a',\s*FALSE/);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(/DROP|DELETE|ALTER\s+TABLE/i.test(sql)).toBe(false);
  });
  it('Today shows the hero behind the switch and hides the duplicate plate card', () => {
    const t = read('src/pages/tabs/TodayTab.tsx');
    expect(t).toContain("useFlag('ui_screens_a')");
    expect(t).toContain('<TodayHero');
    expect(t).toContain('{plateOn && !heroOn && (');
  });
  it('the shell swaps emoji for line icons only when the switch is on', () => {
    const s = read('src/pages/AppShell.tsx');
    expect(s).toContain("useFlag('ui_screens_a')");
    expect((s.match(/iconsOn \? <NavIcon/g) ?? []).length).toBe(2);
  });
  it('the hero never touches the network and the button is large enough', () => {
    const h = read('src/components/screens/TodayHero.tsx');
    expect(/fetch\(|supabase\.|\.put\(|\.add\(/.test(h)).toBe(false);
    expect(h).toContain('className="ns-cta"');
    expect(h).toContain('role="img"');
  });
  it('the new look themes the hero drawing too', () => {
    expect(read('src/styles/newdesign.css')).toContain('[data-testid="today-hero"] path[stroke]');
  });
});
