import { describe, it, expect } from 'vitest';
import { statusFor, worst, projectToEndOfDay, pacificDayFraction } from '../../../functions/_shared/freeTier';
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
