import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FolderOpen,
  Headphones,
  Heart,
  Info,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Music2,
  Pause,
  Play,
  Power,
  Plus,
  Radio,
  RefreshCcw,
  RotateCcw,
  Save,
  Scissors,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  WandSparkles,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { useStudio } from "./useStudio";
import { PRESETS, CATEGORIES } from "./audio/presets";
import type { EffectPreset, StudioSettings } from "./audio/types";
import type { Studio } from "./studio-types";
import { TrimOverlay } from "./components/TrimOverlay";
import { waveformPeaks } from "./audio/utils";
import { MAX_TRACK_OFFSET, MAX_TRACKS } from "./audio/mix";
import { resizeTrim, type TrimRange } from "./trim";

const formatTime = (seconds: number, decimals = false) => {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const rest = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${rest}${decimals ? `.${Math.floor((safe % 1) * 10)}` : ""}`;
};

function effectSummary(settings: StudioSettings): string {
  if (settings.effectChain) {
    const names = settings.effectChain
      .filter((effect) => effect.enabled)
      .map(
        (effect) =>
          PRESETS.find((preset) => preset.id === effect.presetId)?.name,
      )
      .filter(Boolean);
    if (names.length) return names.join(" + ");
    return settings.pitch || settings.reverb || settings.echo
      ? "Custom mix"
      : "Original";
  }
  return (
    PRESETS.find((preset) => preset.id === settings.presetId)?.name ||
    "Original"
  );
}

function PresetIcon({
  preset,
  size = 21,
}: {
  preset: EffectPreset;
  size?: number;
}) {
  const name = `${preset.id} ${preset.icon}`.toLowerCase();
  if (/original|clean|studio|broadcast|narrat|podcast/.test(name))
    return <Mic size={size} />;
  if (/tune|harmon|choir|sing|octave|melod|vibrato/.test(name))
    return <Music2 size={size} />;
  if (/robot|cyber|alien|android|space|bit|digital/.test(name))
    return <Activity size={size} />;
  if (/radio|phone|telephone|walkie/.test(name)) return <Radio size={size} />;
  if (/reverb|hall|room|cave|cathedral|echo|dream|underwater/.test(name))
    return <Waves size={size} />;
  if (/demon|monster|giant|beast|dragon|orc|villain/.test(name))
    return <WandSparkles size={size} />;
  if (preset.category === "Characters") return <Sparkles size={size} />;
  return <AudioLines size={size} />;
}

function Modal({
  title,
  eyebrow,
  children,
  onClose,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first =
      panel.current?.querySelector<HTMLElement>("[data-initial-focus]") ??
      panel.current?.querySelector<HTMLElement>("button, input, select");
    first?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ];
      const firstItem = items[0];
      const lastItem = items.at(-1);
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem?.focus();
      }
      if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, []);
  // Render dialogs outside the scrollable inspector. https://react.dev/reference/react-dom/createPortal#rendering-a-modal-dialog-with-a-portal
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        ref={panel}
      >
        <div className="modal-heading">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function RangeControl({
  label,
  value,
  min,
  max,
  step = 0.01,
  display,
  onChange,
  disabled,
  ariaLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <label className="range-control">
      <span className="range-heading">
        <span>{label}</span>
        <output>{display}</output>
      </span>
      <input
        type="range"
        aria-label={ariaLabel || label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        style={
          {
            "--range-fill": `${((value - min) / (max - min)) * 100}%`,
          } as CSSProperties
        }
      />
    </label>
  );
}

function Waveform({
  studio,
  trimOpen,
  trimRange,
  onDraft,
  onCommit,
}: {
  studio: Studio;
  trimOpen: boolean;
  trimRange: TrimRange;
  onDraft: (range: TrimRange | null) => void;
  onCommit: (range: TrimRange) => void;
}) {
  const live = studio.recordingState !== "idle";
  const sourceWaveform = useMemo(
    () => (trimOpen && studio.audio ? waveformPeaks(studio.audio.samples) : []),
    [trimOpen, studio.audio],
  );
  const values = live
    ? studio.inputWaveform
    : trimOpen
      ? sourceWaveform
      : studio.waveform;
  const duration =
    trimOpen && studio.audio
      ? studio.audio.samples.length / studio.audio.sampleRate
      : studio.duration;
  const count = 140;
  const bars = Array.from({ length: count }, (_, index) => {
    if (!values.length) return 3;
    const point = values[Math.floor((index / count) * values.length)] ?? 0;
    return Math.max(3, Math.min(88, Math.abs(point) * 100));
  });
  const end = trimOpen ? trimRange.end : studio.settings.trimEnd || duration;
  const timelinePlayhead =
    trimOpen && !studio.originalPreview && studio.duration
      ? trimRange.start +
        (studio.playhead / studio.duration) * (trimRange.end - trimRange.start)
      : studio.playhead;
  const position = duration
    ? Math.min(100, (timelinePlayhead / duration) * 100)
    : 0;
  return (
    <div
      className={`waveform ${trimOpen ? "is-trimming" : ""} ${live ? "is-live" : ""} ${!studio.audio && !live ? "is-empty" : ""}`}
    >
      <div className="waveform-grid" />
      <div className="wave-bars" aria-hidden="true">
        {bars.map((height, index) => {
          const seconds = (index / count) * duration;
          const outside =
            studio.audio &&
            (studio.originalPreview || trimOpen) &&
            (seconds <
              (trimOpen ? trimRange.start : studio.settings.trimStart) ||
              seconds > end);
          return (
            <i
              key={index}
              className={outside ? "trimmed" : ""}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
      {studio.audio && (
        <div className="playhead-line" style={{ left: `${position}%` }}>
          <span />
        </div>
      )}
      {!studio.audio && !live && (
        <div className="waveform-empty">
          <AudioLines size={24} />
          <span>Your next great take starts here</span>
          <small>Record your voice or drop in an audio file</small>
        </div>
      )}
      {live && (
        <div className="live-label">
          <span className="status-dot" />
          {studio.recordingState === "paused"
            ? "RECORDING PAUSED"
            : "CAPTURING YOUR VOICE"}
        </div>
      )}
      {studio.audio && !trimOpen && (
        <input
          className="waveform-seek"
          type="range"
          min={0}
          max={Math.max(0.01, studio.duration)}
          step={0.01}
          value={Math.min(studio.playhead, studio.duration)}
          aria-label="Seek audio"
          onChange={(event) => studio.seek(Number(event.target.value))}
        />
      )}
      {studio.audio && trimOpen && !live && (
        <TrimOverlay
          duration={duration}
          range={trimRange}
          onDraft={onDraft}
          onCommit={onCommit}
        />
      )}
    </div>
  );
}

function MicrophoneOptions({
  studio,
  selected,
}: {
  studio: Studio;
  selected: string;
}) {
  const inputs = studio.devices.filter(
    (device) =>
      device.deviceId &&
      device.deviceId !== "default" &&
      device.deviceId !== "communications",
  );
  return (
    <>
      <option value="">System default microphone</option>
      {selected && !inputs.some((device) => device.deviceId === selected) && (
        <option value={selected}>
          {studio.preferences.microphoneLabel || "Saved microphone"} (saved)
        </option>
      )}
      {inputs.map((device, index) => (
        <option key={device.deviceId} value={device.deviceId}>
          {device.label || `Microphone ${index + 1}`}
        </option>
      ))}
    </>
  );
}

function Recorder({
  studio,
  onImport,
}: {
  studio: Studio;
  onImport: () => void;
}) {
  const recording = studio.recordingState !== "idle";
  const busy = studio.processing || studio.exporting || studio.mixing;
  const sourceDuration = studio.audio
    ? studio.audio.samples.length / studio.audio.sampleRate
    : 0;
  const [trimOpen, setTrimOpen] = useState(false);
  const [trimDraft, setTrimDraft] = useState<TrimRange | null>(null);
  const trimRange = trimDraft ?? {
    start: studio.settings.trimStart,
    end: studio.settings.trimEnd || sourceDuration,
  };
  const commitTrim = (range: TrimRange) =>
    studio.updateSettings({ trimStart: range.start, trimEnd: range.end });
  const timelineDuration = trimOpen ? sourceDuration : studio.duration;
  useEffect(() => {
    setTrimDraft(null);
  }, [studio.audio]);
  useEffect(() => {
    setTrimOpen(false);
  }, [studio.activeTrackId]);
  return (
    <section className="recorder-panel" aria-label="Voice recorder">
      {studio.previewPresetId && (
        <div className="effect-preview-banner" role="status">
          <Headphones size={15} />
          <div>
            <strong>
              Previewing{" "}
              {PRESETS.find((preset) => preset.id === studio.previewPresetId)
                ?.name || "effect"}
            </strong>
            <span>Not added to stack</span>
          </div>
          <button className="text-button" onClick={studio.clearEffectPreview}>
            Back to stack <ArrowRight size={12} />
          </button>
        </div>
      )}
      <div className="recorder-heading">
        <div className="panel-title">
          <span className="tiny-orange-dot" />
          VOICE RECORDER
        </div>
        <div className="capture-quality">
          <span />
          {studio.audio
            ? `${(studio.audio.sampleRate / 1000).toFixed(1)} kHz`
            : "48 kHz"}
          <b>MONO</b>
        </div>
      </div>
      <div className="recorder-display">
        <div className="display-top">
          <div className={`recording-status ${recording ? "active" : ""}`}>
            <span />
            {studio.recordingState === "recording"
              ? "Recording"
              : studio.recordingState === "paused"
                ? "Paused"
                : studio.audio
                  ? "Ready to play"
                  : "Ready when you are"}
          </div>
          <div className="time-display">
            {formatTime(
              recording ? studio.recordingSeconds : studio.playhead,
              true,
            )}
            <span>
              {" "}
              /{" "}
              {formatTime(
                recording ? studio.recordingSeconds : timelineDuration,
                true,
              )}
            </span>
          </div>
        </div>
        <Waveform
          studio={studio}
          trimOpen={trimOpen}
          trimRange={trimRange}
          onDraft={setTrimDraft}
          onCommit={commitTrim}
        />
        <div className="timeline" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <span key={index}>
              {formatTime(
                ((recording
                  ? Math.max(30, studio.recordingSeconds)
                  : timelineDuration || 30) /
                  4) *
                  index,
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="transport">
        <div className="transport-left">
          <button
            className={`record-button ${recording ? "recording" : ""}`}
            disabled={busy || recording}
            onClick={() => {
              void studio.startRecording();
            }}
            title="Start recording"
          >
            <span className="record-disc" />
            <span>{recording ? "Recording" : "Record"}</span>
          </button>
          {recording ? (
            <>
              <button
                className="transport-button"
                title={
                  studio.recordingState === "paused"
                    ? "Resume recording"
                    : "Pause recording"
                }
                onClick={studio.pauseRecording}
              >
                {studio.recordingState === "paused" ? (
                  <Play size={18} fill="currentColor" />
                ) : (
                  <Pause size={18} fill="currentColor" />
                )}
              </button>
              <button
                className="transport-button stop-button"
                title="Stop recording"
                onClick={studio.stopRecording}
              >
                <Square size={16} fill="currentColor" />
              </button>
            </>
          ) : (
            <>
              <button
                className="transport-button"
                aria-label={studio.playing ? "Pause playback" : "Play audio"}
                disabled={!studio.audio || busy}
                onClick={() => {
                  void studio.togglePlayback();
                }}
              >
                {studio.playing ? (
                  <Pause size={18} fill="currentColor" />
                ) : (
                  <Play size={18} fill="currentColor" />
                )}
              </button>
              <button
                className="transport-button"
                aria-label="Stop playback"
                disabled={!studio.audio || studio.exporting}
                onClick={studio.stopPlayback}
              >
                <Square size={15} fill="currentColor" />
              </button>
            </>
          )}
          <div className="transport-divider" />
          <button
            className={`icon-button ${trimOpen ? "selected" : ""}`}
            aria-label="Trim recording"
            title="Trim recording"
            disabled={!studio.audio || recording || studio.exporting}
            onClick={() => {
              setTrimDraft(null);
              setTrimOpen(!trimOpen);
            }}
          >
            <Scissors size={17} />
          </button>
        </div>
        <div className="ab-control" role="group" aria-label="Preview version">
          <button
            className={studio.originalPreview ? "active" : ""}
            disabled={!studio.audio || recording}
            onClick={() => studio.setOriginalPreview(true)}
          >
            Original
          </button>
          <button
            className={!studio.originalPreview ? "active" : ""}
            disabled={!studio.audio || recording}
            onClick={() => studio.setOriginalPreview(false)}
          >
            <Sparkles size={12} />
            With effects
          </button>
        </div>
      </div>
      {trimOpen && studio.audio && (
        <div className="trim-controls">
          <div className="trim-heading">
            <span>
              <Scissors size={14} />
              Drag edges to trim · drag middle to move
            </span>
            <button
              className="text-button"
              onClick={() => {
                setTrimDraft(null);
                studio.updateSettings({ trimStart: 0, trimEnd: 0 });
              }}
            >
              Reset trim
            </button>
          </div>
          <label>
            Start{" "}
            <input
              type="number"
              aria-label="Trim start seconds"
              min={0}
              max={Math.max(0, trimRange.end - 0.01)}
              step={0.01}
              value={Number(trimRange.start.toFixed(2))}
              onChange={(event) =>
                commitTrim(
                  resizeTrim(
                    trimRange,
                    "start",
                    Number(event.target.value),
                    sourceDuration,
                  ),
                )
              }
            />
            <span>sec</span>
          </label>
          <label>
            End{" "}
            <input
              type="number"
              aria-label="Trim end seconds"
              min={Math.min(sourceDuration, trimRange.start + 0.01)}
              max={sourceDuration}
              step={0.01}
              value={Number(trimRange.end.toFixed(2))}
              onChange={(event) =>
                commitTrim(
                  resizeTrim(
                    trimRange,
                    "end",
                    Number(event.target.value),
                    sourceDuration,
                  ),
                )
              }
            />
            <span>sec</span>
          </label>
          <p>
            {(trimRange.end - trimRange.start).toFixed(2)}s selected · source
            timeline
          </p>
        </div>
      )}
      <div className="input-strip">
        <div className="input-device">
          <Mic size={14} />
          <select
            aria-label="Microphone"
            disabled={recording}
            value={studio.deviceId}
            onChange={(event) => studio.setDeviceId(event.target.value)}
          >
            <MicrophoneOptions studio={studio} selected={studio.deviceId} />
          </select>
          <button
            className="icon-button tiny"
            aria-label="Refresh microphones"
            disabled={recording}
            onClick={() => {
              void studio.refreshDevices();
            }}
          >
            <RefreshCcw size={12} />
          </button>
        </div>
        <div
          className="input-meter"
          aria-label={`Input level ${Math.round(studio.inputLevel * 100)} percent`}
        >
          {Array.from({ length: 18 }, (_, index) => (
            <i
              key={index}
              className={
                studio.inputLevel * 18 > index
                  ? index > 14
                    ? "hot"
                    : "lit"
                  : ""
              }
            />
          ))}
          <span>INPUT</span>
        </div>
      </div>
      {!studio.audio && !recording && (
        <div className="recorder-helper">
          <span>One click. Endless possibilities.</span>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => {
              void studio.loadDemo();
            }}
          >
            Try a sound demo <ArrowRight size={13} />
          </button>
          <button className="mobile-import text-button" onClick={onImport}>
            Import audio
          </button>
        </div>
      )}
    </section>
  );
}

function RecorderDock({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const target = anchor.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 74),
      { rootMargin: "-74px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <div className="recorder-dock-anchor" ref={anchor} aria-hidden="true" />
      <div className={`recorder-dock ${stuck ? "is-stuck" : ""}`}>
        {children}
      </div>
    </>
  );
}

function EffectsBrowser({
  studio,
  effectsRef,
}: {
  studio: Studio;
  effectsRef: RefObject<HTMLElement | null>;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All effects");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("voiceforge-favorites") || "[]",
      );
      return Array.isArray(saved)
        ? saved.filter((item) => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  });
  const visible = useMemo(
    () =>
      PRESETS.filter((preset) => {
        const categoryMatch =
          category === "All effects" ||
          (category === "Favorites"
            ? favorites.includes(preset.id)
            : category === preset.category);
        return (
          categoryMatch &&
          `${preset.name} ${preset.description} ${preset.tags.join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase())
        );
      }),
    [category, query, favorites],
  );
  const toggleFavorite = (id: string) => {
    const next = favorites.includes(id)
      ? favorites.filter((item) => item !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem("voiceforge-favorites", JSON.stringify(next));
    } catch {
      /* Favorites remain usable for this session if storage is full. */
    }
  };
  const disabled =
    studio.recordingState !== "idle" || studio.exporting || studio.mixing;
  return (
    <section
      className="effects-section"
      ref={effectsRef}
      aria-label="Voice effects"
    >
      <div className="section-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h2>
            A voice for every idea
            <span className="count-pill">{PRESETS.length} effects</span>
          </h2>
          <p>
            Click any effect to preview. Add to stack only when you want to keep
            it.
          </p>
        </div>
        <div className="effects-art" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="effects-toolbar">
        <div className="effect-tabs" role="group" aria-label="Effect category">
          {["All effects", ...CATEGORIES, "Favorites"].map((item) => (
            <button
              key={item}
              aria-label={item}
              title={item}
              className={category === item ? "active" : ""}
              onClick={() => setCategory(item)}
            >
              {item === "Favorites" ? <Heart size={14} /> : item}
            </button>
          ))}
        </div>
        <label className="effect-search">
          <Search size={15} />
          <input
            type="search"
            placeholder="Find an effect…"
            aria-label="Search effects"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      {category === "Auto-Tune" && (
        <p className="tuning-library-hint">
          Start with Classic hard snap for sharply tuned rap vocals. Choose your
          beat’s key and scale in Sound controls to hear the correction in
          context.
        </p>
      )}
      <div className="effects-grid">
        {visible.map((preset) => {
          const instance = studio.effectChain.find(
            (item) => item.presetId === preset.id,
          );
          const selected = studio.previewPresetId === preset.id;
          return (
            <div
              key={preset.id}
              className={`effect-card ${selected ? "selected" : ""} ${instance ? "in-chain" : ""}`}
              style={{ "--effect-color": preset.color } as CSSProperties}
              onClick={(event) => {
                // Include the card's border and any space outside its native button.
                if (event.target === event.currentTarget) {
                  event.currentTarget
                    .querySelector<HTMLButtonElement>(".effect-main")
                    ?.click();
                }
              }}
            >
              <button
                className="effect-main"
                disabled={disabled}
                onClick={() => studio.previewEffect(preset.id)}
                aria-pressed={selected}
                aria-label={`Preview ${preset.name}`}
                title="Preview this effect without changing your stack"
              >
                <span className="effect-icon">
                  <PresetIcon preset={preset} />
                </span>
                <span className="effect-name">{preset.name}</span>
                <span className="effect-description">{preset.description}</span>
                <span className="effect-footer">
                  <span>{preset.category}</span>
                  {selected || instance ? (
                    <span className="effect-applied">
                      {selected ? (
                        <Headphones size={12} />
                      ) : (
                        <Check size={12} />
                      )}
                      {selected ? "PREVIEW" : "IN STACK"}
                    </span>
                  ) : (
                    <Play size={12} />
                  )}
                </span>
              </button>
              {preset.id !== "original" && (
                <button
                  className={`effect-add-button ${instance ? "is-added" : ""}`}
                  aria-label={`Add ${preset.name} to stack`}
                  disabled={
                    disabled ||
                    Boolean(instance) ||
                    studio.effectChain.length >= 8
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    studio.addEffect(preset.id);
                  }}
                >
                  {instance ? <Check size={12} /> : <Plus size={12} />}
                  {instance ? "Added" : "Add to stack"}
                </button>
              )}
              <button
                className={`favorite-button ${favorites.includes(preset.id) ? "is-favorite" : ""}`}
                aria-label={`${favorites.includes(preset.id) ? "Unfavorite" : "Favorite"} ${preset.name}`}
                aria-pressed={favorites.includes(preset.id)}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFavorite(preset.id);
                }}
              >
                <Heart
                  size={14}
                  fill={favorites.includes(preset.id) ? "currentColor" : "none"}
                />
              </button>
            </div>
          );
        })}
      </div>
      {!visible.length && (
        <div className="effects-empty">
          <Search size={24} />
          <h3>
            {category === "Favorites" && !query
              ? "Keep your favorites close"
              : "No effects found"}
          </h3>
          <p>
            {category === "Favorites" && !query
              ? "Tap the heart on any effect to find it here."
              : "Try another name or choose a different category."}
          </p>
          <button
            className="text-button"
            onClick={() => {
              setQuery("");
              setCategory("All effects");
            }}
          >
            Explore all effects <ArrowRight size={13} />
          </button>
        </div>
      )}
      <div className="effects-bottom">
        <span>
          {visible.length} of {PRESETS.length} effects
        </span>
        <span>
          <Headphones size={13} />
          Headphones make a difference
        </span>
      </div>
    </section>
  );
}

