/* server.js - API REST desacoplada (headless) + servidor estático de alto rendimiento.
 * El front-end (PWA) es autónomo: funciona sin este servidor gracias a Cache API + IndexedDB.
 * Los datos de la API se guardan en un archivo JSON (reemplazable por cualquier BD externa). */
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'reports.json');
const SUBS_FILE = path.join(DATA_DIR, 'subscriptions.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'cambia-este-token';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));

/* ---- Claves VAPID (variables de entorno o archivo generado) ---- */
let vapid = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  : readJson(VAPID_FILE, null);
if (!vapid) { vapid = webpush.generateVAPIDKeys(); writeJson(VAPID_FILE, vapid); }
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@civicguard.local', vapid.publicKey, vapid.privateKey);

const app = express();
app.use(compression());
app.use(express.json({ limit: '1mb' }));

/* ---- Cabeceras de seguridad ---- */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self)');
  next();
});

/* ---- Estáticos: SIN caché HTTP clásica para sw.js / html / manifest (el SW controla el caché) ---- */
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, file) {
    if (/\.(html|json|js|css)$/.test(file)) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
    if (file.endsWith('sw.js')) res.setHeader('Service-Worker-Allowed', '/');
  }
}));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

/* ---- API ---- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(16).slice(2) + '.jpg')
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

const VALID_PRIORITY = ['baja', 'media', 'alta'];
const VALID_STATUS = ['recibido', 'en_proceso', 'resuelto'];

app.get('/api/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.get('/api/reports', (req, res) => res.json(readJson(DB_FILE, [])));

app.post('/api/reports', upload.single('photo'), (req, res) => {
  const b = req.body;
  if (!b.id || !b.type || !b.description) return res.status(400).json({ error: 'Faltan campos obligatorios' });
  const lat = parseFloat(b.lat), lng = parseFloat(b.lng);
  if (Number.isNaN(lat) || Number.isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return res.status(400).json({ error: 'Coordenadas inválidas' });
  const list = readJson(DB_FILE, []);
  let report = list.find(r => r.id === b.id);
  if (report) return res.json(report); // idempotente: los reintentos de sync no duplican
  report = {
    id: String(b.id).slice(0, 64),
    type: String(b.type).slice(0, 60),
    description: String(b.description).slice(0, 1000),
    priority: VALID_PRIORITY.includes(b.priority) ? b.priority : 'media',
    lat, lng, accuracy: parseFloat(b.accuracy) || null,
    photo: req.file ? '/uploads/' + req.file.filename : null,
    status: 'recibido',
    createdAt: Number(b.createdAt) || Date.now(),
    receivedAt: Date.now()
  };
  list.push(report);
  writeJson(DB_FILE, list);
  res.status(201).json(report);
});

/* Cambio de estatus (uso de la dependencia municipal) -> dispara push */
app.patch('/api/reports/:id/status', async (req, res) => {
  if (req.get('x-admin-token') !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  const { status } = req.body || {};
  if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: 'Estatus inválido' });
  const list = readJson(DB_FILE, []);
  const report = list.find(r => r.id === req.params.id);
  if (!report) return res.status(404).json({ error: 'No encontrado' });
  report.status = status; report.updatedAt = Date.now();
  writeJson(DB_FILE, list);
  if (status === 'resuelto') await notifyAll({
    title: '✅ Reporte solucionado',
    body: `Tu reporte de "${report.type}" fue marcado como resuelto.`,
    reportId: report.id
  });
  res.json(report);
});

/* ---- Push ---- */
app.get('/api/push/public-key', (req, res) => res.json({ key: vapid.publicKey }));

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'Suscripción inválida' });
  const subs = readJson(SUBS_FILE, []).filter(s => s.endpoint !== sub.endpoint);
  subs.push(sub); writeJson(SUBS_FILE, subs);
  res.status(201).json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const subs = readJson(SUBS_FILE, []).filter(s => s.endpoint !== (req.body || {}).endpoint);
  writeJson(SUBS_FILE, subs); res.json({ ok: true });
});

/* Envío de prueba: curl -X POST /api/push/test -H "x-admin-token: ..." */
app.post('/api/push/test', async (req, res) => {
  if (req.get('x-admin-token') !== ADMIN_TOKEN) return res.status(401).json({ error: 'No autorizado' });
  const n = await notifyAll({ title: 'CivicGuard', body: 'Notificación de prueba 🔔' });
  res.json({ sent: n });
});

async function notifyAll(payload) {
  const subs = readJson(SUBS_FILE, []);
  const alive = [];
  let sent = 0;
  await Promise.all(subs.map(async s => {
    try { await webpush.sendNotification(s, JSON.stringify(payload)); alive.push(s); sent++; }
    catch (e) {
      console.error('Push error:', e.statusCode, e.body || e.message);
      if (e.statusCode !== 404 && e.statusCode !== 410 && e.statusCode !== 403 && e.statusCode !== 401) alive.push(s);
    }
  }));
  writeJson(SUBS_FILE, alive);
  return sent;
}

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

app.listen(PORT, () => console.log(`CivicGuard escuchando en http://localhost:${PORT}`));
