import { getEffectChain } from "./audio/chain";
import { PRESETS } from "./audio/presets";
import type { StudioSettings } from "./audio/types";

/** A temporary render request. The applied stack and its saved settings stay intact. */
export function makeEffectPreviewSettings(
  settings: StudioSettings,
  presetId: string,
): StudioSettings {
  if (!PRESETS.some((preset) => preset.id === presetId))
    throw new Error("This voice effect is unavailable.");
  const existing = getEffectChain(settings).find(
    (effect) => effect.presetId === presetId,
  );
  return {
    ...settings,
    effectChain:
      presetId === "original"
        ? []
        : [
            {
              id: `preview-${presetId}`,
              presetId,
              intensity: existing?.intensity ?? 1,
              enabled: true,
            },
          ],
  };
}
