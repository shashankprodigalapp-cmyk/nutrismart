/**
 * analytics.ts: tiny, privacy-safe usage events.
 * Writes one row to the app's own `events` table (no third parties). Counts and
 * labels only: never meal contents, never free text beyond a short food search term.
 * Always silent: a failed event must never affect the app.
 */
import { supabase } from './supabase';

const lastSent = new Map<string, number>();

/** Change this when you ship a notable build, so the Behaviour screen can show who is on which build. */
export const BUILD_TAG = '2026-10-ux13';

export function track(name: string, props: Record<string, string | number | boolean> = {}, minGapMs = 0): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const key = name + JSON.stringify(props);
    const now = Date.now();
    if (minGapMs > 0 && now - (lastSent.get(key) ?? 0) < minGapMs) return;
    lastSent.set(key, now);
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      return supabase.from('events').insert({ user_id: uid, event_name: name, properties: props });
    }).catch(() => {});
  } catch { /* never throw */ }
}

// ── Where did this person come from? ───────────────────────────────────────────
const REF_KEY = 'ns_ref';

/** Remember the first ?ref=... (or utm_source) the person arrived with. Run once at page load. */
export function captureSource(): void {
  try {
    const p = new URLSearchParams(window.location.search);
    const ref = cleanTag(p.get('ref') || p.get('utm_source') || '');
    if (ref && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, ref);
  } catch { /* ignore */ }
}

/** Lower-case letters, digits, dash and underscore only, 30 characters at most. */
export function cleanTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
}

/** Strip anything that could identify a person from an error message. */
export function cleanMessage(m: unknown): string {
  return String(m ?? '')
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/\d{5,}/g, '<n>')
    .slice(0, 120);
}

export function osFrom(ua: string): 'android' | 'ios' | 'windows' | 'mac' | 'linux' | 'other' {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

function pushState(): 'granted' | 'denied' | 'default' | 'none' {
  try {
    if (typeof Notification === 'undefined') return 'none';
    return Notification.permission as 'granted' | 'denied' | 'default';
  } catch { return 'none'; }
}

function isInstalled(): boolean {
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch { return false; }
}

/** One "session_start" per person per device per day: phone, install mode, push permission, language, build, source. */
export function trackSessionStart(): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem('ns_session_day') === day) return;
    localStorage.setItem('ns_session_day', day);
    const w = window.innerWidth;
    track('session_start', {
      os: osFrom(navigator.userAgent || ''),
      install: isInstalled() ? 'app' : 'browser',
      push: pushState(),
      lang: (navigator.language || '').slice(0, 5),
      ver: BUILD_TAG,
      ref: localStorage.getItem(REF_KEY) || 'direct',
      w: w < 480 ? 'S' : w < 1024 ? 'M' : 'L',
    });
  } catch { /* ignore */ }
}

// ── App health: errors, failed and slow server calls ──────────────────────────
let healthInstalled = false;

function currentScreen(): string {
  try { return window.location.pathname.replace('/app/', '').split('/')[0] || 'today'; } catch { return 'unknown'; }
}

export function installHealthTracking(): void {
  if (healthInstalled || typeof window === 'undefined') return;
  healthInstalled = true;
  let errorCount = 0;

  window.addEventListener('error', e => {
    if (errorCount++ >= 10) return;
    track('app_error', { where: currentScreen(), msg: cleanMessage(e.message) }, 5 * 60_000);
  });
  window.addEventListener('unhandledrejection', e => {
    if (errorCount++ >= 10) return;
    const reason = (e as PromiseRejectionEvent).reason;
    track('app_error', { where: currentScreen(), msg: cleanMessage(reason?.message ?? reason) }, 5 * 60_000);
  });

  // Time every call to the app's own /api/ functions; log the failed and the slow ones.
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let path = '';
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const u = new URL(url, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) path = u.pathname.slice(5);
    } catch { /* not a URL we care about */ }
    if (!path) return orig(input, init);

    const t0 = Date.now();
    try {
      const res = await orig(input, init);
      const ms = Date.now() - t0;
      if (res.status >= 500) track('api_error', { path, status: res.status }, 60_000);
      if (ms > 3000) track('slow_action', { action: path, ms: Math.round(ms / 100) * 100 }, 60_000);
      return res;
    } catch (err) {
      if (navigator.onLine !== false) track('api_error', { path, status: 0 }, 60_000);
      throw err;
    }
  };
}
