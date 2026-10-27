# AI architecture (2.0)

Three layers, never mixed:
1. **Deterministic layer (SQL).** `compute_weekly_metrics` and the adherence tables do all arithmetic.
2. **Facts layer (`functions/_shared/weeklyReview.ts`).** Turns numbers into labelled facts (id, text, value, previous, change). Facts are hashed; same hash = cached review, no AI call.
3. **Wording layer (Gemini, optional).** Receives only the facts and the person's goal. Must return JSON in which every sentence cites known fact ids and uses only numbers from those facts. Causal and medical wording is rejected. If fewer than 3 items survive, or more are dropped than kept, the plain rule-based review is used.

Guards: needs 3+ logged days for AI; max 3 AI reviews per person per day; 15 s timeout; every call logged in `ai_call_log`; flags `v2_weekly_review` and `v2_ai_reviews` (both default off).
Coached clients: a review is a draft until the coach approves or edits it (`visible_to_client`). People without a coach see it at once.
Confidence: <3 days insufficient, 3–6 early, 7–14 emerging, 15+ repeated. Insights keep their evidence in `ai_insights`.
Tests: `supabase/tests_v2_weekly.sql`, `src/tests/v2/WeeklyReview.test.ts`.
