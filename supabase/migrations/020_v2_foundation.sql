-- =============================================================================
-- NutriSmart 2.0 / Phase 1+2: roles, coach-client links, goals, timeline, audit, flags
-- ADDITIVE ONLY. Nothing existing is renamed, dropped or changed in behaviour, so
-- version 1.0 keeps working on the same database.
-- Mapping to existing tables (not duplicated):
--   profiles            -> public.users (+ user_profile, kitchen_profiles)
--   food_logs           -> public.daily_logs        (one row per logged item)
--   energy_logs         -> public.energy_logs       (mood/hunger arrive in Phase 13)
--   water_logs          -> public.water_logs
--   saved_meals         -> public.meal_templates
--   foods               -> public.master_foods
--   audit (admin)       -> public.admin_audit (kept); new generic public.audit_logs
-- =============================================================================

-- ── 1. Coach and client profiles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.coach_profiles (
  user_id      UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 80),
  credentials  TEXT CHECK (char_length(credentials) <= 200),
  bio          TEXT CHECK (char_length(bio) <= 1000),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','suspended')),
  approved_by  UUID,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_profiles (
  user_id       UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  goal_type     TEXT CHECK (goal_type IN ('lose_fat','maintain','build_muscle','blood_sugar','eat_healthier')),
  height_cm     NUMERIC(5,1) CHECK (height_cm IS NULL OR height_cm BETWEEN 80 AND 250),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. Coach <-> client relationships ────────────────────────────────────────
-- The client chooses what the coach may see (share_scope) when accepting.
CREATE TABLE IF NOT EXISTS public.coach_client_relationships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  client_id        UUID REFERENCES public.users(id) ON DELETE CASCADE,
  invite_token_hash TEXT UNIQUE,
  invite_label     TEXT CHECK (char_length(invite_label) <= 80),
  invite_expires_at TIMESTAMPTZ,
  status           TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','paused','ended','declined')),
  share_scope      JSONB NOT NULL DEFAULT '{"food":true,"energy":true,"water":true,"weight":true,"mood":true}',
  invited_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  ended_by         UUID,
  CHECK (client_id IS NULL OR client_id <> coach_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccr_active_pair ON public.coach_client_relationships (coach_id, client_id)
  WHERE status IN ('active','paused');
CREATE INDEX IF NOT EXISTS idx_ccr_coach  ON public.coach_client_relationships (coach_id, status);
CREATE INDEX IF NOT EXISTS idx_ccr_client ON public.coach_client_relationships (client_id, status);

-- ── 3. Goals and targets (history kept: a new row closes the previous one) ───
CREATE TABLE IF NOT EXISTS public.client_goals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  set_by       UUID,
  goal_type    TEXT NOT NULL CHECK (goal_type IN ('lose_fat','maintain','build_muscle','blood_sugar','eat_healthier')),
  target_weight_kg NUMERIC(5,1) CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 20 AND 400),
  target_date  DATE,
  note         TEXT CHECK (char_length(note) <= 500),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_client_goals_client ON public.client_goals (client_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.nutrition_targets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  set_by       UUID,
  source       TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self','coach','system')),
  calories     INTEGER NOT NULL CHECK (calories BETWEEN 800 AND 6000),
  protein_g    INTEGER NOT NULL CHECK (protein_g BETWEEN 0 AND 400),
  carbs_g      INTEGER CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 800),
  fat_g        INTEGER CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 300),
  fiber_g      INTEGER CHECK (fiber_g IS NULL OR fiber_g BETWEEN 0 AND 100),
  water_glasses INTEGER CHECK (water_glasses IS NULL OR water_glasses BETWEEN 0 AND 20),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_nutrition_targets_client ON public.nutrition_targets (client_id, effective_from DESC);

