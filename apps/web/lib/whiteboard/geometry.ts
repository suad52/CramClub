import { BOARD_H, BOARD_W, type BoardItem, type Point, type Rect } from "./types";

export function rectFromPoints(ax: number, ay: number, bx: number, by: number): Rect {
  return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
}

export function strokeBounds(points: readonly Point[], size: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = size / 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + size, h: maxY - minY + size };
}

export function itemBounds(item: BoardItem): Rect {
  return item.kind === "stroke"
    ? strokeBounds(item.points, item.size)
    : { x: item.x, y: item.y, w: item.w, h: item.h };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function insideBoard(r: Rect): boolean {
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= BOARD_W && r.y + r.h <= BOARD_H;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Whether an eraser of `radius` at (x, y) touches the item. */
export function hitsItem(item: BoardItem, x: number, y: number, radius: number): boolean {
  if (item.kind !== "stroke") {
    const b = itemBounds(item);
    return (
      x >= b.x - radius && x <= b.x + b.w + radius && y >= b.y - radius && y <= b.y + b.h + radius
    );
  }
  const reach = radius + item.size / 2;
  const pts = item.points;
  if (pts.length === 1) return Math.hypot(pts[0]![0] - x, pts[0]![1] - y) <= reach;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (distanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= reach) return true;
  }
  return false;
}

/** Items whose bounds overlap a selection. */
export function itemsInRect(items: readonly BoardItem[], rect: Rect): BoardItem[] {
  return items.filter((i) => intersects(itemBounds(i), rect));
}

/**
 * Guesses how tall the user's handwriting is from the strokes in the selection, so the answer
 * can be written at the same size. Flat strokes (minus signs, the bars of "=", t-crossings) say
 * nothing about letter height, so they're ignored; of the rest, the upper quartile approximates
 * the height of capitals and digits. A little extra is added for line spacing.
 */
export function estimateLineHeight(items: readonly BoardItem[]): number {
  const boxes = items
    .filter((i) => i.kind === "stroke")
    .map(itemBounds)
    .filter((b) => b.h > 6);
  const upright = boxes.filter((b) => b.h >= b.w * 0.35);
  const heights = (upright.length > 0 ? upright : boxes).map((b) => b.h).sort((a, b) => a - b);
  if (heights.length === 0) return 64;
  const upperQuartile = heights[Math.min(heights.length - 1, Math.floor(heights.length * 0.75))]!;
  return Math.min(160, Math.max(36, upperQuartile * 1.3));
}

export type Placement = "below" | "right" | "above" | "left";

export interface AnswerPlan {
  rect: Rect;
  placement: Placement;
  lineHeight: number;
}

const GAP = 24;

/**
 * Finds a blank area next to the question, big enough for the answer at the user's writing size.
 * Tries below, right, above, left (sliding along the edge to stay on the board). If no spot is
 * clear, the writing shrinks step by step; if it still can't fit, it takes the least crowded spot.
 */
export function planAnswerArea(
  selection: Rect,
  lines: readonly string[],
  lineHeight: number,
  items: readonly BoardItem[],
  /** Width of a line at a given line height; defaults to a rough per-character estimate. */
  measure?: (line: string, lineHeight: number) => number,
): AnswerPlan {
  const others = items.filter((i) => !intersects(itemBounds(i), selection)).map(itemBounds);
  const longest = Math.max(4, ...lines.map((l) => l.length));
  const count = Math.max(1, lines.length);
  const textWidth = (lh: number) =>
    measure
      ? Math.max(0, ...lines.map((l) => measure(l, lh))) + lh * 0.45
      : longest * lh * 0.52 + lh * 0.6;

  const candidatesAt = (lh: number) => {
    const w = Math.min(BOARD_W - 2 * GAP, Math.max(selection.w, textWidth(lh)));
    const h = Math.min(BOARD_H - 2 * GAP, count * lh * 1.2 + lh * 0.5);
    const slideX = (x: number) => Math.max(GAP, Math.min(x, BOARD_W - GAP - w));
    const slideY = (y: number) => Math.max(GAP, Math.min(y, BOARD_H - GAP - h));
    const list: { placement: Placement; rect: Rect }[] = [
      {
        placement: "below",
        rect: { x: slideX(selection.x), y: selection.y + selection.h + GAP, w, h },
      },
      {
        placement: "right",
        rect: { x: selection.x + selection.w + GAP, y: slideY(selection.y), w, h },
      },
      { placement: "above", rect: { x: slideX(selection.x), y: selection.y - GAP - h, w, h } },
      { placement: "left", rect: { x: selection.x - GAP - w, y: slideY(selection.y), w, h } },
    ];
    return list.filter((c) => insideBoard(c.rect));
  };
  const crowding = (r: Rect) => others.reduce((sum, o) => sum + overlapArea(o, r), 0);

  for (const scale of [1, 0.85, 0.7, 0.55, 0.4]) {
    const lh = lineHeight * scale;
    const clear = candidatesAt(lh).find((c) => crowding(c.rect) === 0);
    if (clear) return { ...clear, lineHeight: lh };
  }
  // Nothing is clear: use the least crowded spot at the largest size that fits on the board.
  for (const scale of [1, 0.85, 0.7, 0.55, 0.4]) {
    const lh = lineHeight * scale;
    const fitting = candidatesAt(lh);
    if (fitting.length > 0) {
      const best = fitting.sort((a, b) => crowding(a.rect) - crowding(b.rect))[0]!;
      return { ...best, lineHeight: lh };
    }
  }
  return {
    rect: { x: GAP, y: GAP, w: BOARD_W / 2, h: BOARD_H / 3 },
    placement: "below",
    lineHeight: lineHeight * 0.4,
  };
}

/** The ink colour used most (by stroke length) among the items, e.g. the colour a question was written in. */
export function dominantInkColor(items: readonly BoardItem[]): string | null {
  const weight = new Map<string, number>();
  for (const i of items) {
    if (i.kind !== "stroke") continue;
    weight.set(i.color, (weight.get(i.color) ?? 0) + i.points.length);
  }
  let best: string | null = null;
  let max = 0;
  for (const [color, w] of weight) {
    if (w > max) {
      best = color;
      max = w;
    }
  }
  return best;
}
