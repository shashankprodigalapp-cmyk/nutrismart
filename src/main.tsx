import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

/**
 * A/B INSTRUMENTATION — push deep-link attribution (non-blocking).
 * Verdict pushes deep-link to /app/log?source=verdict&variant=scientific.
 * We fire app_opened_from_verdict exactly once per app load, asynchronously,
 * AFTER first paint (queued via setTimeout) so attribution never delays render.
 * This event is the numerator of the A/B open-rate; verdict_sent is the denominator.
 */
function trackPushAttribution(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const source = params.get('source');
    if (!source) return;

    const variant = params.get('variant');
    const eventName =
      source === 'verdict'  ? 'app_opened_from_verdict' :
      source === 'reengage' ? 'app_opened_from_reengagement' :
      source === 'checkin'  ? 'app_opened_from_checkin' : null;
    if (!eventName) return;

    // One-time guard per browser session (StrictMode double-invoke + reloads)
    const guardKey = `ns_attr_${source}_${new Date().toDateString()}`;
    if (sessionStorage.getItem(guardKey)) return;
    sessionStorage.setItem(guardKey, '1');

    // Fire after paint; dynamic import keeps supabase out of the critical path
    setTimeout(async () => {
      const { supabase } = await import('./lib/supabase');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      supabase.from('events').insert({
        user_id:    user.id,
        event_name: eventName,
        properties: { variant, raw_source: source },
      }).then(() => {});
    }, 0);

    // Clean the URL so refresh/bookmark doesn't re-attribute
    params.delete('source');
    params.delete('variant');
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '');
    window.history.replaceState({}, '', clean);
  } catch { /* attribution must never break the app */ }
}

trackPushAttribution();

// Remember the first ?ref=... (or utm_source) tag the person arrived with, so the admin can see which source brings habit users.
(function rememberSource() {
  try {
    const p = new URLSearchParams(window.location.search);
    const r = (p.get('ref') || p.get('utm_source') || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
    if (r && !localStorage.getItem('ns_ref')) localStorage.setItem('ns_ref', r);
  } catch { /* ignore */ }
})();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
