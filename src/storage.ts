import type { SavedRecording } from "./studio-types";

// Transactions resolve on commit, not on individual request success.
// https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voiceforge-studio", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("recordings", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Local storage could not be opened. You can still export your audio.",
        ),
      );
    request.onblocked = () =>
      reject(new Error("Close other VoiceForge windows and try saving again."));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction("recordings", mode);
      const request = action(tx.objectStore("recordings"));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          new Error(
            "The recording could not be saved. Your disk may be full. Export it to keep a copy.",
          ),
        );
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function listRecordings(): Promise<SavedRecording[]> {
  const rows = (await transaction("readonly", (store) =>
    store.getAll(),
  )) as SavedRecording[];
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}
export async function putRecording(recording: SavedRecording): Promise<void> {
  await transaction("readwrite", (store) => store.put(recording));
}
export async function removeRecording(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}
