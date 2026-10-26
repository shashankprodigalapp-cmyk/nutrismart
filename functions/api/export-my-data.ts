import type { Env } from '../_shared/auth';
import { verifyJWT, getSupabaseAdmin, preflightResponse, corsHeaders } from '../_shared/auth';

// POST /api/export-my-data  (signed-in user) -> a JSON file with everything stored about that user.
const TABLES: { table: string; col: string; select: string }[] = [
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
];

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return preflightResponse(env);
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...corsHeaders(env), 'Content-Type': 'application/json' } });

  const auth = await verifyJWT(request, env);
  if (!auth) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders(env), 'Content-Type': 'application/json' } });

  const admin = getSupabaseAdmin(env);
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    note: 'Everything NutriSmart stores about your account.',
  };
  for (const t of TABLES) {
    try {
      const { data, error } = await admin.from(t.table).select(t.select).eq(t.col, auth.userId).limit(20000);
      if (!error) out[t.table] = data ?? [];
    } catch { /* a table that does not exist is skipped */ }
  }
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
