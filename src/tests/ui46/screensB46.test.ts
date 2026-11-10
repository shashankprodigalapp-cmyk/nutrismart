import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
describe('Onboarding, Insights header and Coach screens from the design', () => {
  it('css only styles the new look and hides nothing', () => {
    const css = read('src/styles/screens-b.css');
    const rules = css.split('\n').filter(l => /^[.a-z]/i.test(l) && l.includes('{'));
    for (const r of rules) expect(r.startsWith('html[data-ui="new"]'), r).toBe(true);
    expect(css).not.toMatch(/display\s*:\s*none|position\s*:\s*fixed/);
  });
  it('onboarding keeps every string and the same save logic', () => {
    const o = read('src/pages/OnboardingPage.tsx');
    for (const s of ['Kitchen Intelligence · ', 'Next →', 'Build my Kitchen Profile', 'Building your profile…', 'How much oil / ghee per dish?', 'kitchen_profile_completed', 'markKitchenProfileDone', "screens-b.css"]) expect(o, s).toContain(s);
    expect(o).toContain('nx-opt');
  });
  it('coach screens keep the words the e2e tests and contract look for', () => {
    const d = read('src/components/coach/CoachDashboard.tsx'), a = read('src/components/coach/AttentionPanel.tsx');
    for (const s of ['Search clients', 'Sort clients', 'Time window', 'Filter clients', 'Who needs your attention today?', 'nc-tile', 'nc-lead']) expect(d, s).toContain(s);
    for (const s of ['Snooze 3 days', 'Dismiss', 'Nobody needs attention right now.', '<NudgeBox clientId={it.client_id} />', 'nc-case', 'nc-av']) expect(a, s).toContain(s);
    expect(read('src/components/coach/AttentionPanel.tsx')).toContain("import '../../styles/screens-b.css'");
  });
  it('insights keeps its heading and adds a journey link only when the journey is on', () => {
    const t = read('src/pages/tabs/InsightsTab.tsx');
    expect(t).toContain('Your Food<br />Playbook');
    expect(t).toContain("useFlag('ui_journey')");
    expect(t).toContain('{journeyOn && <Link to="/app/journey" className="nx-journey">');
  });
});
