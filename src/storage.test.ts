import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "./audio/types";
import { listRecordings, putRecording, removeRecording } from "./storage";
import type { SavedRecording } from "./studio-types";

function take(id = "take-1", createdAt = 1000): SavedRecording {
  return {
    id,
    createdAt,
    name: "Demon take",
    duration: 3 / 48000,
    audio: { sampleRate: 48000, samples: new Float32Array([0.25, -0.5, 0]) },
    settings: {
      ...DEFAULT_SETTINGS,
      presetId: "demon",
      pitch: -3,
      trimEnd: 0.5,
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local recording library", () => {
  it("opens a fresh library without requiring an existing database", async () => {
    expect(await listRecordings()).toEqual([]);
  });

  it("persists original PCM samples and effect settings across separate database connections", async () => {
    const recording = take();
    await putRecording(recording);
    const [saved] = await listRecordings();
    expect(saved).toEqual(recording);
    expect(saved.audio.samples).toBeInstanceOf(Float32Array);
    expect(saved.audio.samples).not.toBe(recording.audio.samples);
  });

  it("keeps the persisted original independent from subsequent in-memory edits", async () => {
    const recording = take();
    await putRecording(recording);
    recording.audio.samples[0] = -1;
    recording.settings.presetId = "original";
    recording.name = "Changed in editor";
    const [saved] = await listRecordings();
    expect(saved.name).toBe("Demon take");
    expect(saved.audio.samples[0]).toBe(0.25);
    expect(saved.settings.presetId).toBe("demon");
  });

  it("orders newest takes first and updates an existing take without creating a duplicate", async () => {
    await putRecording(take("old", 100));
    await putRecording(take("new", 200));
    await putRecording({
      ...take("old", 100),
      name: "Renamed original",
      settings: { ...DEFAULT_SETTINGS },
    });
    const rows = await listRecordings();
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
    expect(rows[1].name).toBe("Renamed original");
    expect(rows[1].settings.presetId).toBe("original");
  });

  it("removes only the chosen take and permits removing an already missing take", async () => {
    await putRecording(take("first"));
    await putRecording(take("second"));
    await removeRecording("first");
    await removeRecording("first");
    expect((await listRecordings()).map((row) => row.id)).toEqual(["second"]);
  });

  it("does not lose independent takes saved concurrently", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => putRecording(take(`take-${i}`, i))),
    );
    expect((await listRecordings()).map((row) => row.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `take-${7 - i}`),
    );
  });

  it("rejects a transaction aborted after its write request succeeds", async () => {
    const put = FakeObjectStore.prototype.put;
    vi.spyOn(FakeObjectStore.prototype, "put").mockImplementationOnce(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = put.call(this, value, key);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    await expect(putRecording(take())).rejects.toThrow(/could not be saved/i);
    expect(await listRecordings()).toEqual([]);
  });

  it("closes the database when an invalid value cannot be cloned", async () => {
    const invalid = {
      ...take(),
      audio: { sampleRate: 48000, samples: () => "not cloneable" },
    } as unknown as SavedRecording;
    await expect(putRecording(invalid)).rejects.toThrow();
    // A leaked database handle blocks app-data clearing or a later schema upgrade.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("voiceforge-studio");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("A failed save left the database open."));
    });
  });
});
