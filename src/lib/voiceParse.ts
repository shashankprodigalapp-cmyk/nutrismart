/**
 * Turns what a person said ("2 roti aur dal and a glass of chai") into a short list of food items.
 * Pure text rules, no AI, so the same sentence always gives the same list. The person confirms every item.
 */
export interface VoiceItem { raw: string; name: string; qty: number }

const MAX_ITEMS = 8;
const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, half: 0.5, quarter: 0.25,
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, chhah: 6, saat: 7, aath: 8, nau: 9, das: 10, aadha: 0.5, adha: 0.5,
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5, 'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10, 'आधा': 0.5, 'आधी': 0.5,
};
const DEVANAGARI_DIGITS = '०१२३४५६७८९';
const FILLERS = /\b(i|we)\s+(had|ate|have|eaten|took|drank)\b|\bmaine\b|\bmene\b|\bkhaya\b|\bpiya\b|\btoday\b|\bjust\b|\bplease\b|\bfor\s+(breakfast|lunch|dinner|snacks?)\b|\bin\s+the\s+(morning|afternoon|evening)\b|\bat\s+night\b|मैंने|खाया|पिया|आज|नाश्ते में|दोपहर में|रात में/gi;
const SPLIT = /\s*(?:,|;|\band\b|\baur\b|\bwith\b|\bplus\b|\bthen\b|&|\+|और|साथ|फिर)\s*/i;
const UNITS = /^(?:(?:cups?|glass(?:es)?|bowls?|plates?|katori(?:s)?|pieces?|slices?|spoons?|tbsp|tsp|pcs|nos?)\s+(?:of\s+)?|(?:कटोरी|गिलास|प्लेट|कप|टुकड़े?|चम्मच)\s+)/i;

function toAsciiDigits(s: string): string {
  return s.replace(/[०-९]/g, d => String(DEVANAGARI_DIGITS.indexOf(d)));
}

function parseOne(part: string): VoiceItem | null {
  let s = part.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const raw = s;
  let qty = 1;
  const m = s.match(/^(\d+(?:\.\d+)?)(?:\s*(?:x|×))?\s+(.*)$/i) ?? s.match(/^(\d+\/\d+)\s+(.*)$/);
  if (m) {
    qty = m[1].includes('/') ? Number(m[1].split('/')[0]) / Number(m[1].split('/')[1]) : Number(m[1]);
    s = m[2];
  } else {
    const [first, ...rest] = s.split(' ');
    const w = first.toLowerCase();
    if (rest.length && w in NUM_WORDS) { qty = NUM_WORDS[w]; s = rest.join(' '); if (w === 'a' && /^couple\b/i.test(s)) { qty = 2; s = s.replace(/^couple\s+(of\s+)?/i, ''); } }
  }
  s = s.replace(UNITS, '').replace(/^of\s+/i, '').trim();
  if (!s) return null;
  if (!isFinite(qty) || qty <= 0) qty = 1;
  qty = Math.min(Math.round(qty * 100) / 100, 20);
  return { raw, name: s, qty };
}

export function parseUtterance(text: string): VoiceItem[] {
  const clean = toAsciiDigits(String(text ?? '')).replace(FILLERS, ' ').replace(/(?<!\d)[.!?]+|[.!?]+(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const out: VoiceItem[] = [];
  for (const part of clean.split(SPLIT)) {
    const it = parseOne(part);
    if (it && it.name.length >= 2 && it.name.length <= 60) out.push(it);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}
