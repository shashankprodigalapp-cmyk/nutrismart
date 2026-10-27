# Architecture (2.0)

Stack unchanged: React + Vite + Tailwind PWA, Dexie offline store, Cloudflare Pages Functions (`/functions/api`), Supabase Postgres + Auth + RLS, Gemini on the server, Web Push.

## Layers
- Browser: shows what the database lets this person see. Role/flag checks in the browser only decide what to display.
- Pages Functions: privileged work (invites, approvals, AI, push). Authenticate with the Supabase JWT, derive the role from the database (`app_roles`), never from the request.
- Postgres: the final authority. Row Level Security on every table. SECURITY DEFINER helpers (`is_coach_of`, `app_roles`, `coach_clients`) with a fixed search_path.

## Roles
client (everyone) · coach (row in `coach_profiles` with status active) · admin (row in `admin_users`). A person can be a client and a coach. Coaches see a client's data only through an active `coach_client_relationships` row and only the scopes (`share_scope`) that the client switched on.

## Data flow
logs (daily_logs, energy_logs, water_logs) → triggers write `timeline_events` (one idempotent row per event) → later phases compute metrics, adherence, signals, reviews from those tables.

## Safe rollout
Every 2.0 feature sits behind `feature_flags`. Flags are off by default, so 1.0 behaviour is unchanged until a flag is turned on.
