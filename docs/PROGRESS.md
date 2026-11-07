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

## Stage 1 delight layer (migration 046)
Celebration pop, Today's plate and welcome-back card, each behind its own switch (all off by default). See docs/DELIGHT_LAYER.md. Points, levels, Food Explorer and the light theme are not built yet.

## New look (migration 047)
Evergreen/Ivory theme with Light, Dark and Same-as-phone, behind the switch ui_new_design (off by default). See docs/NEW_DESIGN.md. Per-screen layout changes come next.

## New screens, Stage A (migration 048)
Today hero (thali + one next step) and line icons, behind ui_screens_a (off by default). See docs/NEW_SCREENS_A.md.

## Stage B: Sparks, levels, daily quests (migration 049)
Server-verified points from real logs, six levels, two daily quests, behind ui_sparks (off by default). See docs/SPARKS.md.

## Stage C: Journey, Food Explorer, Kitchen Detective, Hinglish (migration 050)
Journey page with levels and regional kitchens tried (ui_journey), Detective lessons held back until professionally reviewed (ui_detective), Hinglish for the new screens. See docs/JOURNEY.md.
