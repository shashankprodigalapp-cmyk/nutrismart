/**
 * TodayTab.tsx — Daily summary dashboard
 * Shows today's nutrition at a glance: calories, macros, water, energy check-in prompt.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { localDb } from '../../lib/localDb';

interface TodaySummary {
  calories:  number;
  protein:   number;
  carbs:     number;
  fat:       number;
  water_ml:  number;
  meals:     number;
}

const CALORIE_GOAL = 2000;
const PROTEIN_GOAL = 60;
const WATER_GOAL   = 2500;

export default function TodayTab() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<TodaySummary>({
    calories: 0, protein: 0, carbs: 0, fat: 0, water_ml: 0, meals: 0,
  });
  const [greeting, setGreeting] = useState('Good morning');

  useEffect(() => {
    const h = new Date().getHours();
    if (h >= 12 && h < 17) setGreeting('Good afternoon');
    else if (h >= 17)      setGreeting('Good evening');
  }, []);

  useEffect(() => {
    if (!user) return;
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    localDb.daily_logs
      .where('logged_date').equals(todayIST)
      .toArray()
      .then(logs => {
        const s = logs.reduce<TodaySummary>((acc: any, l: any) => ({
          calories: acc.calories + (l.calories ?? 0),
          protein:  acc.protein  + (l.protein_g ?? 0),
          carbs:    acc.carbs    + (l.carbs_g ?? 0),
          fat:      acc.fat      + (l.fat_g ?? 0),
          water_ml: acc.water_ml,
          meals:    acc.meals + 1,
        }), { calories: 0, protein: 0, carbs: 0, fat: 0, water_ml: 0, meals: 0 });
        setSummary(s);
      });
  }, [user]);

  const calPct     = Math.min(100, Math.round((summary.calories / CALORIE_GOAL) * 100));
  const proteinPct = Math.min(100, Math.round((summary.protein  / PROTEIN_GOAL)  * 100));
  const waterPct   = Math.min(100, Math.round((summary.water_ml / WATER_GOAL)    * 100));

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] ?? 'there';

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto space-y-4">
      {/* Greeting */}
      <div className="pt-2">
        <h1 className="text-xl font-semibold text-white">{greeting}, {firstName} 👋</h1>
        <p className="text-sm text-[#636366] mt-0.5">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
        </p>
      </div>

      {/* Calories ring card */}
      <div className="bg-[#1C1C1E] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-[#EBEBF5]/60">Calories today</span>
          <span className="text-xs text-[#636366]">Goal {CALORIE_GOAL} kcal</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#2C2C2E" strokeWidth="8"/>
              <circle cx="40" cy="40" r="34" fill="none" stroke="#C8F75E" strokeWidth="8"
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - calPct / 100)}`}
                strokeLinecap="round"/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-white leading-none">{calPct}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <div>
              <div className="flex justify-between text-xs text-[#636366] mb-1">
                <span>Protein</span><span>{Math.round(summary.protein)}g / {PROTEIN_GOAL}g</span>
              </div>
              <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
                <div className="h-full bg-[#30D158] rounded-full" style={{ width: `${proteinPct}%` }}/>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-[#636366] mb-1">
                <span>Water</span><span>{summary.water_ml} / {WATER_GOAL} ml</span>
              </div>
              <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
                <div className="h-full bg-[#0A84FF] rounded-full" style={{ width: `${waterPct}%` }}/>
              </div>
            </div>
          </div>
        </div>
        <p className="text-2xl font-bold text-white mt-3">
          {Math.round(summary.calories)} <span className="text-base font-normal text-[#636366]">kcal</span>
        </p>
      </div>

      {/* Macro chips */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Protein', value: Math.round(summary.protein), unit: 'g', color: '#30D158' },
          { label: 'Carbs',   value: Math.round(summary.carbs),   unit: 'g', color: '#FF9F0A' },
          { label: 'Fat',     value: Math.round(summary.fat),     unit: 'g', color: '#FF453A' },
        ].map(m => (
          <div key={m.label} className="bg-[#1C1C1E] rounded-xl p-3 text-center">
            <div className="text-xl font-bold" style={{ color: m.color }}>{m.value}<span className="text-sm">{m.unit}</span></div>
            <div className="text-[10px] text-[#636366] mt-0.5 uppercase tracking-wide">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Meals logged */}
      <div className="bg-[#1C1C1E] rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-[#636366]">Meals logged</p>
          <p className="text-2xl font-bold text-white mt-0.5">{summary.meals}</p>
        </div>
        <div className="text-3xl">🍽️</div>
      </div>

      {/* Quick tips */}
      {summary.calories === 0 && (
        <div className="bg-[#1C1C1E] rounded-2xl p-4 border border-[#C8F75E]/20">
          <p className="text-sm text-[#C8F75E] font-medium">Start your day right 🌟</p>
          <p className="text-xs text-[#636366] mt-1">Tap <strong className="text-white">Log</strong> to log your first meal today.</p>
        </div>
      )}
    </div>
  );
}
