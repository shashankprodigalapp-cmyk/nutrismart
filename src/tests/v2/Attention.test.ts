import { describe, it, expect } from 'vitest';
import { buildAttention, isSuppressed, type ScoredClient, type AttentionAction } from '../../lib/attention';

const now = new Date('2026-10-27T10:00:00Z');
const r = (signal: string, severity: 'attention' | 'drifting') => ({ signal, severity, text: signal });
const c = (id: string, status: ScoredClient['status'], reasons: ScoredClient['reasons'], last = '2026-10-26T10:00:00Z'): ScoredClient => ({ client_id: id, client_name: id, status, reasons, last_activity: last });

describe('buildAttention', () => {
  it('skips on-track and paused clients', () => {
    expect(buildAttention([c('a', 'on_track', []), c('b', 'paused', [])], [], now)).toEqual([]);
  });
  it('ranks by severity and reason count', () => {
    const list = buildAttention([
      c('mild', 'drifting', [r('protein_deviation', 'drifting')]),
      c('bad', 'attention', [r('logging_decline', 'attention'), r('protein_deviation', 'attention')]),
    ], [], now);
    expect(list.map(i => i.client_id)).toEqual(['bad', 'mild']);
  });
  it('silent clients rank above equally flagged active ones', () => {
    const list = buildAttention([
      c('active', 'attention', [r('logging_decline', 'attention')], '2026-10-27T08:00:00Z'),
      c('silent', 'no_activity', [r('logging_stopped', 'attention')], '2026-10-10T08:00:00Z'),
    ], [], now);
    expect(list[0].client_id).toBe('silent');
  });
  it('a snooze hides a signal until it ends', () => {
    const a: AttentionAction = { client_id: 'x', signal: 'logging_decline', action: 'snoozed', severity: 'attention', until_at: '2026-10-30T00:00:00Z' };
    expect(buildAttention([c('x', 'attention', [r('logging_decline', 'attention')])], [a], now)).toEqual([]);
    expect(buildAttention([c('x', 'attention', [r('logging_decline', 'attention')])], [a], new Date('2026-10-31T00:00:00Z'))).toHaveLength(1);
  });
  it('a dismissal stays hidden unless the signal gets worse', () => {
    const a: AttentionAction = { client_id: 'x', signal: 'protein_deviation', action: 'dismissed', severity: 'drifting', until_at: null };
    expect(isSuppressed(r('protein_deviation', 'drifting'), a, now)).toBe(true);
    expect(isSuppressed(r('protein_deviation', 'attention'), a, now)).toBe(false);
  });
  it('only the dismissed signal is hidden; other signals still show', () => {
    const a: AttentionAction = { client_id: 'x', signal: 'protein_deviation', action: 'dismissed', severity: 'drifting', until_at: null };
    const list = buildAttention([c('x', 'drifting', [r('protein_deviation', 'drifting'), r('calorie_deviation', 'drifting')])], [a], now);
    expect(list[0].reasons.map(x => x.signal)).toEqual(['calorie_deviation']);
  });
});
