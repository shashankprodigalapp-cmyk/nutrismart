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
