# Documento de Definición de Proyecto y Tabla Comparativa de Arquitecturas
**Proyecto Integrador 2 – CivicGuard PWA (Sistema de Gestión de Emergencias e Incidencias en Infraestructura Urbana)**
Semana 1 · Ingeniería en Desarrollo y Gestión de Software · UTM

**Equipo:** _(nombres de los integrantes)_  **Fecha:** _(dd/mm/aaaa)_

---

## 1. Definición del proyecto

**Problema.** Los ciudadanos y operadores municipales detectan incidencias en la vía pública (baches, fugas, alumbrado, inundaciones) en lugares donde la cobertura es mala o inexistente: sótanos, zonas periféricas, desastres naturales donde la red cae. Una app web tradicional falla justo cuando más se necesita.

**Solución.** CivicGuard es una Aplicación Web Progresiva que permite capturar un reporte con **ubicación GPS** y **foto de evidencia**, guardarlo localmente aunque no haya red y **sincronizarlo automáticamente** al recuperar conexión. Además notifica por **push** cuando el reporte es resuelto.

**Usuarios.** Ciudadanos (reportan y consultan), operadores municipales (cambian estatus mediante la API).

**Requerimientos clave.**
| # | Requerimiento | Tecnología |
|---|---|---|
| 1 | Funcionar sin conexión (arranque + captura) | Service Worker + Cache API |
| 2 | Retener reportes JSON y fotos | IndexedDB (sin localStorage) |
| 3 | Ubicar la incidencia | Geolocation API |
| 4 | Capturar evidencia | MediaDevices (cámara) |
| 5 | Envío diferido automático | Background Sync (+ fallback manual) |
| 6 | Alertas de estatus | Push API + Notifications API |
| 7 | Instalable con pantalla de inicio nativa | manifest.json + iconos maskable |
| 8 | Front-end desacoplado | API REST independiente (headless) |

## 2. Tabla comparativa de arquitecturas (aplicada a CivicGuard)

| Criterio | Web Tradicional (MPA) | Orientada a Servicios (SOA/API) | Móvil Nativa | Multiplataforma (Flutter / React Native / Ionic) | **Web Progresiva (PWA)** |
|---|---|---|---|---|---|
| **Descripción** | Páginas HTML generadas por el servidor; cada acción recarga la página | Lógica expuesta como servicios (REST/SOAP) consumidos por uno o varios clientes | Apps desarrolladas con SDK de cada SO (Kotlin/Swift) y publicadas en tiendas | Un solo código base compilado o empaquetado para iOS/Android | Web app con SW, manifest y APIs modernas; instalable desde el navegador |
| **Funciona sin conexión** | No | Depende del cliente | Sí | Sí | **Sí (Service Worker + Cache + IndexedDB)** |
| **Acceso a GPS y cámara** | Limitado (solo si hay red para cargar) | Depende del cliente | Total | Total (plugins) | **Sí (Geolocation, getUserMedia)** |
| **Notificaciones push** | No | Depende del cliente | Sí | Sí | **Sí (Web Push; iOS ≥ 16.4 si está instalada)** |
| **Sincronización en segundo plano** | No | Depende del cliente | Sí (WorkManager / BGTasks) | Sí | **Sí (Background Sync en Chromium; fallback en Safari/Firefox)** |
| **Instalación** | No | No aplica | Tienda (App Store / Play) | Tienda | **Desde el navegador, sin tienda** |
| **Actualizaciones** | Inmediatas | Inmediatas en servidor | Revisión en tienda (horas/días) | Revisión en tienda | **Inmediatas (ciclo de vida del SW)** |
| **Costo de desarrollo** | Bajo | Medio-alto | Alto (2 bases de código) | Medio | **Bajo-medio (1 base de código web)** |
| **Costo de distribución** | Hosting | Hosting + infraestructura | Cuota de desarrollador + comisiones | Cuota + comisiones | **Solo hosting HTTPS** |
| **Rendimiento** | Medio | Depende del cliente | Excelente | Muy bueno | Muy bueno (Lighthouse ≥ 90 alcanzable) |
| **Alcance de dispositivos** | Todos con navegador | Todos | Solo la plataforma objetivo | iOS y Android | **Cualquier dispositivo con navegador moderno** |
| **Ventajas** | Simple, SEO | Reutilización, escalabilidad, desacoplamiento | Máximo acceso a hardware y rendimiento | Reutilización de código, UI consistente | Offline, instalable, bajo costo, una sola base de código, enlazable |
| **Desventajas** | Sin offline, recarga constante | No resuelve por sí sola el problema offline | Costo, tiempos, tiendas | Dependencia de frameworks, tamaño | Soporte desigual de algunas APIs (Background Sync en iOS), menos acceso a hardware avanzado |
| **Idoneidad para CivicGuard** | ❌ Baja | ⚠️ Parcial (es la capa de backend) | ✅ Alta, pero costosa | ✅ Alta, pero costosa | ✅✅ **Óptima** |

## 3. Justificación de la arquitectura seleccionada

Se elige una **PWA con arquitectura desacoplada (headless)**: el front-end es autónomo y consume una **API REST** (capa orientada a servicios) solo cuando hay red. Razones:

1. **Operatividad en red hostil**: Service Worker + Cache API sirven el Application Shell sin red; IndexedDB retiene reportes y fotos.
2. **Hardware sin tiendas**: GPS y cámara están disponibles por API web, sin proceso de publicación.
3. **Costo y tiempo**: una base de código para todas las plataformas y despliegue en 4 semanas.
4. **Actualización inmediata** de correcciones críticas en un sistema de emergencias.
5. **Desacoplamiento**: la API puede sustituirse (otra BD, otro proveedor) sin tocar el cliente.

**Riesgos y mitigaciones.** Background Sync no existe en Safari/Firefox → se implementa sincronización manual al evento `online` y botón "Sincronizar". Push en iOS exige instalar la PWA → se incluye botón de instalación e instrucciones.

## 4. Modelo de renderizado (Semana 2)
- **CSR** para la interacción (formulario, listado, cámara, sincronización).
- **Inyección estática** para placeholders estructurales: el HTML del Application Shell (cabecera, navegación, contenedores y esqueletos "Cargando…") viene ya maquetado en `index.html` y se precachea; el JS solo rellena los datos.
