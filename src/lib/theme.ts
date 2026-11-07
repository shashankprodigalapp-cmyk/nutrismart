/**
 * theme.ts — rules for the new look (switch 'ui_new_design') and the Light / Dark / System setting.
 * Pure helpers plus tiny, failure-proof localStorage reads. No network, no database.
 */
export const NEW_DESIGN_FLAG = 'ui_new_design';
export type Appearance = 'light' | 'dark' | 'system';
export type Resolved = 'light' | 'dark';

export const APPEARANCE_KEY = 'ns-appearance';
export const CACHE_KEY = 'ns-newdesign';
export const APPEARANCE_EVENT = 'nutrismart:appearance';
export const THEME_COLOR: Record<Resolved, string> = { light: '#F5F3ED', dark: '#0E1B17' };
export const OLD_THEME_COLOR = '#111113';

export function parseAppearance(v: unknown): Appearance {
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}
export function resolveTheme(pref: Appearance, systemDark: boolean): Resolved {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}
export function readAppearance(): Appearance {
  try { return parseAppearance(localStorage.getItem(APPEARANCE_KEY)); } catch { return 'system'; }
}
export function writeAppearance(a: Appearance): void {
  try { localStorage.setItem(APPEARANCE_KEY, a); } catch { /* private mode: setting lasts this visit only */ }
  try { window.dispatchEvent(new Event(APPEARANCE_EVENT)); } catch { /* ignore */ }
}
export function readCachedOn(): boolean {
  try { return localStorage.getItem(CACHE_KEY) === '1'; } catch { return false; }
}
export function writeCachedOn(on: boolean): void {
  try { if (on) localStorage.setItem(CACHE_KEY, '1'); else localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}

/** Sets or clears the two attributes the stylesheet listens to, and the phone's address-bar colour. */
export function applyTheme(on: boolean, resolved: Resolved): void {
  try {
    const root = document.documentElement;
    if (on) { root.setAttribute('data-ui', 'new'); root.setAttribute('data-theme', resolved); }
    else { root.removeAttribute('data-ui'); root.removeAttribute('data-theme'); }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', on ? THEME_COLOR[resolved] : OLD_THEME_COLOR);
  } catch { /* never block the app over colours */ }
}
