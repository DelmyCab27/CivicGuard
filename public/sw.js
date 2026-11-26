/* sw.js - Service Worker de CivicGuard PWA
 * Ámbito (scope): "/" (el archivo vive en la raíz del proyecto).
 * Ciclo de vida: install -> activate -> fetch / sync / push.
 */
importScripts('/db.js');

const VERSION = 'v1.3.0';
const SHELL_CACHE = `civicguard-shell-${VERSION}`;   // recursos inmutables del cascarón (Cache API)
const RUNTIME_CACHE = `civicguard-runtime-${VERSION}`; // respuestas dinámicas (API GET)
const SYNC_TAG = 'sync-reports';
const API_ORIGIN_PATH = '/api/';

const APP_SHELL = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/db.js',
  '/manifest.json',
  '/offline.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-192.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png'
];

/* ---------- 1) INSTALL: precarga del Application Shell ---------- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()) // no esperar a que se cierren pestañas antiguas
  );
});

/* ---------- 2) ACTIVATE: limpieza de cachés viejas y toma de control ---------- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('civicguard-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ---------- 3) FETCH: estrategias de red ---------- */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API: Network-First con fallback a caché local (solo GET)
  if (url.pathname.startsWith(API_ORIGIN_PATH)) {
    if (req.method === 'GET') event.respondWith(networkFirst(req));
    return; // POST/PUT los maneja la app + Background Sync
  }

  // Navegaciones: Network-First con fallback al shell / página offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html').then(r => r || caches.match('/offline.html')))
    );
    return;
  }

  // Estáticos del shell: Cache-First
  event.respondWith(cacheFirst(req));
});

function cacheFirst(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)); }
    return res;
  }));
}

function networkFirst(req) {
  return fetch(req)
    .then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then(c => c.put(req, copy)); }
      return res;
    })
    .catch(() => caches.match(req).then(hit => hit || new Response(
      JSON.stringify({ offline: true, error: 'Sin conexión y sin datos en caché' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
}

/* ---------- 4) BACKGROUND SYNC: envío de reportes retenidos ---------- */
self.addEventListener('sync', event => {
  if (event.tag === SYNC_TAG) event.waitUntil(syncPendingReports());
});

async function syncPendingReports() {
  const pending = await CGDB.getByStatus('pendiente');
  for (const r of pending) {
    const form = new FormData();
    form.append('id', r.id);
    form.append('type', r.type);
    form.append('priority', r.priority);
    form.append('description', r.description);
    form.append('lat', r.location ? r.location.lat : '');
    form.append('lng', r.location ? r.location.lng : '');
    form.append('accuracy', r.location ? r.location.accuracy : '');
    form.append('createdAt', r.createdAt);
    if (r.photo) form.append('photo', r.photo, 'evidencia.jpg');
    // Si la petición falla se lanza error y el navegador reintentará el sync
    const res = await fetch('/api/reports', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Fallo al sincronizar ' + r.id);
    const saved = await res.json();
    await CGDB.updateStatus(r.id, { status: saved.status || 'enviado', syncedAt: Date.now() });
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach(c => c.postMessage({ type: 'SYNC_DONE', count: pending.length }));
}

/* ---------- 5) PUSH: notificaciones nativas ---------- */
self.addEventListener('push', event => {
  let data = { title: 'CivicGuard', body: 'Tienes una actualización de tus reportes.', reportId: null };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) { /* texto plano */ }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: data.reportId || 'civicguard',
        data: { url: '/?view=list' },
        vibrate: [120, 60, 120]
      }),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        list.forEach(c => c.postMessage({ type: 'PUSH_RECEIVED', body: data.body, reportId: data.reportId }));
      })
    ])
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) { c.navigate(target); return c.focus(); } }
      return self.clients.openWindow(target);
    })
  );
});

/* ---------- 6) Mensajes desde la página ---------- */
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});
