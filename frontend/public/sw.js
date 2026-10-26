// SignalScript PWA Service Worker — Interface Shell Cache Only
// CRITICAL: Market data, Binance feeds, and Trading APIs are STRICTLY REAL-TIME and NEVER cached.

const CACHE_NAME = 'signalscript-shell-v3';
const SHELL_PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle standard GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  // 1. STRICT REAL-TIME BYPASS: Trading APIs, WebSockets, and Exchange Data
  const isApiOrMarketData =
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/klines') ||
    url.pathname.includes('/depth') ||
    url.pathname.includes('/trades') ||
    url.pathname.includes('/recorder') ||
    url.protocol.startsWith('ws') ||
    url.hostname.includes('binance') ||
    url.hostname.includes('tradingview');

  if (isApiOrMarketData) {
    // Pass straight to network without Service Worker interception
    return;
  }

  // 2. Vite Dev-mode bypass: do not cache hot-reload modules
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@') ||
    url.search.includes('t=')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. Stale-while-revalidate / cache-first for static UI assets (JS/CSS/Fonts/Icons)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html') || caches.match('/');
        }
        return Promise.reject(new Error('Network error and asset not cached'));
      });
    })
  );
});
