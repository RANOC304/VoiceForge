import { describe, expect, it } from "vitest";
import { getEffectChain, MAX_EFFECTS } from "./chain";
import { renderAudio } from "./engine";
import { PRESETS } from "./presets";
import {
  DEFAULT_SETTINGS,
  type EffectInstance,
  type StudioSettings,
} from "./types";
import { encodeWav } from "./export";

const sampleRate = 8000;
const source = () => ({
  samples: Float32Array.from(
    { length: 1600 },
    (_, i) => 0.25 * Math.sin((2 * Math.PI * 217 * i) / sampleRate),
  ),
  sampleRate,
});
const slot = (
  presetId: string,
  id = presetId,
  enabled = true,
  intensity = 1,
): EffectInstance => ({ id, presetId, enabled, intensity });
const settings = (
  effectChain: EffectInstance[],
  extra: Partial<StudioSettings> = {},
): StudioSettings => ({
  ...DEFAULT_SETTINGS,
  normalize: false,
  effectChain,
  ...extra,
});
const difference = (a: Float32Array, b: Float32Array) =>
  a.reduce((sum, value, i) => sum + Math.abs(value - (b[i] ?? 0)), 0);

describe("saved effect chains", () => {
  it("migrates a legacy preset and leaves original as an empty chain", () => {
    expect(getEffectChain(DEFAULT_SETTINGS)).toEqual([]);
    expect(
      getEffectChain({
        ...DEFAULT_SETTINGS,
        presetId: "demon",
        intensity: 0.6,
      }),
    ).toEqual([
      { id: "legacy-demon", presetId: "demon", intensity: 0.6, enabled: true },
    ]);
  });
  it("treats an explicit empty chain as a bypass instead of restoring the legacy preset", () => {
    const input = source();
    const options = settings([], { presetId: "demon" });
    expect(getEffectChain(options)).toEqual([]);
    expect(renderAudio(input, options).samples).toEqual(input.samples);
  });
  it("returns independent slot objects so edits cannot change saved settings", () => {
    const options = settings([slot("telephone")]);
    const chain = getEffectChain(options);
    chain[0].enabled = false;
    expect(options.effectChain![0].enabled).toBe(true);
  });
  it("bounds slot counts and rejects invalid persisted rows", () => {
    expect(MAX_EFFECTS).toBe(8);
    expect(() =>
      getEffectChain(
        settings(
          Array.from({ length: 9 }, (_, i) => slot("telephone", String(i))),
        ),
      ),
    ).toThrow(/8/);
    expect(() => getEffectChain(settings([slot("missing")]))).toThrow(
      /unavailable/,
    );
    expect(() =>
      getEffectChain(settings([slot("telephone", "one", true, NaN)])),
    ).toThrow(/intensity/i);
    expect(() =>
      getEffectChain(
        settings([slot("telephone", "same"), slot("chorus", "same")]),
      ),
    ).toThrow(/unique/i);
    expect(() =>
      getEffectChain(
        settings([slot("telephone", "one", "false" as unknown as boolean)]),
      ),
    ).toThrow();
  });
});

