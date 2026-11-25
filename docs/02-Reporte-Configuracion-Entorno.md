# Reporte de Configuración del Entorno (Bitácora)
**CivicGuard PWA – Semana 1**

## 1. Herramientas utilizadas
| Herramienta | Versión | Uso |
|---|---|---|
| Node.js | ≥ 18 (probado con 22) | Runtime del servidor |
| Express 4 + compression | 4.x | Servidor web de alto rendimiento (gzip) y API REST |
| multer | 2.x | Recepción de fotos (multipart) |
| web-push | 3.x | Envío de notificaciones push con VAPID |
| ngrok | última | Túnel HTTPS para probar en celular real |
| Chrome DevTools + Lighthouse | última | Depuración y auditoría |
| Git + GitHub | — | Control de versiones |

## 2. Parámetros del entorno local
| Parámetro | Valor |
|---|---|
| Puerto local | `3000` (variable `PORT`) |
| Carpeta pública | `/public` |
| Datos de la API | `/data` (ignorado por git) |
| Claves VAPID | autogeneradas en `data/vapid.json` o variables `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` |
| Token de administración | variable `ADMIN_TOKEN` (cámbialo antes de desplegar) |

### Instalación y arranque
```bash
npm install
npm start                 # http://localhost:3000
```

## 3. Contexto seguro (HTTPS)
Service Worker, Geolocalización, Cámara y Push **solo funcionan en contexto seguro**. `http://localhost` cuenta como seguro, pero un celular real no puede usar el `localhost` de tu laptop, por eso se usa ngrok:

```bash
# 1) Arrancar la app
npm start
# 2) En otra terminal, abrir el túnel (requiere cuenta gratuita y authtoken)
ngrok config add-authtoken <TU_TOKEN>
ngrok http 3000
# 3) Abrir en el celular la URL https://xxxx.ngrok-free.app
```
**Validación:** en consola del navegador `window.isSecureContext === true`; en DevTools → Application → Service Workers aparece `sw.js` con estado *activated and is running*.

## 4. Supresión de cachés HTTP clásicas
Para que el único mecanismo de caché sea el Service Worker (y evitar versiones obsoletas durante el desarrollo), el servidor envía:
```
Cache-Control: no-cache, no-store, must-revalidate     (html, js, css, json, sw.js)
Service-Worker-Allowed: /                              (sw.js)
```
Los iconos (inmutables) usan `max-age=86400`. En DevTools → Network se activa **Disable cache** y en Application → Service Workers se usa **Update on reload** durante el desarrollo.

Comprobación realizada:
```
$ curl -I http://localhost:3000/sw.js
Cache-Control: no-cache, no-store, must-revalidate
Service-Worker-Allowed: /
```

## 5. Manifest y Application Shell
- `manifest.json` enlazado desde `index.html` con `<link rel="manifest">`.
- Incluye `name`, `short_name`, `start_url`, `scope`, `display: standalone`, `theme_color`, `background_color` e iconos **any** y **maskable** (192 y 512 px).
- Application Shell inmutable: cabecera, navegación y contenedores en `index.html`; se precachea en el evento `install` del SW.

## 6. Bitácora de incidencias del entorno (completar con el equipo)
| Fecha | Problema | Causa | Solución |
|---|---|---|---|
| | | | |
