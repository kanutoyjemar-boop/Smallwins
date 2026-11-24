// Service worker: receives pushes, focuses/opens the app when tapped, and
// keeps a small app-shell cache so SelfUp opens instantly (and shows the
// shell, not a browser error page, when offline). API calls are never cached.

const CACHE = 'selfup-shell-v1';
const SHELL = [
  '/',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/js/push.js',
  '/js/pages/dashboard.js',
  '/js/pages/tasks.js',
  '/js/pages/money.js',
  '/js/pages/body.js',
  '/js/pages/schedule.js',
  '/js/pages/stats.js',
  '/js/pages/goals.js',
  '/js/pages/settings.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for our own GET requests so updates show up immediately;
// fall back to the cache when offline. Navigations fall back to the shell.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/') : Response.error()))
      )
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'SelfUp', body: 'Open SelfUp for your daily check-in.', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch { data.body = event.data.text() || data.body; }
  }

  const options = {
    body: data.body,
    data: { url: data.url || '/' },
    tag: data.tag || 'selfup-reminder',
    renotify: true,
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
