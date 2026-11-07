const TAU = Math.PI * 2;

/** In-place radix-2 FFT. Inverse output is normalized by the transform size. */
function fft(real: Float64Array, imaginary: Float64Array, inverse = false) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = (inverse ? TAU : -TAU) / size;
    const stepReal = Math.cos(angle),
      stepImaginary = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < size / 2; j++) {
        const a = start + j,
          b = a + size / 2;
        const br = real[b] * wr - imaginary[b] * wi;
        const bi = real[b] * wi + imaginary[b] * wr;
        real[b] = real[a] - br;
        imaginary[b] = imaginary[a] - bi;
        real[a] += br;
        imaginary[a] += bi;
        const nextReal = wr * stepReal - wi * stepImaginary;
        wi = wr * stepImaginary + wi * stepReal;
        wr = nextReal;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      real[i] /= n;
      imaginary[i] /= n;
    }
}

/** YIN cumulative difference pitch estimate. Unvoiced/silent frames return zero. */
export function detectPitch(samples: Float32Array, sampleRate: number): number {
  const stride = Math.max(1, Math.floor(sampleRate / 8000));
  const rate = sampleRate / stride;
  const length = Math.min(1024, Math.floor(samples.length / stride));
  const minLag = Math.max(2, Math.floor(rate / 1000));
  const maxLag = Math.min(Math.floor(rate / 65), Math.floor(length / 2));
  if (maxLag <= minLag) return 0;
  const frame = new Float64Array(length);
  let energy = 0,
    mean = 0;
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (let j = 0; j < stride; j++) value += samples[i * stride + j];
    frame[i] = value / stride;
    mean += frame[i];
  }
  mean /= length;
  for (let i = 0; i < length; i++) {
    frame[i] -= mean;
    energy += frame[i] * frame[i];
  }
  if (energy / length < 0.000008) return 0;
  const difference = new Float64Array(maxLag + 1);
  const count = length - maxLag;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const delta = frame[i] - frame[i + lag];
      sum += delta * delta;
    }
    difference[lag] = sum;
  }
  let total = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    total += difference[lag];
    difference[lag] = total ? (difference[lag] * lag) / total : 1;
  }
  for (let lag = minLag; lag < maxLag; lag++) {
    if (difference[lag] >= 0.15) continue;
    while (lag + 1 < maxLag && difference[lag + 1] < difference[lag]) lag++;
    const before = difference[lag - 1],
      value = difference[lag],
      after = difference[lag + 1];
    const divisor = 2 * (2 * value - after - before);
    const correction = divisor ? (after - before) / divisor : 0;
    return rate / (lag + Math.max(-0.5, Math.min(0.5, correction)));
  }
  return 0;
}

const SCALES = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  minorPentatonic: [0, 3, 5, 7, 10],
};
export function nearestScaleFrequency(
  frequency: number,
  key: number,
  scale: keyof typeof SCALES,
): number {
  if (!(frequency > 0)) return 0;
  const note = 69 + 12 * Math.log2(frequency / 440);
  let target = Math.floor(note),
    distance = Infinity;
  for (
    let candidate = Math.floor(note) - 12;
    candidate <= Math.ceil(note) + 12;
    candidate++
  ) {
    const degree = (((candidate - key) % 12) + 12) % 12;
    if (
      SCALES[scale].includes(degree) &&
      Math.abs(candidate - note) < distance - 0.00001
    ) {
      target = candidate;
      distance = Math.abs(candidate - note);
    }
  }
  return 440 * 2 ** ((target - 69) / 12);
}

/**
 * Duration-preserving STFT phase vocoder with 4x overlap and a Hann window.
 * The callback allows a different pitch ratio for each analysis frame.
 * This shifts formants along with pitch; it is intended for creative voice FX.
 */
export function pitchShift(
  samples: Float32Array,
  sampleRate: number,
  ratioForFrame: (frame: Float32Array, offset: number) => number,
): Float32Array {
  const size = sampleRate >= 32000 ? 4096 : 2048;
  const hop = size / 4,
    bins = size / 2 + 1;
  const output = new Float32Array(samples.length);
  const weight = new Float32Array(samples.length);
  const real = new Float64Array(size),
    imaginary = new Float64Array(size);
  const previousPhase = new Float64Array(bins),
    synthesisPhase = new Float64Array(bins);
  const magnitude = new Float64Array(bins),
    frequency = new Float64Array(bins);
  const window = Float64Array.from(
    { length: size },
    (_, i) => 0.5 - 0.5 * Math.cos((TAU * i) / size),
  );
  const frame = new Float32Array(size);
  let first = true;
  for (let offset = -size + hop; offset < samples.length; offset += hop) {
    for (let i = 0; i < size; i++) {
      frame[i] = samples[offset + i] ?? 0;
      real[i] = frame[i] * window[i];
      imaginary[i] = 0;
    }
    const ratio = Math.max(
      0.25,
      Math.min(4, ratioForFrame(frame, Math.max(0, offset))),
    );
    fft(real, imaginary);
    magnitude.fill(0);
    frequency.fill(0);
    for (let k = 0; k < bins; k++) {
      const phase = Math.atan2(imaginary[k], real[k]);
      const amplitude = Math.hypot(real[k], imaginary[k]);
      let delta = phase - previousPhase[k] - (TAU * k * hop) / size;
      delta -= TAU * Math.round(delta / TAU);
      previousPhase[k] = phase;
      const actualFrequency = (TAU * k) / size + delta / hop;
      const target = Math.round(k * ratio);
      if (target < bins) {
        magnitude[target] += amplitude;
        frequency[target] += amplitude * actualFrequency * ratio;
        if (first) synthesisPhase[target] = phase;
      }
    }
    real.fill(0);
    imaginary.fill(0);
    for (let k = 0; k < bins; k++) {
      if (!first)
        synthesisPhase[k] +=
          hop * (magnitude[k] ? frequency[k] / magnitude[k] : (TAU * k) / size);
      real[k] = magnitude[k] * Math.cos(synthesisPhase[k]);
      imaginary[k] = magnitude[k] * Math.sin(synthesisPhase[k]);
      if (k > 0 && k < size / 2) {
        real[size - k] = real[k];
        imaginary[size - k] = -imaginary[k];
      }
    }
    first = false;
    fft(real, imaginary, true);
    for (let i = 0; i < size; i++) {
      const index = offset + i;
      if (index < 0 || index >= samples.length) continue;
      output[index] += real[i] * window[i];
      weight[index] += window[i] * window[i];
    }
  }
  for (let i = 0; i < output.length; i++)
    if (weight[i] > 0.00001) output[i] /= weight[i];
  return output;
}
