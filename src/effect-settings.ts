import { getEffectChain, MAX_EFFECTS } from "./audio/chain";
import { PRESETS } from "./audio/presets";
import type { EffectInstance, StudioSettings } from "./audio/types";
import { DEFAULT_SETTINGS } from "./audio/types";

export function resetEffectSettings(settings: StudioSettings): StudioSettings {
  return {
    ...DEFAULT_SETTINGS,
    trimStart: settings.trimStart,
    trimEnd: settings.trimEnd,
    effectChain: [],
  };
}

export function appendEffect(
  settings: StudioSettings,
  presetId: string,
  id: string,
): { settings: StudioSettings; selectedId: string } {
  if (
    !PRESETS.some((preset) => preset.id === presetId) ||
    presetId === "original"
  )
    throw new Error("Choose an effect to add.");
  const chain = getEffectChain(settings);
  const existing = chain.find((effect) => effect.presetId === presetId);
  if (existing) return { settings, selectedId: existing.id };
  if (chain.length >= MAX_EFFECTS)
    throw new Error(
      `Your rack holds ${MAX_EFFECTS} effects. Remove one before adding another.`,
    );
  return {
    settings: {
      ...settings,
      effectChain: [...chain, { id, presetId, intensity: 1, enabled: true }],
    },
    selectedId: id,
  };
}

export function changeEffect(
  settings: StudioSettings,
  id: string,
  patch: Partial<Pick<EffectInstance, "intensity" | "enabled">>,
): StudioSettings {
  return {
    ...settings,
    effectChain: getEffectChain(settings).map((effect) =>
      effect.id === id ? { ...effect, ...patch } : effect,
    ),
  };
}
export function deleteEffect(
  settings: StudioSettings,
  id: string,
): StudioSettings {
  return {
    ...settings,
    effectChain: getEffectChain(settings).filter((effect) => effect.id !== id),
  };
}
export function reorderEffect(
  settings: StudioSettings,
  id: string,
  direction: -1 | 1,
): StudioSettings {
  const chain = getEffectChain(settings);
  const index = chain.findIndex((effect) => effect.id === id);
  const to = index + direction;
  if (index < 0 || to < 0 || to >= chain.length) return settings;
  [chain[index], chain[to]] = [chain[to], chain[index]];
  return { ...settings, effectChain: chain };
}
