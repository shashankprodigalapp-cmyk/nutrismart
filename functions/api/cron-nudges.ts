import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { flagOn } from '../_shared/roles';
import { istDayStart, istParts, wantsLogReminder } from '../_shared/nudgeRules';
import { deliverNudge } from '../_shared/nudgeSend';

// Hourly job (GitHub schedule). With the v2_nudges switch off it does nothing.
// 1) deliver queued nudges whose quiet hours / spacing have passed   2) evening log reminders for opted-in people
export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET) return jsonResponse(env, 403, { error: 'forbidden' });
  if (!(await flagOn(env, 'v2_nudges'))) return jsonResponse(env, 200, { success: true, skipped: 'flag_off' });
  const admin = getSupabaseAdmin(env);
  const now = new Date();
  const stats = { flushed_sent: 0, still_queued: 0, expired: 0, reminders_created: 0, reminders_sent: 0 };

  const { data: queued } = await admin.from('nudges').select('id, user_id, kind, title, body, created_at').eq('status', 'queued').order('created_at').limit(100);
  for (const n of queued ?? []) {
    const maxAge = n.kind === 'log_reminder' ? 3 * 3_600_000 : 24 * 3_600_000;   // a stale reminder is worse than none
    if (now.getTime() - new Date(n.created_at).getTime() > maxAge) {
      await admin.from('nudges').update({ status: 'skipped', skip_reason: 'expired' }).eq('id', n.id); stats.expired++; continue;
    }
    const o = await deliverNudge(env, admin, n, now);
    if (o.state === 'sent') stats.flushed_sent++; else if (o.state === 'queued') stats.still_queued++;
  }

  const { hour, day } = istParts(now);
  if (hour >= 19 && hour < 21) {
    const { data: people } = await admin.from('nudge_preferences').select('user_id').eq('log_reminders', true).limit(500);
    const ids = (people ?? []).map(p => p.user_id as string);
    if (ids.length) {
      const weekAgo = new Date(istDayStart(now).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
      const { data: logs } = await admin.from('daily_logs').select('user_id, log_date').in('user_id', ids).gte('log_date', weekAgo);
      const days = new Map<string, Set<string>>();
      for (const l of logs ?? []) { const s = days.get(l.user_id as string) ?? new Set<string>(); s.add(String(l.log_date)); days.set(l.user_id as string, s); }
      for (const id of ids) {
        const s = days.get(id) ?? new Set<string>();
        if (!wantsLogReminder({ hour, loggedToday: s.has(day), loggedDaysLast7: s.size })) continue;
        const { data: row, error } = await admin.from('nudges').insert({
          user_id: id, kind: 'log_reminder', title: 'Quick reminder', body: 'Nothing logged yet today. A quick entry keeps your week on track.', dedupe_key: `log_reminder:${id}:${day}`,
        }).select('id, user_id, kind, title, body').single();
        if (error || !row) continue;   // unique key: already reminded today
        stats.reminders_created++;
        const o = await deliverNudge(env, admin, row, now);
        if (o.state === 'sent') stats.reminders_sent++;
        else if (o.state === 'queued') await admin.from('nudges').update({ status: 'skipped', skip_reason: o.reason }).eq('id', row.id);
      }
    }
  }
  return jsonResponse(env, 200, { success: true, ...stats });
};
