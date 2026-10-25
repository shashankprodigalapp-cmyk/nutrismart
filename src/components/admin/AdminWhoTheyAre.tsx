/**
 * AdminWhoTheyAre.tsx: who the users are, from the optional profile answers.
 * Totals only. Any group of fewer than 10 people is merged into one "small groups" row with no further detail.
 */
import React from 'react';
import { useAdminDemographics, type DemoRow } from './useAdminDemographics';
import { Card, Empty, Kpi, fmtNum, pct } from './adminUi';
import { AGE_BANDS, GENDERS, GOALS, DIETS } from '../../lib/profileOptions';

const labelOf = (list: { v: string; label: string }[], v: string) => list.find(x => x.v === v)?.label ?? v;
const FIELDS: { key: DemoRow['field']; title: string; label: (k: string) => string }[] = [
  { key: 'age_band', title: 'Age', label: k => labelOf(AGE_BANDS, k) },
  { key: 'gender', title: 'Gender', label: k => labelOf(GENDERS, k) },
  { key: 'goal', title: 'Main goal', label: k => labelOf(GOALS, k) },
  { key: 'diet', title: 'Diet', label: k => labelOf(DIETS, k) },
  { key: 'state', title: 'State', label: k => k },
];

export function AdminWhoTheyAre() {
  const { data, error, loading, reload } = useAdminDemographics();

  return (
    <div className="px-4 md:px-8 py-5 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white">Who they are</h2>
          <p className="text-xs text-[#8E8E93]">From the optional profile. Totals only, groups under 10 people are merged and not analysed.</p>
        </div>
        <button onClick={() => void reload()} className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-[#1C1C1E] text-white">Refresh</button>
      </div>

      {loading && !data && <Empty>Loading the numbers...</Empty>}
      {error && <div className="rounded-2xl bg-[#2a1717] border border-[#FF5D5D]/40 text-sm text-[#ffb3b3] p-4">{error}</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="People signed up" value={fmtNum(data.users)} />
            <Kpi label="Started the profile" value={fmtNum(data.started)} sub={`${pct(data.started, data.users)} of everyone`} />
            <Kpi label="Completed all 5" value={fmtNum(data.completed)} sub={`${pct(data.completed, data.users)} of everyone`} />
            <Kpi label="Bonus searches earned" value={`${fmtNum(data.completed * 5)} a day`} sub="Extra AI searches the completed profiles can use" />
          </div>

          {data.completed + data.started === 0 && <Empty>No profiles yet. They appear as people answer in the Profile tab.</Empty>}

          <div className="grid md:grid-cols-2 gap-4">
            {FIELDS.map(f => {
              const rows = data.fields.filter(r => r.field === f.key);
              const total = rows.reduce((a, r) => a + r.n, 0);
              const max = Math.max(1, ...rows.map(r => r.n));
              return (
                <Card key={f.key} title={f.title} hint="Share of people, how many logged food, and how many became habit users (4+ days in a week).">
                  {rows.length === 0 ? <Empty>No answers yet.</Empty> : (
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-[#8E8E93]"><th className="py-1 font-semibold">Answer</th><th className="font-semibold">People</th><th className="font-semibold">Logged</th><th className="font-semibold">Habit</th></tr></thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.k} className="border-t border-white/[0.06] text-white">
                            <td className="py-1.5">
                              <div>{f.label(r.k)}</div>
                              <div className="h-1 rounded-full bg-white/[0.06] mt-1 overflow-hidden"><div className="h-full bg-[#C8F75E]" style={{ width: `${Math.round((r.n / max) * 100)}%` }} /></div>
                            </td>
                            <td>{fmtNum(r.n)} <span className="text-[#8E8E93]">({pct(r.n, total)})</span></td>
                            <td>{r.logged == null ? <span className="text-[#636366]">hidden</span> : pct(r.logged, r.n)}</td>
                            <td>{r.habit == null ? <span className="text-[#636366]">hidden</span> : pct(r.habit, r.n)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default AdminWhoTheyAre;
