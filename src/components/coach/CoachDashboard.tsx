import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AttentionPanel } from './AttentionPanel';
import { useFlag } from '../../lib/useFlag';
import { classify, pct, daysSince, STATUS_ORDER, type ClientMetrics, type ClientStatus, type Reason } from '../../lib/coachMetrics';

interface Row extends ClientMetrics {
  relationship_id: string; client_id: string; client_name: string; goal_type: string | null;
}
interface Scored extends Row { status: ClientStatus; reasons: Reason[] }

const GOALS: Record<string, string> = { lose_fat: 'Lose fat', maintain: 'Maintain', build_muscle: 'Build muscle', blood_sugar: 'Blood sugar', eat_healthier: 'Eat healthier' };
const STATUS_LABEL: Record<ClientStatus, string> = { attention: 'Needs attention', drifting: 'Drifting', on_track: 'On track', no_activity: 'No activity', paused: 'Sharing paused' };
const STATUS_STYLE: Record<ClientStatus, string> = {
  attention: 'bg-[#FF453A]/15 text-[#FF6B6B]', drifting: 'bg-[#FFB347]/15 text-[#FFB347]',
  on_track: 'bg-[#30D158]/15 text-[#30D158]', no_activity: 'bg-[#8E8E93]/20 text-[#C7C7CC]', paused: 'bg-[#8E8E93]/15 text-[#8E8E93]',
};
type Filter = 'all' | ClientStatus | 'lose_fat' | 'build_muscle' | 'maintain';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'], ['attention', 'Needs attention'], ['drifting', 'Drifting'], ['on_track', 'On track'], ['no_activity', 'No activity'],
  ['lose_fat', 'Weight loss'], ['build_muscle', 'Muscle gain'], ['maintain', 'Maintenance'],
];

function Cell({ v, shared }: { v: string | null; shared: boolean }) {
  if (!shared) return <span className="text-[#636366]" title="Not shared by the client">not shared</span>;
  return <span>{v ?? '–'}</span>;
}

