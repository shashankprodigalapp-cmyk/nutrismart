/**
 * lang.ts — English or Hinglish for the NEW screens (Today hero, Sparks, Journey). Saved on the device.
 */
import { useEffect, useState } from 'react';

export type Lang = 'en' | 'hi';
export const LANG_KEY = 'ns-lang';
export const LANG_EVENT = 'nutrismart:lang';

export function parseLang(v: unknown): Lang { return v === 'hi' ? 'hi' : 'en'; }
export function getLang(): Lang { try { return parseLang(localStorage.getItem(LANG_KEY)); } catch { return 'en'; } }
export function setLang(l: Lang): void {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* lasts this visit only */ }
  try { window.dispatchEvent(new Event(LANG_EVENT)); } catch { /* ignore */ }
}
export function useLang(): Lang {
  const [l, setL] = useState<Lang>(getLang);
  useEffect(() => {
    const f = () => setL(getLang());
    window.addEventListener(LANG_EVENT, f);
    return () => window.removeEventListener(LANG_EVENT, f);
  }, []);
  return l;
}
