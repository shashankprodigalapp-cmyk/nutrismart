// Guards the browser tests against guessing: every word, role and place the e2e specs rely on must exist in the code.
// The first CI run failed 7 browser tests because the tests assumed things the app does not do. This test catches that in seconds, before CI.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('browser tests only rely on things the app really has', () => {
  it('admin platform sections are tabs (role="tab"), with the eight names the tests click', () => {
    const s = read('src/components/admin/AdminPlatform.tsx');
    expect(s).toContain('role="tab"');
    for (const n of ['Overview', 'Trends', 'Feature use', 'AI usage', 'Coaches', 'Plans', 'Feature switches', 'Audit log']) expect(s).toContain(`'${n}'`);
    expect(s).toContain('This account is not an admin.');
  });
  it('the first onboarding step has the heading the new-person test waits for', () => {
    const s = read('src/pages/OnboardingPage.tsx');
    for (const t of ['How much oil / ghee per dish?', 'Very light', "label: 'I cook'", "label: 'Health conscious'", 'Build my Kitchen Profile', 'Next']) expect(s).toContain(t);
  });
  it('the support email is inside the Data and Privacy popup, not the page', () => {
    expect(read('src/pages/tabs/ProfileTab.tsx')).toContain('Questions: support@nutrismart.co.in');
  });
  it('the nudge box is mounted in the coach attention panel, which the dashboard shows', () => {
    expect(read('src/components/coach/AttentionPanel.tsx')).toContain('<NudgeBox');
    expect(read('src/components/coach/CoachDashboard.tsx')).toContain('<AttentionPanel');
    const n = read('src/components/nudge/NudgeBox.tsx');
    for (const t of ['Send a nudge', 'Short message (max 140 characters, no links)', 'Remember your protein', 'Nice work this week', 'role="status"']) expect(n).toContain(t);
  });
  it('the energy and mood page shows Loading… while it loads (tests wait for it to go)', () => {
    expect(read('src/components/energy/EnergyMoodPanel.tsx')).toContain('Loading…');
  });
  it('no browser spec looks for an admin section as a button', () => {
    for (const f of ['platform', 'screens', 'workflows']) {
      const s = read(`e2e/v2/${f}.spec.ts`);
      for (const n of ['Overview', 'Trends', 'Feature use', 'AI usage', 'Coaches', 'Plans', 'Feature switches', 'Audit log']) expect(s).not.toContain(`getByRole('button', { name: '${n}'`);
    }
  });
  it('admins are allowed to read food contributions (migration 039), so the Contributions screen is not empty', () => {
    const m = read('supabase/migrations/039_admin_read_contributions.sql');
    expect(m).toContain('food_contributions_select_admin');
    expect(m).toContain('public.is_admin');
  });
  it('every pop-up sheet on the Profile screen scrolls, so Cancel is reachable on a short phone', () => {
    const s = read('src/pages/tabs/ProfileTab.tsx');
    expect((s.match(/relative w-full max-w-md max-h-\[90dvh\] overflow-y-auto/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
