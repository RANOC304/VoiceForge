import { describe, expect, it } from "vitest";
import { renderAudio } from "./engine";
import { detectPitch, nearestScaleFrequency, pitchShift } from "./pitch";
import { PRESETS, CATEGORIES } from "./presets";
import { DEFAULT_SETTINGS } from "./types";

const rate = 24000;
function tone(frequency: number, seconds = 0.6) {
  return Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => 0.3 * Math.sin((2 * Math.PI * frequency * i) / rate),
  );
}
function energy(samples: Float32Array) {
  return samples.reduce((sum, x) => sum + x * x, 0);
}
function dominantFrequency(samples: Float32Array, min: number, max: number) {
  const start = Math.min(4096, Math.floor(samples.length / 4));
  const n = Math.min(8192, samples.length - start);
  let best = 0,
    result = 0;
  for (let f = min; f <= max; f += 1) {
    let real = 0,
      imaginary = 0;
    for (let i = 0; i < n; i++) {
      const s =
        samples[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
      real += s * Math.cos((2 * Math.PI * f * i) / rate);
      imaginary += s * Math.sin((2 * Math.PI * f * i) / rate);
    }
    const magnitude = real * real + imaginary * imaginary;
    if (magnitude > best) {
      best = magnitude;
      result = f;
    }
  }
  return result;
}

describe("recording rendering", () => {
  it("keeps the original samples and does not mutate the source", () => {
    const input = tone(220);
    const before = input.slice();
    const output = renderAudio(
      { samples: input, sampleRate: rate },
      { ...DEFAULT_SETTINGS, normalize: false },
    );
    expect(output.samples).toEqual(before);
    expect(input).toEqual(before);
    expect(output.samples).not.toBe(input);
  });
  it("trims by seconds with an exclusive end", () => {
    const output = renderAudio(
      { samples: tone(220, 1), sampleRate: rate },
      { ...DEFAULT_SETTINGS, normalize: false, trimStart: 0.2, trimEnd: 0.7 },
    );
    expect(output.samples.length).toBe(12000);
  });
  it("rejects empty, inverted or non-finite audio boundaries", () => {
    expect(() =>
      renderAudio(
        { samples: new Float32Array(), sampleRate: rate },
        DEFAULT_SETTINGS,
      ),
    ).toThrow();
    expect(() =>
      renderAudio({ samples: tone(220), sampleRate: 0 }, DEFAULT_SETTINGS),
    ).toThrow();
    expect(() =>
      renderAudio(
        { samples: tone(220), sampleRate: rate },
        { ...DEFAULT_SETTINGS, trimStart: 0.5, trimEnd: 0.1 },
      ),
    ).toThrow();
    expect(() =>
      renderAudio(
        { samples: new Float32Array([NaN]), sampleRate: rate },
        DEFAULT_SETTINGS,
      ),
    ).toThrow();
  });
  it("normalizes quiet audio without clipping and leaves silence silent", () => {
    const output = renderAudio(
      { samples: tone(220), sampleRate: rate },
      DEFAULT_SETTINGS,
    );
    expect(Math.max(...output.samples)).toBeCloseTo(0.95, 2);
    const silent = renderAudio(
      { samples: new Float32Array(1000), sampleRate: rate },
      DEFAULT_SETTINGS,
    );
    expect(energy(silent.samples)).toBe(0);
  });
  it("appends an audible reverb tail and contains all output peaks", () => {
    const input = new Float32Array(2400);
    input[100] = 0.8;
    const output = renderAudio(
      { samples: input, sampleRate: rate },
      { ...DEFAULT_SETTINGS, presetId: "cathedral" },
    );
    expect(output.samples.length).toBeGreaterThan(input.length);
    expect(energy(output.samples.slice(2400))).toBeGreaterThan(0.001);
    expect(
      output.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 1),
    ).toBe(true);
  });
  it("creates delayed echoes in the exported samples", () => {
    const input = new Float32Array(2400);
    input[50] = 0.7;
    const output = renderAudio(
      { samples: input, sampleRate: rate },
      { ...DEFAULT_SETTINGS, echo: 0.6, normalize: false },
    );
    expect(output.samples.length).toBeGreaterThan(input.length);
    expect(energy(output.samples.slice(2400))).toBeGreaterThan(0.001);
  });
  it("disables all preset processing when its intensity is zero", () => {
    const input = tone(220, 0.1);
    for (const preset of PRESETS) {
      const output = renderAudio(
        { samples: input, sampleRate: rate },
        {
          ...DEFAULT_SETTINGS,
          presetId: preset.id,
          intensity: 0,
          normalize: false,
        },
      );
      expect(output.samples, preset.id).toEqual(input);
    }
  });
  it("soft limits boosted peaks without a hard clipped plateau", () => {
    const input = new Float32Array([0.4, 0.5, 0.6, 0.7]);
    const output = renderAudio(
      { samples: input, sampleRate: rate },
      { ...DEFAULT_SETTINGS, normalize: false, gain: 2 },
    );
    expect(output.samples[1]).toBeLessThan(1);
    expect(output.samples[1]).toBeGreaterThan(0.95);
    expect(output.samples[2]).toBeGreaterThan(output.samples[1]);
    expect(output.samples.every((x) => Math.abs(x) <= 1)).toBe(true);
  });
  it("tapers the trimmed voice before adding an echo tail", () => {
    const input = new Float32Array(rate).fill(0.3);
    const output = renderAudio(
      { samples: input, sampleRate: rate },
      {
        ...DEFAULT_SETTINGS,
        trimEnd: 0.1,
        echo: 0.5,
        normalize: false,
      },
    );
    const boundary = Math.round(0.1 * rate);
    expect(
      Math.abs(output.samples[boundary - 1] - output.samples[boundary]),
    ).toBeLessThan(0.01);
    expect(
      energy(output.samples.slice(Math.round(0.28 * rate))),
    ).toBeGreaterThan(0.01);
  });
});

