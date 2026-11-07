import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REGIONS, explorerLine, nextIdea, regionsTried } from '../../lib/regions';
import { LESSONS } from '../../content/lessons';
import { HI_COPY, hinglishNext, tr } from '../../lib/copyHi';
import { nextAction } from '../../lib/todayAction';
import { plateSectors } from '../../lib/delight';
import { parseLang } from '../../lib/lang';
import { SPARKS_NOTE } from '../../lib/sparks';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|losing|lost|weight|kg|fat loss|burn|skip|skipped|less|under(?:ate)?|fast|fasting|streak|broke|broken|failed|behind|rank|leaderboard|beat|winner|avoid|cure|treat|diabetes|detox|slimming)\b/i;
const BAN_HI = /(wazan|vajan|motap|dieting|bhookha|upvaas|kam khao|chhod)/i;

describe('Food Explorer', () => {
  it('has eight kitchens with words and ideas', () => {
    expect(REGIONS).toHaveLength(8);
    for (const r of REGIONS) { expect(r.keywords.length).toBeGreaterThan(3); expect(r.ideas.length).toBeGreaterThan(1); }
  });
  it('finds kitchens from logged food names, ignoring case and junk', () => {
    expect(regionsTried(['Masala Dosa', 'Paneer Bhurji', 'Dhokla (steamed)'])).toEqual(['south', 'north', 'gujarati']);
    expect(regionsTried(['Banana', '', 'Whey Protein'])).toEqual([]);
    expect(regionsTried([null as unknown as string, undefined as unknown as string])).toEqual([]);
  });
  it('counts a kitchen once however many dishes match', () => {
    expect(regionsTried(['idli', 'dosa', 'sambar'])).toEqual(['south']);
  });
  it('the line celebrates trying and never scores', () => {
    expect(explorerLine(0)).toContain('Try a dish');
    expect(explorerLine(3)).toBe('You have tried 3 of 8 regional kitchens.');
    expect(explorerLine(8)).toContain('all 8');
    for (const n of [0, 1, 5, 8]) expect(BAN.test(explorerLine(n))).toBe(false);
  });
  it('suggests one untried kitchen as an idea, and nothing when all are tried', () => {
    expect(nextIdea(['south'])!.label).toBe('North Indian');
    expect(nextIdea(REGIONS.map(r => r.key))).toBe(null);
    for (const r of REGIONS) for (const i of r.ideas) expect(BAN.test(i)).toBe(false);
  });
});

describe('Kitchen Detective lessons', () => {
  it('six short lessons with unique ids', () => {
    expect(LESSONS).toHaveLength(6);
    expect(new Set(LESSONS.map(l => l.id)).size).toBe(6);
    for (const l of LESSONS) { expect(l.title.length).toBeGreaterThan(5); expect(l.body.length).toBeLessThan(260); }
  });
  it('no medical claims, restriction or body-judgement words', () => {
    for (const l of LESSONS) expect(BAN.test(l.title + ' ' + l.body), l.id).toBe(false);
  });
  it('the file says they are drafts needing professional review, and the page hides them until the switch is on', () => {
    expect(read('src/content/lessons.ts')).toContain('DRAFTS');
    const p = read('src/pages/JourneyPage.tsx');
    expect(p).toContain("useFlag('ui_detective')");
    expect(p).toContain('{detectiveOn && (');
    expect(p).toContain('being reviewed by a nutrition professional');
  });
});

describe('Hinglish', () => {
  const g = { protein: 100, carbs: 200, fat: 50, water_ml: 2000 };
  const S = (p: number, w: number) => plateSectors({ protein: p, carbs: 10, fat: 10, water_ml: w }, g);
  const cases = [[0, 0, 9, 0], [20, 2000, 15, 2], [60, 400, 12, 2], [100, 2000, 20, 3], [60, 2000, 20, 3]] as const;
  it('every next-step outcome has its own Hinglish, with the same link and numbers', () => {
    const ids = new Set<string>();
    for (const [p, w, h, m] of cases) {
      const en = nextAction(S(p, w), h, m); const hi = hinglishNext(en);
      ids.add(en.id);
      expect(hi.id).toBe(en.id); expect(hi.to).toBe(en.to);
      expect(hi.title).not.toBe(en.title); expect(hi.body).not.toBe(en.body); expect(hi.cta).not.toBe('');
      if (en.n !== undefined) expect(hi.body).toContain(String(en.n) + '%');
      expect(BAN.test(hi.title + ' ' + hi.body)).toBe(false);
      expect(BAN_HI.test(hi.title + ' ' + hi.body)).toBe(false);
    }
    expect(ids.size).toBe(5);
  });
  it('translates the Sparks note and falls back to English for anything unknown', () => {
    expect(tr('hi', SPARKS_NOTE)).not.toBe(SPARKS_NOTE);
    expect(tr('hi', 'Something new')).toBe('Something new');
    expect(tr('en', 'Your Sparks')).toBe('Your Sparks');
  });
  it('no judgement or restriction words in any Hinglish line', () => {
    for (const v of Object.values(HI_COPY)) { expect(BAN.test(v), v).toBe(false); expect(BAN_HI.test(v), v).toBe(false); }
  });
  it('unknown saved language means English', () => { expect(parseLang('hi')).toBe('hi'); expect(parseLang('fr')).toBe('en'); expect(parseLang(null)).toBe('en'); });
});

describe('wiring', () => {
  it('migration adds two switches, both OFF, additive only', () => {
    const f = readdirSync(join(process.cwd(), 'supabase/migrations')).find(n => n.startsWith('050_'))!;
    const sql = read('supabase/migrations/' + f);
    expect(sql).toMatch(/'ui_journey',\s*FALSE/); expect(sql).toMatch(/'ui_detective',\s*FALSE/);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(/DROP|DELETE|ALTER\s+TABLE|CREATE TABLE/i.test(sql)).toBe(false);
  });
  it('the Journey route exists behind sign-in, and the Sparks card links to it only when the switch is on', () => {
    const a = read('src/App.tsx');
    expect(a).toContain("import('./pages/JourneyPage')");
    expect(a).toContain('<Route path="/app/journey" element={<ProtectedRoute><JourneyPage /></ProtectedRoute>} />');
    const c = read('src/components/sparks/SparksCard.tsx');
    expect(c).toContain("useFlag('ui_journey')"); expect(c).toContain('{journeyOn && <Link to="/app/journey"');
  });
  it('the Journey page is gated, has no network call except the progress endpoint, and tap targets are 44px', () => {
    const p = read('src/pages/JourneyPage.tsx');
    expect(p).toContain("useFlag('ui_journey')");
    expect((p.match(/fetch\(/g) ?? []).length).toBe(0);
    expect(p).toContain("coachApi<{ total: number }>('/api/progress', {})");
    expect((p.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it('the hero and the Appearance card follow the language choice', () => {
    expect(read('src/components/screens/TodayHero.tsx')).toContain('hinglishNext(base)');
    expect(read('src/components/theme/AppearanceCard.tsx')).toContain('Language (new screens)');
  });
  it('new files make no database writes', () => {
    for (const f of ['src/lib/regions.ts', 'src/lib/lang.ts', 'src/lib/copyHi.ts', 'src/pages/JourneyPage.tsx'])
      expect(/supabase\.|\.put\(|\.add\(|\.update\(|\.delete\(/.test(read(f)), f).toBe(false);
  });
});
