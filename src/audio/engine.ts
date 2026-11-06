import { PRESETS } from "./presets";
import {
  bitcrush,
  changeSpeed,
  chorus,
  clamp,
  compress,
  distort,
  echo,
  filter,
  gate,
  modulate,
  reverb,
  vibrato,
} from "./dsp";
import { detectPitch, nearestScaleFrequency, pitchShift } from "./pitch";
import type { AudioData, StudioSettings } from "./types";

function bounded(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return clamp(value, min, max);
}

/** Original samples are never changed. All results are mono float PCM. */
export function renderAudio(
  audio: AudioData,
  settings: StudioSettings,
): AudioData {
  const { sampleRate } = audio;
  if (!(audio.samples instanceof Float32Array) || !audio.samples.length)
    throw new Error("The recording is empty.");
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new Error("Unsupported recording sample rate.");
  if (audio.samples.length / sampleRate > 600)
    throw new Error("Recordings can be up to 10 minutes long.");
  for (const value of audio.samples)
    if (!Number.isFinite(value))
      throw new Error("The recording contains invalid samples.");
  const duration = audio.samples.length / sampleRate;
  const start = bounded(settings.trimStart, 0, duration, "Trim start");
  const end =
    settings.trimEnd === 0
      ? duration
      : bounded(settings.trimEnd, 0, duration, "Trim end");
  if (
    end <= start ||
    Math.round(end * sampleRate) <= Math.round(start * sampleRate)
  )
    throw new Error("Choose a trim range that contains audio.");
  let samples: Float32Array = audio.samples.slice(
    Math.round(start * sampleRate),
    Math.round(end * sampleRate),
  );
  // Taper the edited source before time-based effects so both dry voice and
  // delayed reflections inherit a smooth boundary without cutting their tails.
  if (start > 0 || end < duration) {
    const fade = Math.min(
      Math.round(sampleRate * 0.003),
      Math.floor(samples.length / 2),
    );
    for (let i = 0; i < fade; i++) {
      if (start > 0) samples[i] *= i / fade;
      if (end < duration) samples[samples.length - 1 - i] *= i / fade;
    }
  }
  const preset = PRESETS.find((effect) => effect.id === settings.presetId);
  if (!preset) throw new Error("This voice effect is unavailable.");
  const recipe = preset.recipe;
  const intensity = bounded(settings.intensity, 0, 2, "Effect intensity");
  const pitch =
    bounded(settings.pitch, -24, 24, "Pitch") + (recipe.pitch ?? 0) * intensity;
  const tuning = clamp((recipe.autotune ?? 0) * intensity, 0, 1);
  const tuningKey = Math.round(
    bounded(settings.tuningKey, 0, 11, "Tuning key"),
  );
  if (!["chromatic", "major", "minor"].includes(settings.tuningScale))
    throw new Error("Choose a valid tuning scale.");
  if (pitch || tuning) {
    const baseRatio = 2 ** (pitch / 12);
    samples = pitchShift(samples, sampleRate, (frame) => {
      if (!tuning) return baseRatio;
      const frequency = detectPitch(frame, sampleRate);
      if (!frequency) return baseRatio;
      const target = nearestScaleFrequency(
        frequency,
        tuningKey,
        settings.tuningScale,
      );
      return baseRatio * (target / frequency) ** tuning;
    });
  }
  if (recipe.reverse && intensity >= 0.5) samples.reverse();
  if (recipe.speed && intensity > 0)
    samples = changeSpeed(
      samples,
      clamp(1 + (recipe.speed - 1) * intensity, 0.3, 2.5),
    );
  if (intensity > 0) {
    const highpass = recipe.telephone ? 420 : recipe.highpass;
    const lowpass = recipe.telephone ? 3100 : recipe.lowpass;
    if (highpass)
      samples = filter(
        samples,
        sampleRate,
        highpass * clamp(intensity, 0.1, 1.5),
        true,
      );
    if (lowpass)
      samples = filter(
        samples,
        sampleRate,
        sampleRate * 0.46 +
          (lowpass - sampleRate * 0.46) * clamp(intensity, 0, 1),
      );
    if (recipe.gate) gate(samples, sampleRate, recipe.gate * intensity);
    if (recipe.compressor) compress(samples, sampleRate, intensity);
    if (recipe.distortion)
      distort(samples, clamp(recipe.distortion * intensity, 0, 1));
    if (recipe.bitcrush)
      bitcrush(samples, recipe.bitcrush, clamp(intensity, 0, 1));
    if (recipe.ring || recipe.tremolo || recipe.robot) {
      modulate(
        samples,
        sampleRate,
        (recipe.ring ?? 0) * intensity,
        clamp((recipe.tremolo ?? 0) * intensity, 0, 1),
        recipe.robot ? clamp(intensity, 0, 1) : 0,
      );
    }
    if (recipe.vibrato)
      samples = vibrato(
        samples,
        sampleRate,
        clamp(recipe.vibrato * intensity, 0, 1),
      );
    if (recipe.chorus)
      samples = chorus(
        samples,
        sampleRate,
        clamp(recipe.chorus * intensity, 0, 1),
      );
  }
  const echoAmount = clamp(
    (recipe.echo ?? 0) * intensity + bounded(settings.echo, 0, 1, "Echo"),
    0,
    0.95,
  );
  const reverbAmount = clamp(
    (recipe.reverb ?? 0) * intensity + bounded(settings.reverb, 0, 1, "Reverb"),
    0,
    1,
  );
  if (echoAmount)
    samples = echo(samples, sampleRate, echoAmount, recipe.delay ?? 0.28);
  if (reverbAmount)
    samples = reverb(samples, sampleRate, reverbAmount, recipe.decay ?? 1.6);
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const gain = bounded(settings.gain, 0, 4, "Output gain");
  const normalizer = settings.normalize && peak > 0.00001 ? 0.95 / peak : 1;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] * normalizer * gain;
    const amplitude = Math.abs(value);
    samples[i] =
      amplitude <= 0.95
        ? value
        : Math.sign(value) *
          (0.95 + 0.05 * Math.tanh((amplitude - 0.95) / 0.05));
  }
  return { samples, sampleRate };
}
