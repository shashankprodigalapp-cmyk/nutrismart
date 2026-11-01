# Target architecture (2.1)

Loop: data, normalisation, measurement, personal baseline, pattern, learning, recommendation, notification, action, outcome, learning.

Layers (each only reads the one below):
1. Authoritative data: daily_logs, daily_checkins, flexible_meals, users targets.
2. Deterministic analytics and features: `src/lib/intel/features.ts`. Windows 1/7/14/30/90. Stored in `personal_features`.
3. Patterns and observations: energyIntel.ts (minimum days and hits, observational wording only).
4. Recommendation scoring: recommend.ts, smartMeal.ts. Uses foods the person already logs.
5. Notification decision: notifyDecide.ts. Quiet hours, caps, cooldowns, dedupe, fatigue, learned timing, opt-out.
6. Delivery: functions/api/cron-intel.ts (hourly, 3 opted-in users per run), nudgeSend.ts.
7. Outcome: recOutcome compares the metric before and after; stored on the recommendation.
8. Reports: reports.ts builds text from numbers only. No LLM writes a number.
Coach: coachIntel.ts brief; drafts via draft.ts need coach approval before delivery.
The pure modules have no framework imports so the same code runs in the browser, the server and the tests.
