# Security hardening (Phase 19)

## Problems found in the audit and fixed (migration 036)
1. **Any signed-in user could give themselves Pro.** `grant_provisional_pro` was callable from the browser. Now server-only.
2. **Admin functions trusted a caller-supplied admin id.** Anyone who learned an admin's id could pass it. `is_admin()` now requires the id to be the signed-in caller's own, or the request to come from the server. A NULL answer (anonymous caller) is now a clear "no".
3. **Server helpers open to any signed-in user:** `revoke_provisional_pro`, `increment_rate_limit` (could burn someone's AI allowance), `is_quiet_hours`, `retention_health_check`, `count_distinct_users_since`, `get_user_percentile` (read another person's percentile). Now server-only.
4. **`kitchen_impact_analysis(user)` returned any person's food and energy pattern.** It now answers only for the caller (or the server).

The 1.0 admin screens and payment flow call these the same way as before, so they keep working. Checked: every browser caller passes the signed-in person's own id.

## Added
- **Rate limits** on 2.0 write endpoints (per person, short window): coach apply 3/hour, accept 20/hour, invite 20/hour, nudge 30/hour, attention actions 60/min, review decisions 30/min, relationship changes 30/hour, review views 60/hour. Over the limit gives a friendly 429 with Retry-After. If the counter itself fails, the request goes through.
- **Data export** now covers 35 tables, including every 2.0 table. Not exported: coach drafts not yet shown to the person, the invite-link hash, and the internal audit log. `ExportCoverage.test.ts` fails if a new person-linked table is neither exported nor listed with a reason.
- **Account deletion** calls `erase_user_traces` first. Everything else already deleted with the account (checked across 45 user-linked columns). Rows that must stay (audit log, review decisions) no longer name the person.

## Checked, no change needed
Every API function requires a signed-in user, a role, the cron secret or a payment signature. No keys found in the repository. Row-level security is on for every table; tables with no policy are server-only by design.

## Still open (your decisions)
- CSP is still report-only. Enforce it after a week without reports.
- Row-level read policy on `user_profile` is public-readable: confirm that is intended.
- Make the repository private; privacy policy needs a line on the browser speech service (voice).
- Lawyer review of coach data sharing and retention periods.

## Tests
`supabase/tests_v2_security.sql` (30), `ExportCoverage.test.ts` (43).
