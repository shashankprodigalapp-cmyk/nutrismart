/**
 * DailyWrapPage.tsx — "Today's wrap": what the person did today, in their own words. Matches design artboard 25.
 * Needs 'ui_screens_a'. Reads this phone's own logs only; no network except the Sparks total. No ranking, no comparison.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFlag } from '../lib/useFlag';
import { localDb } from '../lib/localDb';
import { useProgress } from '../lib/useProgress';
import { useLang } from '../lib/lang';
import { tr } from '../lib/copyHi';
import { todayIST } from '../lib/kitchenIntelligence';
import { regionsTried, nextIdea } from '../lib/regions';
import { POINTS_NAME } from '../lib/sparks';
import { wrapLines, wrapTitle, type WrapInput } from '../lib/wrapData';
import '../styles/today.css';
import '../styles/wrap.css';

export default function DailyWrapPage() {
  const { user } = useAuth();
  const lang = useLang();
  const on = useFlag('ui_screens_a');
  const sparksOn = useFlag('ui_sparks');
  const prog = useProgress(on && sparksOn);
  const [d, setD] = useState<WrapInput>({ meals: 0, glasses: 0, energy: null, sparksToday: 0 });
  const [tried, setTried] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const day = todayIST();
        const all = (await localDb.daily_logs.toArray()).filter(l => l.user_id === user.id);
        const water = await localDb.water_logs.get([user.id, day]);
        const en = (await localDb.energy_logs.where('log_date').equals(day).toArray()).filter(e => e.user_id === user.id && !e.skipped);
        if (!live) return;
        setTried(regionsTried(all.map(r => r.food_name)));
        setD(p => ({ ...p, meals: all.filter(l => l.log_date === day).length, glasses: water?.glasses ?? 0, energy: en.length ? en[en.length - 1].level : null }));
      } catch { /* leave empty */ }
    })();
    return () => { live = false; };
  }, [user]);

  const input: WrapInput = { ...d, sparksToday: prog.p?.today ?? 0 };
  const lines = wrapLines(input);
  const idea = nextIdea(tried);
  return (
    <div className="min-h-dvh bg-[var(--n-bg,#111113)] text-[var(--ns-ink)] p-4 md:p-8 max-w-xl mx-auto pb-24">
      <div className="nw">
        <Link to="/app" className="nw-back">← {tr(lang, 'Back')}</Link>
        {!on ? <p className="nw-note">{tr(lang, 'This screen is not switched on yet.')}</p> : (
          <>
            <header className="nw-card">
              <p className="nw-kicker">{tr(lang, "Today's wrap")} 🌙</p>
              <h1 className="nw-title">{tr(lang, wrapTitle(input))}</h1>
              <p className="nw-sub">{tr(lang, 'Here is what you did, in your own words.')}</p>
            </header>
            {lines.length > 0 && (
              <ul className="nw-list">
                {lines.map(l => (<li key={l.key} className="nw-item"><span className="nw-ico" aria-hidden="true">{l.icon}</span>{tr(lang, l.text)}</li>))}
              </ul>
            )}
            {input.sparksToday > 0 && <p className="nw-sparks">+{input.sparksToday} {POINTS_NAME} {tr(lang, 'today')} ✨</p>}
            {idea && <p className="nw-idea">{tr(lang, "Tomorrow's tiny idea:")} {idea.label}, {idea.ideas[0]}. {tr(lang, 'Totally optional.')}</p>}
            <Link to="/app" className="nw-btn">{tr(lang, 'Done for today')}</Link>
            <p className="nw-note">{tr(lang, 'Only you see this. No rankings, no comparisons.')}</p>
          </>
        )}
      </div>
    </div>
  );
}