-- ── 4. Central timeline ──────────────────────────────────────────────────────
-- One row per important thing that happened to a person, in time order.
-- scope says which sharing switch lets a coach see it.
CREATE TABLE IF NOT EXISTS public.timeline_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (char_length(event_type) <= 60),
  scope           TEXT NOT NULL DEFAULT 'food' CHECK (scope IN ('food','energy','water','weight','mood','coach','system')),
  occurred_at     TIMESTAMPTZ NOT NULL,
  source_table    TEXT,
  source_id       TEXT,
  payload         JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_timeline_user_time ON public.timeline_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_type_time ON public.timeline_events (event_type, occurred_at DESC);

-- ── 5. Audit log and feature flags ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID,
  actor_role TEXT,
  action     TEXT NOT NULL,
  target_user UUID,
  meta       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_user, created_at DESC);

CREATE TABLE IF NOT EXISTS public.feature_flags (
  key         TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,60}$'),
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.feature_flags (key, enabled, description) VALUES
  ('v2_coach',         FALSE, 'Coach area and coach-client links (2.0)'),
  ('v2_coach_signup',  FALSE, 'Anyone may apply to become a coach'),
  ('v2_coach_auto_approve', FALSE, 'New coaches are approved without admin review'),
  ('v2_flexible_meals',FALSE, 'Flexible meal planner (2.0)'),
  ('v2_checkins',      FALSE, 'Energy and mood check-ins (2.0)')
ON CONFLICT (key) DO NOTHING;

-- ── 6. Helper functions (used by policies and the server) ────────────────────
CREATE OR REPLACE FUNCTION public.is_coach_of(p_client UUID, p_scope TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.coach_client_relationships r
    JOIN public.coach_profiles c ON c.user_id = r.coach_id AND c.status = 'active'
    WHERE r.coach_id = (SELECT auth.uid())
      AND r.client_id = p_client
      AND r.status = 'active'
      AND (p_scope IS NULL OR COALESCE((r.share_scope ->> p_scope)::boolean, FALSE))
  );
$$;

CREATE OR REPLACE FUNCTION public.app_roles(p_user UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'client', TRUE,
    'coach',  EXISTS (SELECT 1 FROM public.coach_profiles WHERE user_id = p_user AND status = 'active'),
    'coach_pending', EXISTS (SELECT 1 FROM public.coach_profiles WHERE user_id = p_user AND status = 'pending'),
    'admin',  EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_user)
  );
$$;

-- Callers may ask only about themselves (the server uses the service role for others).
CREATE OR REPLACE FUNCTION public.my_roles() RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.app_roles((SELECT auth.uid()));
$$;

