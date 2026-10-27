import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from '../context/AuthContext';

export interface Roles { client: boolean; coach: boolean; coach_pending: boolean; admin: boolean }
export interface RolesState { loading: boolean; roles: Roles; coachEnabled: boolean; coachSignupOpen: boolean }

const NONE: Roles = { client: true, coach: false, coach_pending: false, admin: false };

/**
 * Roles and 2.0 switches, read from the database (never from the browser's own claim).
 * This only decides what to show. The server and row-level security enforce access.
 */
export function useRoles(): RolesState {
  const { user } = useAuth();
  const [state, setState] = useState<RolesState>({ loading: true, roles: NONE, coachEnabled: false, coachSignupOpen: false });
  useEffect(() => {
    if (!user) { setState({ loading: false, roles: NONE, coachEnabled: false, coachSignupOpen: false }); return; }
    let live = true;
    (async () => {
      try {
        const [r, f] = await Promise.all([
          supabase.rpc('my_roles'),
          supabase.from('feature_flags').select('key, enabled').in('key', ['v2_coach', 'v2_coach_signup']),
        ]);
        if (!live) return;
        const flags = new Map<string, boolean>((f.data ?? []).map((x: { key: string; enabled: boolean }) => [x.key, x.enabled]));
        setState({
          loading: false,
          roles: { ...NONE, ...(r.data ?? {}) },
          coachEnabled: !!flags.get('v2_coach'),
          coachSignupOpen: !!flags.get('v2_coach_signup'),
        });
      } catch {
        if (live) setState({ loading: false, roles: NONE, coachEnabled: false, coachSignupOpen: false });
      }
    })();
    return () => { live = false; };
  }, [user]);
  return state;
}
