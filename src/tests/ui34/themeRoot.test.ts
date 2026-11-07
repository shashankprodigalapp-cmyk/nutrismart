import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hiExplorerLine, hiIdea } from '../../lib/copyHi';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const BAN = /\b(lose|weight|skip|less|fast|streak|rank|avoid|detox)\b/i;

describe('the new look applies on every page, not only inside the app shell', () => {
  it('ThemeHost is mounted once at the app root, inside the sign-in provider, and not in the shell', () => {
    const a = read('src/App.tsx');
    expect(a).toContain('<ThemeHost />');
    expect(a.indexOf('<AuthProvider>')).toBeLessThan(a.indexOf('<ThemeHost />'));
    expect(read('src/pages/AppShell.tsx')).not.toContain('ThemeHost');
  });
});

describe('Hinglish for the Journey page sentences', () => {
  it('explorer line in three cases, with the real numbers', () => {
    expect(hiExplorerLine(0, 8)).toContain('try karein');
    expect(hiExplorerLine(3, 8)).toBe('Aapne 3 / 8 regional kitchens try kiye hain.');
    expect(hiExplorerLine(8, 8)).toContain('saare 8');
    for (const n of [0, 3, 8]) expect(BAN.test(hiExplorerLine(n, 8))).toBe(false);
  });
  it('idea line keeps the kitchen name and the dishes', () => {
    expect(hiIdea('Gujarati', ['dhokla', 'thepla'])).toBe('Mann ho toh: Gujarati — dhokla, thepla.');
  });
  it('the Journey page uses them when Hinglish is chosen', () => {
    const p = read('src/pages/JourneyPage.tsx');
    expect(p).toContain("lang === 'hi' ? hiExplorerLine(tried.length, REGIONS.length) : explorerLine(tried.length)");
    expect(p).toContain("lang === 'hi' ? hiIdea(idea.label, idea.ideas)");
  });
});
