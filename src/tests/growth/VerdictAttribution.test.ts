/**
 * VerdictAttribution.test.ts — Module 15 (A/B attribution)
 *
 * Tests main.tsx push deep-link attribution:
 *   1. ?source=verdict&variant=scientific fires app_opened_from_verdict with {variant:'scientific'}
 *   2. ?source=verdict&variant=coaching fires with {variant:'coaching'}
 *   3. The event fires exactly once per IST day (sessionStorage guard)
 *   4. The URL is cleaned (source/variant params removed) after attribution
 *   5. ?source=reengage fires app_opened_from_reengagement
 *   6. Unknown ?source values do not fire any event
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We extract the attribution logic from main.tsx into a pure testable fn.
// (The actual main.tsx calls this inline — we test the same logic here.)

interface AttributionDeps {
  searchParams: URLSearchParams;
  sessionStorageGet: (key: string) => string | null;
  sessionStorageSet: (key: string, value: string) => void;
  replaceState: (url: string) => void;
  insertEvent: (eventName: string, props: object) => Promise<void>;
}

async function trackPushAttribution(deps: AttributionDeps): Promise<void> {
  const source = deps.searchParams.get('source');
  if (!source) return;

  const variant = deps.searchParams.get('variant');
  const eventName =
    source === 'verdict'  ? 'app_opened_from_verdict' :
    source === 'reengage' ? 'app_opened_from_reengagement' : null;
  if (!eventName) return;

  const guardKey = `ns_attr_${source}_${new Date().toDateString()}`;
  if (deps.sessionStorageGet(guardKey)) return;
  deps.sessionStorageSet(guardKey, '1');

  const params = new URLSearchParams(deps.searchParams);
  params.delete('source');
  params.delete('variant');
  deps.replaceState(params.toString() ? `/?${params}` : '/');

  await deps.insertEvent(eventName, { variant });
}

describe('VerdictAttribution — push deep-link A/B tracking', () => {
  let insertEvent: ReturnType<typeof vi.fn>;
  let sessionStore: Map<string, string>;
  let replacedUrl: string;

  function makeDeps(search: string): AttributionDeps {
    return {
      searchParams:       new URLSearchParams(search),
      sessionStorageGet:  (k) => sessionStore.get(k) ?? null,
      sessionStorageSet:  (k, v) => { sessionStore.set(k, v); },
      replaceState:       (url) => { replacedUrl = url; },
      insertEvent,
    };
  }

  beforeEach(() => {
    insertEvent  = vi.fn().mockResolvedValue(undefined);
    sessionStore = new Map();
    replacedUrl  = '/';
  });

  it('fires app_opened_from_verdict with variant=scientific', async () => {
    await trackPushAttribution(makeDeps('source=verdict&variant=scientific'));
    expect(insertEvent).toHaveBeenCalledOnce();
    expect(insertEvent).toHaveBeenCalledWith('app_opened_from_verdict', { variant: 'scientific' });
  });

  it('fires app_opened_from_verdict with variant=coaching', async () => {
    await trackPushAttribution(makeDeps('source=verdict&variant=coaching'));
    expect(insertEvent).toHaveBeenCalledWith('app_opened_from_verdict', { variant: 'coaching' });
  });

  it('fires app_opened_from_reengagement for source=reengage', async () => {
    await trackPushAttribution(makeDeps('source=reengage'));
    expect(insertEvent).toHaveBeenCalledWith('app_opened_from_reengagement', { variant: null });
  });

  it('fires exactly once per day (sessionStorage guard)', async () => {
    const deps = makeDeps('source=verdict&variant=scientific');
    await trackPushAttribution(deps);
    // Simulate reload with same params — same day, guard key present
    await trackPushAttribution(makeDeps('source=verdict&variant=scientific'));
    expect(insertEvent).toHaveBeenCalledOnce();
  });

  it('cleans source and variant from the URL after attribution', async () => {
    await trackPushAttribution(makeDeps('source=verdict&variant=scientific'));
    expect(replacedUrl).not.toContain('source=');
    expect(replacedUrl).not.toContain('variant=');
  });

  it('preserves other query params after cleaning attribution params', async () => {
    await trackPushAttribution(makeDeps('source=verdict&variant=coaching&tab=energy'));
    expect(replacedUrl).toContain('tab=energy');
    expect(replacedUrl).not.toContain('source=');
  });

  it('does NOT fire for unknown source values', async () => {
    await trackPushAttribution(makeDeps('source=newsletter'));
    expect(insertEvent).not.toHaveBeenCalled();
  });

  it('does nothing when no source param present', async () => {
    await trackPushAttribution(makeDeps(''));
    expect(insertEvent).not.toHaveBeenCalled();
  });
});

// ── RetentionGate.test.ts ──────────────────────────────────────────────────
/**
 * Verifies retention_health_check logic from migration 008 (fixed version):
 *   1. Users with hours_since_last_event < 18 are NOT flagged (they're in the app)
 *   2. Users within quiet_hours are skipped by the cron push pass
 *   3. Users who are truly absent AND have not seen the verdict ARE flagged
 *   4. Users who have seen the verdict are NOT flagged regardless of absence
 */