-- The coach's client list: only people who accepted, with the switches they chose.
CREATE OR REPLACE FUNCTION public.coach_clients()
RETURNS TABLE (relationship_id UUID, client_id UUID, client_name TEXT, status TEXT, share_scope JSONB, accepted_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.client_id, COALESCE(NULLIF(u.name, ''), 'Client'), r.status, r.share_scope, r.accepted_at
  FROM public.coach_client_relationships r
  JOIN public.users u ON u.id = r.client_id
  WHERE r.coach_id = (SELECT auth.uid())
    AND r.status IN ('active','paused')
    AND EXISTS (SELECT 1 FROM public.coach_profiles c WHERE c.user_id = r.coach_id AND c.status = 'active')
  ORDER BY r.accepted_at DESC NULLS LAST
  LIMIT 500;
$$;
GRANT EXECUTE ON FUNCTION public.coach_clients() TO authenticated;

-- ── 7. Timeline triggers (never allowed to break a food, energy or water log) ─
CREATE OR REPLACE FUNCTION public.tl_from_daily_logs() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
      VALUES (OLD.user_id, 'food_deleted', 'food', NOW(), 'daily_logs', OLD.id::text,
              jsonb_build_object('food_name', OLD.food_name, 'meal', OLD.meal, 'cal', OLD.cal),
              'daily_logs:' || OLD.id || ':del')
      ON CONFLICT DO NOTHING;
      RETURN OLD;
    ELSIF TG_OP = 'INSERT' THEN
      INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
      VALUES (NEW.user_id, 'food_logged', 'food', COALESCE(NEW.created_at, NOW()), 'daily_logs', NEW.id::text,
              jsonb_build_object('log_date', NEW.log_date, 'meal', NEW.meal, 'food_name', NEW.food_name,
                                 'cal', NEW.cal, 'protein', NEW.protein, 'carbs', NEW.carbs, 'fat', NEW.fat, 'qty', NEW.qty),
              'daily_logs:' || NEW.id || ':ins')
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
      VALUES (NEW.user_id, 'food_updated', 'food', NOW(), 'daily_logs', NEW.id::text,
              jsonb_build_object('log_date', NEW.log_date, 'meal', NEW.meal, 'food_name', NEW.food_name, 'cal', NEW.cal),
              'daily_logs:' || NEW.id || ':upd:' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
      ON CONFLICT DO NOTHING;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL; -- the timeline is secondary; the log itself must always succeed
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tl_from_energy_logs() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
    VALUES (NEW.user_id, 'energy_logged', 'energy', COALESCE(NEW.log_time, NOW()), 'energy_logs', NEW.id::text,
            jsonb_build_object('log_date', NEW.log_date, 'level', NEW.level, 'meal_before', NEW.meal_before),
            'energy_logs:' || NEW.id || ':ins')
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tl_from_water_logs() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
    VALUES (NEW.user_id, 'water_logged', 'water', NOW(), 'water_logs', NEW.user_id::text || ':' || NEW.log_date,
            jsonb_build_object('log_date', NEW.log_date, 'glasses', NEW.glasses),
            'water_logs:' || NEW.user_id || ':' || NEW.log_date || ':' || NEW.glasses || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tl_daily_logs ON public.daily_logs;
CREATE TRIGGER trg_tl_daily_logs AFTER INSERT OR UPDATE OR DELETE ON public.daily_logs
  FOR EACH ROW EXECUTE FUNCTION public.tl_from_daily_logs();
DROP TRIGGER IF EXISTS trg_tl_energy_logs ON public.energy_logs;
CREATE TRIGGER trg_tl_energy_logs AFTER INSERT ON public.energy_logs
  FOR EACH ROW EXECUTE FUNCTION public.tl_from_energy_logs();
DROP TRIGGER IF EXISTS trg_tl_water_logs ON public.water_logs;
CREATE TRIGGER trg_tl_water_logs AFTER INSERT OR UPDATE ON public.water_logs
  FOR EACH ROW EXECUTE FUNCTION public.tl_from_water_logs();

-- One-time backfill of existing history (safe to re-run).
INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
SELECT d.user_id, 'food_logged', 'food', COALESCE(d.created_at, d.log_date::timestamptz), 'daily_logs', d.id::text,
       jsonb_build_object('log_date', d.log_date, 'meal', d.meal, 'food_name', d.food_name,
                          'cal', d.cal, 'protein', d.protein, 'carbs', d.carbs, 'fat', d.fat, 'qty', d.qty),
       'daily_logs:' || d.id || ':ins'
FROM public.daily_logs d
ON CONFLICT DO NOTHING;
INSERT INTO public.timeline_events (user_id, event_type, scope, occurred_at, source_table, source_id, payload, idempotency_key)
SELECT e.user_id, 'energy_logged', 'energy', COALESCE(e.log_time, e.created_at), 'energy_logs', e.id::text,
       jsonb_build_object('log_date', e.log_date, 'level', e.level, 'meal_before', e.meal_before),
       'energy_logs:' || e.id || ':ins'
FROM public.energy_logs e
ON CONFLICT DO NOTHING;

-- ── 8. Row level security ────────────────────────────────────────────────────
ALTER TABLE public.coach_profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_client_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_goals              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_targets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags             ENABLE ROW LEVEL SECURITY;

-- Writes to coach profiles, relationships, audit logs and flags are server-only (service role bypasses RLS).
DROP POLICY IF EXISTS coach_profiles_read ON public.coach_profiles;
CREATE POLICY coach_profiles_read ON public.coach_profiles FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.coach_client_relationships r
                    WHERE r.coach_id = coach_profiles.user_id AND r.client_id = (SELECT auth.uid()) AND r.status IN ('active','paused')));

DROP POLICY IF EXISTS client_profiles_own ON public.client_profiles;
CREATE POLICY client_profiles_own ON public.client_profiles FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS client_profiles_coach_read ON public.client_profiles;
CREATE POLICY client_profiles_coach_read ON public.client_profiles FOR SELECT TO authenticated
  USING (public.is_coach_of(user_id));

DROP POLICY IF EXISTS ccr_read ON public.coach_client_relationships;
CREATE POLICY ccr_read ON public.coach_client_relationships FOR SELECT TO authenticated
  USING (coach_id = (SELECT auth.uid()) OR client_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS client_goals_read ON public.client_goals;
CREATE POLICY client_goals_read ON public.client_goals FOR SELECT TO authenticated
  USING (client_id = (SELECT auth.uid()) OR public.is_coach_of(client_id));
DROP POLICY IF EXISTS client_goals_write_own ON public.client_goals;
CREATE POLICY client_goals_write_own ON public.client_goals FOR INSERT TO authenticated
  WITH CHECK (client_id = (SELECT auth.uid()) AND set_by = (SELECT auth.uid()));
DROP POLICY IF EXISTS client_goals_write_coach ON public.client_goals;
CREATE POLICY client_goals_write_coach ON public.client_goals FOR INSERT TO authenticated
  WITH CHECK (public.is_coach_of(client_id) AND set_by = (SELECT auth.uid()));

DROP POLICY IF EXISTS nutrition_targets_read ON public.nutrition_targets;
CREATE POLICY nutrition_targets_read ON public.nutrition_targets FOR SELECT TO authenticated
  USING (client_id = (SELECT auth.uid()) OR public.is_coach_of(client_id));
DROP POLICY IF EXISTS nutrition_targets_write_own ON public.nutrition_targets;
CREATE POLICY nutrition_targets_write_own ON public.nutrition_targets FOR INSERT TO authenticated
  WITH CHECK (client_id = (SELECT auth.uid()) AND set_by = (SELECT auth.uid()) AND source = 'self');
DROP POLICY IF EXISTS nutrition_targets_write_coach ON public.nutrition_targets;
CREATE POLICY nutrition_targets_write_coach ON public.nutrition_targets FOR INSERT TO authenticated
  WITH CHECK (public.is_coach_of(client_id) AND set_by = (SELECT auth.uid()) AND source = 'coach');

DROP POLICY IF EXISTS timeline_read ON public.timeline_events;
CREATE POLICY timeline_read ON public.timeline_events FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (scope NOT IN ('system') AND public.is_coach_of(user_id, scope)));

-- audit_logs: no policy for authenticated = no access (service role only).
DROP POLICY IF EXISTS feature_flags_read ON public.feature_flags;
CREATE POLICY feature_flags_read ON public.feature_flags FOR SELECT TO authenticated USING (TRUE);

-- A coach may read the shared logs of their active clients (only the scopes the client allowed).
DROP POLICY IF EXISTS daily_logs_coach_read ON public.daily_logs;
CREATE POLICY daily_logs_coach_read ON public.daily_logs FOR SELECT TO authenticated
  USING (public.is_coach_of(user_id, 'food'));
DROP POLICY IF EXISTS energy_logs_coach_read ON public.energy_logs;
CREATE POLICY energy_logs_coach_read ON public.energy_logs FOR SELECT TO authenticated
  USING (public.is_coach_of(user_id, 'energy'));
DROP POLICY IF EXISTS water_logs_coach_read ON public.water_logs;
CREATE POLICY water_logs_coach_read ON public.water_logs FOR SELECT TO authenticated
  USING (public.is_coach_of(user_id, 'water'));

REVOKE ALL ON FUNCTION public.app_roles(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_roles(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.my_roles(), public.is_coach_of(UUID, TEXT) TO authenticated;
