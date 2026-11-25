# 🛡️ CivicGuard PWA

Sistema de Gestión de Emergencias e Incidencias en Infraestructura Urbana.
Proyecto Integrador 2 – Ingeniería en Desarrollo y Gestión de Software, UTM.

PWA con arquitectura **desacoplada (headless)**: reporta incidencias con ubicación GPS y foto, funciona **sin conexión**, sincroniza en segundo plano y notifica por **push**.

## Características
- Application Shell inmutable + `manifest.json` con iconos *any* y *maskable*
- Service Worker (`install`, `activate`, `skipWaiting`, `fetch`, `sync`, `push`)
- Cache API (shell) + **IndexedDB** (reportes y fotos). Sin `localStorage`.
- Geolocation API + cámara (`getUserMedia`, con fallback a selector de foto)
- Network-First con fallback local · Background Sync (con fallback manual en Safari/Firefox)
- Web Push (VAPID)
- API REST independiente (`server.js`)

## Estructura
```
public/        PWA (index.html, app.js, db.js, sw.js, manifest.json, icons/)
server.js      API REST + servidor estático
docs/          Entregables escritos de cada semana
```

## Ejecutar
```bash
npm install
npm start            # http://localhost:3000
npm run tunnel       # (otra terminal) ngrok http 3000 → probar en celular real
```

## Variables de entorno
| Variable | Descripción |
|---|---|
| `PORT` | Puerto (3000 por defecto) |
| `DATA_DIR` | Carpeta de datos (reportes, fotos, suscripciones) |
| `ADMIN_TOKEN` | Token para cambiar estatus / enviar push de prueba (**cámbialo**) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Claves push (si no existen se autogeneran en `data/vapid.json`) |

## API
| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado |
| GET | `/api/reports` | Lista de reportes |
| POST | `/api/reports` | Crea reporte (multipart; idempotente por `id`) |
| PATCH | `/api/reports/:id/status` | Cambia estatus (header `x-admin-token`); `resuelto` envía push |
| GET | `/api/push/public-key` | Clave pública VAPID |
| POST | `/api/push/subscribe` · `/unsubscribe` | Gestión de suscripción |

## Entregables
Ver carpeta [`docs/`](docs).
