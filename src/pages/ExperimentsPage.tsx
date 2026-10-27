import React from 'react';
import { Link } from 'react-router-dom';
import { ExperimentsPanel } from '../components/experiments/ExperimentsPanel';

export default function ExperimentsPage() {
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-xl mx-auto space-y-4">
      <Link to="/app/energy-mood" className="text-xs text-[#8E8E93] underline">← Energy and mood</Link>
      <h1 className="text-xl font-bold">Experiments</h1>
      <ExperimentsPanel mode="self" />
    </div>
  );
}
