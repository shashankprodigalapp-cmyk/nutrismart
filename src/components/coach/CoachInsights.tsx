/** Charts for the coach dashboard: status mix, how the whole group is tracking against targets, and a logging heatmap. */
import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Donut, LineChart, Heatmap, Legend } from '../charts/Charts';
import { shortDay } from '../../lib/chartMath';
import { dayScore, summarise, type SeriesRow } from '../../lib/coachSeries';
import type { ClientStatus } from '../../lib/coachMetrics';

interface Client { client_id: string; client_name: string; status: ClientStatus }

const STATUS_COLOR: Record<ClientStatus, string> = { attention: '#FF6B6B', drifting: '#FFB340', on_track: '#30D158', no_activity: '#8E8E93', paused: '#636366' };
const STATUS_NAME: Record<ClientStatus, string> = { attention: 'Needs attention', drifting: 'Drifting', on_track: 'On track', no_activity: 'No activity', paused: 'Paused' };
const ORDER: ClientStatus[] = ['attention', 'no_activity', 'drifting', 'on_track', 'paused'];

export function CoachInsights({ clients }: { clients: Client[] }) {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    supabase.rpc('coach_client_series', { p_days: 14 }).then(({ data, error }) => { if (!live) return; if (error) setFailed(true); else setSeries((data ?? []) as SeriesRow[]); });
    return () => { live = false; };
  }, []);
  const mix = useMemo(() => ORDER.map(k => ({ label: STATUS_NAME[k], value: clients.filter(c => c.status === k).length, color: STATUS_COLOR[k] })).filter(s => s.value > 0), [clients]);
  const sum = useMemo(() => (series ? summarise(series) : null), [series]);
  const heat = useMemo(() => {
    if (!series || !sum) return [];
    const rank = new Map(ORDER.map((k, i) => [k, i]));
    return clients.filter(c => series.some(r => r.client_id === c.client_id)).sort((a, b) => (rank.get(a.status)! - rank.get(b.status)!) || a.client_name.localeCompare(b.client_name)).slice(0, 40).map(c => ({
      label: c.client_name,
      cells: sum.days.map(d => { const r = series.find(x => x.client_id === c.client_id && String(x.day) === d); return r ? dayScore(r.calories, r.items, r.target_cal) : null; }),
    }));
  }, [series, sum, clients]);
  if (clients.length === 0) return null;
  const labels = sum?.days.map(shortDay) ?? [];
  return (
    <div className="space-y-3" data-testid="coach-insights">
      <div className="grid md:grid-cols-2 gap-3">
        <section className="bg-[#1C1C1E] rounded-2xl p-4">
          <h3 className="text-sm font-bold">Your clients today</h3><p className="text-xs text-[#8E8E93] mb-3">How many are in each status.</p>
          <Donut label="Clients by status" center={String(clients.length)} sub="clients" slices={mix} />
        </section>
        <section className="bg-[#1C1C1E] rounded-2xl p-4">
          <h3 className="text-sm font-bold">Logging each day</h3><p className="text-xs text-[#8E8E93] mb-3">Share of clients who logged something, last 14 days.</p>
          {failed ? <p className="text-xs text-[#8E8E93]">Charts are not available yet.</p> : !sum ? <p className="text-xs text-[#8E8E93]">Loading…</p> :
            <LineChart label="Share of clients logging each day" labels={labels} yMax={100} yFormat={v => `${Math.round(v)}%`} series={[{ name: 'Clients who logged', values: sum.logging }]} />}
        </section>
      </div>
      {sum && !failed && <>
        <section className="bg-[#1C1C1E] rounded-2xl p-4">
          <h3 className="text-sm font-bold">How the group is tracking</h3><p className="text-xs text-[#8E8E93] mb-3">Average share of target on days people logged. 100% is right on target; days with nothing logged are left out.</p>
          <LineChart label="Average calories and protein as a share of target" labels={labels} target={100} targetLabel="target" yFormat={v => `${Math.round(v)}%`} series={[{ name: 'Calories', values: sum.cal }, { name: 'Protein', values: sum.pro, color: '#FFB340' }]} />
        </section>
        <section className="bg-[#1C1C1E] rounded-2xl p-4">
          <h3 className="text-sm font-bold">Who logged, and how close</h3><p className="text-xs text-[#8E8E93] mb-3">Each square is one day. Needs-attention clients are first.</p>
          <Heatmap label="Daily calorie match by client" rows={heat} colLabels={labels} cellTitle={(r, c, v) => `${r}, ${c}: ${v == null ? 'no data' : v === 0 ? 'nothing logged' : `${Math.round(v * 100)}% match`}`} />
          <Legend items={[{ name: 'Nothing logged', color: '#3A3A3C' }, { name: 'Far from target', color: '#7A5A1E' }, { name: 'Close', color: '#B58A2E' }, { name: 'On target', color: '#C8F75E' }]} />
        </section>
      </>}
    </div>
  );
}

/** Charts for one client's page. */
export function ClientCharts({ clientId, days = 14 }: { clientId: string; days?: number }) {
  const [series, setSeries] = useState<SeriesRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    supabase.rpc('coach_client_series', { p_days: days, p_client: clientId }).then(({ data, error }) => { if (!live) return; if (error) setFailed(true); else setSeries((data ?? []) as SeriesRow[]); });
    return () => { live = false; };
  }, [clientId, days]);
  if (failed) return null;
  if (!series) return <p className="text-xs text-[#8E8E93]">Loading charts…</p>;
  if (series.length === 0) return <p className="text-xs text-[#8E8E93]">No shared food data to chart.</p>;
  const labels = series.map(r => shortDay(String(r.day)));
  const target = series.find(r => r.target_cal)?.target_cal ?? null; const pTarget = series.find(r => r.target_protein)?.target_protein ?? null;
  const logged = (v: number | null, r: SeriesRow) => (r.items > 0 ? v : null);
  const energy = series.map(r => r.energy);
  return (
    <div className="space-y-3" data-testid="client-charts">
      <section className="bg-[#1C1C1E] rounded-2xl p-4"><h3 className="text-sm font-bold">Calories per day</h3><p className="text-xs text-[#8E8E93] mb-2">Days with nothing logged are gaps, not zero.</p>
        <LineChart label="Calories per day" labels={labels} target={target} targetLabel={target ? `${target} kcal` : undefined} series={[{ name: 'Calories', values: series.map(r => logged(r.calories == null ? null : Number(r.calories), r)) }]} /></section>
      <section className="bg-[#1C1C1E] rounded-2xl p-4"><h3 className="text-sm font-bold">Protein per day</h3>
        <LineChart label="Protein per day in grams" labels={labels} target={pTarget} targetLabel={pTarget ? `${pTarget} g` : undefined} yFormat={v => `${Math.round(v)}g`} series={[{ name: 'Protein', color: '#FFB340', values: series.map(r => logged(r.protein_g == null ? null : Number(r.protein_g), r)) }]} /></section>
      {energy.some(v => v != null) && <section className="bg-[#1C1C1E] rounded-2xl p-4"><h3 className="text-sm font-bold">Energy</h3><p className="text-xs text-[#8E8E93] mb-2">1 low, 2 steady, 3 high.</p>
        <LineChart label="Energy per day" labels={labels} yMax={3} yFormat={v => v.toFixed(1)} series={[{ name: 'Energy', color: '#64D2FF', values: energy.map(v => (v == null ? null : Number(v))) }]} /></section>}
    </div>
  );
}
