-- =============================================================================
-- NutriSmart: 007_provisional_pro.sql — AUDIT FIX R3 "Pro-while-pending"
-- Run after 006_vector_cache.sql
--
-- The biggest Pro-funnel drop-off is the validation wait: the user's money is
-- gone but Pro isn't. Provisional access flips this — submit UTR, get 24h Pro
-- instantly. A rejected UTR revokes it within the window (fraud backstop).
-- =============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pro_provisional_until TIMESTAMPTZ;

-- Set provisional window server-side when a payment submission is created.
-- Called by submit-payment.ts (service role).
CREATE OR REPLACE FUNCTION public.grant_provisional_pro(
  p_target_user_id UUID,
  p_hours          INTEGER DEFAULT 24
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, plan, status, pro_provisional_until)
  VALUES (p_target_user_id, 'free', 'pending_verification',
          NOW() + (p_hours || ' hours')::INTERVAL)
  ON CONFLICT (user_id) DO UPDATE
    SET pro_provisional_until = NOW() + (p_hours || ' hours')::INTERVAL,
        updated_at = NOW();
  RETURN jsonb_build_object('success', true,
    'provisional_until', (NOW() + (p_hours || ' hours')::INTERVAL)::TEXT);
END;
$$;

-- Rejection revokes provisional access immediately (fraud backstop).
CREATE OR REPLACE FUNCTION public.revoke_provisional_pro(p_target_user_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE public.subscriptions
  SET pro_provisional_until = NULL, updated_at = NOW()
  WHERE user_id = p_target_user_id;
$$;

-- Wire revocation into reject_upi_payment (redefine with revoke call)
CREATE OR REPLACE FUNCTION public.reject_upi_payment(
  p_calling_admin_id UUID,
  p_submission_id    UUID,
  p_reason           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user UUID;
BEGIN
  IF NOT public.is_admin(p_calling_admin_id) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  UPDATE public.payment_submissions
  SET status = 'rejected', reviewed_by = p_calling_admin_id,
      reviewed_at = NOW(), reject_reason = p_reason
  WHERE id = p_submission_id AND status = 'pending'
  RETURNING user_id INTO v_user;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not found or already reviewed');
  END IF;

  -- Kill the 24h provisional window on rejection
  PERFORM public.revoke_provisional_pro(v_user);

  RETURN jsonb_build_object('success', true);
END;
$$;
