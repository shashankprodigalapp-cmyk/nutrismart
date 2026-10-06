/**
 * PWAInstallBanner.test.tsx
 *
 * Tests the PWA install prompt banner component behaviour:
 *   1. Hidden by default (no beforeinstallprompt event fired)
 *   2. Shown when beforeinstallprompt fires (and not in standalone mode)
 *   3. Not shown when already in standalone display mode
 *   4. Not shown when pwa_banner_dismissed in sessionStorage
 *   5. Dismiss button writes to sessionStorage and hides banner
 *   6. Install button calls deferredPrompt.prompt()
 *   7. Banner hides after user accepts the install prompt
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PWAInstallBanner from '../../components/PWAInstallBanner';

// ── matchMedia mock ────────────────────────────────────────────────────────

function setStandaloneMode(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: '(display-mode: standalone)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

// ── Helper: fire beforeinstallprompt ─────────────────────────────────────

function fireInstallPromptEvent(promptFn = vi.fn().mockResolvedValue(undefined)) {
  const userChoicePromise = Promise.resolve({ outcome: 'accepted' as const });
  const event = Object.assign(new Event('beforeinstallprompt'), {
    prompt: promptFn,
    userChoice: userChoicePromise,
    preventDefault: vi.fn(),
  });
  window.dispatchEvent(event);
  return { event, promptFn, userChoicePromise };
}

// ── Setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
  setStandaloneMode(false);
  // Clear navigator.standalone
  Object.defineProperty(navigator, 'standalone', { configurable: true, value: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PWAInstallBanner', () => {
  it('renders nothing before beforeinstallprompt fires', () => {
    render(<PWAInstallBanner />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the banner when beforeinstallprompt fires', async () => {
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

  it('does NOT show when navigator.standalone is true (iOS Safari)', async () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does NOT show when pwa_banner_dismissed is set in sessionStorage', async () => {
    sessionStorage.setItem('pwa_banner_dismissed', '1');
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismiss button sets sessionStorage and hides banner', async () => {
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(); });

    const dismissBtn = screen.getByLabelText('Dismiss');
    fireEvent.click(dismissBtn);

    expect(sessionStorage.getItem('pwa_banner_dismissed')).toBe('1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Install button calls deferredPrompt.prompt()', async () => {
    const promptFn = vi.fn().mockResolvedValue(undefined);
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(promptFn); });

    const installBtn = screen.getByText('Install');
    await act(async () => { fireEvent.click(installBtn); });

    expect(promptFn).toHaveBeenCalledOnce();
  });

  it('hides banner after user accepts the install prompt', async () => {
    const promptFn = vi.fn().mockResolvedValue(undefined);
    render(<PWAInstallBanner />);
    await act(async () => { fireInstallPromptEvent(promptFn); });

    // Banner is visible
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Click Install → outcome = 'accepted' → banner should hide
    const installBtn = screen.getByText('Install');
    await act(async () => { fireEvent.click(installBtn); });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
