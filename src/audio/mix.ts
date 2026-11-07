import { MAX_RENDER_SECONDS } from "./chain";
import { renderAudio } from "./engine";
import type { AudioData, StudioSettings } from "./types";

export const MAX_TRACKS = 8;
export const MAX_TRACK_OFFSET = 600;
export const MAX_PROJECT_SOURCE_SECONDS = 1800;
const MIX_RATE = 48000;

export interface MixTrack {
  audio: AudioData;
  settings: StudioSettings;
  offset: number;
  volume: number;
  muted: boolean;
}

export function mixTracks(tracks: MixTrack[]): AudioData {
  if (tracks.length > MAX_TRACKS)
    throw new Error(`A mix can contain up to ${MAX_TRACKS} tracks.`);
  if (
    tracks.reduce(
      (seconds, track) =>
        seconds + track.audio.samples.length / track.audio.sampleRate,
      0,
    ) > MAX_PROJECT_SOURCE_SECONDS
  )
    throw new Error(
      "A project can hold up to 30 minutes of source audio across its tracks.",
    );
  let samples = new Float32Array(0);
  for (const track of tracks) {
    if (track.muted) continue;
    if (
      !Number.isFinite(track.offset) ||
      track.offset < 0 ||
      track.offset > MAX_TRACK_OFFSET ||
      !Number.isFinite(track.volume) ||
      track.volume < 0 ||
      track.volume > 1
    )
      throw new Error("Check the track start time and volume.");
    const offset = Math.round(track.offset * MIX_RATE);
    const audio = renderAudio(track.audio, track.settings);
    const length = Math.max(
      1,
      Math.round((audio.samples.length * MIX_RATE) / audio.sampleRate),
    );
    const end = offset + length;
    if (end > MAX_RENDER_SECONDS * MIX_RATE)
      throw new Error(
        "The mix is too long. Shorten a track or move it earlier.",
      );
    if (end > samples.length) {
      const larger = new Float32Array(end);
      larger.set(samples);
      samples = larger;
    }
    const step = audio.sampleRate / MIX_RATE;
    for (let i = 0; i < length; i++) {
      const index = Math.min(i * step, audio.samples.length - 1);
      const left = Math.floor(index);
      const right = Math.min(left + 1, audio.samples.length - 1);
      const value =
        audio.samples[left] +
        (audio.samples[right] - audio.samples[left]) * (index - left);
      samples[offset + i] += value * track.volume;
    }
  }
  if (!samples.length)
    throw new Error("Add or unmute a track with audio first.");
  let peak = 0.98;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0.98) {
    const gain = 0.98 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
  return { samples, sampleRate: MIX_RATE };
}
