/**
 * OnboardingPage.test.tsx
 *
 * Tests the 3-step onboarding flow:
 *   1. Question 1 renders with correct options
 *   2. Next button disabled until an option is selected
 *   3. Selecting an option enables Next
 *   4. Next advances to question 2, then question 3
 *   5. "Build my Kitchen Profile" button triggers save + markKitchenProfileDone + navigate
 *   6. On save error, markKitchenProfileDone is still called (loop prevention)
 *   7. Progress bar shows correct step
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OnboardingPage from '../../pages/OnboardingPage';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockMarkKitchenProfileDone = vi.fn();
const mockUser = { id: 'user-123', email: 'test@test.com' };

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    markKitchenProfileDone: mockMarkKitchenProfileDone,
  }),
}));

// supabaseMockThrow: when true, upsert() rejects (simulates a thrown network error)
// that triggers the catch block in OnboardingPage.handleNext
let supabaseMockThrow = false;

vi.mock('../../lib/supabase', () => {
  // Chainable builder. upsert/insert resolve normally.
  // Set supabaseMockThrow = true to make upsert reject (simulates network error).
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    b.from       = () => makeBuilder();
    b.select     = () => makeBuilder();
    b.eq         = () => makeBuilder();
    b.upsert     = (_d: unknown, _o?: unknown) =>
      supabaseMockThrow
        ? Promise.reject(new Error('Network error'))
        : Promise.resolve({ data: null, error: null });
    b.insert     = (_d: unknown) => Promise.resolve({ data: null, error: null });
    b.update     = (_d: unknown) => makeBuilder();
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    return b;
  }
  const root = makeBuilder();
  return {
    supabase: {
      ...root,
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    },
  };
});

vi.mock('../../lib/localDb', () => ({
  localDb: {
    user_prefs: {
      put:   vi.fn().mockResolvedValue(undefined),
      get:   vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('../../lib/kitchenIntelligence', () => ({
  buildKitchenProfile:          vi.fn().mockReturnValue({ home_mult: 1.1, rest_mult: 1.3 }),
  formatMultiplierForDisplay:   vi.fn().mockReturnValue('1.10×'),
}));

// ── Helper ─────────────────────────────────────────────────────────────────

function renderOnboarding() {
  return render(
    <MemoryRouter>
      <OnboardingPage />
    </MemoryRouter>
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMockThrow = false;
  });

  it('renders question 1 (oil usage) on mount', () => {
    renderOnboarding();
    expect(screen.getByText('How much oil / ghee per dish?')).toBeTruthy();
    expect(screen.getByText('Kitchen Intelligence · 1 of 3')).toBeTruthy();
  });

  it('Next button is disabled until an option is selected', () => {
    renderOnboarding();
    const nextBtn = screen.getByText('Next →');
    expect((nextBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('selecting an option enables the Next button', () => {
    renderOnboarding();
    // Click "Moderate" option
    fireEvent.click(screen.getByText('Moderate'));
    const nextBtn = screen.getByText('Next →');
    expect((nextBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking Next advances to question 2', () => {
    renderOnboarding();
    fireEvent.click(screen.getByText('Moderate'));
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('Who usually cooks at home?')).toBeTruthy();
    expect(screen.getByText('Kitchen Intelligence · 2 of 3')).toBeTruthy();
  });

  it('clicking Next on Q2 advances to question 3', () => {
    renderOnboarding();
    // Q1
    fireEvent.click(screen.getByText('Moderate'));
    fireEvent.click(screen.getByText('Next →'));
    // Q2
    fireEvent.click(screen.getByText('I cook'));
    fireEvent.click(screen.getByText('Next →'));
    // Q3
    expect(screen.getByText('Describe your cooking style')).toBeTruthy();
    expect(screen.getByText('Kitchen Intelligence · 3 of 3')).toBeTruthy();
  });

  it('final step shows "Build my Kitchen Profile" button', () => {
    renderOnboarding();
    fireEvent.click(screen.getByText('Moderate'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('I cook'));
    fireEvent.click(screen.getByText('Next →'));
    expect(screen.getByText('Build my Kitchen Profile')).toBeTruthy();
  });

  it('successful save calls markKitchenProfileDone and navigates to /app/today', async () => {
    renderOnboarding();
    // Navigate through all 3 questions
    fireEvent.click(screen.getByText('Moderate'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('I cook'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('Mixed'));

    // Submit
    await act(async () => {
      fireEvent.click(screen.getByText('Build my Kitchen Profile'));
    });

    await waitFor(() => {
      expect(mockMarkKitchenProfileDone).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/app/today', { replace: true });
    });
  });

  it('on thrown save error, markKitchenProfileDone is still called (prevents redirect loop)', async () => {
    // Make upsert reject to trigger the catch block in OnboardingPage
    supabaseMockThrow = true;

    renderOnboarding();
    fireEvent.click(screen.getByText('Moderate'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('I cook'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('Mixed'));

    await act(async () => {
      fireEvent.click(screen.getByText('Build my Kitchen Profile'));
    });

    await waitFor(() => {
      // markKitchenProfileDone must be called even on error path (line 106 in OnboardingPage)
      expect(mockMarkKitchenProfileDone).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/app/today', { replace: true });
    });
  });

  it('shows kitchen multiplier preview after all 3 questions answered', () => {
    renderOnboarding();
    fireEvent.click(screen.getByText('Moderate'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('I cook'));
    fireEvent.click(screen.getByText('Next →'));
    fireEvent.click(screen.getByText('Mixed'));

    // formatMultiplierForDisplay is mocked to return '1.10×'
    expect(screen.getByText('1.10×')).toBeTruthy();
  });
});
