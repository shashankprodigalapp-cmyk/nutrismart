# NutriSmart 2.0 — PROGRESS

Branch `v2` (code), tag `v1.0` (safe point). 1.0 = production `main` as of ux27.
Rule: database changes are ADDITIVE ONLY, so 1.0 keeps working on the same database.
Rule: every 2.0 screen is behind a feature flag (`feature_flags` table), off by default.

## Phases
| # | Phase | State |
|---|---|---|
| 1 | Architecture + database foundation | DONE (migration 020, audit docs, timeline triggers) |
| 2 | RBAC + coach/client relationships | DONE (server roles, invites, accept, pause/leave, admin approve, RLS tests). Coach/client UIs minimal. |
| 3 | Coach dashboard | DONE (migration 021 `coach_dashboard()`, CoachDashboard UI, deterministic status rules + 11 tests). Message/Review/Dismiss buttons wait for Phases 4, 9, 10. |
| 4 | Client timeline | DONE for coaches (client detail: Overview + Timeline, paginated by 50, IST day groups, scope filter, 6 tests). Client's own timeline view + Nutrition/Weight/Mood tabs come with later phases. |
| 5 | Adherence engine | DONE (migration 022: stored daily metrics + adherence, triggers keep them fresh, 60-day backfill, 21 SQL checks in supabase/tests_v2_adherence.sql, Adherence tab, 5 unit tests). meal_plan, flexible_meal and goal adherence arrive with Phase 6 and weekly work. |
| 6 | Flexible meal intelligence | DONE (FlexibleMealPlanner in src/lib/flexibleMeal.ts, 11 tests; migration 023 flexible_meals + events + timeline + flexible_adherence, 10 SQL checks; Today card behind flag v2_flexible_meals). Needs a connection to plan (not offline yet). Coach-set cap has no UI yet; the planner already supports it. |
| 7 | Weekly AI review | DONE |
| 8 | Monthly AI review | DONE (migration 025, same endpoint with period month, Weekly/Monthly switch in the review panel, 12 SQL checks, flag v2_monthly_review) |
| 9 | Needs Attention engine | DONE (migration 026 attention_actions, ranked panel on coach dashboard, snooze/dismiss with resurface on escalation, 6 unit + 5 SQL checks, flag v2_attention) |
| 10 | Nudge system | DONE (migration 027, rules module, coach nudge box in Needs Attention, opt-in evening reminder, quiet hours and caps, /app/nudges settings, hourly cron job; 11 unit + 9 SQL checks; flag v2_nudges) |
| 11 | Voice logging | DONE (browser speech -> rule parser -> match -> confirm each item in the normal add sheet; EN/HI; flag v2_voice via migration 028; 9 tests; needs a real-phone test) |
| 12 | Photo logging improvements | DONE (food-list matching, calorie ranges by confidence, uncertainty and disagreement notes, flag v2_photo via migration 029; 8 tests) |
| 13 | Energy + Mood intelligence | DONE (migration 030 daily_checkins + meal_feelings, morning check-in, after-meal feelings, trend and day graphs, insights with minimum-observation rules and safety note, coach tab; 12 unit + 12 SQL checks; flags v2_checkins, v2_mood_insights). Not yet: feed mood into adherence and weekly review. |
| 14 | Pattern engine | DONE (migration 031 meal_outcomes, rules in src/lib/patterns.ts with minimum-observation tiers, "Meal patterns" on the energy page and coach tab; 8 unit + 10 SQL checks; flag v2_patterns) |
| 15 | Personal experiments | DONE (migration 032 experiments + daily ticks, 4 templates, deterministic before/during comparison with minimum-data rules, client page and coach read-only view; 11 unit + 11 SQL checks; flag v2_experiments) |
| 16 | Admin platform | DONE (migration 033 admin_platform_metrics, endpoints admin-platform/flags/audit, Platform 2.0 tab with health checks, AI usage, coaches, feature switches, audit log; 5 unit + 6 SQL checks) |
| 17 | Subscriptions | DONE (migration 034 plans catalog, effective plan + entitlements functions, coach client cap behind v2_plans, admin Plans editor; payments and AI limits unchanged; 12 unit + 15 SQL checks) |
| 18 | Analytics | DONE (migration 035 admin_v2_analytics, endpoint, Feature use tab: adoption, coach funnel, review outcomes, sign-up cohorts; 7 unit + 11 SQL checks) |
| 19 | Security hardening | DONE (migration 036: fixed self-granted Pro, admin id spoofing, 6 server-only helpers, kitchen analysis leak; rate limits on 2.0 endpoints; export covers 35 tables; delete erases lingering ids; 30 SQL + 43 unit checks) |
| 20 | Production testing and deployment | DONE (CI workflow '2.0 checks': unit, build, database, preview smoke; scripts/db-test.sh 180 SQL checks; scripts/smoke-v2.mjs; RELEASE_2_0, RUNBOOK, MANUAL_TESTS docs) |

## Phase 1+2 log
- Files: supabase/migrations/020_v2_foundation.sql, supabase/tests_v2_rls.sql, functions/_shared/{coachLogic,roles}.ts,
  functions/api/{coach-apply,coach-invite,coach-accept,coach-relationship,admin-coaches}.ts,
  src/lib/{useRoles,coachApi}.ts, src/components/RoleRoute.tsx, src/pages/{CoachPage,JoinPage,MyCoachPage}.tsx,
  App.tsx routes, ProfileTab coach links (hidden until flag), src/tests/v2/CoachLogic.test.ts, scripts/run-tests-lite.mjs, docs/*.
- Verified here: migration applies on a real Postgres 16 copy of the schema; 19 RLS checks pass (supabase/tests_v2_rls.sql);
  9 unit tests pass (scripts/run-tests-lite.mjs); changed files compile with esbuild.
- NOT verified here (sandbox has no full node_modules): `tsc` type-check, full vitest suite, vite build. CI must run them.

## Known gaps / to do next
- export-my-data and delete-my-account must include the new tables (Phase 19). Deletion already cascades by foreign key.
- Coach dashboard (Phase 3) will read via `coach_clients()` and date-windowed queries.
- Rename decision pending: "NutriSmart" collides with an existing app. App name should be a single constant before launch.
- To switch 2.0 on for yourself: set flag `v2_coach` = true (and `v2_coach_signup`).