function StackPresetControls({
  studio,
  disabled,
}: {
  studio: Studio;
  disabled: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [dialog, setDialog] = useState<"save" | "delete" | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const preset = studio.stackPresets.find((item) => item.id === selected);
  const open = (action: "save" | "delete") => {
    setError("");
    setName("");
    setDialog(action);
  };
  const submit = async () => {
    setSaving(true);
    setError("");
    try {
      if (dialog === "save") await studio.saveStackPreset(name);
      else {
        await studio.deleteStackPreset(selected);
        setSelected("");
      }
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update presets.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="stack-preset-controls">
      <div className="stack-preset-picker">
        <select
          aria-label="Saved stack preset"
          disabled={disabled || !studio.stackPresets.length}
          value={preset?.id ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">
            {studio.stackPresets.length
              ? "Choose a saved preset"
              : "No saved presets yet"}
          </option>
          {studio.stackPresets.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          className="button subtle small"
          disabled={disabled || !preset}
          onClick={() => studio.applyStackPreset(selected)}
        >
          Apply
        </button>
      </div>
      <div className="stack-preset-actions">
        <button
          className="text-button"
          disabled={disabled || !studio.effectChain.length}
          onClick={() => open("save")}
        >
          Save as preset
        </button>
        {preset && (
          <button
            className="text-button"
            disabled={disabled}
            onClick={() => open("delete")}
          >
            Delete preset
          </button>
        )}
      </div>
      {dialog && (
        <Modal
          title={
            dialog === "save"
              ? "Save effect stack preset"
              : "Delete this stack preset?"
          }
          onClose={() => {
            if (!saving) setDialog(null);
          }}
        >
          <form
            className="stack-preset-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {dialog === "save" ? (
              <label className="bitrate-field">
                Preset name
                <input
                  aria-label="Preset name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  required
                  data-initial-focus
                  disabled={saving}
                />
              </label>
            ) : (
              <p className="modal-intro">
                “{preset?.name}” will be removed from your saved presets. Any
                track already using it keeps its effects.
              </p>
            )}
            {error && (
              <p role="alert" className="preferences-error">
                {error}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="button subtle"
                disabled={saving}
                onClick={() => setDialog(null)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={`button ${dialog === "save" ? "primary" : "danger"}`}
                disabled={saving || (dialog === "save" && !name.trim())}
              >
                {dialog === "save" ? "Save preset" : "Delete preset"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function TrackPanel({
  studio,
  disabled,
}: {
  studio: Studio;
  disabled: boolean;
}) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const target = studio.tracks.find((track) => track.id === removeId);
  const audible = studio.tracks.some((track) => track.audio && !track.muted);
  return (
    <section className="track-panel" aria-label="Project tracks">
      <div className="track-panel-header">
        <div>
          <div className="eyebrow">MULTITRACK</div>
          <h2>
            Project tracks{" "}
            <small>
              {studio.tracks.length}/{MAX_TRACKS}
            </small>
          </h2>
        </div>
        <div className="track-panel-actions">
          <button
            className="button subtle small"
            disabled={disabled || !audible}
            onClick={() => void studio.playMix()}
          >
            {studio.mixing ? (
              <LoaderCircle size={14} className="spinning" />
            ) : studio.mixPlaying ? (
              <Square size={14} />
            ) : (
              <Play size={14} />
            )}
            {studio.mixing
              ? "Preparing mix…"
              : studio.mixPlaying
                ? "Stop mix"
                : "Play mix"}
          </button>
          <button
            className="button soft-orange small"
            disabled={disabled || studio.tracks.length >= MAX_TRACKS}
            onClick={studio.addTrack}
          >
            <Plus size={14} /> Add track
          </button>
        </div>
      </div>
      <p className="track-panel-hint">
        Select a track to record, import, trim or edit its effects.
      </p>
      {studio.tracks.some(
        (track) =>
          track.id !== studio.activeTrackId && track.audio && !track.muted,
      ) && (
        <label className="monitor-toggle">
          <input
            type="checkbox"
            checked={studio.monitorOtherTracks}
            disabled={disabled}
            onChange={(event) =>
              studio.setMonitorOtherTracks(event.target.checked)
            }
          />{" "}
          Hear other tracks while recording{" "}
          <Headphones size={13} aria-hidden="true" />
        </label>
      )}
      <ol className="project-tracks">
        {studio.tracks.map((track, index) => {
          const active = track.id === studio.activeTrackId;
          const label = `track ${index + 1}`;
          return (
            <li key={track.id} className={active ? "active" : ""}>
              <button
                className="track-select"
                aria-label={`Select ${label}`}
                aria-pressed={active}
                disabled={disabled}
                onClick={() => studio.selectTrack(track.id)}
              >
                <span className="track-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{track.name || `Track ${index + 1}`}</strong>
                  <small>
                    {track.audio
                      ? `${formatTime(track.audio.samples.length / track.audio.sampleRate, true)} source`
                      : "Ready for audio"}
                  </small>
                </span>
              </button>
              {active && (
                <label className="track-label track-name">
                  Name
                  <input
                    aria-label="Track name"
                    value={track.name}
                    maxLength={60}
                    disabled={disabled}
                    onChange={(event) =>
                      studio.updateTrack(track.id, { name: event.target.value })
                    }
                  />
                </label>
              )}
              <label className="track-label">
                Start (s)
                <input
                  aria-label={`Start time for ${label}`}
                  type="number"
                  min={0}
                  max={MAX_TRACK_OFFSET}
                  step="0.01"
                  value={track.offset}
                  disabled={disabled}
                  onChange={(event) =>
                    studio.updateTrack(track.id, {
                      offset: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="track-label">
                Level %
                <input
                  aria-label={`Volume for ${label}`}
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(track.volume * 100)}
                  disabled={disabled}
                  onChange={(event) =>
                    studio.updateTrack(track.id, {
                      volume: Number(event.target.value) / 100,
                    })
                  }
                />
              </label>
              <button
                className="button subtle small"
                aria-label={`${track.muted ? "Unmute" : "Mute"} ${label}`}
                aria-pressed={track.muted}
                disabled={disabled}
                onClick={() =>
                  studio.updateTrack(track.id, { muted: !track.muted })
                }
              >
                {track.muted ? "Muted" : "Mute"}
              </button>
              {studio.tracks.length > 1 && (
                <button
                  className="icon-button delete-button"
                  aria-label={`Remove ${label}`}
                  disabled={disabled}
                  onClick={() =>
                    track.audio
                      ? setRemoveId(track.id)
                      : studio.removeTrack(track.id)
                  }
                >
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {target && (
        <Modal title="Remove this track?" onClose={() => setRemoveId(null)}>
          <p className="modal-intro">
            “{target.name || "Untitled track"}” and its take will be removed
            from the open project.
          </p>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setRemoveId(null)}>
              Keep track
            </button>
            <button
              className="button danger"
              onClick={() => {
                studio.removeTrack(target.id);
                setRemoveId(null);
              }}
            >
              Remove track
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function Inspector({
  studio,
  onExport,
}: {
  studio: Studio;
  onExport: () => void;
}) {
  const selectedEffect = studio.effectChain.find(
    (item) => item.id === studio.selectedEffectId,
  );
  const preset =
    PRESETS.find((item) => item.id === selectedEffect?.presetId) ?? PRESETS[0];
  const disabled =
    studio.recordingState !== "idle" || studio.exporting || studio.mixing;
  const tune =
    PRESETS.find((item) => item.id === studio.previewPresetId)?.recipe
      .autotune !== undefined ||
    studio.effectChain.some(
      (effect) =>
        PRESETS.find((item) => item.id === effect.presetId)?.recipe.autotune !==
        undefined,
    );
  return (
    <aside className="inspector" aria-label="Effect settings">
      <div className="inspector-heading">
        <SlidersHorizontal size={16} />
        <span>YOUR STACK CONTROLS</span>
        <button
          className="icon-button tiny"
          title="Reset all effects"
          aria-label="Reset all effects"
          disabled={disabled}
          onClick={studio.resetSettings}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      <section className="effect-chain" aria-label="Effect stack">
        <div className="effect-chain-heading">
          <span>
            EFFECT STACK <b>{studio.effectChain.length}/8</b>
          </span>
          <button
            className="text-button"
            disabled={disabled || !studio.effectChain.length}
            onClick={studio.resetSettings}
          >
            Clear
          </button>
        </div>
        <StackPresetControls studio={studio} disabled={disabled} />
        {!studio.effectChain.length ? (
          <div className="effect-chain-empty">
            <Plus size={14} />
            <span>Pick an effect to start your stack.</span>
          </div>
        ) : (
          <>
            <ol className="effect-chain-list">
              {studio.effectChain.map((effect, index) => {
                const effectPreset =
                  PRESETS.find((item) => item.id === effect.presetId) ??
                  PRESETS[0];
                return (
                  <li
                    key={effect.id}
                    className={`effect-chain-item ${effect.id === studio.selectedEffectId ? "selected" : ""} ${!effect.enabled ? "bypassed" : ""}`}
                    data-effect-id={effect.id}
                    data-preset-id={effect.presetId}
                  >
                    <div className="effect-chain-row">
                      <button
                        className="effect-chain-select"
                        aria-label={`Select ${effectPreset.name} effect`}
                        aria-pressed={effect.id === studio.selectedEffectId}
                        disabled={disabled}
                        onClick={() => studio.selectEffect(effect.id)}
                      >
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{effectPreset.name}</strong>
                      </button>
                      <button
                        className={`chain-power ${effect.enabled ? "enabled" : ""}`}
                        aria-label={`${effect.enabled ? "Bypass" : "Enable"} ${effectPreset.name}`}
                        title={
                          effect.enabled ? "Bypass effect" : "Enable effect"
                        }
                        aria-pressed={effect.enabled}
                        disabled={disabled}
                        onClick={() => studio.toggleEffect(effect.id)}
                      >
                        <Power size={12} />
                      </button>
                    </div>
                    <div className="effect-chain-actions">
                      <span>
                        {effect.enabled
                          ? `${Math.round(effect.intensity * 100)}% strength`
                          : "BYPASSED"}
                      </span>
                      <button
                        aria-label={`Move ${effectPreset.name} up`}
                        title="Move effect up"
                        disabled={disabled || index === 0}
                        onClick={() => studio.moveEffect(effect.id, -1)}
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        aria-label={`Move ${effectPreset.name} down`}
                        title="Move effect down"
                        disabled={
                          disabled || index === studio.effectChain.length - 1
                        }
                        onClick={() => studio.moveEffect(effect.id, 1)}
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        className="chain-remove"
                        aria-label={`Remove ${effectPreset.name}`}
                        title="Remove effect"
                        disabled={disabled}
                        onClick={() => studio.removeEffect(effect.id)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
            <p className="effect-chain-order">Processed from top to bottom.</p>
          </>
        )}
      </section>
      <div
        className="selected-preset"
        style={{ "--effect-color": preset.color } as CSSProperties}
      >
        <div className="selected-preset-top">
          <span className="effect-icon">
            <PresetIcon preset={preset} size={24} />
          </span>
          <span className="selected-badge">
            {selectedEffect ? "SELECTED EFFECT" : "ORIGINAL VOICE"}
          </span>
        </div>
        <h2>{preset.name}</h2>
        <p>{preset.description}</p>
      </div>
      <div className="inspector-controls">
        <RangeControl
          label="Effect strength"
          ariaLabel="Effect intensity"
          min={0}
          max={1}
          value={selectedEffect?.intensity ?? studio.settings.intensity}
          display={`${Math.round((selectedEffect?.intensity ?? studio.settings.intensity) * 100)}%`}
          onChange={(intensity) => studio.updateSettings({ intensity })}
          disabled={disabled || !selectedEffect}
        />
        <div className="control-divider" />
        <div className="inspector-section-label">SHAPE THE WHOLE STACK</div>
        <RangeControl
          label="Pitch shift"
          min={-12}
          max={12}
          step={1}
          value={studio.settings.pitch}
          display={`${studio.settings.pitch > 0 ? "+" : ""}${studio.settings.pitch} st`}
          onChange={(pitch) => studio.updateSettings({ pitch })}
          disabled={disabled}
        />
        <RangeControl
          label="Extra reverb"
          min={0}
          max={1}
          value={studio.settings.reverb}
          display={`${Math.round(studio.settings.reverb * 100)}%`}
          onChange={(reverb) => studio.updateSettings({ reverb })}
          disabled={disabled}
        />
        <RangeControl
          label="Extra echo"
          min={0}
          max={1}
          value={studio.settings.echo}
          display={`${Math.round(studio.settings.echo * 100)}%`}
          onChange={(echo) => studio.updateSettings({ echo })}
          disabled={disabled}
        />
        <RangeControl
          label="Output volume"
          min={0}
          max={2}
          value={studio.settings.gain}
          display={`${Math.round(studio.settings.gain * 100)}%`}
          onChange={(gain) => studio.updateSettings({ gain })}
          disabled={disabled}
        />
        {tune && (
          <div className="tuning-controls">
            <div className="inspector-section-label">
              <Music2 size={13} />
              PITCH CORRECTION
            </div>
            <label>
              Key
              <select
                value={studio.settings.tuningKey}
                disabled={disabled}
                onChange={(event) =>
                  studio.updateSettings({
                    tuningKey: Number(event.target.value),
                  })
                }
              >
                {[
                  "C",
                  "C♯ / D♭",
                  "D",
                  "D♯ / E♭",
                  "E",
                  "F",
                  "F♯ / G♭",
                  "G",
                  "G♯ / A♭",
                  "A",
                  "A♯ / B♭",
                  "B",
                ].map((key, index) => (
                  <option key={key} value={index}>
                    {key}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Scale
              <select
                value={studio.settings.tuningScale}
                disabled={disabled}
                onChange={(event) =>
                  studio.updateSettings({
                    tuningScale: event.target
                      .value as StudioSettings["tuningScale"],
                  })
                }
              >
                <option value="chromatic">Chromatic</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
                <option value="harmonicMinor">Harmonic minor</option>
                <option value="minorPentatonic">Minor pentatonic</option>
              </select>
            </label>
            <label>
              Retune timing
              <select
                value={studio.settings.tuningRetuneMs ?? "preset"}
                disabled={disabled}
                onChange={(event) =>
                  studio.updateSettings({
                    tuningRetuneMs:
                      event.target.value === "preset"
                        ? undefined
                        : Number(event.target.value),
                  })
                }
              >
                <option value="preset">Use preset</option>
                <option value="0">Snap · 0 ms</option>
                <option value="25">Fast · 25 ms</option>
                <option value="65">Smooth · 65 ms</option>
                <option value="150">Natural · 150 ms</option>
              </select>
            </label>
            <p>
              Match the key and scale to your beat. Retune timing controls how
              quickly the pitch settles.
            </p>
          </div>
        )}
        <div className="control-divider" />
        <label className="toggle-control">
          <span>
            <span>Normalize audio</span>
            <small>Keep your levels consistent</small>
          </span>
          <input
            type="checkbox"
            checked={studio.settings.normalize}
            disabled={disabled}
            onChange={(event) =>
              studio.updateSettings({ normalize: event.target.checked })
            }
          />
          <span className="toggle-track" aria-hidden="true" />
        </label>
        <button
          className="reset-button"
          disabled={disabled}
          onClick={studio.resetSettings}
        >
          <RotateCcw size={13} />
          Reset to original
        </button>
      </div>
      <div className="inspector-footer">
        <div className="workflow-note">
          <Sparkles size={17} />
          <div>
            <strong>Your original stays yours.</strong>
            <p>
              Try any effect. Switch back anytime. Export when it sounds right.
            </p>
          </div>
        </div>
        <button
          className="button primary full"
          disabled={!studio.audio || studio.processing || disabled}
          onClick={onExport}
        >
          <Download size={16} />
          Export audio
          <ArrowRight size={15} />
        </button>
        <span className="export-hint">WAV for quality · MP3 for sharing</span>
      </div>
    </aside>
  );
}

function Library({
  studio,
  onDelete,
  onBack,
}: {
  studio: Studio;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  return (
    <section className="recordings-page">
      <div className="eyebrow">YOUR LOCAL LIBRARY</div>
      <h1>Good takes. All here.</h1>
      <p>Saved on this computer, ready for your next idea.</p>
      {!studio.recordings.length ? (
        <div className="library-empty">
          <span className="library-empty-icon">
            <FolderOpen size={32} />
          </span>
          <h2>Make something worth keeping.</h2>
          <p>
            Your saved recordings will appear here. Record a take, give it a
            name, then hit Save.
          </p>
          <button className="button primary" onClick={onBack}>
            <Mic size={16} />
            Open the studio
            <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="recordings-list">
          {studio.recordings.map((item) => {
            return (
              <article className="recording-item" key={item.id}>
                <span className="recording-item-icon">
                  <AudioLines size={24} />
                </span>
                <div className="recording-item-info">
                  <h3>{item.name}</h3>
                  <p>
                    {new Date(item.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                    <span>·</span>
                    {formatTime(item.duration)}
                    <span>·</span>
                    {item.trackCount > 1
                      ? `${item.trackCount} tracks`
                      : effectSummary(item.settings)}
                  </p>
                </div>
                <button
                  className="button subtle small"
                  disabled={
                    studio.recordingState !== "idle" ||
                    studio.processing ||
                    studio.exporting ||
                    studio.mixing
                  }
                  onClick={async () => {
                    if (await studio.loadRecording(item.id)) onBack();
                  }}
                >
                  Open
                  <ArrowRight size={14} />
                </button>
                <button
                  className="icon-button delete-button"
                  aria-label={`Delete ${item.name}`}
                  onClick={() => onDelete(item.id)}
                >
                  <Trash2 size={16} />
                </button>
              </article>
            );
          })}
        </div>
      )}
      <div className="library-privacy">
        <ShieldCheck size={16} />
        <p>
          Recordings stay on this device until you export them. Deleting a saved
          recording removes it from this library.
        </p>
      </div>
    </section>
  );
}

function PreferencesDialog({
  studio,
  onClose,
}: {
  studio: Studio;
  onClose: () => void;
}) {
  const [mic, setMic] = useState(studio.preferences.microphoneId);
  const [format, setFormat] = useState(studio.preferences.exportFormat);
  const [bitrate, setBitrate] = useState(studio.preferences.exportBitrate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to update settings.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Studio settings"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="studio-preferences"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const device = studio.devices.find(
              (input) => input.deviceId === mic,
            );
            await studio.savePreferences({
              microphoneId: mic,
              microphoneLabel: mic
                ? device?.label ||
                  (mic === studio.preferences.microphoneId
                    ? studio.preferences.microphoneLabel
                    : "")
                : "",
              exportFormat: format,
              exportBitrate: bitrate,
            });
            onClose();
          });
        }}
      >
        <label>
          Default microphone
          <select
            aria-label="Default microphone"
            value={mic}
            disabled={busy || studio.recordingState !== "idle"}
            onChange={(event) => setMic(event.target.value)}
          >
            <MicrophoneOptions studio={studio} selected={mic} />
          </select>
        </label>
        <button
          type="button"
          className="button subtle small"
          disabled={busy || studio.recordingState !== "idle"}
          onClick={() => void run(studio.detectMicrophones)}
        >
          <RefreshCcw size={13} />
          Detect microphones
        </button>
        <label>
          Default export folder
          <span
            className="preferences-folder"
            title={studio.preferences.exportFolder ?? undefined}
          >
            {studio.preferences.exportFolder ?? "No folder selected"}
          </span>
        </label>
        <button
          type="button"
          className="button subtle small"
          disabled={busy}
          onClick={() => void run(studio.chooseExportFolder)}
        >
          <FolderOpen size={14} />
          Choose folder
        </button>
        <label>
          Fast export format
          <select
            aria-label="Fast export format"
            value={format}
            disabled={busy}
            onChange={(event) =>
              setFormat(event.target.value === "mp3" ? "mp3" : "wav")
            }
          >
            <option value="wav">WAV · 16-bit PCM</option>
            <option value="mp3">MP3</option>
          </select>
        </label>
        {format === "mp3" && (
          <label>
            MP3 bitrate
            <select
              aria-label="Fast export bitrate"
              value={bitrate}
              disabled={busy}
              onChange={(event) => setBitrate(Number(event.target.value))}
            >
              <option value={128}>128 kbps</option>
              <option value={192}>192 kbps</option>
              <option value={320}>320 kbps</option>
            </select>
          </label>
        )}
        {error && (
          <p role="alert" className="preferences-error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy} type="submit">
          Save preferences
        </button>
      </form>
    </Modal>
  );
}

export default function App() {
  const studio = useStudio();
  const [page, setPage] = useState<"studio" | "recordings">("studio");
  const [modal, setModal] = useState<
    "export" | "help" | "settings" | "clear" | null
  >(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [format, setFormat] = useState<"wav" | "mp3">("wav");
  const [bitrate, setBitrate] = useState(192);
  const [exportScope, setExportScope] = useState<"track" | "mix">("track");
  const fileInput = useRef<HTMLInputElement>(null);
  const effectsRef = useRef<HTMLElement>(null);
  const busy = studio.processing || studio.exporting || studio.mixing;
  const recording = studio.recordingState !== "idle";
  const hasAudio = studio.tracks.some((track) => track.audio);
  const audibleTracks = studio.tracks.filter(
    (track) => track.audio && !track.muted,
  ).length;
  const activeTrack = studio.tracks.find(
    (track) => track.id === studio.activeTrackId,
  );
  const canExport = Boolean(studio.audio || audibleTracks);
  const openImport = () => fileInput.current?.click();
  const openExport = () => {
    setFormat(studio.preferences.exportFormat);
    setBitrate(studio.preferences.exportBitrate);
    setExportScope(
      (studio.tracks.length > 1 && audibleTracks > 0) || !studio.audio
        ? "mix"
        : "track",
    );
    setModal("export");
  };
  const goStudio = () => setPage("studio");
  const sourceDuration = studio.audio
    ? studio.audio.samples.length / studio.audio.sampleRate
    : 0;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={goStudio}
          aria-label="VoiceForge studio"
        >
          <span className="brand-mark">
            <AudioLines size={25} strokeWidth={2.5} />
          </span>
          <span>
            voiceforge<span className="brand-period">.</span>
          </span>
        </button>
        <div className="sidebar-label">YOUR WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          <button
            className={page === "studio" ? "active" : ""}
            aria-label="Recording studio"
            title="Recording studio"
            onClick={goStudio}
          >
            <Mic size={18} />
            <span>Recording studio</span>
            <span className="nav-active-dot" />
          </button>
          <button
            aria-label="Voice effects"
            title="Voice effects"
            onClick={() => {
              setPage("studio");
              requestAnimationFrame(() =>
                effectsRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                }),
              );
            }}
          >
            <WandSparkles size={18} />
            <span>Voice effects</span>
            <span className="nav-count">{PRESETS.length}</span>
          </button>
          <button
            className={page === "recordings" ? "active" : ""}
            aria-label="My recordings"
            title="My recordings"
            onClick={() => setPage("recordings")}
          >
            <FolderOpen size={18} />
            <span>My recordings</span>
            {studio.recordings.length > 0 && (
              <span className="nav-count">{studio.recordings.length}</span>
            )}
          </button>
        </nav>
        <div className="sidebar-divider" />
        <button
          className="new-session"
          aria-label="New recording"
          title="New recording"
          disabled={recording || busy}
          onClick={() => {
            studio.newRecording();
            goStudio();
          }}
        >
          <Plus size={16} />
          <span>New recording</span>
        </button>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-card-icon">
              <LockKeyhole size={17} />
            </span>
            <strong>Just you. Your voice.</strong>
            <p>
              No uploads. No accounts.
              <br />
              Your audio stays with you.
            </p>
            <span className="local-card-status">
              <span />
              100% on your device
            </span>
          </div>
          <button
            className="help-button"
            aria-label="A little guidance"
            title="A little guidance"
            onClick={() => setModal("help")}
          >
            <CircleHelp size={16} />
            <span>A little guidance</span>
            <ArrowRight size={14} />
          </button>
          <div className="app-version">
            <span>VOICEFORGE</span>
            <span>V{window.voiceforge?.version || "1.3.0"}</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronDown size={12} />
            <span>
              {page === "recordings" ? "My recordings" : "Recording studio"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="local-status">
              <span />
              LOCAL STUDIO
            </span>
            <button
              className="icon-button"
              aria-label="How to use VoiceForge"
              onClick={() => setModal("help")}
            >
              <Info size={17} />
            </button>
            {window.voiceforge && (
              <button
                className="icon-button"
                aria-label="Studio settings"
                title="Studio settings"
                disabled={recording || studio.exporting}
                onClick={() => setModal("settings")}
              >
                <Settings size={17} />
              </button>
            )}
          </div>
        </header>
        <div
          className={`workspace-body ${page === "recordings" ? "library-view" : ""}`}
        >
          <main className="main-content">
            {page === "studio" ? (
              <>
                <div className="workspace-intro">
                  <div>
                    <div className="eyebrow">
                      <span className="intro-line" />
                      YOUR VOICE, REIMAGINED
                    </div>
                    <h1>
                      Sounds like possibility<span>.</span>
                    </h1>
                    <p>Hit record. Find your sound. Make it something else.</p>
                  </div>
                  <span className="intro-index" aria-hidden="true">
                    01<span> / STUDIO</span>
                  </span>
                </div>
                <RecorderDock>
                  <div className="session-toolbar">
                    <div className="session-name">
                      <AudioLines size={17} />
                      <input
                        value={studio.name}
                        maxLength={100}
                        aria-label="Recording name"
                        onChange={(event) => studio.setName(event.target.value)}
                      />
                      <span className="session-label">
                        {studio.tracks.length > 1
                          ? "MULTITRACK PROJECT"
                          : hasAudio
                            ? "AUDIO SESSION"
                            : "NEW SESSION"}
                      </span>
                    </div>
                    <div className="session-actions">
                      <button
                        className="button subtle small import-button"
                        disabled={recording || busy}
                        onClick={openImport}
                      >
                        <Upload size={14} />
                        Import
                      </button>
                      <button
                        className="button subtle small clear-recording-button"
                        aria-label="Clear recording"
                        title="Clear the selected track’s recording"
                        disabled={!studio.audio || recording || busy}
                        onClick={() => setModal("clear")}
                      >
                        <Trash2 size={14} /> <span>Clear take</span>
                      </button>
                      <button
                        className="button subtle small"
                        disabled={!hasAudio || recording || busy}
                        onClick={() => {
                          void studio.saveRecording();
                        }}
                      >
                        <Save size={14} />
                        Save
                      </button>
                      <button
                        className="button soft-orange small"
                        disabled={!canExport || recording || busy}
                        onClick={openExport}
                      >
                        <ArrowDownToLine size={14} />
                        Export
                      </button>
                      {window.voiceforge && (
                        <button
                          className="button soft-orange small fast-export-button"
                          disabled={
                            (studio.tracks.length > 1
                              ? !audibleTracks
                              : !studio.audio) ||
                            recording ||
                            busy
                          }
                          title={
                            studio.preferences.exportFolder
                              ? `Export ${studio.preferences.exportFormat.toUpperCase()} to ${studio.preferences.exportFolder}`
                              : "Choose a default export folder"
                          }
                          onClick={() =>
                            studio.preferences.exportFolder
                              ? void studio.fastExport()
                              : setModal("settings")
                          }
                        >
                          <Zap size={14} />
                          Fast export
                        </button>
                      )}
                    </div>
                  </div>
                  <Recorder studio={studio} onImport={openImport} />
                  {studio.processing && (
                    <div className="processing-line" role="status">
                      <LoaderCircle size={14} className="spinning" />
                      Shaping your sound…
                    </div>
                  )}
                </RecorderDock>
                <TrackPanel studio={studio} disabled={busy || recording} />
                <EffectsBrowser studio={studio} effectsRef={effectsRef} />
              </>
            ) : (
              <Library
                studio={studio}
                onDelete={setDeleteId}
                onBack={goStudio}
              />
            )}
          </main>
          {page === "studio" && (
            <Inspector studio={studio} onExport={openExport} />
          )}
        </div>
      </div>
      <input
        ref={fileInput}
        className="visually-hidden"
        tabIndex={-1}
        type="file"
        accept="audio/*,.wav,.mp3,.ogg,.flac,.webm,.m4a"
        aria-label="Import audio file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void studio.importFile(file);
            setPage("studio");
          }
          event.target.value = "";
        }}
      />
      {(studio.error || studio.notice) && (
        <div
          className={`toast ${studio.error ? "error" : "success"}`}
          role={studio.error ? "alert" : "status"}
        >
          {studio.error ? <Info size={18} /> : <Check size={18} />}
          <span>{studio.error || studio.notice}</span>
          <button
            className="icon-button"
            aria-label="Dismiss message"
            onClick={studio.dismissMessage}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "settings" && (
        <PreferencesDialog studio={studio} onClose={() => setModal(null)} />
      )}
      {modal === "clear" && (
        <Modal title="Clear this recording?" onClose={() => setModal(null)}>
          <p className="modal-intro">
            The take in “{activeTrack?.name || "Selected track"}” will be
            removed from the open project. Its effects will be ready for the
            next take.
          </p>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setModal(null)}>
              Keep take
            </button>
            <button
              className="button danger"
              onClick={() => {
                studio.clearRecording();
                setModal(null);
              }}
            >
              Clear take
            </button>
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal
          title="Ready for the world."
          eyebrow="EXPORT YOUR AUDIO"
          onClose={() => {
            if (!studio.exporting) setModal(null);
          }}
        >
          <p className="modal-intro">
            Your applied stack and trim are included. A preview is never saved
            or exported unless you add it to the stack.
          </p>
          {studio.tracks.length > 1 && (
            <label className="bitrate-field export-scope">
              Export audio from
              <select
                aria-label="Export audio from"
                value={exportScope}
                disabled={studio.exporting}
                onChange={(event) =>
                  setExportScope(event.target.value === "mix" ? "mix" : "track")
                }
              >
                <option value="mix" disabled={!audibleTracks}>
                  Project mix
                </option>
                <option value="track" disabled={!studio.audio}>
                  Selected track · {activeTrack?.name || "Untitled track"}
                </option>
              </select>
            </label>
          )}
          <div className="export-format-options">
            <button
              className={format === "wav" ? "selected" : ""}
              onClick={() => setFormat("wav")}
            >
              <div>
                <span className="file-format-icon">WAV</span>
                <span className="format-check">
                  {format === "wav" && <Check size={13} />}
                </span>
              </div>
              <strong>Studio quality</strong>
              <span>Uncompressed audio. Best for editing.</span>
              <small>16-BIT PCM · ORIGINAL SAMPLE RATE</small>
            </button>
            <button
              className={format === "mp3" ? "selected" : ""}
              onClick={() => setFormat("mp3")}
            >
              <div>
                <span className="file-format-icon">MP3</span>
                <span className="format-check">
                  {format === "mp3" && <Check size={13} />}
                </span>
              </div>
              <strong>Easy to share</strong>
              <span>Smaller files. Take your voice anywhere.</span>
              <small>COMPRESSED · UNIVERSALLY PLAYABLE</small>
            </button>
          </div>
          {format === "mp3" && (
            <label className="bitrate-field">
              MP3 quality
              <select
                value={bitrate}
                onChange={(event) => setBitrate(Number(event.target.value))}
              >
                <option value={128}>128 kbps — compact</option>
                <option value={192}>192 kbps — balanced</option>
                <option value={320}>320 kbps — highest quality</option>
              </select>
            </label>
          )}
          <div className="export-file">
            <AudioLines size={18} />
            <div>
              <strong>
                {studio.name || "Untitled recording"}
                {exportScope === "track" && studio.tracks.length > 1
                  ? ` - ${activeTrack?.name || "Track"}`
                  : ""}
                .{format}
              </strong>
              <span>
                {exportScope === "mix" ? (
                  `${audibleTracks} ${audibleTracks === 1 ? "track" : "tracks"} in the mix`
                ) : (
                  <>
                    {formatTime(
                      Math.max(
                        0,
                        (studio.settings.trimEnd || sourceDuration) -
                          studio.settings.trimStart,
                      ),
                    )}{" "}
                    source · {effectSummary(studio.settings)}
                  </>
                )}
              </span>
            </div>
          </div>
          <div className="modal-actions">
            <button
              className="button subtle"
              disabled={studio.exporting}
              onClick={() => setModal(null)}
            >
              Back to studio
            </button>
            <button
              className="button primary"
              disabled={
                studio.exporting ||
                studio.processing ||
                (exportScope === "mix" ? !audibleTracks : !studio.audio)
              }
              onClick={async () => {
                await studio.exportAudio(format, bitrate, exportScope);
                setModal(null);
              }}
            >
              {studio.exporting ? (
                <LoaderCircle size={16} className="spinning" />
              ) : (
                <Download size={16} />
              )}
              {studio.exporting
                ? "Exporting…"
                : `Export ${format.toUpperCase()}`}
            </button>
          </div>
          <p className="modal-footnote">
            <ShieldCheck size={12} />
            Encoded here on your computer. Always.
          </p>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="From an idea to a great take."
          eyebrow="A LITTLE GUIDANCE"
          onClose={() => setModal(null)}
        >
          <div className="help-steps">
            <div>
              <span>01</span>
              <div>
                <h3>Give your voice some room.</h3>
                <p>
                  Choose your microphone and press Record. Pause when you need a
                  breath, then stop to finish. Headphones help avoid feedback.
                </p>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <h3>Find a new character.</h3>
                <p>
                  Click any effect card to preview it without changing your
                  stack. Use its Add to stack button to keep it, or Back to
                  stack to finish previewing. Stack up to 8 effects, then
                  reorder, bypass, or fine-tune each one.
                </p>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <h3>Keep it. Share it. Make more.</h3>
                <p>
                  Save a recording to your local library, or export a WAV for
                  editing and an MP3 for sharing. Use the scissors, then drag
                  the waveform edges to trim or its middle to move a selection.
                  You can also enter exact seconds.
                </p>
              </div>
            </div>
          </div>
          <div className="help-tip">
            <Headphones size={18} />
            <p>
              For best results, record in a quiet space with the microphone
              about a hand’s width away. Pitch correction works best on a single
              singing voice.
            </p>
          </div>
          <button
            className="button primary full"
            onClick={() => setModal(null)}
          >
            Let’s make something
            <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {deleteId && (
        <Modal title="Delete this recording?" onClose={() => setDeleteId(null)}>
          <p className="modal-intro">
            “{studio.recordings.find((item) => item.id === deleteId)?.name}”
            will be removed from your local library. Files you already exported
            are kept.
          </p>
          <div className="modal-actions">
            <button className="button subtle" onClick={() => setDeleteId(null)}>
              Keep recording
            </button>
            <button
              className="button danger"
              onClick={() => {
                void studio.deleteRecording(deleteId);
                setDeleteId(null);
              }}
            >
              <Trash2 size={16} />
              Delete recording
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
