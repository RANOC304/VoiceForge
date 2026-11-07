import type {
  RecordingSummary,
  SavedRecording,
  StackPreset,
} from "./studio-types";

// Transactions resolve on commit, not on individual request success.
// https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("voiceforge-studio", 2);
    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0)
        request.result.createObjectStore("recordings", { keyPath: "id" });
      request.result.createObjectStore("stack-presets", { keyPath: "id" });
    };
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
  store = "recordings",
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    try {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => {
        db.close();
        resolve(request.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          new Error(
            store === "recordings"
              ? "The recording could not be saved. Your disk may be full. Export it to keep a copy."
              : "The preset could not be updated. Check local storage and try again.",
          ),
        );
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  });
}

export async function listRecordingSummaries(): Promise<RecordingSummary[]> {
  const rows: RecordingSummary[] = [];
  // Read one project at a time so the library never holds all the PCM in memory.
  await transaction("readonly", (store) => {
    const request = store.openCursor();
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor) return;
      const { id, name, createdAt, duration, settings, tracks } =
        cursor.value as SavedRecording;
      rows.push({
        id,
        name,
        createdAt,
        duration,
        settings,
        trackCount: tracks?.length || 1,
      });
      cursor.continue();
    });
    return request;
  });
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}
export async function getRecording(
  id: string,
): Promise<SavedRecording | undefined> {
  return transaction("readonly", (store) => store.get(id));
}
export async function putRecording(recording: SavedRecording): Promise<void> {
  await transaction("readwrite", (store) => store.put(recording));
}
export async function removeRecording(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}

export async function listStackPresets(): Promise<StackPreset[]> {
  const rows = await transaction<StackPreset[]>(
    "readonly",
    (store) => store.getAll(),
    "stack-presets",
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function putStackPreset(preset: StackPreset): Promise<void> {
  await transaction("readwrite", (store) => store.put(preset), "stack-presets");
}

export async function removeStackPreset(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id), "stack-presets");
}
