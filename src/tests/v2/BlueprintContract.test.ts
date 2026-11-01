// Blueprint contract: every screen text and route the blueprint document quotes must still exist in the code.
// If someone renames a button or removes a screen, this fails and tells them which blueprint item moved.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const all = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(d => d.isDirectory() ? all(join(dir, d.name)) : [join(dir, d.name)]);

// [blueprint item, file, texts that must appear in that file]
const TEXTS: Array<[string, string, string[]]> = [
  ['3.1 Sign in', 'src/pages/LoginPage.tsx', ['Your name', 'Email address', 'Sign In', 'Create Account', 'Forgot password?', 'Resend verification email', 'Password must be at least 8 characters.', 'Password needs a symbol', 'Please tick the box to confirm you are 18 or older', 'Email or password is incorrect', 'Your email is not verified yet', 'Type your email address above first']],
  ['3.2 Kitchen profile', 'src/pages/OnboardingPage.tsx', ['Your Kitchen Multiplier', 'Build my Kitchen Profile', 'Who usually cooks at home?', 'Describe your cooking style', 'Self-cooked, controlled', 'Professional cook at home', 'Varies day to day', 'Health conscious', 'Traditional']],
  ['3.3 Navigation', 'src/pages/AppShell.tsx', ["label: 'Today'", "label: 'Log'", "label: 'Insights'", "label: 'Profile'"]],
  ['3.4 Today', 'src/pages/tabs/TodayTab.tsx', ['Calories today', 'Meals logged', 'Start your day right', 'Your weekly review', 'Energy and mood', 'Protein', 'Water']],
  ['3.4 Flexible meal', 'src/components/FlexibleMealCard.tsx', ['Flexible meal', 'Plan one', 'Meal name', 'Meal time', 'Calories to set aside', 'Custom calories', 'Save plan', 'Cancel plan', 'I had it', 'Skipped', 'Before your planned meal']],
  ['3.4 Daily check-in', 'src/components/energy/DailyCheckInCard.tsx', ['Morning check-in', 'How are you feeling today?', 'Sleep last night', 'Hunger', 'Stress', 'Check-in saved']],
  ['3.4 Meal feeling', 'src/components/energy/MealFeelingCard.tsx', ['How did that meal feel?', 'Still hungry', 'Comfortable', 'Too full', 'Log a meal first, then come back to say how it felt.']],
  ['3.5 Log', 'src/components/DashboardLogging.tsx', ['My Usuals', 'Tap to log all', 'Recents', 'Add glass', 'Remove glass', 'Search food', 'Photograph your meal', 'Hide from My Usuals?', 'Keep it', 'Use the AI estimate instead', 'No food detected', 'Could not identify this food']],
  ['3.5 Voice', 'src/components/voice/VoiceLogButton.tsx', ['Say what you ate', 'Stop listening', 'English']],
  ['3.6 Insights', 'src/pages/tabs/InsightsTab.tsx', ['Energy patterns', 'Your eating patterns', "What you've learned", 'My Usual Meals', 'Good for your energy', 'Heavy for you', 'not medical advice']],
  ['3.7 Profile', 'src/pages/tabs/ProfileTab.tsx', ['Nutrition Goals', 'Data & Privacy', 'Type DELETE to confirm', 'Under 1200 kcal a day is very low', 'Push Notifications', 'My coach', 'Quick setup', 'Carbs (automatic)', 'Questions: support@nutrismart.co.in', 'Nutri Smart v2.0', 'send the food name or photo to Google Gemini or Anthropic Claude', 'General guidance, not medical advice.']],
  ['3.8 Nudge settings', 'src/pages/NudgeSettingsPage.tsx', ['Reminders and messages', 'Evening log reminder', 'Messages from my coach', 'Quiet hours']],
  ['3.8 My coach', 'src/pages/MyCoachPage.tsx', ['Pause sharing', 'Resume sharing', 'Leave coach', 'Your coach can see:', 'Stop working with this coach? They will no longer see your data.']],
  ['3.8 Join', 'src/pages/JoinPage.tsx', ['Accept and join', 'Not now', 'This invite link is not valid.']],
  ['4.1-4.3 Coach home', 'src/pages/CoachPage.tsx', ['Apply to be a coach', 'Invite a client', 'Client name (only you see this)', 'Create link', 'Copy link', 'Send this link to your client. It works once and expires in 14 days. It is shown only now.', 'The coach area is not switched on yet.', 'Back to app', 'Coach accounts are not open yet']],
  ['4.2 Coach dashboard', 'src/components/coach/CoachDashboard.tsx', ['Search clients', 'Sort clients', 'Time window', 'Filter clients', 'Who needs your attention today?']],
  ['4.2 Attention', 'src/components/coach/AttentionPanel.tsx', ['Snooze 3 days', 'Nobody needs attention right now.']],
  ['4.2 Coach charts', 'src/components/coach/CoachInsights.tsx', ['Your clients today', 'Logging each day', 'Who logged, and how close']],
  ['4.4 Client detail', 'src/pages/coach/ClientDetailPage.tsx', ['Timeline filter', 'Show older', 'This client was not found, or is not linked to you.', 'This client has not shared their food log, so adherence is not available.']],
  ['4.5 Nudge', 'src/components/nudge/NudgeBox.tsx', ['Send a nudge', 'Close']],
  ['4.6 Weekly review', 'src/components/review/WeeklyReviewPanel.tsx', ['Approve and share', 'Save and share', 'Reject']],
  ['5 Admin tabs', 'src/pages/AdminPage.tsx', ['Platform 2.0', 'Insights', 'Behaviour', 'Who they are', 'Free tier', 'Analytics', 'Users', 'Payments', 'Contributions', 'Search review']],
  ['5.1 Admin platform', 'src/components/admin/AdminPlatform.tsx', ["'Overview'", "'Trends'", "'Feature use'", "'AI usage'", "'Coaches'", "'Plans'", "'Feature switches'", "'Audit log'", 'People active each day']],
];

