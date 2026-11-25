// 本机存储。设置放 localStorage，封面和导入的字体放 IndexedDB。
// 所有访问都可能失败（无痕模式、被禁用、空间不足），失败时一律静默返回 null / false。

const SETTINGS_KEY = 'lyric-card:v1';
const DB_NAME = 'lyric-card';
const DB_VERSION = 1;
const STORE = 'files';
const OPEN_TIMEOUT = 4000;

/* ---------- localStorage：设置 ---------- */

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveSettings(value) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearSettings() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    return true;
  } catch {
    return false;
  }
}

/* ---------- IndexedDB：文件 ---------- */

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (db) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    try {
      const idb = typeof indexedDB === 'undefined' ? null : indexedDB;
      if (!idb) { finish(null); return; }
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        } catch { /* 升级失败时 onerror 会接手 */ }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          try { db.close(); } catch { /* 忽略 */ }
          dbPromise = null;
        };
        finish(db);
      };
      req.onerror = () => finish(null);
      req.onblocked = () => finish(null);
      setTimeout(() => finish(null), OPEN_TIMEOUT);
    } catch {
      finish(null);
    }
  });
  return dbPromise;
}

// 读：成功返回取到的值（没有则 null），失败返回 null。
// 写 / 删：成功返回 true，失败返回 false。
function run(mode, fn) {
  const readonly = mode === 'readonly';
  const fail = readonly ? null : false;
  return openDb().then((db) => {
    if (!db) return fail;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        let value = null;
        const req = fn(tx.objectStore(STORE));
        if (req) {
          req.onsuccess = () => { value = req.result === undefined ? null : req.result; };
        }
        tx.oncomplete = () => resolve(readonly ? value : true);
        tx.onerror = () => resolve(fail);
        tx.onabort = () => resolve(fail);
      } catch {
        resolve(fail);
      }
    });
  }).catch(() => fail);
}

export function saveFile(key, value) { return run('readwrite', (st) => st.put(value, key)); }
export function loadFile(key) { return run('readonly', (st) => st.get(key)); }
export function deleteFile(key) { return run('readwrite', (st) => st.delete(key)); }
export function clearFiles() { return run('readwrite', (st) => st.clear()); }

/* ---------- 封面和字体 ---------- */

export function saveCover(blob) {
  return blob instanceof Blob ? saveFile('cover', blob) : Promise.resolve(false);
}

export async function loadCover() {
  const value = await loadFile('cover');
  return value instanceof Blob ? value : null;
}

export function clearCover() { return deleteFile('cover'); }

// font = { name: string, buffer: ArrayBuffer }
export function saveFont(font) {
  if (!font || !(font.buffer instanceof ArrayBuffer)) return Promise.resolve(false);
  return saveFile('font', { name: String(font.name || ''), buffer: font.buffer });
}

export async function loadFont() {
  const value = await loadFile('font');
  if (value && value.buffer instanceof ArrayBuffer) {
    return { name: typeof value.name === 'string' ? value.name : '', buffer: value.buffer };
  }
  return null;
}

export function clearFont() { return deleteFile('font'); }

// 重新开始：设置、封面、字体全部清掉。
export async function clearAll() {
  clearSettings();
  return clearFiles();
}
