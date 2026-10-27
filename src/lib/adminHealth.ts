/** Plain health checks from the admin numbers. Each check says what it looked at, so nothing is a mystery score. */
export type Level = 'ok' | 'warn' | 'critical' | 'unknown';
export interface Check { id: string; name: string; level: Level; detail: string }

export interface Metrics {
  ai_7d?: { calls?: number; failures?: number };
  notifications_7d?: { sent?: number; failed?: number; skipped?: number; stuck_queued?: number; devices?: number };
  reviews_7d?: { waiting_for_coach?: number };
  food_database?: { unverified?: number };
}

export const LIMITS = { aiFailWarn: 0.1, aiFailCritical: 0.3, notifFailWarn: 0.1, notifFailCritical: 0.3, minCalls: 10, waitingWarn: 10, unverifiedWarn: 50 } as const;

export function healthChecks(m: Metrics): Check[] {
  const out: Check[] = [];
  const ai = m.ai_7d ?? {}; const calls = ai.calls ?? 0; const fails = ai.failures ?? 0;
  if (calls < LIMITS.minCalls) out.push({ id: 'ai', name: 'AI calls', level: 'unknown', detail: `Only ${calls} calls in 7 days, too few to judge.` });
  else {
    const rate = fails / calls;
    out.push({ id: 'ai', name: 'AI calls', level: rate >= LIMITS.aiFailCritical ? 'critical' : rate >= LIMITS.aiFailWarn ? 'warn' : 'ok', detail: `${fails} of ${calls} calls failed in 7 days (${Math.round(rate * 100)}%).` });
  }
  const n = m.notifications_7d ?? {}; const tried = (n.sent ?? 0) + (n.failed ?? 0);
  if (tried < LIMITS.minCalls) out.push({ id: 'push', name: 'Notifications', level: 'unknown', detail: `Only ${tried} delivery attempts in 7 days, too few to judge.` });
  else {
    const rate = (n.failed ?? 0) / tried;
    out.push({ id: 'push', name: 'Notifications', level: rate >= LIMITS.notifFailCritical ? 'critical' : rate >= LIMITS.notifFailWarn ? 'warn' : 'ok', detail: `${n.failed ?? 0} of ${tried} deliveries failed (${Math.round(rate * 100)}%).` });
  }
  const stuck = n.stuck_queued ?? 0;
  out.push({ id: 'queue', name: 'Waiting messages', level: stuck > 0 ? 'warn' : 'ok', detail: stuck > 0 ? `${stuck} nudges have waited more than 24 hours. The hourly job may not be running.` : 'No nudge has waited more than 24 hours.' });
  const waiting = m.reviews_7d?.waiting_for_coach ?? 0;
  out.push({ id: 'reviews', name: 'Reviews waiting for coaches', level: waiting >= LIMITS.waitingWarn ? 'warn' : 'ok', detail: `${waiting} reviews are waiting for a coach to approve.` });
  const unv = m.food_database?.unverified ?? 0;
  out.push({ id: 'foods', name: 'Foods to verify', level: unv >= LIMITS.unverifiedWarn ? 'warn' : 'ok', detail: `${unv} AI-found foods are waiting for review.` });
  return out;
}

export function overall(checks: Check[]): Level {
  if (checks.some(c => c.level === 'critical')) return 'critical';
  if (checks.some(c => c.level === 'warn')) return 'warn';
  return checks.every(c => c.level === 'unknown') ? 'unknown' : 'ok';
}
