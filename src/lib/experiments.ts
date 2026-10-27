/**
 * Personal experiments (deterministic). Templates are fixed here, not written by AI. Results compare the person's own
 * numbers before and during the experiment and always say it is an observation, never proof of cause.
 */
export type MetricKey = 'energy' | 'mood' | 'hunger' | 'lower_energy_share' | 'protein' | 'logging';
export interface Template { key: string; title: string; goal: string; actions: string[]; metrics: MetricKey[] }

export const TEMPLATES: Template[] = [
  { key: 'afternoon_energy', title: 'Improve afternoon energy', goal: 'See whether a few small changes go with steadier energy after lunch.',
    actions: ['Protein-rich breakfast', 'Lunch at a regular time', 'Short walk after lunch', 'Usual bedtime'], metrics: ['energy', 'lower_energy_share', 'mood', 'hunger'] },
  { key: 'steadier_mood', title: 'Steadier mood', goal: 'See whether regular meals and good sleep go with better mood ratings.',
    actions: ['Do not skip breakfast', 'Eat 3 meals at regular times', 'Drink your water goal', 'Usual bedtime'], metrics: ['mood', 'energy', 'logging'] },
  { key: 'less_hunger', title: 'Feel less hungry between meals', goal: 'See whether more protein and fibre go with less hunger.',
    actions: ['Protein at every meal', 'Vegetables or salad with lunch and dinner', 'Drink water before snacks'], metrics: ['hunger', 'protein', 'logging'] },
  { key: 'consistent_logging', title: 'Log every day', goal: 'See how a simple daily habit changes your logging.',
    actions: ['Log each meal right after eating', 'Check in once in the morning'], metrics: ['logging', 'mood', 'energy'] },
];

export const METRIC_LABEL: Record<MetricKey, string> = {
  energy: 'Energy (morning check-in, 1 to 5)', mood: 'Mood (1 to 5)', hunger: 'Hunger (1 to 5)',
  lower_energy_share: 'Meals where energy felt lower (%)', protein: 'Protein (g a day)', logging: 'Days with food logged (%)',
};
/** Smallest change worth mentioning, per metric. Anything smaller is "about the same". */
export const MIN_CHANGE: Record<MetricKey, number> = { energy: 0.3, mood: 0.3, hunger: 0.3, lower_energy_share: 10, protein: 5, logging: 10 };
/** For these, a lower number is the better direction. */
const LOWER_IS_BETTER = new Set<MetricKey>(['hunger', 'lower_energy_share']);
export const MIN_POINTS = 3;

export interface DayValues { energy?: number | null; mood?: number | null; hunger?: number | null; lower_energy_share?: number | null; protein?: number | null; logging?: number | null }
export interface Exp { start_date: string; duration_days: number; baseline_days: number; status: 'active' | 'completed' | 'cancelled'; metrics: MetricKey[]; actions: string[] }
export interface MetricResult { key: MetricKey; label: string; before: number | null; during: number | null; nBefore: number; nDuring: number; change: number | null; verdict: 'higher' | 'lower' | 'same' | 'not_enough_data'; text: string }
export interface Evaluation {
  phase: 'not_started' | 'running' | 'finished'; dayNumber: number; daysLeft: number; end: string;
  adherencePct: number | null; metrics: MetricResult[]; summary: string;
}

const DAY = 86_400_000;
export const addDays = (iso: string, n: number) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);
const diffDays = (a: string, b: string) => Math.round((new Date(a + 'T00:00:00Z').getTime() - new Date(b + 'T00:00:00Z').getTime()) / DAY);
const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (k: MetricKey, v: number) => (k === 'protein' || k === 'lower_energy_share' || k === 'logging' ? String(Math.round(v)) : v.toFixed(1));

function mean(days: string[], values: Record<string, DayValues>, k: MetricKey): { avg: number | null; n: number } {
  const xs: number[] = [];
  for (const d of days) { const v = values[d]?.[k]; if (v != null && isFinite(v)) xs.push(v); }
  return { avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length };
}
const range = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

