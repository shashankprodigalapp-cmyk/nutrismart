/**
 * DashboardLogging.tsx — NutriSmart Core Logging Interface
 * Module 6, Step 6.1
 *
 * LAYOUT HIERARCHY:
 *   CalorieRing (macro summary + inline water tap)
 *   └── MacroPills (Protein, GL, Fat, Carbs)
 *   └── WaterQuickAdd (inline +/- buttons, no page nav)
 *   RecentsFrequents grid (populated before search input)
 *   SearchBar → results
 *   AddFoodSheet (servings ↔ grams toggle, kitchen multiplier preview)
 *   TodayLog (grouped by meal, swipe-to-delete)
 *
 * All writes go through SyncManager (Dexie first, then Supabase queue).
 * Gram conversion formula: (inputGrams / food.weight_g) * food.calories
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import Fuse from 'fuse.js';
import {
  localDb,
  type Food,
  type LogEntry,
  type FoodAnalytic,
  type MealTemplate,
  recordFoodUsage,
  getFrequentFoods,
  getTodayFoods,
  getUsualFoods,
  USUAL_THRESHOLD,
} from '../lib/localDb';
import {
  applyMultiplier,
  CALORIE_HARD_CAP,
} from '../lib/kitchenIntelligence';
import type { KitchenProfile } from '../lib/localDb';
import { getSyncManager } from '../lib/SyncManager';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { VerdictDashboard } from './VerdictDashboard';
import { useProGate } from '../utils/proGatekeeper';
import { todayIST } from '../lib/kitchenIntelligence';

// ── DESIGN TOKENS ─────────────────────────────────────────────────────────────
// Matches the CRED-style dark palette from the original app
const T = {
  bg:      'bg-[#111113]',
  s1:      'bg-[#1C1C1E]',
  s2:      'bg-[#242426]',
  s3:      'bg-[#2C2C2E]',
  border:  'border-white/[0.07]',
  border2: 'border-white/[0.12]',
  t1:      'text-[#F5F5F5]',
  t2:      'text-[#A1A1A1]',
  t3:      'text-[#636366]',
  accent:  '#C8F75E',
  cal:     'text-[#E8D5B0]',
  pro:     'text-[#8DB4FF]',
  gl:      'text-[#C4A8FF]',
  fat:     'text-[#FFB347]',
  carb:    'text-[#FF8FAB]',
  water:   'text-[#7DD3FC]',
  ok:      'text-[#6BCB77]',
  warn:    'text-[#FFD93D]',
  danger:  'text-[#FF6B6B]',
} as const;

// ── TYPES ─────────────────────────────────────────────────────────────────────

type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner';
type MetricMode = 'serving' | 'grams';

interface DailyTargets {
  cal:     number;
  protein: number;
  gl:      number;
  fat:     number;
  water:   number;
}

interface LogTotals {
  cal:     number;
  protein: number;
  gl:      number;
  fat:     number;
  carbs:   number;
}

interface SheetFood {
  food:        Food;
  qty:         number;
  grams:       number;
  isHome:      boolean;
  meal:        Meal;
  metricMode:  MetricMode;
}

// Photo food logging — returned by ai-vision.ts
interface PhotoDish {
  name:               string;
  estimated_portion:  string;
  confidence:         'high' | 'medium' | 'low';
  ask_clarification?: string;
  nutrition: {
    name:        string;
    portion:     string;
    weight_g:    number;
    calories:    number;
    protein:     number;
    carbs:       number;
    fat:         number;
    gl:          number;
    gi?:         number;
    confidence?: string;
  } | null;
}

// ── CONSTANTS ─────────────────────────────────────────────────────────────────

const MEAL_LABELS: Record<Meal, string> = {
  breakfast: '☀️ Breakfast',
  lunch:     '🌤 Lunch',
  snack:     '🍎 Snack',
  dinner:    '🌙 Dinner',
};

const DEFAULT_TARGETS: DailyTargets = {
  cal: 1400, protein: 150, gl: 50, fat: 65, water: 8,
};

function mealForHour(h: number): Meal {
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 18) return 'snack';
  return 'dinner';
}

// ── CALORIE RING ──────────────────────────────────────────────────────────────

function CalorieRing({
  consumed, target,
}: { consumed: number; target: number }) {
  const pct    = Math.min(consumed / Math.max(target, 1), 1);
  const over   = consumed > target;
  const R      = 75;
  const C      = 2 * Math.PI * R;
  const dash   = C * (1 - pct);
  const stroke = over ? '#FF6B6B' : '#C8F75E';

  return (
    <div className="relative w-[170px] h-[170px] mx-auto">
      <svg width="170" height="170" viewBox="0 0 170 170"
        style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="85" cy="85" r={R} fill="none" stroke="#2C2C2E" strokeWidth="9" />
        <circle cx="85" cy="85" r={R} fill="none"
          stroke={stroke} strokeWidth="9" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={dash}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-['Playfair_Display'] text-4xl font-black text-[#F5F5F5] leading-none">
          {Math.round(consumed)}
        </span>
        <span className="text-[9px] text-[#636366] uppercase tracking-[0.5px] mt-1">calories</span>
        <span className={`text-[11px] font-semibold mt-1 ${over ? 'text-[#FF6B6B]' : 'text-[#C8F75E]'}`}>
          {over ? `${Math.round(consumed - target)} over` : `${Math.round(target - consumed)} left`}
        </span>
      </div>
    </div>
  );
}

// ── MACRO PILLS ───────────────────────────────────────────────────────────────

function MacroPill({
  label, value, target, unit, color,
}: { label: string; value: number; target: number; unit: string; color: string }) {
  const pct = Math.min(value / Math.max(target, 1), 1);
  const rem = Math.max(0, target - value);
  return (
    <div className="flex-shrink-0 bg-[#1C1C1E] border border-white/[0.07] rounded-2xl p-3 min-w-[82px]">
      <div className={`text-[18px] font-bold leading-none`} style={{ color }}>
        {value % 1 === 0 ? value : value.toFixed(1)}
      </div>
      <div className="text-[9px] text-[#636366] uppercase tracking-[0.4px] mt-1">{label}</div>
      <div className="text-[9px] mt-1 font-medium" style={{ color: rem > 0 ? '#636366' : '#6BCB77' }}>
        {rem > 0 ? `${rem.toFixed(rem < 10 ? 1 : 0)}${unit} left` : 'done ✓'}
      </div>
      <div className="h-[2px] bg-[#2C2C2E] rounded-full mt-2 overflow-hidden">
        <div className="h-full rounded-full" style={{ background: color, width: `${pct * 100}%`, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ── WATER QUICK-ADD ───────────────────────────────────────────────────────────

function WaterQuickAdd({
  glasses, target, onAdd, onRemove,
}: { glasses: number; target: number; onAdd: () => void; onRemove: () => void }) {
  const pct = Math.min(glasses / target, 1);
  return (
    <div className="mx-4 mt-3 bg-[#1C1C1E] border border-[#7DD3FC]/20 rounded-xl px-4 py-3 flex items-center justify-between">
      <div>
        <span className="text-[11px] font-bold text-[#7DD3FC]">💧 Water</span>
        <div className="flex gap-[3px] mt-1">
          {Array.from({ length: target }).map((_, i) => (
            <span key={i} className={`text-[10px] ${i < glasses ? 'opacity-100' : 'opacity-20'}`}>💧</span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onPointerDown={(e) => { e.preventDefault(); onRemove(); }}
          className="w-8 h-8 rounded-full bg-[#2C2C2E] text-[#7DD3FC] font-bold text-lg flex items-center justify-center active:scale-90 transition-transform"
          aria-label="Remove glass"
        >−</button>
        <span className="text-[14px] font-bold text-[#7DD3FC] w-10 text-center">
          {glasses}/{target}
        </span>
        <button
          onPointerDown={(e) => { e.preventDefault(); onAdd(); }}
          className="w-8 h-8 rounded-full bg-[#7DD3FC]/20 text-[#7DD3FC] font-bold text-lg flex items-center justify-center active:scale-90 transition-transform"
          aria-label="Add glass"
        >+</button>
      </div>
    </div>
  );
}

// ── MY USUALS GRID ────────────────────────────────────────────────────────────
// Shows Usuals (use_count ≥ USUAL_THRESHOLD) with contextual ranking,
// then Recents (today's foods). Separate sections with separate labels.

// ── USUAL FOOD CARD — with reliable cross-platform hold-to-hide gesture ────────
// Uses pointerdown + pointerup/cancel with a 500ms timer instead of
// onContextMenu (which is unreliable on iOS Safari and some Android browsers).
// A short tap (< 500ms) triggers onSelect (log the food).
// A hold (≥ 500ms) triggers the hide confirmation sheet.
// The active:scale visual is gated on the holdRef so it only fires on short taps.

function UsualFoodCard({
  item, onSelect, onHide,
}: { item: FoodAnalytic; onSelect: () => void; onHide: () => void }) {
  const holdTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const didHold   = React.useRef(false);

  function startHold(e: React.PointerEvent) {
    e.preventDefault();
    didHold.current = false;
    holdTimer.current = setTimeout(() => {
      didHold.current = true;
      onHide();
    }, 500);
  }

  function cancelHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }

  function handlePointerUp(e: React.PointerEvent) {
    e.preventDefault();
    cancelHold();
    if (!didHold.current) onSelect();
  }

  return (
    <button
      onPointerDown={startHold}
      onPointerUp={handlePointerUp}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onContextMenu={(e) => e.preventDefault()}  // suppress browser context menu
      className="flex-shrink-0 bg-[#1C1C1E] border border-[#C8F75E]/20 rounded-xl px-3 py-2.5 flex flex-col items-center gap-1 min-w-[76px] select-none"
    >
      <span className="text-[20px]">{getFoodEmoji(item.food_name)}</span>
      <span className="text-[10px] font-semibold text-[#F5F5F5] text-center leading-tight max-w-[68px] truncate">
        {item.food_name.length > 12 ? item.food_name.slice(0, 11) + '…' : item.food_name}
      </span>
      {item.usual_cal != null && (
        <span className="text-[8px] text-[#A1A1A1]">{Math.round(item.usual_cal)} kcal</span>
      )}
    </button>
  );
}

// ── MY USUALS GRID ─────────────────────────────────────────────────────────────
// Usuals = foods with use_count ≥ USUAL_THRESHOLD, not hidden by user.
// Hiding is temporary — a food reappears when its use_count exceeds
// USUAL_REHIDE_THRESHOLD, because the user has demonstrably continued eating it.

function MyUsualsGrid({
  usuals, recents, onSelect, onHide,
}: {
  usuals:   FoodAnalytic[];
  recents:  FoodAnalytic[];
  onSelect: (food: FoodAnalytic) => void;
  onHide:   (foodId: string) => void;
}) {
  const [hiding, setHiding] = React.useState<string | null>(null);
  const hasUsuals = usuals.length > 0;
  if (!hasUsuals && !recents.length) return null;

  return (
    <div className="px-4 mt-4 space-y-3">
      {/* My Usuals */}
      {hasUsuals && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px]">My Usuals</span>
            <span className="text-[9px] text-[#2C2C2E]">hold to hide</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {usuals.map((item) => (
              <UsualFoodCard
                key={item.food_id}
                item={item}
                onSelect={() => onSelect(item)}
                onHide={() => setHiding(item.food_id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Recents */}
      {recents.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">Recents</div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {recents.filter(r => !usuals.find(u => u.food_id === r.food_id)).map((item) => (
              <button
                key={item.food_id}
                onPointerDown={(e) => { e.preventDefault(); onSelect(item); }}
                className="flex-shrink-0 bg-[#1C1C1E] border border-white/[0.12] rounded-xl px-3 py-2 flex flex-col items-center gap-1 min-w-[72px] active:bg-[#2C2C2E] transition-colors"
              >
                <span className="text-[20px]">{getFoodEmoji(item.food_name)}</span>
                <span className="text-[10px] font-semibold text-[#F5F5F5] text-center leading-tight max-w-[64px] truncate">
                  {item.food_name.length > 12 ? item.food_name.slice(0, 11) + '…' : item.food_name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hide confirmation sheet */}
      {hiding && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setHiding(null)}>
          <div className="w-full bg-[#1C1C1E] rounded-t-3xl px-5 pt-3 pb-10" onClick={e => e.stopPropagation()}>
            <div className="w-9 h-1 bg-[#3C3C3E] rounded-full mx-auto mb-4" />
            <p className="text-[14px] font-semibold text-[#F5F5F5] mb-1">Hide from My Usuals?</p>
            <p className="text-[12px] text-[#636366] mb-5">
              Your history stays. If you keep logging it, it'll reappear automatically.
            </p>
            <button
              onClick={() => { onHide(hiding); setHiding(null); }}
              className="w-full bg-[#2C2C2E] border border-white/[0.12] text-[#A1A1A1] font-semibold text-[14px] rounded-xl py-3 mb-2"
            >Hide for now</button>
            <button onClick={() => setHiding(null)} className="w-full text-[13px] text-[#636366] font-medium py-2">Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ADD FOOD SHEET ────────────────────────────────────────────────────────────

function AddFoodSheet({
  food,
  profile,
  initialMeal,
  onConfirm,
  onClose,
}: {
  food:         Food;
  profile:      KitchenProfile | null;
  initialMeal:  Meal;
  onConfirm:    (entry: Omit<LogEntry, 'id' | 'user_id' | 'synced_at' | 'created_at'>) => void;
  onClose:      () => void;
}) {
  const [qty,        setQty]        = useState(1);
  const [grams,      setGrams]      = useState(food.weight_g ?? 100);
  const [isHome,     setIsHome]     = useState(true);
  const [meal,       setMeal]       = useState<Meal>(initialMeal);
  const [metric,     setMetric]     = useState<MetricMode>('serving');
  const [anomaly,    setAnomaly]    = useState(false);

  // Compute preview macros
  const preview = useMemo(() => {
    if (!profile) return null;

    if (metric === 'grams') {
      // Custom gram conversion: (inputGrams / baseGrams) * baseMacro
      const baseG = food.weight_g ?? 100;
      const ratio = grams / baseG;
      const rawCal = food.calories * ratio;
      const mult   = isHome ? profile.home_mult : profile.rest_mult;
      const cal    = Math.round(rawCal * mult);
      return {
        cal:     Math.min(cal, CALORIE_HARD_CAP),
        protein: parseFloat((food.protein * ratio).toFixed(1)),
        carbs:   parseFloat((food.carbs * ratio).toFixed(1)),
        fat:     parseFloat((food.fat * ratio * mult).toFixed(1)),
        gl:      parseFloat((food.gl * ratio).toFixed(1)),
        multiplier: mult,
        anomaly: cal > CALORIE_HARD_CAP,
      };
    }

    const result = applyMultiplier(food, qty, isHome, profile);
    return {
      cal:        result.cal,
      protein:    result.protein,
      carbs:      result.carbs,
      fat:        result.fat,
      gl:         result.gl,
      multiplier: result.multiplier,
      anomaly:    result.anomaly,
    };
  }, [food, qty, grams, isHome, metric, profile]);

  useEffect(() => {
    setAnomaly(preview?.anomaly ?? false);
  }, [preview]);

  const handleConfirm = () => {
    if (!preview || !profile) return;

    const entry: Omit<LogEntry, 'id' | 'user_id' | 'synced_at' | 'created_at'> = {
      log_date:   todayIST(),
      meal,
      food_id:    food.id,
      food_name:  food.name,
      portion:    metric === 'grams' ? `${grams}g` : food.portion,
      qty:        metric === 'serving' ? qty : 1,
      is_home:    isHome,
      multiplier: preview.multiplier,
      cal:        preview.cal,
      protein:    preview.protein,
      carbs:      preview.carbs,
      fat:        preview.fat,
      gl:         preview.gl,
      anomaly:    preview.anomaly,
    };
    onConfirm(entry);
  };

  const meals: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-[#1C1C1E] rounded-t-3xl px-5 pt-3 pb-10 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-9 h-1 bg-[#2C2C2E] rounded-full mx-auto mb-4" />

        {/* Food name */}
        <h2 className="font-['Playfair_Display'] text-xl font-black text-[#F5F5F5] mb-1">
          {food.name}
        </h2>
        <p className="text-[11px] text-[#636366] mb-4">{food.portion}</p>

        {/* Metric mode toggle */}
        <div className="flex bg-[#242426] rounded-xl p-1 mb-4">
          {(['serving', 'grams'] as MetricMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all ${
                metric === m
                  ? 'bg-[#C8F75E] text-[#111113]'
                  : 'text-[#636366]'
              }`}
            >
              {m === 'serving' ? '🥄 Servings' : '⚖️ Grams'}
            </button>
          ))}
        </div>

        {/* Quantity / Gram input */}
        {metric === 'serving' ? (
          <div className="flex items-center justify-between bg-[#242426] rounded-xl px-4 py-3 mb-4">
            <button
              onClick={() => setQty(q => Math.max(0.25, q - 0.25))}
              className="w-10 h-10 rounded-full bg-[#2C2C2E] text-[#F5F5F5] text-xl font-bold flex items-center justify-center active:scale-90"
            >−</button>
            <div className="text-center">
              <span className="text-[24px] font-black text-[#F5F5F5]">{qty}</span>
              <p className="text-[10px] text-[#636366]">serving{qty !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={() => setQty(q => Math.min(10, q + 0.25))}
              className="w-10 h-10 rounded-full bg-[#C8F75E]/20 text-[#C8F75E] text-xl font-bold flex items-center justify-center active:scale-90"
            >+</button>
          </div>
        ) : (
          <div className="bg-[#242426] rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
            <span className="text-[#636366] text-sm">Weight:</span>
            <input
              type="number"
              value={grams}
              onChange={(e) => setGrams(Math.max(1, Number(e.target.value)))}
              className="flex-1 bg-transparent text-[#F5F5F5] text-xl font-bold outline-none text-right"
              min={1} max={2000}
            />
            <span className="text-[#636366] font-semibold">g</span>
          </div>
        )}

        {/* Home / Restaurant toggle */}
        <div className="flex bg-[#242426] rounded-xl p-1 mb-4">
          <button
            onClick={() => setIsHome(true)}
            className={`flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all ${
              isHome ? 'bg-[#C8F75E]/15 text-[#C8F75E] border border-[#C8F75E]/30' : 'text-[#636366]'
            }`}
          >🏠 Home</button>
          <button
            onClick={() => setIsHome(false)}
            className={`flex-1 py-2 rounded-lg text-[12px] font-semibold transition-all ${
              !isHome ? 'bg-sky-500/10 text-sky-400 border border-sky-400/30' : 'text-[#636366]'
            }`}
          >🏪 Restaurant</button>
        </div>

        {/* Meal selector */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {meals.map((m) => (
            <button
              key={m}
              onClick={() => setMeal(m)}
              className={`flex-shrink-0 px-3 py-2 rounded-xl text-[11px] font-semibold capitalize transition-all ${
                meal === m
                  ? 'bg-[#C8F75E] text-[#111113]'
                  : 'bg-[#242426] text-[#636366] border border-white/[0.07]'
              }`}
            >
              {MEAL_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Macro preview */}
        {preview && (
          <div className="bg-[#242426] rounded-xl p-3 mb-4">
            {anomaly && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-2 mb-3 text-[11px] text-yellow-400">
                ⚠️ This portion seems very large — please verify the quantity.
                Capped at 4,999 kcal.
              </div>
            )}
            {profile && (
              <div className="text-[10px] text-[#636366] mb-2">
                Kitchen: <span className="text-[#C8F75E] font-semibold">{preview.multiplier.toFixed(2)}×</span>
                {' '}({isHome ? 'home' : 'restaurant'})
              </div>
            )}
            <div className="grid grid-cols-5 gap-2">
              {[
                { label: 'kcal',   value: preview.cal,              color: '#E8D5B0' },
                { label: 'prot',   value: preview.protein + 'g',    color: '#8DB4FF' },
                { label: 'fat',    value: preview.fat + 'g',        color: '#FFB347' },
                { label: 'carbs',  value: preview.carbs + 'g',      color: '#FF8FAB' },
                { label: 'GL',     value: preview.gl,               color: '#C4A8FF' },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-[#2C2C2E] rounded-lg py-2 text-center">
                  <div className="text-[14px] font-bold" style={{ color }}>{value}</div>
                  <div className="text-[8px] text-[#636366] uppercase mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Confirm */}
        <button
          onClick={handleConfirm}
          disabled={!preview}
          className="w-full bg-[#C8F75E] text-[#111113] font-bold text-[15px] rounded-xl py-4 disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          + Add to {MEAL_LABELS[meal]}
        </button>

        <button
          onClick={onClose}
          className="w-full mt-2 py-3 text-[13px] text-[#636366] font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── TODAY'S LOG ───────────────────────────────────────────────────────────────

function TodayLog({
  entries, onDelete,
}: { entries: LogEntry[]; onDelete: (id: string) => void }) {
  const grouped = useMemo(() => {
    const map = new Map<Meal, LogEntry[]>();
    const order: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner'];
    for (const m of order) map.set(m, []);
    for (const e of entries) {
      map.get(e.meal)?.push(e);
    }
    return map;
  }, [entries]);

  if (!entries.length) {
    return (
      <div className="mx-4 mt-6 text-center">
        <div className="text-[32px] mb-2">🍽️</div>
        <p className="text-[13px] text-[#636366]">nothing logged yet</p>
        <p className="text-[11px] text-[#2C2C2E] mt-1">search above or tap a recent food</p>
      </div>
    );
  }

  return (
    <div className="px-4 mt-4 pb-6">
      <div className="flex justify-between items-center mb-3">
        <span className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px]">Today</span>
        <span className="text-[10px] text-[#636366]">{entries.length} items</span>
      </div>
      {(['breakfast', 'lunch', 'snack', 'dinner'] as Meal[]).map((meal) => {
        const items = grouped.get(meal) ?? [];
        if (!items.length) return null;
        const mealCal = items.reduce((s, e) => s + e.cal, 0);
        return (
          <div key={meal} className="mb-4">
            <div className="flex justify-between items-center py-1 mb-2">
              <span className="text-[9px] font-bold text-[#636366] uppercase tracking-[1.2px]">
                {MEAL_LABELS[meal]}
              </span>
              <span className="text-[9px] text-[#636366]">{Math.round(mealCal)} kcal</span>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl px-3 py-2.5 flex items-center gap-3"
                >
                  <span className="text-[18px] w-7 text-center flex-shrink-0">
                    {getFoodEmoji(entry.food_name)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-[#F5F5F5] truncate">
                      {entry.food_name}
                      {entry.qty !== 1 && (
                        <span className="text-[#636366] ml-1">×{entry.qty}</span>
                      )}
                    </div>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] text-[#8DB4FF]">P {entry.protein.toFixed(0)}g</span>
                      <span className="text-[10px] text-[#FFB347]">F {entry.fat.toFixed(0)}g</span>
                      <span className="text-[10px] text-[#C4A8FF]">GL {entry.gl.toFixed(0)}</span>
                      <span className="text-[9px] text-[#636366]">
                        {entry.is_home ? '🏠' : '🏪'}
                        {entry.multiplier !== 1 && ` ${entry.multiplier.toFixed(2)}×`}
                      </span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[14px] font-bold text-[#F5F5F5]">{Math.round(entry.cal)}</div>
                    <button
                      onClick={() => onDelete(entry.id)}
                      className="text-[10px] text-[#636366] mt-0.5 hover:text-[#FF6B6B] transition-colors"
                      aria-label={`Delete ${entry.food_name}`}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── EMOJI HELPER ──────────────────────────────────────────────────────────────

function getFoodEmoji(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('egg'))          return '🥚';
  if (n.includes('dal') || n.includes('daal')) return '🫘';
  if (n.includes('rice') || n.includes('chawal')) return '🍚';
  if (n.includes('roti') || n.includes('chapati')) return '🫓';
  if (n.includes('chicken'))      return '🍗';
  if (n.includes('paneer'))       return '🧀';
  if (n.includes('sabzi') || n.includes('shaak')) return '🥗';
  if (n.includes('milk') || n.includes('dahi') || n.includes('curd')) return '🥛';
  if (n.includes('fruit') || n.includes('apple') || n.includes('banana')) return '🍎';
  if (n.includes('samosa') || n.includes('vada') || n.includes('bhajiya')) return '🥟';
  if (n.includes('chai') || n.includes('tea') || n.includes('coffee')) return '☕';
  if (n.includes('water'))        return '💧';
  return '🍽️';
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────

interface DashboardLoggingProps {
  /** Called when a food is confirmed — parent handles sync */
  onLogConfirmed?: (entry: LogEntry) => void;
}

export function DashboardLogging({ onLogConfirmed }: DashboardLoggingProps) {
  const { user }           = useAuth();
  const { allowed: aiOk, showUpgrade } = useProGate('ai_food_search');

  const [entries,       setEntries]       = useState<LogEntry[]>([]);
  const [query,         setQuery]         = useState('');
  const [results,       setResults]       = useState<Food[]>([]);
  const [frequents,     setFrequents]     = useState<FoodAnalytic[]>([]);
  const [usuals,        setUsuals]        = useState<FoodAnalytic[]>([]);
  const [removedUsuals, setRemovedUsuals] = useState<Set<string>>(new Set());
  const [masterFoods,   setMasterFoods]   = useState<Food[]>([]);
  const [sheetFood,     setSheetFood]     = useState<Food | null>(null);
  const [glasses,       setGlasses]       = useState(0);
  const [targets,       setTargets]       = useState<DailyTargets>(DEFAULT_TARGETS);
  const [profile,       setProfile]       = useState<KitchenProfile | null>(null);
  const [mealTemplates, setMealTemplates] = useState<MealTemplate[]>([]);
  // Photo logging state
  const [photoLoading,  setPhotoLoading]  = useState(false);
  const [photoResults,  setPhotoResults]  = useState<PhotoDish[] | null>(null);
  const [photoError,    setPhotoError]    = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const today   = todayIST();
  const fuseRef = useRef<Fuse<Food> | null>(null);

  // ── Load data on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    (async () => {
      // Load today's log
      const logs = await localDb.daily_logs
        .where('log_date').equals(today).toArray();
      setEntries(logs);

      // Load water
      const water = await localDb.water_logs.get([user.id, today]);
      setGlasses(water?.glasses ?? 0);

      // Load kitchen profile
      const pref = await localDb.user_prefs.get('kitchen_profile');
      if (pref?.value) setProfile(pref.value as KitchenProfile);

      // ── Fetch user's actual nutrition targets from Supabase ────────────────
      const fetchTargets = () => {
        supabase
          .from('users')
          .select('target_cal, target_protein, target_gl, target_fat, target_water')
          .eq('id', user.id)
          .maybeSingle()
          .then(({ data: userTargets }) => {
            if (userTargets) {
              setTargets({
                cal:     userTargets.target_cal     ?? DEFAULT_TARGETS.cal,
                protein: userTargets.target_protein ?? DEFAULT_TARGETS.protein,
                gl:      userTargets.target_gl      ?? DEFAULT_TARGETS.gl,
                fat:     userTargets.target_fat     ?? DEFAULT_TARGETS.fat,
                water:   userTargets.target_water   ?? DEFAULT_TARGETS.water,
              });
            }
          });
      };
      fetchTargets();

      // ── Load foods for Fuse.js search ─────────────────────────────────────
      // Priority (search order):
      //   1. Local custom_foods (user's AI-found / personal foods) — instant, offline
      //   2. master_foods from Supabase (the global Indian food DB)
      // Both are merged into a single Fuse index, custom foods weighted higher
      // so personal history appears above generic DB results for the same name.
      //
      // food.type is preserved on every food object so AddFoodSheet can set the
      // correct isHome default — critical for Kitchen Intelligence calibration.

      const customFoodsLocal = await localDb.custom_foods.toArray();

      // Fetch master foods from Supabase (cached in Dexie after first load)
      let masterFoodsDB: Food[] = [];
      try {
        const { data: dbFoods } = await supabase
          .from('master_foods')
          .select('id, name, name_hi, name_gu, category, region, portion, weight_g, calories, protein, carbs, fat, fiber, gl, gi, type, source, verified')
          .eq('verified', true)
          .order('name');

        if (dbFoods && dbFoods.length > 0) {
          // Map DB rows to the Food interface used by AddFoodSheet
          masterFoodsDB = dbFoods.map(row => ({
            id:       row.id,
            name:     row.name,
            name_hi:  row.name_hi  ?? undefined,
            name_gu:  row.name_gu  ?? undefined,
            // note: 'category' is not in the Food interface — used only in Fuse keys
            // via name_hi/name_gu fields which are already mapped above
            portion:  row.portion,
            weight_g: row.weight_g ?? undefined,
            calories: Number(row.calories),
            protein:  Number(row.protein),
            carbs:    Number(row.carbs),
            fat:      Number(row.fat),
            fiber:    Number(row.fiber ?? 0),
            gl:       Number(row.gl),
            gi:       row.gi ?? undefined,
            type:     (row.type as Food['type']) ?? 'MR',
            source:   row.source ?? 'IFCT',
            verified: row.verified ?? true,
          } as Food));
        }
      } catch {
        // Network error — continue with custom foods only (offline-safe)
      }

      // Merge: custom foods first (user-specific), then master foods.
      // Deduplicate by id to avoid showing both a local and remote copy of the
      // same food if it was AI-searched and is also in master_foods.
      const seenIds = new Set<string>(customFoodsLocal.map(f => f.id));
      const deduped = masterFoodsDB.filter(f => !seenIds.has(f.id));
      const allFoods: Food[] = [...customFoodsLocal, ...deduped];

      setMasterFoods(allFoods);
      fuseRef.current = new Fuse(allFoods, {
        keys: [
          { name: 'name',    weight: 3 },   // primary match
          { name: 'name_hi', weight: 1.5 }, // Hindi alias
          { name: 'name_gu', weight: 1.5 }, // Gujarati alias
          // 'category' is not in the Food interface — omitted
        ],
        threshold:    0.4,
        includeScore: true,
      });

      // Load frequents & today
      const [freq, todayItems] = await Promise.all([
        getFrequentFoods(10),
        getTodayFoods(today),
      ]);
      // Merge: today first (no duplicates)
      const seen = new Set<string>();
      const merged: FoodAnalytic[] = [];
      for (const item of [...todayItems, ...freq]) {
        if (!seen.has(item.food_id)) {
          seen.add(item.food_id);
          merged.push(item);
        }
      }
      setFrequents(merged.slice(0, 12));

      // Load removed Usuals (user-dismissed items)
      const removedPref = await localDb.user_prefs.get('removed_usuals');
      const removed = new Set<string>(
        Array.isArray(removedPref?.value) ? removedPref.value as string[] : []
      );
      setRemovedUsuals(removed);

      // Load My Usual Meals (meal templates)
      if (user) {
        const tmpl = await localDb.meal_templates
          .where('user_id').equals(user.id)
          .sortBy('use_count');
        setMealTemplates(tmpl.reverse().slice(0, 5));
      }

      // Load My Usuals — contextual ranking by current hour
      const currentHour = new Date().getHours();
      const currentMeal =
        currentHour < 10 ? 'breakfast' :
        currentHour < 15 ? 'lunch' :
        currentHour < 18 ? 'snack' : 'dinner';
      const usualsResult = await getUsualFoods(currentMeal, removed, 8);
      setUsuals(usualsResult);
    })();
  }, [user, today]);

  // ── Re-fetch targets when ProfileTab saves updated goals ──────────────────
  useEffect(() => {
    if (!user) return;
    const refetch = () => {
      supabase
        .from('users')
        .select('target_cal, target_protein, target_gl, target_fat, target_water')
        .eq('id', user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) setTargets({
            cal:     data.target_cal     ?? DEFAULT_TARGETS.cal,
            protein: data.target_protein ?? DEFAULT_TARGETS.protein,
            gl:      data.target_gl      ?? DEFAULT_TARGETS.gl,
            fat:     data.target_fat     ?? DEFAULT_TARGETS.fat,
            water:   data.target_water   ?? DEFAULT_TARGETS.water,
          });
        });
    };
    window.addEventListener('nutrismart:targets-updated', refetch);
    return () => window.removeEventListener('nutrismart:targets-updated', refetch);
  }, [user]);

  // ── Search ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const raw = fuseRef.current?.search(query) ?? [];
    setResults(raw.map(r => r.item).slice(0, 12));
  }, [query]);

  // ── Totals ───────────────────────────────────────────────────────────────
  const totals = useMemo<LogTotals>(() => entries.reduce(
    (acc, e) => ({
      cal:     acc.cal     + e.cal,
      protein: acc.protein + e.protein,
      gl:      acc.gl      + e.gl,
      fat:     acc.fat     + e.fat,
      carbs:   acc.carbs   + e.carbs,
    }),
    { cal: 0, protein: 0, gl: 0, fat: 0, carbs: 0 }
  ), [entries]);

  // ── Add food ─────────────────────────────────────────────────────────────
  const handleConfirmEntry = useCallback(async (
    entryData: Omit<LogEntry, 'id' | 'user_id' | 'synced_at' | 'created_at'>
  ) => {
    if (!user) return;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const entry: LogEntry = {
      ...entryData,
      id,
      user_id:    user.id,
      created_at: now,
    };

    await localDb.daily_logs.add(entry);
    if (sheetFood) await recordFoodUsage(sheetFood, entryData.meal, entryData.cal);

    // Enqueue sync
    try {
      const sm = getSyncManager();
      await sm.enqueue('insert_log', entry);
    } catch { /* SyncManager may not be init yet — offline ok */ }

    setEntries(prev => [...prev, entry]);
    setSheetFood(null);
    setQuery('');
    setResults([]);

    // Refresh My Usuals after logging (use_count may have crossed USUAL_THRESHOLD)
    const currentHour = new Date().getHours();
    const currentMeal =
      currentHour < 10 ? 'breakfast' :
      currentHour < 15 ? 'lunch' :
      currentHour < 18 ? 'snack' : 'dinner';
    getUsualFoods(currentMeal, removedUsuals, 8).then(setUsuals);

    onLogConfirmed?.(entry);
  }, [user, sheetFood, onLogConfirmed]);

  // ── Delete food ───────────────────────────────────────────────────────────
  const handleDelete = useCallback(async (id: string) => {
    await localDb.daily_logs.delete(id);
    try {
      const sm = getSyncManager();
      await sm.enqueue('delete_log', { id });
    } catch {}
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  // ── Water ─────────────────────────────────────────────────────────────────
  const handleWaterAdd = useCallback(async () => {
    try {
      const sm = getSyncManager();
      const next = await sm.quickAddWaterLocal(1);
      setGlasses(next);
    } catch {
      // SyncManager not init — direct Dexie update
      if (!user) return;
      const next = Math.min(20, glasses + 1);
      await localDb.water_logs.put({ user_id: user.id, log_date: today, glasses: next });
      setGlasses(next);
    }
  }, [glasses, user, today]);

  const handleWaterRemove = useCallback(async () => {
    try {
      const sm = getSyncManager();
      const next = await sm.quickAddWaterLocal(-1);
      setGlasses(next);
    } catch {
      if (!user) return;
      const next = Math.max(0, glasses - 1);
      await localDb.water_logs.put({ user_id: user.id, log_date: today, glasses: next });
      setGlasses(next);
    }
  }, [glasses, user, today]);


  // ── SMART QUICK-LOG (TASK 1) ──────────────────────────────────────────────
  // Before spending an AI search (network + quota), check the local Dexie
  // food_analytics cache. If the queried food has been logged >5 times, the
  // user obviously knows it — populate the log sheet from local data with
  // zero network calls and zero AI quota consumed.
  const trySmartQuickLog = useCallback(async (searchQuery: string): Promise<boolean> => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return false;

    // Match against high-frequency analytics entries (use_count > 5)
    const candidates = await localDb.food_analytics
      .filter(a => a.use_count > 5 && a.food_name.toLowerCase().includes(q))
      .toArray();

    if (!candidates.length) return false;

    // Best candidate = highest use_count
    candidates.sort((a, b) => b.use_count - a.use_count);

    // Try local custom_foods first, then fall back to in-memory master foods
    let food: Food | undefined = await localDb.custom_foods.get(candidates[0].food_id);
    if (!food) {
      food = masterFoods.find(f => f.id === candidates[0].food_id)
          ?? masterFoods.find(f => f.name.toLowerCase() === candidates[0].food_name.toLowerCase());
    }
    if (!food) return false;

    setSheetFood(food);      // open add-sheet pre-populated — no AI call made
    setQuery('');
    setResults([]);
    return true;
  }, []);

  const handleAISearch = useCallback(async () => {
    if (!aiOk) { showUpgrade(); return; }
    // Smart Quick-Log bypass — local cache first, AI only on miss
    const served = await trySmartQuickLog(query);
    if (served) return;
    // Trigger AI text search via the search button — the actual network call
    // is handled by ai-search.ts Netlify function. For now, open the camera
    // photo flow if the query is empty, otherwise the user meant text AI search.
    // The ns:ai-search event is still dispatched for any listeners (e.g. a
    // dedicated AI search modal that may be added in Phase 2).
    window.dispatchEvent(new CustomEvent('ns:ai-search', { detail: { query } }));
  }, [aiOk, query, showUpgrade, trySmartQuickLog]);

  // ── PHOTO FOOD LOGGING ────────────────────────────────────────────────────
  // Connects existing ai-vision.ts and get-upload-url.ts Netlify functions
  // to the food log flow. Flow:
  //   1. User taps camera → file input opens
  //   2. Photo selected → POST get-upload-url → PUT to Supabase Storage
  //   3. POST ai-vision with path → returns [{name, portion, nutrition}]
  //   4. Review card shown → user confirms each dish
  //   5. Each confirmed dish → handleConfirmEntry() → existing Dexie + SyncManager

  const handlePhotoSelect = useCallback(async (file: File) => {
    if (!aiOk) { showUpgrade(); return; }
    if (!user) return;

    setPhotoLoading(true);
    setPhotoError(null);
    setPhotoResults(null);

    try {
      // Step 1: Get a signed upload URL from the server
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error('Not authenticated');

      const urlRes = await fetch('/.netlify/functions/get-upload-url', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          ext:     file.name.split('.').pop()?.toLowerCase() ?? 'jpg',
          purpose: 'meal-photo',
        }),
      });

      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({}));
        throw new Error(err.message ?? 'Upload URL failed');
      }

      const { upload_url, path } = await urlRes.json();

      // Step 2: PUT the file directly to Supabase Storage (no Netlify size limits)
      const uploadRes = await fetch(upload_url, {
        method:  'PUT',
        headers: { 'Content-Type': file.type },
        body:    file,
      });

      if (!uploadRes.ok) throw new Error('Image upload failed — please try again');

      // Step 3: Call ai-vision with only the storage path (not the image bytes)
      const visionRes = await fetch('/.netlify/functions/ai-vision', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ image_path: path, mime_type: file.type }),
      });

      const visionData = await visionRes.json();

      if (!visionData.found) {
        setPhotoError(visionData.message ?? 'No food detected. Try better lighting or describe what you ate.');
        return;
      }

      // Step 4: Show review card with identified dishes
      setPhotoResults(visionData.results as PhotoDish[]);

    } catch (err: any) {
      setPhotoError(err.message ?? 'Photo analysis failed. Please try again.');
    } finally {
      setPhotoLoading(false);
      // Reset file input so the same photo can be re-selected
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }, [aiOk, user, showUpgrade]);

  // Confirm a photo-identified dish — converts to a Food and opens AddFoodSheet
  const handlePhotoDishConfirm = useCallback((dish: PhotoDish) => {
    if (!dish.nutrition) return;
    const n = dish.nutrition;
    const food: Food = {
      id:       crypto.randomUUID(),  // ephemeral ID for this session
      name:     n.name,
      portion:  n.portion,
      weight_g: n.weight_g,
      calories: n.calories,
      protein:  n.protein,
      carbs:    n.carbs,
      fat:      n.fat,
      gl:       n.gl,
      gi:       n.gi,
      type:     'MR',            // photo foods assumed home-cooked (MR)
      source:   'ai_photo',
      // dish.confidence available for analytics but not stored in Food interface
    };
    setPhotoResults(null);         // close review card
    setSheetFood(food);            // open standard AddFoodSheet for confirmation
  }, []);

  // ── Hide from My Usuals ────────────────────────────────────────────────────
  // Stores {food_id → hidden_at_count} in user_prefs['hidden_usuals'].
  // ── Log a whole meal template (one tap) ─────────────────────────────────
  const handleLogTemplate = useCallback(async (template: MealTemplate) => {
    if (!user) return;
    const today = todayIST();
    const hour  = new Date().getHours();
    const meal: LogEntry['meal'] =
      hour < 10 ? 'breakfast' :
      hour < 15 ? 'lunch' :
      hour < 18 ? 'snack' : 'dinner';

    for (const item of template.items) {
      const entry: LogEntry = {
        id:         crypto.randomUUID(),
        user_id:    user.id,
        log_date:   today,
        meal,
        food_name:  item.food_name,
        portion:    item.portion,
        qty:        item.qty,
        is_home:    item.is_home,
        multiplier: 1.0,
        cal:        item.cal,
        protein:    item.protein,
        carbs:      item.carbs,
        fat:        item.fat,
        gl:         item.gl,
        created_at: new Date().toISOString(),
      };
      await localDb.daily_logs.add(entry);
      try { await getSyncManager().enqueue('insert_log', entry); } catch {}
      setEntries(prev => [...prev, entry]);
    }
    const updated = { ...template, use_count: template.use_count + 1 };
    await localDb.meal_templates.put(updated);
    try { await getSyncManager().enqueue('upsert_template', updated); } catch {}
    setMealTemplates(prev => prev.map(t => t.id === template.id ? updated : t));
    if (template.items.length > 0) {
      onLogConfirmed?.({ ...template.items[0], meal, log_date: today } as LogEntry);
    }
  }, [user, onLogConfirmed]);

  // ── Hide from My Usuals ─────────────────────────────────────────────────
  // A food hidden at use_count=N reappears when use_count reaches N + USUAL_THRESHOLD.
  // This means a food the user hides but keeps eating will surface again automatically —
  // demonstrating continued intent without requiring any manual action.
  // Food history is never touched.
  const handleHideUsual = useCallback(async (foodId: string) => {
    const analytic = await localDb.food_analytics.get(foodId);
    const hiddenAtCount = analytic?.use_count ?? USUAL_THRESHOLD;

    const hiddenPref = await localDb.user_prefs.get('hidden_usuals');
    const existing   = (hiddenPref?.value ?? {}) as Record<string, number>;
    const next       = { ...existing, [foodId]: hiddenAtCount };
    await localDb.user_prefs.put({ key: 'hidden_usuals', value: next });

    // Recompute hidden set: a food is still hidden only if its current
    // use_count < hidden_at_count + USUAL_THRESHOLD
    const allAnalytics = await localDb.food_analytics.toArray();
    const newHiddenIds = new Set<string>(
      Object.entries(next)
        .filter(([fid, hiddenAt]) => {
          const current = allAnalytics.find(a => a.food_id === fid)?.use_count ?? 0;
          return current < hiddenAt + USUAL_THRESHOLD;  // still hidden
        })
        .map(([fid]) => fid)
    );
    setRemovedUsuals(newHiddenIds);
    setUsuals(prev => prev.filter(u => u.food_id !== foodId));
  }, []);
  // The food_id in food_analytics may point to a custom food OR a master food.
  // Check local custom_foods first (instant), then fall back to the in-memory
  // masterFoods list (already fetched from Supabase on mount).
  const handleFrequentTap = useCallback(async (item: FoodAnalytic) => {
    // Try local custom_foods first (fast path)
    const localFood = await localDb.custom_foods.get(item.food_id);
    if (localFood) { setSheetFood(localFood); return; }

    // Fall back to the master foods already in memory
    const masterFood = masterFoods.find(f => f.id === item.food_id);
    if (masterFood) { setSheetFood(masterFood); return; }

    // Last resort: search by name in case food_id no longer matches
    // (edge case: food was re-seeded with different UUID)
    const byName = masterFoods.find(
      f => f.name.toLowerCase() === item.food_name.toLowerCase()
    );
    if (byName) setSheetFood(byName);
  }, [masterFoods]);

  // ── Render ────────────────────────────────────────────────────────────────
  const hour = new Date().getHours();

  return (
    <div className="min-h-dvh bg-[#111113] pb-24">
      {/* Morning Verdict — retention flywheel (R4) */}
      <div className="pt-3">
        <VerdictDashboard />
      </div>
      {/* ── Two-column layout on md+ screens ── */}
      <div className="md:grid md:grid-cols-2 md:gap-6 md:items-start md:px-6 md:pt-2">

        {/* ══ LEFT COLUMN — stats + today's log ══ */}
        <div>
          {/* Header */}
          <div className="px-4 pt-5 pb-0 flex justify-between items-start md:px-0">
            <div>
              <p className="text-[11px] text-[#636366]">
                {hour < 12 ? 'good morning' : hour < 17 ? 'good afternoon' : 'good evening'} 👋
              </p>
              <h1 className="font-['Playfair_Display'] text-[26px] font-black text-[#F5F5F5] leading-tight mt-0.5">
                what did<br />you eat?
              </h1>
            </div>
          </div>

          {/* Calorie ring */}
          <div className="mt-4 flex justify-center">
            <CalorieRing consumed={Math.round(totals.cal)} target={targets.cal} />
          </div>

          {/* Macro pills */}
          <div className="flex gap-2 px-4 mt-4 overflow-x-auto pb-1 scrollbar-hide md:px-0">
            <MacroPill label="Protein"  value={parseFloat(totals.protein.toFixed(0))} target={targets.protein} unit="g" color="#8DB4FF" />
            <MacroPill label="GL"       value={parseFloat(totals.gl.toFixed(0))}      target={targets.gl}      unit=""  color="#C4A8FF" />
            <MacroPill label="Fat"      value={parseFloat(totals.fat.toFixed(0))}     target={targets.fat}     unit="g" color="#FFB347" />
            <MacroPill label="Carbs"    value={parseFloat(totals.carbs.toFixed(0))}   target={100}             unit="g" color="#FF8FAB" />
          </div>

          {/* Water quick-add */}
          <WaterQuickAdd
            glasses={glasses}
            target={targets.water}
            onAdd={handleWaterAdd}
            onRemove={handleWaterRemove}
          />

          {/* Today's log — left column on desktop */}
          <TodayLog entries={entries} onDelete={handleDelete} />
        </div>

        {/* ══ RIGHT COLUMN — search + usuals + results ══ */}
        <div className="md:pt-5">
          {/* My Usual Meals + My Usuals + Recents — shown BEFORE search query */}
          {!query && (
            <>
              {/* My Usual Meals — one-tap full meal logging */}
              {mealTemplates.length > 0 && (
                <div className="px-4 mt-4 md:px-0 md:mt-0">
                  <div className="text-[10px] font-bold text-[#636366] uppercase tracking-[1px] mb-2">
                    My Usual Meals
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                    {mealTemplates.map(t => (
                      <button
                        key={t.id}
                        onPointerDown={(e) => { e.preventDefault(); handleLogTemplate(t); }}
                        className="flex-shrink-0 bg-[#1C1C1E] border border-[#C8F75E]/25 rounded-xl px-3 py-2.5 flex flex-col items-start gap-0.5 min-w-[120px] max-w-[160px] active:bg-[#242426] transition-colors"
                      >
                        <span className="text-[11px] font-bold text-[#C8F75E] truncate w-full">
                          {t.name}
                        </span>
                        <span className="text-[9px] text-[#636366]">
                          {t.items.length} foods · {Math.round(t.total_cal ?? 0)} kcal
                        </span>
                        <span className="text-[9px] text-[#2C2C2E] mt-0.5">Tap to log all</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <MyUsualsGrid
                usuals={usuals}
                recents={frequents}
                onSelect={handleFrequentTap}
                onHide={handleHideUsual}
              />
            </>
          )}

          {/* Search bar */}
          <div className="px-4 mt-4 md:px-0">
        <div className="flex items-center gap-2 bg-[#1C1C1E] border border-white/[0.12] rounded-xl px-4 py-3">
          <span className="text-[#636366] text-[13px]">🔍</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search food…"
            className="flex-1 bg-transparent text-[#F5F5F5] text-[14px] outline-none placeholder-[#636366]"
            autoComplete="off"
          />
          {/* Camera button — triggers photo food recognition (Pro) */}
          <button
            onClick={() => {
              if (!aiOk) { showUpgrade(); return; }
              photoInputRef.current?.click();
            }}
            disabled={photoLoading}
            className="text-[20px] opacity-60 hover:opacity-100 active:scale-90 transition-all disabled:opacity-30"
            aria-label="Photograph your meal"
            title={aiOk ? 'Photograph your meal' : 'Photo recognition — Pro feature'}
          >
            {photoLoading ? '⏳' : '📷'}
          </button>
          {query && (
            <button onClick={() => setQuery('')} className="text-[#636366] text-[16px]">×</button>
          )}
        </div>

        {/* Hidden file input for photo selection */}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handlePhotoSelect(file);
          }}
        />

        {/* AI search button */}
        <button
          onClick={handleAISearch}
          className="w-full mt-2 bg-[#C8F75E]/10 border border-[#C8F75E]/25 rounded-xl py-2.5 text-[12px] font-semibold text-[#C8F75E] flex items-center justify-center gap-2"
        >
          🤖 Not found? Search with AI
          {!aiOk && <span className="text-[10px] text-[#636366]">(Pro)</span>}
        </button>
      </div>

      {/* Photo loading indicator */}
      {photoLoading && (
        <div className="mx-4 mt-3 bg-[#1C1C1E] border border-[#C8F75E]/20 rounded-xl px-4 py-4 text-center">
          <div className="text-[24px] mb-1">🔍</div>
          <p className="text-[13px] font-semibold text-[#C8F75E]">Analysing your meal…</p>
          <p className="text-[11px] text-[#636366] mt-1">Gemini Vision is identifying dishes</p>
        </div>
      )}

      {/* Photo error */}
      {photoError && !photoLoading && (
        <div className="mx-4 mt-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start gap-3">
          <span className="text-[18px]">⚠️</span>
          <div className="flex-1">
            <p className="text-[12px] text-[#FF6B6B] font-medium">{photoError}</p>
          </div>
          <button
            onClick={() => setPhotoError(null)}
            className="text-[#636366] text-[14px] flex-shrink-0"
          >×</button>
        </div>
      )}

      {/* Photo results review card */}
      {photoResults && !photoLoading && (
        <div className="mx-4 mt-3 bg-[#1C1C1E] border border-[#C8F75E]/20 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.07] flex items-center justify-between">
            <div>
              <p className="text-[13px] font-bold text-[#F5F5F5]">📷 Dishes Found</p>
              <p className="text-[10px] text-[#636366] mt-0.5">
                Tap to add — review before confirming
              </p>
            </div>
            <button
              onClick={() => setPhotoResults(null)}
              className="text-[#636366] text-[16px] p-1"
            >×</button>
          </div>
          <div className="divide-y divide-white/[0.05]">
            {photoResults.map((dish, i) => (
              <button
                key={i}
                onClick={() => dish.nutrition && handlePhotoDishConfirm(dish)}
                disabled={!dish.nutrition}
                className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-[#242426] disabled:opacity-40 transition-colors"
              >
                <span className="text-[22px]">{getFoodEmoji(dish.name)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#F5F5F5] truncate">{dish.name}</p>
                  <p className="text-[10px] text-[#636366] mt-0.5">{dish.estimated_portion}</p>
                  {dish.ask_clarification && (
                    <p className="text-[10px] text-[#FFD93D] mt-0.5">
                      ❓ {dish.ask_clarification}
                    </p>
                  )}
                </div>
                {dish.nutrition ? (
                  <div className="text-right flex-shrink-0">
                    <p className="text-[14px] font-bold text-[#E8D5B0]">
                      {Math.round(dish.nutrition.calories)}
                    </p>
                    <p className="text-[9px] text-[#636366]">kcal</p>
                    <p className="text-[8px] mt-1 px-1.5 py-0.5 rounded-full bg-[#2C2C2E] text-[#636366]">
                      {dish.confidence}
                    </p>
                  </div>
                ) : (
                  <span className="text-[10px] text-[#636366]">no data</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="px-4 mt-3 flex flex-col gap-2">
          {results.map((food) => (
            <button
              key={food.id}
              onClick={() => setSheetFood(food)}
              className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl px-3 py-3 flex items-center gap-3 text-left active:bg-[#242426]"
            >
              <span className="text-[20px] flex-shrink-0">{getFoodEmoji(food.name)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[#F5F5F5] truncate">{food.name}</div>
                <div className="text-[10px] text-[#636366] mt-0.5">{food.portion}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[13px] font-bold text-[#E8D5B0]">{food.calories}</div>
                <div className="text-[9px] text-[#636366]">kcal</div>
              </div>
            </button>
          ))}
        </div>
      )}

          {/* Search results */}
          {results.length > 0 && (
            <div className="px-4 mt-3 flex flex-col gap-2 md:px-0">
              {results.map((food) => (
                <button
                  key={food.id}
                  onClick={() => setSheetFood(food)}
                  className="bg-[#1C1C1E] border border-white/[0.07] rounded-xl px-3 py-3 flex items-center gap-3 text-left active:bg-[#242426]"
                >
                  <span className="text-[20px] flex-shrink-0">{getFoodEmoji(food.name)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#F5F5F5] truncate">{food.name}</div>
                    <div className="text-[10px] text-[#636366] mt-0.5">{food.portion}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-[13px] font-bold text-[#E8D5B0]">{food.calories}</div>
                    <div className="text-[9px] text-[#636366]">kcal</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* ── end two-column grid ── */}
      </div>

      {/* Add food sheet */}
      {sheetFood && (
        <AddFoodSheet
          food={sheetFood}
          profile={profile}
          initialMeal={mealForHour(hour)}
          onConfirm={handleConfirmEntry}
          onClose={() => setSheetFood(null)}
        />
      )}
    </div>
  );
}

export default DashboardLogging;
