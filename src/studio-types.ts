import type { AudioData, StudioSettings } from "./audio/types";

export interface SavedRecording {
  id: string;
  name: string;
  createdAt: number;
  duration: number;
  audio: AudioData;
  settings: StudioSettings;
}
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
  audio: AudioData | null;
  waveform: number[];
  duration: number;
  settings: StudioSettings;
  updateSettings: (settings: Partial<StudioSettings>) => void;
  resetSettings: () => void;
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
  exportAudio: (format: "wav" | "mp3", bitrate?: number) => Promise<void>;
  exporting: boolean;
  recordings: SavedRecording[];
  saveRecording: () => Promise<void>;
  loadRecording: (id: string) => void;
  deleteRecording: (id: string) => Promise<void>;
  newRecording: () => void;
  error: string | null;
  notice: string | null;
  dismissMessage: () => void;
}
