# Database (2.0 additions — migration 020)

| New table | Purpose |
|---|---|
| coach_profiles | A coach's public details and approval status (pending/active/suspended). Written by the server only. |
| client_profiles | Per-client goal type and height. Client edits own row. |
| coach_client_relationships | Invite (hashed token, 14-day expiry), then active/paused/ended link with the client's `share_scope`. Server writes only. |
| client_goals, nutrition_targets | Goal and target history. A new row replaces the old one for reading; old rows are the history. Coach may insert for own active clients. |
| timeline_events | Central, idempotent timeline (`UNIQUE(user_id, idempotency_key)`), filled by triggers on daily_logs, energy_logs, water_logs. Triggers can never block a log write. |
| audit_logs | Sensitive actions. No browser access. |
| feature_flags | Rollout switches, readable by signed-in users, written by the server. |

Mapping to the spec's names (existing tables reused, not duplicated): profiles→users; food_logs→daily_logs; saved_meals→meal_templates; foods→master_foods; energy_logs, water_logs unchanged.
Functions: `is_coach_of(client, scope)`, `app_roles(uid)` (server only), `my_roles()`, `coach_clients()`.
Tests: `supabase/tests_v2_rls.sql` (run on a scratch database; prints PASS/FAIL).
