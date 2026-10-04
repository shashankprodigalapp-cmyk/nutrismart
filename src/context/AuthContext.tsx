/**
 * AuthContext.tsx — NutriSmart Authentication Context Provider
 * Module 1, Step 1.3
 *
 * DESIGN GOALS:
 * 1. Single source of auth truth — no component reads session directly from supabase-js.
 * 2. isSessionRefreshing flag — the SyncManager watches this flag before flushing
 *    the offline queue. During a silent token renewal, in-flight Supabase calls would
 *    fail with a stale token. The flag tells SyncManager to pause the queue until
 *    the new token is confirmed.
 * 3. Mid-session 401 recovery — if a Supabase call returns 401, we attempt one
 *    silent refresh. If it fails, we preserve the current log to the Dexie sync
 *    queue before redirecting to /login.
 * 4. Kitchen profile check — after login, we check whether the user has completed
 *    Kitchen Setup. If not, we route to /onboarding instead of /app.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { localDb } from '../lib/localDb';

// ── TYPES ─────────────────────────────────────────────────────────────────────

export interface AuthState {
  /** The currently authenticated Supabase User, or null if signed out. */
  user: User | null;

  /** The active session object containing access_token and refresh_token. */
  session: Session | null;

  /**
   * True while we are resolving the initial session on app load.
   * ProtectedRoute renders <AppSkeleton /> during this window to prevent
   * the flash-of-login-screen on valid sessions.
   */
  isLoading: boolean;

  /**
   * True during a silent background token renewal (TOKEN_REFRESHED event).
   *
   * WHY THIS EXISTS:
   * Supabase renews JWTs silently before expiry. During the brief window
   * between the old token expiring and the new token being confirmed,
   * any Supabase call made by SyncManager would fail with a 401.
   * SyncManager checks this flag before flushing the offline queue —
   * if true, it defers the flush by ~500ms and retries.
   *
   * This prevents "JWT expired" errors from corrupting sync state.
   */
  isSessionRefreshing: boolean;

  /**
   * True if the user has completed the Kitchen Profile setup.
   * Drives the onboarding redirect decision in ProtectedRoute.
   */
  hasKitchenProfile: boolean | null;  // null = not yet checked
}

type AuthAction =
  | { type: 'SESSION_LOADING' }
  | { type: 'SESSION_RESOLVED'; user: User | null; session: Session | null }
  | { type: 'REFRESH_START' }
  | { type: 'REFRESH_DONE'; session: Session }
  | { type: 'SIGNED_IN'; user: User; session: Session }
  | { type: 'SIGNED_OUT' }
  | { type: 'KITCHEN_PROFILE_STATUS'; hasProfile: boolean };

interface AuthContextValue extends AuthState {
  signOut: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

// ── REDUCER ───────────────────────────────────────────────────────────────────

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'SESSION_LOADING':
      return { ...state, isLoading: true };

    case 'SESSION_RESOLVED':
      return {
        ...state,
        user:               action.user,
        session:            action.session,
        isLoading:          false,
        isSessionRefreshing: false,
      };

    case 'REFRESH_START':
      return { ...state, isSessionRefreshing: true };

    case 'REFRESH_DONE':
      return {
        ...state,
        session:             action.session,
        user:                action.session.user,
        isSessionRefreshing: false,
      };

    case 'SIGNED_IN':
      return {
        ...state,
        user:                action.user,
        session:             action.session,
        isLoading:           false,
        isSessionRefreshing: false,
      };

    case 'SIGNED_OUT':
      return {
        user:                null,
        session:             null,
        isLoading:           false,
        isSessionRefreshing: false,
        hasKitchenProfile:   null,
      };

    case 'KITCHEN_PROFILE_STATUS':
      return { ...state, hasKitchenProfile: action.hasProfile };

    default:
      return state;
  }
}

const INITIAL_STATE: AuthState = {
  user:                null,
  session:             null,
  isLoading:           true,   // true on mount — resolving initial session
  isSessionRefreshing: false,
  hasKitchenProfile:   null,
};

