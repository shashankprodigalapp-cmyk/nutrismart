# Personal pattern engine (Phase 14)

Input: `meal_outcomes(user, days)` (migration 031). One row per logged meal with calories, protein, carbs, fat, glycaemic load, the hour it was logged (IST), the older after-meal energy level, and the newer after-meal notes (energy, fullness, mood). It uses SECURITY INVOKER, so row-level security applies: a coach sees only what the client shares (food, energy, mood).

Rules (`src/lib/patterns.ts`, plain code, fully tested)
- Compares meal types: 25 g+ protein, carb-heavy (60%+ of calories), large (700 kcal+), logged after 9 pm, high glycaemic load (20+).
- Outcomes: energy felt lower, still hungry, mood felt lower.
- Under 3 observed outcomes: nothing is said, and the screen explains what to do. Each side of a comparison needs 3+ meals. The gap must be at least 25 percentage points. 3 to 6 occasions is an early signal, 7 to 14 emerging, 15+ repeated.
- Wording: "After large meals, energy felt lower on 4 of 5 occasions, compared with 1 of 6 after smaller meals. We observed this; it may or may not be linked to the food itself." Never causal. Each pattern has "Based on" evidence.
- Shows at most 5, strongest first. Computed live (cheap), so there is nothing stale to store. Weekly and monthly reviews do not use patterns yet.

Screens: "Meal patterns" on /app/energy-mood and on the coach's "Energy and mood" tab. Flag `v2_patterns` (default off).
Limits: the hour is when the meal was logged, not eaten; meal composition is from the person's own logging.
Tests: `Patterns.test.ts` (8), `supabase/tests_v2_patterns.sql` (10).
