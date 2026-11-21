import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { itemCount } from "@/components/learning-studio/visuals";
import type { BoardScreenView, LiveBoardFrame } from "./boardLessons";
import { createBoardScreenMemory, paintBoardScreen, shownCount, wrapText } from "./boardScreen";
import { SAMPLE_LESSON } from "./mockLesson";
import type { Lesson, Scene, Visual } from "./schema";

/** Measures text as `k` px per character, like a monospaced font. */
const mono = (k: number) => ({ measureText: (t: string) => ({ width: Array.from(t).length * k }) });

/**
 * A stand-in 2D context for node: stores every property, records every call and measures text
 * at 14 px a character. It also checks nothing is drawn at NaN or with an out-of-range alpha.
 */
function fakeContext([width, height]: readonly [number, number] = [1280, 866]) {
  const calls: { name: string; args: unknown[] }[] = [];
  const problems: string[] = [];
  const state: Record<PropertyKey, unknown> = { canvas: { width, height }, globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "measureText") return mono(14).measureText;
      return (...args: unknown[]) => {
        calls.push({ name: String(key), args });
        if (args.some((a) => typeof a === "number" && !Number.isFinite(a)))
          problems.push(`${String(key)}(${args.join(", ")})`);
        return { addColorStop() {} };
      };
    },
    set(target, key, value) {
      if (key === "globalAlpha" && !(typeof value === "number" && value >= 0 && value <= 1))
        problems.push(`globalAlpha = ${String(value)}`);
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const texts = () => calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
  return { ctx, calls, problems, texts };
}

const frame = (over: Partial<LiveBoardFrame> = {}): LiveBoardFrame => ({
  boardId: "hall-t03",
  index: 0,
  progress: 0,
  caption: "",
  state: "playing",
  showQuestion: false,
  complete: false,
  ...over,
});
const live = (lesson: Lesson, over: Partial<LiveBoardFrame> = {}): BoardScreenView => ({
  kind: "live",
  lesson,
  tableNumber: 3,
  frame: frame(over),
});
const standby = (
  sceneIndex: number,
  completed = false,
  lesson = SAMPLE_LESSON,
): BoardScreenView => ({
  kind: "standby",
  lesson,
  tableNumber: 3,
  sceneIndex,
  completed,
});

/** Paints `view` on a fresh fake context and fails on anything drawn at NaN or a bad alpha. */
function paintOnce(view: BoardScreenView, size?: readonly [number, number]) {
  const fake = fakeContext(size);
  paintBoardScreen(fake.ctx, view, createBoardScreenMemory(), 1000);
  expect(fake.problems).toEqual([]);
  expect(fake.texts().length).toBeGreaterThan(0);
  return fake;
}

const LONG = "an unusually long label that has to wrap across several lines on the board";

/** One scene per visual template (plus an unknown one), with long text and full item counts. */
const EVERY_TEMPLATE: Lesson = (() => {
  const steps = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ label: `Step ${i + 1} ${LONG}`, description: LONG }));
  const labels = (n: number) => Array.from({ length: n }, (_, i) => `Label ${i + 1} ${LONG}`);
  const visuals: Visual[] = [
    { type: "concept", templateId: "hub", title: "A long hub title here", labels: labels(8) },
    { type: "concept", templateId: "grid", title: "Grid", labels: labels(8) },
    { type: "concept", templateId: "grid", title: "Four", labels: labels(4) },
    { type: "process", templateId: "flow", title: "Flow", steps: steps(8) },
    { type: "process", templateId: "flow", title: "Short flow", steps: steps(3) },
    { type: "process", templateId: "cycle", title: "Cycle", steps: steps(8) },
    { type: "process", templateId: "cycle", title: "Pair", steps: steps(2) },
    { type: "process", templateId: "timeline", title: "Timeline", steps: steps(8) },
    {
      type: "comparison",
      templateId: "two-column",
      title: "Compare",
      columns: ["Left heading", "Right heading"],
      labels: Array.from({ length: 8 }, (_, i) => `Row ${i} ${LONG} | ${LONG}`),
    },
    { type: "diagram", templateId: "labeled", title: "Diagram", labels: labels(8) },
    {
      type: "equation",
      templateId: "equation",
      title: "Equation",
      expression: `E = mc² ${LONG} ${LONG}`,
      explanation: `${LONG} ${LONG} ${LONG}`,
    },
    { type: "image", templateId: "description", title: "Picture", altText: `${LONG} ${LONG}` },
    { type: "concept", templateId: "mystery", labels: ["a", "b"] },
  ];
  const scenes: Scene[] = visuals.map((visual, i) => ({
    id: `s${i}`,
    title: `Scene ${i} ${LONG}`,
    narration: "Narration.",
    visual,
    sourceReferences: [],
  }));
  return { ...SAMPLE_LESSON, title: `${LONG} ${LONG}`, scenes };
})();

