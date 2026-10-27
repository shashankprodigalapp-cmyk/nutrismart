import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { classify, pct, type ClientMetrics, type ClientStatus, type Reason } from '../../lib/coachMetrics';
import { groupByDay, dayLabel, type TimelineEvent } from '../../lib/timeline';

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

export default function ClientDetailPage() {
  const { clientId = '' } = useParams();
  const [row, setRow] = useState<Row | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [tab, setTab] = useState<'overview' | 'timeline'>('overview');

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
          <div role="tablist" className="flex gap-1.5">
            {(['overview', 'timeline'] as const).map(t => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`px-4 min-h-[40px] rounded-full text-sm ${tab === t ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{t === 'overview' ? 'Overview' : 'Timeline'}</button>
            ))}
          </div>
          {tab === 'overview' ? <Overview row={row} /> : <Timeline clientId={row.client_id} />}
        </>
      )}
    </div>
  );
}
