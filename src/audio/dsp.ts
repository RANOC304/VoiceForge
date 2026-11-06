const TAU = Math.PI * 2;
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function filter(
  samples: Float32Array,
  rate: number,
  cutoff: number,
  highpass = false,
): Float32Array {
  const omega = (TAU * clamp(cutoff, 20, rate * 0.45)) / rate;
  const cosine = Math.cos(omega),
    alpha = Math.sin(omega) / Math.SQRT2;
  const a0 = 1 + alpha,
    a1 = (-2 * cosine) / a0,
    a2 = (1 - alpha) / a0;
  const b0 = (highpass ? 1 + cosine : 1 - cosine) / 2 / a0;
  const b1 = (highpass ? -(1 + cosine) : 1 - cosine) / a0;
  const b2 = b0;
  const output = new Float32Array(samples.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i],
      y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    output[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return output;
}

export function changeSpeed(
  samples: Float32Array,
  speed: number,
): Float32Array {
  const output = new Float32Array(
    Math.max(1, Math.round(samples.length / speed)),
  );
  for (let i = 0; i < output.length; i++) {
    const position = i * speed,
      index = Math.floor(position),
      fraction = position - index;
    output[i] =
      (samples[index] ?? 0) * (1 - fraction) +
      (samples[index + 1] ?? 0) * fraction;
  }
  return output;
}

export function distort(samples: Float32Array, amount: number) {
  const drive = 1 + amount * 22,
    scale = Math.tanh(drive);
  for (let i = 0; i < samples.length; i++)
    samples[i] = Math.tanh(samples[i] * drive) / scale;
}

export function compress(samples: Float32Array, rate: number, amount: number) {
  const attack = Math.exp(-1 / (0.005 * rate)),
    release = Math.exp(-1 / (0.09 * rate));
  let envelope = 0;
  for (let i = 0; i < samples.length; i++) {
    const peak = Math.abs(samples[i]),
      coefficient = peak > envelope ? attack : release;
    envelope = coefficient * envelope + (1 - coefficient) * peak;
    const reduction =
      envelope > 0.18
        ? (0.18 + (envelope - 0.18) / (1 + 3 * amount)) / envelope
        : 1;
    samples[i] *= reduction * (1 + 0.45 * amount);
  }
}

export function gate(samples: Float32Array, rate: number, threshold: number) {
  let envelope = 0,
    gain = 0;
  const release = Math.exp(-1 / (0.045 * rate)),
    smoothing = Math.exp(-1 / (0.003 * rate));
  for (let i = 0; i < samples.length; i++) {
    envelope = Math.max(Math.abs(samples[i]), envelope * release);
    const target = clamp(
      (envelope - threshold * 0.35) / (threshold * 0.65),
      0,
      1,
    );
    gain = smoothing * gain + (1 - smoothing) * target;
    samples[i] *= gain;
  }
}

export function modulate(
  samples: Float32Array,
  rate: number,
  ring: number,
  tremolo: number,
  robot: number,
) {
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    if (robot)
      samples[i] =
        samples[i] * (1 - robot) +
        Math.abs(samples[i]) * Math.sin(TAU * 92 * t) * robot;
    if (ring) samples[i] *= 0.18 + 0.82 * Math.sin(TAU * ring * t);
    if (tremolo)
      samples[i] *= 1 - tremolo * (0.5 + 0.5 * Math.cos(TAU * 5.5 * t));
  }
}

export function bitcrush(samples: Float32Array, bits: number, amount: number) {
  const resolution = 2 ** clamp(bits, 3, 15),
    hold = Math.max(1, Math.round((16 - bits) / 2));
  let value = 0;
  for (let i = 0; i < samples.length; i++) {
    if (i % hold === 0)
      value = Math.round(samples[i] * resolution) / resolution;
    samples[i] = samples[i] * (1 - amount) + value * amount;
  }
}

function sampleAt(samples: Float32Array, position: number) {
  if (position < 0 || position >= samples.length - 1) return 0;
  const index = Math.floor(position),
    fraction = position - index;
  return samples[index] * (1 - fraction) + samples[index + 1] * fraction;
}

export function chorus(
  samples: Float32Array,
  rate: number,
  amount: number,
): Float32Array {
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const a = sampleAt(
      samples,
      i - rate * (0.018 + 0.004 * Math.sin(TAU * 0.75 * t)),
    );
    const b = sampleAt(
      samples,
      i - rate * (0.026 + 0.006 * Math.sin(TAU * 1.13 * t + 1.4)),
    );
    output[i] = samples[i] * (1 - amount * 0.4) + (a + b) * amount * 0.32;
  }
  return output;
}

export function vibrato(
  samples: Float32Array,
  rate: number,
  amount: number,
): Float32Array {
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const position =
      i - rate * 0.003 * (1 + amount * Math.sin((TAU * 5.2 * i) / rate));
    output[i] = sampleAt(samples, position);
  }
  return output;
}

/** Four damped feedback combs followed by two all-pass diffusion stages. */
export function reverb(
  samples: Float32Array,
  rate: number,
  amount: number,
  decay: number,
): Float32Array {
  const output = new Float32Array(samples.length + Math.ceil(rate * decay));
  const wet = new Float32Array(output.length);
  for (const seconds of [0.0297, 0.0371, 0.0411, 0.0437]) {
    const delay = Math.max(1, Math.round(seconds * rate));
    const line = new Float32Array(delay);
    const feedback = Math.pow(0.001, seconds / decay);
    let previous = 0;
    for (let i = 0; i < wet.length; i++) {
      const index = i % delay,
        value = line[index];
      previous = value * 0.65 + previous * 0.35;
      line[index] = (samples[i] ?? 0) + previous * feedback;
      wet[i] += value * 0.25;
    }
  }
  for (const seconds of [0.0051, 0.0017]) {
    const delay = Math.max(1, Math.round(seconds * rate)),
      line = new Float32Array(delay);
    for (let i = 0; i < wet.length; i++) {
      const index = i % delay,
        buffered = line[index],
        value = wet[i];
      wet[i] = buffered - value * 0.6;
      line[index] = value + wet[i] * 0.6;
    }
  }
  for (let i = 0; i < output.length; i++)
    output[i] = (samples[i] ?? 0) * (1 - amount * 0.35) + wet[i] * amount * 1.5;
  return output;
}

export function echo(
  samples: Float32Array,
  rate: number,
  amount: number,
  seconds: number,
): Float32Array {
  const delay = Math.max(1, Math.round(seconds * rate));
  const output = new Float32Array(samples.length + delay * 7);
  for (let i = 0; i < output.length; i++)
    output[i] =
      (samples[i] ?? 0) + (i >= delay ? output[i - delay] * amount * 0.68 : 0);
  return output;
}
