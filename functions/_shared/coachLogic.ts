// Pure helpers for the 2.0 coach/client links. No network, no database: easy to test.

export const SCOPES = ['food', 'energy', 'water', 'weight', 'mood'] as const;
export type Scope = typeof SCOPES[number];
export type ShareScope = Record<Scope, boolean>;

export const DEFAULT_SCOPE: ShareScope = { food: true, energy: true, water: true, weight: true, mood: true };
export const INVITE_DAYS = 14;

/** Keep only known switches, force booleans. Unknown keys are dropped; missing keys fall back to the default. */
export function normalizeScope(input: unknown): ShareScope {
  const out = { ...DEFAULT_SCOPE };
  if (input && typeof input === 'object') {
    for (const k of SCOPES) {
      const v = (input as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

export function cleanText(v: unknown, max: number): string {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export type InviteProblem = 'not_found' | 'expired' | 'used' | 'own_invite' | null;

export function inviteProblem(
  row: { status: string; invite_expires_at: string | null; coach_id: string } | null,
  viewerId: string,
  now: Date = new Date(),
): InviteProblem {
  if (!row) return 'not_found';
  if (row.coach_id === viewerId) return 'own_invite';
  if (row.status !== 'invited') return 'used';
  if (!row.invite_expires_at || new Date(row.invite_expires_at).getTime() < now.getTime()) return 'expired';
  return null;
}

export type RelAction = 'pause' | 'resume' | 'end';

/** Who may change a link, and to what. A coach cannot resume a link the client paused. */
export function allowedTransition(
  status: string,
  action: RelAction,
  actor: 'coach' | 'client',
): string | null {
  if (action === 'end') return status === 'ended' || status === 'declined' ? null : 'ended';
  if (action === 'pause') return actor === 'client' && status === 'active' ? 'paused' : null;
  if (action === 'resume') return actor === 'client' && status === 'paused' ? 'active' : null;
  return null;
}

export function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}
export function newInviteToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
