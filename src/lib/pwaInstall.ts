/**
 * pwaInstall.ts — single shared source of truth for "can this user install the app?"
 *
 * The browser fires `beforeinstallprompt` only once, early. We capture it at
 * import time so any component (login banner, Profile "Install app" row) can
 * trigger the native install dialog later, even if the user dismissed the banner.
 *
 * - Chrome/Edge/Android: native prompt via promptInstall()
 * - iPhone/iPad Safari: no native prompt exists → show Share → Add to Home Screen steps
 * - After uninstalling, browsers fire beforeinstallprompt again, so the button reappears.
 */
import { useEffect, useState, useCallback } from 'react';
import { track } from './analytics';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SNOOZE_KEY  = 'pwa_install_snoozed_until';
const SNOOZE_DAYS = 7;

let deferred: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(l => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    installedFlag = false;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    track('app_installed');
    deferred = null;
    installedFlag = true;
    notify();
  });
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* ignore */ }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function isIOS(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function isSnoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    return until > Date.now();
  } catch { return false; }
}

export function snoozeInstallPrompt(days = SNOOZE_DAYS): void {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86_400_000)); } catch { /* ignore */ }
}

/** Test helper */
export function __resetPwaInstallForTests(): void {
  deferred = null; installedFlag = false; listeners.clear();
}

export function usePWAInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force(n => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  const installed = installedFlag || isStandalone();
  const canPrompt = !!deferred && !installed;
  const ios       = isIOS();

  const promptInstall = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    if (!deferred) return 'unavailable';
    const ev = deferred;
    await ev.prompt();
    const { outcome } = await ev.userChoice;
    deferred = null;              // a prompt event can only be used once
    if (outcome === 'accepted') installedFlag = true;
    notify();
    return outcome;
  }, []);

  return { installed, canPrompt, isIOS: ios, promptInstall };
}
