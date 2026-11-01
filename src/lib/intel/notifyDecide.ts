/**
 * Smart notification decision engine (2.1 P4). Pure and testable.
 * It decides, for each candidate, whether to send now, wait, or skip, and always says WHY.
 * Controls: opt-out per kind, quiet hours, daily cap, per-kind cooldown, de-duplication, fatigue score, learned timing.
 */
import { istHour } from './dates';

export type NotifKind = 'morning_verdict' | 'meal_suggestion' | 'protein_reminder' | 'flexible_prep' | 'check_in' | 'positive' | 'missed_logging' | 'weekly_review' | 'coach_nudge';
export const ALL_KINDS: NotifKind[] = ['morning_verdict', 'meal_suggestion', 'protein_reminder', 'flexible_prep', 'check_in', 'positive', 'missed_logging', 'weekly_review', 'coach_nudge'];

export const COOLDOWN_HOURS: Record<NotifKind, number> = {
  morning_verdict: 20, meal_suggestion: 6, protein_reminder: 24, flexible_prep: 12, check_in: 24, positive: 72, missed_logging: 24, weekly_review: 144, coach_nudge: 24,
};

export interface Candidate { kind: NotifKind; priority: number; reason: string; dedupeKey: string; recId?: string }
export interface NotifPrefs { enabled: boolean; kindsOff: string[]; quietStart: number; quietEnd: number; maxPerDay: number }
export interface SentItem { kind: NotifKind; sentAt: Date; opened: boolean; acted: boolean; dedupeKey?: string }
export type ReasonCode = 'ok' | 'opted_out' | 'kind_off' | 'quiet_hours' | 'daily_cap' | 'cooldown' | 'duplicate' | 'fatigue_high' | 'better_time' | 'one_at_a_time';
export interface Decision {
  kind: NotifKind; decision: 'send' | 'defer' | 'skip'; reason_code: ReasonCode; dedupeKey: string; recId?: string;
  fatigue: number; why: { priority: number; reason: string; sentToday: number; bestHour: number | null; note: string };
}

const HOUR = 3_600_000;
const inQuiet = (minute: number, start: number, end: number) => start === end ? false : start < end ? minute >= start && minute < end : minute >= start || minute < end;
const istMinute = (now: Date) => { const t = new Date(now.getTime() + 5.5 * HOUR); return t.getUTCHours() * 60 + t.getUTCMinutes(); };
const istDayKey = (d: Date) => new Date(d.getTime() + 5.5 * HOUR).toISOString().slice(0, 10);

/** 0 (fresh) to 1 (worn out). Rises with how many we sent recently and how many were ignored. */
export function fatigueScore(history: SentItem[], now: Date, maxPerDay = 2): number {
  const last48 = history.filter(h => now.getTime() - h.sentAt.getTime() <= 48 * HOUR).length;
  const load = Math.min(last48 / Math.max(maxPerDay * 2, 1), 1) * 0.5;
  const recent = [...history].sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()).slice(0, 6);
  const ignored = recent.length >= 3 ? recent.filter(h => !h.opened && !h.acted).length / recent.length : 0;
  return Math.round((load + ignored * 0.5) * 100) / 100;
}

/** The hour (IST) this person most often acts on this kind, or null when we have not seen enough. Needs 3+ sends and 1+ action. */
export function learnedHour(kind: NotifKind, history: SentItem[]): number | null {
  const own = history.filter(h => h.kind === kind);
  if (own.length < 3) return null;
  const hits = new Map<number, number>();
  for (const h of own) if (h.acted || h.opened) { const hr = istHour(h.sentAt); hits.set(hr, (hits.get(hr) ?? 0) + (h.acted ? 2 : 1)); }
  if (!hits.size) return null;
  return [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}
const hourGap = (a: number, b: number) => Math.min(Math.abs(a - b), 24 - Math.abs(a - b));

export function decide(cands: Candidate[], ctx: { now: Date; prefs: NotifPrefs; history: SentItem[] }): Decision[] {
  const { now, prefs, history } = ctx;
  const fatigue = fatigueScore(history, now, prefs.maxPerDay);
  const today = istDayKey(now);
  const sentToday = history.filter(h => istDayKey(h.sentAt) === today).length;
  const out: Decision[] = [];
  let sendTaken = false;
  const mk = (c: Candidate, decision: Decision['decision'], reason_code: ReasonCode, note: string, bestHour: number | null): Decision => ({
    kind: c.kind, decision, reason_code, dedupeKey: c.dedupeKey, recId: c.recId, fatigue,
    why: { priority: c.priority, reason: c.reason, sentToday, bestHour, note },
  });
  for (const c of [...cands].sort((a, b) => b.priority - a.priority)) {
    const best = learnedHour(c.kind, history);
    if (!prefs.enabled) { out.push(mk(c, 'skip', 'opted_out', 'Smart notifications are off for this person.', best)); continue; }
    if (prefs.kindsOff.includes(c.kind)) { out.push(mk(c, 'skip', 'kind_off', 'This kind is switched off.', best)); continue; }
    if (history.some(h => h.dedupeKey === c.dedupeKey)) { out.push(mk(c, 'skip', 'duplicate', 'Already sent for this moment.', best)); continue; }
    const lastOfKind = history.filter(h => h.kind === c.kind).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0];
    if (lastOfKind && now.getTime() - lastOfKind.sentAt.getTime() < COOLDOWN_HOURS[c.kind] * HOUR) { out.push(mk(c, 'skip', 'cooldown', `Same kind sent less than ${COOLDOWN_HOURS[c.kind]} hours ago.`, best)); continue; }
    if (sentToday >= prefs.maxPerDay) { out.push(mk(c, 'skip', 'daily_cap', 'Daily limit reached.', best)); continue; }
    if (inQuiet(istMinute(now), prefs.quietStart, prefs.quietEnd)) { out.push(mk(c, 'defer', 'quiet_hours', 'Quiet hours. Try again later.', best)); continue; }
    if (fatigue >= 0.7 && c.priority < 0.8) { out.push(mk(c, 'skip', 'fatigue_high', 'Recent messages were ignored or too frequent.', best)); continue; }
    if (best != null && c.priority < 0.8 && hourGap(istHour(now), best) > 1) { out.push(mk(c, 'defer', 'better_time', `This person usually responds around ${best}:00.`, best)); continue; }
    if (sendTaken) { out.push(mk(c, 'skip', 'one_at_a_time', 'A higher priority message goes first.', best)); continue; }
    sendTaken = true;
    out.push(mk(c, 'send', 'ok', 'Passed every check.', best));
  }
  return out;
}

