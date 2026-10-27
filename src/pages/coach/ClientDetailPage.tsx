import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { classify, pct, type ClientMetrics, type ClientStatus, type Reason } from '../../lib/coachMetrics';
import { groupByDay, dayLabel, type TimelineEvent } from '../../lib/timeline';
import WeeklyReviewPanel from '../../components/review/WeeklyReviewPanel';
import { summarize, band, fillDays, type AdherenceRow } from '../../lib/adherenceView';

interface Row extends ClientMetrics { relationship_id: string; client_id: string; client_name: string; goal_type: string | null }
const PAGE = 50;
const SCOPES: Array<[string, string]> = [['all', 'Everything'], ['food', 'Food'], ['energy', 'Energy'], ['water', 'Water']];
const STATUS_LABEL: Record<ClientStatus, string> = { attention: 'Needs attention', drifting: 'Drifting', on_track: 'On track', no_activity: 'No activity', paused: 'Sharing paused' };

function Overview({ row }: { row: Row }) {
  const { status, reasons } = classify(row) as { status: ClientStatus; reasons: Reason[] };
  const stat = (label: string, value: string, shared = true) => (
    <div className="bg-[#242426] rounded-xl p-3"><p className="text-lg font-bold">{shared ? value : 'not shared'}</p><p className="text-[11px] text-[#8E8E93]">{label}</p></div>
  );
  return (
    <div className="space-y-3">
      <div className="bg-[#1C1C1E] rounded-2xl p-4 space-y-2">
        <p className="text-sm font-semibold">{STATUS_LABEL[status]}</p>
        {reasons.length === 0 ? <p className="text-sm text-[#8E8E93]">Nothing unusual in the last {row.days_in_window} days.</p>
          : reasons.map(r => <p key={r.signal} className="text-sm text-[#EBEBF5]/80">• {r.text}</p>)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {stat('Calories vs target', `${pct(row.avg_cal, row.target_cal) ?? '–'}%`, !!row.share_scope.food)}
        {stat('Protein vs target', `${pct(row.avg_protein, row.target_protein) ?? '–'}%`, !!row.share_scope.food)}
        {stat('Days logged', `${row.days_logged ?? 0}/${row.days_in_window}`, !!row.share_scope.food)}
        {stat('Energy (1-3)', row.energy_avg != null ? row.energy_avg.toFixed(1) : '–', !!row.share_scope.energy)}
      </div>
      <p className="text-[11px] text-[#636366]">Targets: {row.target_cal ?? '–'} kcal and {row.target_protein ?? '–'}g protein a day.</p>
    </div>
  );
}

function Timeline({ clientId }: { clientId: string }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [scope, setScope] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);

  const fetchPage = useCallback(async (before: string | null, replace: boolean) => {
    setLoading(true); setError(null);
    let q = supabase.from('timeline_events').select('id, event_type, scope, occurred_at, payload')
      .eq('user_id', clientId).order('occurred_at', { ascending: false }).limit(PAGE + 1);
    if (scope !== 'all') q = q.eq('scope', scope);
    if (before) q = q.lt('occurred_at', before);
    const { data, error: e } = await q;
    setLoading(false);
    if (e) { setError('Could not load the timeline. Try again.'); return; }
    const rows = (data ?? []) as TimelineEvent[];
    setMore(rows.length > PAGE);
    const page = rows.slice(0, PAGE);
    setEvents(prev => (replace ? page : [...prev, ...page]));
  }, [clientId, scope]);
  useEffect(() => { void fetchPage(null, true); }, [fetchPage]);

  const days = groupByDay(events);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="group" aria-label="Timeline filter">
        {SCOPES.map(([k, label]) => (
          <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k}
            className={`px-3 min-h-[36px] rounded-full text-xs ${scope === k ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{label}</button>
        ))}
      </div>
      {error && <div role="alert" className="text-sm text-[#FF6B6B]">{error} <button onClick={() => void fetchPage(null, true)} className="underline">Retry</button></div>}
      {!error && !loading && days.length === 0 && <p className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">Nothing on the timeline yet. It fills as this client logs food, energy and water that they share with you.</p>}
      {days.map(g => (
        <div key={g.day} className="bg-[#1C1C1E] rounded-2xl p-4">
          <p className="text-xs font-semibold text-[#8E8E93] mb-2">{dayLabel(g.day)}</p>
          <ul className="space-y-2">
            {g.lines.map(l => (
              <li key={l.id} className="flex gap-3 text-sm">
                <span className="w-11 text-[#8E8E93] tabular-nums shrink-0">{l.time}</span>
                <span aria-hidden>{l.icon}</span>
                <span><span>{l.title}</span>{l.detail && <span className="block text-[11px] text-[#8E8E93]">{l.detail}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {loading && <p className="text-sm text-[#8E8E93]">Loading…</p>}
      {more && !loading && <button onClick={() => void fetchPage(events[events.length - 1]?.occurred_at ?? null, false)} className="w-full bg-[#242426] rounded-xl py-3 text-sm">Show older</button>}
    </div>
  );
}


const BAND_COLOR = { good: '#30D158', fair: '#FFB347', low: '#FF6B6B', none: '#3A3A3C' } as const;

function Adherence({ clientId, shared }: { clientId: string; shared: boolean }) {
  const [days, setDays] = useState<7 | 14 | 30>(7);
  const [rows, setRows] = useState<AdherenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const load = useCallback(async () => {
    setRows(null); setError(null);
    const from = new Date(new Date(today + 'T00:00:00Z').getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
    const { data, error: e } = await supabase.from('daily_adherence')
      .select('day, calorie_adherence, protein_adherence, fat_adherence, macro_adherence, logging_adherence, checkin_adherence')
      .eq('user_id', clientId).gte('day', from).lte('day', today).order('day');
    if (e) { setError('Could not load adherence. Try again.'); return; }
    setRows(((data ?? []) as AdherenceRow[]).map(r => ({
      ...r, calorie_adherence: r.calorie_adherence == null ? null : Number(r.calorie_adherence), protein_adherence: r.protein_adherence == null ? null : Number(r.protein_adherence),
      fat_adherence: r.fat_adherence == null ? null : Number(r.fat_adherence), macro_adherence: r.macro_adherence == null ? null : Number(r.macro_adherence),
      logging_adherence: Number(r.logging_adherence), checkin_adherence: Number(r.checkin_adherence),
    })));
  }, [clientId, days, today]);
  useEffect(() => { if (shared) void load(); }, [load, shared]);

  if (!shared) return <p className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">This client has not shared their food log, so adherence is not available.</p>;
  if (error) return <div role="alert" className="text-sm text-[#FF6B6B]">{error} <button onClick={() => void load()} className="underline">Retry</button></div>;
  if (!rows) return <p className="text-sm text-[#8E8E93]">Loading…</p>;

  const sum = summarize(rows, days);
  const series = fillDays(rows, today, days);
  const tile = (label: string, v: number | null, suffix = '%') => (
    <div className="bg-[#242426] rounded-xl p-3"><p className="text-lg font-bold" style={{ color: BAND_COLOR[band(v)] }}>{v == null ? '–' : `${Math.round(v)}${suffix}`}</p><p className="text-[11px] text-[#8E8E93]">{label}</p></div>
  );
  const bars = (title: string, pick: (r: AdherenceRow) => number | null) => (
    <div className="bg-[#1C1C1E] rounded-2xl p-4">
      <p className="text-xs font-semibold text-[#8E8E93] mb-2">{title}</p>
      <div className="flex items-end gap-[3px] h-20" role="img" aria-label={`${title}, one bar per day, oldest first`}>
        {series.map(r => { const v = pick(r); return (
          <div key={r.day} className="flex-1 flex flex-col justify-end h-full" title={`${r.day}: ${v == null ? 'no data' : Math.round(v) + '%'}`}>
            <div className="rounded-sm" style={{ height: `${v == null ? 4 : Math.max(4, v)}%`, background: BAND_COLOR[band(v)] }} />
          </div>); })}
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <select value={days} onChange={e => setDays(Number(e.target.value) as 7 | 14 | 30)} aria-label="Time window" className="bg-[#242426] rounded-lg px-2 py-2 text-sm text-white">
        <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
      </select>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {tile('Calories', sum.calorie)}{tile('Protein', sum.protein)}{tile('Macros', sum.macro)}
        <div className="bg-[#242426] rounded-xl p-3"><p className="text-lg font-bold">{sum.loggedDays}/{sum.days}</p><p className="text-[11px] text-[#8E8E93]">Days logged</p></div>
        <div className="bg-[#242426] rounded-xl p-3"><p className="text-lg font-bold">{sum.checkinDays}/{sum.days}</p><p className="text-[11px] text-[#8E8E93]">Energy check-ins</p></div>
      </div>
      {bars('Calorie adherence by day', r => r.calorie_adherence)}
      {bars('Protein adherence by day', r => r.protein_adherence)}
      <p className="text-[11px] text-[#636366]">Calories score 100 when within 10% of target and fall to 0 at 50% off. Protein is intake against target, capped at 100. Days with no logging show as grey, not as a failure.</p>
    </div>
  );
}

export default function ClientDetailPage() {
  const { clientId = '' } = useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState<'overview' | 'adherence' | 'weekly' | 'timeline'>('overview');

  useEffect(() => {
    let live = true;
    supabase.rpc('coach_dashboard', { p_days: 7 }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setState('error'); return; }
      const r = ((data ?? []) as Row[]).find(x => x.client_id === clientId);
      if (r) { setRow(r); setState('ready'); } else setState('missing');
    });
    return () => { live = false; };
  }, [clientId]);

  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-4xl mx-auto space-y-4">
      <Link to="/coach" className="text-xs text-[#8E8E93] underline">← All clients</Link>
      {state === 'loading' && <p className="text-sm text-[#8E8E93]">Loading…</p>}
      {state === 'error' && <p role="alert" className="text-sm text-[#FF6B6B]">Could not load this client. Check your connection and try again.</p>}
      {state === 'missing' && <p className="bg-[#1C1C1E] rounded-2xl p-5 text-sm text-[#8E8E93]">This client was not found, or is not linked to you.</p>}
      {state === 'ready' && row && (
        <>
          <h1 className="text-xl font-bold">{row.client_name}</h1>
          <div role="tablist" className="flex flex-wrap gap-1.5">
            {(['overview', 'adherence', 'weekly', 'timeline'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`px-4 min-h-[40px] rounded-full text-sm ${tab === t ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{t === 'overview' ? 'Overview' : t === 'adherence' ? 'Adherence' : t === 'weekly' ? 'Weekly review' : 'Timeline'}</button>
            ))}
          </div>
          {tab === 'overview' ? <Overview row={row} /> : tab === 'weekly' ? <WeeklyReviewPanel clientId={row.client_id} mode="coach" /> : tab === 'adherence' ? <Adherence clientId={row.client_id} shared={!!row.share_scope.food} /> : <Timeline clientId={row.client_id} />}
        </>
      )}
    </div>
  );
}
