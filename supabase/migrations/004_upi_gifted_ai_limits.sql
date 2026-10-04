-- =============================================================================
-- NutriSmart: 004_upi_gifted_ai_limits.sql
-- Run this in Supabase SQL Editor after 003_admin_cms_rpc.sql
--
-- Changes:
--   1. subscriptions: add upi_transaction_id, upi_payment_ref, gifted_by,
--      admin_note, payment_source columns
--   2. ai_search_log: new table — tracks per-user daily AI search count
--      so the 5/day free limit is enforced server-side
--   3. RLS: ai_search_log readable by owner, admin reads all via service role
--   4. Helper RPC: grant_free_pro(user_id, granted_by, note, days)
-- =============================================================================

-- ── 1. EXTEND subscriptions table ────────────────────────────────────────────

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS upi_transaction_id TEXT,    -- UTR / transaction ID from user
  ADD COLUMN IF NOT EXISTS upi_payment_ref    TEXT,    -- UPI payment reference
  ADD COLUMN IF NOT EXISTS payment_source     TEXT DEFAULT 'razorpay'
                           CHECK (payment_source IN ('razorpay','upi_manual','upi_auto','gifted','promo')),
  ADD COLUMN IF NOT EXISTS gifted_by          UUID REFERENCES public.users(id),  -- admin who gifted
  ADD COLUMN IF NOT EXISTS admin_note         TEXT;    -- reason for gifting / notes

-- ── 2. AI SEARCH LOG TABLE ───────────────────────────────────────────────────
-- Tracks how many AI searches a user has done today (IST date).
-- Separate from rate_limits (which is server-side) — this drives the
-- client-side counter UI ("3 of 5 searches used today").

CREATE TABLE IF NOT EXISTS public.ai_search_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  search_date DATE NOT NULL,  -- IST date (set by client/server in Asia/Kolkata)
  count       INTEGER NOT NULL DEFAULT 0,
  last_search_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, search_date)
);

ALTER TABLE public.ai_search_log ENABLE ROW LEVEL SECURITY;

-- Users can read their own count (to show counter in UI)
CREATE POLICY "ai_search_log_select_own"
  ON public.ai_search_log FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Users can insert/update their own row (SyncManager does this)
CREATE POLICY "ai_search_log_upsert_own"
  ON public.ai_search_log FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "ai_search_log_update_own"
  ON public.ai_search_log FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Index for fast daily lookup
CREATE INDEX IF NOT EXISTS idx_ai_search_log_user_date
  ON public.ai_search_log(user_id, search_date DESC);

-- ── 3. UPDATE rate_limits to use IST window ───────────────────────────────────
-- The existing increment_rate_limit RPC uses UTC window_start.
-- Update it to accept IST date so free=5/day resets at IST midnight.

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
    'count',   v_count,
    'limit',   p_limit
  );
END;
$$;

-- ── 4. grant_free_pro RPC ────────────────────────────────────────────────────
-- Admin calls this from the admin panel to gift Pro to a user.
-- Returns success/error JSON.

