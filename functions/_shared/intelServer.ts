/**
 * Server side of the 2.1 intelligence layer: loads a person's data, runs the pure modules, saves the results.
 * All numbers come from the pure modules in src/lib/intel (tested). This file only moves data in and out.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeFeatures, indexFeatures, loggingStreak, type FeatureIndex } from '../../src/lib/intel/features';
import { recommend } from '../../src/lib/intel/recommend';
import { suggestSmartMeal, type SmartMeal } from '../../src/lib/intel/smartMeal';
import { observe, type Observation } from '../../src/lib/intel/energyIntel';
import { addDays, istDay, weekStart } from '../../src/lib/intel/dates';
import { runForecasts, forecastHash, FORECAST_FLAGS, FORECAST_KEYS, type Forecast, type ForecastKey } from '../../src/lib/intel/forecast';
import type { DayRow, MealRow, Meal, Targets, Feature, Recommendation } from '../../src/lib/intel/types';

export interface Scope { food: boolean; energy: boolean }
export interface Snapshot {
  today: string; targets: Targets; rows: DayRow[]; meals: MealRow[]; flexDays: string[]; flexReservedCal: number;
  features: Feature[]; index: FeatureIndex; streak: number; todayTotals: { calories: number; protein: number; meals: Meal[] };
  digestion: Array<{ day: string; digestion: 'comfortable' | 'heavy' | 'upset' | null }>;
  recent: Array<{ rec_key: string; status: string; day: string }>;
}
const num = (v: unknown) => Number(v ?? 0) || 0;

export async function loadSnapshot(admin: SupabaseClient, userId: string, now: Date, scope: Scope = { food: true, energy: true }): Promise<Snapshot> {
  const today = istDay(now), from180 = addDays(today, -180), from120 = addDays(today, -120);
  const [u, m, c, l, fx, rc] = await Promise.all([
    admin.from('users').select('target_cal, target_protein').eq('id', userId).maybeSingle(),
    scope.food ? admin.from('daily_nutrition_metrics').select('day, calories, protein_g, meals, items').eq('user_id', userId).gte('day', from180).limit(400) : Promise.resolve({ data: [] as any[] }),
    scope.energy ? admin.from('daily_checkins').select('log_date, energy, mood, hunger, sleep, fullness, digestion').eq('user_id', userId).gte('log_date', from180).limit(400) : Promise.resolve({ data: [] as any[] }),
    scope.food ? admin.from('daily_logs').select('log_date, meal, food_name, cal, protein, is_home').eq('user_id', userId).gte('log_date', from120).order('log_date', { ascending: false }).limit(8000) : Promise.resolve({ data: [] as any[] }),
    scope.food ? admin.from('flexible_meals').select('planned_for, reserved_kcal, status').eq('user_id', userId).gte('planned_for', from180).in('status', ['planned', 'consumed']).limit(400) : Promise.resolve({ data: [] as any[] }),
    admin.from('recommendations').select('rec_key, status, window_day').eq('user_id', userId).gte('window_day', addDays(today, -30)).limit(200),
  ]);
  const targets: Targets = { cal: num(u.data?.target_cal) || 1400, protein: num(u.data?.target_protein) || 150 };
  const ck = new Map<string, any>((c.data ?? []).map((r: any) => [String(r.log_date), r]));
  const rows: DayRow[] = (m.data ?? []).map((r: any) => {
    const k = ck.get(String(r.day));
    return { day: String(r.day), calories: num(r.calories), protein_g: num(r.protein_g), meals: num(r.meals), items: num(r.items), energy: k?.energy ?? null, hunger: k?.hunger ?? null, mood: k?.mood ?? null, fullness: k?.fullness ?? null, sleep: k?.sleep ?? null };
  });
  for (const [day, k] of ck) if (!rows.some(r => r.day === day)) rows.push({ day, calories: 0, protein_g: 0, meals: 0, items: 0, energy: k.energy, hunger: k.hunger, mood: k.mood, fullness: k.fullness, sleep: k.sleep });
  const meals: MealRow[] = (l.data ?? []).map((r: any) => ({ day: String(r.log_date), meal: r.meal as Meal, food_name: String(r.food_name), cal: num(r.cal), protein: num(r.protein), is_home: r.is_home }));
  const flexDays = (fx.data ?? []).map((r: any) => String(r.planned_for));
  const flexReservedCal = (fx.data ?? []).filter((r: any) => String(r.planned_for) === today && r.status === 'planned').reduce((a: number, r: any) => a + num(r.reserved_kcal), 0);
  const features = computeFeatures({ rows, meals, flexDays, targets, today, now });
  const trow = rows.find(r => r.day === today);
  const todayMeals = meals.filter(x => x.day === today);
  return {
    today, targets, rows, meals, flexDays, flexReservedCal, features, index: indexFeatures(features), streak: loggingStreak(rows, today),
    todayTotals: { calories: trow?.calories ?? 0, protein: trow?.protein_g ?? 0, meals: [...new Set(todayMeals.map(x => x.meal))] },
    digestion: [...ck.entries()].map(([day, k]) => ({ day, digestion: k.digestion ?? null })),
    recent: (rc.data ?? []).map((r: any) => ({ rec_key: String(r.rec_key), status: String(r.status), day: String(r.window_day) })),
  };
}

export interface Brief { recommendations: Recommendation[]; smartMeal: SmartMeal | null; observations: Observation[] }
export function think(s: Snapshot, now: Date, opts: { adaptive: boolean; energy: boolean }): Brief {
  const hour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
  const recommendations = recommend({ features: s.index, rows: s.rows, meals: s.meals, targets: s.targets, today: s.today, hour, today_totals: s.todayTotals, flexReservedCal: s.flexReservedCal, recent: s.recent });
  const smartMeal = opts.adaptive ? suggestSmartMeal({ targets: s.targets, eaten: s.todayTotals, flexReservedCal: s.flexReservedCal, history: s.meals.filter(m => m.day >= addDays(s.today, -29)) }, hour) : null;
  const observations = opts.energy ? observe({ rows: s.rows.filter(r => r.day >= addDays(s.today, -29)), meals: s.meals, targets: s.targets, digestion: s.digestion }) : [];
  return { recommendations, smartMeal, observations };
}

/** Save features and new recommendations. Returns the saved recommendation rows. */
export async function persist(admin: SupabaseClient, userId: string, s: Snapshot, brief: Brief, saveRecs: boolean) {
  const rows = s.features.map(f => ({ user_id: userId, feature_key: f.key, window_days: f.window_days, value: f.value, baseline: f.baseline, delta: f.delta, trend: f.trend, sample_size: f.sample_size, confidence: f.confidence, calculated_at: f.calculated_at }));
  for (let i = 0; i < rows.length; i += 200) await admin.from('personal_features').upsert(rows.slice(i, i + 200), { onConflict: 'user_id,feature_key,window_days' });
  if (!saveRecs || !brief.recommendations.length) return [];
  const recRows = brief.recommendations.map(r => ({
    user_id: userId, rec_type: r.rec_type, rec_key: r.rec_key, window_day: r.window_day, reason: r.reason, evidence: r.evidence, confidence: r.confidence,
    action: r.action, expected_outcome: r.expected_outcome, follow_up_at: r.follow_up_at, score: r.score, metric: r.metric ?? null,
  }));
  await admin.from('recommendations').upsert(recRows, { onConflict: 'user_id,rec_key,window_day', ignoreDuplicates: true });
  const { data } = await admin.from('recommendations').select('*').eq('user_id', userId).in('status', ['new', 'seen']).gte('window_day', weekStart(s.today)).order('score', { ascending: false }).limit(5);
  return data ?? [];
}
export { weekStart };
/** Which forecast switches are on: one small query for all five. */
export async function forecastFlags(admin: SupabaseClient): Promise<Partial<Record<ForecastKey, boolean>>> {
  const { data } = await admin.from('feature_flags').select('key, enabled').in('key', Object.values(FORECAST_FLAGS));
  const on = new Set((data ?? []).filter((r: any) => r.enabled).map((r: any) => String(r.key)));
  return Object.fromEntries(FORECAST_KEYS.map(k => [k, on.has(FORECAST_FLAGS[k])]));
}
/** Pure arithmetic on the snapshot already loaded: no extra reads, no AI. */
export function forecastsFor(s: Snapshot, now: Date, on: Partial<Record<ForecastKey, boolean>>, scope: Scope = { food: true, energy: true }): Forecast[] {
  const hour = new Date(now.getTime() + 5.5 * 3_600_000).getUTCHours();
  return runForecasts({ rows: s.rows, meals: s.meals, targets: s.targets, today: s.today, now, hour }, on, scope);
}
/** Saves only what changed (one read, then writes only for changed forecasts). History keeps changes for 90 days. */
export async function persistForecasts(admin: SupabaseClient, userId: string, list: Forecast[]) {
  if (!list.length) return;
  const { data: old } = await admin.from('forecasts').select('key, input_hash, expires_at').eq('user_id', userId);
  const prev = new Map<string, { h: string; exp: string }>((old ?? []).map((r: any) => [String(r.key), { h: String(r.input_hash), exp: String(r.expires_at) }]));
  const nowIso = new Date().toISOString();
  const changed = list.filter(f => { const p = prev.get(f.key); return !p || p.h !== forecastHash(f) || p.exp < nowIso; });
  if (!changed.length) return;
  await admin.from('forecasts').upsert(changed.map(f => ({ user_id: userId, key: f.key, version: f.version, status: f.status, confidence: f.confidence, headline: f.headline, evidence: f.evidence, data: f.data, sample_size: f.sample_size, min_needed: f.min_needed, input_hash: forecastHash(f), calculated_at: f.calculated_at, expires_at: f.expires_at })), { onConflict: 'user_id,key' });
  const hist = changed.filter(f => f.key !== 'protein_catchup' && prev.get(f.key)?.h !== forecastHash(f));
  if (hist.length) {
    await admin.from('forecast_history').insert(hist.map(f => ({ user_id: userId, key: f.key, status: f.status, confidence: f.confidence, headline: f.headline, data: f.data, calculated_at: f.calculated_at })));
    await admin.from('forecast_history').delete().eq('user_id', userId).lt('calculated_at', new Date(Date.now() - 90 * 86_400_000).toISOString());
  }
}
