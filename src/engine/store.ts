// Where a page keeps its database between visits: IndexedDB, one record per key, holding the bytes of
// a SQLite file. IndexedDB because it is in every browser, on the page's own thread, and takes
// megabytes without asking. The data belongs to this browser and this page's address (its origin);
// *Save data…* is how it leaves.

export interface ByteStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}

const DB = "eeditor";
const STORE = "databases";

/**
 * Opened once and kept open. A write when the page is leaving has to start its transaction at once —
 * opening the database first would put an extra wait in front of it, and a page on its way out
 * doesn't wait.
 */
let opened: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opened ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading or deleting the database: let go, and open again next time.
      db.onversionchange = () => {
        db.close();
        opened = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opened = null;
      reject(req.error);
    };
  });
  return opened;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
        // Nothing else is coming: commit now rather than when the browser gets round to it.
        tx.commit?.();
      }),
  );
}

export const indexedDbStore: ByteStore = {
  async get(key) {
    const v = await run<unknown>("readonly", (s) => s.get(key));
    return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
  },
  async put(key, bytes) {
    await run("readwrite", (s) => s.put(bytes, key));
  },
  async remove(key) {
    await run("readwrite", (s) => s.delete(key));
  },
};
