/**
 * AppShell.tsx — Main app frame
 * 4-tab nav: Today | Log | Insights | Profile
 * Desktop: left sidebar. Mobile: bottom nav.
 */
import React, { useEffect } from 'react';
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import { useAuth, useIsRefreshing } from '../context/AuthContext';
import { ContextualAlerts }         from '../components/ContextualAlerts';
import { initSyncManager }          from '../lib/SyncManager';
import { localDb }                  from '../lib/localDb';

const TodayTab    = React.lazy(() => import('./tabs/TodayTab'));
const LogTab      = React.lazy(() => import('./tabs/LogTab'));
const InsightsTab = React.lazy(() => import('./tabs/InsightsTab'));
const ProfileTab  = React.lazy(() => import('./tabs/ProfileTab'));

const TABS = [
  { to: '/app/today',    icon: '🏠', label: 'Today' },
  { to: '/app/log',      icon: '📋', label: 'Log'   },
  { to: '/app/insights', icon: '📊', label: 'Insights' },
  { to: '/app/profile',  icon: '👤', label: 'Profile' },
];

function Spinner() {
  return (
    <div className="flex items-center justify-center h-40">
      <div className="w-5 h-5 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin"/>
    </div>
  );
}

export default function AppShell() {
  const { user }     = useAuth();
  const isRefreshing = useIsRefreshing();

  useEffect(() => {
    if (!user) return;
    localDb.user_prefs.get('device_id').then(pref => {
      const deviceId = (pref?.value as string) ?? crypto.randomUUID();
      const sm = initSyncManager({
        userId:          user.id,
        deviceId,
        getIsRefreshing: () => isRefreshing,
      });
      sm.init();
    });
  }, [user]);

  return (
    <div className="min-h-dvh bg-[#111113] flex">
      {/* ── Desktop sidebar (md+) ── */}
      <aside className="hidden md:flex flex-col w-56 border-r border-white/[0.07] bg-[#111113] sticky top-0 h-screen shrink-0">
        <div className="px-5 py-6">
          <span className="text-[#C8F75E] font-bold text-lg tracking-tight">NutriSmart</span>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {TABS.map(tab => (
            <NavLink key={tab.to} to={tab.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive ? 'bg-[#C8F75E]/10 text-[#C8F75E]' : 'text-[#636366] hover:text-white hover:bg-white/[0.04]'
                }`
              }>
              <span className="text-base">{tab.icon}</span>
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <ContextualAlerts />

        <div className="flex-1 overflow-y-auto">
          <React.Suspense fallback={<Spinner />}>
            <Routes>
              <Route index element={<Navigate to="today" replace />} />
              <Route path="today"    element={<TodayTab />} />
              <Route path="log"      element={<LogTab />} />
              <Route path="insights" element={<InsightsTab />} />
              <Route path="profile"  element={<ProfileTab />} />
              <Route path="*"        element={<Navigate to="today" replace />} />
            </Routes>
          </React.Suspense>
        </div>

        {/* ── Mobile bottom nav ── */}
        <nav className="md:hidden sticky bottom-0 bg-[#111113]/95 backdrop-blur-xl border-t border-white/[0.07] grid grid-cols-4 pb-safe-bottom z-50">
          {TABS.map(tab => (
            <NavLink key={tab.to} to={tab.to}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 px-1 transition-colors ${
                  isActive ? 'text-[#C8F75E]' : 'text-[#636366]'
                }`
              }>
              <span className="text-[18px] leading-none">{tab.icon}</span>
              <span className="text-[8px] font-semibold uppercase tracking-[0.5px]">{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
