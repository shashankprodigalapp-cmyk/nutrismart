/**
 * JourneyPage.tsx — "Your journey": levels, Food Explorer (regional kitchens tried) and Kitchen Detective lessons.
 * Switch 'ui_journey'. Lessons also need 'ui_detective' (turned on only after a nutrition professional has reviewed them).
 * No ranking, no comparison, no loss. English or Hinglish.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFlag } from '../lib/useFlag';
import { localDb } from '../lib/localDb';
import { coachApi } from '../lib/coachApi';
import { LEVELS, levelFor, POINTS_NAME } from '../lib/sparks';
import { REGIONS, explorerLine, nextIdea, regionsTried } from '../lib/regions';
import { LESSONS } from '../content/lessons';
import { setLang, useLang } from '../lib/lang';
import { tr } from '../lib/copyHi';

export default function JourneyPage() {
  const { user } = useAuth();
  const lang = useLang();
  const on = useFlag('ui_journey');
  const detectiveOn = useFlag('ui_detective');
  const [total, setTotal] = useState<number | null>(null);
  const [tried, setTried] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const rows = (await localDb.daily_logs.toArray()).filter(l => l.user_id === user.id);
        if (live) setTried(regionsTried(rows.map(r => r.food_name)));
      } catch { /* leave empty */ }
      const r = await coachApi<{ total: number }>('/api/progress', {});
      if (live && r.ok && typeof r.data.total === 'number') setTotal(r.data.total);
    })();
    return () => { live = false; };
  }, [user]);

  const cur = total === null ? null : levelFor(total);
  const idea = nextIdea(tried);
  return (
    <div className="min-h-dvh bg-[#111113] text-white p-4 md:p-8 max-w-xl mx-auto space-y-4 pb-24">
      <Link to="/app" className="inline-flex items-center min-h-[44px] text-sm text-[#8E8E93] underline">← {tr(lang, 'Back')}</Link>
      <h1 className="text-2xl font-semibold">{tr(lang, 'Your journey')}</h1>
      {!on && <p className="text-sm text-[#8E8E93]">This page is not switched on yet.</p>}
      {on && (
        <>
          <section data-testid="journey-levels" className="bg-[#1C1C1E] rounded-2xl p-4" aria-label={tr(lang, 'Levels')}>
            <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{tr(lang, 'Levels')}</h2>
            <ol className="mt-2 space-y-2">
              {LEVELS.map(l => {
                const reached = cur !== null && cur.n >= l.n;
                const here = cur !== null && cur.n === l.n;
                return (
                  <li key={l.n} aria-current={here ? 'step' : undefined} className={'flex items-center justify-between rounded-xl px-3 py-2.5 ' + (here ? 'bg-[#C8F75E]/15' : 'bg-[#242426]')}>
                    <span className="flex items-center gap-2 text-sm"><span aria-hidden="true">{reached ? '✅' : '○'}</span><span className={here ? 'font-semibold' : ''}>{l.name}</span></span>
                    <span className="text-xs text-[#8E8E93]">{l.from} {POINTS_NAME}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section data-testid="journey-explorer" className="bg-[#1C1C1E] rounded-2xl p-4" aria-label={tr(lang, 'Food Explorer')}>
            <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{tr(lang, 'Food Explorer')}</h2>
            <p className="mt-1 text-sm">{explorerLine(tried.length)}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {REGIONS.map(r => {
                const t = tried.includes(r.key);
                return <li key={r.key} className={'rounded-full px-3 min-h-[36px] inline-flex items-center text-xs ' + (t ? 'bg-[#C8F75E] text-[#111113] font-semibold' : 'bg-[#242426] text-[#EBEBF5]')}>{t ? '✓ ' : ''}{r.label}</li>;
              })}
            </ul>
            {idea && <p className="mt-3 text-sm text-[#EBEBF5]/80">If you feel like it: {idea.label} — {idea.ideas.join(', ')}.</p>}
            <p className="mt-2 text-xs text-[#8E8E93]">{tr(lang, 'Based on the foods you have logged on this device.')}</p>
          </section>

          <section data-testid="journey-detective" className="bg-[#1C1C1E] rounded-2xl p-4" aria-label={tr(lang, 'Kitchen Detective')}>
            <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{tr(lang, 'Kitchen Detective')}</h2>
            {!detectiveOn && <p className="mt-1 text-sm text-[#EBEBF5]/80">{tr(lang, 'Short lessons are being reviewed by a nutrition professional. They will appear here once approved.')}</p>}
            {detectiveOn && (
              <ul className="mt-2 space-y-3">
                {LESSONS.map(l => (
                  <li key={l.id}><p className="text-sm font-semibold">{l.title}</p><p className="text-sm text-[#EBEBF5]/80 mt-0.5">{l.body}</p></li>
                ))}
              </ul>
            )}
          </section>

          <section className="bg-[#1C1C1E] rounded-2xl p-4" aria-label={tr(lang, 'Language')}>
            <h2 className="text-[11px] uppercase tracking-wide text-[#8E8E93]">{tr(lang, 'Language')}</h2>
            <div role="radiogroup" aria-label={tr(lang, 'Language')} className="mt-2 grid grid-cols-2 gap-2">
              {(['en', 'hi'] as const).map(k => (
                <button key={k} type="button" role="radio" aria-checked={lang === k} onClick={() => setLang(k)}
                  className={'min-h-[44px] rounded-xl px-2 text-sm font-medium ' + (lang === k ? 'bg-[#C8F75E] text-[#111113]' : 'bg-[#2C2C2E] text-[#EBEBF5]')}>
                  {k === 'en' ? tr(lang, 'English') : tr(lang, 'Hinglish')}
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
