import type { Env } from '../_shared/auth';
import { getSupabaseAdmin, verifyJWT, preflightResponse, jsonResponse } from '../_shared/auth';
import { aiFetch } from '../_shared/aiLog';
import { audit, flagOn } from '../_shared/roles';
import {
  MIN_LOGGED_DAYS_FOR_AI, aiAcceptable, monthify, monthifyFacts, monthifySections, buildAiContext, buildFacts, buildPrompt, confidenceFor, hashFacts, normalizeRow, ruleSections, validateAi,
  type Sections,
} from '../_shared/weeklyReview';

// POST /api/weekly-review {client_id?, period?: 'week'|'month', week: 'last'|'current', refresh?}
// A person may ask for their own review; an active coach may ask for a client who shares food data.
// The review is cached per (person, week). The AI is called only when the facts changed, there is enough data,
// and the person has not used up the daily limit. Otherwise the plain-wording review is used.

const MODEL = 'gemini-3.5-flash-lite';
const mondayOf = (d: Date) => { const t = new Date(d.toISOString().slice(0, 10) + 'T00:00:00Z'); return new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000); };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return jsonResponse(env, 405, { error: 'method_not_allowed' });
  const auth = await verifyJWT(request, env);
  if (!auth) return jsonResponse(env, 401, { error: 'unauthorized' });
  let body: { client_id?: string; week?: string; period?: string; refresh?: boolean } = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const month = body.period === 'month';
  if (!(await flagOn(env, month ? 'v2_monthly_review' : 'v2_weekly_review'))) return jsonResponse(env, 403, { error: 'weekly_review_off', message: `${month ? 'Monthly' : 'Weekly'} reviews are not switched on yet.` });

  const TABLE = month ? 'ai_monthly_reviews' : 'ai_weekly_reviews';
  const DATECOL = month ? 'month_start' : 'week_start';
  const RPC = month ? 'compute_monthly_metrics' : 'compute_weekly_metrics';
  const FKCOL = month ? 'monthly_review_id' : 'review_id';
  const admin = getSupabaseAdmin(env);
  const subject = body.client_id && body.client_id !== auth.userId ? String(body.client_id) : auth.userId;
  const asCoach = subject !== auth.userId;
  if (!/^[0-9a-f-]{36}$/i.test(subject)) return jsonResponse(env, 400, { error: 'bad_id' });

  if (asCoach) {
    const { data: rel } = await admin.from('coach_client_relationships').select('share_scope, status').eq('coach_id', auth.userId).eq('client_id', subject).eq('status', 'active').maybeSingle();
    const { data: cp } = await admin.from('coach_profiles').select('status').eq('user_id', auth.userId).maybeSingle();
    if (!rel || cp?.status !== 'active' || !rel.share_scope?.food) return jsonResponse(env, 404, { error: 'not_found' });
  }

  const todayIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const thisMonday = mondayOf(new Date(Date.UTC(todayIst.getFullYear(), todayIst.getMonth(), todayIst.getDate())));
  const firstOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 1));
  const thisMonth = firstOfMonth(todayIst.getFullYear(), todayIst.getMonth());
  const weekStartDate = month
    ? (body.week === 'current' ? thisMonth : firstOfMonth(thisMonth.getUTCFullYear(), thisMonth.getUTCMonth() - 1))
    : (body.week === 'current' ? thisMonday : new Date(thisMonday.getTime() - 7 * 86_400_000));
  const prevStartDate = month ? firstOfMonth(weekStartDate.getUTCFullYear(), weekStartDate.getUTCMonth() - 1) : new Date(weekStartDate.getTime() - 7 * 86_400_000);
  const periodEnd = month ? new Date(firstOfMonth(weekStartDate.getUTCFullYear(), weekStartDate.getUTCMonth() + 1).getTime() - 86_400_000) : new Date(weekStartDate.getTime() + 6 * 86_400_000);
  const weekStart = iso(weekStartDate);

  try {
    const [curR, prevR] = await Promise.all([
      admin.rpc(RPC, month ? { p_user: subject, p_month_start: weekStart } : { p_user: subject, p_week_start: weekStart }),
      admin.rpc(RPC, month ? { p_user: subject, p_month_start: iso(prevStartDate) } : { p_user: subject, p_week_start: iso(prevStartDate) }),
    ]);
    const fix = (r: unknown) => (month && r ? { ...(r as Record<string, unknown>), week_start: (r as Record<string, unknown>).month_start } : r) as Record<string, unknown>;
    const cur = normalizeRow(fix(curR.data));
    if (curR.error || !cur) return jsonResponse(env, 500, { error: 'metrics_failed', message: 'Could not work out this week. Try again.' });
    const prev = prevR.data && (prevR.data as { days_logged?: number }).days_logged ? normalizeRow(fix(prevR.data)) : null;

    const { data: u } = await admin.from('users').select('target_cal, target_protein').eq('id', subject).maybeSingle();
    const { data: nt } = await admin.from('nutrition_targets').select('calories, protein_g').eq('client_id', subject).is('effective_to', null).order('effective_from', { ascending: false }).limit(1).maybeSingle();
    const targets = { calories: nt?.calories ?? u?.target_cal ?? null, protein: nt?.protein_g ?? u?.target_protein ?? null };
    const { data: cprof } = await admin.from('client_profiles').select('goal_type').eq('user_id', subject).maybeSingle();

    const facts = month ? monthifyFacts(buildFacts(cur, prev, targets)) : buildFacts(cur, prev, targets);
    const hash = await hashFacts(facts, month ? 'm1' : 'v1');
    const { data: existing } = await admin.from(TABLE).select('*').eq('user_id', subject).eq(DATECOL, weekStart).maybeSingle();
    const { data: link } = await admin.from('coach_client_relationships').select('id').eq('client_id', subject).eq('status', 'active').limit(1).maybeSingle();
    const hasCoach = !!link;

    const reply = (rev: Record<string, unknown>) => {
      const mine = !asCoach && !rev.visible_to_client;
      if (mine) return jsonResponse(env, 200, { pending_coach: true, message: 'Your coach is reviewing your week. You will see it once they approve it.' });
      const sections = (rev.status === 'edited' && rev.edited_sections) ? rev.edited_sections : rev.sections;
      return jsonResponse(env, 200, { review: { id: rev.id, week_start: rev[DATECOL], period: month ? 'month' : 'week', status: rev.status, source: rev.source, sections, generated_at: rev.generated_at, facts: rev.facts, days_logged: cur.days_logged, days_elapsed: cur.days_elapsed } });
    };

    if (existing && existing.data_hash === hash) {
      const recent = Date.now() - new Date(existing.generated_at).getTime() < 3_600_000;
      if (!body.refresh || recent) return reply(existing);
    }

    // Build the review: rules first, AI wording only when allowed and it passes the checks.
    const fallback = month ? monthifySections(ruleSections(facts, cur)) : ruleSections(facts, cur);
    let sections: Sections = fallback; let source: 'ai' | 'rules' = 'rules';
    if (cur.days_logged >= MIN_LOGGED_DAYS_FOR_AI && env.GEMINI_API_KEY && (await flagOn(env, 'v2_ai_reviews'))) {
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      const { count } = await admin.from(TABLE).select('id', { count: 'exact', head: true }).eq('user_id', subject).eq('source', 'ai').gte('generated_at', dayAgo);
      if ((count ?? 0) < 3) {
        try {
          const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 15_000);
          const res = await aiFetch(env, 'review', 'gemini', `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
            body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: month ? monthify(buildPrompt(buildAiContext(facts, cur, cprof?.goal_type ?? null))) : buildPrompt(buildAiContext(facts, cur, cprof?.goal_type ?? null)) }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 1200, responseMimeType: 'application/json' } }),
          });
          clearTimeout(timer);
          if (res.ok) {
            const j = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
            const text = j.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
            const v = validateAi(JSON.parse(text), facts, fallback);
            if (aiAcceptable(v.kept, v.dropped)) { sections = v.sections; source = 'ai'; }
          }
        } catch { /* fall back to rules; the failure is already in ai_call_log when a call was made */ }
      }
    }

    // Keep an earlier decision only if the facts are unchanged (they are not, here), so a changed week returns to draft.
    const row = {
      user_id: subject, [DATECOL]: weekStart, data_hash: hash, source, status: 'draft', visible_to_client: !hasCoach,
      facts, sections, edited_sections: null, model: source === 'ai' ? MODEL : null, generated_at: new Date().toISOString(), decided_by: null, decided_at: null,
    };
    const { data: saved, error } = await admin.from(TABLE).upsert(row, { onConflict: `user_id,${DATECOL}` }).select('*').single();
    if (error || !saved) return jsonResponse(env, 500, { error: 'save_failed' });

    // Insights with their evidence, replacing the previous set for this review.
    await admin.from('ai_insights').delete().eq(FKCOL, saved.id);
    const conf = confidenceFor(cur.days_logged);
    const factById = new Map(facts.map(f => [f.id, f]));
    const ins = [...sections.wins, ...sections.challenges].slice(0, 6).map(it => ({
      user_id: subject, [FKCOL]: saved.id, insight: it.text,
      evidence: it.fact_ids.map(id => ({ fact_id: id, metric: factById.get(id)?.metric, text: factById.get(id)?.text })),
      source_metric: factById.get(it.fact_ids[0])?.metric ?? 'logging_adherence', period_start: weekStart, period_end: iso(periodEnd), confidence: conf,
    }));
    if (ins.length) await admin.from('ai_insights').insert(ins);
    await audit(env, auth.userId, asCoach ? 'coach' : 'client', month ? 'monthly_review_generated' : 'weekly_review_generated', subject, { week_start: weekStart, source });
    return reply(saved);
  } catch (err) {
    console.error('[weekly-review] error', err instanceof Error ? err.message : 'unknown');
    return jsonResponse(env, 500, { error: 'internal_error', message: 'Could not prepare the review. Try again in a minute.' });
  }
};
