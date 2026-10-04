-- =============================================================================
-- NutriSmart: 005_payment_submissions.sql
-- Module 5/7 Final — UPI-Manual monetization
-- Run after 004_upi_gifted_ai_limits.sql
--
--   1. payment_submissions table (audit trail of every UPI proof submission)
--   2. RLS: users insert/read own; no client updates (admin-only via RPC)
--   3. grant_pro_access(target_user_id)  — instant admin Pro override
--   4. approve_upi_payment(submission_id) — atomic approve + grant
--   5. reject_upi_payment(submission_id, reason)
-- =============================================================================

-- ── 1. PAYMENT SUBMISSIONS TABLE ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payment_submissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,                 -- UTR from user's UPI app
  proof_url      TEXT,                          -- optional screenshot URL
  amount_inr     INTEGER NOT NULL DEFAULT 99,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','approved','rejected')),
  reviewed_by    UUID REFERENCES public.users(id),
  reviewed_at    TIMESTAMPTZ,
  reject_reason  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  -- One UTR can only ever be submitted once, across all users
  CONSTRAINT payment_submissions_utr_unique UNIQUE (transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_submissions_status
  ON public.payment_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_submissions_user
  ON public.payment_submissions(user_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.payment_submissions ENABLE ROW LEVEL SECURITY;

-- Users can submit their own proof
DROP POLICY IF EXISTS "payment_submissions_insert_own" ON public.payment_submissions;
CREATE POLICY "payment_submissions_insert_own"
  ON public.payment_submissions FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Users can see their own submissions (to show "pending validation" status)
DROP POLICY IF EXISTS "payment_submissions_select_own" ON public.payment_submissions;
CREATE POLICY "payment_submissions_select_own"
  ON public.payment_submissions FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- No client UPDATE/DELETE — status changes only via admin RPCs (SECURITY DEFINER)

-- ── 3. grant_pro_access — instant admin override ─────────────────────────────

CREATE OR REPLACE FUNCTION public.grant_pro_access(
  p_calling_admin_id UUID,
  p_target_user_id   UUID,
  p_days             INTEGER DEFAULT 31,
  p_note             TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email TEXT;
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT email INTO v_email FROM public.users WHERE id = p_target_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'User not found');
  END IF;

  -- Upsert subscription → active pro
  INSERT INTO public.subscriptions (
    user_id, plan, status, valid_until,
    payment_source, payment_method, gifted_by, admin_note, activated_at
  ) VALUES (
    p_target_user_id, 'pro', 'active',
    NOW() + (p_days || ' days')::INTERVAL,
    'gifted', 'admin_grant', p_calling_admin_id, p_note, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    plan           = 'pro',
    status         = 'active',
    valid_until    = NOW() + (p_days || ' days')::INTERVAL,
    payment_source = COALESCE(public.subscriptions.payment_source, 'gifted'),
    gifted_by      = p_calling_admin_id,
    admin_note     = COALESCE(p_note, public.subscriptions.admin_note),
    activated_at   = NOW(),
    updated_at     = NOW();

  UPDATE public.users SET plan = 'pro', updated_at = NOW()
  WHERE id = p_target_user_id;

  INSERT INTO public.events (user_id, event_name, properties, created_at)
  VALUES (p_calling_admin_id, 'pro_access_granted',
    jsonb_build_object('target_user_id', p_target_user_id, 'email', v_email,
                       'days', p_days, 'note', p_note),
    NOW());

  RETURN jsonb_build_object('success', true, 'email', v_email);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- NOTE: subscriptions needs a UNIQUE(user_id) for the ON CONFLICT above.
-- Add it if not present (safe if some users have multiple rows — keep latest).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_unique'
  ) THEN
    -- Remove duplicates first (keep most recent per user)
    DELETE FROM public.subscriptions s
    USING public.subscriptions s2
    WHERE s.user_id = s2.user_id AND s.created_at < s2.created_at;

    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
  END IF;
END $$;

-- ── 4. approve_upi_payment — atomic approve + grant ──────────────────────────

CREATE OR REPLACE FUNCTION public.approve_upi_payment(
  p_calling_admin_id UUID,
  p_submission_id    UUID,
  p_days             INTEGER DEFAULT 31
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sub    RECORD;
  v_result JSONB;
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  -- Lock the submission row to prevent concurrent double-approval
  SELECT * INTO v_sub
  FROM public.payment_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Submission not found');
  END IF;

  IF v_sub.status != 'pending' THEN
    RETURN jsonb_build_object('success', false,
      'error', format('Submission already %s', v_sub.status));
  END IF;

  -- Mark approved
  UPDATE public.payment_submissions
  SET status = 'approved', reviewed_by = p_calling_admin_id, reviewed_at = NOW()
  WHERE id = p_submission_id;

  -- Grant Pro via the shared function (raises on failure → rolls back both)
  v_result := public.grant_pro_access(
    p_calling_admin_id, v_sub.user_id, p_days,
    'UPI payment approved · UTR ' || v_sub.transaction_id
  );

  IF NOT (v_result->>'success')::BOOLEAN THEN
    RAISE EXCEPTION 'grant failed: %', v_result->>'error';
  END IF;

  -- Mark payment_source correctly (grant sets 'gifted'; this was a real payment)
  UPDATE public.subscriptions
  SET payment_source = 'upi_manual', payment_method = 'upi',
      upi_transaction_id = v_sub.transaction_id
  WHERE user_id = v_sub.user_id;

  RETURN jsonb_build_object('success', true,
    'user_id', v_sub.user_id, 'utr', v_sub.transaction_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 5. reject_upi_payment ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reject_upi_payment(
  p_calling_admin_id UUID,
  p_submission_id    UUID,
  p_reason           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  UPDATE public.payment_submissions
  SET status = 'rejected', reviewed_by = p_calling_admin_id,
      reviewed_at = NOW(), reject_reason = p_reason
  WHERE id = p_submission_id AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not found or already reviewed');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
