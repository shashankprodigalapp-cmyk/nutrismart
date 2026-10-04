/**
 * LogTab.tsx — wraps DashboardLogging and wires the post-meal energy check-in.
 *
 * When the user confirms a food entry:
 *   1. DashboardLogging calls onLogConfirmed(entry)
 *   2. LogTab calls scheduleEnergyCheckIn — writes a pending entry to Dexie user_prefs
 *      keyed as `energy_checkin_${date}_${meal}`, with show_after = now + 60 min
 *   3. EnergyCheckIn polls Dexie every 30s and shows the bottom sheet only when
 *      now >= show_after (i.e. ≥60 minutes after the meal was logged)
 *   4. After the FIRST food log this session, PushPermissionPrompt appears (1.5s delay)
 *      offering to enable push reminders for future check-ins.
 *
 * Multiple pending meals coexist safely — each has its own key.
 */

import React, { useCallback, useState } from 'react';
import { DashboardLogging }     from '../../components/DashboardLogging';
import { EnergyCheckIn, scheduleEnergyCheckIn } from '../../components/EnergyCheckIn';
import { PushPermissionPrompt } from '../../components/PushPermissionPrompt';
import type { LogEntry } from '../../lib/localDb';

export default function LogTab() {
  // Track whether the user has logged at least one food this session.
  // Used to trigger the push permission prompt at the right moment.
  const [hasLoggedOnce, setHasLoggedOnce] = useState(false);

  const handleLogConfirmed = useCallback(async (entry: LogEntry) => {
    // Mark first log (triggers push prompt after 1.5s)
    setHasLoggedOnce(true);

    try {
      await scheduleEnergyCheckIn({
        meal:      entry.meal,
        total_gl:  entry.gl   ?? 0,
        total_cal: entry.cal  ?? 0,
        food_name: entry.food_name,
      });
    } catch {
      // Non-fatal — check-in scheduling is best-effort
    }
  }, []);

  return (
    <>
      <DashboardLogging onLogConfirmed={handleLogConfirmed} />
      {/* Energy check-in: appears ≥60 min after a meal when app is open */}
      <EnergyCheckIn />
      {/* Push permission prompt: appears once after first food log this session */}
      <PushPermissionPrompt shouldPrompt={hasLoggedOnce} />
    </>
  );
}
