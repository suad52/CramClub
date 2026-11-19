import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { layoutStrokes, measureLine, parsePath, parseSvgFont } from "./strokeFont";
import { frameAt, scheduleWriting } from "./writer";

const require = createRequire(import.meta.url);
const svg = readFileSync(
  join(dirname(require.resolve("hersheytext")), "..", "svg_fonts", "EMSTech.svg"),
  "utf8",
);
const font = parseSvgFont(svg);
const style = { lineHeight: 80, seed: 1 };

describe("parsePath", () => {
  it("reads move/line paths and flattens curves", () => {
    expect(parsePath("M 0 0 L 10 0 20 5 M 1 1 L 2 2")).toEqual([
      [
        [0, 0],
        [10, 0],
        [20, 5],
      ],
      [
        [1, 1],
        [2, 2],
      ],
    ]);
    const curve = parsePath("M 0 0 C 0 10 10 10 10 0", 4)[0]!;
    expect(curve).toHaveLength(5);
    expect(curve.at(-1)).toEqual([10, 0]);
    expect(curve[2]![1]).toBeGreaterThan(5);
  });
});

describe("EMS Tech", () => {
  it("parses metrics and a full set of glyphs", () => {
    // Measured from the drawn "H", not the font's declared 500.
    expect(font.capHeight).toBeGreaterThan(600);
    expect(font.capHeight).toBeLessThan(720);
    expect(font.xHeight).toBeLessThan(font.capHeight);
    expect(font.glyphs.size).toBeGreaterThan(180);
    for (const ch of "AZaz09=+-×÷²()?")
      expect(font.glyphs.get(ch)?.strokes.length, ch).toBeGreaterThan(0);
    expect(font.glyphs.get('"')?.strokes.length).toBe(2);
    expect(font.glyphs.get("&")).toBeDefined();
  });

  it("adds the maths symbols the font lacks", () => {
    for (const ch of "√π−→≈≤≥≠∞")
      expect(font.glyphs.get(ch)?.strokes.length, ch).toBeGreaterThan(0);
  });
});

describe("layoutStrokes", () => {
  const area = { x: 100, y: 200, w: 900 };

  it("writes each line on its own baseline, left to right, inside the area", () => {
    const strokes = layoutStrokes(font, ["x = 4", "so 2x = 8"], area, style);
    expect(strokes.length).toBeGreaterThan(8);
    const lines = new Set(strokes.map((s) => s.line));
    expect([...lines]).toEqual([0, 1]);
    for (const s of strokes) {
      for (const [x, y] of s.points) {
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThan(area.x - 5);
        expect(x).toBeLessThan(area.x + area.w + 5);
      }
    }
    const meanY = (line: number) => {
      const ys = strokes.filter((s) => s.line === line).flatMap((s) => s.points.map((p) => p[1]));
      return ys.reduce((a, b) => a + b, 0) / ys.length;
    };
    expect(meanY(1)).toBeGreaterThan(meanY(0) + style.lineHeight * 0.8);
    expect(strokes[0]!.wordStart).toBe(true);
  });

  it("squeezes a line that would be too wide", () => {
    const line = "a very long answer line that will not fit";
    expect(measureLine(font, line, style)).toBeGreaterThan(400);
    const strokes = layoutStrokes(font, [line], { x: 0, y: 0, w: 400 }, style);
    const maxX = Math.max(...strokes.flatMap((s) => s.points.map((p) => p[0])));
    expect(maxX).toBeLessThan(405);
  });

  it("is deterministic for a seed and skips unknown characters", () => {
    const a = layoutStrokes(font, ["hi 🙂"], area, style);
    const b = layoutStrokes(font, ["hi 🙂"], area, style);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("writing schedule", () => {
  const strokes = layoutStrokes(font, ["2x + 3 = 11", "x = 4"], { x: 0, y: 0, w: 1200 }, style);

  it("orders strokes in time and pauses between them", () => {
    const sched = scheduleWriting(strokes, style.lineHeight);
    for (let i = 1; i < sched.strokes.length; i++) {
      expect(sched.strokes[i]!.start).toBeGreaterThanOrEqual(sched.strokes[i - 1]!.end);
    }
    expect(sched.duration).toBeGreaterThan(1.4);
    expect(sched.duration).toBeLessThanOrEqual(9.001);
  });

  it("caps very long answers at the maximum duration", () => {
    const long = layoutStrokes(
      font,
      Array.from({ length: 10 }, () => "a long line of answer text here"),
      { x: 0, y: 0, w: 1500 },
      style,
    );
    expect(scheduleWriting(long, style.lineHeight).duration).toBeCloseTo(9, 1);
  });

  it("reveals strokes progressively", () => {
    const sched = scheduleWriting(strokes, style.lineHeight);
    const start = frameAt(sched, 0);
    expect(start.done).toBe(0);
    const middle = frameAt(sched, sched.duration / 2);
    expect(middle.done).toBeGreaterThan(0);
    expect(middle.done).toBeLessThan(sched.strokes.length);
    const end = frameAt(sched, sched.duration + 1);
    expect(end.done).toBe(sched.strokes.length);
    expect(end.tip).toBeNull();
  });
});
