/**
 * AdminBehaviour.tsx: do people form the habit, which features matter, how healthy is the app.
 * Aggregates only. Groups of fewer than 10 people are not compared.
 */
import React, { useState } from 'react';
import { useAdminBehaviour, type KV } from './useAdminBehaviour';
import { Bars, Card, Empty, HBar, Kpi, STATUS_STYLE, fmtNum, pct, type Status } from './adminUi';

const RANGES = [7, 30, 90];
const MIN_GROUP = 10;

const FEATURE_LABEL: Record<string, string> = {
  notifications_enabled: 'Turned on notifications',
  goals_saved: 'Saved daily goals',
  planner_applied: 'Used the cheat-meal planner',
  preset_applied: 'Used a macro preset',
  checkin_answered: 'Answered an energy check-in',
  app_opened_from_verdict: 'Opened the app from the morning message',
  kitchen_profile_completed: 'Finished the kitchen profile',
  ai_search_name: 'Used AI food search',
  photo_search: 'Used photo search',
};
const METHOD_LABEL: Record<string, string> = { ai_search: 'AI search', photo: 'Photo search', search: 'Search', usual: 'My usuals', template: 'Meal template' };

const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);
const shortWeek = (d: string) => { const [, m, day] = d.split('-'); return `${Number(day)}/${Number(m)}`; };
const sum = (xs: KV[]) => xs.reduce((a, x) => a + x.n, 0);

function Split({ title, rows }: { title: string; rows: KV[] }) {
  const total = sum(rows);
  return (
    <div>
      <p className="text-xs font-semibold text-[#8E8E93] mb-1">{title}</p>
      {rows.length === 0 ? <p className="text-xs text-[#636366]">No data yet</p> :
        rows.map(r => <HBar key={r.k} label={r.k} value={r.n} max={Math.max(...rows.map(x => x.n))} right={`${pct(r.n, total)} (${fmtNum(r.n)})`} />)}
    </div>
  );
}