/** What happened after we sent it. */
export function classifyOutcome(a: { opened: boolean; acted: boolean; loggedWithin24h: boolean; hoursSince: number }): 'helped' | 'no_change' | 'ignored' | null {
  if (a.acted && a.loggedWithin24h) return 'helped';
  if (a.acted || a.opened) return a.hoursSince >= 24 ? 'no_change' : null;
  return a.hoursSince >= 24 ? 'ignored' : null;
}

/** Candidate moments from today's state. Every one carries its reason. */
export interface CandidateInput {
  now: Date; today: string; loggedToday: boolean; loggedDays7: number; streak: number; hasCheckinToday: boolean;
  topProteinRec?: { id?: string; text: string }; smartMealText?: string; flexReservedCal?: number;
  weekday: number; energyIntelligence: boolean;
}
export function buildCandidates(i: CandidateInput): Candidate[] {
  const h = istHour(i.now), c: Candidate[] = [];
  const day = i.today;
  if (h >= 7 && h < 10) c.push({ kind: 'morning_verdict', priority: 0.5, reason: 'Start of the day.', dedupeKey: `morning:${day}` });
  if (h >= 19 && h < 21 && !i.loggedToday && i.loggedDays7 >= 3) c.push({ kind: 'missed_logging', priority: 0.6, reason: `Nothing logged yet today; you logged ${i.loggedDays7} of the last 7 days.`, dedupeKey: `missed:${day}` });
  if (i.topProteinRec && ((h >= 11 && h < 14) || (h >= 17 && h < 19))) c.push({ kind: 'protein_reminder', priority: 0.6, reason: i.topProteinRec.text, dedupeKey: `protein:${day}`, recId: i.topProteinRec.id });
  if (i.smartMealText && ((h >= 11 && h < 14) || (h >= 16 && h < 18))) c.push({ kind: 'meal_suggestion', priority: 0.5, reason: i.smartMealText, dedupeKey: `meal:${day}:${h < 15 ? 'a' : 'b'}` });
  if ((i.flexReservedCal ?? 0) > 0 && h >= 10 && h < 17) c.push({ kind: 'flexible_prep', priority: 0.7, reason: `A flexible meal of ${i.flexReservedCal} kcal is planned today.`, dedupeKey: `flex:${day}` });
  if (i.energyIntelligence && !i.hasCheckinToday && h >= 9 && h < 12) c.push({ kind: 'check_in', priority: 0.3, reason: 'No check-in yet today.', dedupeKey: `checkin:${day}` });
  if (i.streak >= 5) c.push({ kind: 'positive', priority: 0.25, reason: `${i.streak} days in a row.`, dedupeKey: `streak:${Math.floor(i.streak / 5)}:${day.slice(0, 7)}` });
  if ((i.weekday === 0 && h >= 17 && h < 20) || (i.weekday === 1 && h >= 8 && h < 11)) c.push({ kind: 'weekly_review', priority: 0.5, reason: 'Your weekly review is ready.', dedupeKey: `weekly:${day.slice(0, 8)}${i.weekday === 0 ? 's' : 'm'}` });
  return c;
}

/** Plain text for the notification. Short, no links, no medical claims. */
export function composeMessage(c: Candidate, extra?: { action?: string; smartMeal?: string; streak?: number }): { title: string; body: string } {
  const cut = (s: string) => (s.length > 140 ? s.slice(0, 137).trimEnd() + '...' : s);
  switch (c.kind) {
    case 'morning_verdict': return { title: 'Your day', body: cut('Open NutriSmart to see what matters today.') };
    case 'meal_suggestion': return { title: 'A meal that fits', body: cut(extra?.smartMeal ?? 'See a meal that fits the rest of your day.') };
    case 'protein_reminder': return { title: 'Protein check', body: cut(extra?.action ?? 'Add a protein-rich food you already eat.') };
    case 'flexible_prep': return { title: 'Your flexible meal', body: cut(extra?.action ?? 'See how the rest of today fits around your flexible meal.') };
    case 'check_in': return { title: 'Quick check-in', body: cut('How is your energy today? It takes five seconds.') };
    case 'positive': return { title: 'Nicely done', body: cut(`${extra?.streak ?? 5} days of logging in a row. Keep it simple.`) };
    case 'missed_logging': return { title: 'Quick reminder', body: cut('Nothing logged yet today. One quick entry keeps your week on track.') };
    case 'weekly_review': return { title: 'Your week', body: cut('Your weekly review is ready.') };
    default: return { title: 'NutriSmart', body: cut(c.reason) };
  }
}