// ── CONTEXT ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── PROVIDER ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, INITIAL_STATE);
  const navigate           = useNavigate();

  /**
   * Ref to track whether we are already handling a sign-out navigation.
   * Prevents double-navigate if onAuthStateChange fires multiple times.
   */
  const isNavigatingOut = useRef(false);

  // ── Check kitchen profile completion ───────────────────────────────────────

  const checkKitchenProfile = useCallback(async (userId: string) => {
    try {
      // Check Dexie first (instant, offline-safe)
      const localPref = await localDb.user_prefs.get('kitchen_profile');
      if (localPref?.value) {
        dispatch({ type: 'KITCHEN_PROFILE_STATUS', hasProfile: true });
        return;
      }
      // Fall back to Supabase
      const { data, error } = await supabase
        .from('kitchen_profiles')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      const hasProfile = !error && data !== null;
      dispatch({ type: 'KITCHEN_PROFILE_STATUS', hasProfile });
    } catch {
      // Network error — assume no profile, prompt setup
      dispatch({ type: 'KITCHEN_PROFILE_STATUS', hasProfile: false });
    }
  }, []);

  // ── Handle auth state changes ──────────────────────────────────────────────

  useEffect(() => {
    let isMounted = true;

    /**
     * Resolve the initial session synchronously before rendering any routes.
     * getSession() reads from localStorage — instant, no network call.
     */
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) return;
      dispatch({
        type:    'SESSION_RESOLVED',
        user:    session?.user ?? null,
        session: session ?? null,
      });
      if (session?.user) {
        checkKitchenProfile(session.user.id);
      }
    });

    /**
     * Subscribe to ongoing auth state changes.
     * This fires for: SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED,
     * PASSWORD_RECOVERY, MFA_CHALLENGE_VERIFIED.
     */
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event: AuthChangeEvent, session: Session | null) => {
        if (!isMounted) return;

        switch (event) {
          case 'SIGNED_IN':
            if (!session) break;
            dispatch({ type: 'SIGNED_IN', user: session.user, session });
            await checkKitchenProfile(session.user.id);
            // Navigation handled by ProtectedRoute — don't navigate here
            break;

          case 'TOKEN_REFRESHED':
            /**
             * Silent renewal. Set the refreshing flag so SyncManager pauses
             * its flush queue. Dispatch REFRESH_DONE once the new session
             * is confirmed — clears the flag automatically.
             */
            dispatch({ type: 'REFRESH_START' });
            if (session) {
              // Small delay ensures the new token is propagated to supabase-js
              // internal headers before SyncManager resumes.
              setTimeout(() => {
                if (isMounted && session) {
                  dispatch({ type: 'REFRESH_DONE', session });
                }
              }, 150);
            }
            break;

          case 'USER_UPDATED':
            if (session) {
              dispatch({ type: 'SESSION_RESOLVED', user: session.user, session });
            }
            break;

          case 'SIGNED_OUT':
            if (isNavigatingOut.current) break;
            isNavigatingOut.current = true;

            dispatch({ type: 'SIGNED_OUT' });

            /**
             * Clear user-specific Dexie data on sign-out.
             * This prevents User B seeing User A's cached data on a shared device.
             * We keep user_prefs.device_id — it's device-scoped, not user-scoped.
             */
            try {
              await Promise.all([
                localDb.daily_logs.clear(),
                localDb.water_logs.clear(),
                localDb.energy_logs.clear(),
                localDb.meal_templates.clear(),
                localDb.custom_foods.clear(),
                localDb.sync_queue.clear(),
                localDb.streak.clear(),
                localDb.user_prefs
                  .where('key')
                  .noneOf(['device_id'])
                  .delete(),
              ]);
            } catch {
              // Dexie clear errors are non-fatal — sign-out still proceeds
            }

            navigate('/login', { replace: true });
            // Reset flag after navigation
            setTimeout(() => { isNavigatingOut.current = false; }, 500);
            break;

          default:
            break;
        }
      },
    );

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [navigate, checkKitchenProfile]);

  // ── signOut ────────────────────────────────────────────────────────────────

  const signOut = useCallback(async () => {
    // onAuthStateChange handles the SIGNED_OUT event and navigation
    await supabase.auth.signOut();
  }, []);

  // ── refreshSession ─────────────────────────────────────────────────────────

  /**
   * Manually trigger a session refresh.
   * Called by SyncManager when it receives a 401 from Supabase during flush.
   * Returns true if refresh succeeded, false if the user needs to re-login.
   */
  const refreshSession = useCallback(async (): Promise<boolean> => {
    dispatch({ type: 'REFRESH_START' });
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error || !data.session) {
        // Refresh failed — session is truly expired
        dispatch({ type: 'SIGNED_OUT' });
        return false;
      }
      dispatch({ type: 'REFRESH_DONE', session: data.session });
      return true;
    } catch {
      dispatch({ type: 'SIGNED_OUT' });
      return false;
    }
  }, []);

  // ── Context value ──────────────────────────────────────────────────────────

  const value: AuthContextValue = {
    ...state,
    signOut,
    refreshSession,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

// ── HOOKS ─────────────────────────────────────────────────────────────────────

/**
 * useAuth — primary hook consumed by all components needing auth state.
 * Throws if used outside AuthProvider (development-time guard).
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}

/**
 * useCurrentUser — convenience hook returning the authenticated User.
 * Returns null if not authenticated (caller must handle this case).
 */
export function useCurrentUser(): User | null {
  return useAuth().user;
}

/**
 * useIsRefreshing — consumed by SyncManager to pause the flush queue
 * during silent token renewals.
 */
export function useIsRefreshing(): boolean {
  return useAuth().isSessionRefreshing;
}
