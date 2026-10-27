import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, preflightResponse, jsonResponse } from '../_shared/auth';
import { audit, requireRole } from '../_shared/roles';
import { cleanText } from '../_shared/coachLogic';

// POST /api/weekly-review-decision {id, action: 'approve'|'reject'|'edit', sections?}
// Only the person's active coach. The coach stays in control: nothing reaches a coached client without this.
const LISTS = ['wins', 'challenges', 'nutrition', 'adherence', 'energy', 'flexible_meals', 'patterns', 'next_week_focus'] as const;

function cleanSections(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const item = (v: unknown) => {
    const x = (v ?? {}) as { text?: unknown; fact_ids?: unknown };
    const text = cleanText(x.text, 280);
    return text ? { text, fact_ids: Array.isArray(x.fact_ids) ? x.fact_ids.map(i => cleanText(i, 40)).slice(0, 6) : [] } : null;
  };
  const out: Record<string, unknown> = {};
  const h = item(o.headline); const c = item(o.coach_conversation);
  if (!h) return null;
  out.headline = h; out.coach_conversation = c ?? { text: '', fact_ids: [] };
  for (const k of LISTS) out[k] = (Array.isArray(o[k]) ? (o[k] as unknown[]) : []).slice(0, 6).map(item).filter(Boolean);
  return out;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const who = await requireRole(request, env, 'coach');
  if ('error' in who) return who.error;
  let body: { id?: string; action?: string; sections?: unknown; period?: string };
  try { body = await request.json(); } catch { return jsonResponse(env, 400, { error: 'invalid_json' }); }
  const id = String(body.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResponse(env, 400, { error: 'bad_id' });
  const admin = getSupabaseAdmin(env);
  const TABLE = body.period === 'month' ? 'ai_monthly_reviews' : 'ai_weekly_reviews';
  const { data: rev } = await admin.from(TABLE).select('id, user_id').eq('id', id).maybeSingle();
  const { data: rel } = rev ? await admin.from('coach_client_relationships').select('id').eq('coach_id', who.userId).eq('client_id', rev.user_id).eq('status', 'active').maybeSingle() : { data: null };
  if (!rev || !rel) return jsonResponse(env, 404, { error: 'not_found' });

  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (body.action === 'approve') patch = { status: 'approved', visible_to_client: true };
  else if (body.action === 'reject') patch = { status: 'rejected', visible_to_client: false };
  else if (body.action === 'edit') {
    const s = cleanSections(body.sections);
    if (!s) return jsonResponse(env, 400, { error: 'bad_sections', message: 'The review needs a headline.' });
    patch = { status: 'edited', visible_to_client: true, edited_sections: s };
  } else return jsonResponse(env, 400, { error: 'bad_action' });
  const { error } = await admin.from(TABLE).update({ ...patch, decided_by: who.userId, decided_at: now }).eq('id', id);
  if (error) return jsonResponse(env, 500, { error: 'save_failed' });
  await audit(env, who.userId, 'coach', `${body.period === 'month' ? 'monthly' : 'weekly'}_review_${body.action}`, rev.user_id, { review: id });
  return jsonResponse(env, 200, { ok: true });
};