describe("ordered audio processing", () => {
  it("applies both stages in order instead of selecting or merging one recipe", () => {
    const input = source();
    const forward = renderAudio(
      input,
      settings([slot("telephone"), slot("distortion")]),
    );
    const reverse = renderAudio(
      input,
      settings([slot("distortion"), slot("telephone")]),
    );
    const telephone = renderAudio(input, settings([slot("telephone")]));
    const distortion = renderAudio(input, settings([slot("distortion")]));
    expect(difference(forward.samples, reverse.samples)).toBeGreaterThan(5);
    expect(difference(forward.samples, telephone.samples)).toBeGreaterThan(5);
    expect(difference(forward.samples, distortion.samples)).toBeGreaterThan(5);
    expect(input).toEqual(source());
  });
  it("bypasses disabled stages and supports repeated presets with unique slot ids", () => {
    const input = source();
    const single = renderAudio(input, settings([slot("telephone")]));
    const disabled = renderAudio(
      input,
      settings([slot("telephone"), slot("demon", "second", false)]),
    );
    expect(disabled.samples).toEqual(single.samples);
    const twice = renderAudio(
      input,
      settings([slot("telephone"), slot("telephone", "second")]),
    );
    expect(difference(twice.samples, single.samples)).toBeGreaterThan(1);
  });
  it("trims once in source time before sequential speed changes", () => {
    const input = {
      samples: new Float32Array(sampleRate).fill(0.1),
      sampleRate,
    };
    const output = renderAudio(
      input,
      settings([slot("slow-motion"), slot("fast-forward")], {
        trimStart: 0.2,
        trimEnd: 0.6,
      }),
    );
    expect(output.samples.length).toBe(
      Math.round(Math.round(3200 / 0.7) / 1.4),
    );
  });
  it("applies shared echo/reverb and output gain only once after the chain", () => {
    const input = source();
    const baseline = renderAudio(
      input,
      settings([], { echo: 0.2, reverb: 0.1, gain: 0.5 }),
    );
    const bypassSlots = renderAudio(
      input,
      settings([slot("telephone", "a", false), slot("demon", "b", false)], {
        echo: 0.2,
        reverb: 0.1,
        gain: 0.5,
      }),
    );
    expect(bypassSlots.samples).toEqual(baseline.samples);
    expect(bypassSlots.samples.length).toBe(
      input.samples.length +
        Math.round(0.28 * sampleRate) * 7 +
        Math.ceil(1.6 * sampleRate),
    );
  });
  it("does not multiply shared controls when several enabled stages are present", () => {
    const input = source();
    const options = settings([slot("telephone"), slot("chorus")], {
      echo: 0.2,
      reverb: 0.1,
      gain: 0.4,
    });
    const output = renderAudio(input, options);
    expect(output.samples.length).toBe(
      input.samples.length +
        Math.round(0.28 * sampleRate) * 7 +
        Math.ceil(1.6 * sampleRate),
    );
    const dry = renderAudio(
      input,
      settings([slot("telephone"), slot("chorus")]),
    );
    const gained = renderAudio(
      input,
      settings([slot("telephone"), slot("chorus")], { gain: 0.4 }),
    );
    for (let i = 0; i < dry.samples.length; i += 137)
      expect(gained.samples[i]).toBeCloseTo(dry.samples[i] * 0.4, 5);
  });
  it("normalizes once after the entire chain and exports the compound PCM", () => {
    const output = renderAudio(
      source(),
      settings([slot("telephone"), slot("distortion")], { normalize: true }),
    );
    const peak = output.samples.reduce(
      (max, value) => Math.max(max, Math.abs(value)),
      0,
    );
    expect(peak).toBeCloseTo(0.95, 4);
    const wav = new DataView(encodeWav(output));
    expect(wav.getUint32(40, true)).toBe(output.samples.length * 2);
  });
  it("rejects an oversized intermediate stage even if later effects would shorten it", () => {
    const input = { samples: new Float32Array(40000), sampleRate };
    const chain = Array.from({ length: 7 }, (_, i) =>
      slot("slow-motion", String(i), true, 2),
    );
    chain.push(slot("fast-forward", "last", true, 2));
    expect(() => renderAudio(input, settings(chain))).toThrow(
      /shorten|remove/i,
    );
  });
  it("keeps source-time trim validation separate from expanding effect output", () => {
    const input = source();
    const output = renderAudio(
      input,
      settings([slot("slow-motion", "one"), slot("slow-motion", "two")], {
        trimStart: 0.05,
        trimEnd: 0.15,
      }),
    );
    expect(output.samples.length).toBe(Math.round(Math.round(800 / 0.7) / 0.7));
    expect(() =>
      renderAudio(input, settings([], { trimStart: 0.18, trimEnd: 0.1 })),
    ).toThrow(/trim/i);
  });
  it("keeps a loud eight-stage stack finite and within PCM bounds", () => {
    const input = { samples: new Float32Array(800).fill(1e38), sampleRate };
    const chain = Array.from({ length: 8 }, (_, i) =>
      slot("broadcast", String(i), true, 2),
    );
    const output = renderAudio(
      input,
      settings(chain, { normalize: true, gain: 4 }),
    );
    expect(
      output.samples.every(
        (value) => Number.isFinite(value) && Math.abs(value) <= 1,
      ),
    ).toBe(true);
  });
});

describe("rap vocal catalogue", () => {
  it("includes exactly thirty distinct, labelled rap recipes", () => {
    const rap = PRESETS.filter((preset) => preset.category === "Rap");
    expect(rap).toHaveLength(30);
    expect(new Set(rap.map((preset) => preset.id)).size).toBe(30);
    expect(
      new Set(rap.map((preset) => JSON.stringify(preset.recipe))).size,
    ).toBe(30);
    for (const genre of ["drill", "trap", "pop", "boom bap"])
      expect(
        rap.some((preset) => preset.tags.includes(genre)),
        genre,
      ).toBe(true);
    for (const preset of rap)
      expect(preset.description.length).toBeGreaterThan(15);
  });
  it("actually changes a voice signal for every rap preset", () => {
    const input = source();
    for (const preset of PRESETS.filter(
      (preset) => preset.category === "Rap",
    )) {
      const output = renderAudio(input, settings([slot(preset.id)]));
      expect(
        difference(output.samples, input.samples),
        preset.id,
      ).toBeGreaterThan(1);
      expect(
        output.samples.every(
          (value) => Number.isFinite(value) && Math.abs(value) <= 1,
        ),
        preset.id,
      ).toBe(true);
    }
  });
});
