// Elite Memories — Service Worker
//
// This exists mainly so Android/Chrome will consider the site
// "installable" (that's one of the requirements alongside the manifest).
// It intentionally does NOT aggressively cache your app — this project
// gets pushed with fixes often, and a caching service worker is the #1
// cause of "why isn't my fix showing up for anyone" bugs. Strategy here is
// network-first, always: try the real network, only fall back to a cached
// copy if the network request fails outright (e.g. genuinely offline).
//
// Bump CACHE_VERSION any time you want to force everyone's cached fallback
// copy to be thrown out and rebuilt (rarely necessary given the strategy
// above, but here if you ever need it).

const CACHE_VERSION = 'elite-memories-v1';
const APP_SHELL = [
  './index.html',
  './style.css',
  './app-supabase.js',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      // Don't fail install if pre-caching one asset fails — installability
      // shouldn't hinge on it.
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
      ),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests for same-origin pages/assets. Everything else
  // (Supabase API calls, MEGA links, etc.) passes straight through
  // untouched — never intercept or cache those.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
