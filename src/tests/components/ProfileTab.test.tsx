/**
 * ProfileTab.test.tsx
 *
 * Tests all interactive behaviours of the Profile tab:
 *
 * Settings rows:
 *   1. "Nutrition Goals" row is clickable and opens NutritionGoalsModal
 *   2. "Notifications" row opens NotificationsModal
 *   3. "Data & Privacy" row opens DataPrivacyModal
 *
 * NutritionGoalsModal:
 *   4. Renders current goal values in inputs
 *   5. GoalField inputs remain focusable / retain value on change
 *      (regression: input was inside modal → remounted on every render)
 *   6. Save button calls Supabase update with correct payload
 *   7. Save button dispatches 'nutrismart:targets-updated' window event
 *   8. Error message shown when Supabase update fails
 *   9. Cancel button closes modal without saving
 *
 * NotificationsModal:
 *   10. "Enable" button calls Notification.requestPermission()
 *   11. Shows "On" badge when permission already granted
 *
 * DataPrivacyModal:
 *   12. "Privacy Policy" link rendered with correct href
 *   13. "Request Deletion" mailto link rendered
 *
 * Sign out:
 *   14. Sign Out button calls signOut()
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileTab from '../../pages/tabs/ProfileTab';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockUser = { id: 'user-abc', email: 'user@example.com', user_metadata: { name: 'Riya Sharma' }, created_at: '2024-01-15T00:00:00Z' };

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, signOut: mockSignOut }),
}));

let supabaseUpdateError: null | { message: string } = null;
const mockSupabaseUpdate = vi.fn();

vi.mock('../../lib/supabase', () => {
  function makeBuilder(): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    b.from   = () => makeBuilder();
    b.select = () => makeBuilder();
    b.eq     = () => makeBuilder();
    b.upsert = () => Promise.resolve({ data: null, error: null });
    b.maybeSingle = () => Promise.resolve({
      data: {
        name: 'Riya Sharma',
        plan: 'free',
        created_at: '2024-01-15T00:00:00Z',
        target_cal: 1800,
        target_protein: 100,
        target_fat: 55,
        target_gl: 70,
        target_water: 6,
      },
      error: null,
    });
    // update().eq() → Promise
    b.update = (payload: unknown) => {
      mockSupabaseUpdate(payload);
      const afterUpdate: Record<string, unknown> = {};
      afterUpdate.eq = () => Promise.resolve({ error: supabaseUpdateError });
      return afterUpdate;
    };
    return b;
  }
  return {
    supabase: {
      ...makeBuilder(),
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      },
    },
  };
});

// ── Notification API mock ─────────────────────────────────────────────────

const mockRequestPermission = vi.fn();

function setNotificationPermission(perm: NotificationPermission) {
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    value: {
      permission: perm,
      requestPermission: mockRequestPermission,
    },
  });
}

// ── Helper ─────────────────────────────────────────────────────────────────

async function renderProfileTab() {
  const utils = render(<ProfileTab />);
  // Wait for profile name to appear (loading done — supabase.maybeSingle resolved)
  await waitFor(() => {
    expect(screen.getByText('Riya Sharma')).toBeTruthy();
  }, { timeout: 2000 });
  return utils;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ProfileTab — settings rows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseUpdateError = null;
    setNotificationPermission('default');
  });

  it('Nutrition Goals row is clickable and opens the modal', async () => {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Nutrition Goals'));
    expect(screen.getByText('Save Goals')).toBeTruthy();
  });

  it('Notifications row opens NotificationsModal', async () => {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Notifications'));
    expect(screen.getByText('Push Notifications')).toBeTruthy();
  });

  it('Data & Privacy row opens DataPrivacyModal', async () => {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Data & Privacy'));
    expect(screen.getByText('Privacy Policy ↗')).toBeTruthy();
  });

  it('Sign Out button calls signOut()', async () => {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Sign Out'));
    expect(mockSignOut).toHaveBeenCalledOnce();
  });
});

describe('NutritionGoalsModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    supabaseUpdateError = null;
  });

  async function openGoalsModal() {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Nutrition Goals'));
    // Modal should now be open
    await waitFor(() => expect(screen.getByText('Save Goals')).toBeTruthy());
  }

  it('shows current goal values in inputs (from fetched profile)', async () => {
    await openGoalsModal();
    const calInput = screen.getByDisplayValue('1800');
    expect(calInput).toBeTruthy();
    expect(screen.getByDisplayValue('100')).toBeTruthy(); // protein
    expect(screen.getByDisplayValue('55')).toBeTruthy();  // fat
    expect(screen.getByDisplayValue('70')).toBeTruthy();  // gl
    expect(screen.getByDisplayValue('6')).toBeTruthy();   // water
  });

  it('GoalField input retains value on change (focus regression test)', async () => {
    await openGoalsModal();
    const calInput = screen.getByDisplayValue('1800') as HTMLInputElement;

    // Simulating typing — input should stay focused and update value
    await userEvent.clear(calInput);
    await userEvent.type(calInput, '2200');

    expect(calInput.value).toBe('2200');
  });

  it('Save Goals calls Supabase update with correct payload', async () => {
    await openGoalsModal();

    // Modify calories to 2200
    const calInput = screen.getByDisplayValue('1800') as HTMLInputElement;
    await userEvent.clear(calInput);
    await userEvent.type(calInput, '2200');

    await act(async () => { fireEvent.click(screen.getByText('Save Goals')); });

    await waitFor(() => {
      expect(mockSupabaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ target_cal: 2200 })
      );
    });
  });

  it('Save Goals dispatches nutrismart:targets-updated window event', async () => {
    await openGoalsModal();

    const eventSpy = vi.fn();
    window.addEventListener('nutrismart:targets-updated', eventSpy);

    await act(async () => { fireEvent.click(screen.getByText('Save Goals')); });

    await waitFor(() => {
      expect(eventSpy).toHaveBeenCalled();
    });

    window.removeEventListener('nutrismart:targets-updated', eventSpy);
  });

  it('shows error message when Supabase update fails', async () => {
    supabaseUpdateError = { message: 'DB error' };
    await openGoalsModal();

    await act(async () => { fireEvent.click(screen.getByText('Save Goals')); });

    await waitFor(() => {
      expect(screen.getByText('Failed to save. Please try again.')).toBeTruthy();
    });
  });

  it('Cancel button closes modal without saving', async () => {
    await openGoalsModal();
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('Save Goals')).toBeNull();
    expect(mockSupabaseUpdate).not.toHaveBeenCalled();
  });
});

describe('NotificationsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Enable button calls Notification.requestPermission()', async () => {
    setNotificationPermission('default');
    mockRequestPermission.mockResolvedValue('granted');
    await renderProfileTab();
    fireEvent.click(screen.getByText('Notifications'));
    await waitFor(() => expect(screen.getByText('Enable')).toBeTruthy());

    await act(async () => { fireEvent.click(screen.getByText('Enable')); });

    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it('shows "On" badge when Notification.permission is already granted', async () => {
    setNotificationPermission('granted');
    await renderProfileTab();
    fireEvent.click(screen.getByText('Notifications'));
    await waitFor(() => expect(screen.getByText('On')).toBeTruthy());
  });
});

describe('DataPrivacyModal', () => {
  it('Privacy Policy link has correct href', async () => {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Data & Privacy'));
    const link = screen.getByText('Privacy Policy ↗').closest('a') as HTMLAnchorElement;
    expect(link.href).toContain('/legal/privacy.html');
  });

  it('Request Deletion link is a mailto link', async () => {
    await renderProfileTab();
    fireEvent.click(screen.getByText('Data & Privacy'));
    const link = screen.getByText('Request Deletion').closest('a') as HTMLAnchorElement;
    expect(link.href).toContain('mailto:');
  });
});
