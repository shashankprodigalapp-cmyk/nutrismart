# Security (2.0, current)
- RLS on all new tables; browser role cannot write coach_profiles, coach_client_relationships, audit_logs, feature_flags (tested).
- Coach reads limited by `is_coach_of(client, scope)` which requires: active coach profile, active link, scope switched on (tested).
- Server endpoints re-check role from the database; relationship endpoint answers 404 for links you are not part of.
- Invite token: 24 random bytes, hashed at rest, single use, 14-day expiry.
- Audit rows written for: coach_applied, client_invited, invite_accepted, share_scope_changed, relationship_*, coach_approve/suspend.
- Open items: export/delete coverage for new tables, rate limits on coach endpoints, CSP enforcement (see PROGRESS.md).

## 2.1 additions
New tables: RLS on, read-own only, no browser writes. New endpoints require a login (401), switch on (403), and for coach actions an active, sharing relationship (404 otherwise). cron-intel requires the cron secret. Drafts are excluded from export and from the recipient's reads. Regression tests: security.test.ts, tests_v2_intel.sql, I-05, I-09, I-10.
