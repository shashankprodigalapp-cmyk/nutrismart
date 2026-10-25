/**
 * A quick, free check before any AI call: does this look like something a person could eat or drink?
 * It only catches the obvious (greetings, single letters, keyboard mash, links). The AI does the finer check.
 * Keep this file identical in functions/_shared/foodQuery.ts and src/lib/foodQuery.ts.
 */
const NOT_FOOD = new Set([
  'hi', 'hii', 'hiii', 'hello', 'hey', 'heyy', 'yo', 'test', 'testing', 'ok', 'okay', 'yes', 'no', 'asdf', 'asdfgh', 'qwerty',
  'abc', 'xyz', 'lol', 'haha', 'thanks', 'thank you', 'bye', 'help', 'good morning', 'good evening', 'good night',
  'what', 'who', 'why', 'how', 'nothing', 'none', 'na', 'n/a', 'null', 'undefined', 'random', 'something', 'food',
]);

/** Adult words and swear words (English and Hindi). Blocked for free, in names and in descriptions. */
const ADULT_WORDS = new Set([
  'sex', 'sexy', 'sexual', 'porn', 'porno', 'nude', 'nudes', 'naked', 'xxx', 'nsfw', 'horny', 'erotic', 'fetish', 'slut', 'whore', 'hooker',
  'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'pussy', 'cunt', 'rape', 'incest',
  'chutiya', 'madarchod', 'behenchod', 'bhenchod', 'bhosdi', 'bhosdike', 'gaand', 'gandu', 'randi', 'harami', 'lauda', 'lund', 'chut',
]);

/** Common words that are never a food. Blocked for free in food names only. */
const NON_FOOD_WORDS = new Set([
  'bitcoin', 'crypto', 'ethereum', 'phone', 'iphone', 'android', 'laptop', 'computer', 'car', 'bike', 'google', 'facebook', 'whatsapp',
  'instagram', 'youtube', 'twitter', 'netflix', 'password', 'passwd', 'girlfriend', 'boyfriend', 'love', 'money', 'politics', 'election',
  'modi', 'trump', 'god', 'weather', 'news', 'movie', 'song', 'poem', 'joke', 'story', 'essay', 'code', 'python', 'javascript', 'hack',
  'virus', 'gun', 'bomb', 'kill', 'murder', 'suicide', 'drugs', 'cocaine', 'heroin', 'weed', 'ganja', 'charas', 'viagra', 'casino', 'bet',
]);

function hasWordIn(set: Set<string>, text: string): boolean {
  return text.toLowerCase().split(/[^a-z0-9ऀ-ॿ઀-૿]+/).some(w => w && set.has(w));
}

/** True when any word, or the whole text, is on the admin's block list (terms the admin chose to block). */
export function hitsBlockedTerm(raw: string, blocked: Set<string>): boolean {
  if (!blocked.size) return false;
  const key = normalizeFoodKey(raw);
  return blocked.has(key) || key.split(' ').some(w => blocked.has(w));
}

export const NOT_FOOD_MESSAGE = 'That does not look like a food. Type a dish or ingredient, like "paneer bhurji" or "2 rotis".';

/** Phrases people use to try to talk the AI into doing something other than looking up a food. */
const INJECTION = /(ignore|disregard|forget)\b.{0,25}\b(previous|above|prior|earlier|all|your)|system prompt|you are (now|a|an)\b|act as\b|pretend\b|jailbreak|developer mode|\binstructions?\b|\bprompt\b|as an ai\b|reveal|override|\bsudo\b|\bapi[ _-]?key\b|\bpassword\b|\bwrite (me )?(a|an|some)\b|\btranslate\b|\bexplain\b/i;

export function looksLikeInjection(raw: string): boolean {
  return INJECTION.test(raw ?? '');
}

/** Tidy what the person typed: no control characters, quotes, brackets or backticks; one space between words. */
export function cleanQuery(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202f\u2060\ufeff]/g, ' ')
    .replace(/["'`\\{}\[\]<>|^~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Same food, same key: lower case, no punctuation, one space. Used to find a food already in the database. */
export function normalizeFoodKey(raw: string): string {
  return cleanQuery(raw).toLowerCase().replace(/[^a-z0-9ऀ-ॿ઀-૿ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Clean text that came back from the AI before it is saved or shown. */
export function cleanAiText(raw: unknown, max: number): string {
  const t = cleanQuery(typeof raw === 'string' ? raw : '').slice(0, max);
  return /https?:|www\./i.test(t) || looksLikeInjection(t) ? '' : t;
}

export function plausibleFoodQuery(raw: string): boolean {
  const t = cleanQuery(raw).toLowerCase();
  if (t.length < 3 || t.length > 80) return false;
  if (t.split(' ').length > 10) return false;
  if (looksLikeInjection(t)) return false;
  if (hasWordIn(ADULT_WORDS, t) || hasWordIn(NON_FOOD_WORDS, t)) return false;
  if (!/[a-zऀ-ॿ઀-૿]{3}/.test(t)) return false;
  if (NOT_FOOD.has(t)) return false;
  if (/^(.)\1+$/.test(t.replace(/\s/g, ''))) return false;
  if (/[a-z]{4,}/.test(t) && !/[aeiouy]/.test(t)) return false;
  if (/https?:|www\.|[<>{}]/.test(t)) return false;
  return true;
}

export function plausibleDescription(raw: string): boolean {
  const t = cleanQuery(raw);
  if (t.length > 300 || t.split(' ').length > 60 || looksLikeInjection(t) || hasWordIn(ADULT_WORDS, t)) return false;
  return t.length >= 4 && /[A-Za-zऀ-ॿ઀-૿]{3}/.test(t) && !/https?:|www\./i.test(t);
}
