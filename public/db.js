/* db.js - Capa de persistencia con IndexedDB (asíncrona, sin localStorage).
 * Se usa tanto desde la página (window) como desde el Service Worker (importScripts). */
(function (root) {
  const DB_NAME = 'civicguard-db';
  const DB_VERSION = 2;
  const STORE = 'reports';
  const META_STORE = 'meta';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const s = db.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('status', 'status', { unique: false });
          s.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(mode, fn, storeName = STORE) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      Promise.resolve(fn(store)).then(r => { result = r; });
      t.oncomplete = () => { db.close(); resolve(result); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error); };
    }));
  }

  const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  const CGDB = {
    saveReport(report) { return tx('readwrite', s => wrap(s.put(report))); },
    getReport(id) { return tx('readonly', s => wrap(s.get(id))); },
    getAllReports() {
      return tx('readonly', s => wrap(s.getAll())).then(list => list.sort((a, b) => b.createdAt - a.createdAt));
    },
    getByStatus(status) { return tx('readonly', s => wrap(s.index('status').getAll(status))); },
    deleteReport(id) { return tx('readwrite', s => wrap(s.delete(id))); },
    updateStatus(id, patch) {
      return tx('readwrite', s => wrap(s.get(id)).then(r => r ? wrap(s.put({ ...r, ...patch })) : null));
    },
    getMeta(key) {
      return tx('readonly', s => wrap(s.get(key)), META_STORE).then(rec => rec ? rec.value : undefined);
    },
    setMeta(key, value) {
      return tx('readwrite', s => wrap(s.put({ key, value })), META_STORE);
    },
    nextFolio() {
      const year = new Date().getFullYear();
      return tx('readwrite', s => wrap(s.get('folioSeq')).then(rec => {
        const next = (rec && typeof rec.value === 'number' ? rec.value : 0) + 1;
        return wrap(s.put({ key: 'folioSeq', value: next })).then(() =>
          `CG-${year}-${String(next).padStart(4, '0')}`
        );
      }), META_STORE);
    }
  };

  root.CGDB = CGDB;
})(typeof self !== 'undefined' ? self : this);
