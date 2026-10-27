# Admin platform (Phase 16)

Open Admin, then "Platform 2.0". Five sections.

- Overview: health checks (each says what it looked at), users, active people, coaches, subscriptions, logging, reviews, notifications.
- AI usage: calls, failures, tokens, speed per feature, recent errors. Cost is not estimated because prices change.
- Coaches: approve or suspend. Audited as coach_approve / coach_suspend.
- Feature switches: turn any existing 2.0 flag on or off. Audited as flag_set. New flags cannot be created from the screen.
- Audit log: latest 100 entries, filter by kind.

## How it works
- `admin_platform_metrics()` (migration 033) counts everything in the database in one call. It is callable by the service role only.
- Endpoints (admin only, checked on the server): `GET /api/admin-platform`, `GET/POST /api/admin-flags`, `GET /api/admin-audit`, `GET/POST /api/admin-coaches`.
- Health thresholds live in `src/lib/adminHealth.ts`. Rates need at least 10 calls before they are judged.

## Tests
`src/tests/v2/AdminHealth.test.ts` (5), `supabase/tests_v2_admin.sql` (6).
## Not done
Cost in rupees, per-user drilldown, alerts by email.
