import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  type AudioData,
  type StudioSettings,
} from "./audio/types";
import {
  bufferToAudio,
  makeDemo,
  MAX_SECONDS,
  waveformPeaks,
} from "./audio/utils";
import { safeFilename } from "./audio/utils";
import { getEffectChain } from "./audio/chain";
import {
  MAX_PROJECT_SOURCE_SECONDS,
  MAX_TRACK_OFFSET,
  MAX_TRACKS,
  type MixTrack,
} from "./audio/mix";
import { makeEffectPreviewSettings } from "./effect-preview";
import {
  appendEffect,
  applyStackPreset as settingsForPreset,
  changeEffect,
  deleteEffect,
  makeStackPreset,
  reorderEffect,
  resetEffectSettings,
} from "./effect-settings";
import {
  getRecording,
  listRecordingSummaries,
  listStackPresets,
  putRecording,
  putStackPreset,
  removeRecording,
  removeStackPreset,
} from "./storage";
import type {
  PreferencePatch,
  RecordingSummary,
  SavedRecording,
  StackPreset,
  Studio,
  StudioPreferences,
  StudioTrack,
} from "./studio-types";

function worker(): Worker {
  return new Worker(new URL("./audio/processing.worker.ts", import.meta.url), {
    type: "module",
  });
}
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

function emptyTrack(name: string): StudioTrack {
  return {
    id: crypto.randomUUID(),
    name,
    audio: null,
    settings: { ...DEFAULT_SETTINGS, effectChain: [] },
    offset: 0,
    volume: 1,
    muted: false,
  };
}

type AudioTask =
  | { operation: "mix"; tracks: MixTrack[] }
  | { operation: "render"; audio: AudioData; settings: StudioSettings }
  | { operation: "wav" | "mp3"; audio: AudioData; bitrate?: number };

function runAudioTask(task: Worker, request: AudioTask) {
  return new Promise<{ audio?: AudioData; data?: ArrayBuffer }>(
    (resolve, reject) => {
      const timeout = window.setTimeout(() => {
        task.terminate();
        reject(
          new Error("Audio processing took too long. Try shorter tracks."),
        );
      }, 120000);
      task.onmessage = (event) => {
        clearTimeout(timeout);
        if (event.data.ok) resolve(event.data);
        else reject(new Error(event.data.error));
      };
      task.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Audio processing failed. Please try again."));
      };
      try {
        task.postMessage(request);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    },
  );
}

