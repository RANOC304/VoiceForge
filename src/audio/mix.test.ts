import { expect, it } from "vitest";
import { mixTracks } from "./mix";
import { DEFAULT_SETTINGS } from "./types";

it("layers rendered tracks at their offsets, respects mute and volume, and keeps the source intact", () => {
  const samples = new Float32Array(800).fill(0.4);
  const settings = { ...DEFAULT_SETTINGS, normalize: false };
  const track = {
    audio: { sampleRate: 8000, samples },
    settings,
    offset: 0,
    volume: 1,
    muted: false,
  };
  const mix = mixTracks([
    track,
    { ...track, offset: 0.05, volume: 0.5 },
    { ...track, offset: 1, muted: true },
  ]);
  expect(mix.sampleRate).toBe(48000);
  expect(mix.samples.length).toBe(7200);
  expect(mix.samples[1200]).toBeCloseTo(0.4);
  expect(mix.samples[3600]).toBeCloseTo(0.6);
  expect(mix.samples[6000]).toBeCloseTo(0.2);
  expect(samples[400]).toBeCloseTo(0.4);
});

it("keeps relative levels when overlapping tracks exceed full scale", () => {
  const track = {
    audio: { sampleRate: 48000, samples: new Float32Array(4800).fill(0.8) },
    settings: { ...DEFAULT_SETTINGS, normalize: false },
    offset: 0,
    volume: 1,
    muted: false,
  };
  const mix = mixTracks([track, { ...track, offset: 0.05 }]);
  expect(mix.samples[1200]).toBeCloseTo(0.49);
  expect(mix.samples[3600]).toBeCloseTo(0.98);
});

it("mixes audio from tracks beyond the former eight-track cap", () => {
  const track = {
    audio: { sampleRate: 48000, samples: new Float32Array(480).fill(0.05) },
    settings: { ...DEFAULT_SETTINGS, normalize: false },
    offset: 0,
    volume: 1,
    muted: false,
  };
  const mix = mixTracks(Array.from({ length: 12 }, () => track));
  expect(mix.samples[240]).toBeCloseTo(0.6);
});
