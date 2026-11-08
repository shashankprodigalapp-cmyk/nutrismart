/**
 * TodayHero.tsx — the top of the Today tab, as in the design canvas: today's thali in a deep green card with one next step,
 * and one large action button under it. Shown when the switch 'ui_screens_a' is on. Uses only totals the app already computes.
 * English or Hinglish.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { type PlateSector } from '../../lib/delight';
import { nextAction } from '../../lib/todayAction';
import { useLang } from '../../lib/lang';
import { hinglishNext, tr } from '../../lib/copyHi';
import '../../styles/today.css';

const COLORS: Record<PlateSector['key'], string> = { protein: '#D7F27A', carbs: '#D6A96B', fat: '#D9D0F7', water: '#8FCDB3' };
const PATHS: Record<PlateSector['key'], string> = {
  protein: 'M80 80 L80 10 A70 70 0 0 1 150 80 Z',
  carbs:   'M80 80 L150 80 A70 70 0 0 1 80 150 Z',
  fat:     'M80 80 L80 150 A70 70 0 0 1 10 80 Z',
  water:   'M80 80 L10 80 A70 70 0 0 1 80 10 Z',
};
function word(pct: number, hi: boolean): string {
  if (pct <= 0) return hi ? 'khaali' : 'empty';
  if (pct < 60) return hi ? 'thoda' : 'some';
  return hi ? 'bhara' : 'filled';
}

export function TodayHero({ sectors, meals, hourIST }: { sectors: PlateSector[]; meals: number; hourIST: number }) {
  const lang = useLang();
  const hi = lang === 'hi';
  const base = nextAction(sectors, hourIST, meals);
  const a = hi ? hinglishNext(base) : base;
  const label = sectors.map(s => `${s.label} ${s.pct} percent`).join(', ');
  return (
    <>
      <section data-testid="today-hero" className="ns-hero" aria-label="Today at a glance">
        <span className="ns-hero-orb" aria-hidden="true" />
        <div className="ns-hero-row">
          <svg width="132" height="132" viewBox="0 0 160 160" role="img" aria-label={label} style={{ flex: 'none' }}>
            {sectors.map(s => (
              <g key={s.key}>
                <path d={PATHS[s.key]} style={{ fill: 'rgba(255,255,255,0.08)', stroke: 'var(--ns-hero)', strokeWidth: 4 }} />
                {s.pct > 0
                  ? <path d={PATHS[s.key]} style={{ fill: COLORS[s.key], fillOpacity: 0.35 + 0.65 * (s.pct / 100), stroke: 'var(--ns-hero)', strokeWidth: 4 }} />
                  : <path d={PATHS[s.key]} style={{ fill: 'none', stroke: 'var(--ns-hero-sub)', strokeWidth: 2.5, strokeDasharray: '5 4' }} />}
              </g>
            ))}
            <circle cx="80" cy="80" r="20" style={{ fill: 'var(--ns-hub)' }} />
          </svg>
          <div className="ns-hero-copy">
            <p className="ns-eyebrow">{tr(lang, "Today's plate")}</p>
            <h2 className="ns-hero-title">{a.title}</h2>
            <p className="ns-hero-body">{a.body}</p>
          </div>
        </div>
        <ul className="ns-legend">
          {sectors.map(s => (
            <li key={s.key}><b style={{ color: COLORS[s.key] }}>{s.label}</b> {word(s.pct, hi)}</li>
          ))}
        </ul>
      </section>
      <Link to={a.to} data-testid="hero-cta" className="ns-cta">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        {a.cta}
      </Link>
    </>
  );
}
