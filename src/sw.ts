/**
 * src/sw.ts — NutriSmart Service Worker
 *
 * Built by vite-plugin-pwa (injectManifest strategy).
 * VitePWA injects the Workbox precache manifest at build time and replaces
 * the `self.__WB_MANIFEST` placeholder.
 *
 * WHAT THIS FILE DOES:
 *   1. Workbox precaching — all app-shell assets (unchanged from GenerateSW)
 *   2. Runtime caching for Google Fonts (unchanged)
 *   3. push event handler — shows notification for energy check-in reminders
 *      and Morning Verdict pushes
 *   4. notificationclick handler — routes user to /app/log on tap
 *
 * WHY injectManifest INSTEAD OF generateSW:
 *   GenerateSW cannot include custom push or notificationclick handlers.
 *   injectManifest lets us write these handlers while Workbox still manages
 *   the precache, cache-first strategies, and navigateFallback.
 *
 * SECURITY:
 *   The push payload contains no nutrition data, no food names, no personal
 *   information — only a title, body, tag, and a URL path.
 */

/// <reference lib="WebWorker" />
import { clientsClaim }                          from 'workbox-core';
import { ExpirationPlugin }                      from 'workbox-expiration';
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute }                         from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate }      from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;

// ── WORKBOX PRECACHING ────────────────────────────────────────────────────────
// VitePWA replaces self.__WB_MANIFEST with the build-time asset manifest.
// This is identical to what GenerateSW produced — no offline behavior changes.

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST || []);

// ── RUNTIME CACHING — Google Fonts ───────────────────────────────────────────

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com',
  new StaleWhileRevalidate({ cacheName: 'google-fonts-stylesheets' }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: 'google-fonts-webfonts',
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 60 * 60 * 24 * 365 })],
  }),
);

// ── NAVIGATE FALLBACK ─────────────────────────────────────────────────────────
// SPA routing: any non-API navigation falls back to /index.html

registerRoute(
  ({ request, url }) =>
    request.mode === 'navigate' &&
    !url.pathname.startsWith('/.netlify'),
  new CacheFirst({ cacheName: 'nutrismart-shell' }),
);

// ── PUSH EVENT HANDLER ───────────────────────────────────────────────────────
//
// Push payloads from both the energy-checkin-cron and cron-morning-verdict
// functions are JSON with the shape:
//   { title, body, tag, url }
//
// We show one notification per push. The tag deduplicates: a second push with
// the same tag replaces the existing notification (no spam).
//
// SECURITY: The payload never contains food names, calorie counts, or any
// nutrition data — only the generic prompt and a URL path.

self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return;

  let payload: { title?: string; body?: string; tag?: string; url?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'NutriSmart', body: event.data.text() };
  }

  const title = payload.title ?? 'NutriSmart';
  const body  = payload.body  ?? '';
  const tag   = payload.tag   ?? 'nutrismart-default';
  const url   = payload.url   ?? '/app/log';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon:      '/icon-192.png',
      badge:     '/icon-192.png',
      // renotify: false,  // same-tag notification replaces, not stacks
      data:      { url },
    }),
  );
});

// ── NOTIFICATIONCLICK HANDLER ─────────────────────────────────────────────────
//
// When the user taps a notification:
//   1. Close the notification.
//   2. If the app is already open in a window, focus it.
//   3. Otherwise open a new window at the target URL.
//
// The target URL is /app/log (or the url from the payload).
// EnergyCheckIn.tsx polls Dexie on mount and will surface the due check-in.

self.addEventListener('notificationclick', (event: any) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url ?? '/app/log';
  const appOrigin = self.location.origin;
  const fullUrl   = appOrigin + targetUrl;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing window if possible
        for (const client of windowClients) {
          if (client.url.startsWith(appOrigin) && 'focus' in client) {
            return (client as WindowClient).focus().then(c => {
              // Navigate the focused window to the target URL
              if ('navigate' in c) return (c as WindowClient).navigate(fullUrl);
            });
          }
        }
        // No open window — open a new one
        return self.clients.openWindow(fullUrl);
      }),
  );
});
