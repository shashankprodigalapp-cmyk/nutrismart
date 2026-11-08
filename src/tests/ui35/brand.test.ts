import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('the installed app matches the new design', () => {
  it('uses the NutriSmart IQ name and the Ivory / Evergreen colours, not the old black and lime', () => {
    const v = read('vite.config.ts');
    expect(v).toContain("name: 'NutriSmart IQ'");
    expect(v).toContain("short_name: 'NutriSmart'");
    expect(v).toContain("theme_color: '#F5F3ED'");
    expect(v).toContain("background_color: '#183C32'");
    expect(v).not.toContain('#111113');
    const h = read('index.html');
    expect(h).toContain('content="#F5F3ED"');
    expect(h).toContain('<title>NutriSmart IQ');
    expect(h).toContain('apple-mobile-web-app-status-bar-style" content="default"');
  });
  it('the old name is gone from the screens people read', () => {
    for (const f of ['src/pages/AppShell.tsx', 'src/pages/tabs/ProfileTab.tsx', 'src/components/PWAInstallBanner.tsx', 'src/components/InstallHelpModal.tsx', 'src/sw.ts'])
      expect(read(f)).not.toContain('Nutri Smart');
  });
});

describe('Today is calm when the new screens are on', () => {
  const t = read('src/pages/tabs/TodayTab.tsx');
  it('puts the extra cards behind one "More for today" fold', () => {
    expect(t).toContain('data-testid="today-more"');
    expect(t).toContain('More for today');
    expect(t).toContain('<MoreWrap clean={heroOn}>');
  });
  it('turns the three number boxes into one quiet line and drops the tip and emoji', () => {
    expect(t).toContain('data-testid="today-macros"');
    expect(t).toContain('{!heroOn && (<>');
    expect(t).toContain("{heroOn ? '' : ' 👋'}");
  });
  it('the eat-out prompt shows only on Today in the new look', () => {
    const c = read('src/components/ContextualAlerts.tsx');
    expect(c).toContain('useInRouterContext');
    expect(c).toContain("!loc.pathname.endsWith('/today')");
  });
});
