import { describe, it, expect } from 'vitest';
import { decideNudge, inQuietHours, istParts, istDayStart, wantsLogReminder, cleanNudgeText, DEFAULT_PREFS } from '../../../functions/_shared/nudgeRules';

const at = (ist: string) => new Date(new Date(ist + ':00Z').getTime() - 5.5 * 3_600_000); // "2026-10-27T14:00" IST
const base = { kind: 'coach_message' as const, prefs: DEFAULT_PREFS, sentToday: 0, lastSentAt: null, hasDevice: true };

describe('quiet hours and time', () => {
  it('handles overnight windows', () => {
    expect(inQuietHours(22 * 60, 1290, 450)).toBe(true);
    expect(inQuietHours(2 * 60, 1290, 450)).toBe(true);
    expect(inQuietHours(7 * 60 + 29, 1290, 450)).toBe(true);
    expect(inQuietHours(7 * 60 + 30, 1290, 450)).toBe(false);
    expect(inQuietHours(12 * 60, 1290, 450)).toBe(false);
    expect(inQuietHours(600, 500, 500)).toBe(false);
  });
  it('works out the IST day', () => {
    expect(istParts(new Date('2026-10-27T19:00:00Z')).day).toBe('2026-10-28');   // 00:30 IST next day
    expect(istParts(at('2026-10-27T14:00')).hour).toBe(14);
    expect(istDayStart(at('2026-10-27T14:00')).toISOString()).toBe('2026-10-26T18:30:00.000Z');
  });
});

describe('decideNudge', () => {
  it('allows a normal daytime coach message', () => { expect(decideNudge({ ...base, now: at('2026-10-27T12:00') })).toEqual({ ok: true }); });
  it('waits during quiet hours', () => { expect(decideNudge({ ...base, now: at('2026-10-27T23:00') })).toEqual({ ok: false, reason: 'quiet_hours', wait: true }); });
  it('stops at the daily cap', () => { expect(decideNudge({ ...base, now: at('2026-10-27T12:00'), sentToday: 2 })).toEqual({ ok: false, reason: 'daily_cap' }); });
  it('spaces nudges apart', () => {
    expect(decideNudge({ ...base, now: at('2026-10-27T12:00'), lastSentAt: at('2026-10-27T10:00') })).toEqual({ ok: false, reason: 'too_soon', wait: true });
    expect(decideNudge({ ...base, now: at('2026-10-27T13:00'), lastSentAt: at('2026-10-27T10:00') })).toEqual({ ok: true });
  });
  it('respects mutes and missing devices', () => {
    expect(decideNudge({ ...base, now: at('2026-10-27T12:00'), prefs: { ...DEFAULT_PREFS, coach_nudges: false } })).toEqual({ ok: false, reason: 'muted' });
    expect(decideNudge({ ...base, kind: 'log_reminder', now: at('2026-10-27T19:30') })).toEqual({ ok: false, reason: 'muted' });  // reminders are opt-in
    expect(decideNudge({ ...base, now: at('2026-10-27T12:00'), hasDevice: false })).toEqual({ ok: false, reason: 'no_device' });
  });
  it('a max of 0 turns everything off', () => { expect(decideNudge({ ...base, now: at('2026-10-27T12:00'), prefs: { ...DEFAULT_PREFS, max_per_day: 0 } }).ok).toBe(false); });
  it('opted-in reminder passes', () => { expect(decideNudge({ ...base, kind: 'log_reminder', now: at('2026-10-27T19:30'), prefs: { ...DEFAULT_PREFS, log_reminders: true } })).toEqual({ ok: true }); });
});

describe('reminder and text rules', () => {
  it('reminds only engaged people who have not logged', () => {
    expect(wantsLogReminder({ hour: 19, loggedToday: false, loggedDaysLast7: 4 })).toBe(true);
    expect(wantsLogReminder({ hour: 19, loggedToday: true, loggedDaysLast7: 4 })).toBe(false);
    expect(wantsLogReminder({ hour: 19, loggedToday: false, loggedDaysLast7: 2 })).toBe(false);
    expect(wantsLogReminder({ hour: 21, loggedToday: false, loggedDaysLast7: 6 })).toBe(false);
    expect(wantsLogReminder({ hour: 10, loggedToday: false, loggedDaysLast7: 6 })).toBe(false);
  });
  it('cleans and limits coach text', () => {
    expect(cleanNudgeText('  Great   week!  ')).toEqual({ ok: true, text: 'Great week!' });
    expect(cleanNudgeText('').ok).toBe(false);
    expect(cleanNudgeText('x'.repeat(141)).ok).toBe(false);
    expect(cleanNudgeText('see https://evil.example').ok).toBe(false);
    expect(cleanNudgeText('visit evil.com now').ok).toBe(false);
  });
});
