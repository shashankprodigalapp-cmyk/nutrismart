// Guards the browser tests against guessing: every word, role and place the e2e specs rely on must exist in the code.
// The first CI run failed 7 browser tests because the tests assumed things the app does not do. This test catches that in seconds, before CI.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
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

describe('2.1 P0: photo search is gone from the product', () => {
  it('no camera control, no vision endpoint, no photo quota', () => {
    expect(read('src/components/DashboardLogging.tsx')).not.toMatch(/Photograph your meal|ai-vision|handlePhotoSelect/);
    expect(existsSync(join(process.cwd(), 'functions/api/ai-vision.ts'))).toBe(false);
    expect(read('functions/_shared/auth.ts')).not.toContain("'photo'");
  });
  it('the upload endpoint still serves payment proof only', () => {
    const s = read('functions/api/get-upload-url.ts');
    expect(s).toContain("'payment-proof'");
    expect(s).not.toContain("'meal-photo'");
  });
});

describe('2.1: the browser spec for intelligence only relies on things the app really has', () => {
  const spec = read('e2e/v21/intelligence.spec.ts');
  it('Today screen parts and buttons', () => {
    const s = read('src/components/intel/DailyIntelligence.tsx');
    for (const t of ["Today's signal", 'Your progress', 'What NutriSmart learned', 'What to do next', 'Smart meal', 'I will try this', 'We will check how it went', 'role="status"']) expect(s).toContain(t);
    expect(read('src/pages/tabs/TodayTab.tsx')).toContain("useFlag('daily_intelligence')");
  });
  it('Learned page tabs and report headings', () => {
    const s = read('src/pages/LearnedPage.tsx');
    for (const t of ['role="tab"', 'Your week', 'Your month', 'What NutriSmart has learned']) expect(s).toContain(t);
    const r = read('src/lib/intel/reports.ts');
    for (const t of ["'Adherence'", "'Next priorities'", 'average']) expect(r).toContain(t);
  });
  it('Coach brief controls', () => {
    const s = read('src/components/coach/CoachBrief.tsx');
    for (const t of ['aria-label="Coach brief"', 'Draft a message for review', 'Draft (edit before sending', 'Approve and send', 'role="status"', "'Sent.'"]) expect(s).toContain(t);
  });
  it('Smart tips settings and check-in extras', () => {
    const n = read('src/pages/NudgeSettingsPage.tsx');
    for (const t of ['aria-label="Smart tips"', 'Protein tips', 'protein_reminder']) expect(n).toContain(t);
    const c = read('src/components/energy/DailyCheckInCard.tsx');
    for (const t of ['More (optional)', 'Fullness after meals', "'heavy'", 'Check-in saved', 'aria-label="Morning check-in"']) expect(c).toContain(t);
  });
  it('the spec file is inside the folder the CI command runs', () => {
    expect(spec).toContain("from '../v2/env'");
    expect('e2e/v21/intelligence.spec.ts').toContain('e2e/v2');
    expect(read('scripts/run-everything.sh')).toContain('e2e/v2');
  });
});

describe('flexible meal buttons and the own-rows rule', () => {
  it('the three buttons and their messages exist, and the card only loads the signed-in person\'s plans', () => {
    const s = read('src/components/FlexibleMealCard.tsx');
    for (const t of ['I had it', 'Skipped', 'Cancel plan', 'Save plan', 'Plan one', 'That did not save. Please try again.', "aria-label=\"Flexible meal\"", ".eq('user_id', user.id).eq('planned_for', day)"]) expect(s).toContain(t);
    expect(read('e2e/v2/workflows.spec.ts')).toContain('W-15');
    expect(read('e2e/v21/crawler.spec.ts')).toContain('CR-1');
  });
});

describe('Edit on a logged meal always opens', () => {
  it('rebuilds a food from the log entry when it is not in the food list', () => {
    const s = read('src/components/DashboardLogging.tsx');
    expect(s).toContain('setSheetFood(food ?? rebuilt)');
    expect(s).not.toContain('if (!food) return; // food no longer');
    expect(read('e2e/v2/workflows.spec.ts')).toContain('W-16');
  });
  it('the admin crawl visits every admin section, not just the first page', () => {
    const c = read('e2e/v21/crawler.spec.ts');
    for (const r of ['/admin/platform', '/admin/insights', '/admin/behaviour', '/admin/who', '/admin/free-tier', '/admin/analytics', '/admin/users', '/admin/payments', '/admin/contributions', '/admin/search-review']) expect(c).toContain(r);
  });
});
