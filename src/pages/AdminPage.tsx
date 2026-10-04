import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { ContributionModerator } from '../components/admin/ContributionModerator';
import { AnalyticsDashboard }   from '../components/admin/AnalyticsDashboard';
import { UserManagement }       from '../components/admin/UserManagement';
import { SubscriptionModerator } from '../components/admin/SubscriptionModerator';

export default function AdminPage() {
  const tabs = [
    { to: '/admin/analytics',     label: '📊 Analytics' },
    { to: '/admin/users',         label: '👥 Users' },
    { to: '/admin/payments',      label: '💳 Payments' },
    { to: '/admin/contributions', label: '🍽️ Contributions' },
  ];

  return (
    <div className="min-h-dvh bg-[#111113]">
      <div className="flex gap-2 px-4 pt-4 border-b border-white/[0.07] pb-3 overflow-x-auto">
        {tabs.map(({ to, label }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) =>
              `flex-shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-xl whitespace-nowrap ${
                isActive ? 'bg-[#C8F75E] text-[#111113]' : 'text-[#636366] bg-[#1C1C1E]'
              }`
            }
          >{label}</NavLink>
        ))}
      </div>
      <Routes>
        <Route path="analytics"     element={<AnalyticsDashboard />} />
        <Route path="users"         element={<UserManagement />} />
        <Route path="payments"      element={<SubscriptionModerator />} />
        <Route path="contributions" element={<ContributionModerator />} />
        <Route path="*"             element={<AnalyticsDashboard />} />
      </Routes>
    </div>
  );
}
