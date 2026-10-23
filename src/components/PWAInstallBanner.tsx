/**
 * PWAInstallBanner.tsx
 *
 * Bottom sheet inviting a SIGNED-IN user to install NutriSmart.
 *
 * Shows when: user is logged in, app is not installed, the browser can install
 * it (native prompt available, or iPhone Safari with manual steps), and the user
 * has not tapped "Not now" in the last 7 days.
 *
 * It is NOT the only way in: Profile → "Install app" is always available while the
 * app is not installed, for people who dismissed this or uninstalled later.
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePWAInstall, isSnoozed, snoozeInstallPrompt } from '../lib/pwaInstall';

export default function PWAInstallBanner() {
  const { user } = useAuth();
  const { installed, canPrompt, isIOS, promptInstall } = usePWAInstall();
  const [snoozed, setSnoozed] = useState<boolean>(() => isSnoozed());
  const [onboarding, setOnboarding] = useState(false);

  // Keep clear of the onboarding screen's primary button
  useEffect(() => {
    const check = () => setOnboarding(window.location.pathname.startsWith('/onboarding'));
    check();
    const t = setInterval(check, 1500);
    return () => clearInterval(t);
  }, []);

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === 'dismissed') { snoozeInstallPrompt(); setSnoozed(true); }
  };

  const handleDismiss = () => {
    snoozeInstallPrompt();
    setSnoozed(true);
  };

  if (!user || installed || snoozed || onboarding) return null;
  if (!canPrompt && !isIOS) return null;

  return (
    <div className="fixed bottom-20 left-0 right-0 z-40 px-4 pointer-events-none" role="dialog" aria-label="Install NutriSmart">
      <div className="pointer-events-auto max-w-md mx-auto bg-[#1C1C1E] border border-white/[0.10] rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-2xl">
        <img src="/apple-touch-icon.png" alt="" className="w-11 h-11 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Add to Home Screen</p>
          <p className="text-xs text-[#8E8E93] mt-0.5 leading-snug">
            {isIOS && !canPrompt
              ? 'Tap Share, then “Add to Home Screen” — you’ll also get meal reminders.'
              : 'Get the full app experience and meal reminders'}
          </p>
        </div>
        {canPrompt && (
          <button onClick={handleInstall}
            className="text-xs bg-[#C8F75E] text-black font-bold px-3 py-1.5 rounded-full shrink-0 active:scale-95 transition-transform">
            Install
          </button>
        )}
        <button onClick={handleDismiss} className="text-[#636366] text-lg leading-none px-1 shrink-0" aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}
