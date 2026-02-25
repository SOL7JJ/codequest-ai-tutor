const VERSION = 'codequest-v2';
const OFFLINE_URL = '/offline.html';
const APP_SHELL = ['/', '/index.html', OFFLINE_URL, '/manifest.webmanifest', '/app-icon.svg'];

function maybeCacheResponse(request, response) {
  if (!response) return response;
  if (response.bodyUsed) return response;
  if (!response.ok) return response;
  if (response.type !== 'basic') return response;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) return response;

  caches.open(VERSION).then((cache) => {
    cache.put(request, response.clone()).catch(() => {});
  });

  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API traffic (including chat/stream endpoints).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => maybeCacheResponse(request, response))
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  const isStaticAsset =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.endsWith('.svg'));

  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => maybeCacheResponse(request, response))
          .catch(() => cached);

        return cached || networkFetch;
      })
    );
  }
});
