import { describe, it, expect } from 'vitest';
import { normalizeScope, DEFAULT_SCOPE, cleanText, inviteProblem, allowedTransition, sha256Hex, newInviteToken } from '../../../functions/_shared/coachLogic';

describe('normalizeScope', () => {
  it('defaults to everything shared when nothing is given', () => { expect(normalizeScope(undefined)).toEqual(DEFAULT_SCOPE); });
  it('keeps real booleans and ignores junk and unknown keys', () => {
    const s = normalizeScope({ food: false, energy: 'no', admin: true, water: true });
    expect(s.food).toBe(false); expect(s.energy).toBe(true); expect((s as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe('cleanText', () => {
  it('strips control characters, collapses spaces, and caps length', () => {
    expect(cleanText('  Dr.\u0000  Rao \n Nutrition  ', 80)).toBe('Dr. Rao Nutrition');
    expect(cleanText('x'.repeat(500), 10)).toHaveLength(10);
    expect(cleanText(null, 10)).toBe('');
  });
});

describe('inviteProblem', () => {
  const ok = { status: 'invited', invite_expires_at: new Date(Date.now() + 86_400_000).toISOString(), coach_id: 'coach' };
  it('accepts a fresh invite from someone else', () => { expect(inviteProblem(ok, 'client')).toBeNull(); });
  it('rejects missing, expired, used and own invites', () => {
    expect(inviteProblem(null, 'client')).toBe('not_found');
    expect(inviteProblem({ ...ok, invite_expires_at: new Date(Date.now() - 1000).toISOString() }, 'client')).toBe('expired');
    expect(inviteProblem({ ...ok, status: 'active' }, 'client')).toBe('used');
    expect(inviteProblem(ok, 'coach')).toBe('own_invite');
  });
  it('treats an invite with no expiry as expired (fail closed)', () => { expect(inviteProblem({ ...ok, invite_expires_at: null }, 'client')).toBe('expired'); });
});

describe('allowedTransition', () => {
  it('lets only the client pause and resume', () => {
    expect(allowedTransition('active', 'pause', 'client')).toBe('paused');
    expect(allowedTransition('active', 'pause', 'coach')).toBeNull();
    expect(allowedTransition('paused', 'resume', 'client')).toBe('active');
    expect(allowedTransition('paused', 'resume', 'coach')).toBeNull();
  });
  it('lets both sides end a live link, but not an already-ended one', () => {
    expect(allowedTransition('active', 'end', 'coach')).toBe('ended');
    expect(allowedTransition('invited', 'end', 'coach')).toBe('ended');
    expect(allowedTransition('ended', 'end', 'client')).toBeNull();
  });
});

describe('invite tokens', () => {
  it('are long, url-safe and unique; hashes are stable', async () => {
    const a = newInviteToken(); const b = newInviteToken();
    expect(a).not.toBe(b); expect(a.length).toBeGreaterThanOrEqual(30); expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
