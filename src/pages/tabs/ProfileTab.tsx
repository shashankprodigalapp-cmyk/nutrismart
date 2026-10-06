/**
 * ProfileTab.tsx — User profile, subscription status, settings
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

interface Profile {
  full_name:      string;
  email:          string;
  is_pro:         boolean;
  pro_expires:    string | null;
  created_at:     string;
  target_cal:     number;
  target_protein: number;
  target_fat:     number;
  target_gl:      number;
  target_water:   number;
}

const DEFAULTS = {
  target_cal: 2000, target_protein: 120, target_fat: 65, target_gl: 80, target_water: 8,
};

// ── SHARED FIELD COMPONENT (must be outside modal to preserve focus on re-render)

function GoalField({
  label, value, onChange, unit,
}: { label: string; value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.06] last:border-0">
      <div>
        <p className="text-sm text-white">{label}</p>
        <p className="text-xs text-[#636366]">{unit}</p>
      </div>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-20 text-right bg-white/[0.07] text-white text-sm font-semibold rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#C8F75E]/50"
      />
    </div>
  );
}

// ── NUTRITION GOALS MODAL ─────────────────────────────────────────────────────

function NutritionGoalsModal({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: (updated: Pick<Profile, 'target_cal' | 'target_protein' | 'target_fat' | 'target_gl' | 'target_water'>) => void;
}) {
  const { user } = useAuth();
  const [cal,     setCal]     = useState(String(profile.target_cal));
  const [protein, setProtein] = useState(String(profile.target_protein));
  const [fat,     setFat]     = useState(String(profile.target_fat));
  const [gl,      setGl]      = useState(String(profile.target_gl));
  const [water,   setWater]   = useState(String(profile.target_water));
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    const payload = {
      target_cal:     parseInt(cal,     10) || DEFAULTS.target_cal,
      target_protein: parseInt(protein, 10) || DEFAULTS.target_protein,
      target_fat:     parseInt(fat,     10) || DEFAULTS.target_fat,
      target_gl:      parseInt(gl,      10) || DEFAULTS.target_gl,
      target_water:   parseInt(water,   10) || DEFAULTS.target_water,
    };
    const { error: err } = await supabase
      .from('users')
      .update(payload)
      .eq('id', user.id);
    setSaving(false);
    if (err) {
      setError('Failed to save. Please try again.');
      return;
    }
    onSaved(payload);
    // Notify DashboardLogging to re-fetch targets immediately
    window.dispatchEvent(new Event('nutrismart:targets-updated'));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl px-5 pt-5 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-semibold text-white">Nutrition Goals</p>
          <button onClick={onClose} className="text-[#636366] text-sm px-2 py-1">Cancel</button>
        </div>

        <div className="bg-white/[0.04] rounded-2xl px-4 mb-4">
          <GoalField label="Calories"       value={cal}     onChange={setCal}     unit="kcal / day" />
          <GoalField label="Protein"        value={protein} onChange={setProtein} unit="g / day" />
          <GoalField label="Fat"            value={fat}     onChange={setFat}     unit="g / day" />
          <GoalField label="Glycaemic Load" value={gl}      onChange={setGl}      unit="GL / day" />
          <GoalField label="Water"          value={water}   onChange={setWater}   unit="glasses / day" />
        </div>

        {error && <p className="text-xs text-[#FF453A] mb-3 text-center">{error}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-[#C8F75E] text-[#0A0A0A] text-sm font-bold active:scale-95 transition-transform disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Goals'}
        </button>
      </div>
    </div>
  );
}

// ── NOTIFICATIONS MODAL ───────────────────────────────────────────────────────

function NotificationsModal({ onClose }: { onClose: () => void }) {
  const [pushEnabled, setPushEnabled] = useState(
    'Notification' in window ? Notification.permission === 'granted' : false,
  );
  const [requesting, setRequesting] = useState(false);

  const requestPermission = async () => {
    if (!('Notification' in window)) return;
    setRequesting(true);
    const result = await Notification.requestPermission();
    setPushEnabled(result === 'granted');
    setRequesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl px-5 pt-5 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-semibold text-white">Notifications</p>
          <button onClick={onClose} className="text-[#636366] text-sm px-2 py-1">Done</button>
        </div>

        <div className="bg-white/[0.04] rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-white">Push Notifications</p>
            <p className="text-xs text-[#636366] mt-0.5">Daily reminders &amp; insights</p>
          </div>
          {pushEnabled ? (
            <span className="text-xs bg-[#C8F75E]/20 text-[#C8F75E] font-semibold px-2.5 py-1 rounded-full">On</span>
          ) : (
            <button
              onClick={requestPermission}
              disabled={requesting}
              className="text-xs bg-[#C8F75E] text-black font-semibold px-3 py-1.5 rounded-full disabled:opacity-50"
            >
              {requesting ? '…' : 'Enable'}
            </button>
          )}
        </div>

        <p className="text-xs text-[#636366] text-center px-4">
          Notifications include your morning nutrition verdict, streak reminders, and hydration nudges.
        </p>
      </div>
    </div>
  );
}

// ── DATA & PRIVACY MODAL ──────────────────────────────────────────────────────

function DataPrivacyModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl px-5 pt-5 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-5">
          <p className="text-base font-semibold text-white">Data &amp; Privacy</p>
          <button onClick={onClose} className="text-[#636366] text-sm px-2 py-1">Done</button>
        </div>

        <div className="space-y-3 text-sm text-[#EBEBF5]/70 leading-relaxed">
          <p>Your data is stored securely and never sold to third parties.</p>
          <p>All nutrition logs are encrypted at rest and tied to your account. You may request deletion at any time.</p>
          <p>AI analysis runs server-side — your meal details are not stored by the AI provider beyond the current request.</p>
        </div>

        <div className="mt-5 flex gap-3">
          <a
            href="/legal/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 py-2.5 rounded-xl bg-white/[0.07] text-white text-xs font-semibold text-center"
          >
            Privacy Policy ↗
          </a>
          <a
            href="mailto:privacy@nutrismart.app"
            className="flex-1 py-2.5 rounded-xl bg-white/[0.07] text-white text-xs font-semibold text-center"
          >
            Request Deletion
          </a>
        </div>
      </div>
    </div>
  );
}

// ── PROFILE TAB ───────────────────────────────────────────────────────────────

export default function ProfileTab() {
  const { user, signOut } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'goals' | 'notifications' | 'privacy' | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('users')
      .select('name, plan, created_at, target_cal, target_protein, target_fat, target_gl, target_water')
      .eq('id', user.id)
      .maybeSingle()           // ← was .single() which threw 406 on missing row
      .then(({ data }) => {
        setProfile({
          full_name:      data?.name       ?? user.user_metadata?.name ?? user.email?.split('@')[0] ?? 'User',
          email:          user.email       ?? '',
          is_pro:         data?.plan       === 'pro',
          pro_expires:    null,
          created_at:     data?.created_at ?? user.created_at ?? '',
          target_cal:     data?.target_cal     ?? DEFAULTS.target_cal,
          target_protein: data?.target_protein ?? DEFAULTS.target_protein,
          target_fat:     data?.target_fat     ?? DEFAULTS.target_fat,
          target_gl:      data?.target_gl      ?? DEFAULTS.target_gl,
          target_water:   data?.target_water   ?? DEFAULTS.target_water,
        });
        setLoading(false);
      });
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-5 h-5 border-2 border-[#C8F75E] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const initials = (profile?.full_name ?? 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const memberSince = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : '';

  const settings = [
    { icon: '🎯', label: 'Nutrition Goals',  onClick: () => setModal('goals') },
    { icon: '🔔', label: 'Notifications',    onClick: () => setModal('notifications') },
    { icon: '📊', label: 'Data & Privacy',   onClick: () => setModal('privacy') },
  ];

  return (
    <>
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
          {settings.map(item => (
            <button
              key={item.label}
              onClick={item.onClick}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors"
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-sm text-white flex-1">{item.label}</span>
              <span className="text-[#636366] text-xs">›</span>
            </button>
          ))}
        </div>

        {/* Legal */}
        <div className="bg-[#1C1C1E] rounded-2xl divide-y divide-white/[0.06]">
          {[
            { label: 'Privacy Policy',   href: '/legal/privacy.html' },
            { label: 'Terms of Service', href: '/legal/terms.html' },
          ].map(item => (
            <a
              key={item.label}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.04] transition-colors"
            >
              <span className="text-sm text-white flex-1">{item.label}</span>
              <span className="text-[#636366] text-xs">↗</span>
            </a>
          ))}
        </div>

        {/* Sign out */}
        <button
          onClick={() => signOut()}
          className="w-full bg-[#1C1C1E] rounded-2xl py-3.5 text-sm text-[#FF453A] font-medium hover:bg-[#FF453A]/10 transition-colors"
        >
          Sign Out
        </button>

        <p className="text-center text-xs text-[#636366] pb-2">NutriSmart v1.0 · Made with ❤️ in India</p>
      </div>

      {/* Modals */}
      {modal === 'goals' && profile && (
        <NutritionGoalsModal
          profile={profile}
          onClose={() => setModal(null)}
          onSaved={updated => setProfile(p => p ? { ...p, ...updated } : p)}
        />
      )}
      {modal === 'notifications' && (
        <NotificationsModal onClose={() => setModal(null)} />
      )}
      {modal === 'privacy' && (
        <DataPrivacyModal onClose={() => setModal(null)} />
      )}
    </>
  );
}
