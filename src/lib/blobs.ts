/**
 * Seitenspeicher für Belegbilder. In der Claude-Vorschau landen die Bilder im privaten Dateispeicher des
 * Artifacts (Fähigkeit „assets“) und sind so auf jedem Gerät da; sonst in IndexedDB dieses Browsers.
 * Die Kennung verrät den Ort: „a:…“ Dateispeicher, „l:…“ lokal.
 */

type Assets = { upload(blob: Blob): Promise<{ id: string; url: string }>; delete(id: string): Promise<void> };

let assetsPromise: Promise<Assets | null> | null = null;
function assets(): Promise<Assets | null> {
  if (!assetsPromise) {
    const claude = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
    assetsPromise = claude?.use ? (claude.use("assets") as Promise<Assets | null>).catch(() => null) : Promise.resolve(null);
  }
  return assetsPromise;
}

const DB_NAME = "immofriend-blobs";
const STORE = "blobs";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putBlob(blob: Blob): Promise<string> {
  const a = await assets();
  if (a) {
    try {
      const { id } = await a.upload(blob);
      return `a:${id}`;
    } catch {
      // Dateispeicher nicht nutzbar – lokal ablegen
    }
  }
  const id = crypto.randomUUID();
  await idbRun("readwrite", (s) => s.put(blob, id));
  return `l:${id}`;
}

const cache = new Map<string, Promise<Blob | null>>();

export function getBlob(blobId: string): Promise<Blob | null> {
  if (!cache.has(blobId)) {
    const [kind, id] = [blobId.slice(0, 1), blobId.slice(2)];
    const load =
      kind === "a"
        ? fetch(`/_blob/${id}`).then((r) => (r.ok ? r.blob() : null))
        : idbRun<Blob | undefined>("readonly", (s) => s.get(id) as IDBRequest<Blob | undefined>).then((b) => b ?? null);
    cache.set(blobId, load.catch(() => null));
  }
  return cache.get(blobId)!;
}

export async function deleteBlob(blobId: string) {
  cache.delete(blobId);
  const [kind, id] = [blobId.slice(0, 1), blobId.slice(2)];
  try {
    if (kind === "a") await (await assets())?.delete(id);
    else await idbRun("readwrite", (s) => s.delete(id));
  } catch {
    // bereits weg
  }
}
