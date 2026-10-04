/**
 * CommunityPercentile.test.ts — Module 15 (community gamification)
 *
 * Tests the contracts of get_user_percentile and verdict percentile appending:
 *   1. Returns sufficient:false when active_users < 20
 *   2. Returns sufficient:false when the user has no logs for that date
 *   3. Returns valid rank when community is large enough
 *   4. better_than is always [0, 100]
 *   5. Below-median ranks (better_than < 50) are suppressed from the verdict text
 *   6. Both A/B variant copy lines include the percentile number
 */

import { describe, it, expect } from 'vitest';

// ── Pure re-implementation of get_user_percentile logic ───────────────────
// Mirrors the SQL function's return contract without needing a DB.

interface UserGLDay {
  user_id:  string;
  total_gl: number;
}

interface PercentileResult {
  sufficient:   boolean;
  reason?:      string;
  date?:        string;
  user_gl?:     number;
  better_than?: number;
  active_users?: number;
}

const MIN_COMMUNITY = 20;

function computePercentile(
  userId:    string,
  userGL:    number | null,
  community: UserGLDay[],
): PercentileResult {
  if (userGL === null) return { sufficient: false, reason: 'no_user_data' };
  if (community.length < MIN_COMMUNITY) return { sufficient: false, reason: 'community_too_small' };

  const betterThan = Math.round(
    100 * community.filter(u => u.total_gl > userGL).length / community.length
  );
  return {
    sufficient:   true,
    date:         '2026-07-12',
    user_gl:      userGL,
    better_than:  betterThan,
    active_users: community.length,
  };
}

// ── Verdict copy appending logic ───────────────────────────────────────────

function appendCommunityNote(
  suggestion: string,
  pct:        PercentileResult | null,
  variant:    'scientific' | 'coaching',
): string {
  if (!pct?.sufficient || typeof pct.better_than !== 'number' || pct.better_than < 50) {
    return suggestion;   // suppress below-median + insufficient
  }
  const note = variant === 'scientific'
    ? `Yesterday's GL placed you ahead of ${pct.better_than}% of NutriSmart users.`
    : `And here's the kicker — you ate better than ${pct.better_than}% of the community. 👏`;
  return `${suggestion} ${note}`;
}

// ── Community fixture ──────────────────────────────────────────────────────

function makeCommunity(n: number, spread = 100): UserGLDay[] {
  return Array.from({ length: n }, (_, i) => ({
    user_id:  `user-${i}`,
    total_gl: Math.round((i / n) * spread),
  }));
}

describe('CommunityPercentile — get_user_percentile contracts', () => {
  it('returns sufficient:false when community < 20 users', () => {
    const result = computePercentile('u1', 30, makeCommunity(15));
    expect(result.sufficient).toBe(false);
    expect(result.reason).toBe('community_too_small');
  });

  it('returns sufficient:false when user has no logs', () => {
    const result = computePercentile('u1', null, makeCommunity(25));
    expect(result.sufficient).toBe(false);
    expect(result.reason).toBe('no_user_data');
  });

  it('returns valid rank for exactly 20 active users', () => {
    const result = computePercentile('u1', 30, makeCommunity(20, 100));
    expect(result.sufficient).toBe(true);
    expect(result.active_users).toBe(20);
    expect(typeof result.better_than).toBe('number');
  });

  it('better_than is always within [0, 100]', () => {
    const community = makeCommunity(50, 100);
    for (const gl of [0, 10, 50, 90, 100]) {
      const r = computePercentile('u1', gl, community);
      if (r.sufficient) {
        expect(r.better_than).toBeGreaterThanOrEqual(0);
        expect(r.better_than).toBeLessThanOrEqual(100);
      }
    }
  });

  it('user with the lowest GL has better_than close to 100%', () => {
    const community = makeCommunity(50, 100); // GLs from 0 to ~98
    const result = computePercentile('u1', 0, community);
    expect(result.better_than).toBeGreaterThan(90);
  });

  it('user with the highest GL has better_than close to 0%', () => {
    const community = makeCommunity(50, 100);
    const result = computePercentile('u1', 200, community);
    expect(result.better_than).toBe(0);
  });
});

describe('CommunityPercentile — verdict copy suppression', () => {
  const base = 'Yesterday was steady.';
  const goodPct: PercentileResult = {
    sufficient: true, date: '2026-07-12',
    user_gl: 20, better_than: 75, active_users: 50,
  };

  it('appends scientific copy when better_than >= 50', () => {
    const out = appendCommunityNote(base, goodPct, 'scientific');
    expect(out).toContain('75%');
    expect(out).toContain('NutriSmart users');
  });

  it('appends coaching copy when better_than >= 50', () => {
    const out = appendCommunityNote(base, goodPct, 'coaching');
    expect(out).toContain('75%');
    expect(out).toContain('👏');
  });

  it('suppresses community note when better_than < 50 (below-median)', () => {
    const belowMedian = { ...goodPct, better_than: 30 };
    const out = appendCommunityNote(base, belowMedian, 'scientific');
    expect(out).toBe(base);  // no addition
    expect(out).not.toContain('%');
  });

  it('suppresses when sufficient:false', () => {
    const out = appendCommunityNote(base, { sufficient: false }, 'coaching');
    expect(out).toBe(base);
  });

  it('suppresses when pct is null', () => {
    const out = appendCommunityNote(base, null, 'scientific');
    expect(out).toBe(base);
  });

  it('exactly-50% rank is included (boundary)', () => {
    const exactly50 = { ...goodPct, better_than: 50 };
    const out = appendCommunityNote(base, exactly50, 'scientific');
    expect(out).toContain('50%');
  });
});
