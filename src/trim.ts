export interface TrimRange {
  start: number;
  end: number;
}
export type TrimEdge = "start" | "end";
export const MIN_TRIM_SECONDS = 0.01;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function resizeTrim(
  range: TrimRange,
  edge: TrimEdge,
  seconds: number,
  duration: number,
): TrimRange {
  const minimum = Math.min(MIN_TRIM_SECONDS, duration);
  return edge === "start"
    ? {
        start: clamp(seconds, 0, Math.max(0, range.end - minimum)),
        end: range.end,
      }
    : {
        start: range.start,
        end: clamp(
          seconds,
          Math.min(duration, range.start + minimum),
          duration,
        ),
      };
}

export function moveTrim(
  range: TrimRange,
  delta: number,
  duration: number,
): TrimRange {
  const length = range.end - range.start;
  const start = clamp(range.start + delta, 0, Math.max(0, duration - length));
  return { start, end: start + length };
}

export function timeAtPointer(
  clientX: number,
  left: number,
  width: number,
  duration: number,
): number {
  return width > 0 ? clamp((clientX - left) / width, 0, 1) * duration : 0;
}
