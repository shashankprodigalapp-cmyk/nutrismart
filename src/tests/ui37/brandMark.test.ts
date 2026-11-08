import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('logo, wordmark and tab bar follow the design canvas', () => {
  it('the logo is the katori bowl with the gold spark, and the wordmark has the gold IQ pill', () => {
    const b = read('src/components/brand/BrandMark.tsx');
    expect(b).toContain('M32 3 L35.2 11.8 L44 15 L35.2 18.2 L32 27 L28.8 18.2 L20 15 L28.8 11.8 Z');
    expect(b).toContain('M9 31 H55 C55 45 45 56 32 56 C19 56 9 45 9 31 Z');
    expect(b).toContain('font-serif');
    expect(b).toContain('>IQ<');
    expect(b).toContain('#D6A96B');
  });
  it('the sidebar uses the brand mark', () => {
    const a = read('src/pages/AppShell.tsx');
    expect(a).toContain('<BrandMark />');
    expect(a).not.toContain('>NutriSmart IQ</span>');
  });
  it('tab icons are the design set: sun, plus circle, bars, person', () => {
    const n = read('src/components/screens/NavIcon.tsx');
    expect(n).toContain('M12 3v2M12 19v2M3 12h2M19 12h2');
    expect(n).toContain('M12 8v8M8 12h8');
    expect(n).toContain('M4 19V9M10 19V5M16 19v-7M21 19H3');
    expect(n).toContain('M4 21c0-4 4-6 8-6s8 2 8 6');
  });
  it('tab labels are 12px sentence case with the open tab bold, and the bar is taller', () => {
    const a = read('src/pages/AppShell.tsx');
    expect(a).toContain('min-h-[64px]');
    expect(a).toContain('text-xs font-medium [.active_&]:font-bold');
    expect(a).not.toContain('uppercase tracking-[0.5px]');
  });
});
