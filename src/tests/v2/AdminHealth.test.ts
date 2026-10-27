import { describe, it, expect } from 'vitest';
import { healthChecks, overall } from '../../lib/adminHealth';

const find = (m: Parameters<typeof healthChecks>[0], id: string) => healthChecks(m).find(c => c.id === id)!;

describe('healthChecks', () => {
  it('says unknown with too little data', () => {
    expect(find({ ai_7d: { calls: 3, failures: 3 } }, 'ai').level).toBe('unknown');
    expect(find({}, 'push').level).toBe('unknown');
  });
  it('grades the AI failure rate', () => {
    expect(find({ ai_7d: { calls: 100, failures: 2 } }, 'ai').level).toBe('ok');
    expect(find({ ai_7d: { calls: 100, failures: 15 } }, 'ai').level).toBe('warn');
    expect(find({ ai_7d: { calls: 100, failures: 40 } }, 'ai').level).toBe('critical');
    expect(find({ ai_7d: { calls: 100, failures: 15 } }, 'ai').detail).toBe('15 of 100 calls failed in 7 days (15%).');
  });
  it('grades notification failures', () => {
    expect(find({ notifications_7d: { sent: 95, failed: 5 } }, 'push').level).toBe('ok');
    expect(find({ notifications_7d: { sent: 60, failed: 40 } }, 'push').level).toBe('critical');
  });
  it('warns on stuck nudges, waiting reviews and unverified foods', () => {
    expect(find({ notifications_7d: { stuck_queued: 2 } }, 'queue').level).toBe('warn');
    expect(find({ reviews_7d: { waiting_for_coach: 12 } }, 'reviews').level).toBe('warn');
    expect(find({ food_database: { unverified: 80 } }, 'foods').level).toBe('warn');
    expect(find({}, 'queue').level).toBe('ok');
  });
  it('overall is the worst level', () => {
    expect(overall(healthChecks({ ai_7d: { calls: 100, failures: 40 } }))).toBe('critical');
    expect(overall(healthChecks({ notifications_7d: { stuck_queued: 1 } }))).toBe('warn');
    expect(overall(healthChecks({}))).toBe('ok');
    expect(overall([{ id: 'a', name: 'a', level: 'unknown', detail: '' }])).toBe('unknown');
  });
});
