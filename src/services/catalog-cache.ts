export type CatalogKey = [serverUrl: string, username: string, action: string];
export interface SavedCatalogList {
  at: number;
  text: string;
}

const STORE = 'lists';
let database: Promise<IDBDatabase | null> | undefined;

function openCatalogCache(): Promise<IDBDatabase | null> {
  return database ??= new Promise(resolve => {
    try {
      const request = indexedDB.open('fiptv-catalog', 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
      request.onerror = request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function readCatalogList(key: CatalogKey): Promise<SavedCatalogList | null> {
  const db = await openCatalogCache();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = request.result;
        resolve(value && Number.isFinite(value.at) && typeof value.text === 'string' ? value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function updateCatalogCache(update: (store: IDBObjectStore) => void): Promise<void> {
  const db = await openCatalogCache();
  if (!db) return;
  try {
    update(db.transaction(STORE, 'readwrite').objectStore(STORE));
  } catch {
    // Storage may be unavailable or at its quota on a TV.
  }
}

export function writeCatalogList(key: CatalogKey, value: SavedCatalogList): Promise<void> {
  return updateCatalogCache(store => { store.put(value, key); });
}

export function removeCatalogLists(serverUrl: string, username: string): Promise<void> {
  return updateCatalogCache(store => {
    store.delete(IDBKeyRange.bound([serverUrl, username, ''], [serverUrl, username, '\uffff']));
  });
}
