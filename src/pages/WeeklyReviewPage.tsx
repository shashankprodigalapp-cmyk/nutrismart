import React from 'react';
import { Link } from 'react-router-dom';
import WeeklyReviewPanel from '../components/review/WeeklyReviewPanel';

export default function WeeklyReviewPage() {
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-2xl mx-auto space-y-4">
      <Link to="/app" className="text-xs text-[#8E8E93] underline">← Back</Link>
      <h1 className="text-xl font-bold">Your weekly review</h1>
      <WeeklyReviewPanel mode="self" />
    </div>
  );
}
