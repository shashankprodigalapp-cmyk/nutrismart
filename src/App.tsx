/**
 * App.tsx — Root router and provider composition
 *
 * Provider order:
 *   BrowserRouter (in main.tsx)
 *   └── AuthProvider
 *       └── AlertProvider
 *           └── UpgradeModalHost  ← registers the modal callback for useProGate
 *               └── Routes
 */

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate }       from 'react-router-dom';
import { AuthProvider }                  from './context/AuthContext';
import { AlertProvider }                 from './components/ContextualAlerts';
import { ProtectedRoute }                from './components/ProtectedRoute';
import { UpgradeModal }                  from './components/UpgradeModal';
import { registerUpgradeModalCallback, type ProFeature } from './utils/proGatekeeper';
import PWAInstallBanner from './components/PWAInstallBanner';

// ── Lazy page imports ──────────────────────────────────────────────────────────
const LoginPage      = React.lazy(() => import('./pages/LoginPage'));
const OnboardingPage = React.lazy(() => import('./pages/OnboardingPage'));
const ResetPasswordPage = React.lazy(() => import('./pages/ResetPasswordPage'));
const AppShell       = React.lazy(() => import('./pages/AppShell'));
const AdminPage      = React.lazy(() => import('./pages/AdminPage'));
const CoachPage      = React.lazy(() => import('./pages/CoachPage'));
const ClientDetailPage = React.lazy(() => import('./pages/coach/ClientDetailPage'));
const JoinPage       = React.lazy(() => import('./pages/JoinPage'));
const WeeklyReviewPage = React.lazy(() => import('./pages/WeeklyReviewPage'));
const MyCoachPage    = React.lazy(() => import('./pages/MyCoachPage'));

const Spinner = (
  <div className="min-h-dvh bg-[#111113] flex items-center justify-center">
    <div className="w-6 h-6 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin" />
  </div>
);

// ── Upgrade modal host ─────────────────────────────────────────────────────────
// Sits at the top of the tree so any component can trigger it via useProGate()
function UpgradeModalHost({ children }: { children: React.ReactNode }) {
  const [activeFeature, setActiveFeature] = useState<ProFeature | null>(null);

  useEffect(() => {
    // Register the callback so useProGate().showUpgrade() opens this modal
    registerUpgradeModalCallback((feature) => setActiveFeature(feature));
  }, []);

  return (
    <>
      {children}
      {activeFeature && (
        <UpgradeModal
          feature={activeFeature}
          onClose={() => setActiveFeature(null)}
        />
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AlertProvider>
        <UpgradeModalHost>
          <PWAInstallBanner />
          <React.Suspense fallback={Spinner}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />

              {/* Onboarding — auth required but no kitchen profile check */}
              <Route path="/onboarding" element={
                <ProtectedRoute requiresKitchenProfile={false}>
                  <OnboardingPage />
                </ProtectedRoute>
              } />

              {/* Main app — auth + kitchen profile required */}
              <Route path="/app/*" element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              } />

              {/* 2.0: coach area and client-side coach link (switched on by feature flag v2_coach) */}
              <Route path="/coach/client/:clientId" element={<ProtectedRoute><ClientDetailPage /></ProtectedRoute>} />
              <Route path="/coach/*" element={<ProtectedRoute><CoachPage /></ProtectedRoute>} />
              <Route path="/join/:token" element={<ProtectedRoute requiresKitchenProfile={false}><JoinPage /></ProtectedRoute>} />
              <Route path="/app/weekly-review" element={<ProtectedRoute><WeeklyReviewPage /></ProtectedRoute>} />
              <Route path="/app/my-coach" element={<ProtectedRoute><MyCoachPage /></ProtectedRoute>} />

              {/* Admin */}
              <Route path="/admin/*" element={
                <ProtectedRoute>
                  <AdminPage />
                </ProtectedRoute>
              } />

              {/* Default */}
              <Route path="/"  element={<Navigate to="/app/today" replace />} />
              <Route path="*"  element={<Navigate to="/app/today" replace />} />
            </Routes>
          </React.Suspense>
        </UpgradeModalHost>
      </AlertProvider>
    </AuthProvider>
  );
}