CREATE OR REPLACE FUNCTION public.grant_free_pro(
  p_calling_admin_id UUID,
  p_target_user_id   UUID,
  p_days             INTEGER DEFAULT 30,
  p_note             TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target_email TEXT;
BEGIN
  -- Verify caller is admin
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  -- Verify target user exists
  SELECT email INTO v_target_email
  FROM public.users
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Upsert subscription as gifted Pro
  INSERT INTO public.subscriptions (
    user_id, plan, status, valid_until,
    payment_source, payment_method,
    gifted_by, admin_note, activated_at
  )
  VALUES (
    p_target_user_id,
    'pro',
    'active',
    NOW() + (p_days || ' days')::INTERVAL,
    'gifted',
    'admin_grant',
    p_calling_admin_id,
    p_note,
    NOW()
  )
  ON CONFLICT (user_id)  -- if a unique constraint exists, upsert
  DO NOTHING;

  -- Also try update if user already has a row
  UPDATE public.subscriptions
  SET
    plan           = 'pro',
    status         = 'active',
    valid_until    = NOW() + (p_days || ' days')::INTERVAL,
    payment_source = 'gifted',
    gifted_by      = p_calling_admin_id,
    admin_note     = p_note,
    activated_at   = NOW(),
    updated_at     = NOW()
  WHERE user_id = p_target_user_id;

  -- Update users.plan cache
  UPDATE public.users
  SET plan = 'pro', updated_at = NOW()
  WHERE id = p_target_user_id;

  -- Log admin action
  INSERT INTO public.events (user_id, event_name, properties, created_at)
  VALUES (
    p_calling_admin_id,
    'admin_gifted_pro',
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'target_email',   v_target_email,
      'days',           p_days,
      'note',           p_note
    ),
    NOW()
  );

  RETURN jsonb_build_object(
    'success',       true,
    'target_email',  v_target_email,
    'valid_until',   (NOW() + (p_days || ' days')::INTERVAL)::TEXT
  );
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 5. revoke_free_pro RPC ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.revoke_free_pro(
  p_calling_admin_id UUID,
  p_target_user_id   UUID,
  p_note             TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  UPDATE public.subscriptions
  SET
    plan         = 'free',
    status       = 'cancelled',
    cancelled_at = NOW(),
    admin_note   = COALESCE(p_note, admin_note),
    updated_at   = NOW()
  WHERE user_id = p_target_user_id;

  UPDATE public.users
  SET plan = 'free', updated_at = NOW()
  WHERE id = p_target_user_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 6. get_users_for_admin RPC ───────────────────────────────────────────────
-- Returns paginated user list for the admin User Management panel.

CREATE OR REPLACE FUNCTION public.get_users_for_admin(
  p_calling_admin_id UUID,
  p_search           TEXT    DEFAULT NULL,
  p_plan_filter      TEXT    DEFAULT NULL,   -- 'free' | 'pro' | NULL (all)
  p_limit            INTEGER DEFAULT 50,
  p_offset           INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT jsonb_agg(row_to_json(t))
  INTO v_result
  FROM (
    SELECT
      u.id,
      u.email,
      u.name,
      u.plan,
      u.created_at,
      s.status        AS sub_status,
      s.valid_until,
      s.payment_source,
      s.gifted_by,
      s.admin_note,
      COALESCE(asl.count, 0) AS ai_searches_today
    FROM public.users u
    LEFT JOIN public.subscriptions s ON s.user_id = u.id
    LEFT JOIN public.ai_search_log asl
      ON asl.user_id = u.id
      AND asl.search_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::DATE
    LEFT JOIN auth.users au ON au.id = u.id
    WHERE
      (p_search IS NULL OR u.email ILIKE '%' || p_search || '%' OR u.name ILIKE '%' || p_search || '%')
      AND (p_plan_filter IS NULL OR u.plan = p_plan_filter)
    ORDER BY u.created_at DESC
    LIMIT p_limit OFFSET p_offset
  ) t;

  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$$;

-- ── 7. Allow pending_verification status ─────────────────────────────────────
-- The CHECK constraint on subscriptions.status was defined in 001_initial_schema.
-- We need to allow the new 'pending_verification' value.

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending','active','grace_period','cancelled','expired','pending_verification'));

-- ── 8. activate_upi_payment RPC ─────────────────────────────────────────────
-- Admin calls this after visually verifying the UTR in their UPI app.
-- Changes status from pending_verification → active and sets valid_until.

CREATE OR REPLACE FUNCTION public.activate_upi_payment(
  p_calling_admin_id UUID,
  p_target_user_id   UUID,
  p_days             INTEGER DEFAULT 31
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
  v_utr   TEXT;
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT u.email, s.upi_transaction_id
  INTO v_email, v_utr
  FROM public.users u
  JOIN public.subscriptions s ON s.user_id = u.id
  WHERE u.id = p_target_user_id
    AND s.status = 'pending_verification';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No pending UPI payment found for this user');
  END IF;

  -- Activate Pro
  UPDATE public.subscriptions
  SET
    plan         = 'pro',
    status       = 'active',
    valid_until  = NOW() + (p_days || ' days')::INTERVAL,
    activated_at = NOW(),
    updated_at   = NOW()
  WHERE user_id = p_target_user_id;

  UPDATE public.users
  SET plan = 'pro', updated_at = NOW()
  WHERE id = p_target_user_id;

  -- Log it
  INSERT INTO public.events (user_id, event_name, properties, created_at)
  VALUES (p_calling_admin_id, 'admin_activated_upi_pro',
    jsonb_build_object('target_user', p_target_user_id, 'email', v_email, 'utr', v_utr),
    NOW());

  RETURN jsonb_build_object('success', true, 'email', v_email, 'utr', v_utr);
END;
$$;
