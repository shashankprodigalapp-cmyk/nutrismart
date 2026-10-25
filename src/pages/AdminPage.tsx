import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { ContributionModerator } from '../components/admin/ContributionModerator';
import { AnalyticsDashboard }   from '../components/admin/AnalyticsDashboard';
import { UserManagement }       from '../components/admin/UserManagement';
import { SubscriptionModerator } from '../components/admin/SubscriptionModerator';
import { AdminInsights }       from '../components/admin/AdminInsights';
import { AdminFreeTier }       from '../components/admin/AdminFreeTier';
import { AdminBehaviour }      from '../components/admin/AdminBehaviour';
import { AdminWhoTheyAre }     from '../components/admin/AdminWhoTheyAre';
import { AdminSearchReview }   from '../components/admin/AdminSearchReview';
import { useAdminInsights }    from '../components/admin/useAdminInsights';

export default function AdminPage() {
  const { data: watch } = useAdminInsights(7);
  const tabs = [
    { to: '/admin/insights',      label: '📈 Insights' },
    { to: '/admin/behaviour',     label: '🧭 Behaviour' },
    { to: '/admin/who',           label: '👥 Who they are' },
    { to: '/admin/free-tier',     label: '🧮 Free tier' },
    { to: '/admin/analytics',     label: '📊 Analytics' },
    { to: '/admin/users',         label: '👥 Users' },
    { to: '/admin/payments',      label: '💳 Payments' },
    { to: '/admin/contributions', label: '🍽️ Contributions' },
    { to: '/admin/search-review', label: '🚫 Search review' },
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
          >{label}{to === '/admin/free-tier' && watch && (watch.health === 'warn' || watch.health === 'critical') ? (<i className={`inline-block w-2 h-2 rounded-full ml-1.5 ${watch.health === 'critical' ? 'bg-[#FF5D5D]' : 'bg-[#FFB340]'}`} />) : null}</NavLink>
        ))}
      </div>
      <Routes>
        <Route path="insights"      element={<AdminInsights />} />
        <Route path="behaviour"     element={<AdminBehaviour />} />
        <Route path="who"           element={<AdminWhoTheyAre />} />
        <Route path="free-tier"     element={<AdminFreeTier />} />
        <Route path="analytics"     element={<AnalyticsDashboard />} />
        <Route path="users"         element={<UserManagement />} />
        <Route path="payments"      element={<SubscriptionModerator />} />
        <Route path="contributions" element={<ContributionModerator />} />
        <Route path="search-review" element={<AdminSearchReview />} />
        <Route path="*"             element={<AdminInsights />} />
      </Routes>
    </div>
  );
}
