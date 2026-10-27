import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { todayIST } from '../../lib/kitchenIntelligence';
import { useFlag } from '../../lib/useFlag';
import { track } from '../../lib/analytics';
import { TEMPLATES, evaluate, addDays, type Exp, type Evaluation, type MetricKey, type Template } from '../../lib/experiments';
import { loadDayValues } from '../../lib/experimentData';

interface Row extends Exp { id: string; title: string; template: string; result: { summary?: string; adherencePct?: number | null; metrics?: Array<{ text: string }> } | null }
interface View { row: Row; ev: Evaluation; ticks: Record<string, number[]> }

function ResultBlock({ ev, stored }: { ev: Evaluation | null; stored?: Row['result'] }) {
  const lines = ev ? ev.metrics.map(m => m.text) : (stored?.metrics ?? []).map(m => m.text);
  const summary = ev ? ev.summary : stored?.summary;
  return (
    <div className="space-y-1">
      {summary && <p className="text-sm">{summary}</p>}
      <details><summary className="text-[11px] text-[#8E8E93] cursor-pointer min-h-[24px]">Numbers</summary>
        <ul className="text-[11px] text-[#8E8E93] list-disc pl-4 space-y-0.5">{lines.map(l => <li key={l}>{l}</li>)}</ul></details>
    </div>
  );
}

