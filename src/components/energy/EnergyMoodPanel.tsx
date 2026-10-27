import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { todayIST } from '../../lib/kitchenIntelligence';
import { useFlag } from '../../lib/useFlag';
import { PatternsSection } from './PatternsSection';
import { buildFindings, tryTomorrow, lowMoodNote, trend, type DayRow, type MealFeeling } from '../../lib/moodInsights';

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);
const istMinutes = (iso: string) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
  return Number(p.find(x => x.type === 'hour')!.value) % 24 * 60 + Number(p.find(x => x.type === 'minute')!.value);
};
const LEVEL_Y: Record<string, number> = { low: 1, steady: 2, high: 3 };

function TrendChart({ data, color, label, max = 5 }: { data: Array<{ date: string; value: number }>; color: string; label: string; max?: number }) {
  if (data.length < 2) return <p className="text-xs text-[#8E8E93]">{label}: not enough check-ins yet to draw a line.</p>;
  const W = 320, H = 90, pad = 14;
  const t0 = new Date(data[0].date).getTime(), t1 = new Date(data[data.length - 1].date).getTime() || t0 + 1;
  const x = (d: string) => pad + ((new Date(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - 1) / (max - 1)) * (H - 2 * pad);
  const pts = data.map(p => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const avg = data.reduce((a, b) => a + b.value, 0) / data.length;
  return (
    <figure>
      <figcaption className="text-xs text-[#8E8E93] mb-1">{label} · average {avg.toFixed(1)} over {data.length} check-ins</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} trend, ${data.length} points, average ${avg.toFixed(1)} out of ${max}`} className="w-full h-auto bg-[#1C1C1E] rounded-xl">
        {[1, 3, 5].map(v => <line key={v} x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="#2C2C2E" strokeWidth="1" />)}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {data.map(p => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r="3" fill={color} />)}
      </svg>
    </figure>
  );
}

interface DayData { meals: Array<{ min: number; cal: number; meal: string }>; energy: Array<{ min: number; level: string }>; shared: boolean }

function DayGraph({ clientId, day }: { clientId?: string; day: string }) {
  const [d, setD] = useState<DayData | null>(null);
  useEffect(() => {
    let live = true; setD(null);
    (async () => {
      let m = supabase.from('daily_logs').select('created_at, meal, cal').eq('log_date', day);
      let e = supabase.from('energy_logs').select('log_time, level').eq('log_date', day);
      if (clientId) { m = m.eq('user_id', clientId); e = e.eq('user_id', clientId); }
      const [a, b] = await Promise.all([m, e]);
      if (!live) return;
      setD({
        meals: (a.data ?? []).map(r => ({ min: istMinutes(r.created_at as string), cal: Number(r.cal) || 0, meal: String(r.meal) })),
        energy: (b.data ?? []).map(r => ({ min: istMinutes(r.log_time as string), level: String(r.level) })),
        shared: !a.error && !b.error,
      });
    })();
    return () => { live = false; };
  }, [clientId, day]);
  if (!d) return <p className="text-xs text-[#8E8E93]">Loading the day…</p>;
  if (!d.meals.length && !d.energy.length) return <p className="text-xs text-[#8E8E93]">Nothing logged for this day.</p>;
  const W = 320, H = 130, pad = 16, T0 = 6 * 60, T1 = 24 * 60;
  const x = (min: number) => pad + ((Math.min(Math.max(min, T0), T1) - T0) / (T1 - T0)) * (W - 2 * pad);
  const maxCal = Math.max(300, ...d.meals.map(m => m.cal));
  const ey = (lvl: string) => 60 - ((LEVEL_Y[lvl] ?? 2) - 1) * 24;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Day graph: ${d.meals.length} meals and ${d.energy.length} energy notes`} className="w-full h-auto bg-[#1C1C1E] rounded-xl">
      <text x={4} y={14} fontSize="8" fill="#8E8E93">high</text><text x={4} y={38} fontSize="8" fill="#8E8E93">steady</text><text x={4} y={62} fontSize="8" fill="#8E8E93">low</text>
      {[6, 12, 18, 24].map(h => <g key={h}><line x1={x(h * 60)} x2={x(h * 60)} y1={8} y2={H - 18} stroke="#2C2C2E" /><text x={x(h * 60)} y={H - 6} fontSize="8" fill="#8E8E93" textAnchor="middle">{h === 24 ? '12a' : h > 12 ? `${h - 12}p` : h === 12 ? '12p' : `${h}a`}</text></g>)}
      {d.meals.map((m, i) => { const h = 6 + (m.cal / maxCal) * 38; return <rect key={i} x={x(m.min) - 3} y={H - 18 - h} width="6" height={h} rx="2" fill="#C8F75E" opacity="0.55"><title>{m.meal}, {Math.round(m.cal)} kcal</title></rect>; })}
      {d.energy.map((e, i) => <circle key={i} cx={x(e.min)} cy={ey(e.level) - 6} r="5" fill={e.level === 'low' ? '#FF6B6B' : e.level === 'high' ? '#30D158' : '#FFB347'}><title>Energy {e.level}</title></circle>)}
    </svg>
  );
}

