/*
 * Flight Radar India - service worker.
 *
 * Purpose: let the app open instantly and show its shell when the network is
 * flaky or offline. It deliberately does NOT cache anything that is data or
 * personal:
 *   - cross-origin requests (API on another host, map tiles, weather, photos)
 *     are not touched at all;
 *   - same-origin /api/*, /config.json and this file always go to the network.
 *
 * Strategy:
 *   - page navigations: network first, last good index.html when offline;
 *   - content-hashed build files (main-XXXX.js, chunk-XXXX.js, styles-XXXX.css),
 *     icons and fonts: cache first (their names change when content changes).
 *
 * Bump VERSION to drop every old cache.
 */
const VERSION = 'v1';
const SHELL_CACHE = `fr-shell-${VERSION}`;
const ASSET_CACHE = `fr-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(new Request('/index.html', { cache: 'reload' })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('fr-') && key !== SHELL_CACHE && key !== ASSET_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/config.json' || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  const cacheable =
    /^\/(main|chunk|styles)-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname) ||
    /^\/icons\//.test(url.pathname) ||
    /\.(woff2?|ttf)$/.test(url.pathname) ||
    url.pathname.endsWith('maplibre-gl-worker.mjs');
  if (!cacheable) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then((cache) =>
      cache.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) void cache.put(request, response.clone());
            return response;
          }),
      ),
    ),
  );
});