export function ExperimentsPanel({ mode, clientId }: { mode: 'self' | 'coach'; clientId?: string }) {
  const on = useFlag('v2_experiments');
  const today = todayIST();
  const [views, setViews] = useState<View[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [msg, setMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<Template | null>(null);
  const [duration, setDuration] = useState<7 | 14>(7);

  const load = useCallback(async () => {
    setState('loading');
    let q = supabase.from('experiments').select('id, template, title, actions, metrics, start_date, duration_days, baseline_days, status, result').order('start_date', { ascending: false }).limit(10);
    if (clientId) q = q.eq('user_id', clientId);
    const { data, error } = await q;
    if (error) { setState('error'); return; }
    const rows = (data ?? []) as unknown as Row[];
    const out: View[] = [];
    for (const row of rows) {
      const end = addDays(row.start_date, row.duration_days - 1);
      const [vals, tk] = await Promise.all([
        loadDayValues(clientId, addDays(row.start_date, -row.baseline_days), end),
        supabase.from('experiment_days').select('day, done').eq('experiment_id', row.id),
      ]);
      const ticks: Record<string, number[]> = {}; for (const t of tk.data ?? []) ticks[String(t.day)] = (t.done ?? []) as number[];
      const ev = evaluate(row, vals, ticks, today);
      out.push({ row, ev, ticks });
      // a finished experiment is closed once, with its result saved
      if (mode === 'self' && row.status === 'active' && ev.phase === 'finished') {
        await supabase.from('experiments').update({ status: 'completed', ended_at: new Date().toISOString(), result: { summary: ev.summary, adherencePct: ev.adherencePct, metrics: ev.metrics.map(m => ({ text: m.text })) } }).eq('id', row.id);
        row.status = 'completed'; track('experiment_completed', { template: row.template });
      }
    }
    setViews(out); setState('ready');
  }, [clientId, mode, today]);
  useEffect(() => { if (on) void load(); }, [on, load]);
  if (!on) return null;

  async function start() {
    if (!picked) return;
    setMsg(null);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from('experiments').insert({
      user_id: u.user.id, template: picked.key, title: picked.title, actions: picked.actions, metrics: picked.metrics, start_date: today, duration_days: duration, baseline_days: 7,
    });
    if (error) { setMsg(error.code === '23505' ? 'You already have an experiment running. Finish or stop it first.' : 'Could not start. Try again.'); return; }
    track('experiment_started', { template: picked.key, days: duration }); setPicked(null); void load();
  }
  async function tick(v: View, i: number) {
    const cur = new Set(v.ticks[today] ?? []); cur.has(i) ? cur.delete(i) : cur.add(i);
    const done = [...cur].sort();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from('experiment_days').upsert({ experiment_id: v.row.id, user_id: u.user!.id, day: today, done, updated_at: new Date().toISOString() }, { onConflict: 'experiment_id,day' });
    if (error) { setMsg('Could not save that tick.'); return; }
    void load();
  }
  async function stop(v: View) {
    await supabase.from('experiments').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', v.row.id);
    track('experiment_stopped', { template: v.row.template }); void load();
  }

  if (state === 'loading') return <p className="text-sm text-[#8E8E93]">Loading experiments…</p>;
  if (state === 'error') return <p role="alert" className="text-sm text-[#FF6B6B]">Could not load experiments. <button onClick={() => load()} className="underline">Retry</button></p>;
  const active = (views ?? []).find(v => v.row.status === 'active');
  const past = (views ?? []).filter(v => v.row.status !== 'active');
  return (
    <section className="space-y-3" aria-label="Experiments">
      <h2 className="text-sm font-semibold">Experiments</h2>
      {msg && <p role="alert" className="text-xs text-[#FF6B6B]">{msg}</p>}

      {active && (
        <div className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
          <div><p className="text-sm font-semibold">{active.row.title}</p>
            <p className="text-[11px] text-[#8E8E93]">{active.ev.phase === 'not_started' ? 'Starts soon' : `Day ${active.ev.dayNumber} of ${active.row.duration_days}`} · {active.ev.daysLeft} days left</p></div>
          {mode === 'self' && active.ev.phase === 'running' && (
            <fieldset className="space-y-1"><legend className="text-xs text-[#8E8E93] mb-1">Today, tick what you did</legend>
              {active.row.actions.map((a, i) => (
                <label key={i} className="flex items-center gap-3 min-h-[44px]"><input type="checkbox" className="w-5 h-5" checked={(active.ticks[today] ?? []).includes(i)} onChange={() => tick(active, i)} /><span className="text-sm">{a}</span></label>
              ))}
            </fieldset>
          )}
          {mode === 'coach' && <ul className="list-disc pl-5 text-sm">{active.row.actions.map(a => <li key={a}>{a}</li>)}</ul>}
          <ResultBlock ev={active.ev} />
          {active.ev.adherencePct != null && <p className="text-[11px] text-[#8E8E93]">Steps done so far: {active.ev.adherencePct}%</p>}
          {mode === 'self' && <button onClick={() => stop(active)} className="px-4 min-h-[40px] rounded-full bg-[#242426] text-xs text-[#FF6B6B]">Stop this experiment</button>}
        </div>
      )}

      {mode === 'self' && !active && (
        <div className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
          {!picked ? (
            <>
              <p className="text-sm">Try a small change for a week or two and see how your numbers compare with the week before.</p>
              <ul className="space-y-2">{TEMPLATES.map(t => (
                <li key={t.key}><button onClick={() => setPicked(t)} className="w-full text-left bg-[#242426] rounded-xl p-3 min-h-[56px]"><span className="block text-sm font-medium">{t.title}</span><span className="block text-xs text-[#8E8E93]">{t.goal}</span></button></li>
              ))}</ul>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold">{picked.title}</p>
              <ul className="list-disc pl-5 text-sm">{picked.actions.map(a => <li key={a}>{a}</li>)}</ul>
              <p className="text-xs text-[#8E8E93]">We will compare: {picked.metrics.map(k => (k as MetricKey).replace(/_/g, ' ')).join(', ')}. Checking in each morning gives the best comparison.</p>
              <div className="flex gap-2">{([7, 14] as const).map(d => <button key={d} aria-pressed={duration === d} onClick={() => setDuration(d)} className={`px-3 min-h-[40px] rounded-full text-sm ${duration === d ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{d} days</button>)}</div>
              <div className="flex gap-2"><button onClick={start} className="px-4 min-h-[44px] rounded-full bg-[#C8F75E] text-[#111113] font-semibold text-sm">Start today</button><button onClick={() => setPicked(null)} className="px-4 min-h-[44px] rounded-full bg-[#242426] text-sm">Back</button></div>
              <p className="text-[11px] text-[#636366]">This is a personal trial, not medical advice. Stop any time.</p>
            </>
          )}
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-2"><h3 className="text-xs uppercase tracking-wide text-[#8E8E93]">Past</h3>
          {past.map(v => (
            <div key={v.row.id} className="bg-[#1C1C1E] rounded-2xl p-4 space-y-1">
              <p className="text-sm font-medium">{v.row.title} <span className="text-[11px] text-[#8E8E93]">· {v.row.start_date} · {v.row.status === 'cancelled' ? 'stopped' : `${v.row.duration_days} days`}</span></p>
              {v.row.status === 'completed' ? <ResultBlock ev={null} stored={v.row.result ?? { summary: v.ev.summary, metrics: v.ev.metrics }} /> : <p className="text-xs text-[#8E8E93]">Stopped early.</p>}
            </div>
          ))}
        </div>
      )}
      {mode === 'coach' && !active && past.length === 0 && <p className="text-sm text-[#8E8E93]">No experiments shared.</p>}
    </section>
  );
}
