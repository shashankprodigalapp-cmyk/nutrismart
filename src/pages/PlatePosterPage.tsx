/**
 * PlatePosterPage.tsx — "Your week on a plate": a shareable picture of this week. Matches design artboard 18.
 * Needs 'ui_screens_a'. Only counts real things (days logged, meals logged, regions explored). Nothing is compared.
 * The picture is drawn on this phone; nothing is uploaded.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFlag } from '../lib/useFlag';
import { localDb } from '../lib/localDb';
import { useLang } from '../lib/lang';
import { tr } from '../lib/copyHi';
import { todayIST } from '../lib/kitchenIntelligence';
import { regionsTried } from '../lib/regions';
import { drawPoster, posterStats, weekRangeLabel, type PosterStats } from '../lib/wrapData';
import '../styles/today.css';
import '../styles/wrap.css';

export default function PlatePosterPage() {
  const { user } = useAuth();
  const lang = useLang();
  const on = useFlag('ui_screens_a');
  const [stats, setStats] = useState<PosterStats>({ days: 0, meals: 0, regions: 0 });
  const [msg, setMsg] = useState('');
  const name = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] ?? 'Your';
  const range = weekRangeLabel(todayIST());

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const all = (await localDb.daily_logs.toArray()).filter(l => l.user_id === user.id);
        if (live) setStats(posterStats(todayIST(), all, regionsTried(all.map(r => r.food_name)).length));
      } catch { /* leave zeros */ }
    })();
    return () => { live = false; };
  }, [user]);

  const make = async () => drawPoster({ name, range, stats });
  const save = async () => {
    const b = await make(); if (!b) { setMsg(tr(lang, 'Could not make the picture on this phone.')); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'my-week-on-a-plate.png'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const share = async () => {
    const b = await make(); if (!b) { setMsg(tr(lang, 'Could not make the picture on this phone.')); return; }
    const f = new File([b], 'my-week-on-a-plate.png', { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.canShare && nav.canShare({ files: [f] })) { try { await nav.share({ files: [f] }); } catch { /* cancelled */ } }
    else { await save(); }
  };

  return (
    <div className="min-h-dvh bg-[var(--n-bg,#111113)] text-[var(--ns-ink)] p-4 md:p-8 max-w-xl mx-auto pb-24">
      <div className="nw">
        <Link to="/app" className="nw-back">← {tr(lang, 'Back')}</Link>
        {!on ? <p className="nw-note">{tr(lang, 'This screen is not switched on yet.')}</p> : (
          <>
            <section className="nw-card" data-testid="plate-poster">
              <p className="nw-kicker">NutriSmart IQ · {range}</p>
              <h1 className="nw-title">{name === 'Your' ? tr(lang, 'Your week') : `${name}’s week`}<br />{tr(lang, 'on a plate')}</h1>
              <div className="nw-stats">
                <div className="nw-stat"><b>{stats.days}</b><span>{tr(lang, 'days logged')}</span></div>
                <div className="nw-stat"><b>{stats.meals}</b><span>{tr(lang, 'meals logged')}</span></div>
                <div className="nw-stat"><b>{stats.regions}</b><span>{tr(lang, 'regions explored')}</span></div>
              </div>
              <p className="nw-sub">{tr(lang, 'Understand your food. Discover your patterns. Improve your nutrition.')}</p>
            </section>
            <button type="button" className="nw-btn" onClick={() => { void share(); }}>{tr(lang, 'Share my plate')}</button>
            <button type="button" className="nw-btn nw-btn-2" onClick={() => { void save(); }}>{tr(lang, 'Save image')}</button>
            {msg && <p role="status" className="nw-note">{msg}</p>}
            <p className="nw-note">{tr(lang, 'Made on your phone. Nothing is uploaded.')}</p>
          </>
        )}
      </div>
    </div>
  );
}
