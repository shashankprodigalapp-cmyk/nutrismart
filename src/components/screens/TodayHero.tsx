/**
 * TodayHero.tsx — the new top of the Today tab: today's thali and one next step.
 * Shown when the switch 'ui_screens_a' is on. Uses only totals the app already computes. English or Hinglish.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { type PlateSector } from '../../lib/delight';
import { nextAction } from '../../lib/todayAction';
import { useLang } from '../../lib/lang';
import { hinglishNext, tr } from '../../lib/copyHi';

const COLORS: Record<PlateSector['key'], string> = { protein: '#C8F75E', carbs: '#FF9F0A', fat: '#BF5AF2', water: '#64D2FF' };
const PATHS: Record<PlateSector['key'], string> = {
  protein: 'M80 80 L80 10 A70 70 0 0 1 150 80 Z',
  carbs:   'M80 80 L150 80 A70 70 0 0 1 80 150 Z',
  fat:     'M80 80 L80 150 A70 70 0 0 1 10 80 Z',
  water:   'M80 80 L10 80 A70 70 0 0 1 80 10 Z',
};

export function TodayHero({ sectors, meals, hourIST }: { sectors: PlateSector[]; meals: number; hourIST: number }) {
  const lang = useLang();
  const base = nextAction(sectors, hourIST, meals);
  const a = lang === 'hi' ? hinglishNext(base) : base;
  const label = sectors.map(s => `${s.label} ${s.pct} percent`).join(', ');
  return (
    <section data-testid="today-hero" className="bg-[#1C1C1E] rounded-3xl p-5" aria-label="Today at a glance">
      <div className="flex items-center gap-5">
        <svg width="124" height="124" viewBox="0 0 160 160" role="img" aria-label={label} className="flex-shrink-0">
          {sectors.map(s => (
            <g key={s.key}>
              <path d={PATHS[s.key]} fill="#2C2C2E" stroke="#1C1C1E" strokeWidth="4" />
              <path d={PATHS[s.key]} fill={COLORS[s.key]} fillOpacity={s.pct === 0 ? 0 : 0.2 + 0.8 * (s.pct / 100)} stroke="#1C1C1E" strokeWidth="4" />
            </g>
          ))}
          <circle cx="80" cy="80" r="20" fill="#000" />
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{tr(lang, 'Your next step')}</p>
          <h2 className="text-lg font-semibold leading-snug mt-1">{a.title}</h2>
          <p className="text-sm text-[#EBEBF5]/70 mt-1">{a.body}</p>
        </div>
      </div>
      <Link to={a.to} data-testid="hero-cta" className="mt-4 flex items-center justify-center min-h-[48px] rounded-2xl bg-[#C8F75E] text-[#111113] text-sm font-semibold">
        {a.cta}
      </Link>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#8E8E93]">
        {sectors.map(s => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block w-2 h-2 rounded-sm" style={{ background: COLORS[s.key] }} />
            {s.label} {s.pct}%
          </li>
        ))}
      </ul>
    </section>
  );
}