describe("wrapText", () => {
  const ctx = mono(10);

  it("wraps on word boundaries within the width", () => {
    expect(wrapText(ctx, "the quick brown fox", 100, 5)).toEqual(["the quick", "brown fox"]);
  });

  it("never returns a line wider than the width", () => {
    const lines = wrapText(ctx, `${LONG} ${LONG}`, 120, 99);
    expect(lines.length).toBeGreaterThan(5);
    for (const line of lines) expect(line.length * 10).toBeLessThanOrEqual(120);
    expect(lines.join(" ")).toBe(`${LONG} ${LONG}`);
  });

  it("collapses whitespace and returns nothing for empty text or no lines", () => {
    expect(wrapText(ctx, "  a \n\n b  ", 100, 3)).toEqual(["a b"]);
    expect(wrapText(ctx, "   ", 100, 3)).toEqual([]);
    expect(wrapText(ctx, "hello", 100, 0)).toEqual([]);
  });

  it("hard-breaks words longer than a line", () => {
    expect(wrapText(ctx, "abcdefghijklmnopqrstuvwxyz", 100, 5)).toEqual([
      "abcdefghij",
      "klmnopqrst",
      "uvwxyz",
    ]);
    expect(wrapText(ctx, "hi abcdefghijklmnop", 100, 5)).toEqual(["hi", "abcdefghij", "klmnop"]);
  });

  it("ends the last line with an ellipsis when the text runs over", () => {
    expect(wrapText(ctx, "the quick brown fox", 100, 1)).toEqual(["the quick…"]);
    expect(wrapText(ctx, "aaaa bbbb cccc dddd eeee ffff", 90, 2)).toEqual([
      "aaaa bbbb",
      "cccc ddd…",
    ]);
    const [only] = wrapText(ctx, "abcdefghijklmnopqrstuvwxyz", 100, 1);
    expect(only).toBe("abcdefghi…");
  });

  it("doesn't add an ellipsis when the text fits exactly", () => {
    expect(wrapText(ctx, "aaaa bbbb", 40, 2)).toEqual(["aaaa", "bbbb"]);
  });
});

describe("shownCount", () => {
  const steps = (n: number): Visual => ({
    type: "process",
    templateId: "flow",
    steps: Array.from({ length: n }, (_, i) => ({ label: `s${i}` })),
  });

  it("shows the first item at once and everything by 85% of the narration", () => {
    expect(shownCount(steps(4), 0)).toBe(1);
    expect(shownCount(steps(4), 0.2)).toBe(1);
    expect(shownCount(steps(4), 0.22)).toBe(2);
    expect(shownCount(steps(4), 0.849)).toBe(4);
    expect(shownCount(steps(4), 0.85)).toBe(4);
    expect(shownCount(steps(4), 1)).toBe(4);
  });

  it("treats visuals without items as one item, and bad progress as the start or end", () => {
    const eq: Visual = { type: "equation", templateId: "equation", expression: "a = b" };
    expect(shownCount(eq, 0)).toBe(1);
    expect(shownCount(eq, 1)).toBe(1);
    expect(shownCount(steps(4), -1)).toBe(1);
    expect(shownCount(steps(4), Number.NaN)).toBe(1);
    expect(shownCount(steps(4), 7)).toBe(4);
  });

  it("matches the studio's VisualRenderer for every sample visual", () => {
    for (const { visual } of [...SAMPLE_LESSON.scenes, ...EVERY_TEMPLATE.scenes]) {
      const n = itemCount(visual);
      for (let p = 0; p <= 1; p += 0.01)
        expect(shownCount(visual, p)).toBe(Math.min(n, Math.floor((p / 0.85) * n) + 1));
    }
  });
});

