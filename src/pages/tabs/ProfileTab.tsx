/**
 * ProfileTab.tsx — User profile, subscription status, settings
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { usePWAInstall } from '../../lib/pwaInstall';
import { InstallHelpModal } from '../../components/InstallHelpModal';
import { fitMacros, matchPreset, presetGrams, splitPercent, PRESETS, type PresetKey } from '../../lib/macroMath';
import { registerPushSubscription, ensurePushSubscription } from '../../lib/pushRegistration';

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

  // Calories are the master number; carbs are what is left; protein is protected first.
  const calN = parseInt(cal, 10) || 0;
  const fit  = fitMacros(calN || DEFAULTS.target_cal, parseInt(protein, 10) || 0, parseInt(fat, 10) || 0);
  const split = splitPercent(fit);
  const current = matchPreset(fit.cal, fit.protein, fit.fat);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    const payload = {
      target_cal:     parseInt(cal,     10) || DEFAULTS.target_cal,
      target_protein: (parseInt(protein, 10) ? fit.protein : DEFAULTS.target_protein),
      target_fat:     (parseInt(fat,     10) ? fit.fat     : DEFAULTS.target_fat),
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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
        <div className="flex items-center justify-between mb-4">
          <p className="text-base font-semibold text-white">Nutrition Goals</p>
          <button onClick={onClose} className="text-[#636366] text-sm px-2 py-1">Cancel</button>
        </div>

        <div className="mb-3">
          <p className="text-xs text-[#636366] mb-2">Quick setup: splits your calories for you</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(PRESETS) as PresetKey[]).map(k => (
              <button
                key={k}
                type="button"
                onClick={() => { const g = presetGrams(k, calN || DEFAULTS.target_cal); setProtein(String(g.protein)); setFat(String(g.fat)); }}
                className={`rounded-xl px-2 py-2.5 text-[11px] font-semibold leading-tight border ${current === k ? 'bg-[#C8F75E]/15 border-[#C8F75E]/50 text-[#C8F75E]' : 'bg-white/[0.04] border-white/[0.08] text-white'}`}
              >
                {PRESETS[k].label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#636366] mt-2">{current === 'custom' ? 'Custom split (your own numbers)' : PRESETS[current].blurb}</p>
        </div>

        <div className="bg-white/[0.04] rounded-2xl px-4 mb-4">
          <GoalField label="Calories"       value={cal}     onChange={setCal}     unit="kcal / day" />
          <GoalField label="Protein"        value={protein} onChange={setProtein} unit="g / day" />
          <GoalField label="Fat"            value={fat}     onChange={setFat}     unit="g / day" />
          <GoalField label="Glycaemic Load" value={gl}      onChange={setGl}      unit="GL / day" />
          <GoalField label="Water"          value={water}   onChange={setWater}   unit="glasses / day" />
        </div>

        <div className="bg-white/[0.04] rounded-2xl px-4 py-3 mb-4 text-xs">
          <div className="flex h-2 rounded-full overflow-hidden mb-2" aria-hidden="true">
            <div style={{ width: `${split.carbs}%`, background: '#FF8FAB' }} />
            <div style={{ width: `${split.protein}%`, background: '#8DB4FF' }} />
            <div style={{ width: `${split.fat}%`, background: '#FFB347' }} />
          </div>
          <div className="flex justify-between">
            <span style={{ color: '#FF8FAB' }}>Carbs {split.carbs}%</span>
            <span style={{ color: '#8DB4FF' }}>Protein {split.protein}%</span>
            <span style={{ color: '#FFB347' }}>Fat {split.fat}%</span>
          </div>
          <div className="flex justify-between mt-3 text-[#EBEBF5]/70">
            <span>Carbs (automatic)</span>
            <span className="text-white font-semibold">{fit.carbs} g / day</span>
          </div>
          <p className="text-[#636366] mt-1">Carbs are whatever is left of your calories. Treat it as a guide, not a limit.</p>
          {fit.adjusted && (
            <div className="mt-3 rounded-xl bg-[#FFB347]/10 border border-[#FFB347]/30 px-3 py-2">
              <p className="text-[#FFB347]">
                {protein} g protein and {fat} g fat do not fit in {calN || DEFAULTS.target_cal} kcal. They will be adjusted to {fit.protein} g protein and {fit.fat} g fat, leaving {fit.carbs} g carbs. Protein is kept as high as possible.
              </p>
              <button
                type="button"
                onClick={() => { setProtein(String(fit.protein)); setFat(String(fit.fat)); }}
                className="mt-2 text-[#C8F75E] font-semibold"
              >
                Apply now
              </button>
            </div>
          )}
          {calN > 0 && calN < 1200 && (
            <p className="text-[#FFB347] mt-3">Under 1200 kcal a day is very low. Please talk to a doctor or dietician first.</p>
          )}
          <p className="text-[#636366] mt-3">General guidance, not medical advice.</p>
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
  const { user } = useAuth();
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [testMsg, setTestMsg] = useState<string>('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!user || !pushEnabled) return;
    ensurePushSubscription(user.id).then(setRegistered);
  }, [user, pushEnabled]);

  const requestPermission = async () => {
    if (!user || !('Notification' in window)) return;
    setRequesting(true);
    const res = await registerPushSubscription(user.id);
    const ok = res.supported && res.granted;
    setPushEnabled(ok || Notification.permission === 'granted');
    setRegistered(ok);
    if (!res.supported) setTestMsg('This browser does not support notifications. On iPhone, add NutriSmart to your Home Screen first.');
    else if (!res.granted) setTestMsg('Notifications are blocked. Allow them for this site in your browser or phone settings, then try again.');
    setRequesting(false);
  };

  const sendTest = async () => {
    setTesting(true); setTestMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/send-test-push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      const j = await r.json().catch(() => ({}));
      if (j.error === 'vapid_not_configured') setTestMsg('Server is not set up for notifications yet (missing keys). Tell support.');
      else if (j.error === 'no_subscription') setTestMsg('This device is not registered yet. Tap Enable, then try again.');
      else if (j.success) setTestMsg(`Sent to ${j.sent} device${j.sent === 1 ? '' : 's'}. It should appear within a few seconds.`);
      else setTestMsg(`The notification service refused it (code ${(j.statuses ?? []).join(', ') || r.status}). Try Enable again.${j.errors?.length ? ' Reason: ' + j.errors[0] : ''}${j.keyInfo ? ` (key lengths ${j.keyInfo.pub}/${j.keyInfo.priv})` : ''}`);
    } catch {
      setTestMsg('Could not reach the server. Check your connection.');
    }
    setTesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8"
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

        {pushEnabled && (
          <div className="mb-4">
            <button
              onClick={sendTest}
              disabled={testing}
              className="w-full py-2.5 rounded-xl bg-white/[0.06] text-white text-sm font-semibold disabled:opacity-50"
            >
              {testing ? 'Sending…' : 'Send me a test notification'}
            </button>
            {registered === false && !testMsg && (
              <p className="text-xs text-[#FFB347] mt-2 px-1">This device is not registered yet. Tap the button above, or reopen the app.</p>
            )}
          </div>
        )}
        {testMsg && <p className="text-xs text-[#EBEBF5]/70 mb-3 px-1">{testMsg}</p>}

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
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-md bg-[#1C1C1E] border border-white/[0.08] rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8"
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
  const [modal, setModal] = useState<'goals' | 'notifications' | 'privacy' | 'install' | null>(null);
  const { installed, canPrompt, promptInstall } = usePWAInstall();

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
    // Always available while the app isn't installed (dismissed the pop-up, or uninstalled later)
    ...(installed ? [] : [{
      icon: '📲', label: 'Install app',
      onClick: async () => {
        if (canPrompt) { const r = await promptInstall(); if (r !== 'unavailable') return; }
        setModal('install');
      },
    }]),
  ];

  return (
    <>
      <div className="p-4 pb-24 max-w-lg md:max-w-2xl md:p-8 mx-auto space-y-4">
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
              <span className="text-xs text-[#636366]">5 AI/photo searches per day</span>
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
      {modal === 'install' && (
        <InstallHelpModal onClose={() => setModal(null)} />
      )}
    </>
  );
}
