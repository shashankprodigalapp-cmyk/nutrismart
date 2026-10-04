/**
 * InsightsTab.tsx — Personal Food Playbook (Phase 2C.2)
 *
 * HIERARCHY:
 *   My Usual Meals       — detected & saved meal combinations, one-tap log
 *   Meal suggestions     — "You eat this often. Save it?" (auto-detected patterns)
 *   My Usuals            — individual foods (use_count ≥ USUAL_THRESHOLD)
 *   Good for energy      — foods/meals from energy_logs with low crash rate
 *   Heavy for me         — foods/meals with high crash rate
 *   Breakfast / Lunch / Snack / Dinner breakdowns
 *
 * DATA SOURCES (all local, no new network calls):
 *   meal_templates (Dexie)     → My Usual Meals
 *   food_analytics (Dexie)     → My Usuals
 *   daily_logs (Dexie)         → Meal pattern detection + meal-time breakdowns
 *   energy_logs (Dexie)        → Energy-aware insights
 *
 * LOGGING:
 *   "Log whole meal" → logs each template item as a separate LogEntry via
 *   handleConfirmEntry pattern (Dexie write → SyncManager enqueue).
 *   Uses the same multiplier/is_home logic as AddFoodSheet.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  localDb,
  type FoodAnalytic,
  type MealTemplate,
  type LogEntry,
  type EnergyLog,
  recordFoodUsage,
  getUsualFoods,
  USUAL_THRESHOLD,
} from '../../lib/localDb';
import {
  detectMealPatterns,
  buildTemplateKey,
  patternToTemplate,
  type DetectedMealPattern,
} from '../../lib/mealPatterns';
import { getSyncManager } from '../../lib/SyncManager';
import { useAuth } from '../../context/AuthContext';
import { todayIST }  from '../../lib/kitchenIntelligence';
import type { KitchenProfile } from '../../lib/localDb';
import { correlateEnergyToFoods } from '../../lib/energyCorrelation';
import { buildFoodProfiles, generateInsights, type PersonalInsight } from '../../lib/personalFoodIntelligence';

// ── DESIGN TOKENS ─────────────────────────────────────────────────────────────

const T = {
  bg:     'bg-[#111113]',
  s1:     'bg-[#1C1C1E]',
  s2:     'bg-[#242426]',
  border: 'border-white/[0.07]',
  t1:     'text-[#F5F5F5]',
  t2:     'text-[#A1A1A1]',
  t3:     'text-[#636366]',
  lime:   '#C8F75E',
  green:  '#6BCB77',
  red:    '#FF6B6B',
  amber:  '#FFD93D',
} as const;

type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner';
const MEAL_EMOJI: Record<Meal, string> = {
  breakfast: '☀️', lunch: '🌤', snack: '🍎', dinner: '🌙',
};
const MEALS: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];

// ── SECTION HEADER ─────────────────────────────────────────────────────────────

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-3">
      <h2 className={`text-[15px] font-bold ${T.t1}`}>{title}</h2>
      {sub && <p className={`text-[11px] ${T.t3} mt-0.5`}>{sub}</p>}
    </div>
  );
}

// ── MEAL TEMPLATE CARD ────────────────────────────────────────────────────────

function MealTemplateCard({
  template,
  onLog,
  onDelete,
}: {
  template: MealTemplate;
  onLog:    (template: MealTemplate) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`${T.s1} border ${T.border} rounded-2xl overflow-hidden mb-3`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className={`text-[13px] font-semibold ${T.t1} truncate`}>{template.name}</p>
          <p className={`text-[10px] ${T.t3} mt-0.5`}>
            {template.items.length} foods · {Math.round(template.total_cal ?? 0)} kcal
            {template.use_count > 0 && ` · logged ${template.use_count}×`}
          </p>
        </div>
        <button
          onClick={() => onLog(template)}
          className="flex-shrink-0 bg-[#C8F75E]/15 border border-[#C8F75E]/30 text-[#C8F75E] text-[12px] font-bold rounded-xl px-3 py-2 active:scale-[0.95] transition-transform"
        >
          Log
        </button>
        <button
          onClick={() => setExpanded(e => !e)}
          className={`text-[16px] ${T.t3} w-6 text-center`}
        >
          {expanded ? '▲' : '▾'}
        </button>
      </div>

      {/* Expanded items */}
      {expanded && (
        <div className={`border-t ${T.border} px-4 py-2`}>
          {template.items.map((item, i) => (
            <div key={i} className="flex justify-between py-1.5 border-b border-white/[0.04] last:border-0">
              <span className={`text-[12px] ${T.t2}`}>{item.food_name}</span>
              <span className={`text-[11px] ${T.t3}`}>
                {item.qty !== 1 ? `${item.qty}× ` : ''}{item.portion} · {Math.round(item.cal)} kcal
              </span>
            </div>
          ))}
          <button
            onClick={() => onDelete(template.id)}
            className={`w-full text-[11px] ${T.t3} py-2 mt-1 hover:text-[${T.red}] transition-colors`}
          >
            Remove meal
          </button>
        </div>
      )}
    </div>
  );
}

