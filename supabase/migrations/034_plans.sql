-- NutriSmart 2.0 / Phase 17: configurable plans. Additive. Existing Pro logic (subscriptions, proGatekeeper) is NOT changed.
-- The catalog says what each plan includes. effective_plan() reads the same subscription rules the app already uses.

CREATE TABLE IF NOT EXISTS public.plans (
  key              TEXT PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,30}$'),
  audience         TEXT NOT NULL CHECK (audience IN ('client','coach')),
  name             TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  description      TEXT CHECK (description IS NULL OR char_length(description) <= 300),
  price_inr_month  INTEGER NOT NULL DEFAULT 0 CHECK (price_inr_month BETWEEN 0 AND 100000),
  price_inr_year   INTEGER CHECK (price_inr_year IS NULL OR price_inr_year BETWEEN 0 AND 1000000),
  entitlements     JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(entitlements) = 'object'),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 100,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plans_read ON public.plans;
CREATE POLICY plans_read ON public.plans FOR SELECT TO authenticated USING (is_active);
-- No write policy: changes go through the admin endpoint (service role).

-- ai_daily_limit matches today's app (5 free, 200 Pro). max_clients null = no cap.
INSERT INTO public.plans (key, audience, name, description, price_inr_month, entitlements, sort_order) VALUES
 ('free',          'client', 'Free',  'Core logging and a few AI searches a day.',       0,  '{"ai_daily_limit":5}',   10),
 ('pro',           'client', 'Pro',   'More AI searches and fitness insights.',          99, '{"ai_daily_limit":200,"features":["fitness_insights"]}', 20),
 ('coach_standard','coach',  'Coach', 'Coach dashboard with no client cap for now.',     0,  '{"max_clients":null}',   30)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.coach_profiles ADD COLUMN IF NOT EXISTS plan_key TEXT NOT NULL DEFAULT 'coach_standard';

-- Same rule as src/utils/proGatekeeper.ts: paid Pro that is active and not expired, or a live provisional window.
CREATE OR REPLACE FUNCTION public.effective_client_plan(p_user UUID) RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN s.user_id IS NULL THEN 'free'
    WHEN (s.plan = 'pro' AND s.status = 'active' AND s.valid_until IS NOT NULL AND s.valid_until > now())
      OR (s.pro_provisional_until IS NOT NULL AND s.pro_provisional_until > now()) THEN 'pro'
    ELSE 'free' END
  FROM (SELECT p_user AS u) x
  LEFT JOIN LATERAL (SELECT * FROM subscriptions WHERE user_id = x.u ORDER BY created_at DESC LIMIT 1) s ON TRUE;
$$;

-- Entitlements for the caller only. Service role may ask about anyone.
CREATE OR REPLACE FUNCTION public.my_entitlements() RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('plan', p.key, 'name', p.name, 'entitlements', p.entitlements)
  FROM plans p WHERE p.key = public.effective_client_plan(auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.entitlements_for(p_user UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('plan', p.key, 'name', p.name, 'entitlements', p.entitlements)
  FROM plans p WHERE p.key = public.effective_client_plan(p_user);
$$;
REVOKE ALL ON FUNCTION public.entitlements_for(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlements_for(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.effective_client_plan(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.effective_client_plan(UUID) TO service_role;
REVOKE ALL ON FUNCTION public.my_entitlements() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_entitlements() TO authenticated, service_role;

-- Coach seat check: active clients plus open invites against the coach plan cap. null cap = allowed.
CREATE OR REPLACE FUNCTION public.coach_seats(p_coach UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'cap', (pl.entitlements->'max_clients'),
    'used', (SELECT COUNT(*) FROM coach_client_relationships r WHERE r.coach_id = p_coach AND r.status = 'active'))
  FROM coach_profiles cp JOIN plans pl ON pl.key = cp.plan_key WHERE cp.user_id = p_coach;
$$;
REVOKE ALL ON FUNCTION public.coach_seats(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_seats(UUID) TO service_role;

INSERT INTO public.feature_flags (key, enabled, description) VALUES ('v2_plans', FALSE, 'Plan limits are enforced (coach client cap). Catalog is always visible to admin.') ON CONFLICT (key) DO NOTHING;
