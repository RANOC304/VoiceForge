import { PRESETS } from "./presets";
import type { EffectInstance, StudioSettings } from "./types";

export const MAX_EFFECTS = 8;
export const MAX_RENDER_SECONDS = 2010;
const presetIds = new Set(PRESETS.map((preset) => preset.id));

/** Copies and validates both current chains and single-preset 1.0 sessions. */
export function getEffectChain(settings: StudioSettings): EffectInstance[] {
  const chain =
    settings.effectChain === undefined
      ? settings.presetId === "original"
        ? []
        : [
            {
              id: `legacy-${settings.presetId}`,
              presetId: settings.presetId,
              intensity: settings.intensity,
              enabled: true,
            },
          ]
      : settings.effectChain;
  if (!Array.isArray(chain))
    throw new Error("This saved effect chain is invalid.");
  if (chain.length > MAX_EFFECTS)
    throw new Error(
      `Use up to ${MAX_EFFECTS} effects in one chain. Remove an effect to add another.`,
    );
  const ids = new Set<string>();
  return chain.map((effect) => {
    if (
      !effect ||
      typeof effect !== "object" ||
      typeof effect.id !== "string" ||
      !effect.id.length ||
      effect.id.length > 160 ||
      typeof effect.enabled !== "boolean"
    ) {
      throw new Error("This saved effect chain contains an invalid effect.");
    }
    if (ids.has(effect.id))
      throw new Error("Each effect needs a unique slot identifier.");
    ids.add(effect.id);
    if (!presetIds.has(effect.presetId))
      throw new Error(
        "This voice effect is unavailable. Remove it from the chain.",
      );
    if (
      !Number.isFinite(effect.intensity) ||
      effect.intensity < 0 ||
      effect.intensity > 2
    )
      throw new Error("Effect intensity must be between 0 and 200%.");
    return {
      id: effect.id,
      presetId: effect.presetId,
      intensity: effect.intensity,
      enabled: effect.enabled,
    };
  });
}
