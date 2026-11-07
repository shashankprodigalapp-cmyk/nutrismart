# NutriSmart 2.1 progress

| Date | Step | State |
|---|---|---|
| 2026-11-01 | 2.0 test suite green (71 passed, 1 phone-only skipped) | DONE |
| 2026-11-01 | UX fixes: search results shown once; water card shows 250 ml per glass | DONE (patch v2-ux1) |
| 2026-11-01 | P0 audit: ARCHITECTURE_CURRENT, GAP_ANALYSIS | DONE |
| 2026-11-01 | P0 photo removal: camera, vision endpoint, photo quota, v2_photo flag (migration 040), tests, docs | DONE in code (patch v2-p0), awaiting CI |
| 2026-11-01 | P1 analytics + personal feature store (migration 041, src/lib/intel/features.ts) | DONE in code |
| 2026-11-01 | P2 Today redesign (DailyIntelligence, Learned page) | DONE in code, behind daily_intelligence |
| 2026-11-01 | P3 recommendations + smart meal (recommend.ts, smartMeal.ts, rec-action) | DONE in code |
| 2026-11-01 | P4 smart notifications + messaging (migration 042, notifyDecide.ts, cron-intel, messages) | DONE in code, opt-in |
| 2026-11-01 | P5 weekly/monthly/learning reports (reports.ts, intel-report) | DONE in code |
| 2026-11-01 | P6 energy intelligence (migration 043, energyIntel.ts, check-in fullness/digestion) | DONE in code |
| 2026-11-01 | P7 coach brief, drafts, intervention outcomes (coachIntel.ts, coach-intel) | DONE in code |
| | Tests: 61 intel unit + 14 loop/security + SQL + 10 browser cases | written; browser run awaits CI |
| | P8 predictive models, P9 billing | deliberately not started |

## P8 predictive insights (migration 045)
Five forecasts built as pure code, each behind its own switch (all off by default; energy patterns stays off until reviewed). See docs/FORECASTING_ENGINE.md.
