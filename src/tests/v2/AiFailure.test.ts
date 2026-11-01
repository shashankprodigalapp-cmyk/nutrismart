import { describe, it, expect } from 'vitest';
import { aiFailure } from '../../../functions/_shared/foodQuery';
describe('AI search failure messages tell the person what to do', () => {
  it('busy, unavailable, slow and unclear are told apart', () => {
    expect(aiFailure('gemini_http_429: quota').kind).toBe('busy');
    expect(aiFailure('gemini_http_403: key').kind).toBe('unavailable');
    expect(aiFailure('gemini_http_404: model').kind).toBe('unavailable');
    expect(aiFailure('gemini_http_503: x').kind).toBe('slow');
    expect(aiFailure('exception: aborted').kind).toBe('slow');
    expect(aiFailure('validation_failed: x').kind).toBe('unclear');
    expect(aiFailure(undefined).kind).toBe('unclear');
  });
  it('every message says the search was not used when the fault is ours, and never shows internal notes', () => {
    for (const r of ['gemini_http_429: secret-key=abc', 'gemini_http_403: x', 'exception: y']) { const m = aiFailure(r).message; expect(m).toMatch(/not used/); expect(m).not.toMatch(/gemini|http|key/i); }
  });
});