// ── PATTERN SUGGESTION CARD ───────────────────────────────────────────────────

function PatternSuggestionCard({
  pattern,
  onSave,
  onDismiss,
}: {
  pattern:   DetectedMealPattern;
  onSave:    (pattern: DetectedMealPattern, name: string) => void;
  onDismiss: (key: string) => void;
}) {
  const [naming, setNaming] = useState(false);
  const [name,   setName]   = useState(
    pattern.food_names.length <= 3
      ? pattern.food_names.join(' + ')
      : `${pattern.food_names[0]} + ${pattern.food_names.length - 1} more`
  );

  if (naming) {
    return (
      <div className={`${T.s1} border border-[${T.lime}]/20 rounded-2xl px-4 py-4 mb-3`}>
        <p className={`text-[12px] font-bold ${T.t1} mb-3`}>Name this meal</p>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          maxLength={40}
          autoFocus
          className={`w-full bg-[#2C2C2E] rounded-xl px-3 py-2.5 text-[13px] ${T.t1} outline-none border ${T.border} mb-3`}
          placeholder="e.g. My usual lunch"
        />
        <div className="flex gap-2">
          <button
            onClick={() => onSave(pattern, name.trim() || pattern.food_names.join(' + '))}
            className={`flex-1 bg-[${T.lime}] text-[#111113] font-bold text-[13px] rounded-xl py-2.5`}
          >
            Save meal
          </button>
          <button
            onClick={() => setNaming(false)}
            className={`px-4 text-[13px] ${T.t3}`}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`${T.s1} border border-[${T.lime}]/20 rounded-2xl px-4 py-3 mb-3`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-bold ${T.t1}`}>
            You eat this together often
          </p>
          <p className={`text-[10px] ${T.t3} mt-0.5`}>
            {pattern.day_count} times · ~{pattern.avg_cal} kcal · {pattern.meal}
          </p>
        </div>
        <button onClick={() => onDismiss(pattern.key)} className={`text-[16px] ${T.t3} flex-shrink-0`}>×</button>
      </div>
      <p className={`text-[12px] ${T.t2} mb-3`}>
        {pattern.food_names.join(' · ')}
      </p>
      <button
        onClick={() => setNaming(true)}
        className={`w-full bg-[${T.lime}]/10 border border-[${T.lime}]/25 text-[${T.lime}] text-[12px] font-semibold rounded-xl py-2.5`}
      >
        💾 Save as a usual meal
      </button>
    </div>
  );
}

// ── ENERGY INSIGHT ROW ────────────────────────────────────────────────────────

function EnergyInsightRow({
  label,
  crashRate,
  obsCount,
  variant,
}: {
  label:     string;
  crashRate: number;
  obsCount:  number;
  variant:   'good' | 'heavy';
}) {
  const color  = variant === 'good' ? T.green : T.red;
  const pct    = variant === 'good' ? Math.round((1 - crashRate) * 100) : Math.round(crashRate * 100);
  const phrase = variant === 'good' ? 'steady energy' : 'energy dip';

  return (
    <div className="py-2.5 border-b border-white/[0.05] last:border-0">
      <div className="flex justify-between items-center mb-1">
        <span className={`text-[12px] font-medium ${T.t1} flex-1 truncate`}>{label}</span>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <span className={`text-[10px] ${T.t3}`}>{obsCount} obs</span>
          <span className="text-[11px] font-bold" style={{ color }}>{pct}% {phrase}</span>
        </div>
      </div>
      <div className="h-1 bg-[#2C2C2E] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className={`text-[9px] ${T.t3} mt-1`}>Your logs suggest this pattern — not medical advice</p>
    </div>
  );
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

export default function InsightsTab() {
  const { user } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [templates,         setTemplates]         = useState<MealTemplate[]>([]);
  const [patterns,          setPatterns]          = useState<DetectedMealPattern[]>([]);
  const [usuals,            setUsuals]            = useState<FoodAnalytic[]>([]);
  const [energyInsights,    setEnergyInsights]    = useState<{
    good: Array<{ food_name: string; crash_rate: number; obs: number }>;
    heavy: Array<{ food_name: string; crash_rate: number; obs: number }>;
  }>({ good: [], heavy: [] });
  const [mealBreakdowns,    setMealBreakdowns]    = useState<Record<Meal, FoodAnalytic[]>>({
    breakfast: [], lunch: [], snack: [], dinner: [],
  });
  const [dismissedPatterns, setDismissedPatterns] = useState<Set<string>>(new Set());
  const [personalInsights,  setPersonalInsights]  = useState<PersonalInsight[]>([]);
  const [logging,           setLogging]           = useState(false);
  const [loggedMeal,        setLoggedMeal]        = useState<string | null>(null);

  // ── Load everything on mount ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    async function load() {
      // 1. Templates
      const tmpl = await localDb.meal_templates
        .where('user_id').equals(user!.id)
        .sortBy('use_count');
      setTemplates(tmpl.reverse());

      // 2. Existing template keys for pattern dedup
      const existingKeys = new Set(tmpl.map(buildTemplateKey));

      // 3. Dismissed pattern keys
      const dismissedPref = await localDb.user_prefs.get('dismissed_patterns');
      const dismissed = new Set<string>(
        Array.isArray(dismissedPref?.value) ? dismissedPref.value as string[] : []
      );
      setDismissedPatterns(dismissed);

      // 4. Pattern detection (from local daily_logs — no network)
      const detected = await detectMealPatterns(
        new Set([...existingKeys, ...dismissed])
      );
      setPatterns(detected);

      // 5. My Usuals (individual foods)
      const hiddenPref = await localDb.user_prefs.get('hidden_usuals');
      const hiddenMap  = (hiddenPref?.value ?? {}) as Record<string, number>;
      const allAnalytics = await localDb.food_analytics.toArray();
      const hiddenIds = new Set(
        Object.entries(hiddenMap)
          .filter(([fid, hiddenAt]) => {
            const current = allAnalytics.find(a => a.food_id === fid)?.use_count ?? 0;
            return current < hiddenAt + USUAL_THRESHOLD;
          })
          .map(([fid]) => fid)
      );
      const hour = new Date().getHours();
      const meal = hour < 10 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
      const usualsResult = await getUsualFoods(meal, hiddenIds, 12);
      setUsuals(usualsResult);

      // 6. Energy-aware insights — uses shared correlateEnergyToFoods() from
      // energyCorrelation.ts, which matches the server algorithm in analyze-energy.ts exactly.
      // Previously this used a divergent inline algorithm (MIN_OBS=3, sustain threshold=0.30).
      // Corrected: MIN_OBS=5, sustain threshold=0.40, crash threshold=0.60.
      const since60 = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
      const energyLogs60 = await localDb.energy_logs
        .where('log_date').aboveOrEqual(since60).toArray();
      const dailyLogs60 = await localDb.daily_logs
        .where('log_date').aboveOrEqual(since60).toArray();

      const energyResult = correlateEnergyToFoods(dailyLogs60, energyLogs60);
      if (energyResult.hasEnoughData) {
        setEnergyInsights({
          good:  energyResult.sustainers.map(c => ({ food_name: c.food_name, crash_rate: c.crash_rate, obs: c.total })),
          heavy: energyResult.crashTriggers.map(c => ({ food_name: c.food_name, crash_rate: c.crash_rate, obs: c.total })),
        });
      }

      // 7a. Personal insights — derived from FoodProfile (meal context, companions, energy)
      const profiles = await buildFoodProfiles();
      const insights = generateInsights(profiles, 6);
      setPersonalInsights(insights);

      // 7b. Meal-time breakdowns: top 5 foods per meal slot from food_analytics
      //    filtered by last_meal field (set since Phase 2C.1)
      const all = await localDb.food_analytics.toArray();
      const breakdowns: Record<Meal, FoodAnalytic[]> = {
        breakfast: [], lunch: [], snack: [], dinner: [],
      };
      for (const f of all) {
        if (f.use_count < 2) continue;
        const m = f.last_meal as Meal | undefined;
        if (m && MEALS.includes(m)) {
          breakdowns[m].push(f);
        }
      }
      for (const m of MEALS) {
        breakdowns[m] = breakdowns[m]
          .sort((a, b) => b.use_count - a.use_count)
          .slice(0, 5);
      }
      setMealBreakdowns(breakdowns);
    }

    load();
  }, [user]);

  // ── Save pattern as template ───────────────────────────────────────────────
  const handleSavePattern = useCallback(async (pattern: DetectedMealPattern, name: string) => {
    if (!user) return;
    const template = patternToTemplate(pattern, user.id, name);
    await localDb.meal_templates.add(template);
    try {
      const sm = getSyncManager();
      await sm.enqueue('upsert_template', template);
    } catch {}

    setTemplates(prev => [template, ...prev]);
    setPatterns(prev => prev.filter(p => p.key !== pattern.key));
  }, [user]);

  // ── Dismiss pattern suggestion ─────────────────────────────────────────────
  const handleDismissPattern = useCallback(async (key: string) => {
    const next = new Set([...dismissedPatterns, key]);
    setDismissedPatterns(next);
    setPatterns(prev => prev.filter(p => p.key !== key));
    await localDb.user_prefs.put({ key: 'dismissed_patterns', value: [...next] });
  }, [dismissedPatterns]);

  // ── Delete template ────────────────────────────────────────────────────────
  const handleDeleteTemplate = useCallback(async (id: string) => {
    await localDb.meal_templates.delete(id);
    try {
      const sm = getSyncManager();
      await sm.enqueue('delete_template', { id });
    } catch {}
    setTemplates(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Log whole meal (one tap) ───────────────────────────────────────────────
  const handleLogMeal = useCallback(async (template: MealTemplate) => {
    if (!user || logging) return;
    setLogging(true);

    try {
      const today = todayIST();
      const hour  = new Date().getHours();
      const meal  =
        hour < 10 ? 'breakfast' :
        hour < 15 ? 'lunch' :
        hour < 18 ? 'snack' : 'dinner';

      const sm = getSyncManager();

      for (const item of template.items) {
        const entry: LogEntry = {
          id:         crypto.randomUUID(),
          user_id:    user.id,
          log_date:   today,
          meal:       meal as LogEntry['meal'],
          food_name:  item.food_name,
          portion:    item.portion,
          qty:        item.qty,
          is_home:    item.is_home,
          multiplier: 1.0,   // multiplier already baked into saved cal
          cal:        item.cal,
          protein:    item.protein,
          carbs:      item.carbs,
          fat:        item.fat,
          gl:         item.gl,
          created_at: new Date().toISOString(),
        };
        await localDb.daily_logs.add(entry);
        await sm.enqueue('insert_log', entry);
      }

      // Increment template use_count
      const updated = { ...template, use_count: template.use_count + 1 };
      await localDb.meal_templates.put(updated);
      await sm.enqueue('upsert_template', updated);
      setTemplates(prev => prev.map(t => t.id === template.id ? updated : t));

      setLoggedMeal(template.name);
      setTimeout(() => setLoggedMeal(null), 2000);
    } catch {}

    setLogging(false);
  }, [user, logging]);

  // ── Compute section visibility ─────────────────────────────────────────────
  const hasTemplates     = templates.length > 0;
  const hasPatterns      = patterns.length > 0;
  const hasUsuals        = usuals.length > 0;
  const hasEnergyGood    = energyInsights.good.length > 0;
  const hasEnergyHeavy   = energyInsights.heavy.length > 0;
  const hasMealBreakdown = MEALS.some(m => mealBreakdowns[m].length > 0);

  const isEmpty = !hasTemplates && !hasPatterns && !hasUsuals && !hasEnergyGood && !hasEnergyHeavy && !personalInsights.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-[#111113] pb-24">
      {/* Header */}
      <div className="px-4 pt-8 pb-2">
        <h1 className="font-['Playfair_Display'] text-[26px] font-black text-[#F5F5F5] leading-tight">
          Your Food<br />Playbook
        </h1>
        <p className={`text-[11px] ${T.t3} mt-1`}>
          The more you log, the more personalised this gets.
        </p>
      </div>

      {/* Logged confirmation toast */}
      {loggedMeal && (
        <div className="mx-4 mt-2 bg-[#6BCB77]/15 border border-[#6BCB77]/30 rounded-xl px-4 py-2.5 flex items-center gap-2">
          <span className="text-[16px]">✅</span>
          <p className={`text-[12px] font-semibold`} style={{ color: T.green }}>
            {loggedMeal} logged
          </p>
        </div>
      )}

      <div className="px-4 mt-4 space-y-6">

        {/* ── My Usual Meals ─────────────────────────────────────────────── */}
        {hasTemplates && (
          <section>
            <SectionHeader
              title="My Usual Meals"
              sub="One tap to log the whole thing"
            />
            {templates.map(t => (
              <MealTemplateCard
                key={t.id}
                template={t}
                onLog={handleLogMeal}
                onDelete={handleDeleteTemplate}
              />
            ))}
          </section>
        )}

        {/* ── Pattern suggestions ────────────────────────────────────────── */}
        {hasPatterns && (
          <section>
            <SectionHeader
              title="Save a usual meal?"
              sub="We noticed you eat these together"
            />
            {patterns.map(p => (
              <PatternSuggestionCard
                key={p.key}
                pattern={p}
                onSave={handleSavePattern}
                onDismiss={handleDismissPattern}
              />
            ))}
          </section>
        )}

        {/* ── My Usuals (individual foods) ──────────────────────────────── */}
        {hasUsuals && (
          <section>
            <SectionHeader
              title="My Usuals"
              sub={`Foods you log most often`}
            />
            <div className="flex flex-wrap gap-2">
              {usuals.map(f => (
                <div
                  key={f.food_id}
                  className={`${T.s1} border ${T.border} rounded-xl px-3 py-2 flex items-center gap-2`}
                >
                  <span className="text-[14px]">
                    {/* simple emoji map */}
                    {f.food_name.toLowerCase().includes('dal') ? '🫘' :
                     f.food_name.toLowerCase().includes('roti') ? '🫓' :
                     f.food_name.toLowerCase().includes('rice') ? '🍚' :
                     f.food_name.toLowerCase().includes('egg') ? '🥚' : '🍽️'}
                  </span>
                  <div>
                    <p className={`text-[12px] font-medium ${T.t1}`}>{f.food_name}</p>
                    <p className={`text-[9px] ${T.t3}`}>
                      {f.use_count}× logged
                      {f.usual_cal ? ` · ~${Math.round(f.usual_cal)} kcal` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Energy-aware insights ──────────────────────────────────────── */}
        {(hasEnergyGood || hasEnergyHeavy) && (
          <section>
            <SectionHeader
              title="Energy patterns"
              sub="Your logs suggest these — not medical advice"
            />
            {hasEnergyGood && (
              <div className={`${T.s1} border border-[#6BCB77]/20 rounded-2xl p-4 mb-3`}>
                <p className={`text-[12px] font-bold text-[#6BCB77] mb-2`}>⚡ Good for your energy</p>
                {energyInsights.good.map(f => (
                  <EnergyInsightRow
                    key={f.food_name}
                    label={f.food_name}
                    crashRate={f.crash_rate}
                    obsCount={f.obs}
                    variant="good"
                  />
                ))}
              </div>
            )}
            {hasEnergyHeavy && (
              <div className={`${T.s1} border border-[#FF6B6B]/20 rounded-2xl p-4 mb-3`}>
                <p className={`text-[12px] font-bold text-[#FF6B6B] mb-2`}>🥱 Heavy for you</p>
                {energyInsights.heavy.map(f => (
                  <EnergyInsightRow
                    key={f.food_name}
                    label={f.food_name}
                    crashRate={f.crash_rate}
                    obsCount={f.obs}
                    variant="heavy"
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Meal-time breakdowns ────────────────────────────────────────── */}
        {hasMealBreakdown && (
          <section>
            <SectionHeader title="Your eating patterns" />
            {MEALS.filter(m => mealBreakdowns[m].length > 0).map(meal => (
              <div key={meal} className={`${T.s1} border ${T.border} rounded-2xl p-4 mb-3`}>
                <p className={`text-[12px] font-bold ${T.t1} mb-2`}>
                  {MEAL_EMOJI[meal]} {meal.charAt(0).toUpperCase() + meal.slice(1)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {mealBreakdowns[meal].map(f => (
                    <span
                      key={f.food_id}
                      className={`text-[11px] ${T.t2} bg-[#2C2C2E] rounded-lg px-2.5 py-1`}
                    >
                      {f.food_name}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* ── What you've learned ─────────────────────────────────────────── */}
        {personalInsights.length > 0 && (
          <section>
            <SectionHeader
              title="What you've learned"
              sub="From your own food history"
            />
            <div className={`${T.s1} border ${T.border} rounded-2xl overflow-hidden`}>
              {personalInsights.map((insight, i) => (
                <div
                  key={i}
                  className={`px-4 py-3 ${i < personalInsights.length - 1 ? `border-b ${T.border}` : ''}`}
                >
                  <p className={`text-[13px] ${T.t1} leading-snug`}>{insight.text}</p>
                  <p className={`text-[10px] ${T.t3} mt-0.5`}>{insight.evidence}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {isEmpty && (
          <div className="text-center pt-8">
            <div className="text-[48px] mb-3">📓</div>
            <p className={`text-[15px] font-semibold ${T.t1} mb-2`}>
              Your Playbook is building
            </p>
            <p className={`text-[13px] ${T.t3} leading-relaxed max-w-[280px] mx-auto`}>
              Log meals a few times and this page fills with your patterns,
              usual meals, and energy insights.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
