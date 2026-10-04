/**
 * ProtectedRoute.tsx — NutriSmart Route Guard
 * Module 1, Step 1.3
 *
 * GUARD LOGIC:
 * 1. isLoading=true → render <AppSkeleton /> (prevents flash-of-login)
 * 2. No user → redirect to /login, preserve intended path in location.state
 * 3. User exists but no kitchen profile → redirect to /onboarding
 * 4. User exists + has kitchen profile → render children
 *
 * The intended route is captured in router state as { from: location } so
 * the login screen can redirect back to the original destination after auth.
 *
 * USAGE:
 *   <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>} />
 *   <Route path="/app/log" element={<ProtectedRoute><LogTab /></ProtectedRoute>} />
 *   <Route
 *     path="/onboarding"
 *     element={<ProtectedRoute requiresKitchenProfile={false}><OnboardingFlow /></ProtectedRoute>}
 *   />
 */

import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AppSkeleton } from './AppSkeleton';

// ── TYPES ─────────────────────────────────────────────────────────────────────

interface ProtectedRouteProps {
  children: React.ReactNode;

  /**
   * When true (default), redirect users who haven't completed Kitchen Setup
   * to /onboarding. Set false on the /onboarding route itself to prevent
   * an infinite redirect loop.
   */
  requiresKitchenProfile?: boolean;
}

// ── COMPONENT ─────────────────────────────────────────────────────────────────

export function ProtectedRoute({
  children,
  requiresKitchenProfile = true,
}: ProtectedRouteProps) {
  const { user, isLoading, hasKitchenProfile } = useAuth();
  const location = useLocation();

  // ── Phase 1: Resolving initial session ──────────────────────────────────
  // isLoading is true on first mount while Supabase reads localStorage.
  // Show a skeleton rather than the login screen to prevent the flash.
  if (isLoading) {
    return <AppSkeleton />;
  }

  // ── Phase 2: Not authenticated ───────────────────────────────────────────
  // Redirect to /login. Preserve the intended destination in router state
  // so the login screen can send the user back after successful auth.
  if (!user) {
    return (
      <Navigate
        to="/login"
        state={{ from: location }}
        replace
      />
    );
  }

  // ── Phase 3: Authenticated but Kitchen Profile not yet checked ───────────
  // hasKitchenProfile is null while the async check is running.
  // Show skeleton to avoid a premature redirect.
  if (requiresKitchenProfile && hasKitchenProfile === null) {
    return <AppSkeleton />;
  }

  // ── Phase 4: Authenticated but no Kitchen Profile ────────────────────────
  // The user signed in but never completed the 3-question Kitchen Setup.
  // Redirect to /onboarding. The onboarding route uses requiresKitchenProfile=false
  // to prevent this redirect from firing again.
  if (requiresKitchenProfile && hasKitchenProfile === false) {
    return (
      <Navigate
        to="/onboarding"
        state={{ from: location }}
        replace
      />
    );
  }

  // ── Phase 5: Fully authenticated and set up ─────────────────────────────
  return <>{children}</>;
}
