/**
 * proGatekeeper.ts — Pro Feature Gating (Manual UPI Payment Mode)
 *
 * In this mode:
 *   - Plan state comes from Supabase subscriptions table
 *   - Payment is manual (UPI QR) — no Razorpay integration yet
 *   - Admin activates Pro manually in Supabase after confirming payment
 *   - Realtime subscription updates the UI within seconds of activation
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase }  from '../lib/supabase';
import { useAuth }   from '../context/AuthContext';

// ── PRO FEATURES ──────────────────────────────────────────────────────────────

export const PRO_FEATURES = [
  'ai_food_search',
  'photo_recognition',
  'nl_description',
  'meal_feedback',
  'dinner_suggester',
  'voice_logging',
  'fitness_insights',
] as const;

export type ProFeature = typeof PRO_FEATURES[number];

// ── PLAN STATE ────────────────────────────────────────────────────────────────

export interface PlanState {
  plan:       'free' | 'pro';
  status:     'active' | 'grace_period' | 'cancelled' | 'expired' | 'unknown';
  validUntil:  Date | null;
  graceEndsAt: Date | null;
  isLoading:   boolean;
}

// ── usePlan HOOK ──────────────────────────────────────────────────────────────

export function usePlan(): PlanState {
  const { user } = useAuth();
  const [state, setState] = useState<PlanState>({
    plan:        'free',
    status:      'unknown',
    validUntil:  null,
    graceEndsAt: null,
    isLoading:   true,
  });

  const fetchPlan = useCallback(async () => {
    if (!user) {
      setState(s => ({ ...s, isLoading: false }));
      return;
    }
    const { data } = await supabase
      .from('subscriptions')
      .select('plan, status, valid_until, grace_ends_at, pro_provisional_until')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) {
      setState({ plan: 'free', status: 'unknown', validUntil: null, graceEndsAt: null, isLoading: false });
      return;
    }

    const validUntil  = data.valid_until   ? new Date(data.valid_until)   : null;
    const graceEndsAt = data.grace_ends_at ? new Date(data.grace_ends_at) : null;

    // AUDIT FIX R3 — Pro-while-pending: a live provisional window counts as
    // Pro. Set at UTR submission; revoked if the payment is rejected.
    const provisionalUntil = data.pro_provisional_until
      ? new Date(data.pro_provisional_until) : null;
    const isProvisional = provisionalUntil !== null && provisionalUntil > new Date();

    const isPaidPro = data.plan === 'pro' && data.status === 'active'
      && validUntil !== null && validUntil > new Date();
    const isPro = isPaidPro || isProvisional;

    setState({
      plan:        isPro ? 'pro' : 'free',
      status:      data.status ?? 'unknown',
      validUntil,
      graceEndsAt,
      isLoading:   false,
    });
  }, [user]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  // Realtime: fires when admin activates Pro in Supabase
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`plan-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'subscriptions',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchPlan())
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'subscriptions',
        filter: `user_id=eq.${user.id}`,
      }, () => fetchPlan())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchPlan]);

  return state;
}

// ── UPGRADE MODAL WIRING ──────────────────────────────────────────────────────

type UpgradeCallback = (feature: ProFeature) => void;
let _upgradeCallback: UpgradeCallback | null = null;

export function registerUpgradeModalCallback(cb: UpgradeCallback): void {
  _upgradeCallback = cb;
}

// ── useProGate HOOK ───────────────────────────────────────────────────────────

interface ProGateResult {
  allowed:     boolean;
  isLoading:   boolean;
  showUpgrade: () => void;
}

export function useProGate(feature: ProFeature): ProGateResult {
  const { plan, isLoading } = usePlan();
  const allowed = plan === 'pro';

  const showUpgrade = useCallback(() => {
    _upgradeCallback?.(feature);
  }, [feature]);

  return { allowed, isLoading, showUpgrade };
}

// ── checkProAccess ────────────────────────────────────────────────────────────

export async function checkProAccess(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan, status, valid_until')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return false;
  return (
    data.plan === 'pro' &&
    data.status === 'active' &&
    new Date(data.valid_until) > new Date()
  );
}

export function isFeatureAllowed(feature: string, plan: 'free' | 'pro'): boolean {
  if (!PRO_FEATURES.includes(feature as ProFeature)) return true;
  return plan === 'pro';
}

// ── useAISearchCount — client-side search counter ─────────────────────────────

/**
 * Returns how many AI searches the current user has done today (IST date)
 * and whether they have any remaining.
 *
 * Free users: 5/day. Pro users: 200/day.
 * Reads from the ai_search_log table (updated by the server after each search).
 */
export function useAISearchCount() {
  const { user }             = useAuth();
  const { plan, isLoading }  = usePlan();
  const [count, setCount]    = useState(0);
  const [loadingCount, setLoadingCount] = useState(true);

  const dailyLimit = plan === 'pro' ? 200 : 5;

  const todayIST = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  useEffect(() => {
    if (!user || isLoading) return;

    supabase
      .from('ai_search_log')
      .select('count')
      .eq('user_id', user.id)
      .eq('search_date', todayIST())
      .maybeSingle()
      .then(({ data }) => {
        setCount(data?.count ?? 0);
        setLoadingCount(false);
      });
  }, [user, isLoading]);

  // Realtime: increment count immediately when user does a search
  // (server also updates the table, this is the optimistic client update)
  const incrementLocal = useCallback(() => {
    setCount(c => c + 1);
  }, []);

  const remaining  = Math.max(0, dailyLimit - count);
  const isExhausted = count >= dailyLimit;

  return { count, dailyLimit, remaining, isExhausted, loadingCount, incrementLocal };
}
