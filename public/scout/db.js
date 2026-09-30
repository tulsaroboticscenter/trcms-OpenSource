// Minimal IndexedDB wrapper for TRC Scout — no dependencies.
// Stores:
//   kv      key/value (auth token, current member, selected event id)
//   bundles cached offline event bundles, keyed by event_id
//   queue   unsynced scouting records, keyed by client_uuid (idempotent sync key)

const DB_NAME = 'trc-scout';
const DB_VERSION = 2;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('bundles')) db.createObjectStore('bundles', { keyPath: 'event_id' });
      if (!db.objectStoreNames.contains('queue')) {
        const q = db.createObjectStore('queue', { keyPath: 'client_uuid' });
        q.createIndex('by_synced', 'synced', { unique: false });
      }
      if (!db.objectStoreNames.contains('apicache')) db.createObjectStore('apicache', { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  kvGet: (key) => tx('kv', 'readonly', (s) => s.get(key)).then((r) => (r ? r.value : null)),
  kvSet: (key, value) => tx('kv', 'readwrite', (s) => s.put({ key, value })),
  kvDel: (key) => tx('kv', 'readwrite', (s) => s.delete(key)),

  bundlePut: (bundle) => tx('bundles', 'readwrite', (s) => s.put({ event_id: bundle.event.id, ...bundle })),
  bundleGet: (eventId) => tx('bundles', 'readonly', (s) => s.get(Number(eventId))),

  // Queue a scouting record (pit | match | observation). Stamped unsynced.
  queueAdd: (rec) => tx('queue', 'readwrite', (s) => s.put({ synced: 0, queued_at: new Date().toISOString(), ...rec })),
  queueAll: () => tx('queue', 'readonly', (s) => s.getAll()),
  queuePending: () => tx('queue', 'readonly', (s) => s.getAll()).then((all) => all.filter((r) => !r.synced)),
  queueMarkSynced: (uuid) => tx('queue', 'readwrite', (s) => {
    const g = s.get(uuid);
    g.onsuccess = () => { const r = g.result; if (r) { r.synced = 1; r.synced_at = new Date().toISOString(); s.put(r); } };
  }),

  // Cache of last successful GET API responses, so reads work offline.
  apiCacheSet: (path, data) => tx('apicache', 'readwrite', (s) => s.put({ path, data, at: new Date().toISOString() })),
  apiCacheGet: (path) => tx('apicache', 'readonly', (s) => s.get(path)).then((r) => (r ? r.data : null)),
};
