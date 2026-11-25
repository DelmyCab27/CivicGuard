# Reporte del Plan de Pruebas y Despliegue
**CivicGuard PWA – Semana 4**

> ⚠️ Las secciones marcadas con **[COMPLETAR]** requieren que el equipo ejecute la prueba/despliegue real y pegue sus resultados. No inventes cifras: Lighthouse debe correrse sobre la URL pública.

## 1. Plan de pruebas funcionales

| ID | Prueba | Pasos | Resultado esperado | Resultado real |
|---|---|---|---|---|
| F1 | Instalación | Abrir en Chrome Android → "Instalar app" | Se agrega a pantalla de inicio con icono maskable y splash | [COMPLETAR] |
| F2 | Arranque offline | Abrir la app, activar Modo Avión, cerrar y reabrir | La app carga desde caché | [COMPLETAR] |
| F3 | Geolocalización | Paso 2 → Pulsar "Usar mi ubicación actual" (aceptar explicación y permiso) | Muestra ubicación confirmada y precisión | [COMPLETAR] |
| F4 | Cámara | Paso 2 → "Tomar foto" → "Capturar foto" | Vista previa de la foto y opción "Quitar foto" | [COMPLETAR] |
| F5 | Reporte offline | En Modo Avión: completar 3 pasos → Enviar reporte | Pantalla de confirmación con folio `CG-YYYY-0001`, mensaje offline y aparece en "Mis reportes" como *Guardado* | [COMPLETAR] |
| F6 | Sincronización | Desactivar Modo Avión | Estatus pasa por *Sincronizando…* y cambia a *Recibido* en la línea de tiempo (o con "Sincronizar" en Safari/Firefox) | [COMPLETAR] |
| F7 | Idempotencia | Reintentar sync del mismo reporte | El servidor no duplica | Verificado con `curl` |
| F8 | Push | Ajustes → "Activar avisos"; cambiar un reporte a `resuelto` con la API | Llega notificación nativa | [COMPLETAR] |
| F9 | Actualización del SW | Subir `VERSION` en `sw.js` (actual: `v1.2.0`) y recargar | Se activa la nueva versión y se elimina la caché anterior | [COMPLETAR] |
| F10 | Sin localStorage | DevTools → Application → Local Storage | Vacío; datos en IndexedDB `civicguard-db` | [COMPLETAR] |

### Comando para disparar el push de prueba
```bash
curl -X PATCH https://TU-URL/api/reports/<ID>/status \
  -H "Content-Type: application/json" -H "x-admin-token: <ADMIN_TOKEN>" \
  -d '{"status":"resuelto"}'
```

## 2. Pruebas de API ya ejecutadas (local)
| Prueba | Resultado |
|---|---|
| `GET /api/health` | 200 `{ok:true}` |
| `POST /api/reports` con foto | 201, foto guardada |
| Reintento del mismo `id` | Devuelve el reporte existente (sin duplicar) |
| Coordenadas fuera de rango | 400 |
| `PATCH …/status` sin token | 401 |
| `PATCH …/status` con token | 200, estatus actualizado |
| `Cache-Control` en `sw.js` | `no-cache, no-store, must-revalidate` |

## 3. Auditoría con Google Lighthouse
**Cómo ejecutarla:** Chrome → URL pública HTTPS → DevTools → Lighthouse → categorías *Performance, Accessibility, Best Practices, SEO, PWA/Installable* → dispositivo **Mobile** → simulated throttling (**Slow 4G/3G**) → *Analyze*. Alternativa por CLI:
```bash
npx lighthouse https://TU-URL --preset=perf --form-factor=mobile --throttling-method=simulate --output=html --output-path=./lighthouse-report.html
```
> Nota: las versiones recientes de Lighthouse (≥ 12) retiraron la categoría "PWA" con puntaje numérico y la reemplazaron por validaciones de instalabilidad. Si tu versión no la muestra, usa Lighthouse 11 o documenta el checklist de instalabilidad (manifest válido, SW con fetch handler, HTTPS, iconos 192/512, maskable, viewport, theme-color) y adjunta captura.

| Categoría | Meta | Resultado [COMPLETAR] |
|---|---|---|
| Rendimiento | ≥ 90 | |
| Accesibilidad | ≥ 90 | |
| Mejores prácticas | ≥ 90 | |
| PWA (checklist / puntaje) | ≥ 90 / todos ✔ | |

**Checklist PWA** [COMPLETAR ✔/✖]: HTTPS · redirección HTTP→HTTPS · registra SW · responde 200 offline · manifest con nombre, iconos 192/512 · `start_url` · `theme-color` · viewport · icono maskable · pantalla de bienvenida personalizada.

### Informe de resultados [COMPLETAR]
Describir hallazgos, oportunidades sugeridas por Lighthouse y las correcciones aplicadas (antes/después).

## 4. Despliegue en producción (HTTPS obligatorio)
Opciones de hosting con SSL/TLS automático (cualquiera con Node.js): **Render**, **Railway**, **Fly.io**, **Glitch**. Ejemplo con Render:

1. Subir el proyecto a GitHub.
2. Render → *New Web Service* → conectar el repo.
3. Build: `npm install` · Start: `npm start`.
4. Variables de entorno: `ADMIN_TOKEN` (valor largo y aleatorio), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (genera con `npx web-push generate-vapid-keys`) y `VAPID_SUBJECT=mailto:tu-correo`.
5. Añadir un disco persistente en `/opt/render/project/src/data` **o** definir `DATA_DIR` hacia el disco (si no, los datos se pierden al reiniciar en planes gratuitos).
6. Verificar el candado HTTPS y repetir pruebas F1–F10 en la URL pública.

**URL pública de producción:** [COMPLETAR – https://…]
**Repositorio:** https://github.com/DelmyCab27/CivicGuard

## 5. Conclusiones [COMPLETAR]
