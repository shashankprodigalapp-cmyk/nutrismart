/**
 * JourneyPage.tsx — "Your journey": level card, today's quests, this week, levels, Food Explorer (regional kitchens tried) and Kitchen Detective lessons.
 * Switch 'ui_journey'. Lessons also need 'ui_detective' (turned on only after a nutrition professional has reviewed them).
 * No ranking, no comparison, no loss, no streak. English or Hinglish. Matches design artboard 04.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useFlag } from '../lib/useFlag';
import { localDb } from '../lib/localDb';
import { coachApi } from '../lib/coachApi';
import { LEVELS, levelFor, POINTS_NAME, SPARKS_NOTE, type Quest } from '../lib/sparks';
import { REGIONS, explorerLine, nextIdea, regionsTried } from '../lib/regions';
import { LESSONS } from '../content/lessons';
import { setLang, useLang } from '../lib/lang';
import { hiExplorerLine, hiIdea, hiLevelGap, hiWeekLine, hiLevelOf, hiQuestsDone, tr } from '../lib/copyHi';
import { todayIST } from '../lib/kitchenIntelligence';
import { daysLogged, weekDots, weekLine } from '../lib/weekDots';
import '../styles/today.css';
import '../styles/journey.css';

export default function JourneyPage() {
  const { user } = useAuth();
  const lang = useLang();
  const on = useFlag('ui_journey');
  const detectiveOn = useFlag('ui_detective');
  const [total, setTotal] = useState<number | null>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [tried, setTried] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>([]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const rows = (await localDb.daily_logs.toArray()).filter(l => l.user_id === user.id);
        if (live) { setTried(regionsTried(rows.map(r => r.food_name))); setDays(rows.map(r => r.log_date)); }
      } catch { /* leave empty */ }
      const r = await coachApi<{ total: number }>('/api/progress', {});
      if (live && r.ok && typeof r.data.total === 'number') {
        setTotal(r.data.total);
        const q = (r.data as { quests?: Quest[] }).quests;
        if (Array.isArray(q)) setQuests(q);
      }
    })();
    return () => { live = false; };
  }, [user]);

  const cur = total === null ? null : levelFor(total);
  const next = cur ? LEVELS.find(l => l.n === cur.n + 1) : undefined;
  const idea = nextIdea(tried);
  const dots = weekDots(todayIST(), days);
  const doneQ = quests.filter(q => q.done).length;
  return (
    <div className="min-h-dvh bg-[var(--n-bg,#111113)] text-[var(--ns-ink)] p-4 md:p-8 max-w-xl mx-auto pb-24">
      <div className="nj">
        <Link to="/app" className="nj-back min-h-[44px]">← {tr(lang, 'Back')}</Link>
        <header>
          <p className="nj-kicker">{tr(lang, 'Your journey')}</p>
          <h1 className="nj-title">{cur ? cur.name : tr(lang, 'Your journey')}</h1>
        </header>
        {!on && <p className="nj-sub">This page is not switched on yet.</p>}
        {on && (
          <>
            {cur && total !== null && (
              <section data-testid="journey-level-card" className="nj-hero" aria-label={tr(lang, 'Levels')}>
                <div className="nj-hero-row">
                  <span>{lang === 'hi' ? hiLevelOf(cur.n, LEVELS.length) : `Level ${cur.n} of ${LEVELS.length}`}</span>
                  {cur.toNext !== null && cur.nextName && <span className="nj-hero-gold">{lang === 'hi' ? hiLevelGap(cur.toNext, cur.nextName) : `${cur.toNext} ${POINTS_NAME} to ${cur.nextName}`}</span>}
                </div>
                <div className="nj-big"><b>{total}</b>{next && <span>/ {next.from} {POINTS_NAME}</span>}</div>
                <div className="nj-bar" role="progressbar" aria-valuenow={cur.pct} aria-valuemin={0} aria-valuemax={100} aria-label={POINTS_NAME}><i style={{ width: cur.pct + '%' }} /></div>
                <p className="nj-note">{tr(lang, SPARKS_NOTE)}</p>
              </section>
            )}

            {quests.length > 0 && (
              <section data-testid="journey-quests" aria-label={tr(lang, 'Today’s mini quests')}>
                <h2 className="nj-h">{tr(lang, 'Today’s mini quests')}<small>{lang === 'hi' ? hiQuestsDone(doneQ, quests.length) : `${doneQ} of ${quests.length} done`}</small></h2>
                <ul className="nj-quests" style={{ marginTop: 10 }}>
                  {quests.map(q => (
                    <li key={q.id} className={'nj-q' + (q.done ? ' done' : '')}>
                      <span className="nj-q-ico" aria-hidden="true">
                        {q.done && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D7F27A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>}
                      </span>
                      <span style={{ flex: 1 }}>{tr(lang, q.label)}</span>
                      <span className="nj-sub">{q.done ? tr(lang, 'Done') : ''}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section data-testid="journey-week" aria-label={tr(lang, 'This week')}>
              <h2 className="nj-h">{tr(lang, 'This week')}</h2>
              <div className="nj-card" style={{ marginTop: 10 }}>
                <ol className="nj-week">
                  {dots.map(d => (
                    <li key={d.date} className={'nj-day' + (d.state.startsWith('today') ? ' today' : '')}>
                      <div className={'nj-dot ' + d.state} />
                      {tr(lang, d.label)}
                    </li>
                  ))}
                </ol>
                <p className="nj-sub" style={{ marginTop: 12, fontSize: 13, lineHeight: '19px' }}>{lang === 'hi' ? hiWeekLine(daysLogged(dots)) : weekLine(daysLogged(dots))}</p>
              </div>
            </section>

            <section data-testid="journey-levels" className="nj-card" aria-label={tr(lang, 'Levels')}>
              <h2>{tr(lang, 'Levels')}</h2>
              <ol className="nj-levels">
                {LEVELS.map(l => {
                  const reached = cur !== null && cur.n >= l.n;
                  const here = cur !== null && cur.n === l.n;
                  return (
                    <li key={l.n} aria-current={here ? 'step' : undefined} className={'nj-level' + (here ? ' here' : '')}>
                      <span className="flex items-center gap-2"><span aria-hidden="true">{reached ? '✅' : '○'}</span><span>{l.name}</span></span>
                      <small>{l.from} {POINTS_NAME}</small>
                    </li>
                  );
                })}
              </ol>
            </section>

            <section data-testid="journey-explorer" className="nj-card" aria-label={tr(lang, 'Food Explorer')}>
              <h2>{tr(lang, 'Food Explorer')}</h2>
              <p>{lang === 'hi' ? hiExplorerLine(tried.length, REGIONS.length) : explorerLine(tried.length)}</p>
              <ul className="nj-chips">
                {REGIONS.map(r => {
                  const t = tried.includes(r.key);
                  return <li key={r.key} className={'nj-chip' + (t ? ' tried' : '')}>{t ? '✓ ' : ''}{r.label}</li>;
                })}
              </ul>
              {idea && <p>{lang === 'hi' ? hiIdea(idea.label, idea.ideas) : `If you feel like it: ${idea.label} — ${idea.ideas.join(', ')}.`}</p>}
              <p className="nj-sub">{tr(lang, 'Based on the foods you have logged on this device.')}</p>
            </section>

            <section data-testid="journey-detective" className="nj-card" aria-label={tr(lang, 'Kitchen Detective')}>
              <h2>{tr(lang, 'Kitchen Detective')}</h2>
              {!detectiveOn && <p>{tr(lang, 'Short lessons are being reviewed by a nutrition professional. They will appear here once approved.')}</p>}
              {detectiveOn && (
                <ul className="mt-2 space-y-3">
                  {LESSONS.map(l => (
                    <li key={l.id}><p style={{ fontWeight: 600 }}>{l.title}</p><p>{l.body}</p></li>
                  ))}
                </ul>
              )}
            </section>

            <section className="nj-card" aria-label={tr(lang, 'Language')}>
              <h2>{tr(lang, 'Language')}</h2>
              <div role="radiogroup" aria-label={tr(lang, 'Language')} className="nj-lang">
                {(['en', 'hi'] as const).map(k => (
                  <button key={k} type="button" role="radio" aria-checked={lang === k} onClick={() => setLang(k)} className="min-h-[44px]">
                    {k === 'en' ? tr(lang, 'English') : tr(lang, 'Hinglish')}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
