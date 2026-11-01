import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { flagOn } from '../_shared/roles';
import { deliverNudge } from '../_shared/nudgeSend';
import { loadSnapshot, think } from '../_shared/intelServer';
import { buildCandidates, composeMessage, decide, classifyOutcome, ALL_KINDS, type NotifKind, type SentItem } from '../../src/lib/intel/notifyDecide';
import { recOutcome } from '../../src/lib/intel/recommend';
import { interventionOutcome } from '../../src/lib/intel/coachIntel';
import { addDays } from '../../src/lib/intel/dates';

// Hourly job. With the smart_notifications switch off it does nothing.
// 1) for a few opted-in people: decide which notification (if any) to send now, record WHY, send through the normal nudge pipeline
// 2) measure outcomes: notifications after 24 hours, recommendations at their follow-up date, coach messages after a week
// Small batches keep each run inside the platform's request limits; the batch rotates every hour.
const BATCH = 3;
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (!env.CRON_SECRET || request.headers.get('x-cron-secret') !== env.CRON_SECRET) return jsonResponse(env, 403, { error: 'forbidden' });
  if (!(await flagOn(env, 'smart_notifications'))) return jsonResponse(env, 200, { success: true, skipped: 'flag_off' });
  const admin = getSupabaseAdmin(env);
  const now = new Date();
  const stats = { people: 0, decisions: 0, sent: 0, deferred: 0, skipped: 0, notification_outcomes: 0, rec_outcomes: 0, message_outcomes: 0 };

  const { data: opted } = await admin.from('nudge_preferences').select('user_id, smart_kinds_off, quiet_start, quiet_end, max_per_day, channel').eq('smart_nudges', true).limit(1000);
  const hourSlot = Math.floor(now.getTime() / 3_600_000);
  const people = (opted ?? []).sort((a, b) => ((hash(a.user_id) + hourSlot) % 997) - ((hash(b.user_id) + hourSlot) % 997)).slice(0, BATCH);
  const energyOn = await flagOn(env, 'energy_intelligence');

  for (const p of people) {
    stats.people++;
    const uid = p.user_id as string;
    const snap = await loadSnapshot(admin, uid, now);
    const brief = think(snap, now, { adaptive: true, energy: energyOn });
    const { data: ds } = await admin.from('notification_decisions').select('kind, decided_at, opened_at, acted_at, dedupe_key').eq('user_id', uid).eq('decision', 'send').gte('decided_at', addDays(snap.today, -14)).limit(200);
    const { data: ns } = await admin.from('nudges').select('sent_at').eq('user_id', uid).eq('status', 'sent').neq('kind', 'smart').gte('sent_at', addDays(snap.today, -2)).limit(50);
    const history: SentItem[] = [
      ...(ds ?? []).map((d: any) => ({ kind: d.kind as NotifKind, sentAt: new Date(d.decided_at), opened: !!d.opened_at, acted: !!d.acted_at, dedupeKey: d.dedupe_key as string })),
      ...(ns ?? []).map((n: any) => ({ kind: 'coach_nudge' as NotifKind, sentAt: new Date(n.sent_at), opened: true, acted: false })),
    ];
    const hasCheckinToday = snap.rows.some(r => r.day === snap.today && (r.energy != null || r.hunger != null || r.mood != null));
    const topProtein = brief.recommendations.find(r => r.rec_key.startsWith('protein_'));
    const { data: topRow } = topProtein ? await admin.from('recommendations').select('id').eq('user_id', uid).eq('rec_key', topProtein.rec_key).eq('window_day', topProtein.window_day).maybeSingle() : { data: null };
    const cands = buildCandidates({
      now, today: snap.today, loggedToday: snap.todayTotals.meals.length > 0, loggedDays7: snap.rows.filter(r => r.day > addDays(snap.today, -7) && r.items > 0).length, streak: snap.streak, hasCheckinToday,
      topProteinRec: topProtein ? { id: topRow?.id, text: topProtein.reason } : undefined,
      smartMealText: brief.smartMeal ? `${brief.smartMeal.meal}: ${brief.smartMeal.items.map(i => i.name).join(' with ')}` : undefined,
      flexReservedCal: snap.flexReservedCal, weekday: new Date(snap.today + 'T00:00:00Z').getUTCDay(), energyIntelligence: energyOn,
    });
    const decisions = decide(cands, { now, history, prefs: { enabled: true, kindsOff: (p.smart_kinds_off ?? []).filter((k: string) => (ALL_KINDS as string[]).includes(k)), quietStart: p.quiet_start ?? 1290, quietEnd: p.quiet_end ?? 450, maxPerDay: p.max_per_day ?? 2 } });
    for (const d of decisions) {
      stats.decisions++;
      const { data: row, error } = await admin.from('notification_decisions').insert({
        user_id: uid, kind: d.kind, decision: d.decision, reason_code: d.reason_code, why: d.why, fatigue: d.fatigue, dedupe_key: d.dedupeKey, rec_id: d.recId ?? null,
      }).select('id').single();
      if (error || !row) continue;                        // already decided this moment
      if (d.decision === 'defer') { stats.deferred++; continue; }
      if (d.decision === 'skip') { stats.skipped++; continue; }
      if (p.channel === 'in_app') {               // the person chose in-app only: the decision is kept, no phone notification
        await admin.from('notification_decisions').update({ why: { ...d.why, delivery: 'in_app' } }).eq('id', row.id);
        continue;
      }
      const topRec = brief.recommendations.find(r => r.rec_key === topProtein?.rec_key);
      const msg = composeMessage(cands.find(c => c.dedupeKey === d.dedupeKey)!, { action: topRec?.action, smartMeal: brief.smartMeal ? `Try ${brief.smartMeal.items.map(i => i.name).join(' with ')} for ${brief.smartMeal.meal}.` : undefined, streak: snap.streak });
      const { data: nudge } = await admin.from('nudges').insert({ user_id: uid, kind: 'smart', title: msg.title, body: msg.body, dedupe_key: `smart:${uid}:${d.dedupeKey}` }).select('id, user_id, kind, title, body').single();
      if (!nudge) continue;
      const out = await deliverNudge(env, admin, nudge, now);
      await admin.from('notification_decisions').update({ nudge_id: nudge.id, delivered_at: out.state === 'sent' ? now.toISOString() : null, why: { ...d.why, delivery: out.state, ...(out.state === 'queued' || out.state === 'skipped' ? { delivery_reason: out.reason } : {}) } }).eq('id', row.id);
      if (out.state === 'sent') stats.sent++;
    }
  }

  // Outcomes of notifications: 24+ hours old, delivered, no outcome yet.
  const { data: old } = await admin.from('notification_decisions').select('id, user_id, decided_at, opened_at, acted_at').eq('decision', 'send').not('delivered_at', 'is', null).is('outcome', null).lt('decided_at', new Date(now.getTime() - 24 * 3_600_000).toISOString()).limit(40);
  for (const d of old ?? []) {
    const day0 = new Date(new Date(d.decided_at).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const { data: logged } = await admin.from('daily_nutrition_metrics').select('day').eq('user_id', d.user_id).gte('day', day0).lte('day', addDays(day0, 1)).gt('items', 0).limit(1);
    const o = classifyOutcome({ opened: !!d.opened_at, acted: !!d.acted_at, loggedWithin24h: !!logged?.length, hoursSince: (now.getTime() - new Date(d.decided_at).getTime()) / 3_600_000 });
    if (o) { await admin.from('notification_decisions').update({ outcome: o }).eq('id', d.id); stats.notification_outcomes++; }
  }

  // Outcomes of accepted recommendations at their follow-up date.
  const { data: due } = await admin.from('recommendations').select('id, user_id, metric').in('status', ['accepted', 'done']).is('outcome', null).not('metric', 'is', null).lte('follow_up_at', addDays(now.toISOString().slice(0, 10), 0)).limit(20);
  const snaps = new Map<string, Awaited<ReturnType<typeof loadSnapshot>>>();
  for (const r of due ?? []) {
    const m = r.metric as { feature: string; window_days: number; value: number; direction: 'up' | 'down' };
    if (!snaps.has(r.user_id)) snaps.set(r.user_id, await loadSnapshot(admin, r.user_id, now));
    const f = snaps.get(r.user_id)!.index[m.feature]?.[m.window_days];
    const res = f ? recOutcome(m, { value: f.value, sample_size: f.sample_size }) : null;
    if (res) { await admin.from('recommendations').update({ outcome: { ...res, measured_at: now.toISOString() } }).eq('id', r.id); stats.rec_outcomes++; }
  }

  // Outcomes of coach messages after a full week.
  const { data: msgs } = await admin.from('intel_messages').select('id, user_id, sent_at, reason').eq('status', 'sent').eq('sender_type', 'coach').is('outcome', null).lt('sent_at', new Date(now.getTime() - 8 * 86_400_000).toISOString()).limit(20);
  for (const m of msgs ?? []) {
    const s = snaps.get(m.user_id) ?? await loadSnapshot(admin, m.user_id, now, { food: true, energy: false });
    snaps.set(m.user_id, s);
    const o = interventionOutcome(s.rows, { at: String(m.sent_at).slice(0, 10), kind: 'message', label: m.reason }, s.today);
    if (o.status !== 'too_early') { await admin.from('intel_messages').update({ outcome: o }).eq('id', m.id); stats.message_outcomes++; }
  }
  return jsonResponse(env, 200, { success: true, ...stats });
};
