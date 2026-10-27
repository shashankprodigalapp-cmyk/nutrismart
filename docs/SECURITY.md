# Security (2.0, current)
- RLS on all new tables; browser role cannot write coach_profiles, coach_client_relationships, audit_logs, feature_flags (tested).
- Coach reads limited by `is_coach_of(client, scope)` which requires: active coach profile, active link, scope switched on (tested).
- Server endpoints re-check role from the database; relationship endpoint answers 404 for links you are not part of.
- Invite token: 24 random bytes, hashed at rest, single use, 14-day expiry.
- Audit rows written for: coach_applied, client_invited, invite_accepted, share_scope_changed, relationship_*, coach_approve/suspend.
- Open items: export/delete coverage for new tables, rate limits on coach endpoints, CSP enforcement (see PROGRESS.md).
