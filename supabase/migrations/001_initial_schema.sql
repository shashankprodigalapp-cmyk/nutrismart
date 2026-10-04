-- =============================================================================
-- NutriSmart: 001_initial_schema.sql
-- Run this FIRST before 002_rls_policies.sql and 003_admin_cms_rpc.sql
-- =============================================================================

-- ── EXTENSIONS ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for trigram text search

-- ── USERS ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT,
  email           TEXT UNIQUE,
  plan            TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
  tnc_accepted_at TIMESTAMPTZ,
  target_cal      INTEGER DEFAULT 1400,
  target_protein  INTEGER DEFAULT 150,
  target_gl       INTEGER DEFAULT 50,
  target_fat      INTEGER DEFAULT 65,
  target_water    INTEGER DEFAULT 8,
  timezone        TEXT DEFAULT 'Asia/Kolkata',
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create user row on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.users (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── MASTER FOODS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.master_foods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  name_hi    TEXT,
  name_gu    TEXT,
  category   TEXT,
  region     TEXT,
  portion    TEXT NOT NULL DEFAULT '1 serving',
  weight_g   NUMERIC(6,1),
  calories   NUMERIC(6,1) NOT NULL,
  protein    NUMERIC(5,1) NOT NULL DEFAULT 0,
  carbs      NUMERIC(5,1) NOT NULL DEFAULT 0,
  fat        NUMERIC(5,1) NOT NULL DEFAULT 0,
  fiber      NUMERIC(5,1) DEFAULT 0,
  gl         NUMERIC(5,1) NOT NULL DEFAULT 0,
  gi         INTEGER,
  type       TEXT DEFAULT 'MR' CHECK (type IN ('R','MR','OR','NR')),
  source     TEXT DEFAULT 'IFCT',
  verified   BOOLEAN DEFAULT TRUE,
  search_vector tsvector,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_master_foods_name ON public.master_foods USING gin(to_tsvector('english', name));
CREATE INDEX IF NOT EXISTS idx_master_foods_search ON public.master_foods USING gin(search_vector);

-- ── USER CUSTOM FOODS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_custom_foods (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  portion    TEXT NOT NULL,
  weight_g   NUMERIC(6,1),
  calories   NUMERIC(6,1) NOT NULL,
  protein    NUMERIC(5,1) NOT NULL DEFAULT 0,
  carbs      NUMERIC(5,1) NOT NULL DEFAULT 0,
  fat        NUMERIC(5,1) NOT NULL DEFAULT 0,
  gl         NUMERIC(5,1) NOT NULL DEFAULT 0,
  type       TEXT DEFAULT 'MR',
  source     TEXT DEFAULT 'ai_lookup',
  ai_confidence TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_custom_foods_user ON public.user_custom_foods(user_id);

-- ── DAILY LOGS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date     DATE NOT NULL,
  meal         TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','snack','dinner')),
  food_id      UUID,
  food_name    TEXT NOT NULL,
  portion      TEXT NOT NULL,
  qty          NUMERIC(4,2) NOT NULL DEFAULT 1,
  is_home      BOOLEAN DEFAULT TRUE,
  multiplier   NUMERIC(4,3) DEFAULT 1.0,
  cal          NUMERIC(6,1) NOT NULL,
  protein      NUMERIC(5,1) NOT NULL DEFAULT 0,
  carbs        NUMERIC(5,1) NOT NULL DEFAULT 0,
  fat          NUMERIC(5,1) NOT NULL DEFAULT 0,
  gl           NUMERIC(5,1) NOT NULL DEFAULT 0,
  anomaly      BOOLEAN DEFAULT FALSE,
  synced_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON public.daily_logs(user_id, log_date DESC);

-- ── KITCHEN PROFILES ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kitchen_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID UNIQUE NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  oil_usage         TEXT NOT NULL DEFAULT 'moderate',
  who_cooks         TEXT NOT NULL DEFAULT 'me',
  cook_style        TEXT NOT NULL DEFAULT 'mixed',
  home_mult         NUMERIC(4,3) DEFAULT 1.0,
  rest_mult         NUMERIC(4,3) DEFAULT 1.30,
  initial_home_mult NUMERIC(4,3) DEFAULT 1.0,
  logs_used         INTEGER DEFAULT 0,
  calibrated_at     TIMESTAMPTZ,
  manual_override   BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── ENERGY LOGS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.energy_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  log_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  level       TEXT NOT NULL CHECK (level IN ('low','steady','high')),
  meal_before TEXT,
  total_gl    NUMERIC(5,1),
  total_cal   NUMERIC(6,1),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_energy_user_date ON public.energy_logs(user_id, log_date DESC);

-- ── WATER LOGS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.water_logs (
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date   DATE NOT NULL,
  glasses    INTEGER NOT NULL DEFAULT 0 CHECK (glasses >= 0 AND glasses <= 20),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, log_date)
);

-- ── MEAL TEMPLATES ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meal_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  total_cal  NUMERIC(6,1),
  items      JSONB NOT NULL DEFAULT '[]',
  use_count  INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── STREAK DATA ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.streak_data (
  user_id         UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_streak  INTEGER DEFAULT 0,
  longest_streak  INTEGER DEFAULT 0,
  shields         INTEGER DEFAULT 0,
  shields_used    INTEGER DEFAULT 0,
  last_log_date   DATE,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  razorpay_sub_id  TEXT UNIQUE,
  razorpay_cust_id TEXT,
  plan             TEXT NOT NULL DEFAULT 'free',
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('pending','active','grace_period','cancelled','expired')),
  valid_until      TIMESTAMPTZ,
  activated_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  grace_ends_at    TIMESTAMPTZ,
  payment_method   TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── PUSH SUBSCRIPTIONS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL,
  p256dh     TEXT NOT NULL,
  auth_key   TEXT NOT NULL,
  device_ua  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, endpoint)
);

-- ── SYNC QUEUE ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sync_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  action      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  device_id   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  synced_at   TIMESTAMPTZ,
  failed      BOOLEAN DEFAULT FALSE,
  retry_count INTEGER DEFAULT 0
);

-- ── FOOD CONTRIBUTIONS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.food_contributions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  payload          JSONB NOT NULL,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by      UUID,
  reviewed_at      TIMESTAMPTZ,
  master_food_id   UUID,
  rejection_reason TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── PROCESSED WEBHOOKS ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.processed_webhooks (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RATE LIMITS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id      UUID REFERENCES public.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ,
  count        INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);

-- ── EVENTS (analytics) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  properties JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_name_date ON public.events(event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_user ON public.events(user_id, created_at DESC);

-- ── ADMIN USERS ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id    UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('moderator','super_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── send_user_push RPC stub (replace with real VAPID logic) ──────────────────
CREATE OR REPLACE FUNCTION public.send_user_push(
  p_user_id UUID, p_title TEXT, p_body TEXT
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Stub: real implementation sends via pg_net or external worker
  NULL;
END;
$$;

-- ── count_distinct_users_since RPC ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_distinct_users_since(p_since TIMESTAMPTZ)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_count INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_count FROM public.events WHERE created_at >= p_since AND user_id IS NOT NULL;
  RETURN jsonb_build_object('count', v_count);
END;
$$;
