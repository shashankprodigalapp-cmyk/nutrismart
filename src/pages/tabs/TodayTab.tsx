/**
 * TodayTab.tsx — Daily summary dashboard
 * Shows today's nutrition at a glance: calories, macros, water, energy check-in prompt.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { localDb } from '../../lib/localDb';
import { useTargets } from '../../lib/useTargets';
import { useAlerts } from '../../components/ContextualAlerts';
import { ProfileNudge } from '../../components/ProfileCompletion';
import { FlexibleMealCard } from '../../components/FlexibleMealCard';
import { DailyCheckInCard } from '../../components/energy/DailyCheckInCard';
import { DailyIntelligence } from '../../components/intel/DailyIntelligence';
import { useFlag } from '../../lib/useFlag';
import { PlateCard } from '../../components/delight/PlateCard';
import { WelcomeBackCard } from '../../components/delight/WelcomeBackCard';
import { TodayHero } from '../../components/screens/TodayHero';
import { SparksCard } from '../../components/sparks/SparksCard';
import { MoreForToday, type MoreRow } from '../../components/screens/MoreForToday';
import { useProgress } from '../../lib/useProgress';
import { useLang } from '../../lib/lang';
import { tr } from '../../lib/copyHi';
import { POINTS_NAME } from '../../lib/sparks';
import { caloriesHidden, plateSectors, setCaloriesHidden } from '../../lib/delight';

interface TodaySummary {
  calories:  number;
  protein:   number;
  carbs:     number;
  fat:       number;
  water_ml:  number;
  meals:     number;
}

const GLASS_ML = 250;

export default function TodayTab() {
  const { user } = useAuth();
  const { cal: baseGoal, protein: PROTEIN_GOAL, water: waterGlasses } = useTargets();
  const { eventBudget } = useAlerts();
  const flexOn = useFlag('v2_flexible_meals');
  const reviewOn = useFlag('v2_weekly_review');
  const checkinsOn = useFlag('v2_checkins');
  const intelOn = useFlag('daily_intelligence');
  const plateOn = useFlag('ui_plate');
  const welcomeOn = useFlag('ui_welcome_back');
  const heroOn = useFlag('ui_screens_a');
  const sparksOn = useFlag('ui_sparks');
  const journeyOn = useFlag('ui_journey');
  const lang = useLang();
  const prog = useProgress(heroOn && sparksOn);
  const { carbs: CARBS_GOAL, fat: FAT_GOAL } = useTargets();
  const [hideCal, setHideCal] = useState<boolean>(() => caloriesHidden());
  // Same rule as the Log tab: an active event budget replaces the daily calorie goal.
  const CALORIE_GOAL = eventBudget.active ? eventBudget.daytimeBudget : baseGoal;
  const WATER_GOAL = waterGlasses * GLASS_ML;
  const [summary, setSummary] = useState<TodaySummary>({
    calories: 0, protein: 0, carbs: 0, fat: 0, water_ml: 0, meals: 0,
  });
  const [greeting, setGreeting] = useState('Good morning');

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 5)             setGreeting('Hello');
    else if (h >= 12 && h < 17) setGreeting('Good afternoon');
    else if (h >= 17)      setGreeting('Good evening');
  }, []);

  useEffect(() => {
    if (!user) return;
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    Promise.all([
      localDb.daily_logs.where('log_date').equals(todayIST).toArray(),
      localDb.water_logs.get([user.id, todayIST]),
    ])
      .then(([logs, water]) => {
        const mine = logs.filter(l => l.user_id === user.id);
        const s = mine.reduce<TodaySummary>((acc, l) => ({
          calories: acc.calories + (l.cal ?? 0),
          protein:  acc.protein  + (l.protein ?? 0),
          carbs:    acc.carbs    + (l.carbs ?? 0),
          fat:      acc.fat      + (l.fat ?? 0),
          water_ml: acc.water_ml,
          meals:    acc.meals + 1,
        }), { calories: 0, protein: 0, carbs: 0, fat: 0, water_ml: (water?.glasses ?? 0) * 250, meals: 0 });
        setSummary(s);
      })
      .catch(err => console.error('[TodayTab] load failed', err));
  }, [user]);

  const calPct     = Math.min(100, Math.round((summary.calories / CALORIE_GOAL) * 100));
  const proteinPct = Math.min(100, Math.round((summary.protein  / PROTEIN_GOAL)  * 100));
  const waterPct   = Math.min(100, Math.round((summary.water_ml / WATER_GOAL)    * 100));

  const firstName = user?.user_metadata?.full_name?.split(' ')[0] ?? 'there';
  const plate = plateSectors(
    { protein: summary.protein, carbs: summary.carbs, fat: summary.fat, water_ml: summary.water_ml },
    { protein: PROTEIN_GOAL, carbs: CARBS_GOAL, fat: FAT_GOAL, water_ml: WATER_GOAL },
  );
  const hourIST = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })) % 24;
  const showCal = !(plateOn && hideCal);

  if (heroOn) {
    const now = new Date();
    const dayWord = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const timeWord = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toLowerCase();
    const q = prog.p?.quests ?? [];
    const nextQuest = q.find(x => !x.done);
    const rows: MoreRow[] = [];
    if (intelOn) rows.push({ key: 'signal', tint: 'gold', icon: 'spark', title: tr(lang, "Today's signal"), sub: tr(lang, 'One pattern and one thing to try'), action: tr(lang, 'View'), body: <DailyIntelligence /> });
    if (checkinsOn) rows.push({ key: 'checkin', tint: 'lav', icon: 'bolt', title: tr(lang, 'Energy check-in'), sub: tr(lang, 'Takes 5 seconds'), action: tr(lang, 'Start'), body: <DailyCheckInCard /> });
    if (prog.p && journeyOn) rows.push({ key: 'quests', tint: 'lime', icon: 'trophy', title: `${tr(lang, 'Quests')}: ${q.filter(x => x.done).length} / ${q.length}`, sub: nextQuest ? tr(lang, nextQuest.label) : tr(lang, 'All done for today'), action: tr(lang, 'Open'), to: '/app/journey' });
    if (checkinsOn) rows.push({ key: 'mood', tint: 'lime', icon: 'chart', title: 'Energy and mood', sub: tr(lang, 'Your trends, after-meal notes and patterns'), action: tr(lang, 'Open'), to: '/app/energy-mood' });
    if (flexOn) rows.push({ key: 'flex', tint: 'gold', icon: 'plate', title: tr(lang, 'Flexible meal'), sub: tr(lang, 'Set some calories aside for a bigger meal'), action: tr(lang, 'Plan'), body: <FlexibleMealCard /> });
    if (reviewOn) rows.push({ key: 'review', tint: 'lime', icon: 'book', title: 'Your weekly review', sub: tr(lang, 'How last week went, with the numbers behind it'), action: tr(lang, 'Open'), to: '/app/weekly-review' });
    rows.push({
      key: 'numbers', tint: 'gold', icon: 'chart', title: tr(lang, "Today's numbers"),
      sub: showCal ? `${Math.round(summary.calories)} kcal · ${summary.meals} ${summary.meals === 1 ? 'meal' : 'meals'}` : `${summary.meals} ${summary.meals === 1 ? 'meal' : 'meals'}`,
      action: tr(lang, 'Show'),
      body: (
        <div className="space-y-3">
          {showCal && (
            <div className="bg-[#1C1C1E] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-[#EBEBF5]/60">Calories today</span>
                <span className="text-xs text-[#636366]">{eventBudget.active ? 'Event budget' : 'Goal'} {CALORIE_GOAL} kcal</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="relative w-20 h-20 flex-shrink-0">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#2C2C2E" strokeWidth="8" />
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#C8F75E" strokeWidth="8"
                      strokeDasharray={`${2 * Math.PI * 34}`} strokeDashoffset={`${2 * Math.PI * 34 * (1 - calPct / 100)}`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-lg font-bold text-white leading-none">{calPct}%</span></div>
                </div>
                <div className="flex-1 space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-[#636366] mb-1"><span>Protein</span><span>{Math.round(summary.protein)}g / {PROTEIN_GOAL}g</span></div>
                    <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden"><div className="h-full bg-[#30D158] rounded-full" style={{ width: `${proteinPct}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-[#636366] mb-1"><span>Water</span><span>{summary.water_ml} / {WATER_GOAL} ml</span></div>
                    <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden"><div className="h-full bg-[#0A84FF] rounded-full" style={{ width: `${waterPct}%` }} /></div>
                  </div>
                </div>
              </div>
              <p className="text-2xl font-bold text-white mt-3">{Math.round(summary.calories)} <span className="text-base font-normal text-[#636366]">kcal</span></p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Protein', value: Math.round(summary.protein), color: '#30D158' },
              { label: 'Carbs', value: Math.round(summary.carbs), color: '#FF9F0A' },
              { label: 'Fat', value: Math.round(summary.fat), color: '#FF453A' },
            ].map(m => (
              <div key={m.label} className="bg-[#1C1C1E] rounded-xl p-3 text-center">
                <div className="text-xl font-bold" style={{ color: m.color }}>{m.value}<span className="text-sm">g</span></div>
                <div className="text-[10px] text-[#636366] mt-0.5 uppercase tracking-wide">{m.label}</div>
              </div>
            ))}
          </div>
          <div className="bg-[#1C1C1E] rounded-2xl p-4 flex items-center justify-between">
            <p className="text-sm text-[#636366]">Meals logged</p>
            <p className="text-2xl font-bold text-white">{summary.meals}</p>
          </div>
        </div>
      ),
    });
    return (
      <div className="p-4 pb-24 max-w-lg md:max-w-3xl md:p-8 lg:max-w-4xl mx-auto space-y-4">
        <header className="ns-head">
          <div>
            <p className="ns-head-sub">{dayWord}, {timeWord}</p>
            <h1 className="ns-title">{tr(lang, 'Hi')} {firstName}</h1>
          </div>
          {prog.p && (journeyOn
            ? <Link to="/app/journey" className="ns-pill" data-testid="sparks-pill"><span className="ns-dot" aria-hidden="true" />{prog.p.total} {POINTS_NAME}</Link>
            : <span className="ns-pill" data-testid="sparks-pill"><span className="ns-dot" aria-hidden="true" />{prog.p.total} {POINTS_NAME}</span>)}
        </header>
        {prog.up && <p role="status" className="ns-note">{prog.up}</p>}
        <ProfileNudge />
        {welcomeOn && <WelcomeBackCard />}
        <TodayHero sectors={plate} meals={summary.meals} hourIST={hourIST} />
        <MoreForToday heading={tr(lang, 'More for today')} rows={rows} />
      </div>
    );
  }

  return (
    <div className="p-4 pb-24 max-w-lg md:max-w-3xl md:p-8 lg:max-w-4xl mx-auto space-y-4">
      {/* Greeting */}
      <div className="pt-2">
        <h1 className="text-xl font-semibold text-white">{greeting}, {firstName}{heroOn ? '' : ' 👋'}</h1>
        <p className="text-sm text-[#636366] mt-0.5">
          {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
        </p>
      </div>

      <ProfileNudge />

      {welcomeOn && <WelcomeBackCard />}

      {heroOn && <TodayHero sectors={plate} meals={summary.meals} hourIST={hourIST} />}

      <SparksCard />

      <MoreWrap clean={heroOn}>
      {intelOn && <DailyIntelligence />}

      {checkinsOn && <DailyCheckInCard />}
      {checkinsOn && (
        <Link to="/app/energy-mood" className="block bg-[#1C1C1E] rounded-2xl p-4 min-h-[44px]">
          <span className="text-sm font-semibold">Energy and mood</span>
          <span className="block text-xs text-[#8E8E93]">Your trends, after-meal notes and patterns</span>
        </Link>
      )}
      {flexOn && <FlexibleMealCard />}
      {reviewOn && (
        <Link to="/app/weekly-review" className="block bg-[#1C1C1E] rounded-2xl p-4 min-h-[44px]">
          <span className="text-sm font-semibold">Your weekly review</span>
          <span className="block text-xs text-[#8E8E93]">How last week went, with the numbers behind it</span>
        </Link>
      )}
      </MoreWrap>

      {plateOn && !heroOn && (
        <PlateCard
          sectors={plate} meals={summary.meals} hourIST={hourIST}
          caloriesHidden={hideCal}
          onToggleCalories={() => { const next = !hideCal; setCaloriesHidden(next); setHideCal(next); }}
        />
      )}

      {/* Calories ring card */}
      {showCal && (
      <div className="bg-[#1C1C1E] rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-[#EBEBF5]/60">Calories today</span>
          <span className="text-xs text-[#636366]">{eventBudget.active ? 'Event budget' : 'Goal'} {CALORIE_GOAL} kcal</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r="34" fill="none" stroke="#2C2C2E" strokeWidth="8"/>
              <circle cx="40" cy="40" r="34" fill="none" stroke="#C8F75E" strokeWidth="8"
                strokeDasharray={`${2 * Math.PI * 34}`}
                strokeDashoffset={`${2 * Math.PI * 34 * (1 - calPct / 100)}`}
                strokeLinecap="round"/>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-white leading-none">{calPct}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-2">
            <div>
              <div className="flex justify-between text-xs text-[#636366] mb-1">
                <span>Protein</span><span>{Math.round(summary.protein)}g / {PROTEIN_GOAL}g</span>
              </div>
              <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
                <div className="h-full bg-[#30D158] rounded-full" style={{ width: `${proteinPct}%` }}/>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-[#636366] mb-1">
                <span>Water</span><span>{summary.water_ml} / {WATER_GOAL} ml</span>
              </div>
              <div className="h-1.5 bg-[#2C2C2E] rounded-full overflow-hidden">
                <div className="h-full bg-[#0A84FF] rounded-full" style={{ width: `${waterPct}%` }}/>
              </div>
            </div>
          </div>
        </div>
        <p className="text-2xl font-bold text-white mt-3">
          {Math.round(summary.calories)} <span className="text-base font-normal text-[#636366]">kcal</span>
        </p>
      </div>
      )}

      {heroOn && (
        <p data-testid="today-macros" className="px-1 text-xs text-[#636366]">
          Protein {Math.round(summary.protein)}g · Carbs {Math.round(summary.carbs)}g · Fat {Math.round(summary.fat)}g · {summary.meals} {summary.meals === 1 ? 'meal' : 'meals'} logged
        </p>
      )}
      {!heroOn && (<>
      {/* Macro chips */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Protein', value: Math.round(summary.protein), unit: 'g', color: '#30D158' },
          { label: 'Carbs',   value: Math.round(summary.carbs),   unit: 'g', color: '#FF9F0A' },
          { label: 'Fat',     value: Math.round(summary.fat),     unit: 'g', color: '#FF453A' },
        ].map(m => (
          <div key={m.label} className="bg-[#1C1C1E] rounded-xl p-3 text-center">
            <div className="text-xl font-bold" style={{ color: m.color }}>{m.value}<span className="text-sm">{m.unit}</span></div>
            <div className="text-[10px] text-[#636366] mt-0.5 uppercase tracking-wide">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Meals logged */}
      <div className="bg-[#1C1C1E] rounded-2xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-[#636366]">Meals logged</p>
          <p className="text-2xl font-bold text-white mt-0.5">{summary.meals}</p>
        </div>
        <div className="text-3xl">🍽️</div>
      </div>

      {/* Quick tips */}
      {summary.calories === 0 && (
        <div className="bg-[#1C1C1E] rounded-2xl p-4 border border-[#C8F75E]/20">
          <p className="text-sm text-[#C8F75E] font-medium">Start your day right 🌟</p>
          <p className="text-xs text-[#636366] mt-1">Tap <Link to="/app/log" className="font-semibold text-white underline">Log</Link> to log your first meal today.</p>
        </div>
      )}
      </>)}
    </div>
  );
}

/** Folds the extra cards under one calm row when the new screens are on; shows them as before otherwise. */
function MoreWrap({ clean, children }: { clean: boolean; children: React.ReactNode }) {
  if (!clean) return <>{children}</>;
  return (
    <details data-testid="today-more" className="group">
      <summary className="min-h-[44px] flex items-center justify-between px-4 rounded-2xl bg-[#1C1C1E] text-sm font-semibold cursor-pointer list-none">
        More for today<span aria-hidden="true" className="text-[#8E8E93] group-open:rotate-90 transition-transform">›</span>
      </summary>
      <div className="space-y-4 mt-4">{children}</div>
    </details>
  );
}