export function evaluate(e: Exp, values: Record<string, DayValues>, ticks: Record<string, number[]>, today: string): Evaluation {
  const end = addDays(e.start_date, e.duration_days - 1);
  const phase: Evaluation['phase'] = today < e.start_date ? 'not_started' : today > end || e.status !== 'active' ? 'finished' : 'running';
  const dayNumber = phase === 'not_started' ? 0 : Math.min(diffDays(today, e.start_date) + 1, e.duration_days);
  const duringTo = today < end ? today : end;
  const beforeDays = range(addDays(e.start_date, -e.baseline_days), addDays(e.start_date, -1));
  const duringDays = phase === 'not_started' ? [] : range(e.start_date, duringTo);

  const metrics: MetricResult[] = e.metrics.map(k => {
    const b = mean(beforeDays, values, k), d = mean(duringDays, values, k);
    const enough = b.n >= MIN_POINTS && d.n >= MIN_POINTS && b.avg != null && d.avg != null;
    const base = { key: k, label: METRIC_LABEL[k], before: b.avg == null ? null : r1(b.avg), during: d.avg == null ? null : r1(d.avg), nBefore: b.n, nDuring: d.n };
    if (!enough) return { ...base, change: null, verdict: 'not_enough_data' as const, text: `${METRIC_LABEL[k]}: not enough data yet (${b.n} days before, ${d.n} days during; at least ${MIN_POINTS} of each are needed).` };
    const change = r1(d.avg! - b.avg!);
    const verdict = Math.abs(change) < MIN_CHANGE[k] ? 'same' : change > 0 ? 'higher' : 'lower';
    const was = `${fmt(k, b.avg!)} before and ${fmt(k, d.avg!)} during the experiment`;
    return { ...base, change, verdict, text: `${METRIC_LABEL[k]}: averaged ${was}${verdict === 'same' ? ', about the same' : ''} (${b.n} days vs ${d.n} days).` };
  });

  let adherencePct: number | null = null;
  if (duringDays.length && e.actions.length) {
    const possible = duringDays.length * e.actions.length;
    const done = duringDays.reduce((s, d) => s + Math.min((ticks[d] ?? []).length, e.actions.length), 0);
    adherencePct = Math.round((done / possible) * 100);
  }

  const better = metrics.filter(m => m.verdict !== 'not_enough_data' && m.verdict !== 'same' && ((m.verdict === 'lower') === LOWER_IS_BETTER.has(m.key)));
  const worse = metrics.filter(m => m.verdict !== 'not_enough_data' && m.verdict !== 'same' && ((m.verdict === 'lower') !== LOWER_IS_BETTER.has(m.key)));
  const have = metrics.filter(m => m.verdict !== 'not_enough_data');
  let summary: string;
  if (phase === 'not_started') summary = 'This experiment starts soon.';
  else if (!have.length) summary = 'Not enough data yet to compare. Keep checking in; we need at least 3 days of each measure before and during.';
  else {
    const parts: string[] = [];
    if (better.length) parts.push(`${better.map(m => m.key === 'lower_energy_share' ? 'fewer low-energy meals' : m.key === 'hunger' ? 'less hunger' : m.key).join(', ')} moved in the direction you hoped for`);
    if (worse.length) parts.push(`${worse.map(m => m.key === 'lower_energy_share' ? 'more low-energy meals' : m.key === 'hunger' ? 'more hunger' : `${m.key} lower`).join(', ')} moved the other way`);
    if (!parts.length) parts.push('nothing changed much');
    summary = `Compared with the days before, ${parts.join(' and ')}. This is an observation from your own numbers, not proof that the steps caused it.`;
  }
  if (adherencePct != null && adherencePct < 50 && phase !== 'not_started') summary += ` You did about ${adherencePct}% of the steps, so this comparison says little about the plan itself.`;
  return { phase, dayNumber, daysLeft: phase === 'running' ? diffDays(end, today) : 0, end, adherencePct, metrics, summary };
}
