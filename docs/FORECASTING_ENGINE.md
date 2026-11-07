# Forecasting engine (P8 predictive insights)

All five forecasts are plain arithmetic on the person's own logs, in `src/lib/intel/forecast.ts`. **No AI call is made, so each forecast costs nothing to run.** Wording is fixed text with numbers filled in.

| # | Key | Switch | What it says | Minimum data | Expires |
|---|-----|--------|--------------|--------------|---------|
| 1 | week_landing | forecast_week_landing | If the rest of the week looks like the finished days so far, the week lands close to / above / below the calorie target | 3 finished logged days this week (today excluded) | end of today |
| 2 | hard_weekdays | forecast_hard_weekdays | Up to 2 weekdays over the last 8 weeks that ran 10%+ over on calories or 15%+ short on protein | 21 logged days, 3+ samples per weekday | tomorrow |
| 3 | energy_patterns | forecast_energy_patterns (**off until reviewed**) | Energy / hunger on days protein reached 90% vs not. Pattern, never a cause | 10 days with a check-in, 4+ in each group | tomorrow |
| 4 | lapse_risk | forecast_lapse_risk | Logging steady / slipped / dropped, from the last 7 days vs the 3 weeks before, days missed in a row, weekday habit | 7 logged days in 28 | end of today |
| 5 | protein_catchup | forecast_protein_catchup | Protein left today, per remaining meal, and the person's own usual protein foods (15g+, logged 2+ times) | none for the arithmetic; shows from midday | end of today |

## Rules
- Never predicts weight or any health outcome. Language is observational ("so far", "have tended to").
- Below the minimum data the result is `insufficient`, confidence `none`, and it says how much more is needed.
- Confidence (low / medium / high) rises with the number of days the answer rests on.
- Every forecast carries: headline, evidence lines, numbers (`data`), sample size, minimum needed, version, calculated-at, expires-at.
- Energy patterns need the person to share energy data; nothing runs without the food-share consent.
- A bad input never throws: one failing forecast is skipped, the screen still loads.

## Storage and cost
- `forecasts` (one row per person per forecast) and `forecast_history` (a row only when an answer changes; pruned to 90 days). Migration 045.
- Computed inside the existing `intel-refresh` request from the snapshot it already loads: **no extra data reads**. One small read of the 5 switches, one read of the person's saved forecasts, and writes only for forecasts whose answer changed (hash compare).
- Browser can read only its own rows. Only the server writes.
- Coach sees forecasts through `coach-intel` only for clients who share food (energy forecast only if energy is shared). Protein catch-up is not shown to coaches.

## Tests
`src/tests/intel21/forecast.test.ts` (insufficient / inconsistent data, consent scope, no health or weight words, no network or AI in the module, switches default off) and the 045 block in `supabase/tests_v2_security.sql` (switches off, unknown key refused, own rows only, no browser writes).

## Later (not built)
Optional AI wording layer (one cached sentence per forecast change, behind its own switch and a daily spend cap).
