import { createClient } from '@supabase/supabase-js';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(
      `[tests-integration] Missing required env var ${name}. See tests-integration/README.md for setup.`,
    );
  }
  return val;
}

export const BASE_URL = process.env.BASE_URL ?? 'https://nutrismart-3bb.pages.dev';

/**
 * Logs in the dedicated integration-test Supabase user and returns a
 * bearer token usable against the live /api/* endpoints. Never use a
 * real person's credentials here.
 */
export async function getTestUserToken(): Promise<string> {
  const url = requireEnv('VITE_SUPABASE_URL');
  const anonKey = requireEnv('VITE_SUPABASE_ANON_KEY');
  const email = requireEnv('TEST_USER_EMAIL');
  const password = requireEnv('TEST_USER_PASSWORD');

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`[tests-integration] Could not log in test user: ${error?.message}`);
  }
  return data.session.access_token;
}
