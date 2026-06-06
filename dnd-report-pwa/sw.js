/* sw.js — service worker: офлайн-кэш приложения (app shell). */
const CACHE = 'dnd-reports-1.0.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/preview.js',
  './js/report-pdf.js',
  './js/layout-modern.js',
  './vendor/pdf-lib.min.js',
  './vendor/fontkit.umd.min.js',
  './fonts/DejaVuSans.ttf',
  './fonts/DejaVuSans-Bold.ttf',
  './fonts/PTSerif-Regular.ttf',
  './fonts/PTSerif-Bold.ttf',
  './fonts/PTSans-Regular.ttf',
  './fonts/PTSans-Bold.ttf',
  './icons/emblem.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // архив отчётов старого проекта (для импорта истории офлайн)
  './samples/history.json',
  './samples/august_report_large.json',
  './samples/september_report_large.json',
  './samples/octpber_report.json',
  './samples/november_report.json',
  './samples/december_report.json',
  './samples/Lukomorie_January_2026__report.json',
  './samples/Lukomorie_Feb_2026__report.json',
  './samples/Lukomorie_JMarch_2026__report.json',
  './samples/Lukomorie_April_2026__report.json',
  './samples/Lukomorie_May_2026__report.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// cache-first для собственных ресурсов, сеть как запасной вариант
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') { return; }
  // запросы к API отправки не кэшируем и не перехватываем
  if (new URL(req.url).pathname.startsWith('/api/')) { return; }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.ok && new URL(req.url).origin === self.location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
