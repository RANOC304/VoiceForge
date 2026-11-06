import { describe, expect, it } from "vitest";
import { bufferToAudio, MAX_SECONDS } from "./utils";

describe("microphone stop boundary", () => {
  it("keeps the allowed take when an asynchronous microphone stop overshoots", () => {
    const data = new Float32Array(8000 * MAX_SECONDS + 80);
    data[0] = 0.4;
    const buffer = {
      length: data.length,
      numberOfChannels: 1,
      sampleRate: 8000,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
    const captured = bufferToAudio(buffer, MAX_SECONDS);
    expect(captured.samples.length).toBe(8000 * MAX_SECONDS);
    expect(captured.samples[0]).toBeCloseTo(0.4);
    expect(() => bufferToAudio(buffer)).toThrow("shorter than 10 minutes");
  });
});
