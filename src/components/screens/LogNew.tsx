/**
 * LogNew.tsx — the pieces of the Log screen from the design canvas (artboards 05 and 20): meal title with a "Show numbers" switch,
 * the "Say what you ate" card, "Your usuals" as a list. Used only in the new look. Nothing here writes data.
 */
import React from 'react';
import { useLang } from '../../lib/lang';
import { tr } from '../../lib/copyHi';
import type { FoodAnalytic } from '../../lib/localDb';
import '../../styles/today.css';
import '../../styles/log.css';

export function NewLogHeader({ meal, showNumbers, onToggle }: { meal: string; showNumbers: boolean; onToggle: () => void }) {
  const lang = useLang();
  const label = meal.charAt(0).toUpperCase() + meal.slice(1);
  return (
    <div className="nl-head" data-testid="log-header">
      <h1 className="nl-title">{tr(lang, label)}</h1>
      <button type="button" role="switch" aria-checked={showNumbers} onClick={onToggle} className="nl-switch" data-testid="show-numbers">
        <span>{tr(lang, 'Show numbers')}</span>
        <span className="nl-track" aria-hidden="true"><span className="nl-knob" /></span>
      </button>
    </div>
  );
}

export function MicHero({ children, typed, onType }: { children?: React.ReactNode; typed?: boolean; onType?: () => void }) {
  const lang = useLang();
  return (
    <section className="nl-mic" data-testid="mic-hero" aria-label={tr(lang, typed ? 'Type what you ate' : 'Say what you ate')}>
      <div className="nl-mic-btns">
        {typed ? (
          <button type="button" onClick={onType} aria-label={tr(lang, 'Type what you ate')}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
          </button>
        ) : children}
      </div>
      <p className="nl-mic-t">{tr(lang, typed ? 'Type what you ate' : 'Say what you ate')}</p>
      <p className="nl-mic-s">{tr(lang, 'Try: "do roti, dal aur thoda sabzi"')}</p>
    </section>
  );
}

const TINTS = ['nl-t-gold', 'nl-t-lime', 'nl-t-lav'] as const;

function Row({ item, i, emoji, onSelect, onHide }: { item: FoodAnalytic; i: number; emoji: string; onSelect: () => void; onHide?: () => void }) {
  const lang = useLang();
  const hold = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = React.useRef(false);
  const start = () => { held.current = false; if (onHide) hold.current = setTimeout(() => { held.current = true; onHide(); }, 600); };
  const stop = () => { if (hold.current) clearTimeout(hold.current); };
  return (
    <button type="button" data-testid="usual-row" className="nl-row"
      onPointerDown={start} onPointerLeave={stop} onPointerCancel={stop}
      onPointerUp={() => { stop(); if (!held.current) onSelect(); }}
      onContextMenu={e => e.preventDefault()}>
      <span className={'nl-tile ' + TINTS[i % TINTS.length]} aria-hidden="true">{emoji}</span>
      <span className="nl-row-t">
        <span className="nl-row-n">{item.food_name}</span>
        <span className="nl-row-m">
          {item.use_count > 1 && <span className="nl-pill">{lang === 'hi' ? `${item.use_count} baar` : `Logged ${item.use_count}×`}</span>}
          {item.usual_cal != null && <span className="nl-kcal">{Math.round(item.usual_cal)} kcal</span>}
        </span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </button>
  );
}

export function NewUsuals({ usuals, recents, emojiFor, onSelect, onHide }: {
  usuals: FoodAnalytic[]; recents: FoodAnalytic[]; emojiFor: (name: string) => string;
  onSelect: (f: FoodAnalytic) => void; onHide: (id: string) => void;
}) {
  const lang = useLang();
  const rest = recents.filter(r => !usuals.find(u => u.food_id === r.food_id));
  if (!usuals.length && !rest.length) return null;
  return (
    <div className="nl-usuals" data-testid="usuals-list">
      {usuals.length > 0 && (
        <>
          <h2 className="nl-h">{tr(lang, 'Your usuals (tap to log)')}</h2>
          <div className="nl-list">{usuals.map((u, i) => <Row key={u.food_id} item={u} i={i} emoji={emojiFor(u.food_name)} onSelect={() => onSelect(u)} onHide={() => onHide(u.food_id)} />)}</div>
        </>
      )}
      {rest.length > 0 && (
        <>
          <h2 className="nl-h">{tr(lang, 'Recents')}</h2>
          <div className="nl-list">{rest.slice(0, 6).map((u, i) => <Row key={u.food_id} item={u} i={i} emoji={emojiFor(u.food_name)} onSelect={() => onSelect(u)} />)}</div>
        </>
      )}
    </div>
  );
}

export function UndoBar({ name, onUndo }: { name: string; onUndo: () => void }) {
  const lang = useLang();
  return (
    <div role="status" aria-live="polite" className="nl-undo" data-testid="undo-bar">
      <span className="nl-undo-t">{tr(lang, 'Logged:')} {name}</span>
      <button type="button" onClick={onUndo} className="nl-undo-b">{tr(lang, 'Undo')}</button>
    </div>
  );
}
