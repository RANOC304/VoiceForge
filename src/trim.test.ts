import { describe, expect, it } from "vitest";
import { moveTrim, resizeTrim, timeAtPointer } from "./trim";

describe("waveform trim gestures", () => {
  it("resizes the start while preserving the end and minimum selection", () => {
    expect(resizeTrim({ start: 1, end: 8 }, "start", 3.5, 10)).toEqual({
      start: 3.5,
      end: 8,
    });
    expect(resizeTrim({ start: 1, end: 8 }, "start", 9, 10).start).toBeCloseTo(
      7.99,
    );
    expect(resizeTrim({ start: 1, end: 8 }, "start", -5, 10)).toEqual({
      start: 0,
      end: 8,
    });
  });
  it("resizes the end within source duration", () => {
    expect(resizeTrim({ start: 2, end: 7 }, "end", 5, 10)).toEqual({
      start: 2,
      end: 5,
    });
    expect(resizeTrim({ start: 2, end: 7 }, "end", 15, 10).end).toBe(10);
    expect(resizeTrim({ start: 2, end: 7 }, "end", 0, 10).end).toBeCloseTo(
      2.01,
    );
  });
  it("moves a selected segment without changing its duration at either edge", () => {
    expect(moveTrim({ start: 2, end: 5 }, 3, 10)).toEqual({ start: 5, end: 8 });
    expect(moveTrim({ start: 2, end: 5 }, 20, 10)).toEqual({
      start: 7,
      end: 10,
    });
    expect(moveTrim({ start: 2, end: 5 }, -20, 10)).toEqual({
      start: 0,
      end: 3,
    });
  });
  it("maps pointer position into source seconds and clamps outside drags", () => {
    expect(timeAtPointer(350, 100, 500, 10)).toBe(5);
    expect(timeAtPointer(-100, 100, 500, 10)).toBe(0);
    expect(timeAtPointer(999, 100, 500, 10)).toBe(10);
    expect(timeAtPointer(100, 100, 0, 10)).toBe(0);
  });
  it("keeps sub-centisecond sources valid", () => {
    expect(resizeTrim({ start: 0, end: 0.005 }, "start", 1, 0.005)).toEqual({
      start: 0,
      end: 0.005,
    });
  });
});
