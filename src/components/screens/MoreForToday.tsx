/**
 * MoreForToday.tsx — the "More for today" list from the design canvas: one calm row per extra card.
 * A row either links to a page or opens the existing card right under it. Nothing here touches the network.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import '../../styles/today.css';

export interface MoreRow { key: string; tint: 'gold' | 'lav' | 'lime'; icon: 'spark' | 'bolt' | 'trophy' | 'chart' | 'plate' | 'book'; title: string; sub?: string; action: string; to?: string; body?: React.ReactNode; }

const ICONS: Record<MoreRow['icon'], React.ReactNode> = {
  spark: <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  trophy: <><path d="M8 4h8v5a4 4 0 0 1-8 0z" /><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6" /></>,
  chart: <path d="M4 19V9M10 19V5M16 19v-7M21 19H3" />,
  plate: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  book: <><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" /><path d="M8 4v13" /></>,
};

function readExpanded(): boolean { try { return localStorage.getItem('ns-today-expanded') === '1'; } catch { return false; } }

function Row({ r }: { r: MoreRow }) {
  const inner = (
    <>
      <span className={`ns-tile ns-tile-${r.tint}`} aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONS[r.icon]}</svg>
      </span>
      <span className="ns-row-t">
        <p className="ns-row-title">{r.title}</p>
        {r.sub && <p className="ns-row-sub">{r.sub}</p>}
      </span>
      <span className="ns-row-act">{r.action}</span>
    </>
  );
  if (r.to) return <div className="ns-item"><Link to={r.to} className="ns-row">{inner}</Link></div>;
  return (
    <details data-testid="today-row" className="ns-item" open={readExpanded() || undefined}>
      <summary className="ns-row">{inner}</summary>
      <div className="ns-row-body">{r.body}</div>
    </details>
  );
}

export function MoreForToday({ heading, rows }: { heading: string; rows: MoreRow[] }) {
  if (!rows.length) return null;
  return (
    <section data-testid="today-more" aria-label={heading}>
      <h2 className="ns-more-h">{heading}</h2>
      <div className="ns-list">{rows.map(r => <Row key={r.key} r={r} />)}</div>
    </section>
  );
}
