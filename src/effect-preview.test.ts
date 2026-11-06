import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./audio/types";
import { makeEffectPreviewSettings } from "./effect-preview";

describe("temporary effect auditions", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    trimStart: 1,
    trimEnd: 3,
    pitch: -2,
    effectChain: [
      { id: "saved", presetId: "demon", intensity: 0.4, enabled: true },
    ],
  };
  it("previews a candidate without adding it to the saved stack", () => {
    const preview = makeEffectPreviewSettings(settings, "cathedral");
    expect(preview.effectChain?.map((effect) => effect.presetId)).toEqual([
      "cathedral",
    ]);
    expect(settings.effectChain).toEqual([
      { id: "saved", presetId: "demon", intensity: 0.4, enabled: true },
    ]);
    expect(preview).toMatchObject({ trimStart: 1, trimEnd: 3, pitch: -2 });
  });
  it("lets Original be auditioned without clearing the saved stack", () => {
    expect(makeEffectPreviewSettings(settings, "original").effectChain).toEqual(
      [],
    );
    expect(settings.effectChain).toHaveLength(1);
  });
  it("keeps an existing effect strength and rejects missing presets", () => {
    expect(
      makeEffectPreviewSettings(settings, "demon").effectChain?.[0].intensity,
    ).toBe(0.4);
    expect(() => makeEffectPreviewSettings(settings, "missing")).toThrow();
  });
});
