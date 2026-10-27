import type { Env } from '../_shared/auth';
import { verifyJWT, getSupabaseAdmin, preflightResponse, corsHeaders } from '../_shared/auth';

// POST /api/export-my-data  (signed-in user) -> a JSON file with everything stored about that user.
const TABLES: { table: string; col: string; select: string; filter?: [string, boolean] }[] = [
  { table: 'users',              col: 'id',      select: '*' },
  { table: 'user_profile',       col: 'user_id', select: '*' },
  { table: 'kitchen_profiles',   col: 'user_id', select: '*' },
  { table: 'daily_logs',         col: 'user_id', select: '*' },
  { table: 'water_logs',         col: 'user_id', select: '*' },
  { table: 'energy_logs',        col: 'user_id', select: '*' },
  { table: 'meal_templates',     col: 'user_id', select: '*' },
  { table: 'user_custom_foods',  col: 'user_id', select: '*' },
  { table: 'streak_data',        col: 'user_id', select: '*' },
  { table: 'subscriptions',      col: 'user_id', select: '*' },
  { table: 'payment_submissions', col: 'user_id', select: '*' },
  { table: 'food_contributions', col: 'user_id', select: '*' },
  { table: 'events',             col: 'user_id', select: 'event_name, properties, created_at' },
  { table: 'push_subscriptions', col: 'user_id', select: 'device_ua, created_at' },
  // 2.0 tables
  { table: 'client_profiles',    col: 'user_id',   select: '*' },
  { table: 'client_goals',       col: 'client_id', select: '*' },
  { table: 'nutrition_targets',  col: 'client_id', select: '*' },
  { table: 'daily_adherence',    col: 'user_id', select: '*' },
  { table: 'daily_nutrition_metrics', col: 'user_id', select: '*' },
  { table: 'timeline_events',    col: 'user_id', select: '*' },
  { table: 'flexible_meals',     col: 'user_id', select: '*' },
  { table: 'flexible_meal_events', col: 'user_id', select: '*' },
  { table: 'daily_checkins',     col: 'user_id', select: '*' },
  { table: 'meal_feelings',      col: 'user_id', select: '*' },
  { table: 'experiments',        col: 'user_id', select: '*' },
  { table: 'experiment_days',    col: 'user_id', select: '*' },
  { table: 'nudge_preferences',  col: 'user_id', select: '*' },
  { table: 'nudges',             col: 'user_id', select: 'kind, title, body, status, created_at, sent_at' },
  { table: 'weekly_metrics',     col: 'user_id', select: '*' },
  { table: 'monthly_metrics',    col: 'user_id', select: '*' },
  // Coach drafts the person has not been shown stay out; approved or self-service reviews are included.
  { table: 'ai_weekly_reviews',  col: 'user_id', select: '*', filter: ['visible_to_client', true] },
  { table: 'ai_monthly_reviews', col: 'user_id', select: '*', filter: ['visible_to_client', true] },
  { table: 'coach_profiles',     col: 'user_id', select: 'display_name, credentials, status, created_at' },
  { table: 'coach_client_relationships', col: 'client_id', select: 'id, coach_id, status, share_scope, invited_at, accepted_at, ended_at' },
];
// The same table seen from the coach side. The invite link hash is never exported.
const COACH_SIDE = { table: 'coach_client_relationships', col: 'coach_id', select: 'id, client_id, status, share_scope, invited_at, accepted_at, ended_at' };

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders(env), 'Content-Type': 'application/json' } });

  const auth = await verifyJWT(request, env);
  if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders(env), 'Content-Type': 'application/json' } });

  const admin = getSupabaseAdmin(env);
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    note: 'Everything Nutri Smart stores about your account.',
  };
  for (const t of TABLES) {
    try {
      let q = admin.from(t.table).select(t.select).eq(t.col, auth.userId);
      if (t.filter) q = q.eq(t.filter[0], t.filter[1]);
      const { data, error } = await q.limit(20000);
      if (!error) out[t.table] = data ?? [];
    } catch { /* a table that does not exist is skipped */ }
  }
  try {
    const { data } = await admin.from(COACH_SIDE.table).select(COACH_SIDE.select).eq(COACH_SIDE.col, auth.userId).limit(20000);
    if (data && data.length) out.coach_client_relationships_as_coach = data;
  } catch { /* skipped */ }
  out.not_included = 'AI reviews your coach has not shown you yet, and the internal audit log.';
  return new Response(JSON.stringify(out, null, 2), {
    status: 200,
    headers: {
      ...corsHeaders(env),
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="nutrismart-my-data.json"',
      'Cache-Control': 'no-store',
    },
  });
};
