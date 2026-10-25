/**
 * AdminInsights.tsx: how people use the app, and whether they stay.
 * Aggregates only. No individual's meals are shown on this screen.
 */
import React, { useState } from 'react';
import { useAdminInsights } from './useAdminInsights';
import { Bars, Card, Empty, HBar, Kpi, fmtNum, pct } from './adminUi';

const RANGES = [7, 30, 90] as const;

const METHOD_LABEL: Record<string, string> = {
  search: 'Typed a food name', usual: 'My Usuals', recent: 'Recents', template: 'Saved meal',
  ai_search: 'AI search', ai_vision: 'Photo', photo: 'Photo', master: 'Typed a food name', custom: 'Own food', unknown: 'Not recorded',
};
const FEATURE_LABEL: Record<string, string> = {
  planner_applied: 'Cheat meal planner used', goals_saved: 'Goals saved', notifications_enabled: 'Notifications turned on',
  verdict_viewed: 'Morning verdict opened', verdict_sent: 'Morning verdict sent', ai_search_name: 'AI food search',
  ai_search_describe: 'AI describe search', photo_search: 'Photo search', calorie_anomaly: 'Calorie warning shown', verdict_dismissed: 'Verdict dismissed',
};
const shortDate = (d: string) => { const [, m, day] = d.split('-'); return `${Number(day)}/${Number(m)}`; };
const rate = (n: number, d: number) => (d > 0 ? pct(n, d) : '-');