export function EnergyMoodPanel({ clientId, proteinTarget, mode }: { clientId?: string; proteinTarget?: number | null; mode: 'self' | 'coach' }) {
  const insightsOn = useFlag('v2_mood_insights');
  const [range, setRange] = useState<7 | 30>(30);
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [feelings, setFeelings] = useState<MealFeeling[]>([]);
  const [target, setTarget] = useState<number | null>(proteinTarget ?? null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [day, setDay] = useState(todayIST());

  const load = useCallback(async () => {
    setState('loading');
    const from = addDays(todayIST(), -29);
    const q = <T,>(b: T) => b;
    let dc = supabase.from('daily_checkins').select('log_date, energy, mood, hunger, sleep, stress').gte('log_date', from);
    let mf = supabase.from('meal_feelings').select('log_date, meal, energy_change, fullness, mood_change').gte('log_date', from);
    let nm = supabase.from('daily_nutrition_metrics').select('day, protein_g, meals, water_glasses').gte('day', from);
    if (clientId) { dc = dc.eq('user_id', clientId); mf = mf.eq('user_id', clientId); nm = nm.eq('user_id', clientId); }
    const [a, b, c] = await Promise.all([q(dc), q(mf), q(nm)]);
    if (a.error) { setState('error'); return; }
    const byDay = new Map<string, DayRow>();
    const row = (date: string): DayRow => byDay.get(date) ?? (byDay.set(date, { date, mood: null, energy: null, hunger: null, sleep: null, stress: null, protein: null, mealsLogged: 0, waterGlasses: null }), byDay.get(date)!);
    for (const r of a.data ?? []) Object.assign(row(String(r.log_date)), { mood: r.mood, energy: r.energy, hunger: r.hunger, sleep: r.sleep, stress: r.stress });
    for (const r of c.data ?? []) Object.assign(row(String(r.day)), { protein: r.protein_g == null ? null : Number(r.protein_g), mealsLogged: Number(r.meals) || 0, waterGlasses: r.water_glasses });
    setDays([...byDay.values()].sort((x, y) => x.date.localeCompare(y.date)));
    setFeelings(((b.data ?? []) as Array<Record<string, unknown>>).map(r => ({ date: String(r.log_date), meal: String(r.meal), energy_change: r.energy_change as MealFeeling['energy_change'], fullness: r.fullness as MealFeeling['fullness'], mood_change: r.mood_change as MealFeeling['mood_change'] })));
    if (!clientId && target == null) {
      const { data: u } = await supabase.auth.getUser();
      const { data: p } = await supabase.from('users').select('target_protein').eq('id', u.user?.id ?? '').maybeSingle();
      setTarget(p?.target_protein ?? null);
    }
    setState('ready');
  }, [clientId, target]);
  useEffect(() => { void load(); }, [clientId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const windowDays = useMemo(() => (days ?? []).filter(d => d.date >= addDays(todayIST(), -(range - 1))), [days, range]);
  const result = useMemo(() => buildFindings(days ?? [], feelings, { proteinTarget: target, waterGoal: 8 }), [days, feelings, target]);
  const acts = useMemo(() => tryTomorrow(result.findings), [result]);
  const note = mode === 'self' ? lowMoodNote(days ?? []) : null;

  if (state === 'loading') return <p className="text-sm text-[#8E8E93]">Loading…</p>;
  if (state === 'error') return <p role="alert" className="text-sm text-[#FF6B6B]">Could not load. Check your connection and try again. <button onClick={() => load()} className="underline">Retry</button></p>;
  const none = (days ?? []).every(d => d.mood == null && d.energy == null && d.hunger == null);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {([7, 30] as const).map(r => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={`px-3 min-h-[40px] rounded-full text-sm ${range === r ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{r} days</button>)}
      </div>
      {none ? (
        <p className="bg-[#1C1C1E] rounded-2xl p-4 text-sm text-[#8E8E93]">{mode === 'self' ? 'No check-ins yet. Answer the morning check-in on the Today screen and your energy and mood lines will appear here.' : 'No check-ins shared yet. The client may have the mood switch off, or may not have checked in.'}</p>
      ) : (
        <div className="space-y-3">
          <TrendChart data={trend(windowDays, 'energy')} color="#C8F75E" label="Energy" />
          <TrendChart data={trend(windowDays, 'mood')} color="#7AB8FF" label="Mood" />
          <TrendChart data={trend(windowDays, 'hunger')} color="#FFB347" label="Hunger" />
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <button aria-label="Previous day" onClick={() => setDay(addDays(day, -1))} className="w-10 h-10 rounded-full bg-[#242426]">‹</button>
          <p className="flex-1 text-center text-sm">{day === todayIST() ? 'Today' : day}</p>
          <button aria-label="Next day" disabled={day >= todayIST()} onClick={() => setDay(addDays(day, 1))} className="w-10 h-10 rounded-full bg-[#242426] disabled:opacity-30">›</button>
        </div>
        <DayGraph clientId={clientId} day={day} />
        <p className="text-[11px] text-[#636366]">Green bars are meals (taller is more calories). Dots are after-meal energy: red low, amber steady, green high.</p>
      </section>

      {note && <p role="note" className="bg-[#1C1C1E] rounded-2xl p-4 text-sm text-[#C7C7CC]">{note}</p>}

      <PatternsSection clientId={clientId} />

      {insightsOn && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">What Nutri Smart noticed</h2>
          {result.findings.length === 0 ? (
            <p className="bg-[#1C1C1E] rounded-2xl p-4 text-sm text-[#8E8E93]">
              {result.checkinDays < 3 ? 'Not enough data yet. After a few days of check-ins, patterns can start to appear.' : 'No clear pattern yet. Patterns need at least 3 days on each side of a comparison.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {result.findings.map(f => (
                <li key={f.id} className="bg-[#1C1C1E] rounded-2xl p-4">
                  <p className="text-sm">{f.text}</p>
                  <p className="text-[11px] text-[#8E8E93] mt-1">{f.confidence === 'early' ? 'Early signal' : f.confidence === 'emerging' ? 'Emerging pattern' : 'Repeated pattern'} · based on {result.checkinDays} check-in days</p>
                  <details className="mt-1"><summary className="text-[11px] text-[#8E8E93] cursor-pointer min-h-[24px]">Based on</summary><p className="text-[11px] text-[#8E8E93]">{f.evidence}</p></details>
                </li>
              ))}
            </ul>
          )}
          {mode === 'self' && acts.length > 0 && (
            <div className="bg-[#1C1C1E] rounded-2xl p-4">
              <h3 className="text-sm font-semibold mb-1">Try tomorrow</h3>
              <ul className="list-disc pl-5 text-sm space-y-1">{acts.map(a => <li key={a}>{a}</li>)}</ul>
            </div>
          )}
          <p className="text-[11px] text-[#636366]">These are observations from your own check-ins, not medical advice or a diagnosis.</p>
        </section>
      )}
    </div>
  );
}
