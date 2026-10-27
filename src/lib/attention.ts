/**
 * Needs Attention (deterministic). Takes the scored clients from the dashboard rules plus the coach's
 * snooze/dismiss actions and returns a ranked list. Nothing here is invented: every item carries the
 * rule's own reason text.
 */
import type { ClientStatus, Reason } from './coachMetrics';

export type AttentionSignal = 'logging_decline' | 'logging_stopped' | 'protein_deviation' | 'calorie_deviation' | 'energy_decline';
export interface AttentionAction { client_id: string; signal: string; action: 'snoozed' | 'dismissed'; severity: 'attention' | 'drifting'; until_at: string | null }
export interface ScoredClient { client_id: string; client_name: string; status: ClientStatus; reasons: Reason[]; last_activity: string | null }
export interface AttentionItem { client_id: string; client_name: string; priority: number; reasons: Reason[]; silent_days: number | null }

const WEIGHT = { attention: 10, drifting: 4 } as const;
const SEV_RANK = { drifting: 1, attention: 2 } as const;

/** A signal is hidden while snoozed, or after a dismissal unless it has got worse since. */
export function isSuppressed(reason: Reason, a: AttentionAction | undefined, now: Date): boolean {
  if (!a) return false;
  if (a.action === 'snoozed') return !!a.until_at && new Date(a.until_at).getTime() > now.getTime();
  return SEV_RANK[reason.severity] <= SEV_RANK[a.severity];
}

export function buildAttention(clients: ScoredClient[], actions: AttentionAction[], now: Date = new Date()): AttentionItem[] {
  const byKey = new Map(actions.map(a => [`${a.client_id}|${a.signal}`, a]));
  const out: AttentionItem[] = [];
  for (const c of clients) {
    if (c.status === 'paused' || c.status === 'on_track') continue;
    const reasons = c.reasons.filter(r => !isSuppressed(r, byKey.get(`${c.client_id}|${r.signal}`), now));
    if (!reasons.length) continue;
    const silent = c.last_activity ? Math.floor((now.getTime() - new Date(c.last_activity).getTime()) / 86_400_000) : null;
    const priority = reasons.reduce((s, r) => s + WEIGHT[r.severity], 0) + (c.status === 'no_activity' ? 6 : 0) + Math.min(silent ?? 14, 14) / 2;
    out.push({ client_id: c.client_id, client_name: c.client_name, priority, reasons, silent_days: silent });
  }
  return out.sort((a, b) => b.priority - a.priority || a.client_name.localeCompare(b.client_name));
}
