# Mapeo del Ciclo de Vida del Service Worker
**CivicGuard PWA – Semana 2** (código en `public/sw.js`)

| Evento | Qué hace en CivicGuard | Línea de código clave |
|---|---|---|
| `install` | Abre `civicguard-shell-v1.0.0` y precarga el Application Shell con `cache.addAll()`; luego llama a `self.skipWaiting()` | `event.waitUntil(caches.open(...).then(c => c.addAll(APP_SHELL)).then(() => self.skipWaiting()))` |
| `activate` | Borra cachés antiguas con prefijo `civicguard-` y toma el control con `clients.claim()` | `caches.keys()… caches.delete(k)… self.clients.claim()` |
| `fetch` | Estáticos → Cache-First · Navegación → Network-First con fallback a `/index.html` / `/offline.html` · `GET /api/*` → Network-First con fallback a caché | `respondWith(cacheFirst / networkFirst)` |
| `sync` | Etiqueta `sync-reports`: envía a `/api/reports` los reportes con estatus `pendiente` almacenados en IndexedDB | `syncPendingReports()` |
| `push` | Muestra notificación nativa con título, cuerpo e icono | `showNotification()` |
| `notificationclick` | Enfoca/abre la app en la vista de reportes | `clients.openWindow()` |
| `message` | `SKIP_WAITING` y `GET_VERSION` desde la página | `postMessage` |

**Scope:** el archivo está en la raíz (`/sw.js`) y se registra con `{ scope: '/' }`, controlando toda la aplicación.

**Actualización:** al cambiar `VERSION` el navegador instala el nuevo SW; `skipWaiting()` evita el estado de espera y `activate` elimina el caché anterior.

## Pantallas de inicio nativas
`manifest.json` define `background_color`, `theme_color` e iconos. Android genera el **splash screen** con el nombre + icono 512 px sobre `background_color`; los iconos `purpose: "maskable"` (contenido dentro de la zona segura del 60 %) se adaptan a cualquier forma de launcher (círculo, squircle…). En iOS se usa `apple-touch-icon`.