const ROUTES = ['/login', '/reset-password', '/onboarding', '/app/*', '/coach/client/:clientId', '/coach/*', '/join/:token', '/app/experiments', '/app/energy-mood', '/app/nudges', '/app/weekly-review', '/app/my-coach', '/admin/*'];
const ADMIN_ROUTES = ['/admin/platform', '/admin/insights', '/admin/behaviour', '/admin/who', '/admin/free-tier', '/admin/analytics', '/admin/users', '/admin/payments', '/admin/contributions', '/admin/search-review'];

describe('blueprint contract: screen texts', () => {
  for (const [item, file, texts] of TEXTS) {
    it(`${item}: ${file}`, () => {
      const src = read(file);
      const missing = texts.filter(t => !src.includes(t));
      expect(missing, `Blueprint item "${item}" quotes text that is no longer in ${file}`).toEqual([]);
    });
  }
});

describe('blueprint contract: routes and functions', () => {
  it('every route the blueprint lists is declared in App.tsx', () => {
    const app = read('src/App.tsx');
    expect(ROUTES.filter(r => !app.includes(`path="${r}"`))).toEqual([]);
  });
  it('the ten admin tabs exist', () => {
    const admin = read('src/pages/AdminPage.tsx');
    expect(ADMIN_ROUTES.filter(r => !admin.includes(`'${r}'`))).toEqual([]);
  });
  it('the blueprint says 36 server functions; the folder agrees', () => {
    const n = readdirSync(join(root, 'functions/api')).filter(f => f.endsWith('.ts')).length;
    expect(n).toBe(36);
  });
  it('the blueprint says 38 migrations; the folder agrees', () => {
    const n = readdirSync(join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).length;
    expect(n).toBe(38);
  });
  it('the blueprint lists 16 v2 switches; the migrations create exactly these', () => {
    const found = new Set<string>();
    for (const f of all('supabase/migrations')) for (const m of read(f).matchAll(/'(v2_[a-z_]+)'/g)) found.add(m[1]);
    expect([...found].sort()).toEqual(['v2_ai_reviews', 'v2_attention', 'v2_checkins', 'v2_coach', 'v2_coach_auto_approve', 'v2_coach_signup', 'v2_experiments', 'v2_flexible_meals', 'v2_monthly_review', 'v2_mood_insights', 'v2_nudges', 'v2_patterns', 'v2_photo', 'v2_plans', 'v2_voice', 'v2_weekly_review']);
  });
  it('AI models in the blueprint are the ones in code', () => {
    const src = all('functions').filter(f => f.endsWith('.ts')).map(read).join('\n');
    for (const m of ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-embedding-001', 'claude-haiku-4-5']) expect(src).toContain(m);
  });
  it('coach status rules in the blueprint table match RULES', () => {
    const r = read('src/lib/coachMetrics.ts');
    for (const s of ['loggingAttentionMax: 2', 'loggingDriftMax: 4', 'proteinAttention: 0.6', 'proteinDrift: 0.8', 'calLow: 0.7', 'calHigh: 1.3', 'calDriftLow: 0.85', 'calDriftHigh: 1.15', 'energyDropAttention: 0.2', 'energyDropDrift: 0.1', 'silentDays: 7', 'newClientMinDays: 3']) expect(r).toContain(s);
  });
});
