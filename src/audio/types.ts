export interface AudioData {
  samples: Float32Array;
  sampleRate: number;
}
export type EffectCategory =
  "Essentials" | "Characters" | "Spaces" | "Musical" | "Creative";
export interface EffectRecipe {
  pitch?: number;
  reverb?: number;
  decay?: number;
  echo?: number;
  delay?: number;
  distortion?: number;
  lowpass?: number;
  highpass?: number;
  ring?: number;
  tremolo?: number;
  chorus?: number;
  bitcrush?: number;
  reverse?: boolean;
  speed?: number;
  autotune?: number;
  telephone?: boolean;
  robot?: boolean;
  compressor?: boolean;
  gate?: number;
  vibrato?: number;
}
export interface EffectPreset {
  id: string;
  name: string;
  description: string;
  category: EffectCategory;
  icon: string;
  color: string;
  recipe: EffectRecipe;
  tags: string[];
}
export interface StudioSettings {
  presetId: string;
  intensity: number;
  pitch: number;
  reverb: number;
  echo: number;
  gain: number;
  normalize: boolean;
  trimStart: number;
  trimEnd: number;
  tuningKey: number;
  tuningScale: "chromatic" | "major" | "minor";
}
export const DEFAULT_SETTINGS: StudioSettings = {
  presetId: "original",
  intensity: 1,
  pitch: 0,
  reverb: 0,
  echo: 0,
  gain: 1,
  normalize: true,
  trimStart: 0,
  trimEnd: 0,
  tuningKey: 0,
  tuningScale: "chromatic",
};