export function AdminInsights() {
  const [days, setDays] = useState<number>(30);
  const { data, error, loading, reload } = useAdminInsights(days);
  const i = data?.insights;

  return (
    <div className="px-4 md:px-8 py-5 max-w-6xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Insights</h2>
          <p className="text-xs text-[#8E8E93]">Totals and trends. Dates are India time.</p>
        </div>
        <div className="flex items-center gap-2">
          {RANGES.map(r => (
            <button key={r} onClick={() => setDays(r)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-xl ${days === r ? 'bg-[#C8F75E] text-[#111113]' : 'bg-[#1C1C1E] text-[#8E8E93]'}`}>
              {r} days
            </button>
          ))}
          <button onClick={() => void reload()} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1C1C1E] text-white">Refresh</button>
        </div>
      </div>

      {loading && !data && <Empty>Loading the numbers...</Empty>}
      {error && <div className="rounded-2xl bg-[#2a1717] border border-[#FF5D5D]/40 text-sm text-[#ffb3b3] p-4">{error}</div>}

      {i && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Total users" value={fmtNum(i.kpis.total_users)} sub={`${fmtNum(i.kpis.signups_7d)} new this week`} />
            <Kpi label="Active today" value={fmtNum(i.kpis.active_today)} sub="logged a meal" />
            <Kpi label="Weekly active" value={fmtNum(i.kpis.wau)} sub={`${rate(i.kpis.wau, i.kpis.total_users)} of all users`} />
            <Kpi label="Monthly active" value={fmtNum(i.kpis.mau)} sub={`${rate(i.kpis.mau, i.kpis.total_users)} of all users`} />
            <Kpi label="Meals today" value={fmtNum(i.kpis.logs_today)} />
            <Kpi label="Meals, 7 days" value={fmtNum(i.kpis.logs_7d)} sub={`${i.kpis.wau > 0 ? (i.kpis.logs_7d / i.kpis.wau).toFixed(1) : '0'} per active user`} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Do new users get started?" hint={`People who signed up in the last ${days} days.`}>
              {i.funnel.signed_up === 0 ? <Empty>No sign-ups in this period.</Empty> : (
                <>
                  <HBar label="Signed up" value={i.funnel.signed_up} max={i.funnel.signed_up} right="100%" />
                  <HBar label="Finished the kitchen questions" value={i.funnel.onboarded} max={i.funnel.signed_up} right={`${fmtNum(i.funnel.onboarded)} (${pct(i.funnel.onboarded, i.funnel.signed_up)})`} />
                  <HBar label="Logged a first meal" value={i.funnel.first_log} max={i.funnel.signed_up} right={`${fmtNum(i.funnel.first_log)} (${pct(i.funnel.first_log, i.funnel.signed_up)})`} />
                  <HBar label="Logged on 2 different days" value={i.funnel.logged_2_days} max={i.funnel.signed_up} right={`${fmtNum(i.funnel.logged_2_days)} (${pct(i.funnel.logged_2_days, i.funnel.signed_up)})`} />
                  <HBar label="Logged on 3 or more days" value={i.funnel.logged_3_days} max={i.funnel.signed_up} right={`${fmtNum(i.funnel.logged_3_days)} (${pct(i.funnel.logged_3_days, i.funnel.signed_up)})`} />
                  <p className="text-xs text-[#8E8E93] mt-3">
                    First meal within 24 hours of signing up: <b className="text-white">{pct(i.funnel.first_log_24h, i.funnel.signed_up)}</b>. This is the number to improve first.
                  </p>
                </>
              )}
            </Card>

            <Card title="Do people come back?" hint="Share of each week's sign-ups who logged again. A dash means too early to tell.">
              {i.retention.length === 0 ? <Empty>No sign-ups yet.</Empty> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[#8E8E93] text-left">
                      <th className="py-1 pr-2 font-semibold">Week of</th><th className="font-semibold">Joined</th>
                      <th className="font-semibold">Next day</th><th className="font-semibold">Around day 7</th><th className="font-semibold">Around day 30</th>
                    </tr></thead>
                    <tbody>
                      {i.retention.map(r => (
                        <tr key={r.week} className="border-t border-white/[0.06] text-white">
                          <td className="py-1.5 pr-2">{shortDate(r.week)}</td>
                          <td>{r.size}</td>
                          <td>{rate(r.retained_d1, r.eligible_d1)}</td>
                          <td>{rate(r.retained_d7, r.eligible_d7)}</td>
                          <td>{rate(r.retained_d30, r.eligible_d30)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Active users per day" hint="People who logged at least one meal.">
              <Bars items={i.daily.map(d => ({ label: shortDate(d.date), values: [d.active] }))} parts={[{ name: 'Active users', color: '#C8F75E' }]} />
            </Card>
            <Card title="New sign-ups per day">
              <Bars items={i.daily.map(d => ({ label: shortDate(d.date), values: [d.signups] }))} parts={[{ name: 'Sign-ups', color: '#7FB5FF' }]} />
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="What people log" hint="Most logged foods and how many different people logged them.">
              {i.top_foods.length === 0 ? <Empty>No meals logged in this period.</Empty> :
                i.top_foods.map(f => <HBar key={f.name} label={f.name} value={f.logs} max={i.top_foods[0].logs} right={`${f.logs} logs, ${f.users} people`} />)}
            </Card>
            <Card title="Foods people searched for and did not find" hint="Add these to the food database first. They are real demand.">
              {i.search_misses.length === 0 ? <Empty>Nothing yet. This fills as people search after the update is live.</Empty> :
                i.search_misses.map(m => <HBar key={m.query} label={m.query} value={m.searches} max={i.search_misses[0].searches} right={`${m.searches} searches, ${m.users} people`} />)}
            </Card>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <Card title="Which meal">
              {i.meals.length === 0 ? <Empty>No data.</Empty> :
                i.meals.map(m => <HBar key={m.meal} label={m.meal[0].toUpperCase() + m.meal.slice(1)} value={m.logs} max={i.meals[0].logs} />)}
            </Card>
            <Card title="How they log">
              {i.log_methods.length === 0 ? <Empty>Recorded from the new version onward.</Empty> :
                i.log_methods.map(m => <HBar key={m.method} label={METHOD_LABEL[m.method] ?? m.method} value={m.logs} max={i.log_methods[0].logs} />)}
            </Card>
            <Card title="Which screens">
              {i.screens.length === 0 ? <Empty>Recorded from the new version onward.</Empty> :
                i.screens.map(s => <HBar key={s.screen} label={s.screen} value={s.views} max={i.screens[0].views} right={`${s.views} views, ${s.users} people`} />)}
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card title="Who are your users right now?" hint="Counts only. Based on the last 7 days.">
              <HBar label="Log 5 or more days a week" value={i.segments.daily_loggers} max={Math.max(1, i.kpis.total_users)} />
              <HBar label="Log 1 to 4 days a week" value={i.segments.casual} max={Math.max(1, i.kpis.total_users)} />
              <HBar label="Stopped (logged before, nothing this week)" value={i.segments.dormant} max={Math.max(1, i.kpis.total_users)} tone="grey" />
              <HBar label="Signed up but never logged" value={i.segments.never_logged} max={Math.max(1, i.kpis.total_users)} tone="grey" />
              <HBar label="Heavy AI users (3 or more AI searches this week)" value={i.segments.ai_heavy} max={Math.max(1, i.kpis.total_users)} />
            </Card>
            <Card title="Features and alerts" hint={`Last ${days} days.`}>
              {i.features.length === 0 ? <Empty>No events yet.</Empty> :
                i.features.slice(0, 10).map(f => <HBar key={f.name} label={FEATURE_LABEL[f.name] ?? f.name} value={f.events} max={i.features[0].events} right={`${f.events} times, ${f.users} people`} />)}
              <p className="text-xs text-[#8E8E93] mt-3">
                Phones registered for alerts: <b className="text-white">{i.system.push_devices}</b> ({i.system.push_users} people).
                Morning verdicts sent in 7 days: <b className="text-white">{i.system.verdicts_sent_7d}</b>.
                AI answers served from the shared cache: <b className="text-white">{pct(i.ai_cache.cache_hits, i.ai_cache.lookups)}</b> (higher means cheaper).
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export default AdminInsights;
