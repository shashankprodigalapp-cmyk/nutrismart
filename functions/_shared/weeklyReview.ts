/**
 * Weekly review logic. The NUMBERS are facts computed by the database; this file turns them into
 * sentences (rules), builds the small context the AI may see, and checks anything the AI writes.
 * The AI never does arithmetic and never sees names, emails or raw logs.
 */

export interface WeeklyRow {
  week_start: string; days_elapsed: number; days_logged: number;
  avg_calories: number | null; avg_protein: number | null;
  calorie_adherence: number | null; protein_adherence: number | null; macro_adherence: number | null;
  logging_adherence: number | null; checkin_adherence: number | null; flexible_adherence: number | null;
  energy_checkins: number; energy_avg: number | null; water_avg: number | null;
  flexible_planned: number; flexible_consumed: number;
}
export interface Targets { calories: number | null; protein: number | null }
export interface Fact {
  id: string; metric: string; text: string;
  value: number | null; prev: number | null; delta: number | null; unit: string;
  good: boolean | null;
}
export interface Item { text: string; fact_ids: string[] }
export interface Sections {
  headline: Item; wins: Item[]; challenges: Item[]; nutrition: Item[]; adherence: Item[];
  energy: Item[]; flexible_meals: Item[]; patterns: Item[]; next_week_focus: Item[]; coach_conversation: Item;
}

export const MIN_LOGGED_DAYS_FOR_AI = 3;
const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (v == null || v === '' ? null : isFinite(Number(v)) ? Number(v) : null);

export function normalizeRow(r: Record<string, unknown> | null | undefined): WeeklyRow | null {
  if (!r) return null;
  return {
    week_start: String(r.week_start), days_elapsed: Number(r.days_elapsed ?? 7), days_logged: Number(r.days_logged ?? 0),
    avg_calories: num(r.avg_calories), avg_protein: num(r.avg_protein),
    calorie_adherence: num(r.calorie_adherence), protein_adherence: num(r.protein_adherence), macro_adherence: num(r.macro_adherence),
    logging_adherence: num(r.logging_adherence), checkin_adherence: num(r.checkin_adherence), flexible_adherence: num(r.flexible_adherence),
    energy_checkins: Number(r.energy_checkins ?? 0), energy_avg: num(r.energy_avg), water_avg: num(r.water_avg),
    flexible_planned: Number(r.flexible_planned ?? 0), flexible_consumed: Number(r.flexible_consumed ?? 0),
  };
}

