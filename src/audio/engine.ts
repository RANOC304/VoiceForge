import { PRESETS } from "./presets";
import { getEffectChain, MAX_RENDER_SECONDS } from "./chain";
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
import type { AudioData, EffectRecipe, StudioSettings } from "./types";

const recipes = new Map(PRESETS.map((preset) => [preset.id, preset.recipe]));
function bounded(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value))
    throw new Error(`${label} must be a finite number.`);
  return clamp(value, min, max);
}

function requireLength(length: number, rate: number) {
  if (!Number.isSafeInteger(length) || length > rate * MAX_RENDER_SECONDS) {
    throw new Error(
      "This effect chain makes the recording too long. Shorten the take or remove a slow-motion or space effect. Processed audio can be up to 33 minutes 30 seconds.",
    );
  }
  return length;
}

/** Predict every intermediate allocation before processing any of the source. */
function projectedLength(
  length: number,
  rate: number,
  recipe: EffectRecipe,
  intensity: number,
): number {
  if (!intensity) return length;
  if (recipe.speed)
    length = requireLength(
      Math.max(
        1,
        Math.round(
          length / clamp(1 + (recipe.speed - 1) * intensity, 0.3, 2.5),
        ),
      ),
      rate,
    );
  if (recipe.echo)
    length = requireLength(
      length + Math.max(1, Math.round((recipe.delay ?? 0.28) * rate)) * 7,
      rate,
    );
  if (recipe.reverb)
    length = requireLength(
      length + Math.ceil((recipe.decay ?? 1.6) * rate),
      rate,
    );
  return length;
}

function applyRecipe(
  samples: Float32Array,
  sampleRate: number,
  recipe: EffectRecipe,
  intensity: number,
  settings: StudioSettings,
): Float32Array {
  if (!intensity) return samples;
  const pitch = (recipe.pitch ?? 0) * intensity;
  const tuning = clamp((recipe.autotune ?? 0) * intensity, 0, 1);
  if (pitch || tuning) {
    const baseRatio = 2 ** (pitch / 12);
    samples = pitchShift(samples, sampleRate, (frame) => {
      if (!tuning) return baseRatio;
      const frequency = detectPitch(frame, sampleRate);
      if (!frequency) return baseRatio;
      const target = nearestScaleFrequency(
        frequency,
        Math.round(settings.tuningKey),
        settings.tuningScale,
      );
      return baseRatio * (target / frequency) ** tuning;
    });
  }
  if (recipe.reverse && intensity >= 0.5) samples.reverse();
  if (recipe.speed)
    samples = changeSpeed(
      samples,
      clamp(1 + (recipe.speed - 1) * intensity, 0.3, 2.5),
    );
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
  if (recipe.echo)
    samples = echo(
      samples,
      sampleRate,
      clamp(recipe.echo * intensity, 0, 0.95),
      recipe.delay ?? 0.28,
    );
  if (recipe.reverb)
    samples = reverb(
      samples,
      sampleRate,
      clamp(recipe.reverb * intensity, 0, 1),
      recipe.decay ?? 1.6,
    );
  return samples;
}

/** Trim once, process each enabled stage in order, then apply shared controls. */
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
  const chain = getEffectChain(settings);
  const duration = audio.samples.length / sampleRate;
  const start = bounded(settings.trimStart, 0, duration, "Trim start");
  const end =
    settings.trimEnd === 0
      ? duration
      : bounded(settings.trimEnd, 0, duration, "Trim end");
  const firstSample = Math.round(start * sampleRate),
    lastSample = Math.round(end * sampleRate);
  if (end <= start || lastSample <= firstSample)
    throw new Error("Choose a trim range that contains audio.");
  const manualPitch = bounded(settings.pitch, -24, 24, "Pitch");
  const manualEcho = bounded(settings.echo, 0, 0.95, "Echo");
  const manualReverb = bounded(settings.reverb, 0, 1, "Reverb");
  const gain = bounded(settings.gain, 0, 4, "Output gain");
  const tuningKey = Math.round(
    bounded(settings.tuningKey, 0, 11, "Tuning key"),
  );
  if (!["chromatic", "major", "minor"].includes(settings.tuningScale))
    throw new Error("Choose a valid tuning scale.");

  let length = lastSample - firstSample;
  for (const effect of chain) {
    if (effect.enabled)
      length = projectedLength(
        length,
        sampleRate,
        recipes.get(effect.presetId)!,
        effect.intensity,
      );
  }
  if (manualEcho)
    length = requireLength(
      length + Math.max(1, Math.round(0.28 * sampleRate)) * 7,
      sampleRate,
    );
  if (manualReverb)
    requireLength(length + Math.ceil(1.6 * sampleRate), sampleRate);

  // The recording is untouched. Bound imported PCM before stacking feedback FX.
  let samples: Float32Array = audio.samples.slice(firstSample, lastSample);
  for (let i = 0; i < samples.length; i++)
    samples[i] = clamp(samples[i], -1, 1);
  // Edited boundaries are tapered before effects, including all their tails.
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
  for (const effect of chain) {
    if (effect.enabled)
      samples = applyRecipe(
        samples,
        sampleRate,
        recipes.get(effect.presetId)!,
        effect.intensity,
        { ...settings, tuningKey },
      );
  }
  if (manualPitch)
    samples = pitchShift(samples, sampleRate, () => 2 ** (manualPitch / 12));
  if (manualEcho) samples = echo(samples, sampleRate, manualEcho, 0.28);
  if (manualReverb) samples = reverb(samples, sampleRate, manualReverb, 1.6);

  let peak = 0;
  for (const value of samples) {
    if (!Number.isFinite(value))
      throw new Error(
        "This effect chain could not be processed. Reduce its intensity or remove an effect.",
      );
    peak = Math.max(peak, Math.abs(value));
  }
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
