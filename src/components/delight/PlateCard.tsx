/**
 * PlateCard.tsx — "Today's plate": protein first, one calm sentence, and a switch to hide calorie numbers.
 * Shown on the Today tab when the switch 'ui_plate' is on. Uses only totals the app already computes.
 */
import React from 'react';
import { plateLine, type PlateSector } from '../../lib/delight';

const COLORS: Record<PlateSector['key'], string> = {
  protein: '#C8F75E', carbs: '#FF9F0A', fat: '#BF5AF2', water: '#64D2FF',
};

// Quarter-circle paths around a centre of (80,80), radius 70. Protein top-right, then clockwise.
const PATHS: Record<PlateSector['key'], string> = {
  protein: 'M80 80 L80 10 A70 70 0 0 1 150 80 Z',
  carbs:   'M80 80 L150 80 A70 70 0 0 1 80 150 Z',
  fat:     'M80 80 L80 150 A70 70 0 0 1 10 80 Z',
  water:   'M80 80 L10 80 A70 70 0 0 1 80 10 Z',
};

export function PlateCard({
  sectors, meals, hourIST, caloriesHidden, onToggleCalories,
}: {
  sectors: PlateSector[]; meals: number; hourIST: number;
  caloriesHidden: boolean; onToggleCalories: () => void;
}) {
  const label = sectors.map(s => `${s.label} ${s.pct} percent`).join(', ');
  return (
    <section data-testid="plate-card" className="bg-[#1C1C1E] rounded-2xl p-4" aria-label="Today's plate">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">Today's plate</h2>
        <button
          type="button" onClick={onToggleCalories} aria-pressed={!caloriesHidden}
          className="text-xs text-[#C8F75E] min-h-[44px] px-1"
        >
          {caloriesHidden ? 'Show calories' : 'Hide calories'}
        </button>
      </div>
      <div className="flex items-center gap-4">
        <svg width="112" height="112" viewBox="0 0 160 160" role="img" aria-label={label} className="flex-shrink-0">
          {sectors.map(s => (
            <g key={s.key}>
              <path d={PATHS[s.key]} fill="#2C2C2E" stroke="#1C1C1E" strokeWidth="4" />
              <path d={PATHS[s.key]} fill={COLORS[s.key]} fillOpacity={s.pct === 0 ? 0 : 0.2 + 0.8 * (s.pct / 100)} stroke="#1C1C1E" strokeWidth="4" />
            </g>
          ))}
          <circle cx="80" cy="80" r="20" fill="#000" />
        </svg>
        <ul className="flex-1 space-y-1.5">
          {sectors.map(s => (
            <li key={s.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: COLORS[s.key] }} />
                {s.label}
              </span>
              <span className={s.key === 'protein' ? 'font-semibold text-white' : 'text-[#EBEBF5]/70'}>{s.pct}%</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-[#EBEBF5]/80 mt-3">{plateLine(sectors, hourIST, meals)}</p>
    </section>
  );
}