export function useStudio(): Studio {
  const [name, setName] = useState("Untitled recording");
  const [recordingState, setRecordingState] =
    useState<Studio["recordingState"]>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [inputWaveform, setInputWaveform] = useState<number[]>(
    Array(80).fill(0),
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [preferences, setPreferences] = useState<StudioPreferences>({
    microphoneId: "",
    microphoneLabel: "",
    exportFolder: null,
    exportFormat: "wav",
    exportBitrate: 192,
  });
  const [audio, setAudio] = useState<AudioData | null>(null);
  const [trackRows, setTrackRows] = useState<StudioTrack[]>(() => [
    emptyTrack("Track 1"),
  ]);
  const [activeTrackId, setActiveTrackId] = useState(trackRows[0].id);
  const [processed, setProcessed] = useState<AudioData | null>(null);
  const [settings, setSettings] = useState<StudioSettings>({
    ...DEFAULT_SETTINGS,
  });
  const [processing, setProcessing] = useState(false);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [previewPresetId, setPreviewPresetId] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mixPlaying, setMixPlaying] = useState(false);
  const [mixing, setMixing] = useState(false);
  const [monitorOtherTracks, setMonitorOtherTracks] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [originalPreview, setOriginalPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [stackPresets, setStackPresets] = useState<StackPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const context = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);
  const playStarted = useRef(0);
  const playOffset = useRef(0);
  const captureStarted = useRef(0);
  const captureElapsed = useRef(0);
  const captureMax = useRef(MAX_SECONDS);
  const meterFrame = useRef(0);
  const captureLimitTimer = useRef<number | undefined>(undefined);
  const playbackFrame = useRef(0);
  const renderWorker = useRef<Worker | null>(null);
  const encodingWorker = useRef<Worker | null>(null);
  const mixWorker = useRef<Worker | null>(null);
  const monitorBuffer = useRef<AudioBuffer | null>(null);
  const monitorSource = useRef<AudioBufferSourceNode | null>(null);
  const monitorOffset = useRef(0);
  const exportBusy = useRef(false);
  const acquiring = useRef(false);
  const saving = useRef(false);
  const playbackGeneration = useRef(0);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const sessionGeneration = useRef(0);
  const editRevision = useRef(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const processedRef = useRef<AudioData | null>(null);
  const previewAfterRender = useRef(false);
  const previewPresetRef = useRef<string | null>(null);
  const tracks = useMemo(
    () =>
      trackRows.map((track) =>
        track.id === activeTrackId ? { ...track, audio, settings } : track,
      ),
    [trackRows, activeTrackId, audio, settings],
  );
  const renderSettings = useMemo(
    () =>
      previewPresetId
        ? makeEffectPreviewSettings(settings, previewPresetId)
        : settings,
    [settings, previewPresetId, previewRevision],
  );

  const getContext = useCallback(async () => {
    if (!context.current || context.current.state === "closed")
      context.current = new AudioContext({ sampleRate: 48000 });
    if (context.current.state === "suspended") await context.current.resume();
    return context.current;
  }, []);

  const stopMonitor = useCallback(() => {
    const node = monitorSource.current;
    if (!node) return;
    node.onended = null;
    node.stop();
    node.disconnect();
    monitorSource.current = null;
  }, []);

  const startMonitor = (ctx: AudioContext) => {
    const buffer = monitorBuffer.current;
    const offset = monitorOffset.current + captureElapsed.current;
    if (!buffer || offset >= buffer.duration) return;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    node.onended = () => {
      if (monitorSource.current === node) monitorSource.current = null;
      node.disconnect();
    };
    monitorSource.current = node;
    node.start(0, offset);
  };

  const haltPlayback = useCallback(() => {
    playbackGeneration.current++;
    cancelAnimationFrame(playbackFrame.current);
    if (source.current) {
      source.current.onended = null;
      try {
        source.current.stop();
      } catch {
        /* already ended */
      }
      source.current.disconnect();
      source.current = null;
    }
    setPlaying(false);
    setMixPlaying(false);
  }, []);

  const stopPlayback = useCallback(() => {
    previewAfterRender.current = false;
    haltPlayback();
  }, [haltPlayback]);

  const cancelAudition = useCallback(() => {
    previewPresetRef.current = null;
    setPreviewPresetId(null);
  }, []);

  const playAudioBuffer = useCallback(
    async (next: AudioData, offset = 0, mix = false) => {
      haltPlayback();
      const playback = playbackGeneration.current;
      const ctx = await getContext();
      if (
        !mounted.current ||
        playback !== playbackGeneration.current ||
        (recorder.current && recorder.current.state !== "inactive")
      )
        return;
      const buffer = ctx.createBuffer(1, next.samples.length, next.sampleRate);
      buffer.copyToChannel(new Float32Array(next.samples), 0);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(ctx.destination);
      source.current = node;
      const position = offset >= buffer.duration ? 0 : Math.max(0, offset);
      playStarted.current = ctx.currentTime;
      playOffset.current = position;
      node.onended = () => {
        if (source.current !== node) return;
        source.current = null;
        node.disconnect();
        cancelAnimationFrame(playbackFrame.current);
        setPlaying(false);
        setMixPlaying(false);
        setPlayhead(0);
      };
      node.start(0, position);
      setPlaying(true);
      setMixPlaying(mix);
      const tick = () => {
        if (!mix)
          setPlayhead(
            Math.min(
              buffer.duration,
              playOffset.current + ctx.currentTime - playStarted.current,
            ),
          );
        playbackFrame.current = requestAnimationFrame(tick);
      };
      playbackFrame.current = requestAnimationFrame(tick);
    },
    [getContext, haltPlayback],
  );

  const refreshDevices = useCallback(async () => {
    try {
      if (navigator.mediaDevices)
        setDevices(
          (await navigator.mediaDevices.enumerateDevices()).filter(
            (device) => device.kind === "audioinput",
          ),
        );
    } catch {
      /* Device names become available after microphone permission. */
    }
  }, []);

  // React external-resource setup and cleanup: https://react.dev/reference/react/useEffect#connecting-to-an-external-system
  useEffect(() => {
    mounted.current = true;
    void listRecordingSummaries()
      .then((rows) => {
        if (mounted.current) setRecordings(rows);
      })
      .catch((e) => {
        if (mounted.current) setError(message(e));
      });
    void listStackPresets()
      .then((rows) => {
        if (mounted.current) setStackPresets(rows);
      })
      .catch((e) => {
        if (mounted.current) setError(message(e));
      });
    void refreshDevices();
    void window.voiceforge
      ?.getPreferences()
      .then((saved) => {
        if (!mounted.current) return;
        setPreferences(saved);
        setDeviceId(saved.microphoneId);
      })
      .catch((error) => {
        if (mounted.current) setError(message(error));
      });
    navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
    return () => {
      mounted.current = false;
      sessionGeneration.current++;
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        refreshDevices,
      );
      cancelAnimationFrame(meterFrame.current);
      clearTimeout(captureLimitTimer.current);
      cancelAnimationFrame(playbackFrame.current);
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stream.current?.getTracks().forEach((track) => track.stop());
      renderWorker.current?.terminate();
      encodingWorker.current?.terminate();
      mixWorker.current?.terminate();
      stopMonitor();
      source.current?.disconnect();
      void context.current?.close();
    };
  }, [refreshDevices, stopMonitor]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (
        dirty.current ||
        (recorder.current && recorder.current.state !== "inactive")
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);

  useEffect(() => {
    haltPlayback();
    setPlayhead(0);
    setProcessed(null);
    processedRef.current = null;
    if (!audio) {
      setProcessing(false);
      return;
    }
    setProcessing(true);
    let taskTimeout: number | undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      const task = worker();
      renderWorker.current = task;
      taskTimeout = window.setTimeout(() => {
        if (!active) return;
        previewAfterRender.current = false;
        task.terminate();
        setProcessing(false);
        setError("This effect took too long. Try a shorter recording.");
      }, 120000);
      task.onmessage = (event) => {
        clearTimeout(taskTimeout);
        if (!active) return;
        if (event.data.ok) {
          setProcessed(event.data.audio);
          processedRef.current = event.data.audio;
          if (previewAfterRender.current) {
            previewAfterRender.current = false;
            void playAudioBuffer(event.data.audio).catch((error) =>
              setError(message(error)),
            );
          }
        } else {
          previewAfterRender.current = false;
          setError(event.data.error);
        }
        setProcessing(false);
        task.terminate();
      };
      task.onerror = () => {
        clearTimeout(taskTimeout);
        if (!active) return;
        previewAfterRender.current = false;
        setError(
          "The audio processor could not start. Restart VoiceForge and try again.",
        );
        setProcessing(false);
        task.terminate();
      };
      task.postMessage({
        operation: "render",
        audio,
        settings: renderSettings,
      });
    }, 140);
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(taskTimeout);
      renderWorker.current?.terminate();
    };
  }, [audio, renderSettings, haltPlayback, playAudioBuffer]);

  const updateSettings = useCallback(
    (patch: Partial<StudioSettings>) => {
      if (mixWorker.current) return;
      const tuningEdit =
        "tuningKey" in patch ||
        "tuningScale" in patch ||
        "tuningRetuneMs" in patch;
      if (!tuningEdit) cancelAudition();
      if (tracks.some((track) => track.audio)) dirty.current = true;
      editRevision.current++;
      if (
        (source.current && !mixPlaying) ||
        previewAfterRender.current ||
        (tuningEdit && previewPresetRef.current)
      )
        previewAfterRender.current = true;
      if (audio) {
        processedRef.current = null;
        setProcessing(true);
      }
      const previous = settingsRef.current;
      const next = { ...previous, ...patch };
      if (patch.intensity !== undefined && selectedEffectId)
        next.effectChain = changeEffect(previous, selectedEffectId, {
          intensity: patch.intensity,
        }).effectChain;
      const length = audio
        ? audio.samples.length / audio.sampleRate
        : MAX_SECONDS;
      next.trimStart = Math.max(
        0,
        Math.min(
          Number.isFinite(next.trimStart) ? next.trimStart : 0,
          Math.max(0, length - 0.01),
        ),
      );
      if (next.trimEnd !== 0)
        next.trimEnd = Math.max(
          next.trimStart + 0.01,
          Math.min(
            Number.isFinite(next.trimEnd) ? next.trimEnd : length,
            length,
          ),
        );
      settingsRef.current = next;
      setSettings(next);
    },
    [audio, selectedEffectId, cancelAudition, mixPlaying, tracks],
  );

  const commitEffects = (next: StudioSettings, preview = true) => {
    if (next === settingsRef.current) return;
    if (
      (recorder.current && recorder.current.state !== "inactive") ||
      exportBusy.current ||
      mixWorker.current
    )
      return;
    cancelAudition();
    if (tracks.some((track) => track.audio)) dirty.current = true;
    editRevision.current++;
    settingsRef.current = next;
    processedRef.current = null;
    previewAfterRender.current = preview && Boolean(audio);
    if (preview && audio) {
      setOriginalPreview(false);
      void getContext().catch((e) => setError(message(e)));
    }
    haltPlayback();
    if (audio) setProcessing(true);
    setSettings(next);
  };
  const selectEffect = (id: string) => {
    const effect = getEffectChain(settingsRef.current).find(
      (effect) => effect.id === id,
    );
    if (!effect) return;
    if (previewPresetRef.current) {
      cancelAudition();
      processedRef.current = null;
      if (audio) setProcessing(true);
    }
    setSelectedEffectId(id);
    if (!audio) return;
    setOriginalPreview(false);
    void getContext().catch((e) => setError(message(e)));
    if (processedRef.current) {
      previewAfterRender.current = false;
      void playAudioBuffer(processedRef.current).catch((e) =>
        setError(message(e)),
      );
    } else previewAfterRender.current = true;
  };
  const resetSettings = () => {
    setSelectedEffectId(null);
    commitEffects(resetEffectSettings(settingsRef.current));
  };
  const saveStackPreset = async (label: string) => {
    const preset = makeStackPreset(
      label,
      settingsRef.current,
      crypto.randomUUID(),
    );
    await putStackPreset(preset);
    setStackPresets(await listStackPresets());
    setNotice(`Saved ${preset.name} as a stack preset.`);
  };
  const applyStackPreset = (id: string) => {
    const preset = stackPresets.find((item) => item.id === id);
    if (!preset) return;
    const next = settingsForPreset(settingsRef.current, preset, () =>
      crypto.randomUUID(),
    );
    setSelectedEffectId(next.effectChain?.at(-1)?.id ?? null);
    commitEffects(next);
    setNotice(`Applied ${preset.name} to the selected track.`);
  };
  const deleteStackPreset = async (id: string) => {
    await removeStackPreset(id);
    setStackPresets(await listStackPresets());
  };
  const addEffect = (presetId: string) => {
    if (presetId === "original") {
      resetSettings();
      return;
    }
    try {
      const result = appendEffect(
        settingsRef.current,
        presetId,
        crypto.randomUUID(),
      );
      setSelectedEffectId(result.selectedId);
      if (result.settings === settingsRef.current)
        selectEffect(result.selectedId);
      else commitEffects(result.settings);
    } catch (e) {
      setError(message(e));
    }
  };
  const removeEffect = (id: string) => {
    const next = deleteEffect(settingsRef.current, id);
    if (selectedEffectId === id)
      setSelectedEffectId(next.effectChain?.at(-1)?.id ?? null);
    commitEffects(next);
  };
  const toggleEffect = (id: string) => {
    const effect = getEffectChain(settingsRef.current).find(
      (effect) => effect.id === id,
    );
    if (effect)
      commitEffects(
        changeEffect(settingsRef.current, id, { enabled: !effect.enabled }),
      );
  };
  const moveEffect = (id: string, direction: -1 | 1) =>
    commitEffects(reorderEffect(settingsRef.current, id, direction));

  const previewEffect = (presetId: string) => {
    if (
      exportBusy.current ||
      mixWorker.current ||
      acquiring.current ||
      (recorder.current && recorder.current.state !== "inactive")
    )
      return;
    try {
      makeEffectPreviewSettings(settingsRef.current, presetId);
      const same = previewPresetRef.current === presetId;
      previewPresetRef.current = presetId;
      setPreviewPresetId(presetId);
      setOriginalPreview(false);
      if (!audio) return;
      void getContext().catch((e) => setError(message(e)));
      if (same && processedRef.current) {
        previewAfterRender.current = false;
        void playAudioBuffer(processedRef.current).catch((e) =>
          setError(message(e)),
        );
      } else {
        setPreviewRevision((revision) => revision + 1);
        processedRef.current = null;
        previewAfterRender.current = true;
        haltPlayback();
        setPlayhead(0);
        setProcessing(true);
      }
    } catch (e) {
      setError(message(e));
    }
  };
  const clearEffectPreview = () => {
    if (!previewPresetRef.current) return;
    cancelAudition();
    processedRef.current = null;
    haltPlayback();
    setPlayhead(0);
    previewAfterRender.current = Boolean(audio);
    setOriginalPreview(false);
    if (audio) {
      setProcessing(true);
      void getContext().catch((e) => setError(message(e)));
    }
  };

  const showTrack = useCallback(
    (next: AudioData | null, nextSettings: StudioSettings) => {
      sessionGeneration.current++;
      editRevision.current++;
      stopPlayback();
      cancelAudition();
      setAudio(next);
      setProcessed(null);
      setProcessing(Boolean(next));
      processedRef.current = null;
      const migrated = {
        ...nextSettings,
        effectChain: getEffectChain(nextSettings),
      };
      settingsRef.current = migrated;
      setSettings(migrated);
      setSelectedEffectId(migrated.effectChain.at(-1)?.id ?? null);
      setPlayhead(0);
      setOriginalPreview(false);
      setError(null);
    },
    [stopPlayback, cancelAudition],
  );

  const loadAudio = (
    next: AudioData,
    nextName: string,
    nextSettings = { ...DEFAULT_SETTINGS },
  ) => {
    showTrack(next, nextSettings);
    if (tracks.length === 1) {
      setName(nextName);
      setCurrentId(null);
    }
    dirty.current = true;
  };

  const canChangeTracks = () =>
    recordingState === "idle" &&
    !acquiring.current &&
    !processing &&
    !exportBusy.current &&
    !mixWorker.current &&
    !saving.current;

  const trackSourceLimit = () =>
    Math.min(
      MAX_SECONDS,
      MAX_PROJECT_SOURCE_SECONDS -
        tracks.reduce(
          (seconds, track) =>
            track.id !== activeTrackId && track.audio
              ? seconds + track.audio.samples.length / track.audio.sampleRate
              : seconds,
          0,
        ),
    );
  const projectLimitMessage =
    "A project can hold up to 30 minutes of source audio across its tracks.";

  const activateTrack = (rows: StudioTrack[], next: StudioTrack) => {
    // The active editor owns its audio. Keep only the inactive tracks' PCM here.
    setTrackRows(
      rows.map((track) =>
        track.id === next.id ? { ...track, audio: null } : track,
      ),
    );
    setActiveTrackId(next.id);
    showTrack(next.audio, next.settings);
  };

  const selectTrack = (id: string) => {
    if (id === activeTrackId || !canChangeTracks()) return;
    const next = tracks.find((track) => track.id === id);
    if (!next) return;
    activateTrack(tracks, next);
  };

  const addTrack = () => {
    if (!canChangeTracks() || tracks.length >= MAX_TRACKS) return;
    let number = 1;
    while (tracks.some((track) => track.name === `Track ${number}`)) number++;
    const next = emptyTrack(`Track ${number}`);
    activateTrack([...tracks, next], next);
    if (tracks.some((track) => track.audio)) dirty.current = true;
  };

  const removeTrack = (id: string) => {
    if (!canChangeTracks() || tracks.length <= 1) return;
    const remaining = tracks.filter((track) => track.id !== id);
    if (remaining.length === tracks.length) return;
    stopPlayback();
    if (id === activeTrackId) {
      activateTrack(remaining, remaining[0]);
    } else setTrackRows((rows) => rows.filter((track) => track.id !== id));
    editRevision.current++;
    dirty.current = remaining.some((track) => track.audio);
    if (!dirty.current) setCurrentId(null);
  };

  const updateTrack: Studio["updateTrack"] = (id, patch) => {
    if (!canChangeTracks()) return;
    const { offset, volume, name } = patch;
    if (
      (offset !== undefined &&
        (!Number.isFinite(offset) ||
          offset < 0 ||
          offset > MAX_TRACK_OFFSET)) ||
      (volume !== undefined &&
        (!Number.isFinite(volume) || volume < 0 || volume > 1)) ||
      (name !== undefined && name.length > 60)
    )
      return;
    if (mixPlaying) stopPlayback();
    setTrackRows((rows) =>
      rows.map((track) => (track.id === id ? { ...track, ...patch } : track)),
    );
    if (tracks.some((track) => track.audio)) dirty.current = true;
    editRevision.current++;
  };

  const clearRecording = () => {
    if (!audio || !canChangeTracks()) return;
    showTrack(null, { ...settingsRef.current, trimStart: 0, trimEnd: 0 });
    dirty.current = tracks.some(
      (track) => track.id !== activeTrackId && track.audio,
    );
    if (!dirty.current) setCurrentId(null);
    setNotice("The selected track is now empty.");
  };

  const canReplace = () =>
    !dirty.current ||
    !audio ||
    window.confirm(
      "Keep this take? Save or export it first, or choose OK to replace this unsaved take.",
    );

  const importFile = async (file: File) => {
    if (!canChangeTracks() || !canReplace()) return;
    const generation = ++sessionGeneration.current;
    try {
      if (file.size > 100 * 1024 * 1024)
        throw new Error(
          "Choose an audio file smaller than 100 MB and shorter than 10 minutes.",
        );
      setProcessing(true);
      setError(null);
      const ctx = await getContext();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      if (!mounted.current || generation !== sessionGeneration.current) return;
      const limit = trackSourceLimit();
      if (limit < MAX_SECONDS && buffer.duration > limit)
        throw new Error(projectLimitMessage);
      loadAudio(
        bufferToAudio(buffer),
        file.name.replace(/\.[^.]+$/, ""),
        audio ? undefined : settingsRef.current,
      );
      setNotice("Audio imported. Choose an effect to make it yours.");
    } catch (e) {
      if (!mounted.current || generation !== sessionGeneration.current) return;
      setProcessing(false);
      setError(
        e instanceof DOMException
          ? "This file could not be read. Try WAV, MP3, OGG, or WebM audio."
          : message(e),
      );
    }
  };

  const loadDemo = async () => {
    if (!canChangeTracks() || !canReplace()) return;
    const demo = makeDemo();
    if (demo.samples.length / demo.sampleRate > trackSourceLimit()) {
      setError(projectLimitMessage);
      return;
    }
    loadAudio(demo, "Sound demo");
    setNotice(
      "Synthesized vowel melody loaded. Record your voice for the real thing.",
    );
  };

  const startRecording = async () => {
    if (
      acquiring.current ||
      (recorder.current && recorder.current.state !== "inactive") ||
      exportBusy.current ||
      mixWorker.current ||
      saving.current ||
      processing ||
      !canReplace()
    )
      return;
    captureMax.current = Math.floor(trackSourceLimit() * 48000) / 48000;
    if (captureMax.current < 1) {
      setError(projectLimitMessage);
      return;
    }
    acquiring.current = true;
    setError(null);
    const generation = ++sessionGeneration.current;
    try {
      stopPlayback();
      monitorBuffer.current = null;
      const backing = monitorOtherTracks ? mixInputs(activeTrackId) : [];
      if (backing.length) {
        const output = await renderMix(backing);
        const ctx = await getContext();
        if (!mounted.current || generation !== sessionGeneration.current)
          return;
        const buffer = ctx.createBuffer(
          1,
          output.samples.length,
          output.sampleRate,
        );
        buffer.copyToChannel(new Float32Array(output.samples), 0);
        monitorBuffer.current = buffer;
        monitorOffset.current =
          tracks.find((track) => track.id === activeTrackId)?.offset ?? 0;
      }
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Microphone access is unavailable. Open the Windows app or localhost preview.",
        );
      // getUserMedia is requested only after the user's Record action.
      const audioConstraints = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      };
      const sameLabel = devices.filter(
        (device) =>
          device.label &&
          device.label === preferences.microphoneLabel &&
          device.deviceId !== "default" &&
          device.deviceId !== "communications",
      );
      const requested =
        deviceId &&
        deviceId === preferences.microphoneId &&
        !devices.some((device) => device.deviceId === deviceId) &&
        sameLabel.length === 1
          ? sameLabel[0].deviceId
          : deviceId;
      let media: MediaStream;
      let usedFallback = false;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: requested
            ? { ...audioConstraints, deviceId: { exact: requested } }
            : audioConstraints,
        });
      } catch (error) {
        if (
          !requested ||
          !(error instanceof DOMException) ||
          !["NotFoundError", "OverconstrainedError"].includes(error.name)
        )
          throw error;
        if (!mounted.current || generation !== sessionGeneration.current)
          return;
        media = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        usedFallback = true;
      }
      if (!mounted.current || generation !== sessionGeneration.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      if (usedFallback)
        setNotice(
          "The selected microphone is unavailable. Recording with the system default.",
        );
      const ctx = await getContext();
      if (!mounted.current || generation !== sessionGeneration.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stopPlayback();
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(
        media,
        mime ? { mimeType: mime, audioBitsPerSecond: 192000 } : undefined,
      );
      recorder.current = capture;
      const chunks: Blob[] = [];
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      capture.onerror = () => {
        setError(
          "Recording was interrupted. Check your microphone and try again.",
        );
        if (capture.state !== "inactive") capture.stop();
      };
      const mic = ctx.createMediaStreamSource(media);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      mic.connect(analyser);
      capture.onstop = async () => {
        stopMonitor();
        monitorBuffer.current = null;
        clearTimeout(captureLimitTimer.current);
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
        cancelAnimationFrame(meterFrame.current);
        mic.disconnect();
        analyser.disconnect();
        if (!mounted.current || generation !== sessionGeneration.current)
          return;
        setRecordingState("idle");
        setInputLevel(0);
        setInputWaveform(Array(80).fill(0));
        setProcessing(true);
        try {
          const decoded = await ctx.decodeAudioData(
            await new Blob(chunks, { type: capture.mimeType }).arrayBuffer(),
          );
          if (!mounted.current || generation !== sessionGeneration.current)
            return;
          // MediaRecorder's final encoded block can slightly exceed the stop deadline.
          const next = bufferToAudio(decoded, captureMax.current);
          loadAudio(
            next,
            `Recording ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
            { ...settingsRef.current, trimStart: 0, trimEnd: 0 },
          );
          setNotice("Take captured. Preview an effect, then save or export.");
        } catch {
          if (!mounted.current || generation !== sessionGeneration.current)
            return;
          setError(
            "No usable audio was captured. Record for at least a second and try again.",
          );
          setProcessing(false);
        }
      };
      const data = new Float32Array(analyser.fftSize);
      let lastMeter = 0;
      const meter = (now: number) => {
        if (capture.state === "inactive") return;
        if (now - lastMeter > 65) {
          const elapsed =
            captureElapsed.current +
            (capture.state === "recording"
              ? (performance.now() - captureStarted.current) / 1000
              : 0);
          setRecordingSeconds(elapsed);
          if (elapsed >= captureMax.current) {
            capture.stop();
            setNotice("The recording limit was reached. Your take is ready.");
            return;
          }
          if (capture.state === "recording") {
            analyser.getFloatTimeDomainData(data);
            const rms = Math.sqrt(
              data.reduce((total, sample) => total + sample * sample, 0) /
                data.length,
            );
            setInputLevel(Math.min(1, rms * 5));
            setInputWaveform(waveformPeaks(data, 80));
          } else {
            setInputLevel(0);
          }
          lastMeter = now;
        }
        meterFrame.current = requestAnimationFrame(meter);
      };
      captureElapsed.current = 0;
      captureStarted.current = performance.now();
      setRecordingSeconds(0);
      setRecordingState("recording");
      capture.start(250);
      startMonitor(ctx);
      scheduleCaptureLimit();
      dirty.current = true;
      meterFrame.current = requestAnimationFrame(meter);
      void refreshDevices();
    } catch (e) {
      stopMonitor();
      monitorBuffer.current = null;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      if (!mounted.current || generation !== sessionGeneration.current) return;
      const code = e instanceof DOMException ? e.name : "";
      setError(
        code === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access for VoiceForge in Windows Settings → Privacy & security → Microphone."
          : code === "NotFoundError" || code === "OverconstrainedError"
            ? "That microphone is unavailable. Connect a microphone or choose another input."
            : code === "NotReadableError"
              ? "Your microphone is busy. Close other recording apps and try again."
              : message(e),
      );
    } finally {
      acquiring.current = false;
    }
  };

  const scheduleCaptureLimit = () => {
    clearTimeout(captureLimitTimer.current);
    const elapsed =
      captureElapsed.current +
      (performance.now() - captureStarted.current) / 1000;
    captureLimitTimer.current = window.setTimeout(
      () => {
        if (recorder.current?.state === "recording") {
          recorder.current.stop();
          setNotice("The recording limit was reached. Your take is ready.");
        }
      },
      Math.max(0, captureMax.current - elapsed) * 1000,
    );
  };
  const pauseRecording = () => {
    const capture = recorder.current;
    if (capture?.state === "recording") {
      captureElapsed.current +=
        (performance.now() - captureStarted.current) / 1000;
      capture.pause();
      stopMonitor();
      clearTimeout(captureLimitTimer.current);
      setRecordingState("paused");
    } else if (capture?.state === "paused") {
      captureStarted.current = performance.now();
      capture.resume();
      if (context.current) startMonitor(context.current);
      scheduleCaptureLimit();
      setRecordingState("recording");
    }
  };
  const stopRecording = () => {
    if (recorder.current && recorder.current.state !== "inactive")
      recorder.current.stop();
  };

  const startPlaybackAt = async (offset: number) => {
    const next = originalPreview ? audio : processedRef.current;
    if (!next || processing || mixWorker.current || recordingState !== "idle")
      return;
    previewAfterRender.current = false;
    await playAudioBuffer(next, offset);
  };

  const togglePlayback = async () => {
    try {
      if (playing) stopPlayback();
      else await startPlaybackAt(playhead);
    } catch (e) {
      setError(message(e));
    }
  };
  const seek = (seconds: number) => {
    const at = Math.max(0, seconds);
    setPlayhead(at);
    if (mixPlaying) stopPlayback();
    else if (playing)
      void startPlaybackAt(at).catch((e) => setError(message(e)));
  };

  const mixInputs = (except?: string): MixTrack[] =>
    tracks.flatMap(({ id, audio, settings, offset, volume, muted }) =>
      id !== except && audio && !muted
        ? [{ audio, settings, offset, volume, muted }]
        : [],
    );

  const renderMix = async (inputs: MixTrack[]) => {
    const task = worker();
    mixWorker.current = task;
    setMixing(true);
    try {
      const { audio: output } = await runAudioTask(task, {
        operation: "mix",
        tracks: inputs,
      });
      if (!output) throw new Error("The mix could not be rendered.");
      return output;
    } finally {
      task.terminate();
      mixWorker.current = null;
      if (mounted.current) setMixing(false);
    }
  };

  const playMix = async () => {
    if (!canChangeTracks()) return;
    stopPlayback();
    if (mixPlaying) return;
    const playback = playbackGeneration.current;
    setError(null);
    try {
      const [, output] = await Promise.all([
        getContext(),
        renderMix(mixInputs()),
      ]);
      if (mounted.current && playbackGeneration.current === playback)
        await playAudioBuffer(output, 0, true);
    } catch (e) {
      if (mounted.current) setError(message(e));
    }
  };

  const saveRecording = async () => {
    const primary =
      tracks.find((track) => track.id === activeTrackId && track.audio) ??
      tracks.find((track) => track.audio);
    if (!primary?.audio || !canChangeTracks() || saving.current) return;
    saving.current = true;
    try {
      const generation = sessionGeneration.current;
      const revision = editRevision.current;
      const id = currentId || crypto.randomUUID();
      const existing = recordings.find((take) => take.id === id);
      const take: SavedRecording = {
        id,
        name: name.trim().slice(0, 120) || "Untitled recording",
        createdAt: existing?.createdAt ?? Date.now(),
        duration: Math.max(
          ...tracks.map((track) =>
            track.audio
              ? track.offset +
                track.audio.samples.length / track.audio.sampleRate
              : 0,
          ),
        ),
        audio: primary.audio,
        settings: primary.settings,
        tracks,
        activeTrackId,
      };
      await putRecording(take);
      if (!mounted.current) return;
      const {
        id: savedId,
        name: savedName,
        createdAt,
        duration,
        settings,
      } = take;
      const summary = {
        id: savedId,
        name: savedName,
        createdAt,
        duration,
        settings,
        trackCount: tracks.length,
      };
      setRecordings((rows) =>
        [...rows.filter((row) => row.id !== savedId), summary].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      );
      if (sessionGeneration.current === generation) {
        setCurrentId(id);
        if (editRevision.current === revision) dirty.current = false;
      }
      setNotice("Recording saved on this computer.");
    } catch (e) {
      setError(message(e));
    } finally {
      saving.current = false;
    }
  };

  const exportAudio = async (
    format: "wav" | "mp3",
    bitrate = 192,
    scope: "track" | "mix" = "track",
    fast = false,
  ) => {
    if (
      (scope === "track" && !processed) ||
      processing ||
      exportBusy.current ||
      mixWorker.current ||
      acquiring.current ||
      recordingState !== "idle"
    )
      return;
    exportBusy.current = true;
    setExporting(true);
    setError(null);
    try {
      const task = worker();
      encodingWorker.current = task;
      // An audition is never committed to an export: render the applied stack instead.
      const outputAudio =
        scope === "mix"
          ? (
              await runAudioTask(task, {
                operation: "mix",
                tracks: mixInputs(),
              })
            ).audio
          : previewPresetRef.current
            ? (
                await runAudioTask(task, {
                  operation: "render",
                  audio: audio!,
                  settings: settingsRef.current,
                })
              ).audio
            : processed;
      if (!outputAudio)
        throw new Error("The applied effect stack could not be rendered.");
      const data = (
        await runAudioTask(task, {
          operation: format,
          audio: outputAudio,
          bitrate,
        })
      ).data;
      if (!data) throw new Error("No audio was encoded. Please try again.");
      task.terminate();
      const trackName = tracks.find(
        (track) => track.id === activeTrackId,
      )?.name;
      const filename = safeFilename(
        scope === "track" && tracks.length > 1
          ? `${name} - ${trackName || "Track"}`
          : name,
        format,
      );
      if (window.voiceforge) {
        const result = await window.voiceforge.saveAudio({
          name: filename,
          format,
          data,
          fast,
        });
        if (result.canceled) {
          setNotice("Export canceled. Your take is still here.");
          return;
        }
        setNotice(`Exported ${fast ? (result.path ?? filename) : filename}`);
      } else {
        const url = URL.createObjectURL(
          new Blob([data], {
            type: format === "wav" ? "audio/wav" : "audio/mpeg",
          }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10000);
        setNotice(`Exported ${filename}`);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      encodingWorker.current?.terminate();
      exportBusy.current = false;
      setExporting(false);
    }
  };

  const loadRecording = async (id: string) => {
    if (!canChangeTracks() || !canReplaceProject()) return false;
    const generation = ++sessionGeneration.current;
    stopPlayback();
    setProcessing(true);
    try {
      const take = await getRecording(id);
      if (!mounted.current || generation !== sessionGeneration.current)
        return false;
      if (!take)
        throw new Error("This saved project is no longer in the library.");
      const rows = take.tracks?.length
        ? take.tracks
        : [
            {
              ...emptyTrack("Track 1"),
              audio: take.audio,
              settings: take.settings,
            },
          ];
      const active =
        rows.find((track) => track.id === take.activeTrackId) ?? rows[0];
      for (const track of rows) getEffectChain(track.settings);
      activateTrack(rows, active);
      setName(take.name);
      setCurrentId(take.id);
      dirty.current = false;
      setNotice("Saved recording opened.");
      return true;
    } catch (e) {
      if (mounted.current && generation === sessionGeneration.current) {
        setError(message(e));
        setProcessing(false);
      }
      return false;
    }
  };
  const deleteRecording = async (id: string) => {
    const generation = sessionGeneration.current;
    try {
      await removeRecording(id);
      setRecordings((rows) => rows.filter((row) => row.id !== id));
      if (id === currentId && sessionGeneration.current === generation) {
        setCurrentId(null);
        dirty.current = true;
      }
      setNotice("Saved recording deleted.");
    } catch (e) {
      setError(message(e));
    }
  };
  const canReplaceProject = () =>
    !dirty.current ||
    !tracks.some((track) => track.audio) ||
    window.confirm(
      "Keep this project? Save it first, or choose OK to replace this unsaved project.",
    );
  const newRecording = () => {
    if (!canChangeTracks() || !canReplaceProject()) return;
    const next = emptyTrack("Track 1");
    activateTrack([next], next);
    setName("Untitled recording");
    setCurrentId(null);
    setPlayhead(0);
    setError(null);
    setNotice(null);
    dirty.current = false;
  };

  const waveform = useMemo(
    () =>
      waveformPeaks(
        (originalPreview ? audio : (processed ?? audio))?.samples ??
          new Float32Array(),
      ),
    [originalPreview, audio, processed],
  );
  const effectChain = useMemo(() => getEffectChain(settings), [settings]);
  const selectedEffect = effectChain.find(
    (effect) => effect.id === selectedEffectId,
  );
  const detectMicrophones = async () => {
    if (acquiring.current || recordingState !== "idle") return;
    acquiring.current = true;
    let input: MediaStream | undefined;
    try {
      input = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (mounted.current) await refreshDevices();
    } finally {
      input?.getTracks().forEach((track) => track.stop());
      acquiring.current = false;
    }
  };
  const savePreferences = async (patch: PreferencePatch) => {
    const saved = await window.voiceforge!.savePreferences(patch);
    setPreferences(saved);
    if (patch.microphoneId !== undefined) setDeviceId(saved.microphoneId);
  };
  return {
    name,
    setName: (value) => {
      setName(value.slice(0, 120));
      if (tracks.some((track) => track.audio)) dirty.current = true;
      editRevision.current++;
    },
    recordingState,
    recordingSeconds,
    startRecording,
    pauseRecording,
    stopRecording,
    inputLevel,
    inputWaveform,
    devices,
    deviceId,
    setDeviceId,
    refreshDevices,
    detectMicrophones,
    preferences,
    savePreferences,
    chooseExportFolder: async () =>
      setPreferences(await window.voiceforge!.chooseExportFolder()),
    audio,
    waveform,
    duration: originalPreview
      ? audio
        ? audio.samples.length / audio.sampleRate
        : 0
      : processed
        ? processed.samples.length / processed.sampleRate
        : audio
          ? audio.samples.length / audio.sampleRate
          : 0,
    settings: {
      ...settings,
      presetId: selectedEffect?.presetId ?? "original",
      intensity: selectedEffect?.intensity ?? 1,
    },
    updateSettings,
    effectChain,
    selectedEffectId,
    addEffect,
    previewEffect,
    previewPresetId,
    clearEffectPreview,
    selectEffect,
    removeEffect,
    toggleEffect,
    moveEffect,
    resetSettings,
    stackPresets,
    saveStackPreset,
    applyStackPreset,
    deleteStackPreset,
    tracks,
    activeTrackId,
    selectTrack,
    addTrack,
    removeTrack,
    updateTrack,
    clearRecording,
    mixPlaying,
    mixing,
    playMix,
    monitorOtherTracks,
    setMonitorOtherTracks,
    processing,
    playing,
    playhead,
    originalPreview,
    setOriginalPreview: (value) => {
      stopPlayback();
      if (previewPresetRef.current) {
        cancelAudition();
        processedRef.current = null;
        if (audio) setProcessing(true);
      }
      setPlayhead(0);
      setOriginalPreview(value);
    },
    togglePlayback,
    stopPlayback,
    seek,
    importFile,
    loadDemo,
    exportAudio,
    fastExport: () =>
      exportAudio(
        preferences.exportFormat,
        preferences.exportBitrate,
        tracks.length > 1 || !audio ? "mix" : "track",
        true,
      ),
    exporting,
    recordings,
    saveRecording,
    loadRecording,
    deleteRecording,
    newRecording,
    error,
    notice,
    dismissMessage: () => {
      setError(null);
      setNotice(null);
    },
  };
}
