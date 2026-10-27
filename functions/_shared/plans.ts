// Plan catalog rules. Pure, so they can be tested without a database.
export const ENTITLEMENT_KEYS = ['ai_daily_limit', 'max_clients', 'features'] as const;
export const KNOWN_FEATURES = ['fitness_insights'] as const;

export interface PlanInput {
  key?: string; audience?: string; name?: string; description?: string | null;
  price_inr_month?: number; price_inr_year?: number | null; entitlements?: Record<string, unknown>;
  is_active?: boolean; sort_order?: number;
}
export type Checked = { ok: true; value: Required<Omit<PlanInput, 'description' | 'price_inr_year'>> & { description: string | null; price_inr_year: number | null } } | { ok: false; message: string };

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Validate an admin edit. Unknown entitlement keys are rejected so a typo cannot silently do nothing. */
export function checkPlan(i: PlanInput): Checked {
  if (!/^[a-z0-9_]{2,30}$/.test(String(i.key ?? ''))) return { ok: false, message: 'Key must be 2 to 30 lowercase letters, numbers or underscores.' };
  if (i.audience !== 'client' && i.audience !== 'coach') return { ok: false, message: 'Audience must be client or coach.' };
  const name = String(i.name ?? '').trim();
  if (name.length < 1 || name.length > 40) return { ok: false, message: 'Name must be 1 to 40 characters.' };
  const desc = i.description == null ? null : String(i.description).trim().slice(0, 300) || null;
  if (!isInt(i.price_inr_month ?? 0, 0, 100000)) return { ok: false, message: 'Monthly price must be a whole number of rupees, 0 to 100000.' };
  if (i.price_inr_year != null && !isInt(i.price_inr_year, 0, 1000000)) return { ok: false, message: 'Yearly price must be a whole number of rupees, 0 to 1000000.' };
  const e = i.entitlements ?? {};
  for (const k of Object.keys(e)) if (!(ENTITLEMENT_KEYS as readonly string[]).includes(k)) return { ok: false, message: `Unknown limit "${k}".` };
  if ('ai_daily_limit' in e && !isInt(e.ai_daily_limit, 0, 100000)) return { ok: false, message: 'AI searches per day must be a whole number, 0 to 100000.' };
  if ('max_clients' in e && e.max_clients !== null && !isInt(e.max_clients, 0, 100000)) return { ok: false, message: 'Client cap must be a whole number or empty for no cap.' };
  if ('features' in e) {
    if (!Array.isArray(e.features) || e.features.some(f => !(KNOWN_FEATURES as readonly string[]).includes(String(f)))) return { ok: false, message: 'Unknown feature in the list.' };
  }
  if (i.audience === 'coach' && 'ai_daily_limit' in e) return { ok: false, message: 'AI searches per day applies to client plans.' };
  if (i.audience === 'client' && 'max_clients' in e) return { ok: false, message: 'Client cap applies to coach plans.' };
  const sort = i.sort_order ?? 100;
  if (!isInt(sort, 0, 1000)) return { ok: false, message: 'Order must be 0 to 1000.' };
  return { ok: true, value: { key: i.key!, audience: i.audience, name, description: desc, price_inr_month: i.price_inr_month ?? 0, price_inr_year: i.price_inr_year ?? null, entitlements: e, is_active: i.is_active !== false, sort_order: sort } };
}

/** Can a coach take one more client? cap null or missing means no cap. */
export function seatAvailable(seats: { cap: number | null | undefined; used: number }): boolean {
  if (seats.cap == null) return true;
  return seats.used < seats.cap;
}

/** Yearly saving as a whole percent, or null when there is no yearly price or no saving. */
export function yearlySavingPct(month: number, year: number | null | undefined): number | null {
  if (year == null || month <= 0) return null;
  const pct = Math.round((1 - year / (month * 12)) * 100);
  return pct > 0 ? pct : null;
}
