/**
 * copyHi.ts — Hinglish (Hindi in English letters) for the new screens. Plain, warm, short. No AI.
 * Anything missing here falls back to English, so a screen is never blank.
 */
import type { Lang } from './lang';
import type { NextAction } from './todayAction';

const HI: Record<string, string> = {
  'Your next step': 'Aapka agla kadam',
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