function trend(cur: number | null, prev: number | null): number | null {
  return cur != null && prev != null ? r1(cur - prev) : null;
}
const points = (d: number | null) => (d == null ? '' : d === 0 ? ', same as last week' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(r0(d))} points from last week`);

export function buildFacts(cur: WeeklyRow, prev: WeeklyRow | null, t: Targets): Fact[] {
  const f: Fact[] = [];
  const n = cur.days_elapsed;
  f.push({ id: 'logging', metric: 'logging_adherence', value: cur.days_logged, prev: prev?.days_logged ?? null, delta: null, unit: 'days', good: cur.days_logged >= Math.ceil(n * 0.7),
    text: `Food was logged on ${cur.days_logged} of ${n} days` });
  if (cur.days_logged > 0) {
    if (cur.avg_calories != null) f.push({ id: 'calories_avg', metric: 'avg_calories', value: r0(cur.avg_calories), prev: prev?.avg_calories != null ? r0(prev.avg_calories) : null, delta: null, unit: 'kcal', good: null,
      text: `Average intake was ${r0(cur.avg_calories)} kcal on logged days${t.calories ? ` (target ${t.calories} kcal)` : ''}` });
    if (cur.calorie_adherence != null) f.push({ id: 'calorie_adherence', metric: 'calorie_adherence', value: r0(cur.calorie_adherence), prev: prev?.calorie_adherence != null ? r0(prev.calorie_adherence) : null, delta: trend(cur.calorie_adherence, prev?.calorie_adherence ?? null), unit: '%', good: cur.calorie_adherence >= 80,
      text: `Calorie adherence was ${r0(cur.calorie_adherence)}%${points(trend(cur.calorie_adherence, prev?.calorie_adherence ?? null))}` });
    if (cur.avg_protein != null) f.push({ id: 'protein_avg', metric: 'avg_protein', value: r0(cur.avg_protein), prev: prev?.avg_protein != null ? r0(prev.avg_protein) : null, delta: null, unit: 'g', good: null,
      text: `Average protein was ${r0(cur.avg_protein)}g on logged days${t.protein ? ` (target ${t.protein}g)` : ''}` });
    if (cur.protein_adherence != null) f.push({ id: 'protein_adherence', metric: 'protein_adherence', value: r0(cur.protein_adherence), prev: prev?.protein_adherence != null ? r0(prev.protein_adherence) : null, delta: trend(cur.protein_adherence, prev?.protein_adherence ?? null), unit: '%', good: cur.protein_adherence >= 80,
      text: `Protein adherence was ${r0(cur.protein_adherence)}%${points(trend(cur.protein_adherence, prev?.protein_adherence ?? null))}` });
  }
  if (cur.energy_checkins > 0 && cur.energy_avg != null) {
    const d = trend(cur.energy_avg, prev?.energy_avg ?? null);
    f.push({ id: 'energy', metric: 'energy_avg', value: cur.energy_avg, prev: prev?.energy_avg ?? null, delta: d, unit: 'of 3', good: d == null ? null : d >= 0,
      text: `Energy averaged ${cur.energy_avg.toFixed(1)} out of 3 across ${cur.energy_checkins} check-ins${d == null ? '' : d === 0 ? ', same as last week' : `, ${d > 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)} from last week`}` });
  } else {
    f.push({ id: 'checkins', metric: 'checkin_adherence', value: cur.energy_checkins, prev: prev?.energy_checkins ?? null, delta: null, unit: 'check-ins', good: null,
      text: `${cur.energy_checkins} energy check-ins were given` });
  }
  if (cur.water_avg != null) f.push({ id: 'water', metric: 'water_avg', value: cur.water_avg, prev: prev?.water_avg ?? null, delta: null, unit: 'glasses', good: null, text: `Water averaged ${cur.water_avg.toFixed(1)} glasses a day` });
  if (cur.flexible_planned > 0) f.push({ id: 'flexible', metric: 'flexible_adherence', value: cur.flexible_consumed, prev: null, delta: null, unit: 'meals', good: null,
    text: `${cur.flexible_planned} flexible meal${cur.flexible_planned === 1 ? ' was' : 's were'} planned and ${cur.flexible_consumed} eaten` });
  return f;
}

export async function hashFacts(facts: Fact[], extra: unknown = ''): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify([facts.map(f => [f.id, f.value, f.prev, f.text]), extra]));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

export function confidenceFor(daysLogged: number): 'insufficient' | 'early' | 'emerging' | 'repeated' {
  return daysLogged < 3 ? 'insufficient' : daysLogged < 7 ? 'early' : daysLogged < 15 ? 'emerging' : 'repeated';
}

const item = (text: string, ...ids: string[]): Item => ({ text, fact_ids: ids });

/** Plain-wording review made only from the facts. Used when AI is off, unavailable, or there is too little data. */
export function ruleSections(facts: Fact[], cur: WeeklyRow): Sections {
  const by = new Map(facts.map(f => [f.id, f]));
  const wins: Item[] = []; const challenges: Item[] = [];
  for (const f of facts) {
    if (f.good === true) wins.push(item(f.text + '.', f.id));
    if (f.good === false) challenges.push(item(f.text + '.', f.id));
  }
  const nutrition = ['calories_avg', 'protein_avg'].filter(i => by.has(i)).map(i => item(by.get(i)!.text + '.', i));
  const adherence = ['logging', 'calorie_adherence', 'protein_adherence'].filter(i => by.has(i)).map(i => item(by.get(i)!.text + '.', i));
  const energy = ['energy', 'checkins'].filter(i => by.has(i)).map(i => item(by.get(i)!.text + '.', i));
  const flexible = by.has('flexible') ? [item(by.get('flexible')!.text + '.', 'flexible')] : [];

  const few = cur.days_logged < MIN_LOGGED_DAYS_FOR_AI;
  const logging = by.get('logging')!;
  const headline = few
    ? item(`${logging.text}. That is too little to say much yet.`, 'logging')
    : item(`${logging.text}. ${by.get('protein_adherence') ? by.get('protein_adherence')!.text + '.' : ''}`.trim(), ...(by.has('protein_adherence') ? ['logging', 'protein_adherence'] : ['logging']));

  const focus: Item[] = [];
  if (logging.good === false) focus.push(item('Log food on more days next week, even a quick entry.', 'logging'));
  else if (by.get('protein_adherence')?.good === false) focus.push(item('Add a protein source to your main meals next week.', 'protein_adherence'));
  else if (by.get('calorie_adherence')?.good === false) focus.push(item('Aim to land closer to your calorie target on most days.', 'calorie_adherence'));
  else focus.push(item('Keep doing what worked this week.', 'logging'));

  const topChallenge = challenges[0];
  const coach = topChallenge
    ? item(`Ask how this went: "${topChallenge.text.replace(/\.$/, '')}". What got in the way?`, ...topChallenge.fact_ids)
    : item('Ask what felt easiest this week and what to build on.', 'logging');

  return {
    headline, wins: wins.slice(0, 4), challenges: challenges.slice(0, 4), nutrition, adherence, energy, flexible_meals: flexible,
    patterns: [item(few ? 'Not enough data yet to see personal patterns.' : 'Patterns need several weeks of data before we can say anything useful.')],
    next_week_focus: focus, coach_conversation: coach,
  };
}

/** What the AI may see: facts and the week label. No identity, no raw logs. */
export function buildAiContext(facts: Fact[], cur: WeeklyRow, goal: string | null) {
  return {
    period: { week_start: cur.week_start, days_covered: cur.days_elapsed },
    client_goal: goal,
    facts: facts.map(f => ({ id: f.id, text: f.text })),
  };
}

export function buildPrompt(ctx: ReturnType<typeof buildAiContext>): string {
  return `You write a short weekly nutrition review for a person using a food-tracking app. Use ONLY the facts below.
