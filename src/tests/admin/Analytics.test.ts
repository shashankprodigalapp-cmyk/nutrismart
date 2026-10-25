import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) }, from: vi.fn() } }));

const { cleanMessage, cleanTag, osFrom } = await import('../../lib/analytics');

describe('analytics helpers', () => {
  it('removes links, emails and long numbers from error messages', () => {
    expect(cleanMessage('Failed to fetch https://x.co/a?token=abc')).toBe('Failed to fetch <url>');
    expect(cleanMessage('bad user a.b+c@mail.com')).toBe('bad user <email>');
    expect(cleanMessage('id 1234567890 broke')).toBe('id <n> broke');
  });
  it('limits a message to 120 characters and handles empty input', () => {
    expect(cleanMessage('x'.repeat(500)).length).toBe(120);
    expect(cleanMessage(undefined)).toBe('');
  });
  it('keeps a source tag short and safe', () => {
    expect(cleanTag('Instagram Story!')).toBe('instagramstory');
    expect(cleanTag('a'.repeat(80)).length).toBe(30);
  });
  it('reads the phone type from the browser text', () => {
    expect(osFrom('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('android');
    expect(osFrom('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(osFrom('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac');
    expect(osFrom('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(osFrom('curl/8')).toBe('other');
  });
});