export function AdminBehaviour() {
  const [days, setDays] = useState<number>(30);
  const { data, error, loading, reload } = useAdminBehaviour(days);
  const b = data?.behaviour;

  let health: Status = 'unknown';
  let errPer100 = 0;
  if (b && b.errors.active_days > 0) {
    errPer100 = ((b.errors.app_errors + b.errors.api_errors) / b.errors.active_days) * 100;
    health = errPer100 < 2 ? 'ok' : errPer100 < 5 ? 'warn' : 'critical';
  }
  const hs = STATUS_STYLE[health];
  const seanTotal = b ? sum(b.feedback.sean_ellis) : 0;
  const seanVery = b ? b.feedback.sean_ellis.find(x => x.k === 'very')?.n ?? 0 : 0;

  return (
    <div className="px-4 md:px-8 py-5 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Behaviour</h2>
          <p className="text-xs text-[#8E8E93]">Do people form the habit, which features matter, and is the app healthy. Dates are India time.</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map(r => (
            <button key={r} onClick={() => setDays(r)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-xl ${days === r ? 'bg-[#C8F75E] text-[#111113]' : 'bg-[#1C1C1E] text-[#8E8E93]'}`}>{r} days</button>
          ))}
          <button onClick={() => void reload()} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1C1C1E] text-white">Refresh</button>
        </div>
      </div>

      {loading && !data && <Empty>Loading the numbers...</Empty>}
      {error && <div className="rounded-2xl bg-[#2a1717] border border-[#FF5D5D]/40 text-sm text-[#ffb3b3] p-4">{error}</div>}

      {b && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Habit users, last 7 days" value={fmtNum(b.kpis.habit_7d)}
              sub={`${pct(b.kpis.habit_7d, b.kpis.active_7d)} of ${fmtNum(b.kpis.active_7d)} active. Habit = logged on 4+ days.`} />
            <Kpi label="Meals per active day" value={b.kpis.meals_per_active_day.toFixed(1)} sub={`${b.kpis.full_days_pct}% of days have 3+ different meals`} />
            <Kpi label="App health" value={health === 'unknown' ? 'No data' : `${errPer100.toFixed(1)}`}
              sub={health === 'unknown' ? 'Fills after the update is live' : 'errors per 100 active days'} />
            <Kpi label="Active days counted" value={fmtNum(b.kpis.active_days)} sub={`Person-days with a log, last ${b.days} days`} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Habit users by week" hint="People who logged on 4 or more days that week, out of everyone who logged. The most important chart here.">
              {b.weekly.length === 0 ? <Empty>No logs yet.</Empty> : (
                <Bars height={130}
                  items={b.weekly.map(w => ({ label: shortWeek(w.week), values: [w.habit, Math.max(0, w.active - w.habit)] }))}
                  parts={[{ name: 'Habit users (4+ days)', color: '#C8F75E' }, { name: 'Other active', color: '#636366' }]} />
              )}
            </Card>
            <Card title="When people log" hint={`India time, last ${b.days} days. Send messages just before the busy hours.`}>
              {b.hours.every(h => h.n === 0) ? <Empty>No logs yet.</Empty> : (
                <Bars height={130} items={b.hours.map(h => ({ label: hourLabel(h.hour), values: [h.n] }))} parts={[{ name: 'Logs', color: '#C8F75E' }]} />
              )}
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Longest streak per person" hint="How many days in a row people have logged, best run ever.">
              {b.streaks.length === 0 ? <Empty>No logs yet.</Empty> :
                b.streaks.map(s => <HBar key={s.bucket} label={s.bucket} value={s.users} max={Math.max(...b.streaks.map(x => x.users))} right={`${fmtNum(s.users)} people`} />)}
            </Card>
            <Card title="Which day a streak breaks" hint="The day a run of 3+ days ended. A spike on one weekday is a chance for a nudge.">
              {b.streak_breaks.length === 0 ? <Empty>Not enough ended streaks yet.</Empty> :
                b.streak_breaks.map(s => <HBar key={s.dow} label={s.dow} value={s.n} max={Math.max(...b.streak_breaks.map(x => x.n))} right={fmtNum(s.n)} />)}
            </Card>
          </div>

          <Card title="Which features keep people" hint={`"Kept" means still logging 14 to 30 days after signing up. Compares people who used the feature in their first week with people who did not. Needs accounts older than 31 days and at least ${MIN_GROUP} people in each group.`}>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-[#8E8E93]">
                <th className="py-1 font-semibold">Feature</th><th className="font-semibold">Used ({b.days}d)</th><th className="font-semibold">Used again</th>
                <th className="font-semibold">Kept, used early</th><th className="font-semibold">Kept, did not</th></tr></thead>
              <tbody>
                {b.features.map(f => {
                  const enough = f.n_with >= MIN_GROUP && f.n_without >= MIN_GROUP;
                  return (
                    <tr key={f.feature} className="border-t border-white/[0.06] text-white">
                      <td className="py-1.5">{FEATURE_LABEL[f.feature] ?? f.feature}</td>
                      <td>{fmtNum(f.users_used)}</td><td>{fmtNum(f.repeat_users)}</td>
                      <td>{enough ? pct(f.kept_with, f.n_with) : <span className="text-[#636366]">needs more people</span>}</td>
                      <td>{enough ? pct(f.kept_without, f.n_without) : <span className="text-[#636366]">needs more people</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Messages and check-ins, last 7 days" hint="Open rate = people who tapped the message and came into the app.">
              <div className="space-y-1 text-xs text-white">
                <p>Morning message: <b>{fmtNum(b.push.verdict_sent_7d)}</b> sent, <b>{fmtNum(b.push.verdict_opened_7d)}</b> opened ({pct(b.push.verdict_opened_7d, b.push.verdict_sent_7d)})</p>
                <p>Come-back message opened: <b>{fmtNum(b.push.reengage_opened_7d)}</b></p>
                <p>Energy check-in message opened: <b>{fmtNum(b.push.checkin_opened_7d)}</b></p>
                <p>Energy check-ins answered: <b>{fmtNum(b.push.checkin_answered_7d)}</b>, skipped: <b>{fmtNum(b.push.checkin_skipped_7d)}</b></p>
              </div>
              <div className="mt-3"><Split title="Notification permission (latest visit, last 30 days)" rows={b.push.state} /></div>
            </Card>
            <Card title="Where people came from" hint="First visit tag, for example a link ending in ?ref=instagram. People who opened the app without a tag are 'direct'.">
              {b.sources.length === 0 ? <Empty>Fills after the update is live.</Empty> : (
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-[#8E8E93]"><th className="py-1 font-semibold">Source</th><th className="font-semibold">People</th><th className="font-semibold">Logged food</th><th className="font-semibold">Became habit</th></tr></thead>
                  <tbody>{b.sources.map(s => (
                    <tr key={s.ref} className="border-t border-white/[0.06] text-white">
                      <td className="py-1.5">{s.ref}</td><td>{fmtNum(s.users)}</td><td>{pct(s.logged, s.users)}</td><td>{pct(s.habit, s.users)}</td>
                    </tr>))}</tbody>
                </table>
              )}
            </Card>
          </div>

          <Card title="Phones, installs and languages" hint={`Latest visit per person, last 30 days (${fmtNum(b.device.people)} people). Shows whether an Android app is worth building.`}>
            {b.device.people === 0 ? <Empty>Fills after the update is live.</Empty> : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Split title="Phone" rows={b.device.os} /><Split title="Installed as an app?" rows={b.device.install} />
                <Split title="Language" rows={b.device.lang} /><Split title="App build" rows={b.device.build} />
              </div>
            )}
          </Card>

          <Card title="How often people change an AI result" hint="Share of saved AI and photo results where the person changed the amount before saving. High means the numbers are not trusted.">
            {b.edits.filter(e => e.method === 'ai_search' || e.method === 'photo').length === 0 ? <Empty>Fills after the update is live.</Empty> :
              b.edits.filter(e => e.method === 'ai_search' || e.method === 'photo').map(e => (
                <HBar key={e.method} label={METHOD_LABEL[e.method] ?? e.method} value={e.adjusted} max={Math.max(1, e.logged)}
                  right={`${pct(e.adjusted, e.logged)} changed (${fmtNum(e.adjusted)} of ${fmtNum(e.logged)})`} />
              ))}
          </Card>

          <Card title="App health" hint="Errors and slow or failed server calls. Under 2 errors per 100 active days is green, under 5 amber, above that red. A rule of thumb to start from.">
            <div className="flex items-center gap-2 mb-3 text-sm text-white">
              <i className={`inline-block w-3 h-3 rounded-full ${hs.dot}`} />
              {health === 'unknown' ? 'No data yet.' : `${errPer100.toFixed(1)} errors per 100 active days (${fmtNum(b.errors.app_errors)} in the app, ${fmtNum(b.errors.api_errors)} failed server calls).`}
            </div>
            <div className="grid md:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="font-semibold text-[#8E8E93] mb-1">Most common errors</p>
                {b.errors.top_errors.length === 0 ? <p className="text-[#636366]">None</p> : b.errors.top_errors.map((e, i) => (
                  <p key={i} className="text-white py-0.5 border-t border-white/[0.06]">{e.msg} <span className="text-[#8E8E93]">on {e.where}, {fmtNum(e.n)} times, {fmtNum(e.users)} people</span></p>))}
              </div>
              <div>
                <p className="font-semibold text-[#8E8E93] mb-1">Failed server calls</p>
                {b.errors.api_failures.length === 0 ? <p className="text-[#636366]">None</p> : b.errors.api_failures.map((e, i) => (
                  <p key={i} className="text-white py-0.5 border-t border-white/[0.06]">{e.path} <span className="text-[#8E8E93]">status {e.status === '0' ? 'no reply' : e.status}, {fmtNum(e.n)} times, {fmtNum(e.users)} people</span></p>))}
              </div>
              <div>
                <p className="font-semibold text-[#8E8E93] mb-1">Slow actions (over 3 seconds)</p>
                {b.errors.slow.length === 0 ? <p className="text-[#636366]">None</p> : b.errors.slow.map((e, i) => (
                  <p key={i} className="text-white py-0.5 border-t border-white/[0.06]">{e.action} <span className="text-[#8E8E93]">{fmtNum(e.n)} times, typical {(e.p50_ms / 1000).toFixed(1)}s, slowest tenth {(e.p90_ms / 1000).toFixed(1)}s</span></p>))}
              </div>
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="How would you feel if you could no longer use NutriSmart?" hint="Asked once after day 30. A common rule of thumb says 40% 'very disappointed' signals strong fit. Treat it as a guide, with a small sample it moves a lot.">
              {seanTotal === 0 ? <Empty>No answers yet. The question appears for people 30 days after signup.</Empty> : (
                <>
                  <p className="text-2xl font-extrabold text-white mb-2">{pct(seanVery, seanTotal)} <span className="text-sm font-medium text-[#8E8E93]">very disappointed ({fmtNum(seanTotal)} answers)</span></p>
                  {b.feedback.sean_ellis.map(s => <HBar key={s.k} label={s.k === 'very' ? 'Very disappointed' : s.k === 'somewhat' ? 'Somewhat disappointed' : 'Not disappointed'} value={s.n} max={seanTotal} right={pct(s.n, seanTotal)} />)}
                </>
              )}
            </Card>
            <Card title="Why people stayed away" hint="Asked when someone returns after 14 or more days.">
              {b.feedback.exit.length === 0 ? <Empty>No answers yet.</Empty> :
                b.feedback.exit.map(s => <HBar key={s.k} label={({ forgot: 'I forgot', effort: 'Too much effort to log', numbers: 'The numbers felt wrong', missing: 'My foods were missing', no_results: "I didn't see results", other: 'Something else' } as Record<string, string>)[s.k] ?? s.k}
                  value={s.n} max={Math.max(...b.feedback.exit.map(x => x.n))} right={fmtNum(s.n)} />)}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminBehaviour;
