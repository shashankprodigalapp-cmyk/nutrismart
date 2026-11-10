/**
 * LevelUpCard.tsx — the level-up moment from the design (artboard 23), as a card on Today. It never covers the screen.
 * Shown once per level (useProgress decides that). Celebrates what the person did; no ranking, no comparison.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import '../../styles/today.css';
import '../../styles/moments.css';

export function LevelUpCard({ line, name, journey }: { line: string; name?: string; journey: boolean }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <section role="status" data-testid="level-up" className="nm-up">
      <p className="nm-up-kicker">Level up</p>
      <h2 className="nm-up-title">{name ?? line}</h2>
      <p className="nm-up-line">{line}</p>
      {journey && <Link to="/app/journey" className="nm-up-cta">See my journey</Link>}
      <button type="button" className="nm-up-later" onClick={() => setGone(true)}>Maybe later</button>
    </section>
  );
}
