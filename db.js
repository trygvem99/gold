// Gold storage — hand-rolled IndexedDB module, no libraries.
// Stores: habits (id), days (date), tickets (id, index date), prizes (id),
// wins (id), settings (key). Everything lives on this device only.
"use strict";

const DB = (() => {
  const NAME = "gold";
  const VERSION = 1;
  let _db = null;

  // Guarded from version 1 so that bumping VERSION later and appending a store
  // is safe on installs that already exist.
  function upgrade(db) {
    const ensure = (name, opts, indexes) => {
      if (db.objectStoreNames.contains(name)) return;
      const s = db.createObjectStore(name, opts);
      (indexes || []).forEach(([n, path]) => s.createIndex(n, path));
    };
    ensure("habits", { keyPath: "id" });
    ensure("days", { keyPath: "date" });
    ensure("tickets", { keyPath: "id" }, [["date", "date"]]);
    ensure("prizes", { keyPath: "id" });
    ensure("wins", { keyPath: "id" });
    ensure("settings", { keyPath: "key" });
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const result = fn(t.objectStore(store));
      t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
      t.onerror = () => reject(t.error);
    }));
  }

  const put = (store, value) => tx(store, "readwrite", (s) => s.put(value));
  const bulkPut = (store, values) => tx(store, "readwrite", (s) => { values.forEach((v) => s.put(v)); });
  const bulkDel = (store, keys) => tx(store, "readwrite", (s) => { keys.forEach((k) => s.delete(k)); });
  const del = (store, key) => tx(store, "readwrite", (s) => s.delete(key));
  const clear = (store) => tx(store, "readwrite", (s) => s.clear());
  const get = (store, key) => tx(store, "readonly", (s) => s.get(key));
  const getAll = (store) => tx(store, "readonly", (s) => s.getAll());

  return { open, put, bulkPut, bulkDel, del, clear, get, getAll };
})();

const Data = (() => {
  const STORES = ["habits", "days", "tickets", "prizes", "wins", "settings"];
  const FORMAT = 1;
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  async function init() {
    await DB.open();
    if ("storage" in navigator && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    const seeded = await DB.get("settings", "seeded");
    if (seeded) return;
    try {
      const res = await fetch("seed.json");
      if (res.ok) {
        const seed = await res.json();
        const now = new Date().toISOString();
        await DB.bulkPut("habits", (seed.habits || []).map((h, i) => ({
          id: newId(), name: h.name, emoji: h.emoji, target: h.target || 1,
          order: i, created_at: now, archived_at: null,
        })));
        await DB.bulkPut("prizes", (seed.prizes || []).map((p, i) => ({
          id: newId(), name: p.name, emoji: p.emoji, color: p.color,
          weight: p.weight, order: i, archived_at: null,
        })));
      }
    } catch (e) {
      console.warn("Seed import skipped:", e);
    }
    await DB.put("settings", { key: "seeded", at: new Date().toISOString() });
  }

  // ---- settings (single record under key "settings") ----
  async function getSettings() {
    const rec = await DB.get("settings", "settings");
    return rec ? rec.value : null;
  }
  const saveSettings = (value) => DB.put("settings", { key: "settings", value });

  // ---- backup / restore ----
  async function exportBackup() {
    const stores = {};
    for (const s of STORES) stores[s] = await DB.getAll(s);
    const payload = {
      app: "gold", format: FORMAT,
      exported_at: new Date().toISOString(),
      stores,
    };
    const name = `gold-backup-${payload.exported_at.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const file = new File([blob], name, { type: "application/json" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); }
      catch (e) { if (e.name !== "AbortError") download(blob, name); else return false; }
    } else {
      download(blob, name);
    }
    localStorage.setItem("gold_last_backup", String(Date.now()));
    return true;
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // Replace-all restore. Only stores the file actually carries are cleared, so
  // an older backup cannot silently wipe a store added after it was written.
  async function restoreBackup(json) {
    if (json.app !== "gold" || !json.stores) throw new Error("Not a Gold backup file");
    if ((json.format || 1) > FORMAT) throw new Error("Backup is from a newer version of Gold");
    for (const s of STORES) {
      if (!Array.isArray(json.stores[s])) continue;
      await DB.clear(s);
      await DB.bulkPut(s, json.stores[s]);
    }
  }

  return {
    init, newId, getSettings, saveSettings, exportBackup, restoreBackup,
    habits: {
      all: () => DB.getAll("habits"),
      put: (h) => DB.put("habits", h),
      del: (id) => DB.del("habits", id),
    },
    days: {
      all: () => DB.getAll("days"),
      get: (date) => DB.get("days", date),
      put: (d) => DB.put("days", d),
    },
    tickets: {
      all: () => DB.getAll("tickets"),
      put: (t) => DB.put("tickets", t),
      bulkPut: (ts) => DB.bulkPut("tickets", ts),
      bulkDel: (ids) => DB.bulkDel("tickets", ids),
    },
    prizes: {
      all: () => DB.getAll("prizes"),
      put: (p) => DB.put("prizes", p),
      del: (id) => DB.del("prizes", id),
    },
    wins: {
      all: () => DB.getAll("wins"),
      put: (w) => DB.put("wins", w),
      del: (id) => DB.del("wins", id),
    },
  };
})();
