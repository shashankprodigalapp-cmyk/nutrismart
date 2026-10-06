/**
 * targetsUpdatedEvent.test.ts
 *
 * Tests the 'nutrismart:targets-updated' custom event mechanism that
 * DashboardLogging uses to re-fetch nutrition targets after ProfileTab saves
 * new goals.
 *
 * We test the event plumbing directly (add listener → dispatch event → confirm
 * listener fires) since DashboardLogging is a large component that depends on
 * many Supabase queries and would require extensive mocking.
 *
 * These tests verify:
 *   1. Listener fires when event is dispatched
 *   2. Listener is removed on cleanup (no memory leak / stale calls)
 *   3. Multiple dispatches call the listener each time
 *   4. Listener does NOT fire before the event is dispatched
 */

import { describe, it, expect, vi } from 'vitest';

const EVENT_NAME = 'nutrismart:targets-updated';

describe('nutrismart:targets-updated event mechanism', () => {
  it('listener fires when event is dispatched', () => {
    const listener = vi.fn();
    window.addEventListener(EVENT_NAME, listener);
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(EVENT_NAME, listener);
  });

  it('listener does NOT fire before the event is dispatched', () => {
    const listener = vi.fn();
    window.addEventListener(EVENT_NAME, listener);
    // Don't dispatch
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener(EVENT_NAME, listener);
  });

  it('listener fires on every dispatch', () => {
    const listener = vi.fn();
    window.addEventListener(EVENT_NAME, listener);
    window.dispatchEvent(new Event(EVENT_NAME));
    window.dispatchEvent(new Event(EVENT_NAME));
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(listener).toHaveBeenCalledTimes(3);
    window.removeEventListener(EVENT_NAME, listener);
  });

  it('removed listener does NOT fire after cleanup', () => {
    const listener = vi.fn();
    window.addEventListener(EVENT_NAME, listener);
    window.removeEventListener(EVENT_NAME, listener);
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(listener).not.toHaveBeenCalled();
  });

  it('second listener fires independently of first', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    window.addEventListener(EVENT_NAME, l1);
    window.addEventListener(EVENT_NAME, l2);
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
    window.removeEventListener(EVENT_NAME, l1);
    window.removeEventListener(EVENT_NAME, l2);
  });

  it('simulates DashboardLogging useEffect registration / cleanup pattern', () => {
    const fetchTargets = vi.fn();

    // Simulate useEffect: register on mount
    window.addEventListener(EVENT_NAME, fetchTargets);

    // Simulate ProfileTab saving goals
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(fetchTargets).toHaveBeenCalledOnce();

    // Simulate useEffect cleanup on unmount
    window.removeEventListener(EVENT_NAME, fetchTargets);

    // Dispatch again — should NOT call the stale listener
    window.dispatchEvent(new Event(EVENT_NAME));
    expect(fetchTargets).toHaveBeenCalledOnce(); // still once, not twice
  });
});

// ── Integration: NutritionGoalsModal dispatches event after save ───────────
// This is verified in ProfileTab.test.tsx (Save Goals dispatches event test).
// The tests here confirm the listener side behaves correctly in isolation.
