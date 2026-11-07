import type { PreferencePatch, StudioPreferences } from "./studio-types";
declare global {
  interface Window {
    voiceforge?: {
      getPreferences: () => Promise<StudioPreferences>;
      savePreferences: (patch: PreferencePatch) => Promise<StudioPreferences>;
      chooseExportFolder: () => Promise<StudioPreferences>;
      saveAudio: (request: {
        name: string;
        format: "wav" | "mp3";
        data: ArrayBuffer;
        fast?: boolean;
      }) => Promise<{ canceled: boolean; path?: string }>;
      version: string;
    };
  }
}
