import { describe, it, expect } from 'vitest';
import { summarize, band, fillDays, type AdherenceRow } from '../../lib/adherenceView';

const row = (day: string, p: Partial<AdherenceRow> = {}): AdherenceRow => ({
  day, calorie_adherence: 100, protein_adherence: 80, fat_adherence: 100, macro_adherence: 90, logging_adherence: 100, checkin_adherence: 0, ...p,
});

describe('summarize', () => {
  it('averages only days that have scores, and counts logging against the whole window', () => {
    const s = summarize([row('2026-10-20'), row('2026-10-21', { protein_adherence: 60 }), row('2026-10-22', { calorie_adherence: null, protein_adherence: null, macro_adherence: null, logging_adherence: 0 })], 7);
    expect(s.protein).toBe(70); expect(s.loggedDays).toBe(2); expect(s.logging).toBe(28.6); expect(s.days).toBe(7);
  });
  it('returns nulls, not zeros, when there is no data', () => {
    const s = summarize([], 7);
    expect(s.calorie).toBeNull(); expect(s.logging).toBe(0); expect(s.loggedDays).toBe(0);
  });
  it('counts check-in days', () => { expect(summarize([row('2026-10-20', { checkin_adherence: 100 })], 7).checkinDays).toBe(1); });
});

describe('band', () => {
  it('maps scores to bands', () => {
    expect(band(95)).toBe('good'); expect(band(80)).toBe('good'); expect(band(60)).toBe('fair'); expect(band(10)).toBe('low'); expect(band(null)).toBe('none');
  });
});

describe('fillDays', () => {
  it('returns every day oldest first with empty days filled', () => {
    const d = fillDays([row('2026-10-26')], '2026-10-27', 3);
    expect(d.map(x => x.day)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27']);
    expect(d[0].logging_adherence).toBe(0); expect(d[1].logging_adherence).toBe(100);
  });
});
