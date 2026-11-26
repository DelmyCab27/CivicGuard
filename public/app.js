/* app.js - Lógica de cliente (CSR) de CivicGuard PWA */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = {
    step: 1,
    location: null,
    photoBlob: null,
    stream: null,
    deferredPrompt: null,
    filter: 'all',
    onboardSlide: 0
  };

  const STEP_TITLES = {
    1: 'Tipo de problema',
    2: 'Ubicación y evidencia',
    3: 'Descripción y envío'
  };

  const STATUS_INFO = {
    pendiente: { label: 'Guardado', stepIndex: 0 },
    enviando: { label: 'Sincronizando…', stepIndex: 1 },
    enviado: { label: 'Recibido', stepIndex: 2 },
    recibido: { label: 'Recibido', stepIndex: 2 },
    en_proceso: { label: 'En proceso', stepIndex: 3 },
    resuelto: { label: 'Resuelto', stepIndex: 4 }
  };

  const TIMELINE_STEPS = ['Guardado', 'Enviando', 'Recibido', 'En proceso', 'Resuelto'];

  /* ---------------- Utilidades ---------------- */
  function toast(msg, ms = 3200) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  const uid = () => (crypto.randomUUID
    ? crypto.randomUUID()
    : 'r-' + Date.now() + '-' + Math.random().toString(16).slice(2));

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function urlBase64ToUint8Array(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  function formatReadableDate(ts) {
    const d = new Date(ts);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((startOfToday - startOfTarget) / 86400000);
    const timeStr = d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (diffDays === 0) return `Hoy, ${timeStr}`;
    if (diffDays === 1) return `Ayer, ${timeStr}`;
    const dateStr = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    return `${dateStr}, ${timeStr}`;
  }

  function formatLocationText(loc) {
    if (!loc) return 'Sin ubicación';
    return `Ubicación confirmada (precisión ~${loc.accuracy} m)`;
  }

  function showFieldError(id, msg) {
    const el = $(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ---------------- Navegación SPA ---------------- */
  let listPollTimer = null;
  function showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('.app-nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    clearInterval(listPollTimer);
    listPollTimer = null;
    if (name === 'list') {
      refreshRemoteStatuses().finally(() => renderList());
      listPollTimer = setInterval(() => {
        if (navigator.onLine && !document.hidden) {
          refreshRemoteStatuses().then(changed => { if (changed) renderList(); });
        }
      }, 5000);
    }
  }
  document.querySelectorAll('.app-nav button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  /* ---------------- Estado de red ---------------- */
  function updateNet() {
    const el = $('net-status');
    const on = navigator.onLine;
    el.textContent = on ? 'En línea' : 'Sin conexión';
    el.classList.toggle('offline', !on);
  }
  window.addEventListener('online', () => {
    updateNet();
    toast('Conexión restablecida. Enviando reportes pendientes…');
    requestSync();
  });
  window.addEventListener('offline', () => {
    updateNet();
    toast('Sin conexión: tus reportes se guardarán en el dispositivo');
  });

  /* ---------------- Asistente de 3 pasos ---------------- */
  function goToStep(step) {
    state.step = step;
    document.querySelectorAll('.wizard-step').forEach(el => {
      const s = Number(el.dataset.step);
      el.hidden = s !== step;
      el.classList.toggle('active', s === step);
    });

    $('wizard-step-label').textContent = `Paso ${step} de 3`;
    $('wizard-step-title').textContent = STEP_TITLES[step];
    const track = document.querySelector('.progress-track');
    if (track) track.setAttribute('aria-valuenow', String(step));
    $('wizard-bar-fill').style.width = `${(step / 3) * 100}%`;

    document.querySelectorAll('.w-dot').forEach(dot => {
      const s = Number(dot.dataset.stepDot);
      dot.classList.toggle('active', s === step);
      dot.classList.toggle('done', s < step);
    });

    if (step === 3) updateSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateSummary() {
    $('sum-type').textContent = $('type').value || '—';
    $('sum-geo').textContent = state.location
      ? `${state.location.lat.toFixed(4)}, ${state.location.lng.toFixed(4)} (±${state.location.accuracy} m)`
      : 'Sin ubicación';
    $('sum-photo').textContent = state.photoBlob ? '1 foto adjunta' : 'Sin foto adjunta';
    const prioMap = { baja: 'Baja', media: 'Media', alta: 'Alta (urgente)' };
    $('sum-priority').textContent = prioMap[$('priority').value] || 'Media';
  }

  /* ---------------- Paso 1: Tarjetas de tipo ---------------- */
  const typeCards = [...document.querySelectorAll('#type-cards .type-card')];
  function selectType(typeVal) {
    $('type').value = typeVal;
    typeCards.forEach(c => c.setAttribute('aria-checked', String(c.dataset.type === typeVal)));
    showFieldError('type-error', '');
  }

  typeCards.forEach((card, idx) => {
    card.addEventListener('click', () => selectType(card.dataset.type));
    card.addEventListener('keydown', e => {
      let nextIdx = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % typeCards.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + typeCards.length) % typeCards.length;
      if (nextIdx !== null) {
        e.preventDefault();
        typeCards[nextIdx].focus();
        selectType(typeCards[nextIdx].dataset.type);
      }
    });
  });

  $('btn-next-1').addEventListener('click', () => {
    if (!$('type').value) {
      showFieldError('type-error', 'Por favor, elige qué tipo de problema quieres reportar.');
      typeCards[0]?.focus();
      return;
    }
    goToStep(2);
  });

  /* ---------------- Paso 2 y 3 navegación ---------------- */
  $('btn-prev-2').addEventListener('click', () => goToStep(1));
  $('btn-next-2').addEventListener('click', () => {
    if (!state.location) {
      showFieldError('geo-error', 'Necesitamos tu ubicación para saber dónde enviar ayuda.');
      $('btn-geo').focus();
      return;
    }
    goToStep(3);
    $('description').focus();
  });
  $('btn-prev-3').addEventListener('click', () => goToStep(2));

  document.querySelectorAll('[data-goto-step]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.gotoStep)));
  });

  /* ---------------- Prioridad y botón SOS ---------------- */
  function setPriority(p) {
    $('priority').value = p;
    document.querySelectorAll('#priority-chips .chip').forEach(c => {
      const on = c.dataset.p === p;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', String(on));
    });
    if (state.step === 3) updateSummary();
  }
  document.querySelectorAll('#priority-chips .chip').forEach(c => c.addEventListener('click', () => setPriority(c.dataset.p)));

  $('btn-sos').addEventListener('click', () => {
    showView('new');
    $('report-confirmation').hidden = true;
    $('report-form').hidden = false;
    $('wizard-progress').hidden = false;
    setPriority('alta');
    if (!$('type').value) selectType('Otro');
    goToStep(2);
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
    toast('Prioridad ALTA activada. Confirma tu ubicación.');
    if (!state.location) $('btn-geo').click();
  });

  /* ---------------- Contador y validación en línea ---------------- */
  $('description').addEventListener('input', () => {
    const val = $('description').value;
    const len = val.length;
    const countEl = $('description-count');
    countEl.textContent = `${len} / 500`;
    countEl.classList.toggle('near', len >= 450);
    if (val.trim().length >= 10) {
      $('description').removeAttribute('aria-invalid');
      showFieldError('description-error', '');
    }
  });

  /* ---------------- Modal pre-permisos ---------------- */
  const PERM_COPY = {
    geo: {
      title: '¿Por qué pedimos tu ubicación?',
      desc: 'CivicGuard usa tu ubicación actual únicamente para marcar el punto exacto del problema y enviarlo a la cuadrilla correspondiente.',
      svg: '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="rgba(61,224,197,0.12)" stroke="var(--cyan)" stroke-width="2"/><path d="M40 20c-8 0-14 6-14 14 0 11 14 26 14 26s14-15 14-26c0-8-6-14-14-14z" fill="none" stroke="var(--cyan)" stroke-width="3"/><circle cx="40" cy="34" r="5" fill="var(--amber)"/></svg>'
    },
    camera: {
      title: '¿Por qué pedimos acceso a la cámara?',
      desc: 'Usaremos la cámara solo cuando tú captures una foto de evidencia para ayudar a identificar mejor el problema.',
      svg: '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" fill="rgba(255,176,32,0.12)" stroke="var(--amber)" stroke-width="2"/><rect x="20" y="28" width="40" height="28" rx="5" fill="none" stroke="var(--amber)" stroke-width="3"/><circle cx="40" cy="42" r="7" fill="none" stroke="var(--cyan)" stroke-width="3"/></svg>'
    }
  };

  async function ensurePermissionExplained(kind) {
    const explained = await CGDB.getMeta('perm_' + kind).catch(() => false);
    if (explained) return true;

    return new Promise(resolve => {
      const copy = PERM_COPY[kind];
      $('perm-icon').innerHTML = copy.svg;
      $('perm-title').textContent = copy.title;
      $('perm-desc').textContent = copy.desc;
      $('perm-modal').hidden = false;

      const allowBtn = $('btn-perm-allow');
      const cancelBtn = $('btn-perm-cancel');
      allowBtn.focus();

      function cleanup(result) {
        $('perm-modal').hidden = true;
        allowBtn.removeEventListener('click', onAllow);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }
      async function onAllow() {
        await CGDB.setMeta('perm_' + kind, true).catch(() => {});
        cleanup(true);
      }
      function onCancel() { cleanup(false); }

      allowBtn.addEventListener('click', onAllow);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  /* ---------------- Geolocalización ---------------- */
  function setRadar(mode) {
    const r = $('radar');
    r.classList.remove('locating', 'locked');
    if (mode) r.classList.add(mode);
  }

  $('btn-geo').addEventListener('click', async () => {
    const out = $('geo-out');
    if (!('geolocation' in navigator)) {
      showFieldError('geo-error', 'Tu dispositivo no permite obtener la ubicación.');
      return;
    }
    const ok = await ensurePermissionExplained('geo');
    if (!ok) return;

    showFieldError('geo-error', '');
    out.textContent = 'Buscando tu ubicación…';
    setRadar('locating');

    navigator.geolocation.getCurrentPosition(
      pos => {
        state.location = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          ts: pos.timestamp
        };
        out.textContent = formatLocationText(state.location);
        setRadar('locked');
        if (navigator.vibrate) navigator.vibrate(40);
      },
      err => {
        const msgs = {
          1: 'No se otorgó permiso de ubicación. Actívalo en los ajustes de tu navegador.',
          2: 'No pudimos detectar tu ubicación en este momento.',
          3: 'Tardó demasiado en responder. Intenta de nuevo en un lugar abierto.'
        };
        out.textContent = 'Sin ubicación confirmada.';
        showFieldError('geo-error', msgs[err.code] || 'No se pudo obtener la ubicación.');
        setRadar('');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });

  /* ---------------- Cámara ---------------- */
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('Cámara no disponible aquí; usa "Elegir de galería".');
      return;
    }
    const ok = await ensurePermissionExplained('camera');
    if (!ok) return;

    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      const v = $('video');
      v.srcObject = state.stream;
      v.hidden = false;
      await v.play();
      $('cam-actions').hidden = false;
    } catch (e) {
      toast('No se pudo abrir la cámara. Puedes usar "Elegir de galería".');
    }
  }

  function stopCamera() {
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
    $('video').hidden = true;
    $('cam-actions').hidden = true;
  }

  function setPhoto(blob) {
    state.photoBlob = blob;
    const img = $('preview');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.dataset.url = URL.createObjectURL(blob);
    img.src = img.dataset.url;
    img.hidden = false;
    $('photo-preview-wrap').hidden = false;
  }

  function clearPhoto() {
    state.photoBlob = null;
    const img = $('preview');
    if (img.dataset.url) URL.revokeObjectURL(img.dataset.url);
    img.removeAttribute('src');
    img.hidden = true;
    $('photo-preview-wrap').hidden = true;
    $('file-input').value = '';
  }

  $('btn-camera').addEventListener('click', startCamera);
  $('btn-stop').addEventListener('click', stopCamera);
  $('btn-remove-photo').addEventListener('click', clearPhoto);
  $('btn-snap').addEventListener('click', () => {
    const v = $('video'), c = $('canvas');
    const maxW = 1024, ratio = Math.min(1, maxW / v.videoWidth);
    c.width = v.videoWidth * ratio;
    c.height = v.videoHeight * ratio;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    c.toBlob(b => { setPhoto(b); stopCamera(); }, 'image/jpeg', 0.75);
  });
  $('file-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) setPhoto(f);
  });

  /* ---------------- Guardar reporte y confirmación ---------------- */
  function resetReportForm() {
    $('report-form').reset();
    typeCards.forEach(c => c.setAttribute('aria-checked', 'false'));
    state.location = null;
    clearPhoto();
    stopCamera();
    $('geo-out').textContent = 'Aún sin ubicación confirmada.';
    $('description-count').textContent = '0 / 500';
    $('description-count').classList.remove('near');
    $('description').removeAttribute('aria-invalid');
    showFieldError('type-error', '');
    showFieldError('geo-error', '');
    showFieldError('description-error', '');
    showFieldError('form-msg', '');
    setRadar('');
    setPriority('media');
    goToStep(1);
  }

  function showConfirmation(report, isOnline) {
    $('report-form').hidden = true;
    $('wizard-progress').hidden = true;
    const box = $('report-confirmation');
    const iconBox = $('confirm-icon');
    iconBox.classList.toggle('offline', !isOnline);

    $('confirm-title').textContent = isOnline ? '¡Reporte enviado!' : 'Guardado sin conexión';
    $('confirm-folio').textContent = report.folio;
    $('confirm-status-msg').textContent = isOnline
      ? 'Tu reporte se envió a CivicGuard. Puedes dar seguimiento a su avance en "Mis reportes".'
      : 'Guardado sin conexión; se enviará automáticamente en cuanto recuperes internet.';

    const prioMap = { baja: 'Baja', media: 'Media', alta: 'Alta (urgente)' };
    $('confirm-summary').innerHTML = `
      <div class="summary-row"><dt>Problema</dt><dd>${escapeHtml(report.type)}</dd></div>
      <div class="summary-row"><dt>Urgencia</dt><dd>${escapeHtml(prioMap[report.priority] || 'Media')}</dd></div>
      <div class="summary-row"><dt>Ubicación</dt><dd>${escapeHtml(formatLocationText(report.location))}</dd></div>
      <div class="summary-row"><dt>Detalle</dt><dd>${escapeHtml(report.description)}</dd></div>
    `;
    box.hidden = false;
  }

  $('report-form').addEventListener('submit', async e => {
    e.preventDefault();
    const type = $('type').value;
    const description = $('description').value.trim();

    if (!type) { goToStep(1); showFieldError('type-error', 'Por favor, elige qué tipo de problema quieres reportar.'); return; }
    if (!state.location) { goToStep(2); showFieldError('geo-error', 'Necesitamos tu ubicación para saber dónde acudir.'); return; }
    if (description.length < 10) {
      $('description').setAttribute('aria-invalid', 'true');
      showFieldError('description-error', 'Cuéntanos brevemente qué ocurre (al menos 10 caracteres).');
      $('description').focus();
      return;
    }

    const folio = await CGDB.nextFolio();
    const now = Date.now();
    const report = {
      id: uid(),
      folio,
      type,
      description,
      priority: $('priority').value,
      location: state.location,
      photo: state.photoBlob || null,
      resolvedPhoto: null,
      adminNote: null,
      status: 'pendiente',
      createdAt: now,
      history: [
        { status: 'pendiente', at: now, note: 'Guardado en tu dispositivo' }
      ]
    };

    try {
      await CGDB.saveReport(report);
      if (navigator.vibrate) navigator.vibrate(60);
      const online = navigator.onLine;
      resetReportForm();
      showConfirmation(report, online);
      await updatePending();
      requestSync();
    } catch (err) {
      showFieldError('form-msg', 'No pudimos guardar el reporte: ' + err.message);
    }
  });

  $('btn-confirm-new').addEventListener('click', () => {
    $('report-confirmation').hidden = true;
    $('report-form').hidden = false;
    $('wizard-progress').hidden = false;
    goToStep(1);
  });

  $('btn-confirm-list').addEventListener('click', () => {
    $('report-confirmation').hidden = true;
    $('report-form').hidden = false;
    $('wizard-progress').hidden = false;
    showView('list');
  });

  /* ---------------- Sincronización ---------------- */
  async function requestSync() {
    if (navigator.onLine) {
      await manualSync();
      return;
    }
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return;
    if ('sync' in reg) {
      try { await reg.sync.register('sync-reports'); return; } catch (e) { /* fallback manual */ }
    }
  }

  async function manualSync() {
    if (!navigator.onLine) {
      toast('Sin conexión. Se enviará automáticamente al volver la red.');
      return;
    }
    const syncBtn = $('btn-sync');
    syncBtn.classList.add('syncing');
    syncBtn.disabled = true;

    const pending = await CGDB.getByStatus('pendiente');
    for (const r of pending) {
      await CGDB.updateStatus(r.id, { status: 'enviando' });
      renderList();

      const fd = new FormData();
      fd.append('id', r.id);
      fd.append('type', r.type);
      fd.append('priority', r.priority);
      fd.append('description', r.description);
      fd.append('createdAt', r.createdAt);
      if (r.location) {
        fd.append('lat', r.location.lat);
        fd.append('lng', r.location.lng);
        fd.append('accuracy', r.location.accuracy);
      }
      if (r.photo) fd.append('photo', r.photo, 'evidencia.jpg');

      try {
        const res = await fetch('/api/reports', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(res.status);
        const saved = await res.json();
        const prevHist = Array.isArray(r.history) ? r.history : [];
        const srvHist = Array.isArray(saved.history) ? saved.history : [{ status: 'recibido', at: Date.now(), note: 'Recibido por CivicGuard' }];
        await CGDB.updateStatus(r.id, {
          status: saved.status || 'recibido',
          syncedAt: Date.now(),
          history: [...prevHist, ...srvHist]
        });
      } catch (e) {
        await CGDB.updateStatus(r.id, { status: 'pendiente' });
        break;
      }
    }

    syncBtn.classList.remove('syncing');
    syncBtn.disabled = false;
    await updatePending();
    await renderList();
  }
  $('btn-sync').addEventListener('click', manualSync);

  async function refreshRemoteStatuses() {
    if (!navigator.onLine) return false;
    try {
      const res = await fetch('/api/reports', { cache: 'no-store' });
      if (!res.ok) return false;
      const remote = await res.json();
      const map = new Map(remote.map(item => [item.id, item]));
      const local = await CGDB.getAllReports();
      let changed = false;
      for (const r of local) {
        const srv = map.get(r.id);
        if (!srv || r.status === 'pendiente' || r.status === 'enviando') continue;
        const srvHistLen = Array.isArray(srv.history) ? srv.history.length : 0;
        const localSrvLen = Number(r.srvHistLen || 0);
        if (srv.status !== r.status || srv.adminNote !== r.adminNote || srv.resolvedPhoto !== r.resolvedPhoto || srvHistLen !== localSrvLen) {
          const localOnly = (Array.isArray(r.history) ? r.history : []).filter(h => h.status === 'pendiente');
          const mergedHistory = [...localOnly, ...(Array.isArray(srv.history) ? srv.history : [])];
          await CGDB.updateStatus(r.id, {
            status: srv.status,
            adminNote: srv.adminNote || null,
            resolvedPhoto: srv.resolvedPhoto || null,
            srvHistLen,
            history: mergedHistory.length ? mergedHistory : r.history
          });
          changed = true;
        }
      }
      return changed;
    } catch (e) { return false; }
  }

  /* ---------------- Listado y filtros ---------------- */
  async function updatePending() {
    const pending = await CGDB.getByStatus('pendiente');
    const syncing = await CGDB.getByStatus('enviando');
    const n = pending.length + syncing.length;
    const p = $('pending-count');
    p.textContent = n;
    p.hidden = n === 0;
  }

  document.querySelectorAll('#status-filters .filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      document.querySelectorAll('#status-filters .filter-chip').forEach(b => b.classList.toggle('active', b === btn));
      renderList();
    });
  });

  function matchesFilter(status, filter) {
    if (filter === 'all') return true;
    if (filter === 'pendiente') return status === 'pendiente' || status === 'enviando';
    if (filter === 'recibido') return status === 'recibido' || status === 'enviado';
    return status === filter;
  }

  function renderTimelineHtml(status) {
    const info = STATUS_INFO[status] || STATUS_INFO.pendiente;
    const idx = info.stepIndex;
    const isSyncing = status === 'enviando';
    return `<div class="timeline" aria-label="Avance del reporte">${TIMELINE_STEPS.map((label, i) => {
      let cls = 'tl-step';
      if (i < idx) cls += ' done';
      else if (i === idx) cls += isSyncing ? ' current syncing' : ' current';
      return `<div class="${cls}"><span class="tl-dot"></span><span class="tl-label">${label}</span></div>`;
    }).join('')}</div>`;
  }

  async function renderList() {
    const ul = $('report-list');
    const summaryEl = $('list-summary');
    const allReports = await CGDB.getAllReports();
    const reports = allReports.filter(r => matchesFilter(r.status, state.filter));

    if (allReports.length) {
      const activos = allReports.filter(r => r.status !== 'resuelto').length;
      const resueltos = allReports.length - activos;
      summaryEl.textContent = `${activos} activo(s) · ${resueltos} resuelto(s)`;
      summaryEl.hidden = false;
    } else {
      summaryEl.hidden = true;
    }

    if (!allReports.length) {
      ul.innerHTML = `
        <li class="empty-state">
          <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="12" y="10" width="40" height="44" rx="6"/>
            <path d="M22 24h20M22 34h14M22 44h10"/>
          </svg>
          <h3>Aún no tienes reportes</h3>
          <p>Cuando envíes un reporte ciudadano aparecerá aquí con su folio y avance en tiempo real.</p>
          <button type="button" id="btn-empty-new" class="btn-primary small">Crear mi primer reporte</button>
        </li>`;
      $('btn-empty-new')?.addEventListener('click', () => showView('new'));
      return;
    }

    if (!reports.length) {
      ul.innerHTML = `
        <li class="empty-state">
          <h3>Sin reportes en esta categoría</h3>
          <p>Prueba seleccionando otro filtro para ver tus demás reportes.</p>
          <button type="button" id="btn-empty-reset" class="ghost small">Ver todos los reportes</button>
        </li>`;
      $('btn-empty-reset')?.addEventListener('click', () => {
        state.filter = 'all';
        document.querySelectorAll('#status-filters .filter-chip').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
        renderList();
      });
      return;
    }

    ul.innerHTML = '';
    for (const r of reports) {
      const li = document.createElement('li');
      li.className = 'card p-' + escapeHtml(r.priority || 'media');
      const statusInfo = STATUS_INFO[r.status] || { label: r.status || 'Guardado' };
      const when = formatReadableDate(r.createdAt);
      const loc = r.location ? `${r.location.lat.toFixed(4)}, ${r.location.lng.toFixed(4)}` : 'Sin ubicación';
      const folio = r.folio || ('CG-' + String(r.id).slice(0, 8).toUpperCase());
      const syncSpin = r.status === 'enviando'
        ? '<svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
        : '';

      const top = document.createElement('div');
      top.className = 'card-top';

      const main = document.createElement('div');
      main.className = 'card-main';
      main.innerHTML = `
        <div class="card-title-row">
          <h3>${escapeHtml(r.type)}</h3>
          <span class="card-folio">${escapeHtml(folio)}</span>
        </div>
        <div class="card-tags">
          <span class="tag ${escapeHtml(r.status)}">${syncSpin}${escapeHtml(statusInfo.label)}</span>
          ${r.priority === 'alta' ? '<span class="tag alta">Urgente</span>' : ''}
        </div>
        <p>${escapeHtml(r.description)}</p>
        ${r.adminNote ? `<p class="card-note"><strong>Respuesta municipal:</strong> ${escapeHtml(r.adminNote)}</p>` : ''}
        <div class="card-meta">
          <span>
            <svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
            ${escapeHtml(when)}
          </span>
          <span>
            <svg class="ico-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${escapeHtml(loc)}
          </span>
        </div>
      `;
      top.appendChild(main);

      if (r.photo) {
        const img = document.createElement('img');
        img.className = 'card-thumb';
        img.alt = 'Miniatura de evidencia';
        img.src = URL.createObjectURL(r.photo);
        img.onload = () => URL.revokeObjectURL(img.src);
        top.appendChild(img);
      }

      li.appendChild(top);
      li.insertAdjacentHTML('beforeend', renderTimelineHtml(r.status));
      li.insertAdjacentHTML('beforeend', `
        <div class="card-footer">
          <button type="button" class="link-btn" data-detail-id="${escapeHtml(r.id)}">Ver detalle y bitácora →</button>
        </div>
      `);
      ul.appendChild(li);
    }
  }

  let currentDetailReport = null;
  async function openReportDetail(id) {
    const r = await CGDB.getReport(id);
    if (!r) return;
    currentDetailReport = r;
    const folio = r.folio || ('CG-' + String(r.id).slice(0, 8).toUpperCase());
    const statusInfo = STATUS_INFO[r.status] || { label: r.status || 'Guardado' };

    $('detail-folio').textContent = folio;
    $('detail-title').textContent = r.type;
    $('detail-tags').innerHTML = `
      <span class="tag ${escapeHtml(r.status)}">${escapeHtml(statusInfo.label)}</span>
      ${r.priority === 'alta' ? '<span class="tag alta">Urgente</span>' : ''}
    `;
    $('detail-desc').textContent = r.description;
    $('detail-loc').textContent = r.location
      ? `Ubicación: ${r.location.lat.toFixed(5)}, ${r.location.lng.toFixed(5)} (±${r.location.accuracy} m)`
      : 'Sin ubicación registrada';

    const photosEl = $('detail-photos');
    photosEl.innerHTML = '';
    if (r.photo || r.resolvedPhoto) {
      if (r.photo) {
        const wrap = document.createElement('div');
        wrap.className = 'ba-item';
        const img = document.createElement('img');
        img.alt = 'Foto del ciudadano';
        img.src = URL.createObjectURL(r.photo);
        img.onload = () => URL.revokeObjectURL(img.src);
        wrap.appendChild(img);
        wrap.insertAdjacentHTML('beforeend', '<span>Antes (Tu reporte)</span>');
        photosEl.appendChild(wrap);
      }
      if (r.resolvedPhoto) {
        const wrap = document.createElement('div');
        wrap.className = 'ba-item';
        wrap.innerHTML = `<img src="${escapeHtml(r.resolvedPhoto)}" alt="Evidencia de solución"><span>Después (Solución)</span>`;
        photosEl.appendChild(wrap);
      }
      photosEl.hidden = false;
    } else {
      photosEl.hidden = true;
    }

    const hist = Array.isArray(r.history) && r.history.length
      ? r.history
      : [{ status: r.status, at: r.createdAt, note: 'Registro del reporte' }];
    $('detail-history').innerHTML = hist.map(item => {
      const st = (STATUS_INFO[item.status] || { label: item.status }).label;
      return `
        <li class="history-item">
          <strong>${escapeHtml(st)}</strong>
          <time>${escapeHtml(formatReadableDate(item.at))}</time>
          ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}
        </li>
      `;
    }).join('');

    $('btn-delete-local').hidden = r.status !== 'pendiente';
    $('detail-modal').hidden = false;
    $('btn-close-detail').focus();
  }

  $('report-list').addEventListener('click', e => {
    const btn = e.target.closest('button[data-detail-id]');
    if (btn) openReportDetail(btn.dataset.detailId);
  });
  $('btn-close-detail').addEventListener('click', () => { $('detail-modal').hidden = true; });
  $('btn-copy-folio').addEventListener('click', async () => {
    const folio = $('detail-folio').textContent;
    try {
      await navigator.clipboard.writeText(folio);
      toast(`Folio ${folio} copiado`);
    } catch {
      toast(`Tu folio es ${folio}`);
    }
  });
  $('btn-delete-local').addEventListener('click', async () => {
    if (!currentDetailReport) return;
    await CGDB.deleteReport(currentDetailReport.id);
    $('detail-modal').hidden = true;
    toast('Borrador eliminado');
    await updatePending();
    renderList();
  });

  /* ---------------- Bienvenida (3 diapositivas) ---------------- */
  function setOnboardSlide(idx) {
    state.onboardSlide = idx;
    document.querySelectorAll('.onboard-slide').forEach(s => {
      const i = Number(s.dataset.slide);
      s.hidden = i !== idx;
    });
    document.querySelectorAll('.o-dot').forEach(d => d.classList.toggle('active', Number(d.dataset.dot) === idx));
    $('btn-onboard-prev').hidden = idx === 0;
    $('btn-onboard-next').textContent = idx === 2 ? 'Comenzar' : 'Siguiente';
  }

  function openOnboarding() {
    setOnboardSlide(0);
    $('onboarding-modal').hidden = false;
    $('btn-onboard-next').focus();
  }

  async function closeOnboarding() {
    $('onboarding-modal').hidden = true;
    await CGDB.setMeta('onboardingSeen', true).catch(() => {});
  }

  $('btn-onboard-next').addEventListener('click', () => {
    if (state.onboardSlide < 2) setOnboardSlide(state.onboardSlide + 1);
    else closeOnboarding();
  });
  $('btn-onboard-prev').addEventListener('click', () => {
    if (state.onboardSlide > 0) setOnboardSlide(state.onboardSlide - 1);
  });
  $('btn-onboard-skip').addEventListener('click', closeOnboarding);
  $('btn-replay-onboarding').addEventListener('click', openOnboarding);

  /* ---------------- Push ---------------- */
  async function enablePush() {
    const msg = $('push-msg');
    if (!('PushManager' in window) || !('Notification' in window)) {
      msg.textContent = 'Tu navegador no es compatible con avisos.';
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      msg.textContent = 'Permiso de avisos denegado.';
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const { key } = await (await fetch('/api/push/public-key', { cache: 'no-store' })).json();
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe().catch(() => {});
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub)
      });
      if (!subRes.ok) throw new Error('El servidor rechazó la suscripción');
      msg.textContent = 'Avisos activados correctamente. Ya puedes recibir notificaciones.';
    } catch (e) {
      msg.textContent = 'No se pudo activar (¿hay conexión?): ' + e.message;
    }
  }

  async function disablePush() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint })
      }).catch(() => {});
      await sub.unsubscribe();
    }
    $('push-msg').textContent = 'Avisos desactivados.';
  }
  $('btn-push').addEventListener('click', enablePush);
  $('btn-push-off').addEventListener('click', disablePush);

  /* ---------------- Instalación ---------------- */
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    state.deferredPrompt = e;
    $('btn-install').hidden = false;
  });
  $('btn-install').addEventListener('click', async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    $('btn-install').hidden = true;
  });

  /* ---------------- Service Worker ---------------- */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type === 'SYNC_DONE') {
          toast(`Sincronizados ${e.data.count} reporte(s)`);
          updatePending();
          renderList();
        }
        if (e.data?.type === 'PUSH_RECEIVED') {
          toast(e.data.body || 'Tienes una actualización de tu reporte');
          refreshRemoteStatuses().then(() => renderList());
        }
        if (e.data?.type === 'VERSION') $('sw-version').textContent = e.data.version;
      });
      const ready = await navigator.serviceWorker.ready;
      ready.active?.postMessage('GET_VERSION');
    } catch (e) { console.error('SW registro fallido', e); }
  }

  /* ---------------- Arranque ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    updateNet();
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'list') showView('list');
    await updatePending();
    registerSW();
    if (navigator.storage?.persist) navigator.storage.persist();

    const seen = await CGDB.getMeta('onboardingSeen').catch(() => false);
    if (!seen) openOnboarding();
  });
})();