export function CoachDashboard() {
  const [rows, setRows] = useState<Scored[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'status' | 'name' | 'activity'>('status');
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const attentionOn = useFlag('v2_attention');

  const load = useCallback(async () => {
    setError(null); setRows(null);
    const { data, error: e } = await supabase.rpc('coach_dashboard', { p_days: days });
    if (e) { setError('Could not load your clients. Check your connection and try again.'); return; }
    setRows(((data ?? []) as Row[]).map(r => ({ ...r, ...classify(r) })));
  }, [days]);
  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c = { total: 0, attention: 0, drifting: 0, on_track: 0 };
    for (const r of rows ?? []) { c.total++; if (r.status === 'attention' || r.status === 'no_activity') c.attention++; else if (r.status === 'drifting') c.drifting++; else if (r.status === 'on_track') c.on_track++; }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows ?? [];
    if (filter !== 'all') list = list.filter(r => r.status === filter || r.goal_type === filter);
    if (q.trim()) list = list.filter(r => r.client_name.toLowerCase().includes(q.trim().toLowerCase()));
    return [...list].sort((a, b) => {
      if (sort === 'name') return a.client_name.localeCompare(b.client_name);
      if (sort === 'activity') return (daysSince(b.last_activity) ?? 999) - (daysSince(a.last_activity) ?? 999);
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.client_name.localeCompare(b.client_name);
    });
  }, [rows, filter, q, sort]);

  if (error) return <div role="alert" className="bg-[#1C1C1E] rounded-2xl p-5 text-sm"><p className="text-[#FF6B6B]">{error}</p><button onClick={() => void load()} className="mt-2 underline text-[#C8F75E]">Try again</button></div>;
  if (!rows) return <div className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">Loading your clients…</div>;

  const tile = (label: string, n: number, color: string) => (
    <div className="bg-[#1C1C1E] rounded-2xl p-4"><p className="text-2xl font-bold" style={{ color }}>{n}</p><p className="text-[11px] text-[#8E8E93] mt-0.5">{label}</p></div>
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#EBEBF5]/70">Who needs your attention today?</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {tile('Active clients', counts.total, '#FFFFFF')}
        {tile('Needs attention', counts.attention, '#FF6B6B')}
        {tile('Drifting', counts.drifting, '#FFB347')}
        {tile('On track', counts.on_track, '#30D158')}
      </div>

      {attentionOn && <AttentionPanel clients={rows} />}

      <div className="bg-[#1C1C1E] rounded-2xl p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients" aria-label="Search clients" className="bg-[#242426] rounded-lg px-3 py-2 text-sm text-white flex-1 min-w-[140px]" />
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} aria-label="Sort clients" className="bg-[#242426] rounded-lg px-2 py-2 text-sm text-white">
            <option value="status">Sort: needs attention first</option><option value="name">Sort: name</option><option value="activity">Sort: longest quiet</option>
          </select>
          <select value={days} onChange={e => setDays(Number(e.target.value) as 7 | 14 | 30)} aria-label="Time window" className="bg-[#242426] rounded-lg px-2 py-2 text-sm text-white">
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter clients">
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={`px-3 min-h-[36px] rounded-full text-xs ${filter === k ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{label}</button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">No clients yet. Create an invite link below and send it to your first client.</div>
      ) : shown.length === 0 ? (
        <div className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">No clients match this filter.</div>
      ) : (
        <div className="bg-[#1C1C1E] rounded-2xl overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead className="text-[11px] text-[#8E8E93] text-left">
              <tr>
                <th className="p-3 font-medium">Client</th><th className="p-3 font-medium">Goal</th>
                <th className="p-3 font-medium">Calories</th><th className="p-3 font-medium">Protein</th>
                <th className="p-3 font-medium">Energy</th><th className="p-3 font-medium">Logging</th>
                <th className="p-3 font-medium">Status</th><th className="p-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 align-top">
              {shown.map(r => {
                const quiet = daysSince(r.last_activity);
                const energyArrow = r.energy_avg != null && r.energy_prev_avg != null ? (r.energy_avg < r.energy_prev_avg - 0.05 ? '↓' : r.energy_avg > r.energy_prev_avg + 0.05 ? '↑' : '→') : '';
                return (
                  <tr key={r.relationship_id}>
                    <td className="p-3 font-medium"><Link to={`/coach/client/${r.client_id}`} className="underline decoration-white/20 hover:decoration-white">{r.client_name}</Link></td>
                    <td className="p-3 text-[#C7C7CC]">{r.goal_type ? GOALS[r.goal_type] : '–'}</td>
                    <td className="p-3"><Cell shared={!!r.share_scope.food} v={pct(r.avg_cal, r.target_cal) != null ? `${pct(r.avg_cal, r.target_cal)}%` : null} /></td>
                    <td className="p-3"><Cell shared={!!r.share_scope.food} v={pct(r.avg_protein, r.target_protein) != null ? `${pct(r.avg_protein, r.target_protein)}%` : null} /></td>
                    <td className="p-3"><Cell shared={!!r.share_scope.energy} v={r.energy_avg != null ? `${r.energy_avg.toFixed(1)} ${energyArrow}` : null} /></td>
                    <td className="p-3"><Cell shared={!!r.share_scope.food} v={r.days_logged != null ? `${r.days_logged}/${r.days_in_window}` : '0/' + r.days_in_window} /></td>
                    <td className="p-3 max-w-[260px]">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                      {r.reasons.map(x => <p key={x.signal} className="text-[11px] text-[#8E8E93] mt-1">{x.text}</p>)}
                    </td>
                    <td className="p-3 text-[#C7C7CC]">{quiet == null ? 'never' : quiet === 0 ? 'today' : `${quiet}d ago`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
