/**
 * PWAInstallBanner.test.tsx
 *
 *   1. Hidden when logged out
 *   2. Hidden until the browser offers an install prompt
 *   3. Shown to a logged-in user when beforeinstallprompt fires
 *   4. Not shown when already installed (standalone / iOS standalone)
 *   5. Not shown while snoozed (dismissed < 7 days ago); shown again after expiry
 *   6. Dismiss snoozes it for 7 days
 *   7. Install button calls deferredPrompt.prompt() and hides on accept
 *   8. Declining the native dialog snoozes it
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

let mockUser: any = { id: 'u1' };
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

import PWAInstallBanner from '../../components/PWAInstallBanner';
import { __resetPwaInstallForTests } from '../../lib/pwaInstall';

function setStandaloneMode(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: vi.fn().mockReturnValue({
      matches, media: '(display-mode: standalone)', onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }),
  });
}

function fireInstallPromptEvent(
  promptFn = vi.fn().mockResolvedValue(undefined),
  outcome: 'accepted' | 'dismissed' = 'accepted',
) {
  const event = Object.assign(new Event('beforeinstallprompt'), {
    prompt: promptFn,
    userChoice: Promise.resolve({ outcome }),
    preventDefault: vi.fn(),
  });
  window.dispatchEvent(event);
  return { promptFn };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  __resetPwaInstallForTests();
  mockUser = { id: 'u1' };
  setStandaloneMode(false);
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: undefined });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('PWAInstallBanner', () => {
  it('renders nothing before beforeinstallprompt fires', () => {
    render(<PWAInstallBanner />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing when logged out, even if the browser offers install', async () => {
    mockUser = null;
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows to a logged-in user when beforeinstallprompt fires', async () => {
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.getByRole('dialog', { name: 'Install NutriSmart' })).toBeTruthy();
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
  });

  it('does NOT show when already in standalone display mode', async () => {
    setStandaloneMode(true);
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT show when navigator.standalone is true (iOS home-screen app)', async () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT show while snoozed', async () => {
    localStorage.setItem('pwa_install_snoozed_until', String(Date.now() + 86_400_000));
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows again once the snooze has expired', async () => {
    localStorage.setItem('pwa_install_snoozed_until', String(Date.now() - 1000));
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('dismiss button snoozes for ~7 days and hides the banner', async () => {
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    fireEvent.click(screen.getByLabelText('Dismiss'));
    const until = Number(localStorage.getItem('pwa_install_snoozed_until'));
    expect(until).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Install button calls deferredPrompt.prompt() and hides after accept', async () => {
    const promptFn = vi.fn().mockResolvedValue(undefined);
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(promptFn); });
    await act(async () => { fireEvent.click(screen.getByText('Install')); });
    expect(promptFn).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('declining the native dialog snoozes the banner', async () => {
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(vi.fn().mockResolvedValue(undefined), 'dismissed'); });
    await act(async () => { fireEvent.click(screen.getByText('Install')); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(Number(localStorage.getItem('pwa_install_snoozed_until'))).toBeGreaterThan(Date.now());
  });
});
