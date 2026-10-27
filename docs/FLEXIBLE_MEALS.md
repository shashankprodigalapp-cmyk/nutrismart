# Flexible meals (planned indulgences)
Internal name: `flexible_meal`. Never "cheat meal".
Planner: `src/lib/flexibleMeal.ts` (pure, tested). All arithmetic is deterministic; no AI.
Rules: remaining = target - eaten; left for other food = remaining - reserved; before the meal = 70-100% of that; protein before = 60-70% of protein still to eat, capped so its calories fit; day status comfortable / stretch (<=15% over) / over; week view uses Monday-to-yesterday totals from `daily_nutrition_metrics`.
Data: `flexible_meals`, `flexible_meal_events`; created/consumed/skipped events also appear on the timeline; consumed meals feed `daily_adherence.flexible_adherence` (band score of eaten vs reserved; skipped is not penalised).
UI: Today card, visible only when flag `v2_flexible_meals` is on.
