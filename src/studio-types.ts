import type { AudioData, EffectInstance, StudioSettings } from "./audio/types";

export interface StudioPreferences {
  microphoneId: string;
  microphoneLabel: string;
  exportFolder: string | null;
  exportFormat: "wav" | "mp3";
  exportBitrate: number;
}

export type PreferencePatch = Partial<Omit<StudioPreferences, "exportFolder">>;

export interface StudioTrack {
  id: string;
  name: string;
  audio: AudioData | null;
  settings: StudioSettings;
  offset: number;
  volume: number;
  muted: boolean;
}

export interface StackPreset {
  id: string;
  name: string;
  settings: Omit<StudioSettings, "trimStart" | "trimEnd">;
}

export interface SavedRecording {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  audio: AudioData;
  settings: StudioSettings;
  tracks?: StudioTrack[];
  activeTrackId?: string;
}
export type RecordingSummary = Pick<
  SavedRecording,
  "id" | "name" | "createdAt" | "duration" | "settings"
> & { trackCount: number };
export interface Studio {
  name: string;
  setName: (name: string) => void;
  recordingState: "idle" | "recording" | "paused";
  recordingSeconds: number;
  startRecording: () => Promise<void>;
  pauseRecording: () => void;
  stopRecording: () => void;
  inputLevel: number;
  inputWaveform: number[];
  devices: MediaDeviceInfo[];
  deviceId: string;
  setDeviceId: (id: string) => void;
  refreshDevices: () => Promise<void>;
  detectMicrophones: () => Promise<void>;
  preferences: StudioPreferences;
  savePreferences: (patch: PreferencePatch) => Promise<void>;
  chooseExportFolder: () => Promise<void>;
  audio: AudioData | null;
  waveform: number[];
  duration: number;
  settings: StudioSettings;
  updateSettings: (settings: Partial<StudioSettings>) => void;
  effectChain: EffectInstance[];
  selectedEffectId: string | null;
  addEffect: (presetId: string) => void;
  previewEffect: (presetId: string) => void;
  previewPresetId: string | null;
  clearEffectPreview: () => void;
  selectEffect: (id: string) => void;
  removeEffect: (id: string) => void;
  toggleEffect: (id: string) => void;
  moveEffect: (id: string, direction: -1 | 1) => void;
  resetSettings: () => void;
  stackPresets: StackPreset[];
  saveStackPreset: (name: string) => Promise<void>;
  applyStackPreset: (id: string) => void;
  deleteStackPreset: (id: string) => Promise<void>;
  tracks: StudioTrack[];
  activeTrackId: string;
  selectTrack: (id: string) => void;
  addTrack: () => void;
  removeTrack: (id: string) => void;
  updateTrack: (
    id: string,
    patch: Partial<Pick<StudioTrack, "name" | "offset" | "volume" | "muted">>,
  ) => void;
  clearRecording: () => void;
  mixPlaying: boolean;
  mixing: boolean;
  playMix: () => Promise<void>;
  monitorOtherTracks: boolean;
  setMonitorOtherTracks: (value: boolean) => void;
  processing: boolean;
  playing: boolean;
  playhead: number;
  originalPreview: boolean;
  setOriginalPreview: (value: boolean) => void;
  togglePlayback: () => Promise<void>;
  stopPlayback: () => void;
  seek: (seconds: number) => void;
  importFile: (file: File) => Promise<void>;
  loadDemo: () => Promise<void>;
  exportAudio: (
    format: "wav" | "mp3",
    bitrate?: number,
    scope?: "track" | "mix",
  ) => Promise<void>;
  fastExport: () => Promise<void>;
  exporting: boolean;
  recordings: RecordingSummary[];
  saveRecording: () => Promise<void>;
  loadRecording: (id: string) => Promise<boolean>;
  deleteRecording: (id: string) => Promise<void>;
  newRecording: () => void;
  error: string | null;
  notice: string | null;
  dismissMessage: () => void;
}
