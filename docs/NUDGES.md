# Nudges (Phase 10)

Everything is behind `v2_nudges` (default off). With it off, no endpoint sends and the hourly job does nothing.

Kinds
- **Coach message**: plain text, max 140 characters, no links, one per coach per client per day. Needs an active link. Client can mute (`coach_nudges`).
- **Evening log reminder**: opt-in only (`log_reminders`, default off). Sent between 7 and 9 pm IST, only if nothing is logged that day and the person logged on 3+ of the last 7 days. One per day. A reminder that could not go out on time is dropped, never sent late.

Rules (`functions/_shared/nudgeRules.ts`, one place, unit tested)
- Quiet hours (default 21:30 to 07:30 IST, editable). Coach messages wait and go after quiet hours (queued up to 24 h, then expire).
- Daily cap (default 2, editable 0 to 5, 0 = off), at least 3 hours between nudges.
- No registered device means skipped, with the reason stored.
- Every nudge is a row in `nudges` with status sent/queued/skipped/failed and the reason. Coach sends are also in `audit_logs`.

Running it: GitHub Actions job `nudges` at minute 35 each hour (`.github/workflows/cron.yml`); uses the same `CRON_SECRET` as the other jobs.
Client settings: `/app/nudges` (link in Profile once the flag is on). Existing meal and energy pushes are unchanged.
Tests: `Nudge.test.ts` (11), `supabase/tests_v2_nudges.sql` (9).
Open: nudges are not yet included in data export (Phase 19); push needs the installed app and notification permission.
