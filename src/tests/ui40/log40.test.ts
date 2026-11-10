import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
describe('Log restyle', () => {
  it('only touches the new look and changes no layout', () => {
    const css = read('src/styles/log.css');
    for (const l of css.split('\n').filter(x => /^\S.*\{/.test(x) && !/^(\.nl-|@media)/.test(x))) expect(l.startsWith('html[data-ui="new"]')).toBe(true);
    expect(css).not.toMatch(/display\s*:\s*none/);
  });
  it('the Log tab loads it and still wraps the same logging screen', () => {
    const t = read('src/pages/tabs/LogTab.tsx');
    expect(t).toContain("import '../../styles/log.css'");
    expect(t).toContain('<DashboardLogging onLogConfirmed={handleLogConfirmed} />');
  });
});
