// =====================================================================
// db.js — Envoltorio mínimo de IndexedDB con promesas.
// Almacenes:
//   settings   { key, value }        ajustes y borrador de sesión
//   workouts   { id, ... }           entrenamientos del usuario
//   sessions   { id, startMs, ... }  historial (resumen de cada sesión)
//   samples    { id, ts, p, v, c, d } datos por segundo de cada sesión
//   ftpHistory { id(auto), date, ftp, source }
// =====================================================================

const DB_NAME = 'potencia-virtual';
const DB_VERSION = 1;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('workouts')) db.createObjectStore('workouts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('startMs', 'startMs');
      }
      if (!db.objectStoreNames.contains('samples')) db.createObjectStore('samples', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('ftpHistory')) db.createObjectStore('ftpHistory', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Ejecuta una operación de escritura y resuelve al completar la transacción. */
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    fn(t.objectStore(store));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  async get(store, key) { const d = await open(); return reqP(d.transaction(store).objectStore(store).get(key)); },
  async getAll(store) { const d = await open(); return reqP(d.transaction(store).objectStore(store).getAll()); },
  put(store, value) { return tx(store, 'readwrite', (s) => { s.put(value); }); },
  delete(store, key) { return tx(store, 'readwrite', (s) => { s.delete(key); }); },
  async add(store, value) { const d = await open(); return reqP(d.transaction(store, 'readwrite').objectStore(store).add(value)); },

  // Atajos para ajustes clave-valor
  async getSetting(key, def) { const r = await this.get('settings', key); return r ? r.value : def; },
  setSetting(key, value) { return this.put('settings', { key, value }); },
  deleteSetting(key) { return this.delete('settings', key); },
};

/** Pide almacenamiento persistente para que Chrome no borre el historial. */
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) {}
  return false;
}
