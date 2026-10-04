/**
 * netlify/functions/_shared/nutritionValidator.ts
 * Schema validation for all AI-returned nutrition objects.
 * Rejects biologically impossible nutrition profiles before they reach the DB.
 */

export interface RawNutrition {
  name?:       unknown;
  portion?:    unknown;
  calories?:   unknown;
  protein?:    unknown;
  carbs?:      unknown;
  fat?:        unknown;
  gl?:         unknown;
  gi?:         unknown;
  confidence?: unknown;
  source?:     unknown;
  notes?:      unknown;
  weight_g?:   unknown;
}

export interface ValidNutrition {
  name:       string;
  portion:    string;
  calories:   number;
  protein:    number;
  carbs:      number;
  fat:        number;
  gl:         number;
  gi?:        number;
  confidence: 'high' | 'medium' | 'low';
  source:     string;
  notes?:     string;
  weight_g?:  number;
}

export type ValidationResult = {
  valid:  true;
  data:   ValidNutrition;
} | {
  valid:  false;
  errors: string[];
  raw:    unknown;
}

// GL defaults by food category when GL is missing from AI response
const GL_CATEGORY_DEFAULTS: Record<string, number> = {
  rice:    22,
  roti:    12,
  dal:     8,
  sabzi:   5,
  snack:   15,
  sweet:   25,
  fruit:   10,
  default: 12,
};

function inferGL(raw: RawNutrition): number {
  if (typeof raw.gl === 'number' && raw.gl >= 0) return raw.gl;
  if (typeof raw.gi === 'number' && typeof raw.carbs === 'number') {
    return Math.round((raw.gi / 100) * (raw.carbs as number));
  }
  const name = String(raw.name ?? '').toLowerCase();
  for (const [key, val] of Object.entries(GL_CATEGORY_DEFAULTS)) {
    if (key !== 'default' && name.includes(key)) return val;
  }
  return GL_CATEGORY_DEFAULTS.default;
}

export function validateNutrition(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const r = (raw as RawNutrition) ?? {};

  // name
  if (typeof r.name !== 'string' || r.name.trim().length === 0)
    errors.push('name must be a non-empty string');
  if (typeof r.name === 'string' && r.name.length > 200)
    errors.push('name must be <= 200 characters');

  // portion
  if (typeof r.portion !== 'string' || r.portion.trim().length === 0)
    errors.push('portion must be a non-empty string');

  // calories
  const calories = Number(r.calories);
  if (isNaN(calories) || calories <= 0 || calories > 3000)
    errors.push(`calories must be 0 < x <= 3000, got ${r.calories}`);

  // protein
  const protein = Number(r.protein);
  if (isNaN(protein) || protein < 0)
    errors.push(`protein must be >= 0, got ${r.protein}`);
  // Core invariant: protein cannot provide more energy than total calories
  // 1g protein = 4 kcal; if protein > calories/4, it's biologically impossible
  if (!isNaN(protein) && !isNaN(calories) && protein > calories / 4)
    errors.push(`protein (${protein}g) would exceed caloric total (${calories} kcal). Biologically impossible.`);

  // carbs
  const carbs = Number(r.carbs);
  if (isNaN(carbs) || carbs < 0 || carbs > 500)
    errors.push(`carbs must be 0–500, got ${r.carbs}`);

  // fat
  const fat = Number(r.fat);
  if (isNaN(fat) || fat < 0 || fat > 200)
    errors.push(`fat must be 0–200, got ${r.fat}`);

  if (errors.length > 0) {
    return { valid: false, errors, raw };
  }

  // GL: estimate if missing (never store null GL)
  const gl = inferGL(r);

  const confidence = (['high', 'medium', 'low'] as const)
    .find(c => c === r.confidence) ?? 'medium';

  return {
    valid: true,
    data: {
      name:       String(r.name).trim(),
      portion:    String(r.portion).trim(),
      calories:   Math.round(calories),
      protein:    parseFloat(protein.toFixed(1)),
      carbs:      parseFloat(carbs.toFixed(1)),
      fat:        parseFloat(fat.toFixed(1)),
      gl:         parseFloat(gl.toFixed(1)),
      gi:         typeof r.gi === 'number' ? r.gi : undefined,
      confidence,
      source:     typeof r.source === 'string' ? r.source : 'AI estimate',
      notes:      typeof r.notes === 'string' ? r.notes : undefined,
      weight_g:   typeof r.weight_g === 'number' ? r.weight_g : undefined,
    },
  };
}

/** Strip markdown code fences and parse JSON safely */
export function safeParseJSON(text: string): unknown {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(cleaned);
}
