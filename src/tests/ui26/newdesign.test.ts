import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { OLD_THEME_COLOR, THEME_COLOR, parseAppearance, resolveTheme } from '../../lib/theme';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const css = read('src/styles/newdesign.css');

function lum(h: string) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function tokens(theme: 'light' | 'dark') {
  const m = css.match(new RegExp(`html\\[data-ui="new"\\]\\[data-theme="${theme}"\\] \\{([^}]*)\\}`));
  expect(m).toBeTruthy();
  const out: Record<string, string> = {};
  for (const t of m![1].matchAll(/--n-([a-z0-9]+):\s*(#[0-9A-Fa-f]{6})/g)) out[t[1]] = t[2];
  return out;
}

describe('appearance rules', () => {
  it('parses anything unknown as "same as phone"', () => {
    expect(parseAppearance('light')).toBe('light');
    expect(parseAppearance('dark')).toBe('dark');
    expect(parseAppearance('system')).toBe('system');
    expect(parseAppearance(null)).toBe('system');
    expect(parseAppearance('purple')).toBe('system');
  });
  it('resolves the choice', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('address-bar colours match the page colours', () => {
    expect(THEME_COLOR.light).toBe(tokens('light').bg.toUpperCase());
    expect(THEME_COLOR.dark).toBe(tokens('dark').bg.toUpperCase());
    expect(OLD_THEME_COLOR).toBe('#111113');
  });
});

describe('colour contrast (both themes)', () => {
  const TEXT = ['t1', 't2', 't3', 't4', 'accent', 'red', 'amber', 'green', 'lav', 'sky', 'pink', 'blue', 'gold', 'yellow'];
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every text colour reads on page, card and card2 (4.5:1)`, () => {
      const t = tokens(theme);
      for (const k of TEXT) for (const bg of ['bg', 'card', 'card2', 'card3']) {
        expect(ratio(t[k], t[bg]), `${theme} ${k} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
  it('dark text on the lime button reads (light and dark)', () => {
    for (const theme of ['light', 'dark'] as const) expect(ratio('#183C32', tokens(theme).lime)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('stylesheet is fenced', () => {
  it('every rule starts with the new-look attribute, so switch off = old look', () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors = stripped.split('}').map(b => b.split('{')[0].trim()).filter(Boolean);
    for (const sel of selectors) for (const part of sel.split(/,\s*(?=html\[)/)) expect(part.trim().startsWith('html[data-ui="new"]'), part).toBe(true);
  });
  it('white text stays white on solid colour buttons, lime buttons keep dark text', () => {
    expect(css).toMatch(/bg-\\\[\\#FF5D5D\\\]\.text-white/);
    expect(css).toMatch(/bg-\\\[\\#C8F75E\\\] \{ color: #183C32/);
  });
});

describe('wiring', () => {
  it('migration adds one switch, OFF, additive only', () => {
    const f = readdirSync(join(process.cwd(), 'supabase/migrations')).find(n => n.startsWith('047_'))!;
    const sql = read('supabase/migrations/' + f);
    expect(sql).toMatch(/'ui_new_design',\s*FALSE/);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(/DROP|DELETE|ALTER\s+TABLE/i.test(sql)).toBe(false);
  });
  it('shell mounts the host; Profile shows the card above Sign out', () => {
    expect(read('src/pages/AppShell.tsx')).toContain('<ThemeHost />');
    const p = read('src/pages/tabs/ProfileTab.tsx');
    expect(p).toContain('<AppearanceCard />');
    expect(p.indexOf('<AppearanceCard />')).toBeLessThan(p.indexOf('{/* Sign out */}'));
  });
  it('the card and host are gated by the switch and never touch the network', () => {
    expect(read('src/components/theme/AppearanceCard.tsx')).toContain('useFlag(NEW_DESIGN_FLAG)');
    expect(read('src/components/theme/ThemeHost.tsx')).toContain('useFlag(NEW_DESIGN_FLAG)');
    for (const f of ['src/lib/theme.ts', 'src/components/theme/ThemeHost.tsx', 'src/components/theme/AppearanceCard.tsx'])
      expect(/fetch\(|supabase\.|\.put\(|\.add\(/.test(read(f))).toBe(false);
  });
  it('the radio buttons are reachable (44px) and labelled', () => {
    const c = read('src/components/theme/AppearanceCard.tsx');
    expect(c).toContain('min-h-[44px]'); expect(c).toContain('role="radiogroup"'); expect(c).toContain('aria-checked');
  });
});

describe('colours that carry an opacity or are set in code (found in a live check)', () => {
  it('opacity variants like text-[#EBEBF5]/70 are re-pointed, so they cannot vanish on ivory', () => {
    expect(css).toContain('[class*="text-[#EBEBF5]/"]');
    expect(css).toContain('[class*="text-[#8E8E93]/"]');
  });
  it('colours set inline (macro numbers) are re-pointed with !important', () => {
    expect(css).toContain('[style^="color: rgb(48, 209, 88)"]');
    expect(css).toMatch(/\[style\^="color: rgb\(99, 99, 102\)"\][^}]*!important/);
  });
});

describe('drawings with fixed colours (calorie ring, charts)', () => {
  it('SVG strokes and fills follow the theme', () => {
    expect(css).toContain('[stroke="#2C2C2E"] { stroke: var(--n-card3); }');
    expect(css).toContain('[fill="#8E8E93"] { fill: var(--n-t3); }');
  });
});

describe('fixes from the live phone-width check', () => {
  it('translucent backgrounds (bottom bar) follow the theme', () => {
    expect(css).toContain('[class*="bg-[#111113]/"]');
    expect(css).toContain('color-mix(in srgb, var(--n-bg) 95%, transparent)');
  });
  it('small buttons are at least 44px tall or wide', () => {
    const d = read('src/components/DashboardLogging.tsx');
    expect(d).toContain('w-11 h-11 rounded-full bg-[#2C2C2E] text-[#7DD3FC]');
    expect(d).toContain('w-11 h-11 rounded-full bg-[#7DD3FC]/20');
    expect(d).toContain('flex items-center gap-3 flex-1 min-w-0 min-h-[44px] text-left');
    expect(read('src/components/ProfileCompletion.tsx')).toContain('min-w-[44px] min-h-[44px]');
    expect(read('src/components/FlexibleMealCard.tsx')).toContain('min-h-[44px]">Plan one');
  });
});
