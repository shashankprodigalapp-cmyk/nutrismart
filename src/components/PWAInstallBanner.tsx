/**
 * PWAInstallBanner.tsx
 *
 * Listens for the browser's `beforeinstallprompt` event and shows a bottom
 * sheet prompting the user to add NutriSmart to their home screen.
 *
 * The banner is shown at most once per session (dismissed state stored in
 * sessionStorage so it doesn't reappear on every tab reload).
 */
import React, { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SESSION_KEY = 'pwa_banner_dismissed';

export default function PWAInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already dismissed this session
    if (sessionStorage.getItem(SESSION_KEY)) return;

    // Already installed (display-mode is standalone / fullscreen)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_KEY, '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-20 left-0 right-0 z-40 px-4 pointer-events-none"
      role="dialog"
      aria-label="Install NutriSmart"
    >
      <div className="pointer-events-auto max-w-md mx-auto bg-[#1C1C1E] border border-white/[0.10] rounded-2xl px-4 py-3.5 flex items-center gap-3 shadow-2xl">
        {/* App icon placeholder */}
        <div className="w-11 h-11 rounded-xl bg-[#C8F75E] flex items-center justify-center shrink-0">
          <span className="text-xl">🥗</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white leading-tight">Add to Home Screen</p>
          <p className="text-xs text-[#636366] mt-0.5 leading-tight truncate">
            Get the full app experience
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="text-xs bg-[#C8F75E] text-black font-bold px-3 py-1.5 rounded-full shrink-0 active:scale-95 transition-transform"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="text-[#636366] text-lg leading-none px-1 shrink-0"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
}
