/*
 * store.js — лёгкая обёртка над IndexedDB.
 *  - settings:  единственная запись (организация, лого, конфиг) под ключом 'main'
 *  - reports:   список сохранённых отчётов {id, title, month, year, data, updated}
 */
(function (global) {
  'use strict';

  const DB_NAME = 'dnd-reports';
  const DB_VER = 1;
  let dbp = null;

  function open() {
    if (dbp) { return dbp; }
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('settings')) { db.createObjectStore('settings'); }
        if (!db.objectStoreNames.contains('reports')) {
          db.createObjectStore('reports', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }
  function wrap(req) {
    return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  }

  const Store = {
    async getSettings() { return (await tx('settings', 'readonly').then((s) => wrap(s.get('main')))) || null; },
    async saveSettings(obj) { return tx('settings', 'readwrite').then((s) => wrap(s.put(obj, 'main'))); },

    async listReports() {
      const arr = (await tx('reports', 'readonly').then((s) => wrap(s.getAll()))) || [];
      return arr.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    },
    async getReport(id) { return tx('reports', 'readonly').then((s) => wrap(s.get(id))); },
    // keepUpdated=true сохраняет уже проставленный rec.updated (для импорта архива)
    async saveReport(rec, keepUpdated) { if (!keepUpdated || !rec.updated) { rec.updated = Date.now(); } return tx('reports', 'readwrite').then((s) => wrap(s.put(rec))).then(() => rec); },
    async deleteReport(id) { return tx('reports', 'readwrite').then((s) => wrap(s.delete(id))); },
  };

  global.Store = Store;
})(window);
