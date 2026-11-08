/**
 * copyHi.ts — Hinglish (Hindi in English letters) for the new screens. Plain, warm, short. No AI.
 * Anything missing here falls back to English, so a screen is never blank.
 */
import type { Lang } from './lang';
import type { NextAction } from './todayAction';

const HI: Record<string, string> = {
  'Your next step': 'Aapka agla kadam',
  "Today's plate": 'Aaj ki plate',
  'Hi': 'Namaste',
  'More for today': 'Aaj ke liye aur',
  "Today's signal": 'Aaj ka signal',
  'One pattern and one thing to try': 'Ek pattern aur ek cheez try karne ki',
  'Energy check-in': 'Energy check-in',
  'Takes 5 seconds': 'Sirf 5 second',
  'Quests': 'Quests',
  'All done for today': 'Aaj ke sab ho gaye',
  'Your trends, after-meal notes and patterns': 'Aapke trends, khaane ke baad ke notes aur patterns',
  'Flexible meal': 'Flexible meal',
  'Set some calories aside for a bigger meal': 'Bade meal ke liye thodi calories alag rakhein',
  'How last week went, with the numbers behind it': 'Pichla hafta kaisa gaya, numbers ke saath',
  "Today's numbers": 'Aaj ke numbers',
  'View': 'Dekhein',
  'Start': 'Shuru karein',
  'Open': 'Kholein',
  'Plan': 'Plan karein',
  'Show': 'Dikhayein',
  'Your Sparks': 'Aapke Sparks',
  'Today': 'Aaj',
  'Log two meals': 'Do meals log karein',
  'Drink 4 glasses of water': '4 glass paani piyein',
  'You are at the top level.': 'Aap sabse upar ke level par hain.',
  'Sparks come from logging and learning, not from how much you eat. Nothing is ever taken away.':
    'Sparks logging aur seekhne se milte hain, aap kitna khaate hain us se nahi. Kuch bhi kabhi wapas nahi liya jaata.',
  'See your journey': 'Apna safar dekhein',
  'Your journey': 'Aapka safar',
  'Back': 'Wapas',
  'Levels': 'Levels',
  'Food Explorer': 'Food Explorer',
  'Regional kitchens you have tried': 'Aapne ye regional kitchens try kiye hain',
  'Based on the foods you have logged on this device.': 'Is device par aapke log kiye hue khaane ke hisaab se.',
  'Kitchen Detective': 'Kitchen Detective',
  'Short lessons are being reviewed by a nutrition professional. They will appear here once approved.':
    'Chhote lessons ek nutrition professional review kar rahe hain. Approve hote hi yahan dikhenge.',
  'Language': 'Bhasha',
  'English': 'English',
  'Hinglish': 'Hinglish',
  'Log a meal': 'Meal log karein',
  'Open Log': 'Log kholein',
  'See Insights': 'Insights dekhein',
};

export function tr(lang: Lang, en: string): string { return lang === 'hi' ? (HI[en] ?? en) : en; }

export function hinglishNext(a: NextAction): NextAction {
  const n = a.n ?? 0;
  switch (a.id) {
    case 'first-meal': return { ...a, title: 'Ek meal se shuru karein', body: 'Jo khaya woh log karein, chhota sa bhi chalega. Aapki plate wahin se bharti jaayegi.', cta: 'Meal log karein' };
    case 'protein': return { ...a, title: 'Thoda protein add karein', body: `Protein ${n}% par hai. Dal, paneer, anda ya dahi aasaan options hain.`, cta: 'Meal log karein' };
    case 'water': return { ...a, title: 'Ek glass paani ka time', body: `Paani ${n}% par hai. Abhi ek glass madad karega.`, cta: 'Log kholein' };
    case 'protein-done': return { ...a, title: 'Protein poora ho gaya', body: 'Bahut badhiya. Dekhein aapka hafta kya bata raha hai.', cta: 'Insights dekhein' };
    default: return { ...a, title: 'Sab theek chal raha hai', body: 'Agla meal khaayein tab log kar lein.', cta: 'Meal log karein' };
  }
}
export const HI_COPY = HI;

export function hiExplorerLine(tried: number, total: number): string {
  if (tried <= 0) return 'Kisi doosre regional kitchen ka koi dish try karein, woh yahan dikhega.';
  if (tried >= total) return `Aapne saare ${total} regional kitchens try kar liye. Kya variety hai.`;
  return `Aapne ${tried} / ${total} regional kitchens try kiye hain.`;
}
export function hiIdea(label: string, ideas: string[]): string { return `Mann ho toh: ${label} — ${ideas.join(', ')}.`; }
