/** Shared shapes for the 2.1 intelligence layer. Pure data, no imports. Days are IST dates 'YYYY-MM-DD'. */
export type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner';
export type Confidence = 'none' | 'low' | 'medium' | 'high';
export type Trend = 'up' | 'down' | 'flat' | 'unknown';

/** One day of totals (from daily_nutrition_metrics) plus the optional check-in answers for that day. */
export interface DayRow {
  day: string; calories: number; protein_g: number; meals: number; items: number;
  energy?: number | null; hunger?: number | null; mood?: number | null; fullness?: number | null;
  sleep?: 'poor' | 'okay' | 'good' | null;
}
/** One logged item (from daily_logs). */
export interface MealRow { day: string; meal: Meal; food_name: string; cal: number; protein: number; is_home?: boolean | null }
export interface Targets { cal: number; protein: number }

export interface Feature {
  key: string; window_days: number; value: number | null; baseline: number | null; delta: number | null;
  trend: Trend; sample_size: number; confidence: Confidence; calculated_at: string;
}

export interface Recommendation {
  rec_type: 'meal_adjustment' | 'food_swap' | 'protein_addition' | 'portion_adjustment' | 'meal_timing' | 'flexible_meal' | 'check_in' | 'behaviour_nudge' | 'coach_review';
  rec_key: string; window_day: string;
  reason: string; evidence: string[]; confidence: 'low' | 'medium' | 'high';
  action: string; expected_outcome: string; follow_up_at: string; score: number;
  /** What we will measure at the follow-up to see whether it helped. */
  metric?: { feature: string; window_days: number; value: number; direction: 'up' | 'down' };
}
