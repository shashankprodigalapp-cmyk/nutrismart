# Releasing NutriSmart 2.0

2.0 is already deployed in pieces on the `v2` branch (Cloudflare preview) and in the shared database. Every 2.0 feature is OFF until you switch it on. Version 1.0 is tagged `v1.0` and is your safe point.

## Before you switch anything on
1. Admin, Platform 2.0, Overview: health shows "All fine" or "Not enough data".
2. Run `node scripts/smoke-v2.mjs https://<your v2 preview address>`. Every line should say ok.
3. GitHub, Actions, "2.0 checks": the last run on `v2` is green (unit, build, database). If "build" is red, read its first error; it has not been run in my sandbox.
4. Test on your own phone, installed as an app: see MANUAL_TESTS.md.

## Turn features on, in this order, one at a time (Admin, Platform 2.0, Feature switches)
Wait a day between groups. Watch Overview health and the Audit log.

| Step | Switches | What to look at |
|---|---|---|
| 1 | v2_checkins, v2_mood_insights | Check-in card appears, Energy and mood page works |
| 2 | v2_flexible_meals | Planner on Today tab, calories add up |
| 3 | v2_voice, v2_photo | Try both on your phone |
| 4 | v2_weekly_review, v2_monthly_review | Review appears after 3 logged days |
| 5 | v2_patterns, v2_experiments | Shown only when enough data |
| 6 | v2_coach, then v2_coach_signup | Make one test coach yourself, invite your own second account |
| 7 | v2_attention | Coach dashboard Needs attention list |
| 8 | v2_nudges | Needs the installed app and notification permission; hourly job on GitHub must be running |
| 9 | v2_ai_reviews | AI wording for reviews; watch AI usage and error rate |
| 10 | v2_plans | Only if you set a coach client cap |

## Making 2.0 the main site
When you are happy: merge `v2` into `main` on GitHub (Pull request, Merge), wait for Cloudflare, run the smoke test against the live address, then tag it: `git checkout main && git pull && git tag v2.0 && git push --tags`. Because features are switched off by default, merging changes nothing for users until you switch features on.

## Go back
- One feature misbehaving: switch it off. Takes effect within about a minute. Nothing is lost.
- Whole 2.0 misbehaving: switch all v2_ flags off. The app behaves as 1.0.
- Website itself broken: Cloudflare Pages, Deployments, pick the last good one, "Rollback". Or redeploy tag `v1.0`.
- Database: never roll back. Migrations only add. Migration 036 tightened some 1.0 functions; 1.0 works with it.
