import type { SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './auth';
import { sendWebPush } from './webPush';
import { DEFAULT_PREFS, decideNudge, istDayStart, type NudgePrefs } from './nudgeRules';

export interface NudgeRow { id: string; user_id: string; kind: 'log_reminder' | 'coach_message'; title: string; body: string }
export type Outcome = { state: 'sent' } | { state: 'queued'; reason: string } | { state: 'skipped'; reason: string } | { state: 'failed' };

/** Applies the rules, then sends. Updates the nudge row with what happened and why. */
export async function deliverNudge(env: Env, admin: SupabaseClient, n: NudgeRow, now: Date = new Date()): Promise<Outcome> {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { state: 'queued', reason: 'push_not_configured' };
  const [{ data: p }, { data: subs }, { data: today }, { data: last }] = await Promise.all([
    admin.from('nudge_preferences').select('log_reminders, coach_nudges, quiet_start, quiet_end, max_per_day').eq('user_id', n.user_id).maybeSingle(),
    admin.from('push_subscriptions').select('endpoint, p256dh, auth_key').eq('user_id', n.user_id),
    admin.from('nudges').select('id').eq('user_id', n.user_id).eq('status', 'sent').gte('sent_at', istDayStart(now).toISOString()),
    admin.from('nudges').select('sent_at').eq('user_id', n.user_id).eq('status', 'sent').order('sent_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const prefs: NudgePrefs = { ...DEFAULT_PREFS, ...(p ?? {}) };
  const d = decideNudge({ kind: n.kind, now, prefs, sentToday: today?.length ?? 0, lastSentAt: last?.sent_at ? new Date(last.sent_at) : null, hasDevice: !!subs?.length });
  if (!d.ok) {
    if (d.wait) return { state: 'queued', reason: d.reason };
    await admin.from('nudges').update({ status: 'skipped', skip_reason: d.reason }).eq('id', n.id);
    return { state: 'skipped', reason: d.reason };
  }
  let ok = false;
  for (const s of subs ?? []) {
    try {
      const r = await sendWebPush(env, s, { title: n.title, body: n.body, tag: `nudge-${n.id.slice(0, 8)}`, url: '/app' });
      if (r.ok) ok = true;
      else if (r.status === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    } catch { /* try the next device */ }
  }
  await admin.from('nudges').update(ok ? { status: 'sent', sent_at: now.toISOString(), skip_reason: null } : { status: 'failed', skip_reason: 'push_failed' }).eq('id', n.id);
  return ok ? { state: 'sent' } : { state: 'failed' };
}