describe("musical pitch processing", () => {
  it("detects voiced fundamental frequency and rejects silence", () => {
    expect(detectPitch(tone(220, 0.12), rate)).toBeCloseTo(220, 0);
    expect(detectPitch(new Float32Array(4096), rate)).toBe(0);
  });
  it("transposes an octave while preserving duration", () => {
    const input = tone(220, 0.8);
    const shifted = pitchShift(input, rate, () => 2);
    expect(shifted.length).toBe(input.length);
    expect(dominantFrequency(shifted, 420, 460)).toBeCloseTo(440, 0);
    expect(energy(shifted)).toBeGreaterThan(100);
  });
  it("corrects an off-key sustained note to its closest chromatic note", () => {
    const output = renderAudio(
      { samples: tone(430, 0.8), sampleRate: rate },
      { ...DEFAULT_SETTINGS, presetId: "autotune", normalize: false },
    );
    expect(dominantFrequency(output.samples, 420, 450)).toBeCloseTo(440, 0);
  });
  it("respects the chosen musical key and scale", () => {
    expect(nearestScaleFrequency(277.18, 0, "major")).toBeCloseTo(261.63, 1);
    expect(nearestScaleFrequency(277.18, 1, "major")).toBeCloseTo(277.18, 1);
    expect(nearestScaleFrequency(311.13, 0, "minor")).toBeCloseTo(311.13, 1);
  });
});

describe("effect catalogue", () => {
  it("offers at least 45 unique effects covering all categories", () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(45);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PRESETS.map((p) => p.category))).toEqual(
      new Set(CATEGORIES),
    );
    expect(PRESETS.find((p) => p.id === "demon")).toBeDefined();
  });
  it.each(["demon", "chipmunk", "telephone", "robot"])(
    "%s changes the recording",
    (presetId) => {
      const input = tone(220, 0.25);
      const output = renderAudio(
        { samples: input, sampleRate: rate },
        { ...DEFAULT_SETTINGS, presetId, normalize: false },
      );
      let difference = 0;
      for (let i = 0; i < Math.min(input.length, output.samples.length); i++)
        difference += Math.abs(input[i] - output.samples[i]);
      expect(difference).toBeGreaterThan(5);
    },
  );
  it("renders every preset safely and keeps silent input silent", () => {
    for (const preset of PRESETS) {
      const output = renderAudio(
        { samples: tone(217, 0.08), sampleRate: rate },
        { ...DEFAULT_SETTINGS, presetId: preset.id },
      );
      expect(
        output.samples.every((x) => Number.isFinite(x) && Math.abs(x) <= 1),
        preset.id,
      ).toBe(true);
      const silent = renderAudio(
        { samples: new Float32Array(1200), sampleRate: rate },
        { ...DEFAULT_SETTINGS, presetId: preset.id },
      );
      expect(energy(silent.samples), preset.id).toBe(0);
    }
  });
});
