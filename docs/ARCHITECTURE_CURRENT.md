# Architecture today (end of 2.0, 1 Nov 2026)

Audited from the repository on branch `v2`. 2.0 is fully green in CI (71 passed, 1 skipped phone-only test, 0 failed).

## Stack
React + Vite + Tailwind PWA (installable, service worker `src/sw.ts`) · Dexie offline store (`nutrismart-v1`) · Cloudflare Pages Functions (`functions/api`, 36 endpoints, shared code in `functions/_shared`) · Supabase Postgres, Auth, RLS (39 migrations, 1.0 and 2.0 share one database, changes are additive) · Gemini on the server · Web Push · Razorpay and UPI.

## Layers (as built)
1. Authoritative data: `daily_logs`, `water_logs`, `energy_logs`, `daily_checkins`, `meal_feelings`, `flexible_meals`, `master_foods`, `user_custom_foods`, `kitchen_profiles`, goals in `users`/`nutrition_targets`.
2. Timeline: triggers write one idempotent `timeline_events` row per event.
3. Deterministic aggregates (SQL): `daily_nutrition_metrics`, `daily_adherence`, `weekly_metrics`, `monthly_metrics`.
4. Deterministic rules (TypeScript, tested): adherence, flexible meal planner, attention ranking, nudge rules, energy correlation, meal patterns, experiments.
5. AI (server only): food name/describe search, weekly and monthly review drafts, energy analysis. Every call is logged in `ai_call_log`.
6. Notifications: opt-in evening nudge, morning verdict cron, energy check-in cron, coach nudges, with quiet hours and caps (`nudge_preferences`, `nudges`).
7. Roles: client, coach (`coach_profiles`), admin (`admin_users`). Coach sees a client only through an active relationship and the scopes the client switched on.

## Strongest assets (keep)
Indian food database and search · Kitchen Intelligence (579 lines) · home vs restaurant logic · My Usuals and recents · flexible meal planner · energy and mood check-ins · pattern engine with minimum-observation rules · experiments · coach dashboard, Needs Attention, nudges, weekly and monthly review with approve/edit/reject · offline PWA · 2.0 security hardening and the green end-to-end suite.

## Not in the codebase yet
No personal feature store, no baselines or deltas with confidence, no recommendation engine, no notification decision engine with learned timing or fatigue score, no message store, no daily/monthly personal learning report, no outcome tracking on recommendations. See `GAP_ANALYSIS.md`.
