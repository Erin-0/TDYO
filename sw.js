/* YODRIVE Service Worker — offline + cache */
const VERSION    = 'yodrive-v1';
const SHELL_CACHE = VERSION + '-shell';
const PDF_CACHE   = VERSION + '-pdf';
const FONT_CACHE  = VERSION + '-fonts';

const SHELL_URLS = ['/', '/index.html', '/manifest.json'];

/* Install — pre-cache the app shell */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

/* Activate — wipe old caches on version bump */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => !k.startsWith(VERSION))
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* Fetch — route by path */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  /* PDFs → cache-first (immutable content) */
  if (url.pathname.startsWith('/PDFS/') || url.pathname.startsWith('/pdfs/')) {
    e.respondWith(
      caches.open(PDF_CACHE).then(cache =>
        cache.match(e.request).then(cached => cached || fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  /* Google Fonts → cache-first */
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(FONT_CACHE).then(c => c.put(e.request, clone));
        return res;
      }))
    );
    return;
  }

  /* Everything else (HTML, manifest, icons) → network-first, cache fallback */
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const clone = res.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, clone));
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(cached => cached || caches.match('/index.html'))
      )
  );
});