/**
 * Coach dashboard rules (deterministic, no AI). Every status comes with the reasons behind it,
 * so a coach sees WHY a client is flagged. Thresholds live here in one place.
 */

export interface ClientMetrics {
  share_scope: Record<string, boolean>;
  link_status: string;
  days_in_window: number;
  days_logged: number | null;
  avg_cal: number | null;
  avg_protein: number | null;
  target_cal: number | null;
  target_protein: number | null;
  energy_checkins: number | null;
  energy_avg: number | null;
  energy_prev_avg: number | null;
  last_activity: string | null;
}

export type ClientStatus = 'attention' | 'drifting' | 'on_track' | 'no_activity' | 'paused';
export interface Reason { signal: string; severity: 'attention' | 'drifting'; text: string }

export const RULES = {
  loggingAttentionMax: 2,   // logged on 2 or fewer of the days
  loggingDriftMax: 4,       // 3-4 days: drifting
  proteinAttention: 0.6,    // below 60% of target
  proteinDrift: 0.8,        // 60-80%
  calLow: 0.7, calHigh: 1.3,        // outside = attention
  calDriftLow: 0.85, calDriftHigh: 1.15, // outside = drifting
  energyDropAttention: 0.2, // energy average fell by 20% or more
  energyDropDrift: 0.1,
  silentDays: 7,
} as const;

export const pct = (actual: number | null, target: number | null): number | null =>
  actual == null || !target ? null : Math.round((actual / target) * 100);

export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

export function classify(m: ClientMetrics, now: Date = new Date()): { status: ClientStatus; reasons: Reason[] } {
  if (m.link_status === 'paused') return { status: 'paused', reasons: [] };
  const reasons: Reason[] = [];
  const n = m.days_in_window;
  const foodShared = !!m.share_scope.food;
  const silent = daysSince(m.last_activity, now);

  if (foodShared) {
    const logged = m.days_logged ?? 0;
    if (logged === 0 && (silent == null || silent >= RULES.silentDays)) {
      return { status: 'no_activity', reasons: [{ signal: 'logging_stopped', severity: 'attention', text: silent == null ? 'Nothing logged yet.' : `No activity for ${silent} days.` }] };
    }
    if (logged <= RULES.loggingAttentionMax) reasons.push({ signal: 'logging_decline', severity: 'attention', text: `Logged on ${logged} of ${n} days.` });
    else if (logged <= RULES.loggingDriftMax) reasons.push({ signal: 'logging_decline', severity: 'drifting', text: `Logged on ${logged} of ${n} days.` });

    const protein = m.avg_protein != null && m.target_protein ? m.avg_protein / m.target_protein : null;
    if (protein != null && logged > 0) {
      const t = `Protein ${Math.round(protein * 100)}% of target (${Math.round(m.avg_protein!)}g of ${m.target_protein}g).`;
      if (protein < RULES.proteinAttention) reasons.push({ signal: 'protein_deviation', severity: 'attention', text: t });
      else if (protein < RULES.proteinDrift) reasons.push({ signal: 'protein_deviation', severity: 'drifting', text: t });
    }
    const cal = m.avg_cal != null && m.target_cal ? m.avg_cal / m.target_cal : null;
    if (cal != null && logged > 0) {
      const t = `Calories ${Math.round(cal * 100)}% of target (${Math.round(m.avg_cal!)} of ${m.target_cal} kcal a logged day).`;
      if (cal < RULES.calLow || cal > RULES.calHigh) reasons.push({ signal: 'calorie_deviation', severity: 'attention', text: t });
      else if (cal < RULES.calDriftLow || cal > RULES.calDriftHigh) reasons.push({ signal: 'calorie_deviation', severity: 'drifting', text: t });
    }
  }
  if (m.share_scope.energy && m.energy_avg != null && m.energy_prev_avg != null && m.energy_prev_avg > 0) {
    const drop = (m.energy_prev_avg - m.energy_avg) / m.energy_prev_avg;
    const t = `Energy average fell ${Math.round(drop * 100)}% (${m.energy_prev_avg.toFixed(1)} to ${m.energy_avg.toFixed(1)} on a 1-3 scale).`;
    if (drop >= RULES.energyDropAttention) reasons.push({ signal: 'energy_decline', severity: 'attention', text: t });
    else if (drop >= RULES.energyDropDrift) reasons.push({ signal: 'energy_decline', severity: 'drifting', text: t });
  }
  const status: ClientStatus = reasons.some(r => r.severity === 'attention') ? 'attention' : reasons.length ? 'drifting' : 'on_track';
  return { status, reasons };
}

export const STATUS_ORDER: Record<ClientStatus, number> = { attention: 0, drifting: 1, no_activity: 2, on_track: 3, paused: 4 };
