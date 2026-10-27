# Energy and mood intelligence (Phase 13)

Data (migration 030, additive; the existing post-meal `energy_logs` flow is untouched)
- `daily_checkins`: one row per person per day. Energy, mood, hunger 1 to 5; sleep poor/okay/good; stress low/medium/high. Any field can be skipped. Editable all day.
- `meal_feelings`: per meal per day. Energy better/same/lower, fullness hungry/comfortable/full, mood better/same/lower.
- Access: the person reads and writes their own rows. A coach can only read, and only when the client's `mood` sharing switch is on. Both tables feed the central timeline (scope `mood`).

Screens
- Today: morning check-in card (flag `v2_checkins`) and a link to /app/energy-mood.
- /app/energy-mood: check-in, "How did your meals feel?", trend lines (7 or 30 days) for energy, mood and hunger, a day graph (meals as bars, after-meal energy as dots), and insights.
- Coach: "Energy and mood" tab on the client page (same panel, read only, no "try tomorrow" and no wellbeing note).

Insights (`src/lib/moodInsights.ts`, deterministic, flag `v2_mood_insights`)
- Compares the person's own days: good vs poor sleep, protein reached 80% vs not, 3+ meals logged vs fewer, water goal met vs not, low vs high stress; plus how often energy felt lower after a given meal.
- Rules: at least 3 check-in days to show anything (early 3 to 6, emerging 7 to 14, repeated 15+); each side of a comparison needs 3+ days; differences under 0.5 points are ignored. Every line shows its numbers and the "Based on" evidence.
- Wording is "tended to be higher on...", never causal. "Try tomorrow" lists at most 3 actions, each tied to a real finding.
- If the last 5+ mood ratings average 2 or lower, a gentle note says NutriSmart is not a medical service and suggests talking to a doctor or someone trusted, and to contact emergency services if unsafe. No diagnosis is ever made.

Tests: `MoodInsights.test.ts` (12), `Timeline.test.ts` (check-in lines), `supabase/tests_v2_checkins.sql` (12).
Not yet: check-ins do not count in the adherence "check-in" score, the weekly review does not use mood data yet, no voice note for meal feelings, no sleep or activity numbers (only the sleep answer), no weekly/monthly overlay beyond the 30-day lines.
