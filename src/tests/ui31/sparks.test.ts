import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DAILY_CAP, LEVELS, POINTS, SPARKS_NOTE, levelFor, levelUpLine, planAwards, quests, shouldShowLevelUp,
} from '../../lib/sparks';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|losing|lost|weight|kg|fat loss|burn|burned|skip|skipped|less|under(?:ate)?|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner|penalty|deduct)/i;

describe('what earns Sparks', () => {
  it('each meal once, water at 4 glasses, bonus when both quests are done', () => {
    const a = planAwards({ meals: ['breakfast', 'lunch'], glasses: 4 }, []);
    expect(a.map(x => x.kind + ':' + x.ref)).toEqual(['meal:breakfast', 'meal:lunch', 'water:', 'quest_all:']);
    expect(a.reduce((s, x) => s + x.points, 0)).toBe(20);
  });
  it('nothing is awarded for nothing', () => {
    expect(planAwards({ meals: [], glasses: 0 }, [])).toEqual([]);
    expect(planAwards({ meals: [], glasses: 3 }, [])).toEqual([]);
  });
  it('never gives the same award twice (refresh or retry is safe)', () => {
    const first = planAwards({ meals: ['lunch'], glasses: 0 }, []);
    const again = planAwards({ meals: ['lunch'], glasses: 0 }, first.map(x => ({ ...x })));
    expect(again).toEqual([]);
    const more = planAwards({ meals: ['lunch', 'dinner'], glasses: 0 }, first.map(x => ({ ...x })));
    expect(more.map(x => x.ref)).toEqual(['dinner']);
  });
  it('the full day is exactly the cap, and the cap can never be passed', () => {
    const full = planAwards({ meals: ['breakfast', 'lunch', 'snack', 'dinner'], glasses: 8 }, []);
    expect(full.reduce((s, x) => s + x.points, 0)).toBe(DAILY_CAP);
    expect(DAILY_CAP).toBe(30);
    expect(planAwards({ meals: ['breakfast', 'lunch', 'snack', 'dinner'], glasses: 8 }, [{ kind: 'meal', ref: 'x', points: 28 }]).length).toBe(0);
    for (const a of full) expect(a.points).toBeGreaterThan(0);
  });
  it('ignores junk input and unknown meals', () => {
    expect(planAwards({ meals: ['brunch', 'midnight'], glasses: Number.NaN }, [])).toEqual([]);
    expect(quests({ meals: ['brunch', 'x'], glasses: 9 }).find(q => q.id === 'two_meals')!.done).toBe(false);
  });
  it('points are small positive numbers only (nothing is ever taken away)', () => {
    for (const v of Object.values(POINTS)) { expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(11); }
  });
});

describe('levels', () => {
  it('six levels, rising, starting at zero', () => {
    expect(LEVELS).toHaveLength(6);
    expect(LEVELS[0].from).toBe(0);
    for (let i = 1; i < LEVELS.length; i++) expect(LEVELS[i].from).toBeGreaterThan(LEVELS[i - 1].from);
    expect(LEVELS.map(l => l.name)).toEqual(['Beginner', 'Food Explorer', 'Kitchen Detective', 'Nutrition Navigator', 'Habit Master', 'Nutrition Pro']);
  });
  it('finds the level and the distance to the next', () => {
    expect(levelFor(0).name).toBe('Beginner');
    expect(levelFor(49).n).toBe(1);
    expect(levelFor(50).name).toBe('Food Explorer');
    expect(levelFor(25).pct).toBe(50);
    expect(levelFor(25).toNext).toBe(25);
    expect(levelFor(25).nextName).toBe('Food Explorer');
    const top = levelFor(5000);
    expect(top.name).toBe('Nutrition Pro'); expect(top.toNext).toBe(null); expect(top.pct).toBe(100);
  });
  it('bad totals are treated as zero', () => {
    expect(levelFor(Number.NaN).n).toBe(1);
    expect(levelFor(-10).n).toBe(1);
  });
  it('level-up shows once, never on a first visit, never downwards', () => {
    expect(shouldShowLevelUp(null, 3)).toBe(false);
    expect(shouldShowLevelUp(1, 2)).toBe(true);
    expect(shouldShowLevelUp(2, 2)).toBe(false);
    expect(shouldShowLevelUp(3, 2)).toBe(false);
  });
});

describe('wording', () => {
  it('no judgement, streak, loss or ranking language anywhere in the visible copy', () => {
    const copy = [SPARKS_NOTE, ...LEVELS.map(l => levelUpLine(l.name)), ...quests({ meals: [], glasses: 0 }).map(q => q.label)].join(' ');
    expect(BAN.test(copy)).toBe(false);
  });
  it('says plainly that nothing is taken away', () => { expect(SPARKS_NOTE).toContain('Nothing is ever taken away'); });
});

describe('server and data safety', () => {
  const fn = read('functions/api/progress.ts');
  it('checks the sign-in, limits the rate, and sits behind the switch', () => {
    expect(fn).toContain('verifyJWT'); expect(fn).toContain('throttle('); expect(fn).toContain("flagOn(env, 'ui_sparks')");
  });
  it('ignores the request body: the app cannot claim points', () => {
    expect(/request\.json\(|request\.text\(|formData\(/.test(fn)).toBe(false);
  });
  it('only reads and writes the caller\'s own rows, from real logs', () => {
    expect((fn.match(/\.eq\('user_id', auth\.userId\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(fn).toContain("from('daily_logs')"); expect(fn).toContain("from('water_logs')");
    expect(fn).toContain("onConflict: 'user_id,day,kind,ref', ignoreDuplicates: true");
  });
  it('no AI and no photo or browser code in the rules or the server', () => {
    for (const s of [fn, read('src/lib/sparks.ts')]) expect(/gemini|claude|openai|fetch\(/i.test(s)).toBe(false);
  });
  const f = readdirSync(join(process.cwd(), 'supabase/migrations')).find(n => n.startsWith('049_'))!;
  const sql = read('supabase/migrations/' + f);
  it('migration: own-read only, no browser write, one award per day/kind/ref, cascade delete, switch OFF', () => {
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect((sql.match(/CREATE POLICY/g) ?? []).length).toBe(1);
    expect(sql).toMatch(/CREATE POLICY sparks_own_read ON public\.sparks_ledger FOR SELECT/);
    expect(/FOR (INSERT|UPDATE|DELETE|ALL)/i.test(sql)).toBe(false);
    expect(sql).toContain('UNIQUE (user_id, day, kind, ref)');
    expect(sql).toContain('REFERENCES public.users(id) ON DELETE CASCADE');
    expect(sql).toMatch(/'ui_sparks',\s*FALSE/);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(/DROP TABLE|DELETE FROM|ALTER TABLE public\.(?!sparks_ledger)/i.test(sql)).toBe(false);
  });
  it('is included in "export my data"', () => { expect(read('functions/api/export-my-data.ts')).toContain("table: 'sparks_ledger'"); });
});

describe('screen wiring', () => {
  it('Today shows the card after the hero; the card is gated, accessible and tells the server nothing', () => {
    expect(read('src/pages/tabs/TodayTab.tsx')).toContain('<SparksCard />');
    const c = read('src/components/sparks/SparksCard.tsx');
    expect(c).toContain("useFlag('ui_sparks')"); expect(c).toContain('role="progressbar"'); expect(c).toContain("coachApi<Progress>('/api/progress', {})");
    expect(c).toContain('role="status"');
  });
  it('the old welcome-back test stays true: no Sparks wording in its copy', () => {
    expect(/sparks/i.test(read('src/lib/delight.ts'))).toBe(false);
  });
});
