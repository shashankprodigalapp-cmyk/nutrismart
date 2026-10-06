/**
 * ProfileTab.tsx — User profile, subscription status, settings
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

interface Profile {
  full_name:   string;
  email:       string;
  is_pro:      boolean;
  pro_expires: string | null;
  created_at:  string;
}

export default function ProfileTab() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading]  = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('users')
      .select('name, plan, created_at')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setProfile({
          full_name:   data?.name ?? user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User',
          email:       user.email ?? '',
          is_pro:      data?.plan === 'pro',
          pro_expires: null,
          created_at:  data?.created_at ?? user.created_at ?? '',
        });
        setLoading(false);
      });
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin"/>
      </div>
    );
  }

  const initials = (profile?.full_name ?? 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="p-4 pb-24 max-w-lg mx-auto space-y-4">
      {/* Avatar + name */}
      <div className="bg-[#1C1C1E] rounded-2xl p-5 flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-[#C8F75E] flex items-center justify-center">
          <span className="text-2xl font-bold text-black">{initials}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-semibold text-white truncate">{profile?.full_name}</p>
          <p className="text-sm text-[#636366] truncate">{profile?.email}</p>
          {memberSince && (
            <p className="text-xs text-[#636366] mt-0.5">Member since {memberSince}</p>
          )}
        </div>
      </div>

      {/* Subscription badge */}
      <div className={`rounded-2xl p-4 ${profile?.is_pro ? 'bg-[#C8F75E]/10 border border-[#C8F75E]/30' : 'bg-[#1C1C1E]'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[#EBEBF5]/60">Plan</p>
            <p className={`text-lg font-bold mt-0.5 ${profile?.is_pro ? 'text-[#C8F75E]' : 'text-white'}`}>
              {profile?.is_pro ? '⚡ Pro' : 'Free'}
            </p>
            {profile?.is_pro && profile.pro_expires && (
              <p className="text-xs text-[#636366] mt-0.5">
                Expires {new Date(profile.pro_expires).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            )}
          </div>
          {!profile?.is_pro && (
            <span className="text-xs bg-[#C8F75E] text-black font-semibold px-3 py-1.5 rounded-full">
              Upgrade ₹99
            </span>
          )}
        </div>
      </div>

      {/* Settings rows */}
      <div className="bg-[#1C1C1E] rounded-2xl divide-y divide-white/[0.06]">
        {[
          { icon: '🎯', label: 'Nutrition Goals' },
          { icon: '🔔', label: 'Notifications' },
          { icon: '📊', label: 'Data & Privacy' },
        ].map(item => (
          <button key={item.label}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.04] transition-colors">
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm text-white flex-1">{item.label}</span>
            <span className="text-[#636366] text-xs">›</span>
          </button>
        ))}
      </div>

      {/* Legal */}
      <div className="bg-[#1C1C1E] rounded-2xl divide-y divide-white/[0.06]">
        {[
          { label: 'Privacy Policy', href: '/legal/privacy.html' },
          { label: 'Terms of Service', href: '/legal/terms.html' },
        ].map(item => (
          <a key={item.label} href={item.href} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.04] transition-colors">
            <span className="text-sm text-white flex-1">{item.label}</span>
            <span className="text-[#636366] text-xs">↗</span>
          </a>
        ))}
      </div>

      {/* Sign out */}
      <button onClick={() => signOut()}
        className="w-full bg-[#1C1C1E] rounded-2xl py-3.5 text-sm text-[#FF453A] font-medium hover:bg-[#FF453A]/10 transition-colors">
        Sign Out
      </button>

      <p className="text-center text-xs text-[#636366] pb-2">NutriSmart v1.0 · Made with ❤️ in India</p>
    </div>
  );
}