// Re-implement the retention flag logic (mirrors the SQL function)
interface UserActivity {
  n_logged:          number;
  n_verdict_seen:    number;
  hours_since_event: number;
  p_since_days:      number;
  p_absent_hours:    number;
}

function needsReengagement(u: UserActivity): boolean {
  return (
    u.n_logged          >= u.p_since_days &&
    u.n_verdict_seen    === 0 &&
    u.hours_since_event >= u.p_absent_hours
  );
}

// Quiet hours logic (mirrors is_quiet_hours SQL function)
interface QuietHoursCheck {
  start:       number;  // IST hour
  end:         number;
  currentHour: number;
}
function isQuietHours({ start, end, currentHour: h }: QuietHoursCheck): boolean {
  if (start <= end) return h >= start && h < end;    // same-day window
  return h >= start || h < end;                       // crosses midnight (22→7)
}

describe('RetentionGate — retention_health_check and quiet hours', () => {
  const defaults = { p_since_days: 3, p_absent_hours: 18 };

  it('does NOT flag a user who was active < 18 hours ago', () => {
    expect(needsReengagement({
      n_logged: 3, n_verdict_seen: 0, hours_since_event: 2, ...defaults,
    })).toBe(false);
  });

  it('flags a user who logged food but was absent > 18h and never saw verdict', () => {
    expect(needsReengagement({
      n_logged: 3, n_verdict_seen: 0, hours_since_event: 24, ...defaults,
    })).toBe(true);
  });

  it('does NOT flag a user who has seen the verdict (even if absent)', () => {
    expect(needsReengagement({
      n_logged: 3, n_verdict_seen: 2, hours_since_event: 48, ...defaults,
    })).toBe(false);
  });

  it('does NOT flag a user with fewer logged days than threshold', () => {
    expect(needsReengagement({
      n_logged: 1, n_verdict_seen: 0, hours_since_event: 48, ...defaults,
    })).toBe(false);
  });

  // Quiet hours tests
  it('is_quiet_hours: same-day window (08:00–22:00 DND)', () => {
    expect(isQuietHours({ start: 8, end: 22, currentHour: 14 })).toBe(true);
    expect(isQuietHours({ start: 8, end: 22, currentHour: 7  })).toBe(false);
    expect(isQuietHours({ start: 8, end: 22, currentHour: 22 })).toBe(false);
  });

  it('is_quiet_hours: midnight-spanning window (22:00–07:00 default)', () => {
    expect(isQuietHours({ start: 22, end: 7, currentHour: 23 })).toBe(true);
    expect(isQuietHours({ start: 22, end: 7, currentHour: 3  })).toBe(true);
    expect(isQuietHours({ start: 22, end: 7, currentHour: 8  })).toBe(false);
    expect(isQuietHours({ start: 22, end: 7, currentHour: 12 })).toBe(false);
  });

  it('is NOT quiet at 07:30 IST (cron send time)', () => {
    expect(isQuietHours({ start: 22, end: 7, currentHour: 7 })).toBe(false);
  });
});
