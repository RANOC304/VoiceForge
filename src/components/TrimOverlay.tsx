import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { GripVertical } from "lucide-react";
import { moveTrim, resizeTrim, timeAtPointer, type TrimRange } from "../trim";

interface Props {
  duration: number;
  range: TrimRange;
  onDraft: (range: TrimRange | null) => void;
  onCommit: (range: TrimRange) => void;
}

/** Pointer capture keeps a drag active outside the waveform until pointerup.
 * https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture
 */
export function TrimOverlay({ duration, range, onDraft, onCommit }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    mode: "start" | "end" | "move";
    origin: number;
    range: TrimRange;
    left: number;
    width: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const begin = (
    event: PointerEvent<HTMLElement>,
    mode: "start" | "end" | "move",
  ) => {
    if (event.button !== 0 || !surface.current || duration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = surface.current.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus();
    gesture.current = {
      mode,
      origin: timeAtPointer(event.clientX, rect.left, rect.width, duration),
      range: { ...range },
      left: rect.left,
      width: rect.width,
    };
    setDragging(true);
  };
  const atEvent = (event: PointerEvent<HTMLElement>): TrimRange | null => {
    const current = gesture.current;
    if (!current) return null;
    const at = timeAtPointer(
      event.clientX,
      current.left,
      current.width,
      duration,
    );
    return current.mode === "move"
      ? moveTrim(current.range, at - current.origin, duration)
      : resizeTrim(current.range, current.mode, at, duration);
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const next = atEvent(event);
    if (next) onDraft(next);
  };
  const finish = (event: PointerEvent<HTMLElement>) => {
    const next = atEvent(event);
    gesture.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (next) onCommit(next);
    onDraft(null);
  };
  const cancel = () => {
    gesture.current = null;
    setDragging(false);
    onDraft(null);
  };
  const key = (
    event: KeyboardEvent<HTMLElement>,
    mode: "start" | "end" | "move",
  ) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    let next: TrimRange | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const delta = event.key === "ArrowLeft" ? -step : step;
      next =
        mode === "move"
          ? moveTrim(range, delta, duration)
          : resizeTrim(range, mode, range[mode] + delta, duration);
    } else if (event.key === "Home") {
      next =
        mode === "move"
          ? moveTrim(range, -duration, duration)
          : resizeTrim(range, mode, 0, duration);
    } else if (event.key === "End") {
      next =
        mode === "move"
          ? moveTrim(range, duration, duration)
          : resizeTrim(range, mode, duration, duration);
    }
    if (next) {
      event.preventDefault();
      event.stopPropagation();
      onCommit(next);
    }
  };
  const interactions = (mode: "start" | "end" | "move") => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, mode),
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: cancel,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => key(event, mode),
  });
  return (
    <div
      ref={surface}
      className={`trim-overlay ${dragging ? "is-dragging" : ""}`}
      data-start={range.start}
      data-end={range.end}
    >
      <div
        className="trim-shade trim-shade-left"
        style={{ width: `${(range.start / duration) * 100}%` }}
      />
      <div
        className="trim-shade trim-shade-right"
        style={{ width: `${((duration - range.end) / duration) * 100}%` }}
      />
      <div
        className="trim-selection"
        role="slider"
        tabIndex={0}
        aria-label="Move trim selection"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, duration - (range.end - range.start))}
        aria-valuenow={range.start}
        aria-valuetext={`${range.start.toFixed(2)} to ${range.end.toFixed(2)} seconds`}
        style={{
          left: `${(range.start / duration) * 100}%`,
          width: `${((range.end - range.start) / duration) * 100}%`,
        }}
        {...interactions("move")}
      >
        <span className="trim-selection-label">DRAG TO MOVE</span>
      </div>
      <div
        className="trim-handle trim-handle-start"
        role="slider"
        tabIndex={0}
        aria-label="Trim start"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, range.end - 0.01)}
        aria-valuenow={range.start}
        aria-valuetext={`${range.start.toFixed(2)} seconds`}
        style={{ left: `${(range.start / duration) * 100}%` }}
        {...interactions("start")}
      >
        <GripVertical size={12} />
        <span>{range.start.toFixed(2)}s</span>
      </div>
      <div
        className="trim-handle trim-handle-end"
        role="slider"
        tabIndex={0}
        aria-label="Trim end"
        aria-valuemin={range.start + 0.01}
        aria-valuemax={duration}
        aria-valuenow={range.end}
        aria-valuetext={`${range.end.toFixed(2)} seconds`}
        style={{ left: `${(range.end / duration) * 100}%` }}
        {...interactions("end")}
      >
        <GripVertical size={12} />
        <span>{range.end.toFixed(2)}s</span>
      </div>
    </div>
  );
}
