-- =============================================================================
-- NutriSmart: 003_admin_cms_rpc.sql
-- Module 7 — Admin CMS & Contribution Moderation Engine
--
-- ALL RPCs USE SECURITY DEFINER — they run with the privileges of the
-- function creator (superuser/service role), not the calling user.
-- This allows admin functions to bypass RLS when needed.
--
-- CALLER AUTHENTICATION:
-- All functions verify that the caller is an admin before executing.
-- Admin status is stored in a dedicated admin_users table.
-- Netlify functions pass the admin's JWT; Supabase verifies it via RPC.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. ADMIN USERS TABLE
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'moderator' CHECK (role IN ('moderator', 'super_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- No client access — service role only
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
-- No policies = complete client lockout

-- Helper function used by all RPCs to verify admin status
CREATE OR REPLACE FUNCTION public.is_admin(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users WHERE user_id = p_user_id
  );
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. FULL-TEXT SEARCH VECTORS
--    Pre-computed tsvector columns for fast multi-language food search.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add tsvector column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'master_foods'
      AND column_name  = 'search_vector'
  ) THEN
    ALTER TABLE public.master_foods ADD COLUMN search_vector tsvector;
  END IF;
END $$;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS idx_master_foods_search_vector
  ON public.master_foods USING gin(search_vector);

-- Auto-update trigger for search_vector on insert/update
CREATE OR REPLACE FUNCTION public.update_food_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')),    'A') ||
    setweight(to_tsvector('english', coalesce(NEW.name_hi, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.name_gu, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.region, '')),   'D');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_food_search_vector ON public.master_foods;
CREATE TRIGGER trg_update_food_search_vector
  BEFORE INSERT OR UPDATE ON public.master_foods
  FOR EACH ROW EXECUTE FUNCTION public.update_food_search_vector();

-- Backfill existing rows
UPDATE public.master_foods SET search_vector =
  setweight(to_tsvector('english', coalesce(name, '')),    'A') ||
  setweight(to_tsvector('english', coalesce(name_hi, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(name_gu, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(category, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(region, '')),   'D');

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. upsert_master_food(payload JSONB)
--    Bulk upsert a food entry into master_foods.
--    Automatically computes all search vectors.
--    Caller must be an admin.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_master_food(
  p_calling_user_id UUID,
  p_payload         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id        UUID;
  v_result    JSONB;
BEGIN
  -- Auth check
  IF NOT public.is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: caller % is not an admin', p_calling_user_id;
  END IF;

  -- Extract or generate ID
  v_id := COALESCE((p_payload->>'id')::UUID, gen_random_uuid());

  -- Upsert with explicit column mapping
  -- search_vector is computed by the trigger automatically
  INSERT INTO public.master_foods (
    id, name, name_hi, name_gu,
    category, region, portion, weight_g,
    calories, protein, carbs, fat, fiber,
    gl, gi, type, source, verified
  ) VALUES (
    v_id,
    (p_payload->>'name'),
    (p_payload->>'name_hi'),
    (p_payload->>'name_gu'),
    (p_payload->>'category'),
    (p_payload->>'region'),
    (p_payload->>'portion'),
    (p_payload->>'weight_g')::NUMERIC,
    (p_payload->>'calories')::NUMERIC,
    (p_payload->>'protein')::NUMERIC,
    (p_payload->>'carbs')::NUMERIC,
    (p_payload->>'fat')::NUMERIC,
    (p_payload->>'fiber')::NUMERIC,
    (p_payload->>'gl')::NUMERIC,
    (p_payload->>'gi')::INTEGER,
    COALESCE(p_payload->>'type', 'MR'),
    COALESCE(p_payload->>'source', 'admin'),
    COALESCE((p_payload->>'verified')::BOOLEAN, true)
  )
  ON CONFLICT (id) DO UPDATE SET
    name      = EXCLUDED.name,
    name_hi   = EXCLUDED.name_hi,
    name_gu   = EXCLUDED.name_gu,
    category  = EXCLUDED.category,
    region    = EXCLUDED.region,
    portion   = EXCLUDED.portion,
    weight_g  = EXCLUDED.weight_g,
    calories  = EXCLUDED.calories,
    protein   = EXCLUDED.protein,
    carbs     = EXCLUDED.carbs,
    fat       = EXCLUDED.fat,
    fiber     = EXCLUDED.fiber,
    gl        = EXCLUDED.gl,
    gi        = EXCLUDED.gi,
    type      = EXCLUDED.type,
    source    = EXCLUDED.source,
    verified  = EXCLUDED.verified
  RETURNING id INTO v_id;

  v_result := jsonb_build_object(
    'success', true,
    'food_id', v_id
  );

  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   SQLERRM,
      'code',    SQLSTATE
    );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. approve_food_contribution(contribution_id UUID)
--    Atomic transaction:
--      a. Verify caller is admin
--      b. Fetch contribution payload
--      c. Clone into master_foods via upsert_master_food
--      d. Mark contribution as 'approved' with reviewer ID and timestamp
--    Rolls back entirely if any step fails.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_food_contribution(
  p_calling_user_id UUID,
  p_contribution_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contribution  RECORD;
  v_upsert_result JSONB;
  v_new_food_id   UUID;
BEGIN
  -- Auth check
  IF NOT public.is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: caller % is not an admin', p_calling_user_id;
  END IF;

  -- Fetch the contribution (lock for update to prevent concurrent approvals)
  SELECT * INTO v_contribution
  FROM public.food_contributions
  WHERE id = p_contribution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contribution not found');
  END IF;

  IF v_contribution.status != 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   format('Contribution is already %s', v_contribution.status)
    );
  END IF;

  -- Validate that the payload has minimum required nutrition fields
  IF (v_contribution.payload->>'name') IS NULL
    OR (v_contribution.payload->>'calories')::NUMERIC <= 0
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'Contribution payload missing required fields (name, calories)'
    );
  END IF;

  -- Clone payload into master_foods
  v_upsert_result := public.upsert_master_food(
    p_calling_user_id,
    v_contribution.payload || jsonb_build_object('source', 'community', 'verified', true)
  );

  IF NOT (v_upsert_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'Failed to insert food: %', v_upsert_result->>'error';
  END IF;

  v_new_food_id := (v_upsert_result->>'food_id')::UUID;

  -- Mark contribution as approved
  UPDATE public.food_contributions
  SET
    status        = 'approved',
    reviewed_by   = p_calling_user_id,
    reviewed_at   = NOW(),
    master_food_id = v_new_food_id
  WHERE id = p_contribution_id;

  -- Log admin action
  INSERT INTO public.events (user_id, event_name, properties, created_at)
  VALUES (
    p_calling_user_id,
    'contribution_approved',
    jsonb_build_object(
      'contribution_id', p_contribution_id,
      'new_food_id',     v_new_food_id,
      'food_name',       v_contribution.payload->>'name',
      'submitted_by',    v_contribution.user_id
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success',       true,
    'food_id',       v_new_food_id,
    'food_name',     v_contribution.payload->>'name'
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. reject_food_contribution(contribution_id UUID, reason TEXT)
--    Marks a contribution as rejected with a reason message.
-- ─────────────────────────────────────────────────────────────────────────────

-- Add reviewed_at and master_food_id columns if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='food_contributions' AND column_name='reviewed_at') THEN
    ALTER TABLE public.food_contributions ADD COLUMN reviewed_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='food_contributions' AND column_name='master_food_id') THEN
    ALTER TABLE public.food_contributions ADD COLUMN master_food_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='food_contributions' AND column_name='rejection_reason') THEN
    ALTER TABLE public.food_contributions ADD COLUMN rejection_reason TEXT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reject_food_contribution(
  p_calling_user_id UUID,
  p_contribution_id UUID,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin(p_calling_user_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  UPDATE public.food_contributions
  SET
    status           = 'rejected',
    reviewed_by      = p_calling_user_id,
    reviewed_at      = NOW(),
    rejection_reason = p_reason
  WHERE id = p_contribution_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Contribution not found or already reviewed');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Increment rate limit RPC (called by auth.ts shared middleware)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ,
  count        INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);

CREATE OR REPLACE FUNCTION public.increment_rate_limit(
  p_user_id      UUID,
  p_window_start TIMESTAMPTZ,
  p_limit        INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.rate_limits (user_id, window_start, count)
  VALUES (p_user_id, p_window_start, 1)
  ON CONFLICT (user_id, window_start) DO UPDATE
    SET count = rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'count',   v_count
  );
END;
$$;