describe("paintBoardScreen", () => {
  it("paints every sample scene live, at any point of the narration and in any state", () => {
    SAMPLE_LESSON.scenes.forEach((scene, index) => {
      for (const progress of [0, 0.3, 0.6, 1])
        for (const state of ["idle", "loading", "playing", "paused", "ended"] as const) {
          const caption = progress > 0 ? scene.narration : "";
          const { texts } = paintOnce(live(SAMPLE_LESSON, { index, progress, state, caption }));
          expect(texts().join("")).toContain(scene.title);
        }
    });
  });

  it("paints every visual template, the fallback, and long text, without overflowing to NaN", () => {
    EVERY_TEMPLATE.scenes.forEach((_, index) => {
      for (const progress of [0, 0.5, 1]) paintOnce(live(EVERY_TEMPLATE, { index, progress }));
    });
    paintOnce(standby(0, false, EVERY_TEMPLATE));
  });

  it("keeps a long timeline's steps clear of the ones two along (the same side of its line)", () => {
    for (let n = 5; n <= 8; n++) {
      // Descriptions long enough to fill every line, tagged with their step.
      const steps = Array.from({ length: n }, (_, i) => ({
        label: `s${i}`,
        description: Array.from({ length: 40 }, () => `d${i}`).join(" "),
      }));
      const visual: Visual = { type: "process", templateId: "timeline", steps };
      const scene = { ...SAMPLE_LESSON.scenes[0]!, visual };
      const { calls } = paintOnce(live({ ...SAMPLE_LESSON, scenes: [scene] }, { progress: 1 }));
      // Step text is centred: each line spans its x ± half its width (14 px a character here).
      const lines = calls.flatMap((c) => {
        const [text, x, y] = c.args as [string, number, number];
        const step = c.name === "fillText" ? /^[sd](\d+)\b/.exec(text) : null;
        if (!step) return [];
        const half = (Array.from(text).length * 14) / 2;
        return [{ step: Number(step[1]), left: x - half, right: x + half, y }];
      });
      expect(lines.length).toBeGreaterThan(n);
      for (const a of lines)
        for (const b of lines)
          if (b.step === a.step + 2 && Math.abs(a.y - b.y) < 1)
            expect(b.left - a.right, `${n} steps: ${a.step} and ${b.step}`).toBeGreaterThan(20);
    }
  });

  it("shows the header, the scene count and the state", () => {
    const paused = paintOnce(live(SAMPLE_LESSON, { index: 1, state: "paused" })).texts();
    expect(paused).toContain("Scene 2 / 6");
    expect(paused).toContain("Paused");
    expect(paused.join("")).toContain("TABLE 3 · LESSON");
    expect(paintOnce(live(SAMPLE_LESSON, { state: "loading" })).texts()).toContain("Loading…");
  });

  it("paints the standby screen with its status and call to action", () => {
    const status = (view: BoardScreenView) => paintOnce(view).texts();
    expect(status(standby(0))).toContain("Ready to start");
    expect(status(standby(2))).toContain("Paused at scene 3 of 6");
    expect(status(standby(5, true))).toContain("Finished");
    const ready = status(standby(0));
    expect(ready).toContain("Cellular respiration");
    expect(ready).toContain("6 scenes · about 5 min");
    expect(ready).toContain("J");
  });

  it("paints the knowledge check over the visual, with lettered options", () => {
    const texts = paintOnce(
      live(SAMPLE_LESSON, { index: 4, progress: 1, state: "ended", showQuestion: true }),
    ).texts();
    expect(texts).toContain("Which stage makes most of the cell's ATP?");
    expect(texts).toEqual(expect.arrayContaining(["A", "B", "C", "D", "Answer on your screen"]));
  });

  it("paints reflection prompts and five-option questions", () => {
    const base = SAMPLE_LESSON.scenes[4]!;
    const ask = (interaction: Scene["interaction"]) =>
      paintOnce(
        live(
          { ...SAMPLE_LESSON, scenes: [{ ...base, interaction }, SAMPLE_LESSON.scenes[0]!] },
          { progress: 1, state: "ended", showQuestion: true },
        ),
      ).texts();
    expect(ask({ type: "reflection", question: `Why? ${LONG}` })).toContain(
      "Answer on your screen",
    );
    const five = ask({
      type: "multiple-choice",
      question: `${LONG} ${LONG} ${LONG}`,
      options: [LONG, LONG, LONG, LONG, LONG],
      correctIndex: 0,
    });
    expect(five).toContain("E");
  });

  it("paints the finished lesson card", () => {
    const texts = paintOnce(
      live(SAMPLE_LESSON, { index: 5, progress: 1, state: "ended", complete: true }),
    ).texts();
    expect(texts).toContain("Lesson complete");
    expect(texts).toContain("End the lesson to flip the board back");
  });

  it("fully redraws the canvas, at any canvas size", () => {
    for (const [w, h] of [
      [1280, 866],
      [640, 433],
      [1000, 1000],
    ] as const) {
      const { calls } = paintOnce(live(SAMPLE_LESSON), [w, h]);
      const first = calls.find((c) => c.name === "fillRect");
      expect(first?.args).toEqual([0, 0, w, h]);
    }
  });

  it("reveals new items over ~450 ms and cross-fades scene changes over ~300 ms", () => {
    const { ctx } = fakeContext();
    const memory = createBoardScreenMemory();
    const at = (view: BoardScreenView, now: number) =>
      paintBoardScreen(ctx, view, memory, now).animating;

    // A fresh board shows its scene as it is: nothing to animate.
    expect(at(live(SAMPLE_LESSON, { index: 1, progress: 0 }), 0)).toBe(false);
    // The narration moves on and a second step appears: it eases in, then settles.
    expect(at(live(SAMPLE_LESSON, { index: 1, progress: 0.3 }), 100)).toBe(true);
    expect(at(live(SAMPLE_LESSON, { index: 1, progress: 0.3 }), 400)).toBe(true);
    expect(at(live(SAMPLE_LESSON, { index: 1, progress: 0.3 }), 560)).toBe(false);
    // The next scene cross-fades in.
    expect(at(live(SAMPLE_LESSON, { index: 2, progress: 0 }), 1000)).toBe(true);
    expect(at(live(SAMPLE_LESSON, { index: 2, progress: 0 }), 1250)).toBe(true);
    expect(at(live(SAMPLE_LESSON, { index: 2, progress: 0 }), 1310)).toBe(false);
    // The question card fades in when the narration ends.
    const ask = { index: 4, progress: 1, state: "ended" as const };
    expect(at(live(SAMPLE_LESSON, ask), 2000)).toBe(true);
    expect(at(live(SAMPLE_LESSON, ask), 2400)).toBe(false);
    expect(at(live(SAMPLE_LESSON, { ...ask, showQuestion: true }), 2500)).toBe(true);
    expect(at(live(SAMPLE_LESSON, { ...ask, showQuestion: true }), 2900)).toBe(false);
    // Standby is a different screen too.
    expect(at(standby(4), 3000)).toBe(true);
    expect(at(standby(4), 3400)).toBe(false);
  });

  describe("with reduced motion", () => {
    const query = { matches: true };
    // The painter keeps the first media query it gets, so this stays the last test to stub it.
    beforeAll(() => vi.stubGlobal("matchMedia", () => query));
    afterAll(() => {
      query.matches = false;
      vi.unstubAllGlobals();
    });

    it("never animates", () => {
      const { ctx } = fakeContext();
      const memory = createBoardScreenMemory();
      const at = (view: BoardScreenView, now: number) =>
        paintBoardScreen(ctx, view, memory, now).animating;
      expect(at(live(SAMPLE_LESSON, { index: 1, progress: 0 }), 0)).toBe(false);
      expect(at(live(SAMPLE_LESSON, { index: 1, progress: 0.5 }), 10)).toBe(false);
      expect(at(live(SAMPLE_LESSON, { index: 2 }), 20)).toBe(false);
    });
  });
});
