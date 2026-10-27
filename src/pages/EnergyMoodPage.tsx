import React from 'react';
import { Link } from 'react-router-dom';
import { DailyCheckInCard } from '../components/energy/DailyCheckInCard';
import { MealFeelingCard } from '../components/energy/MealFeelingCard';
import { EnergyMoodPanel } from '../components/energy/EnergyMoodPanel';

export default function EnergyMoodPage() {
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-xl mx-auto space-y-4">
      <Link to="/app" className="text-xs text-[#8E8E93] underline">← Back</Link>
      <h1 className="text-xl font-bold">Energy and mood</h1>
      <DailyCheckInCard />
      <MealFeelingCard />
      <EnergyMoodPanel mode="self" />
    </div>
  );
}
