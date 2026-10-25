/**
 * macroMath.ts — keeps protein / fat / carbs goals physically possible and sensible.
 *
 * Energy per gram: protein 4, carbohydrate 4, fat 9 kcal.
 * Calories are the master number. Carbs are whatever is left after protein and fat.
 * When the numbers do not fit, PROTEIN IS PROTECTED FIRST: fat is trimmed (down to a
 * floor of 20% of calories), and only then protein.
 * General guidance only — not medical advice.
 */
export const MIN_CARBS_G = 50;
export const PROTEIN_MAX_PCT = 45;   // of calories
export const FAT_MIN_PCT = 20;
export const FAT_MAX_PCT = 60;

export interface FittedMacros {
  cal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** true when protein/fat had to be changed to fit the calories */
  adjusted: boolean;
}

export function fitMacros(cal: number, protein: number, fat: number, minCarbs: number = MIN_CARBS_G): FittedMacros {
  const c = Math.max(0, Math.round(cal));
  const pIn = Math.max(0, Math.round(protein));
  const fIn = Math.max(0, Math.round(fat));

  let p = Math.min(pIn, Math.floor((c * PROTEIN_MAX_PCT) / 100 / 4));
  let f = Math.min(fIn, Math.floor((c * FAT_MAX_PCT) / 100 / 9));
  const avail = c - 4 * minCarbs;

  if (4 * p + 9 * f > avail) {
    // 1) trim fat first, but not below the floor (unless the user typed less)
    const fatFloor = Math.min(f, Math.floor((c * FAT_MIN_PCT) / 100 / 9));
    f = Math.max(fatFloor, Math.min(f, Math.floor((avail - 4 * p) / 9)));
    // 2) still too much: trim protein
    if (4 * p + 9 * f > avail) p = Math.max(0, Math.floor((avail - 9 * f) / 4));
  }

  const carbs = Math.max(0, Math.floor((c - 4 * p - 9 * f) / 4));
  return { cal: c, protein: p, fat: f, carbs, adjusted: p !== pIn || f !== fIn };
}

// ── Quick-setup styles (shares of calories) ──────────────────────────────────

export type PresetKey = 'balanced' | 'high_protein' | 'lower_carb';

export const PRESETS: Record<PresetKey, { label: string; blurb: string; proteinPct: number; fatPct: number }> = {
  balanced:     { label: 'Balanced',                blurb: '50% carbs · 20% protein · 30% fat', proteinPct: 20, fatPct: 30 },
  high_protein: { label: 'High protein',            blurb: '40% carbs · 30% protein · 30% fat', proteinPct: 30, fatPct: 30 },
  lower_carb:   { label: 'Lower carb, higher fat',  blurb: '25% carbs · 30% protein · 45% fat', proteinPct: 30, fatPct: 45 },
};

export function presetGrams(key: PresetKey, cal: number): { protein: number; fat: number } {
  const p = PRESETS[key];
  return { protein: Math.round((cal * p.proteinPct) / 100 / 4), fat: Math.round((cal * p.fatPct) / 100 / 9) };
}

/** Which style the current numbers match (within 3 points), or 'custom'. */
export function matchPreset(cal: number, protein: number, fat: number): PresetKey | 'custom' {
  if (cal <= 0) return 'custom';
  const pPct = (4 * protein * 100) / cal;
  const fPct = (9 * fat * 100) / cal;
  for (const k of Object.keys(PRESETS) as PresetKey[]) {
    if (Math.abs(pPct - PRESETS[k].proteinPct) <= 3 && Math.abs(fPct - PRESETS[k].fatPct) <= 3) return k;
  }
  return 'custom';
}

/** Percent of energy from each macro (sums to ~100). */
export function splitPercent(m: { protein: number; fat: number; carbs: number }): { carbs: number; protein: number; fat: number } {
  const total = 4 * m.protein + 9 * m.fat + 4 * m.carbs;
  if (total <= 0) return { carbs: 0, protein: 0, fat: 0 };
  const protein = Math.round((4 * m.protein * 100) / total);
  const fat = Math.round((9 * m.fat * 100) / total);
  return { carbs: Math.max(0, 100 - protein - fat), protein, fat };
}
