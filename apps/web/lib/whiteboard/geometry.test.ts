import { describe, expect, it } from "vitest";
import {
  dominantInkColor,
  estimateLineHeight,
  hitsItem,
  insideBoard,
  intersects,
  itemBounds,
  planAnswerArea,
} from "./geometry";
import { BOARD_H, BOARD_W, type BoardItem, type StrokeItem } from "./types";

const stroke = (id: string, x: number, y: number, w: number, h: number): StrokeItem => ({
  kind: "stroke",
  id,
  points: [
    [x, y, 0.5],
    [x + w, y + h, 0.5],
  ],
  color: "#000000",
  size: 4,
  pressure: false,
});

describe("hitsItem", () => {
  it("hits a stroke near its line and misses it farther away", () => {
    const s = stroke("a", 100, 100, 100, 0);
    expect(hitsItem(s, 150, 108, 8)).toBe(true);
    expect(hitsItem(s, 150, 130, 8)).toBe(false);
  });

  it("hits image and text items anywhere inside their box", () => {
    const img: BoardItem = { kind: "image", id: "i", x: 10, y: 10, w: 50, h: 20, src: "", alt: "" };
    expect(hitsItem(img, 30, 20, 1)).toBe(true);
    expect(hitsItem(img, 100, 100, 1)).toBe(false);
  });
});

describe("estimateLineHeight", () => {
  it("follows the size of the user's letters", () => {
    const small = [
      stroke("a", 0, 0, 10, 20),
      stroke("b", 20, 0, 10, 22),
      stroke("c", 40, 0, 10, 18),
    ];
    const big = [stroke("a", 0, 0, 30, 80), stroke("b", 40, 0, 30, 76)];
    expect(estimateLineHeight(big)).toBeGreaterThan(estimateLineHeight(small));
  });

  it("isn't fooled by flat strokes like minus and equals signs", () => {
    // "7 - 2 =": two tall digits, three flat bars.
    const digits = [stroke("7", 0, 0, 55, 110), stroke("2", 175, 0, 60, 110)];
    const bars = [
      stroke("-", 90, 60, 50, 2),
      stroke("=1", 275, 50, 60, 2),
      stroke("=2", 275, 80, 60, 2),
    ];
    expect(estimateLineHeight([...digits, ...bars])).toBeGreaterThan(110);
  });

  it("falls back to a sensible default with nothing to measure", () => {
    expect(estimateLineHeight([])).toBe(64);
  });
});

describe("planAnswerArea", () => {
  const question = { x: 200, y: 150, w: 500, h: 120 };
  const lines = ["x = 4", "because 2x = 8"];

  it("puts the answer right below the question on an empty board", () => {
    const plan = planAnswerArea(question, lines, 60, [stroke("q", 210, 160, 400, 80)]);
    expect(plan.placement).toBe("below");
    expect(plan.rect.y).toBeGreaterThan(question.y + question.h);
    expect(plan.rect.x).toBe(question.x);
    expect(insideBoard(plan.rect)).toBe(true);
    expect(plan.lineHeight).toBe(60);
  });

  it("moves beside the question when the space below is taken", () => {
    const blocker = stroke("b", 150, 300, 700, 400);
    const plan = planAnswerArea(question, lines, 60, [blocker]);
    expect(plan.placement).not.toBe("below");
    expect(intersects(plan.rect, itemBounds(blocker))).toBe(false);
  });

  it("stays on the board for a question at the bottom-right corner", () => {
    const corner = { x: BOARD_W - 300, y: BOARD_H - 150, w: 280, h: 130 };
    const plan = planAnswerArea(corner, lines, 60, []);
    expect(insideBoard(plan.rect)).toBe(true);
    expect(intersects(plan.rect, corner)).toBe(false);
  });

  it("shrinks long answers rather than running off the board", () => {
    const long = Array.from({ length: 8 }, () => "a fairly long line of answer text");
    const plan = planAnswerArea({ x: 40, y: 40, w: 300, h: 80 }, long, 120, []);
    expect(insideBoard(plan.rect)).toBe(true);
    expect(plan.lineHeight).toBeLessThan(120);
  });
});

describe("dominantInkColor", () => {
  it("picks the colour most of the question was written in", () => {
    const red = { ...stroke("r", 0, 0, 100, 0), color: "#c0392b" };
    const longRed = {
      ...red,
      id: "r2",
      points: Array.from({ length: 30 }, (_, i) => [i, 0, 0.5] as [number, number, number]),
    };
    const blue = { ...stroke("b", 0, 0, 10, 0), color: "#2f6fb3" };
    expect(dominantInkColor([red, longRed, blue])).toBe("#c0392b");
    expect(dominantInkColor([])).toBeNull();
  });
});
