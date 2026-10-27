/**
 * AdminPlatform.tsx: the 2.0 admin screen. Numbers, health, coaches, feature switches and the audit log.
 * Every number is counted by the database. Switches and coach approvals are audited on the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Card, Empty, Kpi, fmtNum, STATUS_STYLE } from './adminUi';
import { funnel, reviewOutcome, cohortRate } from '../../lib/v2Analytics';
import { healthChecks, overall, type Metrics } from '../../lib/adminHealth';

async function api<T = Record<string, any>>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; j: T & { message?: string; error?: string } }> {
  const { data: s } = await supabase.auth.getSession();
  try {
    const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${s.session?.access_token ?? ''}`, 'Content-Type': 'application/json' } });
    return { ok: res.ok, status: res.status, j: await res.json().catch(() => ({})) as never };
  } catch { return { ok: false, status: 0, j: { error: 'network', message: 'Could not reach the server.' } as never }; }
}
const errText = (r: { status: number; j: { message?: string } }) => r.status === 403 ? 'This account is not an admin.' : r.j.message ?? 'Could not load. Try again in a minute.';

type Section = 'overview' | 'usage' | 'ai' | 'coaches' | 'plans' | 'flags' | 'audit';
const SECTIONS: Array<[Section, string]> = [['overview', 'Overview'], ['usage', 'Feature use'], ['ai', 'AI usage'], ['coaches', 'Coaches'], ['plans', 'Plans'], ['flags', 'Feature switches'], ['audit', 'Audit log']];

function Overview() {
  const [m, setM] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api('/api/admin-platform').then(r => (r.ok ? setM(r.j.metrics) : setErr(errText(r)))); }, []);
  if (err) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!m) return <Empty>Loading…</Empty>;
  const checks = healthChecks(m as Metrics); const top = overall(checks);
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

function FeatureUse() {
  const [days, setDays] = useState(30);
  const [a, setA] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setA(null); api(`/api/admin-v2-analytics?days=${days}`).then(r => (r.ok ? setA(r.j.analytics) : setErr(errText(r)))); }, [days]);
  if (err) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!a) return <Empty>Loading…</Empty>;
  const ad = a.adoption, co = a.coach;
  const rows: Array<[string, number]> = [['Logged food', ad.food_logging], ['By voice', ad.voice_logging], ['By photo', ad.photo_logging], ['Daily check-ins', ad.daily_checkins], ['Meal notes', ad.meal_feelings], ['Flexible meals', ad.flexible_meals], ['Experiments', ad.experiments], ['Weekly review', ad.weekly_reviews], ['Monthly review', ad.monthly_reviews]];
  const cf = funnel([['Coaches who applied', co.applied], ['Approved', co.approved], ['Invited someone', co.invited_someone], ['Has an active client', co.has_active_client], ['A client logged this week', co.client_logged_7d]]);
  const w = reviewOutcome(a.reviews.weekly_by_status), m = reviewOutcome(a.reviews.monthly_by_status);
  return (
    <div className="space-y-4">
      <div className="flex gap-1.5">{[7, 30, 90].map(n => <button key={n} onClick={() => setDays(n)} aria-pressed={days === n} className={`px-3 min-h-[36px] rounded-full text-xs ${days === n ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#C7C7CC]'}`}>{n} days</button>)}</div>
      <Card title="People using each feature" hint={`Different people in the last ${a.days} days, out of ${fmtNum(ad.active_people)} who logged food. Reminders switched on right now: ${fmtNum(ad.reminders_enabled)}.`}>
        <ul className="space-y-1.5 text-sm">{rows.map(([l, v]) => <li key={l} className="flex justify-between gap-3"><span>{l}</span><b>{fmtNum(v)}</b></li>)}</ul>
      </Card>
      <Card title="Coach funnel" hint="All time. Each step is shown against the step before it.">
        <ul className="space-y-1.5 text-sm">{cf.map(f => <li key={f.label} className="flex justify-between gap-3"><span>{f.label}</span><span><b>{fmtNum(f.count)}</b>{f.ofPrevious != null && <span className="text-[#8E8E93] text-xs"> · {f.ofPrevious}% of previous</span>}</span></li>)}</ul>
        <p className="text-xs text-[#8E8E93] mt-2">Invites in this period: {fmtNum(co.invites_sent)} sent, {fmtNum(co.invites_accepted)} accepted. Coach messages sent: {fmtNum(co.coach_nudges_sent)}.</p>
      </Card>
      <Card title="Reviews" hint="Share of decided reviews. Drafts are not counted.">
        <p className="text-sm text-[#C7C7CC]">Weekly: {w.decided === 0 ? 'none decided yet' : `${w.approvedPct}% approved, ${w.editedPct}% edited, ${w.rejectedPct}% rejected (${w.decided})`}</p>
        <p className="text-sm text-[#C7C7CC] mt-1">Monthly: {m.decided === 0 ? 'none decided yet' : `${m.approvedPct}% approved, ${m.editedPct}% edited, ${m.rejectedPct}% rejected (${m.decided})`}</p>
        <p className="text-xs text-[#8E8E93] mt-2">Written by: {Object.entries(a.reviews.weekly_by_source as Record<string, number>).map(([k, v]) => `${k === 'ai' ? 'AI' : 'rules'} ${v}`).join(', ') || 'nothing yet'}. Experiments: {Object.entries(a.experiments as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(', ') || 'none yet'}.</p>
      </Card>
      <Card title="New people by sign-up week" hint="Under 5 people shows counts, not percentages. Came back = logged food a week or more after signing up.">
        {a.cohorts.length === 0 ? <Empty>No sign-ups in the last 6 weeks.</Empty> : (
          <table className="w-full text-sm"><thead className="text-[11px] text-[#8E8E93] text-left"><tr><th className="py-1">Week of</th><th>Joined</th><th>Logged in week 1</th><th>Came back</th></tr></thead>
            <tbody>{a.cohorts.map((c: any) => <tr key={c.week_start} className="border-t border-white/5"><td className="py-1.5">{c.week_start}</td><td>{c.size}</td><td>{cohortRate(c.logged_first_week, c.size)}</td><td>{cohortRate(c.came_back, c.size)}</td></tr>)}</tbody></table>
        )}
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

interface PlanRow { key: string; audience: 'client' | 'coach'; name: string; description: string | null; price_inr_month: number; price_inr_year: number | null; entitlements: { ai_daily_limit?: number; max_clients?: number | null; features?: string[] }; is_active: boolean; sort_order: number; coaches_on_plan: number }

function PlanEditor({ plan, onSaved }: { plan: PlanRow; onSaved: () => void }) {
  const [name, setName] = useState(plan.name);
  const [month, setMonth] = useState(String(plan.price_inr_month));
  const [year, setYear] = useState(plan.price_inr_year == null ? '' : String(plan.price_inr_year));
  const [limit, setLimit] = useState(String((plan.audience === 'client' ? plan.entitlements.ai_daily_limit : plan.entitlements.max_clients) ?? ''));
  const [active, setActive] = useState(plan.is_active);
  const [msg, setMsg] = useState<string | null>(null);
  const builtIn = ['free', 'pro', 'coach_standard'].includes(plan.key);
  async function save() {
    const ent: Record<string, unknown> = { ...plan.entitlements };
    if (plan.audience === 'client') ent.ai_daily_limit = Number(limit);
    else ent.max_clients = limit.trim() === '' ? null : Number(limit);
    const r = await api('/api/admin-plans', { method: 'POST', body: JSON.stringify({ ...plan, name, price_inr_month: Number(month), price_inr_year: year.trim() === '' ? null : Number(year), entitlements: ent, is_active: active }) });
    setMsg(r.ok ? 'Saved.' : r.j.message ?? 'Could not save.');
    if (r.ok) onSaved();
  }
  const inp = 'bg-[#242426] rounded-lg px-2 min-h-[40px] text-sm w-full';
  return (
    <li className="bg-[#1C1C1E] rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2"><span className="text-xs font-mono text-[#8E8E93]">{plan.key}</span><span className="text-xs px-2 py-0.5 rounded-full bg-white/[0.06]">{plan.audience}</span>{plan.audience === 'coach' && <span className="text-xs text-[#8E8E93]">{plan.coaches_on_plan} coaches</span>}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-[#8E8E93]">
        <label>Name<input className={inp} value={name} maxLength={40} onChange={e => setName(e.target.value)} /></label>
        <label>Rupees per month<input className={inp} inputMode="numeric" value={month} onChange={e => setMonth(e.target.value)} /></label>
        <label>Rupees per year (optional)<input className={inp} inputMode="numeric" value={year} onChange={e => setYear(e.target.value)} /></label>
        <label>{plan.audience === 'client' ? 'AI searches per day' : 'Client cap (empty = no cap)'}<input className={inp} inputMode="numeric" value={limit} onChange={e => setLimit(e.target.value)} /></label>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-5 h-5" checked={active} disabled={builtIn} onChange={e => setActive(e.target.checked)} />Offered{builtIn ? ' (built in)' : ''}</label>
        <button onClick={save} className="px-4 min-h-[40px] rounded-full bg-[#C8F75E] text-[#111113] text-sm font-semibold">Save</button>
        {msg && <span role="status" className="text-xs text-[#C7C7CC]">{msg}</span>}
      </div>
    </li>
  );
}

function Plans() {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [paid, setPaid] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => { api('/api/admin-plans').then(r => { if (r.ok) { setPlans(r.j.plans); setPaid(r.j.active_paid_subscriptions); } else setErr(errText(r)); }); }, []);
  useEffect(load, [load]);
  if (err) return <p role="alert" className="text-sm text-[#FF6B6B]">{err}</p>;
  if (!plans) return <Empty>Loading…</Empty>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[#8E8E93]">{paid} active paid subscriptions. This is the plan catalog. The price shown on the payment screen and the AI search limits the app enforces today (5 free, 200 Pro) are still fixed in the app, so changing them here does not change what people pay or get yet. Client caps for coaches apply only when the v2_plans switch is on. Plans are switched off, never deleted.</p>
      <ul className="space-y-2">{plans.map(p => <PlanEditor key={p.key + p.name + p.price_inr_month + (p.entitlements.max_clients ?? '') + (p.entitlements.ai_daily_limit ?? '')} plan={p} onSaved={load} />)}</ul>
    </div>
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
      {s === 'usage' && <FeatureUse />}
      {s === 'ai' && <AiUsage />}
      {s === 'coaches' && <Coaches />}
      {s === 'plans' && <Plans />}
      {s === 'flags' && <Flags />}
      {s === 'audit' && <Audit />}
    </div>
  );
}
