import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { DEFAULT_SETTINGS } from "./audio/types";
import {
  getRecording,
  listRecordingSummaries,
  putRecording,
  removeRecording,
  listStackPresets,
  putStackPreset,
} from "./storage";
import { makeStackPreset, applyStackPreset } from "./effect-settings";
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
  it("adds reusable stacks without losing a recording from the original library", async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("voiceforge-studio", 1);
      request.onupgradeneeded = () =>
        request.result
          .createObjectStore("recordings", { keyPath: "id" })
          .put(take());
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
    const settings = {
      ...DEFAULT_SETTINGS,
      trimStart: 2,
      tuningKey: 3,
      effectChain: [
        { id: "1", presetId: "demon", enabled: false, intensity: 0.4 },
        { id: "2", presetId: "cathedral", enabled: true, intensity: 0.7 },
      ],
    };
    await putStackPreset(makeStackPreset("Dark hook", settings, "preset-1"));
    expect(await getRecording("take-1")).toEqual(take());
    const [preset] = await listStackPresets();
    let nextId = 0;
    const applied = applyStackPreset(
      { ...DEFAULT_SETTINGS, trimStart: 5, trimEnd: 7 },
      preset,
      () => `new-${++nextId}`,
    );
    expect(applied).toMatchObject({
      trimStart: 5,
      trimEnd: 7,
      tuningKey: 3,
      effectChain: [
        { id: "new-1", presetId: "demon", enabled: false, intensity: 0.4 },
        { id: "new-2", presetId: "cathedral", enabled: true, intensity: 0.7 },
      ],
    });
  });
  it("opens a fresh library without requiring an existing database", async () => {
    expect(await listRecordingSummaries()).toEqual([]);
  });

  it("persists original PCM samples and effect settings across separate database connections", async () => {
    const recording = take();
    await putRecording(recording);
    const saved = (await getRecording(recording.id))!;
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
    const saved = (await getRecording(recording.id))!;
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
    const rows = await listRecordingSummaries();
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
    expect(rows[1].name).toBe("Renamed original");
    expect(rows[1].settings.presetId).toBe("original");
    expect(rows[1]).toMatchObject({ trackCount: 1 });
    expect(rows[1]).not.toHaveProperty("audio");
  });

  it("removes only the chosen take and permits removing an already missing take", async () => {
    await putRecording(take("first"));
    await putRecording(take("second"));
    await removeRecording("first");
    await removeRecording("first");
    expect((await listRecordingSummaries()).map((row) => row.id)).toEqual([
      "second",
    ]);
  });

  it("does not lose independent takes saved concurrently", async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => putRecording(take(`take-${i}`, i))),
    );
    expect((await listRecordingSummaries()).map((row) => row.id)).toEqual(
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
    expect(await listRecordingSummaries()).toEqual([]);
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
