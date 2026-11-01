import { describe, it, expect } from 'vitest';
import { decide, fatigueScore, learnedHour, classifyOutcome, buildCandidates, composeMessage, COOLDOWN_HOURS, type Candidate, type SentItem, type NotifPrefs } from '../../lib/intel/notifyDecide';

const PREFS: NotifPrefs = { enabled: true, kindsOff: [], quietStart: 1290, quietEnd: 450, maxPerDay: 2 };   // quiet 21:30 to 07:30
const at = (hhmmIST: string, day = '2026-11-01') => new Date(new Date(`${day}T${hhmmIST}:00+05:30`).getTime());
const cand = (kind: Candidate['kind'], priority = 0.6, key = `${kind}:k`): Candidate => ({ kind, priority, reason: 'because', dedupeKey: key });
const sent = (kind: SentItem['kind'], when: Date, opened = true, acted = false, dedupeKey?: string): SentItem => ({ kind, sentAt: when, opened, acted, dedupeKey });
const one = (c: Candidate, now: Date, history: SentItem[] = [], prefs = PREFS) => decide([c], { now, prefs, history })[0];

describe('2.1 notification decisions', () => {
  it('sends when every check passes, and says why', () => {
    const d = one(cand('missed_logging'), at('19:30'));
    expect(d.decision).toBe('send'); expect(d.reason_code).toBe('ok'); expect(d.why.reason).toBe('because'); expect(d.why.priority).toBe(0.6);
  });
  it('respects opt-out and switched-off kinds', () => {
    expect(one(cand('positive'), at('19:30'), [], { ...PREFS, enabled: false }).reason_code).toBe('opted_out');
    expect(one(cand('positive'), at('19:30'), [], { ...PREFS, kindsOff: ['positive'] }).reason_code).toBe('kind_off');
  });
  it('waits during quiet hours instead of dropping', () => {
    const d = one(cand('missed_logging'), at('23:00')); expect(d.decision).toBe('defer'); expect(d.reason_code).toBe('quiet_hours');
    expect(one(cand('missed_logging'), at('06:00')).decision).toBe('defer');
  });
  it('enforces the daily cap', () => {
    const h = [sent('protein_reminder', at('09:00')), sent('check_in', at('12:00'))];
    expect(one(cand('missed_logging'), at('19:30'), h).reason_code).toBe('daily_cap');
  });
  it('enforces a cooldown per kind', () => {
    const h = [sent('protein_reminder', at('08:00', '2026-11-01'))];
    expect(one(cand('protein_reminder', 0.6, 'p:2'), at('19:30', '2026-11-02'), h).reason_code).not.toBe('cooldown');   // 35 hours later: fine
    expect(one(cand('protein_reminder', 0.6, 'p:2'), at('14:00'), h).reason_code).toBe('cooldown');
    expect(COOLDOWN_HOURS.weekly_review).toBeGreaterThan(COOLDOWN_HOURS.protein_reminder);
  });
  it('never sends the same moment twice', () => {
    expect(one(cand('missed_logging', 0.6, 'missed:2026-11-01'), at('19:30'), [sent('missed_logging', at('08:00', '2026-10-30'), true, false, 'missed:2026-11-01')]).reason_code).toBe('duplicate');
  });
  it('sends only one at a time, the highest priority first', () => {
    const ds = decide([cand('positive', 0.25), cand('flexible_prep', 0.7), cand('check_in', 0.3)], { now: at('11:00'), prefs: PREFS, history: [] });
    expect(ds.filter(d => d.decision === 'send').map(d => d.kind)).toEqual(['flexible_prep']);
    expect(ds.find(d => d.kind === 'positive')!.reason_code).toBe('one_at_a_time');
  });
  it('fatigue rises when messages are ignored and holds back low-priority ones', () => {
    const ignored = [1, 2, 3, 4, 5].map(i => sent('protein_reminder', new Date(at('09:00').getTime() - i * 30 * 3_600_000), false, false));
    const f = fatigueScore(ignored, at('19:30'));
    expect(f).toBeGreaterThanOrEqual(0.5);
    expect(fatigueScore([], at('19:30'))).toBe(0);
    const hot = [...ignored, sent('check_in', at('08:00'), false), sent('positive', at('10:00'), false)];
    expect(fatigueScore(hot, at('19:30'), 2)).toBeGreaterThanOrEqual(0.7);
    expect(one(cand('meal_suggestion', 0.3), at('19:30'), hot, { ...PREFS, maxPerDay: 3 }).reason_code).toBe('fatigue_high');
    expect(one(cand('flexible_prep', 0.85), at('19:30'), hot, { ...PREFS, maxPerDay: 3 }).decision).toBe('send');     // urgent still goes
  });
  it('learns the hour a person responds and waits for it', () => {
    const h = [10, 10, 10, 18].map((hr, i) => sent('protein_reminder', at(`${String(hr).padStart(2, '0')}:00`, `2026-10-${10 + i}`), true, hr === 10));
    expect(learnedHour('protein_reminder', h)).toBe(10);
    expect(learnedHour('protein_reminder', h.slice(0, 2))).toBeNull();                 // too little evidence
    const d = one(cand('protein_reminder', 0.6, 'p:new'), at('15:00', '2026-11-05'), h);
    expect(d.decision).toBe('defer'); expect(d.reason_code).toBe('better_time'); expect(d.why.bestHour).toBe(10);
    expect(one(cand('protein_reminder', 0.6, 'p:new2'), at('10:30', '2026-11-05'), h).decision).toBe('send');
  });
  it('classifies outcomes', () => {
    expect(classifyOutcome({ opened: true, acted: true, loggedWithin24h: true, hoursSince: 5 })).toBe('helped');
    expect(classifyOutcome({ opened: true, acted: false, loggedWithin24h: false, hoursSince: 30 })).toBe('no_change');
    expect(classifyOutcome({ opened: false, acted: false, loggedWithin24h: false, hoursSince: 30 })).toBe('ignored');
    expect(classifyOutcome({ opened: false, acted: false, loggedWithin24h: false, hoursSince: 3 })).toBeNull();
  });
  it('builds candidates from the day, each with a reason', () => {
    const base = { now: at('19:30'), today: '2026-11-01', loggedToday: false, loggedDays7: 5, streak: 0, hasCheckinToday: true, weekday: 3, energyIntelligence: false };
    expect(buildCandidates(base).map(c => c.kind)).toEqual(['missed_logging']);
    expect(buildCandidates({ ...base, loggedToday: true }).length).toBe(0);
    expect(buildCandidates({ ...base, loggedDays7: 1 }).length).toBe(0);
    const noon = buildCandidates({ ...base, now: at('12:00'), loggedToday: true, topProteinRec: { text: 'Lunch is light' }, smartMealText: 'Dal and curd', flexReservedCal: 900, streak: 6 });
    expect(noon.map(c => c.kind).sort()).toEqual(['flexible_prep', 'meal_suggestion', 'positive', 'protein_reminder']);
    for (const c of noon) expect(c.reason.length).toBeGreaterThan(3);
  });
  it('messages are short, plain and link free', () => {
    for (const k of ['morning_verdict', 'meal_suggestion', 'protein_reminder', 'flexible_prep', 'check_in', 'positive', 'missed_logging', 'weekly_review', 'coach_nudge'] as const) {
      const m = composeMessage(cand(k), { action: 'Add dal to lunch', smartMeal: 'Dal with curd' });
      expect(m.body.length).toBeLessThanOrEqual(140); expect(m.body).not.toMatch(/https?:|www\./);
    }
  });
});
