/**
 * AdminPlatform.tsx: the 2.0 admin screen. Numbers, health, coaches, feature switches and the audit log.
 * Every number is counted by the database. Switches and coach approvals are audited on the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, Empty, Kpi, fmtNum, STATUS_STYLE } from './adminUi';
import { healthChecks, overall, type Metrics } from '../../lib/adminHealth';

async function api<T = Record<string, any>>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; j: T & { message?: string; error?: string } }> {
  const { data: s } = await supabase.auth.getSession();
  try {
    const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, 'Content-Type': 'application/json' } });
    return { ok: res.ok, status: res.status, j: await res.json().catch(() => ({})) as never };
  } catch { return { ok: false, status: 0, j: { error: 'network', message: 'Could not reach the server.' } as never }; }
}
const errText = (r: { status: number; j: { message?: string } }) => r.status === 403 ? 'This account is not an admin.' : r.j.message ?? 'Could not load. Try again in a minute.';

type Section = 'overview' | 'ai' | 'coaches' | 'flags' | 'audit';
const SECTIONS: Array<[Section, string]> = [['overview', 'Overview'], ['ai', 'AI usage'], ['coaches', 'Coaches'], ['flags', 'Feature switches'], ['audit', 'Audit log']];

function Overview() {
  const [m, setM] = useState<(Metrics & Record<string, any>) | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('/api/admin-platform').then(r => (r.ok ? setM(r.j.metrics) : setErr(errText(r)))); }, []);
  if (err) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!m) return <Empty>Loading…</Empty>;
  const checks = healthChecks(m); const top = overall(checks);
  return (
    <div className="space-y-4">
      <Card title="System health" hint="Each line says what it looked at.">
        <p className={`text-sm font-semibold mb-2 ${STATUS_STYLE[top].text}`}>{top === 'ok' ? 'All fine' : top === 'unknown' ? 'Not enough data to judge' : top === 'warn' ? 'Needs a look' : 'Needs attention now'}</p>
        <ul className="space-y-1.5">{checks.map(c => <li key={c.id} className="flex gap-2 text-sm"><i className={`mt-1.5 inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_STYLE[c.level].dot}`} /><span><b className="font-semibold">{c.name}.</b> <span className="text-[#C7C7CC]">{c.detail}</span></span></li>)}</ul>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Users" value={fmtNum(m.users.total)} sub={`${fmtNum(m.users.new_7d)} new in 7 days`} />
        <Kpi label="Daily / weekly / monthly active" value={`${fmtNum(m.users.dau)} / ${fmtNum(m.users.wau)} / ${fmtNum(m.users.mau)}`} sub="people who opened the app" />
        <Kpi label="Still around" value={m.users.retained_pct == null ? 'n/a' : `${m.users.retained_pct}%`} sub="of people who joined 8 to 30 days ago, opened the app this week" />
        <Kpi label="Logged food (7 days)" value={fmtNum(m.users.loggers_7d)} sub="different people" />
        <Kpi label="Active coaches" value={fmtNum(m.coaches.active)} sub={`${fmtNum(m.coaches.pending)} waiting for approval`} />
        <Kpi label="Active coached clients" value={fmtNum(m.coaches.active_clients)} sub={`${fmtNum(m.coaches.pending_invites)} invites open`} />
        <Kpi label="Paid subscriptions" value={fmtNum(m.subscriptions.paid_active)} sub={Object.entries(m.subscriptions.by_status as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'} />
        <Kpi label="Foods in database" value={fmtNum(m.food_database.foods)} sub={`${fmtNum(m.food_database.unverified)} to verify`} />
      </div>
      <Card title="Logging in the last 7 days">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {[['Food logs', m.logging_7d.food_logs], ['By voice', m.logging_7d.voice_logs], ['By photo', m.logging_7d.photo_logs], ['Check-ins', m.logging_7d.checkins], ['Meal notes', m.logging_7d.meal_feelings]].map(([l, v]) => <div key={l as string}><p className="text-[#8E8E93] text-xs">{l}</p><p className="text-lg font-bold">{fmtNum(v as number)}</p></div>)}
        </div>
      </Card>
      <Card title="Reviews and notifications (7 days)">
        <p className="text-sm text-[#C7C7CC]">Reviews: {fmtNum(m.reviews_7d.weekly)} weekly, {fmtNum(m.reviews_7d.monthly)} monthly, {fmtNum(m.reviews_7d.ai_written)} written with AI, {fmtNum(m.reviews_7d.waiting_for_coach)} waiting for a coach.</p>
        <p className="text-sm text-[#C7C7CC] mt-1">Nudges: {fmtNum(m.notifications_7d.sent)} sent, {fmtNum(m.notifications_7d.skipped)} skipped, {fmtNum(m.notifications_7d.failed)} failed, {fmtNum(m.notifications_7d.queued_now)} queued now. {fmtNum(m.notifications_7d.devices)} devices registered.</p>
        {Object.keys(m.notifications_7d.skip_reasons ?? {}).length > 0 && <p className="text-xs text-[#8E8E93] mt-1">Why skipped: {Object.entries(m.notifications_7d.skip_reasons as Record<string, number>).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}</p>}
      </Card>
    </div>
  );
}

function AiUsage() {
  const [m, setM] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('/api/admin-platform').then(r => (r.ok ? setM(r.j.metrics) : setErr(errText(r)))); }, []);
  if (err) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!m) return <Empty>Loading…</Empty>;
  const a = m.ai_7d;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="AI calls (7 days)" value={fmtNum(a.calls)} />
        <Kpi label="Failed" value={fmtNum(a.failures)} sub={a.calls ? `${Math.round((a.failures / a.calls) * 100)}%` : undefined} />
        <Kpi label="Tokens in / out" value={`${fmtNum(a.input_tokens)} / ${fmtNum(a.output_tokens)}`} />
        <Kpi label="Average speed" value={a.avg_latency_ms == null ? 'n/a' : `${fmtNum(a.avg_latency_ms)} ms`} />
      </div>
      <Card title="By feature" hint="Cost is not estimated here because prices change; use the tokens with your provider's price list.">
        {a.by_endpoint.length === 0 ? <Empty>No AI calls in the last 7 days.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[480px]"><thead className="text-[11px] text-[#8E8E93] text-left"><tr><th className="py-1">Feature</th><th>Calls</th><th>Failed</th><th>Tokens in / out</th><th>Speed</th></tr></thead>
            <tbody>{a.by_endpoint.map((e: any) => <tr key={e.endpoint} className="border-t border-white/5"><td className="py-1.5">{e.endpoint}</td><td>{fmtNum(e.calls)}</td><td>{fmtNum(e.failures)}</td><td>{fmtNum(e.input_tokens)} / {fmtNum(e.output_tokens)}</td><td>{e.avg_latency_ms == null ? 'n/a' : `${fmtNum(e.avg_latency_ms)} ms`}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="Recent AI errors">
        {a.recent_errors.length === 0 ? <Empty>No errors in the last 7 days.</Empty> : (
          <ul className="text-sm space-y-1">{a.recent_errors.map((e: any, i: number) => <li key={i} className="text-[#C7C7CC]">{new Date(e.at).toLocaleString('en-IN')} · {e.endpoint} ({e.provider}) · {e.outcome}{e.http_status ? ` ${e.http_status}` : ''}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}

function Coaches() {
  const [rows, setRows] = useState<Array<{ user_id: string; display_name: string; credentials: string | null; status: string; created_at: string; active_clients: number }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api('/api/admin-coaches').then(r => (r.ok ? setRows(r.j.coaches) : setErr(errText(r)))); }, []);
  useEffect(load, [load]);
  async function act(user_id: string, action: 'approve' | 'suspend') {
    const r = await api('/api/admin-coaches', { method: 'POST', body: JSON.stringify({ user_id, action }) });
    if (!r.ok) setErr(r.j.message ?? 'Could not save.'); else setErr(null);
    load();
  }
  if (err) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!rows) return <Empty>Loading…</Empty>;
  if (!rows.length) return <Empty>No coaches yet. Turn on coach sign-up under Feature switches, or approve applications here once they arrive.</Empty>;
  return (
    <ul className="space-y-2">{rows.map(c => (
      <li key={c.user_id} className="bg-[#1C1C1E] rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[180px]"><p className="text-sm font-semibold">{c.display_name}</p><p className="text-xs text-[#8E8E93]">{c.credentials ?? 'No credentials given'} · {c.active_clients} active clients · applied {new Date(c.created_at).toLocaleDateString('en-IN')}</p></div>
        <span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06]">{c.status}</span>
        {c.status !== 'active' && <button onClick={() => act(c.user_id, 'approve')} className="px-3 min-h-[40px] rounded-full bg-[#C8F75E] text-[#111113] text-xs font-semibold">Approve</button>}
        {c.status !== 'suspended' && <button onClick={() => act(c.user_id, 'suspend')} className="px-3 min-h-[40px] rounded-full bg-[#242426] text-xs text-[#FF6B6B]">Suspend</button>}
      </li>
    ))}</ul>
  );
}

function Flags() {
  const [flags, setFlags] = useState<Array<{ key: string; enabled: boolean; description: string | null; updated_at: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => { api('/api/admin-flags').then(r => (r.ok ? setFlags(r.j.flags) : setErr(errText(r)))); }, []);
  useEffect(load, [load]);
  async function toggle(key: string, enabled: boolean) {
    setBusy(key); setErr(null);
    const r = await api('/api/admin-flags', { method: 'POST', body: JSON.stringify({ key, enabled }) });
    setBusy(null);
    if (!r.ok) setErr(r.j.message ?? 'Could not change that switch.');
    load();
  }
  if (err && !flags) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!flags) return <Empty>Loading…</Empty>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-[#8E8E93]">Switches take effect for everyone within about a minute. Every change is written to the audit log.</p>
      {err && <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>}
      {flags.map(f => (
        <label key={f.key} className="bg-[#1C1C1E] rounded-2xl p-4 flex items-center gap-3 min-h-[56px]">
          <span className="flex-1 min-w-0"><span className="block text-sm font-mono">{f.key}</span><span className="block text-xs text-[#8E8E93]">{f.description ?? ''}</span></span>
          <input type="checkbox" className="w-6 h-6" checked={f.enabled} disabled={busy === f.key} onChange={e => toggle(f.key, e.target.checked)} aria-label={`Switch ${f.key}`} />
        </label>
      ))}
    </div>
  );
}

function Audit() {
  const [entries, setEntries] = useState<Array<{ id: string; actor_role: string | null; action: string; target_user: string | null; meta: Record<string, unknown>; created_at: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [prefix, setPrefix] = useState('');
  useEffect(() => { setEntries(null); api(`/api/admin-audit?limit=100${prefix ? `&action=${prefix}` : ''}`).then(r => (r.ok ? setEntries(r.j.entries) : setErr(errText(r)))); }, [prefix]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">{[['', 'All'], ['coach', 'Coach'], ['flag', 'Switches'], ['weekly', 'Weekly reviews'], ['monthly', 'Monthly reviews'], ['nudge', 'Nudges'], ['attention', 'Attention']].map(([k, l]) => (
        <button key={k} onClick={() => setPrefix(k)} aria-pressed={prefix === k} className={`px-3 min-h-[36px] rounded-full text-xs ${prefix === k ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{l}</button>
      ))}</div>
      {err && <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>}
      {!entries && !err && <Empty>Loading…</Empty>}
      {entries && entries.length === 0 && <Empty>No entries yet.</Empty>}
      {entries && entries.length > 0 && (
        <div className="overflow-x-auto bg-[#1C1C1E] rounded-2xl"><table className="w-full text-xs min-w-[560px]"><thead className="text-[#8E8E93] text-left"><tr><th className="p-2">When</th><th>Who</th><th>What</th><th>About</th><th>Details</th></tr></thead>
          <tbody>{entries.map(e => <tr key={e.id} className="border-t border-white/5 align-top"><td className="p-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString('en-IN')}</td><td>{e.actor_role ?? 'system'}</td><td>{e.action.replace(/_/g, ' ')}</td><td className="font-mono">{e.target_user ? e.target_user.slice(0, 8) : ''}</td><td className="text-[#8E8E93] break-all">{Object.keys(e.meta ?? {}).length ? JSON.stringify(e.meta) : ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export function AdminPlatform() {
  const [s, setS] = useState<Section>('overview');
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto text-white">
      <div className="flex flex-wrap gap-1.5" role="tablist">{SECTIONS.map(([k, l]) => (
        <button key={k} role="tab" aria-selected={s === k} onClick={() => setS(k)} className={`px-3 min-h-[40px] rounded-full text-sm ${s === k ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{l}</button>
      ))}</div>
      {s === 'overview' && <Overview />}
      {s === 'ai' && <AiUsage />}
      {s === 'coaches' && <Coaches />}
      {s === 'flags' && <Flags />}
      {s === 'audit' && <Audit />}
    </div>
  );
}
