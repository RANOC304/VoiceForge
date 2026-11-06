import { Mp3Encoder } from "@breezystack/lamejs";
import type { AudioData } from "./types";
import { validateAudio } from "./utils";

export { safeFilename } from "./utils";

function pcm16(samples: Float32Array): Int16Array {
  return Int16Array.from(samples, (value) => {
    const clamped = Math.max(-1, Math.min(1, value));
    return Math.round(clamped * (clamped < 0 ? 32768 : 32767));
  });
}

export function encodeWav(audio: AudioData): ArrayBuffer {
  validateAudio(audio, 2010);
  const data = new ArrayBuffer(44 + audio.samples.length * 2);
  const view = new DataView(data);
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) =>
      view.setUint8(offset + i, char.charCodeAt(0)),
    );
  text(0, "RIFF");
  view.setUint32(4, data.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, audio.samples.length * 2, true);
  const samples = pcm16(audio.samples);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, samples[i], true);
  return data;
}

// Bundled, unmodified LGPL LAME encoder. API: node_modules/@breezystack/lamejs/README.md.
export function encodeMp3(audio: AudioData, bitrate = 192): ArrayBuffer {
  validateAudio(audio, 2010);
  if (![128, 192, 256, 320].includes(bitrate))
    throw new Error("Choose an MP3 bitrate of 128, 192, 256, or 320 kbps.");
  if (![32000, 44100, 48000].includes(audio.sampleRate))
    throw new Error(
      "MP3 export needs 32, 44.1, or 48 kHz audio. Import the recording again to resample it.",
    );
  const encoder = new Mp3Encoder(1, audio.sampleRate, bitrate);
  const pcm = pcm16(audio.samples);
  const blocks: Uint8Array[] = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const encoded = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (encoded.length) blocks.push(new Uint8Array(encoded));
  }
  blocks.push(new Uint8Array(encoder.flush()));
  const output = new Uint8Array(
    blocks.reduce((size, block) => size + block.length, 0),
  );
  let offset = 0;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.length;
  }
  return output.buffer;
}
