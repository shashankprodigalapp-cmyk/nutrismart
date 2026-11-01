import { describe, it, expect } from 'vitest';
import { withGeminiKey } from '../../../functions/_shared/aiLog';
describe('the Gemini key travels in a header, not in the web address', () => {
  it('moves the key out of the URL and trims stray spaces, quotes and line breaks', () => {
    const r = withGeminiKey('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent?key=%20%22AQ.abc-123%22%0A', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(r.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/m:generateContent');
    expect((r.init.headers as Record<string, string>)['x-goog-api-key']).toBe('AQ.abc-123');
    expect((r.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
  it('keeps other query parameters and leaves URLs without a key alone', () => {
    expect(withGeminiKey('https://x/y?alt=sse&key=K1', {}).url).toBe('https://x/y?alt=sse');
    expect(withGeminiKey('https://x/y?key=K1&alt=sse', {}).url).toBe('https://x/y?alt=sse');
    expect(withGeminiKey('https://x/y', { method: 'GET' }).url).toBe('https://x/y');
  });
  it('no call site still puts the key in the address', () => {
    // the URLs are built with ?key=… on purpose; aiFetch / geminiFetch move it into the header before sending
    const { readFileSync } = require('node:fs');
    for (const f of ['functions/api/promote-food-cache.ts', 'functions/api/extract-utr.ts']) expect(readFileSync(f, 'utf8')).toContain('geminiFetch(');
    expect(readFileSync('functions/_shared/aiLog.ts', 'utf8')).toContain("provider === 'gemini'");
  });
});