Rules:
- Every item must cite fact_ids from the list. Copy numbers exactly as written in the facts. Do not calculate or invent any number.
- Use cautious wording: "tends to", "this week", "we observed". Never say one thing caused another. No medical advice, no diagnosis.
- Warm, plain, encouraging. Short sentences. Maximum 3 items per list.
Return JSON only: {"headline":{"text":"","fact_ids":[]},"wins":[{"text":"","fact_ids":[]}],"challenges":[...],"next_week_focus":[...],"coach_conversation":{"text":"a question the coach could ask","fact_ids":[]}}
DATA: ${JSON.stringify(ctx)}`;
}

const BANNED = /\b(caused|causes|because of|due to|diagnos\w*|depress\w*|anxiety|disease|disorder|cure|treat(s|ed|ment)?)\b/i;
const numbersIn = (s: string) => (s.match(/\d+(\.\d+)?/g) ?? []);

/** Keep an AI item only if it cites real facts, repeats only numbers from those facts, and avoids causal or medical claims. */
export function validItem(it: unknown, facts: Fact[]): Item | null {
  if (!it || typeof it !== 'object') return null;
  const text = String((it as Item).text ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
  const ids = Array.isArray((it as Item).fact_ids) ? (it as Item).fact_ids.map(String) : [];
  if (!text || !ids.length || BANNED.test(text)) return null;
  const known = new Map(facts.map(f => [f.id, f]));
  if (!ids.every(i => known.has(i))) return null;
  const allowed = new Set(ids.flatMap(i => numbersIn(known.get(i)!.text)));
  if (!numbersIn(text).every(n => allowed.has(n))) return null;
  return { text, fact_ids: ids };
}

export function validateAi(raw: unknown, facts: Fact[], fallback: Sections): { sections: Sections; kept: number; dropped: number } {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let kept = 0, dropped = 0;
  const list = (v: unknown): Item[] => {
    const out: Item[] = [];
    for (const x of Array.isArray(v) ? v.slice(0, 3) : []) { const ok = validItem(x, facts); if (ok) { out.push(ok); kept++; } else dropped++; }
    return out;
  };
  const one = (v: unknown, fb: Item): Item => { const ok = validItem(v, facts); if (ok) { kept++; return ok; } dropped++; return fb; };
  const wins = list(o.wins), challenges = list(o.challenges), focus = list(o.next_week_focus);
  const sections: Sections = {
    ...fallback,
    headline: one(o.headline, fallback.headline),
    wins: wins.length ? wins : fallback.wins, challenges: challenges.length ? challenges : fallback.challenges,
    next_week_focus: focus.length ? focus : fallback.next_week_focus,
    coach_conversation: one(o.coach_conversation, fallback.coach_conversation),
  };
  return { sections, kept, dropped };
}

/** Use the AI version only when most of it survived the checks. */
export const aiAcceptable = (kept: number, dropped: number) => kept >= 3 && kept >= dropped;
