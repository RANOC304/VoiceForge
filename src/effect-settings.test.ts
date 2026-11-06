import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./audio/types";
import {
  appendEffect,
  changeEffect,
  deleteEffect,
  reorderEffect,
  resetEffectSettings,
} from "./effect-settings";

describe("editing a voice effect rack", () => {
  it("clears the effects while preserving the chosen source trim", () => {
    const edited = {
      ...appendEffect(DEFAULT_SETTINGS, "demon", "a").settings,
      trimStart: 1.25,
      trimEnd: 3.75,
      pitch: -4,
      reverb: 0.5,
    };
    expect(resetEffectSettings(edited)).toMatchObject({
      effectChain: [],
      presetId: "original",
      trimStart: 1.25,
      trimEnd: 3.75,
      pitch: 0,
      reverb: 0,
    });
    expect(edited.effectChain).toHaveLength(1);
  });
  it("keeps a legacy saved effect when another is added", () => {
    const result = appendEffect(
      { ...DEFAULT_SETTINGS, presetId: "demon", intensity: 0.4 },
      "cathedral",
      "new",
    );
    expect(
      result.settings.effectChain?.map((effect) => effect.presetId),
    ).toEqual(["demon", "cathedral"]);
    expect(result.settings.effectChain?.[0].intensity).toBe(0.4);
    expect(result.selectedId).toBe("new");
  });
  it("reselects an existing effect without duplicating it or changing its strength", () => {
    const first = appendEffect(DEFAULT_SETTINGS, "demon", "one");
    const adjusted = changeEffect(first.settings, "one", { intensity: 0.3 });
    const again = appendEffect(adjusted, "demon", "two");
    expect(again.selectedId).toBe("one");
    expect(again.settings.effectChain).toHaveLength(1);
    expect(again.settings.effectChain?.[0].intensity).toBe(0.3);
  });
  it("edits, bypasses, reorders and removes individual slots without changing the source settings", () => {
    const a = appendEffect(DEFAULT_SETTINGS, "demon", "a").settings;
    const b = appendEffect(a, "cathedral", "b").settings;
    const changed = changeEffect(b, "b", { enabled: false, intensity: 0.2 });
    const moved = reorderEffect(changed, "b", -1);
    expect(moved.effectChain?.map((effect) => effect.id)).toEqual(["b", "a"]);
    expect(moved.effectChain?.[0]).toMatchObject({
      enabled: false,
      intensity: 0.2,
    });
    expect(b.effectChain?.[1]).toMatchObject({ enabled: true, intensity: 1 });
    expect(
      deleteEffect(moved, "a").effectChain?.map((effect) => effect.id),
    ).toEqual(["b"]);
    expect(deleteEffect(deleteEffect(moved, "a"), "b").effectChain).toEqual([]);
  });
});
