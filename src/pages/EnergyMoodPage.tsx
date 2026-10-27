import React from 'react';
import { Link } from 'react-router-dom';
import { useFlag } from '../lib/useFlag';
import { DailyCheckInCard } from '../components/energy/DailyCheckInCard';
import { MealFeelingCard } from '../components/energy/MealFeelingCard';
import { EnergyMoodPanel } from '../components/energy/EnergyMoodPanel';

export default function EnergyMoodPage() {
  const expOn = useFlag('v2_experiments');
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-xl mx-auto space-y-4">
      <Link to="/app" className="text-xs text-[#8E8E93] underline">← Back</Link>
      <h1 className="text-xl font-bold">Energy and mood</h1>
      <DailyCheckInCard />
      <MealFeelingCard />
      {expOn && <Link to="/app/experiments" className="block bg-[#1C1C1E] rounded-2xl p-4 min-h-[44px]"><span className="text-sm font-semibold">Experiments</span><span className="block text-xs text-[#8E8E93]">Try a small change and compare your numbers</span></Link>}
      <EnergyMoodPanel mode="self" />
    </div>
  );
}
