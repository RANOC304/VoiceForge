import { describe, expect, it } from "vitest";
import { encodeWav, encodeMp3, safeFilename } from "./export";
import { makeDemo, waveformPeaks, validateAudio } from "./utils";

describe("portable audio files", () => {
  it("writes a standard mono PCM WAV header and clamps samples", () => {
    const out = encodeWav({
      samples: new Float32Array([-2, 0, 2]),
      sampleRate: 48000,
    });
    const bytes = new DataView(out);
    expect(new TextDecoder().decode(out.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(out.slice(8, 12))).toBe("WAVE");
    expect(bytes.getUint32(24, true)).toBe(48000);
    expect(bytes.getUint16(22, true)).toBe(1);
    expect(bytes.getUint16(34, true)).toBe(16);
    expect(bytes.getUint32(40, true)).toBe(6);
    expect(bytes.getInt16(44, true)).toBe(-32768);
    expect(bytes.getInt16(48, true)).toBe(32767);
  });
  it("encodes actual MPEG audio frames at the selected bitrate", () => {
    const audio = makeDemo(1);
    const out = new Uint8Array(encodeMp3(audio, 192));
    expect(out.length).toBeGreaterThan(20000);
    expect(out[0]).toBe(255);
    expect(out[1] & 0xe0).toBe(0xe0);
    // MPEG-1 Layer III bitrate index 11 = 192 kbps.
    expect(out[2] >> 4).toBe(11);
  });
  it("rejects unsupported encoding settings and non-finite audio", () => {
    expect(() => encodeMp3(makeDemo(0.1), 999)).toThrow();
    expect(() =>
      validateAudio({ samples: new Float32Array([NaN]), sampleRate: 48000 }),
    ).toThrow();
    expect(() =>
      validateAudio({ samples: new Float32Array(0), sampleRate: 48000 }),
    ).toThrow();
  });
  it("makes safe export names and useful waveform peaks", () => {
    expect(safeFilename("../my:<voice>?", "wav")).toBe("my_voice.wav");
    expect(safeFilename("CON", "mp3")).toBe("VoiceForge-CON.mp3");
    expect(waveformPeaks(new Float32Array([0, -0.8, 0.2, 0]), 2)).toEqual([
      expect.closeTo(0.8),
      expect.closeTo(0.2),
    ]);
    expect(waveformPeaks(new Float32Array(), 2)).toEqual([0, 0]);
  });
});
