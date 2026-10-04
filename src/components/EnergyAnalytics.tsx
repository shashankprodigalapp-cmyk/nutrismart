/**
 * EnergyAnalytics.tsx — TASK 2 UI: "Foods that crash you vs sustain you"
 *
 * Fetches /.netlify/functions/analyze-energy and renders:
 *   - GL gap headline (crash meals avg GL vs steady meals avg GL)
 *   - "Crash triggers" list (red) — foods followed by 'low' energy ≥60% of the time
 *   - "Energy sustainers" list (green) — foods followed by steady/high energy
 *   - Actionable swap suggestion derived from the GL gap
 *   - Insufficient-data state with progress toward 5 energy logs
 *
 * Mobile-first, TailwindCSS only, no chart library — horizontal bar rows.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useProGate } from '../utils/proGatekeeper';

// ── TYPES (mirror analyze-energy.ts response) ─────────────────────────────────

interface FoodCorrelation {
  food_name:     string;
  crash_count:   number;
  sustain_count: number;
  total:         number;
  crash_rate:    number;
  avg_gl:        number;
}

interface AnalysisResponse {
  success:            boolean;
  insufficient_data:  boolean;
  energy_logs_count?: number;
  needed?:            number;
  message?:           string;
  observations?: { energy_logs: number; correlated_crash: number; correlated_steady: number };
  gl_insight?: { avg_crash_meal_gl: number | null; avg_steady_meal_gl: number | null };
  crash_triggers?: FoodCorrelation[];
  sustainers?:     FoodCorrelation[];
}

// ── BAR ROW ───────────────────────────────────────────────────────────────────

function CorrelationRow({
  item, variant,
}: { item: FoodCorrelation; variant: 'crash' | 'sustain' }) {
  const pct   = variant === 'crash' ? item.crash_rate : 1 - item.crash_rate;
  const color = variant === 'crash' ? '#FF6B6B' : '#6BCB77';
  const count = variant === 'crash' ? item.crash_count : item.sustain_count;

  return (
    <div className="py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[13px] font-medium text-[#F5F5F5] truncate flex-1">
          {item.food_name}
        </span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className="text-[10px] text-[#636366]">GL {item.avg_gl}</span>
          <span className="text-[11px] font-bold" style={{ color }}>
            {Math.round(pct * 100)}%
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <p className="text-[9px] text-[#636366] mt-1">
        {count} of {item.total} times you felt {variant === 'crash' ? 'low' : 'steady'} after this
      </p>
    </div>
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

interface KitchenImpact {
  n_total:    number;
  n_crashes:  number;
  sufficient: boolean;
  axes: {
    restaurant_vs_home: { restaurant_crash_rate: number; home_crash_rate: number };
    oil_multiplier:     { heavy_crash_rate: number; light_crash_rate: number };
    fat_density:        { fatty_crash_rate: number; lean_crash_rate: number };
  };
}

export function EnergyAnalytics() {
  const [data,    setData]    = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [impact,  setImpact]  = useState<KitchenImpact | null>(null);
  // Deep insights (kitchen impact) are the Pro preview surface (growth task 2.2)
  const { allowed: isPro, showUpgrade } = useProGate('fitness_insights');

  const fetchAnalysis = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Please log in again.'); return; }
      const res = await fetch('/.netlify/functions/analyze-energy', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData(await res.json());

      // Kitchen Impact — deepest layer, rendered blurred for free users
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: imp } = await supabase.rpc('kitchen_impact_analysis', {
          p_user_id: user.id, p_lookback_days: 60,
        });
        if (imp?.sufficient) setImpact(imp as KitchenImpact);
      }
    } catch (e: any) {
      setError(e.message ?? 'Could not load analysis.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAnalysis(); }, [fetchAnalysis]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="px-4 pt-6 flex flex-col gap-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-28 bg-[#1C1C1E] border border-white/[0.07] rounded-2xl animate-pulse" />
      ))}
    </div>
  );

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) return (
    <div className="mx-4 mt-6 bg-red-500/10 border border-red-500/25 rounded-xl p-4 text-center">
      <p className="text-[13px] text-red-400">{error}</p>
      <button onClick={fetchAnalysis} className="mt-2 text-[12px] text-[#C8F75E]">Retry</button>
    </div>
  );

  if (!data) return null;

  // ── Insufficient data ─────────────────────────────────────────────────────
  if (data.insufficient_data) {
    const have = data.energy_logs_count ?? 0;
    const need = data.needed ?? 5;
    return (
      <div className="px-4 pt-6 pb-24">
        <div className="bg-[#1C1C1E] border border-white/[0.07] rounded-2xl p-6">
          <div className="text-4xl mb-3 text-center">🔋</div>
          <h2 className="font-['Playfair_Display'] text-lg font-black text-[#F5F5F5] mb-2 text-center">
            We're still learning
          </h2>
          <p className="text-[13px] text-[#A1A1A1] mb-5 text-center leading-relaxed">
            Log meals and tell us how your energy feels afterward. We look for patterns
            over the 60–90 minutes after each meal.
          </p>

          {/* Progress dots */}
          <div className="flex justify-center gap-1.5 mb-2">
            {Array.from({ length: need }).map((_, i) => (
              <div key={i}
                className={`w-8 h-2 rounded-full transition-all ${i < have ? 'bg-[#C8F75E]' : 'bg-[#2C2C2E]'}`} />
            ))}
          </div>
          <p className="text-[10px] text-[#636366] text-center mb-5">
            {have} of {need} energy check-ins — {need - have} more to unlock analysis
          </p>

          {/* How it works */}
          <div className="bg-[#242426] rounded-xl p-4 space-y-3">
            <p className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px]">How it works</p>
            {[
              ['🍽️', 'Log a meal in the Log tab'],
              ['⏳', 'Wait 60–90 minutes after eating'],
              ['💬', 'Rate your energy — a quick prompt will appear'],
              ['🧠', `After ${need} check-ins we find your crash triggers and sustainers`],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-start gap-2.5">
                <span className="text-[14px] flex-shrink-0 mt-0.5">{icon}</span>
                <p className="text-[12px] text-[#A1A1A1] leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const gl = data.gl_insight;
  const glGap = gl?.avg_crash_meal_gl != null && gl?.avg_steady_meal_gl != null
    ? gl.avg_crash_meal_gl - gl.avg_steady_meal_gl
    : null;

  return (
    <div className="px-4 pt-6 pb-24">
      <h1 className="font-['Playfair_Display'] text-[24px] font-black text-[#F5F5F5] mb-1">
        Energy Patterns
      </h1>
      <p className="text-[11px] text-[#636366] mb-5">
        Based on {data.observations?.energy_logs} check-ins over the last 60 days
      </p>

      {/* GL gap headline */}
      {glGap !== null && glGap > 5 && (
        <div className="bg-[#C8F75E]/8 border border-[#C8F75E]/25 rounded-2xl p-4 mb-5">
          <p className="text-[10px] font-bold text-[#C8F75E] uppercase tracking-[1px] mb-2">
            🧠 Your pattern
          </p>
          <p className="text-[13px] text-[#F5F5F5] leading-relaxed">
            Meals before your energy <strong className="text-[#FF6B6B]">crashes</strong> average{' '}
            <strong className="text-[#FF6B6B]">GL {gl!.avg_crash_meal_gl}</strong>.
            Meals before <strong className="text-[#6BCB77]">steady afternoons</strong> average{' '}
            <strong className="text-[#6BCB77]">GL {gl!.avg_steady_meal_gl}</strong>.
          </p>
          <p className="text-[11px] text-[#A1A1A1] mt-2">
            → Keeping lunch GL under {Math.round((gl!.avg_steady_meal_gl! + gl!.avg_crash_meal_gl!) / 2)} is
            your best lever for stable energy.
          </p>
        </div>
      )}

      {/* Crash triggers */}
      <div className="bg-[#1C1C1E] border border-[#FF6B6B]/20 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[16px]">📉</span>
          <h2 className="text-[13px] font-bold text-[#FF6B6B]">Foods that trigger your crashes</h2>
        </div>
        {data.crash_triggers?.length ? (
          data.crash_triggers.map(item => (
            <CorrelationRow key={item.food_name} item={item} variant="crash" />
          ))
        ) : (
          <p className="text-[12px] text-[#636366] py-2">
            No consistent crash triggers found yet — that's a good sign.
          </p>
        )}
      </div>

      {/* Sustainers */}
      <div className="bg-[#1C1C1E] border border-[#6BCB77]/20 rounded-2xl p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[16px]">⚡</span>
          <h2 className="text-[13px] font-bold text-[#6BCB77]">Foods that sustain your energy</h2>
        </div>
        {data.sustainers?.length ? (
          data.sustainers.map(item => (
            <CorrelationRow key={item.food_name} item={item} variant="sustain" />
          ))
        ) : (
          <p className="text-[12px] text-[#636366] py-2">
            Keep logging energy after meals to discover your sustainers.
          </p>
        )}
      </div>

      {/* ── KITCHEN IMPACT — the defensible layer (Pro preview surface) ──── */}
      {impact && (
        <div className="relative bg-[#1C1C1E] border border-[#C4A8FF]/25 rounded-2xl p-4 mb-4 overflow-hidden">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[16px]">🍳</span>
            <h2 className="text-[13px] font-bold text-[#C4A8FF]">Kitchen impact on your crashes</h2>
            {!isPro && (
              <span className="ml-auto text-[9px] font-bold bg-[#C8F75E]/15 text-[#C8F75E] border border-[#C8F75E]/30 px-2 py-0.5 rounded-md">PRO</span>
            )}
          </div>

          {/* Content — blurred for free users but real data underneath:
              a genuine preview converts better than a fake teaser */}
          <div className={!isPro ? 'blur-[6px] select-none pointer-events-none' : ''}>
            {[
              {
                label: '🏪 Restaurant vs 🏠 Home',
                a: { name: 'Restaurant', rate: impact.axes.restaurant_vs_home.restaurant_crash_rate },
                b: { name: 'Home',       rate: impact.axes.restaurant_vs_home.home_crash_rate },
              },
              {
                label: '🛢 Heavy oil vs light (your multiplier)',
                a: { name: 'Heavy (≥1.15×)', rate: impact.axes.oil_multiplier.heavy_crash_rate },
                b: { name: 'Light (<1.15×)', rate: impact.axes.oil_multiplier.light_crash_rate },
              },
              {
                label: '🧈 Fat-dense vs lean meals',
                a: { name: 'Fat-dense', rate: impact.axes.fat_density.fatty_crash_rate },
                b: { name: 'Lean',      rate: impact.axes.fat_density.lean_crash_rate },
              },
            ].map(({ label, a, b }) => (
              <div key={label} className="py-2.5 border-b border-white/[0.05] last:border-0">
                <p className="text-[11px] text-[#A1A1A1] mb-1.5">{label}</p>
                <div className="flex gap-2">
                  {[a, b].map(side => (
                    <div key={side.name} className="flex-1">
                      <div className="flex justify-between mb-1">
                        <span className="text-[10px] text-[#636366]">{side.name}</span>
                        <span className="text-[10px] font-bold"
                          style={{ color: side.rate > 0.5 ? '#FF6B6B' : '#6BCB77' }}>
                          {Math.round(side.rate * 100)}% crash
                        </span>
                      </div>
                      <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
                        <div className="h-full rounded-full"
                          style={{ width: `${side.rate * 100}%`,
                                   background: side.rate > 0.5 ? '#FF6B6B' : '#6BCB77' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* One-tap unlock overlay (free users) */}
          {!isPro && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#111113]/40">
              <p className="text-[12px] text-[#F5F5F5] font-semibold mb-1 px-6 text-center drop-shadow">
                Your kitchen habits are hiding in this chart
              </p>
              <p className="text-[10px] text-[#A1A1A1] mb-3 px-6 text-center">
                Oil levels · home vs restaurant · fat density — mapped to your crashes
              </p>
              <button
                onClick={showUpgrade}
                className="bg-[#C8F75E] text-[#111113] font-bold text-[13px] rounded-xl px-5 py-2.5 active:scale-[0.97] transition-transform"
              >
                🔓 Unlock with Pro — ₹99/mo
              </button>
            </div>
          )}
        </div>
      )}

      {/* Method note */}
      <p className="text-[10px] text-[#636366] text-center px-4">
        We match each energy check-in against what you ate 60–90 minutes earlier.
        Foods with fewer than 5 observations are excluded.
      </p>
    </div>
  );
}

export default EnergyAnalytics;
