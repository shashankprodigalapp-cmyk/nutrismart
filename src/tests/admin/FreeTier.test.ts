import { describe, it, expect } from 'vitest';
import { statusFor, worst, projectToEndOfDay, pacificDayFraction, resolveLimits, buildModelMeters } from '../../../functions/_shared/freeTier';
import { outcomeFor, modelFrom, usageFrom } from '../../../functions/_shared/aiLog';

describe('free tier traffic light', () => {
  it('is ok under 70%, warn from 70%, critical from 90%', () => {
    expect(statusFor(69, 100)).toBe('ok');
    expect(statusFor(70, 100)).toBe('warn');
    expect(statusFor(89, 100)).toBe('warn');
    expect(statusFor(90, 100)).toBe('critical');
    expect(statusFor(150, 100)).toBe('critical');
  });
  it('is unknown without a usable limit or reading', () => {
    expect(statusFor(5, null)).toBe('unknown');
    expect(statusFor(5, 0)).toBe('unknown');
    expect(statusFor(null, 100)).toBe('unknown');
  });
  it('worst picks the most serious, ignoring unknown', () => {
    expect(worst(['ok', 'warn', 'unknown'])).toBe('warn');
    expect(worst(['ok', 'critical', 'warn'])).toBe('critical');
    expect(worst(['unknown', 'unknown'])).toBe('unknown');
    expect(worst(['ok', 'unknown'])).toBe('ok');
  });
  it('projects the day only after 10% has passed', () => {
    expect(projectToEndOfDay(50, 0.05)).toBeNull();
    expect(projectToEndOfDay(50, 0.5)).toBe(100);
  });
  it('pacific day fraction is between 0 and 1', () => {
    const f = pacificDayFraction(new Date('2026-10-25T12:00:00Z')); // 05:00 Pacific (PDT)
    expect(f).toBeGreaterThan(0.2); expect(f).toBeLessThan(0.22);
  });
});

describe('AI call log helpers', () => {
  it('classifies outcomes', () => {
    expect(outcomeFor(200)).toBe('ok');
    expect(outcomeFor(429)).toBe('rate_limited');
    expect(outcomeFor(500)).toBe('http_error');
    expect(outcomeFor(404)).toBe('http_error');
  });
  it('reads the model name and never the key', () => {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=SECRET';
    expect(modelFrom('gemini', url)).toBe('gemini-3.5-flash-lite');
    expect(modelFrom('claude', 'https://api.anthropic.com/v1/messages', { body: JSON.stringify({ model: 'claude-haiku-4-5' }) })).toBe('claude-haiku-4-5');
    expect(modelFrom('gemini', url)).not.toContain('SECRET');
  });
  it('reads token counts for both providers', () => {
    expect(usageFrom('gemini', { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })).toEqual({ input: 10, output: 5 });
    expect(usageFrom('claude', { usage: { input_tokens: 7, output_tokens: 3 } })).toEqual({ input: 7, output: 3 });
    expect(usageFrom('gemini', {})).toEqual({ input: undefined, output: undefined });
  });
});

describe('per-model Gemini meters', () => {
  it('fills the three models with the Google AI Studio defaults', () => {
    const l = resolveLimits(null);
    expect(l['gemini-3.5-flash-lite']).toEqual({ rpd: 500, rpm: 15 });
    expect(l['gemini-3.8-flash']).toEqual({ rpd: 20, rpm: 5 });
    expect(l['gemini-embedding-001']).toEqual({ rpd: 1000, rpm: 100 });
  });
  it('lets saved values win, and null means unknown', () => {
    const l = resolveLimits({ 'gemini-3.8-flash': { rpd: 100, rpm: null } });
    expect(l['gemini-3.8-flash']).toEqual({ rpd: 100, rpm: null });
    expect(l['gemini-3.5-flash-lite'].rpd).toBe(500);
  });
  it('turns the photo model red when a Google refusal happened', () => {
    const m = buildModelMeters([{ model: 'gemini-3.8-flash', calls: 3, limited: 1, peak_per_minute: 1 }], resolveLimits(null), 0.5);
    expect(m.find(x => x.key === 'gemini-3.8-flash:day')!.status).toBe('critical');
    expect(m.find(x => x.key === 'gemini-3.5-flash-lite:day')!.status).toBe('ok');
  });
  it('warns when the busy-minute count nears the limit', () => {
    const m = buildModelMeters([{ model: 'gemini-3.5-flash-lite', calls: 10, limited: 0, peak_per_minute: 12 }], resolveLimits(null), 0.5);
    expect(m.find(x => x.key === 'gemini-3.5-flash-lite:min')!.status).toBe('warn');
  });
  it('projects the day for a model and flags a projected overrun', () => {
    const m = buildModelMeters([{ model: 'gemini-3.8-flash', calls: 12, limited: 0, peak_per_minute: 2 }], resolveLimits(null), 0.5);
    const day = m.find(x => x.key === 'gemini-3.8-flash:day')!;
    expect(day.projected).toBe(24);
    expect(day.status).toBe('critical');
  });
  it('always returns six meters, even with no calls', () => {
    expect(buildModelMeters([], resolveLimits(null), 0.5)).toHaveLength(6);
  });
});
