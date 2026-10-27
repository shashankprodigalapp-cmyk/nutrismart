# Needs Attention (Phase 9)

- Signals come from the same deterministic rules as the dashboard (`src/lib/coachMetrics.ts`): logging decline or stopped, protein and calorie deviation, energy decline. Each carries its own reason text with the numbers.
- Nothing is stored as a "signal", so it can never be stale. Only the coach's response is stored (`attention_actions`): snooze (1-30 days) or dismiss.
- A dismissed signal stays hidden unless it gets worse (drifting to attention). A snoozed one returns when the snooze ends.
- Ranking (`src/lib/attention.ts`): attention = 10 points, drifting = 4, no activity +6, plus half a point per quiet day (max 7).
- Only the coach's own server call writes actions, after checking the active link. The browser can only read its own rows.
- Flag: `v2_attention`. Tests: `Attention.test.ts`, `supabase/tests_v2_attention.sql`.
- Not here yet: messaging the client from the panel (Phase 10, nudges).
