/**
 * Nudge rules (deterministic). One place decides whether a nudge may go out now.
 * Time is IST (the app's only timezone for now).
 */
export interface NudgePrefs { log_reminders: boolean; coach_nudges: boolean; quiet_start: number; quiet_end: number; max_per_day: number }
export const DEFAULT_PREFS: NudgePrefs = { log_reminders: false, coach_nudges: true, quiet_start: 1290, quiet_end: 450, max_per_day: 2 };

export const MAX_NUDGE_CHARS = 140;
export const MIN_GAP_MINUTES = 180;        // no two nudges within 3 hours
export const REMINDER_FROM_HOUR = 19;      // evening reminder window, IST
export const REMINDER_TO_HOUR = 21;

const IST_MS = 5.5 * 3_600_000;
export function istParts(now: Date): { minuteOfDay: number; hour: number; day: string } {
  const t = new Date(now.getTime() + IST_MS);
  return { minuteOfDay: t.getUTCHours() * 60 + t.getUTCMinutes(), hour: t.getUTCHours(), day: t.toISOString().slice(0, 10) };
}
/** Start of the IST day as a UTC instant. */
export function istDayStart(now: Date): Date {
  return new Date(new Date(istParts(now).day + 'T00:00:00Z').getTime() - IST_MS);
}

export function inQuietHours(minuteOfDay: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minuteOfDay >= start && minuteOfDay < end : minuteOfDay >= start || minuteOfDay < end;
}

export type Decision = { ok: true } | { ok: false; reason: 'muted' | 'quiet_hours' | 'daily_cap' | 'too_soon' | 'no_device'; wait?: boolean };

/** wait=true means "try again later" (the nudge stays queued); otherwise it is dropped. */
export function decideNudge(a: {
  kind: 'log_reminder' | 'coach_message'; now: Date; prefs: NudgePrefs; sentToday: number; lastSentAt: Date | null; hasDevice: boolean;
}): Decision {
  const { kind, now, prefs } = a;
  if (kind === 'log_reminder' && !prefs.log_reminders) return { ok: false, reason: 'muted' };
  if (kind === 'coach_message' && !prefs.coach_nudges) return { ok: false, reason: 'muted' };
  if (!a.hasDevice) return { ok: false, reason: 'no_device' };
  if (prefs.max_per_day <= 0 || a.sentToday >= prefs.max_per_day) return { ok: false, reason: 'daily_cap' };
  if (inQuietHours(istParts(now).minuteOfDay, prefs.quiet_start, prefs.quiet_end)) return { ok: false, reason: 'quiet_hours', wait: true };
  if (a.lastSentAt && now.getTime() - a.lastSentAt.getTime() < MIN_GAP_MINUTES * 60_000) return { ok: false, reason: 'too_soon', wait: true };
  return { ok: true };
}

/** Evening reminder only for people who log most days and have not logged yet today. */
export function wantsLogReminder(a: { hour: number; loggedToday: boolean; loggedDaysLast7: number }): boolean {
  return a.hour >= REMINDER_FROM_HOUR && a.hour < REMINDER_TO_HOUR && !a.loggedToday && a.loggedDaysLast7 >= 3;
}

/** A coach message is plain text only: no links, no long text. */
export function cleanNudgeText(input: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const t = String(input ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return { ok: false, error: 'Write a short message first.' };
  if (t.length > MAX_NUDGE_CHARS) return { ok: false, error: `Keep it under ${MAX_NUDGE_CHARS} characters.` };
  if (/https?:|www\.|\.com\b|\.in\b/i.test(t)) return { ok: false, error: 'Links are not allowed in nudges.' };
  return { ok: true, text: t };
}
