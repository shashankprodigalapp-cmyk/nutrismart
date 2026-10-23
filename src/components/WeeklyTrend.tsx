import React, { useEffect, useState } from 'react';
import { localDb } from '../lib/localDb';
import { useAuth } from '../context/AuthContext';
import { useTargets } from '../lib/useTargets';
import { todayIST } from '../lib/kitchenIntelligence';

interface Day { date: string; label: string; cal: number; protein: number; logged: boolean; isToday: boolean; }

function lastSevenDates(): string[] {
  const [y, m, d] = todayIST().split('-').map(Number);
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date(Date.UTC(y, m - 1, d - i, 12));
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

export function WeeklyTrend() {
  const { user } = useAuth();
  const targets = useTargets();
  const [days, setDays] = useState<Day[] | null>(null);

  useEffect(() => {
    if (!user) return;
    const dates = lastSevenDates();
    const today = todayIST();
    localDb.daily_logs.where('log_date').anyOf(dates).toArray().then(rows => {
      const mine = rows.filter(r => r.user_id === user.id);
      setDays(dates.map(date => {
        const rs = mine.filter(r => r.log_date === date);
        const [y, m, d] = date.split('-').map(Number);
        return {
          date,
          label: new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-IN', { weekday: 'narrow', timeZone: 'UTC' }),
          cal: rs.reduce((s, r) => s + (r.cal ?? 0), 0),
          protein: rs.reduce((s, r) => s + (r.protein ?? 0), 0),
          logged: rs.length > 0,
          isToday: date === today,
        };
      }));
    }).catch(() => setDays([]));
  }, [user]);

  if (!days) return null;
  const logged = days.filter(d => d.logged);
  const avgCal = logged.length ? Math.round(logged.reduce((s, d) => s + d.cal, 0) / logged.length) : 0;
  const avgPro = logged.length ? Math.round(logged.reduce((s, d) => s + d.protein, 0) / logged.length) : 0;
  const within = logged.filter(d => d.cal <= targets.cal).length;
  const scale  = Math.max(targets.cal * 1.25, ...days.map(d => d.cal), 1);
  const H = 96;

  return (
    <section className="bg-[#1C1C1E] border border-white/[0.07] rounded-2xl p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-[#F5F5F5]">This week</h2>
        <span className="text-[11px] text-[#8E8E93]">Goal {targets.cal} kcal</span>
      </div>

      {logged.length === 0 ? (
        <p className="text-[12px] text-[#8E8E93] py-6 text-center">Log a few meals and your week will show up here.</p>
      ) : (
        <>
          <div className="relative flex items-end justify-between gap-2" style={{ height: H }}>
            <div className="absolute left-0 right-0 border-t border-dashed border-white/20 pointer-events-none"
                 style={{ bottom: Math.round((targets.cal / scale) * H) }} />
            {days.map(d => (
              <div key={d.date} className="flex-1 flex flex-col justify-end items-center h-full" title={`${d.date}: ${Math.round(d.cal)} kcal`}>
                {d.logged && <span className="text-[9px] text-[#8E8E93] mb-0.5">{Math.round(d.cal)}</span>}
                <div
                  className={`w-full max-w-[28px] rounded-t-md ${d.logged ? (d.cal > targets.cal ? 'bg-[#FFB347]' : 'bg-[#C8F75E]') : 'bg-white/[0.06]'} ${d.isToday ? 'ring-1 ring-white/40' : ''}`}
                  style={{ height: d.logged ? Math.max(4, Math.round((d.cal / scale) * (H - 14))) : 4 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between gap-2 mt-1.5">
            {days.map(d => (
              <span key={d.date} className={`flex-1 text-center text-[10px] ${d.isToday ? 'text-[#F5F5F5] font-semibold' : 'text-[#8E8E93]'}`}>{d.label}</span>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2 mt-4">
            {[
              { v: String(avgCal), u: 'kcal', l: 'Daily average' },
              { v: String(avgPro), u: 'g',    l: 'Protein average' },
              { v: `${within}/${logged.length}`, u: '', l: 'Days within goal' },
            ].map(s => (
              <div key={s.l} className="bg-[#242426] rounded-xl px-2 py-2.5 text-center">
                <div className="text-[16px] font-bold text-[#F5F5F5]">{s.v}<span className="text-[11px] font-normal text-[#8E8E93] ml-0.5">{s.u}</span></div>
                <div className="text-[10px] text-[#8E8E93] mt-0.5">{s.l}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default WeeklyTrend;
