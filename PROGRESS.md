# NutriSmart 2.0 — PROGRESS

Branch `v2` (code), tag `v1.0` (safe point). 1.0 = production `main` as of ux27.
Rule: database changes are ADDITIVE ONLY, so 1.0 keeps working on the same database.
Rule: every 2.0 screen is behind a feature flag (`feature_flags` table), off by default.

## Phases
| # | Phase | State |
|---|---|---|
| 1 | Architecture + database foundation | DONE (migration 020, audit docs, timeline triggers) |
| 2 | RBAC + coach/client relationships | DONE (server roles, invites, accept, pause/leave, admin approve, RLS tests). Coach/client UIs minimal. |
| 3 | Coach dashboard | NEXT |
| 4 | Client timeline | todo |
| 5 | Adherence engine | todo |
| 6 | Flexible meal intelligence | todo |
| 7 | Weekly AI review | todo |
| 8 | Monthly AI review | todo |
| 9 | Needs Attention engine | todo |
| 10 | Nudge system | todo |
| 11 | Voice logging | todo |
| 12 | Photo logging improvements | todo |
| 13 | Energy + Mood intelligence | todo |
| 14 | Pattern engine | todo |
| 15 | Personal experiments | todo |
| 16 | Admin platform | todo (admin-coaches API done) |
| 17 | Subscriptions | todo |
| 18 | Analytics | todo |
| 19 | Security hardening | todo |
| 20 | Production testing and deployment | todo |

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
