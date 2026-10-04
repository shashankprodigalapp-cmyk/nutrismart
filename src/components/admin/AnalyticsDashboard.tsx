/**
 * AnalyticsDashboard.tsx — NutriSmart Admin Analytics Dashboard
 * Module 8, Step 8.2
 *
 * PANELS:
 *   SubscriptionHealth  — MRR, active/grace/churned counts, payment failure rate
 *   DAU/MAU             — Rolling trend line (SVG sparkline), ratio card
 *   OnboardingFunnel    — 5-stage funnel with conversion % at each drop-off
 *   AIUsageBreakdown    — Name / Describe / Photo search volumes
 *   TimeFrameFilter     — 24h / 7d / 30d / YTD, smooth data refresh
 *
 * Data fetched from /.netlify/functions/get-admin-analytics.
 * All charts are pure SVG — no external chart library dependency.
 * IST timezone shown on timestamps.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../../lib/supabase';
import { useAuth }  from '../../context/AuthContext';

// ── TYPES ─────────────────────────────────────────────────────────────────────

type TimeFrame = '24h' | '7d' | '30d' | 'ytd';

interface DAUTrend { date: string; count: number; }

interface AnalyticsData {
  generated_at:  string;
  time_frame:    TimeFrame;
  dau_mau: {
    dau:       number;
    mau:       number;
    ratio:     number;
    dau_trend: DAUTrend[];
  };
  onboarding_funnel: {
    splash_views:   number;
    auth_attempts:  number;
    tnc_accepts:    number;
    profiling_done: number;
    first_log:      number;
    conversion_rates: {
      splash_to_auth:       number;
      auth_to_tnc:          number;
      tnc_to_profile:       number;
      profile_to_first_log: number;
      overall:              number;
    };
  };
  subscriptions: {
    total_active:         number;
    total_free:           number;
    total_grace:          number;
    total_churned:        number;
    mrr:                  number;
    payment_failure_rate: number;
    grace_recovery_rate:  number;
    plan_breakdown:       Array<{ plan: string; count: number }>;
  };
  ai_usage: {
    total_searches:         number;
    name_searches:          number;
    description_searches:   number;
    photo_searches:         number;
    ai_search_rate:         number;
  };
}

// ── SVG SPARKLINE ─────────────────────────────────────────────────────────────

function Sparkline({
  data, color = '#C8F75E', height = 48, width = 200,
}: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;

  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
      <defs>
        <linearGradient id={`sg-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts} ${width},${height}`}
        fill={`url(#sg-${color.replace('#', '')})`}
      />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

// ── FUNNEL BAR ────────────────────────────────────────────────────────────────

function FunnelBar({
  label, value, max, pct, color = '#C8F75E',
}: { label: string; value: number; max: number; pct?: number; color?: string }) {
  const width = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[12px] text-[#A1A1A1]">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-[#F5F5F5]">{value.toLocaleString()}</span>
          {pct !== undefined && (
            <span className="text-[10px] text-[#636366]">{pct}%</span>
          )}
        </div>
      </div>
      <div className="h-2 bg-[#242426] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
    </div>
  );
}

// ── STAT CARD ─────────────────────────────────────────────────────────────────

function StatCard({
  title, value, sub, color = '#C8F75E', trend,
}: { title: string; value: string | number; sub?: string; color?: string; trend?: 'up' | 'down' | 'neutral' }) {
  return (
    <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-4">
      <p className="text-[10px] text-[#636366] uppercase tracking-[1px] mb-2">{title}</p>
      <div className="flex items-end gap-2">
        <span className="font-['Playfair_Display'] text-[28px] font-black leading-none" style={{ color }}>
          {value}
        </span>
        {trend && (
          <span className={`text-[14px] mb-0.5 ${trend === 'up' ? 'text-green-400' : trend === 'down' ? 'text-red-400' : 'text-[#636366]'}`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </span>
        )}
      </div>
      {sub && <p className="text-[11px] text-[#636366] mt-1">{sub}</p>}
    </div>
  );
}

// ── DONUT CHART ───────────────────────────────────────────────────────────────

function DonutSlice({
  slices,
}: { slices: Array<{ label: string; value: number; color: string }> }) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const R = 40, CX = 60, CY = 60, r = 25;
  let cumPct = 0;

  const paths = slices.map((s) => {
    const pct   = s.value / total;
    const start = cumPct * 2 * Math.PI - Math.PI / 2;
    const end   = (cumPct + pct) * 2 * Math.PI - Math.PI / 2;
    cumPct      += pct;

    const x1 = CX + R * Math.cos(start);
    const y1 = CY + R * Math.sin(start);
    const x2 = CX + R * Math.cos(end);
    const y2 = CY + R * Math.sin(end);
    const largeArc = pct > 0.5 ? 1 : 0;

    return (
      <path
        key={s.label}
        d={`M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`}
        fill={s.color}
        opacity={0.85}
      />
    );
  });

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" width="90" height="90">
        {paths}
        <circle cx={CX} cy={CY} r={r} fill="#1C1C1E" />
      </svg>
      <div className="flex flex-col gap-1.5">
        {slices.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
            <span className="text-[11px] text-[#A1A1A1]">{s.label}</span>
            <span className="text-[11px] font-semibold text-[#F5F5F5]">
              {s.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SECTION HEADER ────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[14px] font-bold text-[#F5F5F5]">{title}</h2>
      {sub && <p className="text-[11px] text-[#636366] mt-0.5">{sub}</p>}
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export function AnalyticsDashboard() {
  const { user }                  = useAuth();
  const [data,      setData]      = useState<AnalyticsData | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [frame,     setFrame]     = useState<TimeFrame>('30d');
  const [isAdmin,   setIsAdmin]   = useState(false);
  const abortRef                  = useRef<AbortController>();

  // Admin check
  useEffect(() => {
    if (!user) return;
    supabase
      .from('admin_users')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data: d }) => setIsAdmin(!!d));
  }, [user]);

  // Fetch analytics
  const fetchData = useCallback(async (f: TimeFrame) => {
    if (!user) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(
        `/.netlify/functions/get-admin-analytics?frame=${f}`,
        {
          headers:  { Authorization: `Bearer ${token}` },
          signal:   abortRef.current.signal,
        }
      );

      if (res.status === 403) throw new Error('Admin access required');
      if (!res.ok) throw new Error(`Server error: ${res.status}`);

      const json: AnalyticsData = await res.json();
      setData(json);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message ?? 'Failed to load analytics');
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isAdmin) fetchData(frame);
  }, [isAdmin, frame, fetchData]);

  if (!isAdmin) {
    return (
      <div className="min-h-dvh bg-[#111113] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[32px] mb-3">🔒</p>
          <p className="text-[14px] text-[#A1A1A1]">Admin access required</p>
        </div>
      </div>
    );
  }

  const timeFrames: { key: TimeFrame; label: string }[] = [
    { key: '24h',  label: '24h' },
    { key: '7d',   label: '7 Days' },
    { key: '30d',  label: '30 Days' },
    { key: 'ytd',  label: 'YTD' },
  ];

  return (
    <div className="min-h-dvh bg-[#111113] pb-10">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        <h1 className="font-['Playfair_Display'] text-[26px] font-black text-[#F5F5F5]">
          System Analytics
        </h1>
        <p className="text-[11px] text-[#636366] mt-1">
          {data?.generated_at
            ? `Updated ${new Date(data.generated_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST`
            : 'Loading…'}
        </p>
      </div>

      {/* Time frame selector */}
      <div className="px-4 mb-5">
        <div className="flex bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-1 gap-1">
          {timeFrames.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFrame(key)}
              className={`flex-1 py-2 rounded-lg text-[11px] font-semibold transition-all ${
                frame === key ? 'bg-[#C8F75E] text-[#111113]' : 'text-[#636366]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="px-4 flex flex-col gap-3">
          {[1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-[#1C1C1E] border border-white/[0.07] rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mx-4 bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-center">
          <p className="text-[13px] text-red-400 mb-2">{error}</p>
          <button onClick={() => fetchData(frame)} className="text-[12px] text-[#C8F75E]">Retry</button>
        </div>
      )}

      {/* Data panels */}
      {data && !loading && (
        <div className="px-4 flex flex-col gap-5">

          {/* ── Subscription health ── */}
          <div>
            <SectionHeader
              title="Subscription Health"
              sub={`MRR: ₹${data.subscriptions.mrr.toLocaleString('en-IN')}/mo`}
            />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <StatCard
                title="Active Pro"
                value={data.subscriptions.total_active}
                sub="paying subscribers"
                color="#6BCB77"
                trend="up"
              />
              <StatCard
                title="MRR"
                value={`₹${(data.subscriptions.mrr / 1000).toFixed(1)}k`}
                sub="monthly recurring"
                color="#C8F75E"
              />
              <StatCard
                title="Grace Period"
                value={data.subscriptions.total_grace}
                sub="payment failed"
                color="#FFD93D"
                trend={data.subscriptions.total_grace > 0 ? 'down' : 'neutral'}
              />
              <StatCard
                title="Churned"
                value={data.subscriptions.total_churned}
                sub="cancelled/expired"
                color="#FF6B6B"
              />
            </div>

            {/* Payment failure rate */}
            <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-4 mb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] text-[#636366]">Payment failure rate</span>
                <span className={`text-[14px] font-bold ${
                  data.subscriptions.payment_failure_rate > 10 ? 'text-[#FF6B6B]' : 'text-[#6BCB77]'
                }`}>
                  {data.subscriptions.payment_failure_rate}%
                </span>
              </div>
              <div className="h-2 bg-[#242426] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(data.subscriptions.payment_failure_rate, 100)}%`,
                    background: data.subscriptions.payment_failure_rate > 10 ? '#FF6B6B' : '#6BCB77',
                    transition: 'width 0.7s ease',
                  }}
                />
              </div>
              <div className="flex justify-between items-center mt-2">
                <span className="text-[11px] text-[#636366]">Grace recovery rate</span>
                <span className="text-[13px] font-semibold text-[#6BCB77]">
                  {data.subscriptions.grace_recovery_rate}%
                </span>
              </div>
            </div>

            {/* Plan breakdown donut */}
            <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-4">
              <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-3">Plan breakdown</p>
              <DonutSlice
                slices={[
                  { label: 'Pro (active)', value: data.subscriptions.total_active,  color: '#C8F75E' },
                  { label: 'Free',         value: data.subscriptions.total_free,    color: '#8DB4FF' },
                  { label: 'Grace period', value: data.subscriptions.total_grace,   color: '#FFD93D' },
                  { label: 'Churned',      value: data.subscriptions.total_churned, color: '#FF6B6B' },
                ]}
              />
            </div>
          </div>

          {/* ── DAU / MAU ── */}
          <div>
            <SectionHeader
              title="User Activity"
              sub={`DAU/MAU ratio: ${(data.dau_mau.ratio * 100).toFixed(1)}%`}
            />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <StatCard title="DAU" value={data.dau_mau.dau} sub="active today" color="#C8F75E" />
              <StatCard title="MAU" value={data.dau_mau.mau} sub="active this month" color="#8DB4FF" />
            </div>

            {data.dau_mau.dau_trend.length > 1 && (
              <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-4">
                <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-3">
                  Daily active users — last 30 days
                </p>
                <Sparkline
                  data={data.dau_mau.dau_trend.map(d => d.count)}
                  color="#C8F75E"
                  height={56}
                />
                <div className="flex justify-between text-[9px] text-[#636366] mt-1">
                  <span>{data.dau_mau.dau_trend[0]?.date}</span>
                  <span>{data.dau_mau.dau_trend[data.dau_mau.dau_trend.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </div>

          {/* ── Onboarding funnel ── */}
          <div>
            <SectionHeader
              title="Onboarding Funnel"
              sub={`Overall conversion: ${data.onboarding_funnel.conversion_rates.overall}%`}
            />
            <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-4">
              {[
                { label: '1. Splash view',       value: data.onboarding_funnel.splash_views,   pct: undefined },
                { label: '2. Auth attempt',       value: data.onboarding_funnel.auth_attempts,  pct: data.onboarding_funnel.conversion_rates.splash_to_auth },
                { label: '3. T&C accepted',       value: data.onboarding_funnel.tnc_accepts,    pct: data.onboarding_funnel.conversion_rates.auth_to_tnc },
                { label: '4. Profile completed',  value: data.onboarding_funnel.profiling_done, pct: data.onboarding_funnel.conversion_rates.tnc_to_profile },
                { label: '5. First food logged',  value: data.onboarding_funnel.first_log,      pct: data.onboarding_funnel.conversion_rates.profile_to_first_log },
              ].map(({ label, value, pct }) => (
                <FunnelBar
                  key={label}
                  label={label}
                  value={value}
                  max={data.onboarding_funnel.splash_views}
                  pct={pct}
                  color={pct !== undefined && pct < 30 ? '#FF6B6B' : '#C8F75E'}
                />
              ))}
            </div>
          </div>

          {/* ── AI usage ── */}
          <div>
            <SectionHeader
              title="AI Usage"
              sub={`${data.ai_usage.total_searches.toLocaleString()} total searches · ${data.ai_usage.ai_search_rate}% of DAU`}
            />
            <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl p-4">
              {[
                { label: 'Name search (Gemini Flash)',    value: data.ai_usage.name_searches,          color: '#C8F75E' },
                { label: 'Describe (Claude Haiku)',       value: data.ai_usage.description_searches,   color: '#C4A8FF' },
                { label: 'Photo (Gemini Vision · Pro)',   value: data.ai_usage.photo_searches,          color: '#8DB4FF' },
              ].map(({ label, value, color }) => {
                const pct = data.ai_usage.total_searches > 0
                  ? (value / data.ai_usage.total_searches) * 100 : 0;
                return (
                  <div key={label} className="mb-3 last:mb-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-[11px] text-[#A1A1A1]">{label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold" style={{ color }}>
                          {value.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-[#636366]">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                    <div className="h-2 bg-[#242426] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div className="text-center">
            <button
              onClick={() => fetchData(frame)}
              className="text-[12px] text-[#636366] border border-white/[0.07] rounded-xl px-4 py-2"
            >
              ↻ Refresh
            </button>
            <p className="text-[10px] text-[#2C2C2E] mt-2">All times in IST (Asia/Kolkata)</p>
          </div>

        </div>
      )}
    </div>
  );
}

export default AnalyticsDashboard;
