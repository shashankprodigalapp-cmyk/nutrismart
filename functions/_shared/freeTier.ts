// Free-tier limits and the traffic-light logic for the admin "Free tier" screen.
// Numbers marked "documented" come from each provider's published free plan.
// Gemini's daily limit is not published per model, so the owner enters it once
// from Google AI Studio (aistudio.google.com/rate-limit) and it is stored in admin_settings.

export const FREE_TIER = {
  supabase_db_bytes:      500 * 1024 * 1024,        // documented: 500 MB database per project
  supabase_storage_bytes: 1024 * 1024 * 1024,       // documented: 1 GB file storage
  supabase_mau:           50_000,                   // documented: 50,000 monthly active users
  supabase_egress_bytes:  5 * 1024 * 1024 * 1024,   // documented: 5 GB egress (cannot be read from inside the app)
  cloudflare_requests_per_day: 100_000,             // documented: Workers Free plan, shared with Pages Functions
  checked_on: '2026-10-25',
} as const;

export type Status = 'ok' | 'warn' | 'critical' | 'unknown';

/** Under 70% = ok, 70 to 90% = warn, 90% and over = critical. No limit known = unknown. */
export function statusFor(used: number | null | undefined, limit: number | null | undefined): Status {
  if (used == null || limit == null || !(limit > 0)) return 'unknown';
  const r = used / limit;
  if (r >= 0.9) return 'critical';
  if (r >= 0.7) return 'warn';
  return 'ok';
}

export function worst(list: Status[]): Status {
  if (list.includes('critical')) return 'critical';
  if (list.includes('warn')) return 'warn';
  if (list.includes('ok')) return 'ok';
  return 'unknown';
}

/** Share of the current US Pacific day that has passed (Google resets daily quota at Pacific midnight). */
export function pacificDayFraction(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit',
  }).formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? '0') % 24;
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
  return (h * 60 + m) / (24 * 60);
}

/** Straight-line guess of where today's count will end. Needs at least 10% of the day to avoid wild numbers. */
export function projectToEndOfDay(used: number, fraction: number): number | null {
  if (!(fraction >= 0.1)) return null;
  return Math.round(used / fraction);
}

// ── Per-model Gemini meters ──────────────────────────────────────────────────
export interface ModelLimit { rpd: number | null; rpm: number | null }
export interface ModelUsage { model: string; calls: number; limited: number; peak_per_minute: number }

/** The three Gemini models the app calls, with the limits read from Google AI Studio on 2026-10-25. */
export const GEMINI_MODELS: { model: string; label: string; what: string; defaults: ModelLimit }[] = [
  { model: 'gemini-3.5-flash-lite', label: 'Flash Lite', what: 'name search and photo nutrition', defaults: { rpd: 500, rpm: 15 } },
  { model: 'gemini-3.8-flash', label: '3.8 Flash', what: 'photo identify', defaults: { rpd: 20, rpm: 5 } },
  { model: 'gemini-embedding-001', label: 'Embedding', what: 'matching similar foods', defaults: { rpd: 1000, rpm: 100 } },
];

export interface ModelMeter {
  key: string; label: string; used: number; limit: number | null; status: Status;
  projected: number | null; note: string;
}

/** Merge saved limits over the defaults. A saved value of null means "unknown". */
export function resolveLimits(saved: Record<string, Partial<ModelLimit>> | null | undefined): Record<string, ModelLimit> {
  const out: Record<string, ModelLimit> = {};
  for (const m of GEMINI_MODELS) {
    const s = saved?.[m.model];
    out[m.model] = {
      rpd: s && 'rpd' in s ? (s.rpd ?? null) : m.defaults.rpd,
      rpm: s && 'rpm' in s ? (s.rpm ?? null) : m.defaults.rpm,
    };
  }
  return out;
}

/** Two meters (day, busiest minute) per model. A refusal from Google today makes that model red. */
export function buildModelMeters(usage: ModelUsage[], limits: Record<string, ModelLimit>, fraction: number): ModelMeter[] {
  const meters: ModelMeter[] = [];
  for (const m of GEMINI_MODELS) {
    const u = usage.find(x => x.model === m.model) ?? { model: m.model, calls: 0, limited: 0, peak_per_minute: 0 };
    const lim = limits[m.model] ?? { rpd: null, rpm: null };
    const projected = projectToEndOfDay(u.calls, fraction);
    let dayStatus = statusFor(Math.max(u.calls, projected ?? 0), lim.rpd);
    if (u.limited > 0) dayStatus = 'critical';
    meters.push({
      key: `${m.model}:day`, label: `${m.label} today (${m.what})`, used: u.calls, limit: lim.rpd, status: dayStatus, projected,
      note: u.limited > 0 ? `Google refused ${u.limited} request(s) today. This model's daily limit has been hit.` : 'Real calls today, on Google’s US Pacific day.',
    });
    meters.push({
      key: `${m.model}:min`, label: `${m.label} busiest minute today`, used: u.peak_per_minute, limit: lim.rpm,
      status: statusFor(u.peak_per_minute, lim.rpm), projected: null,
      note: 'Most requests in any single minute today. Google also limits per minute.',
    });
  }
  return meters;
}
