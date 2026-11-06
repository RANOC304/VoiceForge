import type { AudioData } from "./types";

export const MAX_SECONDS = 600;
export function validateAudio(
  audio: AudioData,
  maxSeconds = MAX_SECONDS,
): void {
  if (!(audio.samples instanceof Float32Array) || !audio.samples.length)
    throw new Error("This recording has no audio.");
  if (
    !Number.isInteger(audio.sampleRate) ||
    audio.sampleRate < 8000 ||
    audio.sampleRate > 192000
  )
    throw new Error("Unsupported audio sample rate.");
  if (audio.samples.length / audio.sampleRate > maxSeconds)
    throw new Error("Please use a recording shorter than 10 minutes.");
  for (const sample of audio.samples)
    if (!Number.isFinite(sample))
      throw new Error("This audio contains invalid samples.");
}

export function waveformPeaks(samples: Float32Array, count = 160): number[] {
  return Array.from({ length: count }, (_, i) => {
    const start = Math.floor((i * samples.length) / count);
    const end = Math.floor(((i + 1) * samples.length) / count);
    let peak = 0;
    for (let j = start; j < end; j++)
      peak = Math.max(peak, Math.abs(samples[j]));
    return peak;
  });
}

export function bufferToAudio(
  buffer: AudioBuffer,
  truncateAtSeconds?: number,
): AudioData {
  const length =
    truncateAtSeconds === undefined
      ? buffer.length
      : Math.min(
          buffer.length,
          Math.floor(truncateAtSeconds * buffer.sampleRate),
        );
  const samples = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < samples.length; i++)
      samples[i] += data[i] / buffer.numberOfChannels;
  }
  const audio = { samples, sampleRate: buffer.sampleRate };
  validateAudio(audio);
  return audio;
}

// A synthesized vowel melody gives a safe, reproducible effects demonstration.
export function makeDemo(seconds = 6): AudioData {
  const sampleRate = 48000;
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  const notes = [155, 174, 196, 164, 220, 185, 155, 196];
  let phase = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    const syllable = t % 0.65;
    const envelope =
      Math.min(1, syllable / 0.035) * Math.max(0, 1 - syllable / 0.58);
    const hz =
      notes[Math.floor(t / 0.65) % notes.length] *
      (1 + 0.008 * Math.sin(t * 31));
    phase += (2 * Math.PI * hz) / sampleRate;
    let value = 0;
    for (let h = 1; h <= 18; h++) {
      const formant =
        Math.exp(-(((hz * h - 750) / 350) ** 2)) +
        0.55 * Math.exp(-(((hz * h - 1250) / 220) ** 2));
      value += Math.sin(phase * h) * (0.08 / h + 0.1 * formant);
    }
    samples[i] = value * envelope;
  }
  return { samples, sampleRate };
}

export function safeFilename(name: string, format: "wav" | "mp3"): string {
  let clean =
    name
      .replace(/[^\p{L}\p{N} _.-]/gu, "_")
      .replace(/^[. _]+|[. _]+$/g, "")
      .replace(/_+/g, "_")
      .slice(0, 100) || "VoiceForge recording";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean))
    clean = `VoiceForge-${clean}`;
  return `${clean}.${format}`;
}
