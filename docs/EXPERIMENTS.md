# Personal experiments (Phase 15)

A person picks a ready-made template (improve afternoon energy, steadier mood, feel less hungry, log every day), a length (7 or 14 days) and starts today. Templates are fixed in `src/lib/experiments.ts`; nothing is written by AI.

Each day they tick which steps they did. One experiment can run at a time (database rule), so the comparison stays clean.

Result (deterministic, `evaluate`): the average of each chosen measure for the 7 days before the start compared with the days during. Measures: energy, mood, hunger (morning check-in, 1 to 5), share of meals where energy felt lower, protein per day, share of days with food logged.
- At least 3 days of data before and during are needed for a measure; otherwise it says "not enough data yet".
- Changes smaller than 0.3 points (or 5 g protein, or 10 percentage points) are "about the same".
- Hunger and "meals where energy felt lower" count as better when they go down.
- Steps done below 50% adds "this comparison says little about the plan itself".
- Wording: "Energy (morning check-in): averaged 2.9 before and 3.6 during the experiment (7 days vs 7 days)." plus "This is an observation from your own numbers, not proof that the steps caused it." No causal claims, no medical advice.
- A finished experiment is closed on the next visit and its result is saved.

Access: the person owns it. A coach can read experiments and ticks only when the client's `mood` sharing switch is on (shown under "Energy and mood" on the client page). Coaches cannot create or change experiments yet.
Screens: /app/experiments (linked from Energy and mood), coach tab. Flag `v2_experiments` (migration 032). Needs the morning check-in (`v2_checkins`) for the best comparison.
Tests: `Experiments.test.ts` (11), `supabase/tests_v2_experiments.sql` (11).
Not yet: coach-assigned experiments, custom steps, afternoon-only energy (uses the morning check-in and after-meal notes).
