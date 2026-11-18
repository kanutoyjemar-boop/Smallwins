// Offline app shell + background-sync wake-up for Small Wins.
// Private API data lives in IndexedDB (see api.js); this worker only caches app files.

const CACHE = 'selfup-v28';
const SHELL = ['/', '/index.html', '/manifest.json', '/privacy.html',
  '/css/style.css', '/vendor/chart.umd.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-192.png', '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/js/theme-init.js', '/js/api.js', '/js/ui.js', '/js/push.js', '/js/install.js', '/js/backup-crypto.js', '/js/app.js', '/js/ical-import.js',
  '/js/pages/dashboard.js', '/js/pages/tasks.js', '/js/pages/money.js', '/js/pages/body.js',
  '/js/pages/schedule.js', '/js/pages/stats.js', '/js/pages/goals.js', '/js/pages/settings.js'];

self.addEventListener('install', (event) => {
  // Cache each file separately so one missing file can't break the whole install.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: serve from cache instantly (works offline), refresh in the background
// when online so the next launch gets updates. API calls are never cached here.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req).then(async (response) => {
      if (response && response.ok && response.type === 'basic') await cache.put(req, response.clone());
      return response;
    }).catch(() => null);

    if (cached) { event.waitUntil(refresh); return cached; }
    const response = await refresh;
    if (response) return response;
    if (req.mode === 'navigate') {
      const shell = await cache.match('/index.html') || await cache.match('/');
      if (shell) return shell;
    }
    return Response.error();
  })());
});

// Chrome/Android: the browser fires this when connectivity returns, even if the
// app was in the background. We ask any open window to flush its queue.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'selfup-sync') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    if (!clients.length) throw new Error('No open window to sync from; retry later.');
    clients.forEach((c) => c.postMessage({ type: 'flush-queue' }));
  }));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('push', (event) => {
  let data = { title: 'Small Wins', body: 'Open Small Wins for your daily check-in.', url: '/' };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; } catch { data.body = event.data.text() || data.body; }
  }
  const options = {
    body: data.body,
    data: { url: data.url || '/' },
    tag: data.tag || 'selfup-reminder',
    renotify: true,
  };
  if (data.icon) options.icon = data.icon;
  if (data.badge) options.badge = data.badge;
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
