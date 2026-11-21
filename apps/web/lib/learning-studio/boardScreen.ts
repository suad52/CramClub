import { displayFont, uiFont } from "@/lib/whiteboard/placeholder";
import { BOARD_SCREEN, type BoardScreenView, type LiveBoardFrame } from "./boardLessons";
import type { Interaction, Visual } from "./schema";

/**
 * Paints a board lesson onto the lesson face of a rolling whiteboard: a canvas the 3D board uses
 * as its texture. People read it from across the reading hall, so it's laid out like a typeset
 * slide on a cream board: big type, strong contrast, lots of room and nothing small.
 *
 * Pure Canvas 2D, and the same (view, memory, now) always paints the same picture. The only state
 * is a small per-board `memory` that times the step-by-step reveals and the scene cross-fades.
 */

/** The studio's palette (app/globals.css). */
const C = {
  parchment: "#f5ede0",
  cream: "#fbf7ef",
  ink: "#2d2420",
  inkSoft: "#66574c",
  wood: "#9a6a43",
  woodDark: "#6e4a33",
  sage: "#6f8f6a",
  sageDark: "#56734f",
  ember: "#c8743f",
  lamp: "#ffd99a",
  membrane: "#e9dcc4",
  paper: "rgba(255, 255, 255, 0.72)",
  emberRing: "rgba(200, 116, 63, 0.5)",
} as const;
const ink = (alpha: number) => `rgba(45, 36, 32, ${alpha})`;

/** Everything is laid out on the board's own canvas size and scaled to whatever canvas it gets. */
const W = BOARD_SCREEN.width;
const H = BOARD_SCREEN.height;
const X0 = 64;
const X1 = W - 64;
const CW = X1 - X0;
const HEADER_Y = 62;
const RULE_Y = 98;
const TITLE_Y = 146;
const ACCENT_Y = 184;
const CAPTION = { y: 684, h: 92 };
const BAR_Y = 798;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Where the scene's visual goes, between its title and the caption strip. */
const VISUAL: Box = { x: X0, y: 204, w: CW, h: 464 };
/** The question and "complete" cards cover the visual and the caption strip. */
const OVERLAY: Box = { x: X0, y: 204, w: CW, h: 572 };

const REVEAL_MS = 450;
const FADE_MS = 300;
/** How far (px) a newly revealed item rises as it fades in. */
const RISE = 16;

type LiveView = Extract<BoardScreenView, { kind: "live" }>;
type StandbyView = Extract<BoardScreenView, { kind: "standby" }>;

/** Per-board animation state. Treat it as opaque: only {@link paintBoardScreen} reads or writes it. */
export interface BoardScreenMemory {
  /** The screen (standby, or one scene of a lesson) the last paint showed. */
  key: string | null;
  /** The view painted last; it fades out when the screen changes. */
  last: BoardScreenView | null;
  /** The screen fading out, and when the fade began (ms). */
  previous: BoardScreenView | null;
  changedAt: number;
  /** When each revealed item of the current scene first showed (ms, by item index). */
  revealedAt: number[];
  /** The card over the visual (a question or "complete"), and when it first showed. */
  overlay: Overlay;
  overlayAt: number;
}

type Overlay = "question" | "complete" | null;

export function createBoardScreenMemory(): BoardScreenMemory {
  return {
    key: null,
    last: null,
    previous: null,
    changedAt: -Infinity,
    revealedAt: [],
    overlay: null,
    overlayAt: -Infinity,
  };
}

/**
 * Redraws the whole board face for `view` at time `now` (ms, any steady clock). Returns whether a
 * reveal or fade is still running, so the caller knows to paint again next frame.
 */
export function paintBoardScreen(
  ctx: CanvasRenderingContext2D,
  view: BoardScreenView,
  memory: BoardScreenMemory,
  now: number,
): { animating: boolean } {
  const still = reducedMotion();
  const key = screenKey(view);
  const shown = view.kind === "live" ? liveShown(view) : 0;
  const overlay = overlayOf(view);
  if (key !== memory.key) {
    memory.previous = memory.key === null || still ? null : memory.last;
    memory.changedAt = memory.previous ? now : -Infinity;
    memory.key = key;
    // Whatever is already showing arrives with the scene (the cross-fade), not item by item.
    memory.revealedAt = Array.from({ length: shown }, () => -Infinity);
    memory.overlay = overlay;
    memory.overlayAt = -Infinity;
  }
  // Replaying a scene hides its items again, so they reveal afresh.
  if (memory.revealedAt.length > shown) memory.revealedAt.length = shown;
  while (memory.revealedAt.length < shown) memory.revealedAt.push(now);
  if (overlay !== memory.overlay) {
    memory.overlay = overlay;
    memory.overlayAt = now;
  }

  let animating = false;
  const progressSince = (start: number, ms: number) => {
    if (still) return 1;
    const t = clamp01((now - start) / ms);
    if (t < 1) animating = true;
    return t;
  };
  const fade = ease(progressSince(memory.changedAt, FADE_MS));
  if (fade >= 1) memory.previous = null;
  const reveal = memory.revealedAt.map((start) => ease(progressSince(start, REVEAL_MS)));
  const overlayIn = overlay ? ease(progressSince(memory.overlayAt, FADE_MS)) : 0;

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.setLineDash([]);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  paintBackground(ctx, width, height);
  const scale = Math.min(width / W, height / H);
  ctx.setTransform(scale, 0, 0, scale, (width - W * scale) / 2, (height - H * scale) / 2);

  paintHeader(ctx, view);
  if (memory.previous) {
    ctx.globalAlpha = 1 - fade;
    paintBody(ctx, memory.previous, settled(memory.previous), 1);
  }
  ctx.globalAlpha = memory.previous ? fade : 1;
  paintBody(ctx, view, { shown, at: (i) => reveal[i] ?? 0 }, overlayIn);
  ctx.globalAlpha = 1;
  paintFooter(ctx, view);
  ctx.restore();

  memory.last = view;
  return { animating };
}

// ---------------------------------------------------------------------------------------------
// Text

/** All wrapping needs from a 2D context (so it can be tested without a canvas). */
type TextMeasure = { measureText(text: string): { width: number } };

/**
 * Word-wraps `text` to lines no wider than `maxWidth` in the context's current font. Words too
 * long for a line are broken; if it needs more than `maxLines`, the last line ends in "…".
 */
export function wrapText(
  ctx: TextMeasure,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (maxLines < 1 || words.length === 0) return [];
  const width = (s: string) => ctx.measureText(s).width;
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (lines.length > maxLines) break;
    const joined = line ? `${line} ${word}` : word;
    if (width(joined) <= maxWidth) {
      line = joined;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (width(line) > maxWidth) {
      const chars = Array.from(line);
      let fit = 1;
      while (fit < chars.length && width(chars.slice(0, fit + 1).join("")) <= maxWidth) fit++;
      lines.push(chars.slice(0, fit).join(""));
      line = chars.slice(fit).join("");
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  const last = Array.from(kept[maxLines - 1]!);
  while (last.length > 0 && width(`${last.join("").trimEnd()}…`) > maxWidth) last.pop();
  kept[maxLines - 1] = `${last.join("").trimEnd()}…`;
  return kept;
}

type Family = "display" | "ui";
let families: Record<Family, string> | null = null;

/** A canvas font in the app's own faces (Fraunces and Nunito from next/font), looked up once. */
function font(weight: number, size: number, family: Family = "ui"): string {
  families ??= { display: displayFont(), ui: uiFont() };
  return `${weight} ${size}px ${families[family]}`;
}

interface TextStyle {
  size: number;
  color: string;
  weight?: number;
  family?: Family;
  align?: CanvasTextAlign;
  lineHeight?: number;
  maxLines?: number;
}

/** Wrapped text, measured but not drawn yet (so cards can be sized around it). */
interface TextBlock {
  lines: string[];
  font: string;
  color: string;
  align: CanvasTextAlign;
  lineHeight: number;
  height: number;
}

function textBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  s: TextStyle,
): TextBlock {
  const f = font(s.weight ?? 700, s.size, s.family);
  ctx.font = f;
  const lines = wrapText(ctx, text, maxWidth, s.maxLines ?? 1);
  const lineHeight = s.lineHeight ?? Math.round(s.size * 1.2);
  return {
    lines,
    font: f,
    color: s.color,
    align: s.align ?? "left",
    lineHeight,
    height: lines.length * lineHeight,
  };
}

/** `text` at the largest of `sizes` that fits in `maxLines`, or at the smallest, cut short. */
function fitBlock(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  sizes: number[],
  maxLines: number,
  s: Omit<TextStyle, "size" | "lineHeight" | "maxLines">,
  leading = 1.12,
): TextBlock {
  const at = (size: number, lines: number) =>
    textBlock(ctx, text, maxWidth, {
      ...s,
      size,
      lineHeight: Math.round(size * leading),
      maxLines: lines,
    });
  for (const size of sizes) {
    const block = at(size, maxLines + 1);
    if (block.lines.length <= maxLines) return block;
  }
  return at(sizes[sizes.length - 1] ?? 32, maxLines);
}

/** Draws a block with its first line's top at `top`; `x` is its left, centre or right edge. */
function drawText(ctx: CanvasRenderingContext2D, b: TextBlock, x: number, top: number) {
  ctx.font = b.font;
  ctx.fillStyle = b.color;
  ctx.textAlign = b.align;
  ctx.textBaseline = "middle";
  b.lines.forEach((line, i) => ctx.fillText(line, x, top + b.lineHeight * (i + 0.5)));
}

/** Letter-spaced caps, glyph by glyph (canvas `letterSpacing` isn't in every browser yet). */
function caps(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  o: { size: number; color: string; spacing: number; align?: "left" | "right" },
) {
  ctx.font = font(800, o.size);
  ctx.fillStyle = o.color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const chars = Array.from(text.toUpperCase());
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + o.spacing * Math.max(0, chars.length - 1);
  let cx = o.align === "right" ? x - total : x;
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i]! + o.spacing;
  });
}

// ---------------------------------------------------------------------------------------------
// Shapes

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A soft card: a faint offset shadow (far cheaper than shadowBlur), the fill and a hairline ring. */
function card(
  ctx: CanvasRenderingContext2D,
  b: Box,
  r: number,
  fill: string,
  ring: string = ink(0.1),
) {
  roundRect(ctx, b.x, b.y + 5, b.w, b.h, r);
  ctx.fillStyle = ink(0.07);
  ctx.fill();
  roundRect(ctx, b.x, b.y, b.w, b.h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A filled arrowhead with its tip at (x, y), pointing along `angle`. */
function arrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  size: number,
  color: string,
) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - dx * size - dy * size * 0.6, y - dy * size + dx * size * 0.6);
  ctx.lineTo(x - dx * size + dy * size * 0.6, y - dy * size - dx * size * 0.6);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function check(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(x - size * 0.42, y + size * 0.02);
  ctx.lineTo(x - size * 0.12, y + size * 0.32);
  ctx.lineTo(x + size * 0.46, y - size * 0.3);
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.2;
  ctx.stroke();
}

function pauseBars(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, color: string) {
  const w = h * 0.3;
  ctx.fillStyle = color;
  ctx.fillRect(x - w * 1.35, y - h / 2, w, h);
  ctx.fillRect(x + w * 0.35, y - h / 2, w, h);
}

// ---------------------------------------------------------------------------------------------
// Reveal and timing

/** How a visual's items are revealed: how many show, and how far in each one is (0–1, eased). */
interface Reveal {
  shown: number;
  at: (i: number) => number;
}

const clamp01 = (t: number) => (t > 0 ? (t < 1 ? t : 1) : 0);
const ease = (t: number) => 1 - (1 - t) ** 3;

/** How many items a visual reveals over its scene (as visuals.tsx `itemCount`). */
const itemCount = (visual: Visual) =>
  Math.max(1, visual.steps?.length ?? visual.labels?.length ?? 1);

/**
 * How many of a visual's items show at narration `progress` (0–1). The same mapping as the
 * studio's VisualRenderer: one item at a time, everything out by 85% of the narration.
 */
export function shownCount(visual: Visual, progress: number): number {
  const n = itemCount(visual);
  const p = Number.isFinite(progress) ? clamp01(progress) : 0;
  return Math.min(n, Math.floor((p / 0.85) * n) + 1);
}

/** Draws item `i` faded (and risen) by its reveal. Hidden items draw at `hidden` opacity, if any. */
function item(
  ctx: CanvasRenderingContext2D,
  rv: Reveal,
  i: number,
  draw: (rise: number) => void,
  hidden = 0,
  full = 1,
) {
  const t = rv.at(i);
  const alpha = hidden + (full - hidden) * t;
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  draw(hidden > 0 ? 0 : (1 - t) * RISE);
  ctx.restore();
}

const clampIndex = (i: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor(i) || 0));
const sceneOf = (view: LiveView) =>
  view.lesson.scenes[clampIndex(view.frame.index, view.lesson.scenes.length)];

function liveShown(view: LiveView) {
  const scene = sceneOf(view);
  return scene ? shownCount(scene.visual, view.frame.progress) : 0;
}

/** The fully revealed state of a view (for a screen that's fading out). */
const settled = (view: BoardScreenView): Reveal => {
  const shown = view.kind === "live" ? liveShown(view) : 0;
  return { shown, at: (i) => (i < shown ? 1 : 0) };
};

function screenKey(view: BoardScreenView) {
  if (view.kind === "standby") return `standby|${view.lesson.title}`;
  return `live|${view.lesson.title}|${view.frame.index}|${sceneOf(view)?.id ?? ""}`;
}

function overlayOf(view: BoardScreenView): Overlay {
  if (view.kind !== "live") return null;
  if (view.frame.complete) return "complete";
  return view.frame.showQuestion && sceneOf(view)?.interaction ? "question" : null;
}

let motionQuery: MediaQueryList | undefined;
/** Honours the OS "reduce motion" setting: no reveals or fades, just the end state. */
function reducedMotion(): boolean {
  if (!motionQuery && typeof matchMedia === "function")
    motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
  return motionQuery?.matches ?? false;
}

// ---------------------------------------------------------------------------------------------
// The board face

function paintBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const paper = ctx.createLinearGradient(0, 0, 0, height);
  paper.addColorStop(0, "#f9f3e9");
  paper.addColorStop(1, "#f1e6d4");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  // A faint inner mat, so the face reads as a slide set into the board.
  const inset = Math.min(width, height) * 0.022;
  roundRect(ctx, inset, inset, width - inset * 2, height - inset * 2, inset * 1.2);
  ctx.strokeStyle = "rgba(154, 106, 67, 0.2)";
  ctx.lineWidth = Math.max(1, inset * 0.15);
  ctx.stroke();
}

function paintHeader(ctx: CanvasRenderingContext2D, view: BoardScreenView) {
  const table = view.tableNumber > 0 ? `Table ${view.tableNumber} · Lesson` : "Lesson";
  caps(ctx, table, X0, HEADER_Y, { size: 22, color: C.woodDark, spacing: 4 });
  if (view.kind === "standby") {
    caps(ctx, view.lesson.difficulty.replace("-", " "), X1, HEADER_Y, {
      size: 20,
      color: C.inkSoft,
      spacing: 4,
      align: "right",
    });
  } else {
    const n = view.lesson.scenes.length;
    const label = `Scene ${clampIndex(view.frame.index, n) + 1} / ${n}`;
    ctx.font = font(800, 26);
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(label, X1, HEADER_Y);
    const right = X1 - ctx.measureText(label).width - 20;
    if (view.frame.state === "loading") badge(ctx, "Loading…", right, C.lamp, C.ink, false);
    else if (view.frame.state === "paused") badge(ctx, "Paused", right, C.ink, C.cream, true);
  }
  ctx.fillStyle = ink(0.12);
  ctx.fillRect(X0, RULE_Y - 1, CW, 2);
}

function badge(
  ctx: CanvasRenderingContext2D,
  text: string,
  right: number,
  fill: string,
  color: string,
  paused: boolean,
) {
  ctx.font = font(800, 22);
  const icon = paused ? 26 : 0;
  const w = ctx.measureText(text).width + icon + 40;
  const h = 42;
  roundRect(ctx, right - w, HEADER_Y - h / 2, w, h, h / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (paused) pauseBars(ctx, right - w + 29, HEADER_Y, 16, color);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, right - w + 20 + icon, HEADER_Y + 1);
}

/** The part of the face that cross-fades when the screen changes. */
function paintBody(
  ctx: CanvasRenderingContext2D,
  view: BoardScreenView,
  rv: Reveal,
  overlayIn: number,
) {
  if (view.kind === "standby") paintStandby(ctx, view);
  else paintLive(ctx, view, rv, overlayIn);
}

function paintFooter(ctx: CanvasRenderingContext2D, view: BoardScreenView) {
  const n = view.lesson.scenes.length;
  if (view.kind === "standby") {
    progressBar(ctx, n, (i) => (view.completed || i < view.sceneIndex ? 1 : 0));
    return;
  }
  const { frame } = view;
  if (!overlayOf(view)) paintCaption(ctx, frame);
  const current = clampIndex(frame.index, n);
  progressBar(ctx, n, (i) =>
    frame.complete || i < current ? 1 : i === current ? frame.progress : 0,
  );
}

/** One segment per scene: past scenes full, the current one as far as the narration has got. */
function progressBar(ctx: CanvasRenderingContext2D, count: number, fill: (i: number) => number) {
  if (count < 1) return;
  const gap = 10;
  const h = 12;
  const w = (CW - gap * (count - 1)) / count;
  for (let i = 0; i < count; i++) {
    const x = X0 + i * (w + gap);
    roundRect(ctx, x, BAR_Y, w, h, h / 2);
    ctx.fillStyle = ink(0.12);
    ctx.fill();
    const f = Number.isFinite(fill(i)) ? clamp01(fill(i)) : 0;
    if (f <= 0) continue;
    roundRect(ctx, x, BAR_Y, w * f, h, h / 2);
    ctx.fillStyle = C.wood;
    ctx.fill();
  }
}

function paintCaption(ctx: CanvasRenderingContext2D, frame: LiveBoardFrame) {
  const speaking =
    frame.state === "playing" || frame.state === "loading" || frame.state === "paused";
  // Kept up between sentences while the lesson runs, so the strip doesn't flicker.
  if (!frame.caption && !speaking) return;
  roundRect(ctx, X0, CAPTION.y, CW, CAPTION.h, 24);
  ctx.fillStyle = ink(0.9);
  ctx.fill();
  const centre = CAPTION.y + CAPTION.h / 2;
  if (!frame.caption) {
    ctx.font = font(800, 34);
    ctx.fillStyle = "rgba(251, 247, 239, 0.55)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("…", W / 2, centre);
    return;
  }
  const b = textBlock(ctx, frame.caption, CW - 80, {
    size: 30,
    lineHeight: 37,
    maxLines: 2,
    color: C.cream,
    align: "center",
  });
  drawText(ctx, b, W / 2, centre - b.height / 2);
}

// ---------------------------------------------------------------------------------------------
// Live lesson

function paintLive(ctx: CanvasRenderingContext2D, view: LiveView, rv: Reveal, overlayIn: number) {
  const scene = sceneOf(view);
  if (!scene) return;
  const title = fitBlock(ctx, scene.title, CW, [56, 50, 44], 1, {
    weight: 600,
    family: "display",
    color: C.ink,
  });
  drawText(ctx, title, X0, TITLE_Y - title.height / 2);
  roundRect(ctx, X0, ACCENT_Y, 64, 6, 3);
  ctx.fillStyle = C.ember;
  ctx.fill();

  paintVisual(ctx, scene.visual, VISUAL, rv);

  const overlay = overlayOf(view);
  if (!overlay || overlayIn <= 0) return;
  ctx.save();
  ctx.globalAlpha *= overlayIn;
  veil(ctx);
  if (overlay === "complete") completeCard(ctx);
  else if (scene.interaction) questionCard(ctx, scene.interaction);
  ctx.restore();
}

/** Mutes the visual behind a card so the card reads cleanly. */
function veil(ctx: CanvasRenderingContext2D) {
  roundRect(ctx, OVERLAY.x - 16, OVERLAY.y - 8, OVERLAY.w + 32, OVERLAY.h + 16, 28);
  ctx.fillStyle = "rgba(245, 237, 224, 0.86)";
  ctx.fill();
}

function questionCard(ctx: CanvasRenderingContext2D, q: Interaction) {
  const w = 1080;
  const x = (W - w) / 2;
  const pad = 48;
  const inner = w - pad * 2;
  const options = q.type === "multiple-choice" ? (q.options ?? []) : [];
  const rows = Math.ceil(options.length / 2);
  const colGap = 18;
  const rowGap = 14;
  const colW = (inner - colGap) / 2;
  const ruled = 3;

  const build = (questionLines: number, optionLines: number) => {
    const question = textBlock(ctx, q.question, inner, {
      size: 44,
      weight: 600,
      family: "display",
      lineHeight: 52,
      maxLines: questionLines,
      color: C.ink,
    });
    const opts = options.map((o) =>
      textBlock(ctx, o, colW - 104, {
        size: 28,
        lineHeight: 34,
        maxLines: optionLines,
        color: C.ink,
      }),
    );
    const rowHeights = Array.from({ length: rows }, (_, r) =>
      Math.max(72, ...opts.slice(r * 2, r * 2 + 2).map((b) => b.height + 30)),
    );
    const body = options.length
      ? rowHeights.reduce((a, b) => a + b, 0) + rowGap * (rows - 1)
      : ruled * 44;
    const total = 40 + 24 + 18 + question.height + 28 + body + 30 + 28 + 36;
    return { question, opts, rowHeights, total };
  };
  let L = options.length ? build(3, 2) : build(4, 0);
  if (L.total > OVERLAY.h) L = build(2, 2);
  if (L.total > OVERLAY.h) L = build(2, 1);

  const y = OVERLAY.y + Math.max(0, (OVERLAY.h - L.total) / 2);
  const h = Math.min(L.total, OVERLAY.h);
  card(ctx, { x, y, w, h }, 28, C.cream);
  ctx.save();
  roundRect(ctx, x, y, w, h, 28);
  ctx.clip();
  ctx.fillStyle = C.ember;
  ctx.fillRect(x, y, w, 8);
  ctx.restore();

  let top = y + 40;
  caps(ctx, options.length ? "Knowledge check" : "Reflection", x + pad, top + 12, {
    size: 20,
    color: C.ember,
    spacing: 4,
  });
  top += 24 + 18;
  drawText(ctx, L.question, x + pad, top);
  top += L.question.height + 28;

  if (options.length) {
    L.rowHeights.forEach((rh, r) => {
      for (let c = 0; c < 2; c++) {
        const i = r * 2 + c;
        const b = L.opts[i];
        if (!b) continue;
        const ox = x + pad + c * (colW + colGap);
        roundRect(ctx, ox, top, colW, rh, 18);
        ctx.fillStyle = C.paper;
        ctx.fill();
        ctx.strokeStyle = ink(0.15);
        ctx.lineWidth = 2;
        ctx.stroke();
        circle(ctx, ox + 44, top + rh / 2, 24, C.wood);
        ctx.font = font(800, 24);
        ctx.fillStyle = C.cream;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String.fromCharCode(65 + i), ox + 44, top + rh / 2 + 1);
        drawText(ctx, b, ox + 86, top + (rh - b.height) / 2);
      }
      top += rh + rowGap;
    });
    top += 30 - rowGap;
  } else {
    // Notebook rules: somewhere to think, while the answer is written on each person's screen.
    ctx.fillStyle = "rgba(154, 106, 67, 0.28)";
    for (let i = 1; i <= ruled; i++) ctx.fillRect(x + pad, top + i * 44 - 6, inner, 2);
    top += ruled * 44 + 30;
  }

  // "Answer on your screen", with a little monitor.
  const hintY = top + 14;
  ctx.font = font(800, 24);
  const hint = "Answer on your screen";
  const tw = ctx.measureText(hint).width;
  const left = W / 2 - (tw + 44) / 2;
  roundRect(ctx, left, hintY - 13, 30, 20, 4);
  ctx.strokeStyle = C.inkSoft;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = C.inkSoft;
  ctx.fillRect(left + 9, hintY + 10, 12, 3);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(hint, left + 44, hintY);
}

function completeCard(ctx: CanvasRenderingContext2D) {
  const w = 760;
  const h = 304;
  const x = (W - w) / 2;
  const y = OVERLAY.y + (OVERLAY.h - h) / 2;
  card(ctx, { x, y, w, h }, 28, C.cream);
  circle(ctx, W / 2, y + 88, 48, C.sage);
  check(ctx, W / 2, y + 88, 46, C.cream);
  const title = textBlock(ctx, "Lesson complete", w - 80, {
    size: 54,
    weight: 600,
    family: "display",
    lineHeight: 62,
    color: C.ink,
    align: "center",
  });
  drawText(ctx, title, W / 2, y + 158);
  const sub = textBlock(ctx, "End the lesson to flip the board back", w - 80, {
    size: 28,
    lineHeight: 36,
    color: C.inkSoft,
    align: "center",
  });
  drawText(ctx, sub, W / 2, y + 232);
}

// ---------------------------------------------------------------------------------------------
// Standby: the lesson waiting on the board

function paintStandby(ctx: CanvasRenderingContext2D, view: StandbyView) {
  const { lesson } = view;
  const n = lesson.scenes.length;
  caps(ctx, lesson.subject, X0, 136, { size: 22, color: C.ember, spacing: 5 });

  let y = 160;
  const title = fitBlock(ctx, lesson.title, CW, [92, 80, 68], 2, {
    weight: 600,
    family: "display",
    color: C.ink,
  });
  drawText(ctx, title, X0, y);
  y += title.height + 14;
  const minutes = Math.max(1, Math.round(lesson.estimatedMinutes));
  const meta = textBlock(ctx, `${n} scene${n === 1 ? "" : "s"} · about ${minutes} min`, CW, {
    size: 30,
    lineHeight: 36,
    color: C.inkSoft,
  });
  drawText(ctx, meta, X0, y);
  y += meta.height + 34;

  const statusY = 650;
  const limit = statusY - 36;
  const lineH = 36;
  if (lesson.learningObjectives.length && y + 26 + lineH <= limit) {
    caps(ctx, "In this lesson", X0, y + 10, { size: 20, color: C.woodDark, spacing: 4 });
    y += 36;
    for (const objective of lesson.learningObjectives.slice(0, 3)) {
      const room = Math.floor((limit - y) / lineH);
      if (room < 1) break;
      const b = textBlock(ctx, objective, CW - 40, {
        size: 28,
        weight: 600,
        lineHeight: lineH,
        maxLines: Math.min(2, room),
        color: C.ink,
      });
      circle(ctx, X0 + 8, y + lineH / 2, 7, C.sage);
      drawText(ctx, b, X0 + 32, y);
      y += b.height + 12;
    }
  }

  const index = clampIndex(view.sceneIndex, n);
  const [status, colour]: [string, string] = view.completed
    ? ["Finished", C.sageDark]
    : index > 0
      ? [`Paused at scene ${index + 1} of ${n}`, C.ember]
      : ["Ready to start", C.sage];
  circle(ctx, X0 + 18, statusY, 18, colour);
  if (view.completed) check(ctx, X0 + 18, statusY, 20, C.cream);
  else if (index > 0) pauseBars(ctx, X0 + 18, statusY, 14, C.cream);
  else arrowHead(ctx, X0 + 25, statusY, 0, 14, C.cream);
  ctx.font = font(800, 30);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(status, X0 + 50, statusY + 1);

  callToAction(ctx, 690, 84);
}

/** "Walk up and press [J] to join" on a dark strip, with J drawn as a key. */
function callToAction(ctx: CanvasRenderingContext2D, top: number, h: number) {
  roundRect(ctx, X0, top, CW, h, 26);
  ctx.fillStyle = C.ink;
  ctx.fill();
  const before = "Walk up and press";
  const after = "to join";
  ctx.font = font(800, 36);
  const key = 56;
  const gap = 16;
  const wBefore = ctx.measureText(before).width;
  const wAfter = ctx.measureText(after).width;
  let x = W / 2 - (wBefore + gap + key + gap + wAfter) / 2;
  const cy = top + h / 2;
  ctx.fillStyle = C.cream;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(before, x, cy + 1);
  x += wBefore + gap;
  roundRect(ctx, x, cy - key / 2 + 4, key, key, 12);
  ctx.fillStyle = C.woodDark;
  ctx.fill();
  roundRect(ctx, x, cy - key / 2, key, key - 4, 12);
  ctx.fillStyle = C.lamp;
  ctx.fill();
  ctx.font = font(900, 32);
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.fillText("J", x + key / 2, cy);
  x += key + gap;
  ctx.font = font(800, 36);
  ctx.fillStyle = C.cream;
  ctx.textAlign = "left";
  ctx.fillText(after, x, cy + 1);
}

// ---------------------------------------------------------------------------------------------
// Visual templates (mirroring components/learning-studio/visuals.tsx)

type Template = (ctx: CanvasRenderingContext2D, v: Visual, area: Box, rv: Reveal) => void;

function paintVisual(ctx: CanvasRenderingContext2D, visual: Visual, area: Box, rv: Reveal) {
  const paint = TEMPLATES[`${visual.type}/${visual.templateId}`];
  if (!paint) {
    fallbackCard(ctx, visual, area);
    return;
  }
  let box = area;
  // The hub puts its title in the middle; everything else has it on top.
  if (visual.title && !(visual.type === "concept" && visual.templateId === "hub")) {
    const t = textBlock(ctx, visual.title, area.w, {
      size: 32,
      weight: 600,
      family: "display",
      lineHeight: 40,
      color: C.ink,
      align: "center",
    });
    drawText(ctx, t, area.x + area.w / 2, area.y);
    box = { x: area.x, y: area.y + 56, w: area.w, h: area.h - 56 };
  }
  paint(ctx, visual, box, rv);
}

/** A label centred in a cream (or, for the current step, lamp-lit) card. */
function labelCard(
  ctx: CanvasRenderingContext2D,
  b: TextBlock,
  cx: number,
  cy: number,
  w: number,
  current = false,
) {
  const h = b.height + 28;
  card(
    ctx,
    { x: cx - w / 2, y: cy - h / 2, w, h },
    18,
    current ? C.lamp : C.cream,
    current ? C.emberRing : undefined,
  );
  drawText(ctx, b, cx, cy - b.height / 2);
}

const conceptHub: Template = (ctx, v, A, rv) => {
  const labels = v.labels ?? [];
  const n = labels.length;
  const cx = A.x + A.w / 2;
  const cy = A.y + A.h / 2;
  const rx = Math.min(A.w / 2 - 150, 420);
  const ry = A.h / 2 - 50;
  const pos = (i: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as const;
  };
  ctx.setLineDash([10, 10]);
  ctx.strokeStyle = C.wood;
  ctx.lineWidth = 3;
  labels.forEach((_, i) =>
    item(
      ctx,
      rv,
      i,
      () => {
        const [x, y] = pos(i);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
      },
      0,
      0.6,
    ),
  );
  ctx.setLineDash([]);

  circle(ctx, cx, cy + 6, 100, ink(0.1));
  circle(ctx, cx, cy, 100, C.wood);
  const title = textBlock(ctx, v.title ?? "", 164, {
    size: 28,
    weight: 600,
    family: "display",
    lineHeight: 32,
    maxLines: 3,
    color: C.cream,
    align: "center",
  });
  drawText(ctx, title, cx, cy - title.height / 2);

  labels.forEach((label, i) =>
    item(ctx, rv, i, (rise) => {
      const [x, y] = pos(i);
      const b = textBlock(ctx, label, 236, {
        size: 26,
        weight: 800,
        lineHeight: 31,
        maxLines: 2,
        color: C.ink,
        align: "center",
      });
      labelCard(ctx, b, x, y + rise, 270);
    }),
  );
};

const conceptGrid: Template = (ctx, v, A, rv) => {
  const labels = v.labels ?? [];
  const n = labels.length;
  if (!n) return;
  const cols = n <= 3 ? n : n === 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const gap = 22;
  const w = Math.min(360, (A.w - gap * (cols - 1)) / cols);
  const blocks = labels.map((l) =>
    textBlock(ctx, l, w - 40, {
      size: 30,
      weight: 800,
      lineHeight: 36,
      maxLines: rows >= 3 ? 2 : 3,
      color: C.ink,
      align: "center",
    }),
  );
  const h = Math.min(
    Math.max(...blocks.map((b) => b.height)) + 48,
    (A.h - gap * (rows - 1)) / rows,
  );
  const top = A.y + (A.h - rows * h - gap * (rows - 1)) / 2;
  labels.forEach((_, i) =>
    item(ctx, rv, i, (rise) => {
      const r = Math.floor(i / cols);
      const inRow = Math.min(cols, n - r * cols);
      const left = A.x + (A.w - inRow * w - gap * (inRow - 1)) / 2;
      const x = left + (i % cols) * (w + gap);
      const y = top + r * (h + gap) + rise;
      card(ctx, { x, y, w, h }, 20, C.cream);
      const b = blocks[i]!;
      drawText(ctx, b, x + w / 2, y + (h - b.height) / 2);
    }),
  );
};

/** A step's label and (optional) description, measured. */
function stepBlocks(
  ctx: CanvasRenderingContext2D,
  steps: NonNullable<Visual["steps"]>,
  width: number,
  descLines: number,
  large: boolean,
) {
  return steps.map((s) => {
    const label = textBlock(ctx, s.label, width, {
      size: large ? 31 : 28,
      weight: 800,
      lineHeight: large ? 37 : 33,
      maxLines: 2,
      color: C.ink,
      align: "center",
    });
    const desc = s.description
      ? textBlock(ctx, s.description, width, {
          size: large ? 24 : 22,
          weight: 600,
          lineHeight: large ? 30 : 27,
          maxLines: descLines,
          color: C.inkSoft,
          align: "center",
        })
      : null;
    return { label, desc, height: label.height + (desc ? 8 + desc.height : 0) };
  });
}

function drawStep(
  ctx: CanvasRenderingContext2D,
  s: ReturnType<typeof stepBlocks>[number],
  cx: number,
  top: number,
) {
  drawText(ctx, s.label, cx, top);
  if (s.desc) drawText(ctx, s.desc, cx, top + s.label.height + 8);
}

const processFlow: Template = (ctx, v, A, rv) => {
  const steps = v.steps ?? [];
  const n = steps.length;
  if (!n) return;
  const rows = n <= 4 ? 1 : 2;
  const perRow = Math.ceil(n / rows);
  const arrow = 56;
  const rowGap = 36;
  const w = Math.min(300, (A.w - arrow * (perRow - 1)) / perRow);
  const blocks = stepBlocks(ctx, steps, w - 32, rows > 1 ? 2 : 3, rows === 1);
  const heights = Array.from(
    { length: rows },
    (_, r) =>
      Math.max(...blocks.slice(r * perRow, (r + 1) * perRow).map((b) => b.height)) +
      (rows === 1 ? 56 : 40),
  );
  let y = A.y + (A.h - heights.reduce((a, b) => a + b, 0) - rowGap * (rows - 1)) / 2;
  const rowTops = heights.map((h) => {
    const top = y;
    y += h + rowGap;
    return top;
  });
  steps.forEach((_, i) =>
    item(ctx, rv, i, (rise) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      const inRow = Math.min(perRow, n - r * perRow);
      const left = A.x + (A.w - inRow * w - arrow * (inRow - 1)) / 2;
      const x = left + c * (w + arrow);
      const top = rowTops[r]! + rise;
      const h = heights[r]!;
      const current = i === rv.shown - 1;
      card(
        ctx,
        { x, y: top, w, h },
        20,
        current ? C.lamp : C.cream,
        current ? C.emberRing : undefined,
      );
      const b = blocks[i]!;
      drawStep(ctx, b, x + w / 2, top + (h - b.height) / 2);
      if (c < inRow - 1) {
        const ay = top + h / 2;
        ctx.strokeStyle = C.wood;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(x + w + 12, ay);
        ctx.lineTo(x + w + arrow - 22, ay);
        ctx.stroke();
        arrowHead(ctx, x + w + arrow - 10, ay, 0, 14, C.wood);
      }
    }),
  );
};

const processCycle: Template = (ctx, v, A, rv) => {
  const steps = v.steps ?? [];
  const n = steps.length;
  if (!n) return;
  const cx = A.x + A.w / 2;
  const cy = A.y + A.h / 2;
  const rx = Math.min(A.w / 2 - 150, 380);
  const ry = A.h / 2 - 52;
  const w = 232;
  const angle = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const at = (a: number) => [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as const;
  const blocks = steps.map((s) =>
    textBlock(ctx, s.label, w - 28, {
      size: 25,
      weight: 800,
      lineHeight: 30,
      maxLines: 2,
      color: C.ink,
      align: "center",
    }),
  );
  // How far round the ellipse to start or stop an arrow so it clears step i's card.
  const clearance = (i: number, dir: 1 | -1) => {
    const [px, py] = at(angle(i));
    const hw = w / 2 + 12;
    const hh = blocks[i]!.height / 2 + 26;
    let d = 0;
    while (d < Math.PI / n) {
      const [x, y] = at(angle(i) + dir * d);
      if (Math.abs(x - px) > hw || Math.abs(y - py) > hh) break;
      d += 0.01;
    }
    return d;
  };
  const step = 10 / ((rx + ry) / 2);
  ctx.lineWidth = 4;
  steps.forEach((_, i) => {
    const a0 = angle(i) + clearance(i, 1);
    const a1 = angle(i + 1) - clearance((i + 1) % n, -1);
    if (a1 - a0 <= step) return;
    item(
      ctx,
      rv,
      i,
      () => {
        ctx.strokeStyle = C.wood;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, a0, a1 - step);
        ctx.stroke();
        const [x, y] = at(a1);
        const tangent = Math.atan2(Math.cos(a1) * ry, -Math.sin(a1) * rx);
        arrowHead(ctx, x, y, tangent, 16, C.wood);
      },
      0.15,
      0.8,
    );
  });

  // The ↻ in the middle.
  ctx.strokeStyle = "rgba(102, 87, 76, 0.75)";
  ctx.lineWidth = 6;
  const end = -Math.PI / 2 + Math.PI * 1.7;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, -Math.PI / 2 + 0.25, end);
  ctx.stroke();
  arrowHead(
    ctx,
    cx + Math.cos(end + 0.22) * 30,
    cy + Math.sin(end + 0.22) * 30,
    end + Math.PI / 2,
    16,
    "rgba(102, 87, 76, 0.75)",
  );

  steps.forEach((_, i) =>
    item(ctx, rv, i, (rise) => {
      const [x, y] = at(angle(i));
      labelCard(ctx, blocks[i]!, x, y + rise, w, i === rv.shown - 1);
    }),
  );
};

/** A timeline laid along the board's width (it's wide, not tall), alternating sides when long. */
const processTimeline: Template = (ctx, v, A, rv) => {
  const steps = v.steps ?? [];
  const n = steps.length;
  if (!n) return;
  const alternate = n > 4;
  const slot = A.w / n;
  const space = 28;
  const w = alternate ? Math.min(2 * slot - space, 330) : Math.min(slot - space, 340);
  // Text wider than its slot can't centre under the first or last dot without running off the
  // board, so those two are pushed inward. When alternating, that would run them into the step
  // two along (on the same side of the line), so they wrap narrower to keep clear of it.
  const endW = alternate ? Math.min(w, 2.5 * slot - w / 2 - space) : w;
  const widthOf = (i: number) => (i === 0 || i === n - 1 ? endW : w);
  const blocks = steps.map(
    (s, i) => stepBlocks(ctx, [s], widthOf(i), alternate ? 2 : 3, !alternate)[0]!,
  );
  const tallest = Math.max(...blocks.map((b) => b.height));
  const gap = 36;
  const lineY = alternate ? A.y + A.h / 2 : A.y + (A.h - (gap + tallest)) / 2 + 8;
  const dotX = (i: number) => A.x + slot * (i + 0.5);

  ctx.strokeStyle = "rgba(154, 106, 67, 0.4)";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(dotX(0) - 36, lineY);
  ctx.lineTo(dotX(n - 1) + 36, lineY);
  ctx.stroke();

  steps.forEach((_, i) =>
    item(ctx, rv, i, (rise) => {
      const x = dotX(i);
      circle(ctx, x, lineY, 21, C.cream);
      circle(ctx, x, lineY, 14, C.wood);
      const b = blocks[i]!;
      const above = alternate && i % 2 === 1;
      // Text wider than its slot stays on the board, even if it can't sit right under its dot.
      const half = widthOf(i) / 2;
      const cx = Math.max(A.x + half, Math.min(A.x + A.w - half, x));
      drawStep(ctx, b, cx, (above ? lineY - gap - b.height : lineY + gap) + rise);
    }),
  );
};

const comparison: Template = (ctx, v, A, rv) => {
  const [left = "", right = ""] = v.columns ?? [];
  const rows = (v.labels ?? []).map((row) => {
    const [a = "", b = ""] = row.split("|").map((x) => x.trim());
    return [a, b] as const;
  });
  const tw = Math.min(A.w, 1040);
  const tx = A.x + (A.w - tw) / 2;
  const headH = 64;
  const rowH = rows.length ? Math.max(40, Math.min(90, (A.h - headH) / rows.length)) : 0;
  const size = rowH < 52 ? 23 : 26;
  const lines = rowH >= 84 ? 2 : 1;
  const th = headH + rows.length * rowH;
  const ty = A.y + (A.h - th) / 2;
  const colW = tw / 2;
  const pad = 28;

  card(ctx, { x: tx, y: ty, w: tw, h: th }, 22, C.cream);
  ctx.save();
  roundRect(ctx, tx, ty, tw, th, 22);
  ctx.clip();
  ctx.fillStyle = C.wood;
  ctx.fillRect(tx, ty, tw, headH);
  [left, right].forEach((heading, c) => {
    const b = textBlock(ctx, heading, colW - pad * 2, { size: 26, weight: 800, color: C.cream });
    drawText(ctx, b, tx + c * colW + pad, ty + (headH - b.height) / 2);
  });
  rows.forEach(([a, b], i) =>
    item(ctx, rv, i, (rise) => {
      const y = ty + headH + i * rowH;
      ctx.fillStyle = ink(0.1);
      ctx.fillRect(tx, y, tw, 2);
      const cells = [
        textBlock(ctx, a, colW - pad * 2, {
          size,
          weight: 800,
          lineHeight: size + 5,
          maxLines: lines,
          color: C.ink,
        }),
        textBlock(ctx, b, colW - pad * 2, {
          size,
          weight: 600,
          lineHeight: size + 5,
          maxLines: lines,
          color: C.inkSoft,
        }),
      ];
      cells.forEach((cell, c) =>
        drawText(ctx, cell, tx + c * colW + pad, y + (rowH - cell.height) / 2 + rise),
      );
    }),
  );
  ctx.restore();
  roundRect(ctx, tx, ty, tw, th, 22);
  ctx.strokeStyle = ink(0.1);
  ctx.lineWidth = 2;
  ctx.stroke();
};

const labeledDiagram: Template = (ctx, v, A, rv) => {
  const labels = v.labels ?? [];
  const n = labels.length;
  if (!n) return;
  const barX = A.x + 24;
  const barW = A.w - 48;
  const barY = A.y + 6;
  const barH = 68;
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fillStyle = C.membrane;
  ctx.fill();
  ctx.strokeStyle = C.wood;
  ctx.lineWidth = 3;
  ctx.stroke();
  labels.forEach((_, i) =>
    item(
      ctx,
      rv,
      i,
      () => {
        const x = barX + 24 + (i + 0.5) * ((barW - 48) / n);
        const current = i === rv.shown - 1;
        circle(ctx, x, barY + barH / 2, 24, current ? C.lamp : C.wood);
        ctx.font = font(800, 24);
        ctx.fillStyle = current ? C.ink : C.cream;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), x, barY + barH / 2 + 1);
      },
      0.15,
    ),
  );

  const rows = Math.ceil(n / 2);
  const listTop = barY + barH + 26;
  const listH = A.y + A.h - listTop;
  const rowH = Math.min(84, listH / rows);
  const colGap = 40;
  const colW = (A.w - colGap) / 2;
  const top = listTop + (listH - rows * rowH) / 2;
  labels.forEach((label, i) =>
    item(ctx, rv, i, (rise) => {
      const x = A.x + (i % 2) * (colW + colGap);
      const y = top + Math.floor(i / 2) * rowH + rise;
      circle(ctx, x + 20, y + rowH / 2, 20, C.wood);
      ctx.font = font(800, 20);
      ctx.fillStyle = C.cream;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), x + 20, y + rowH / 2 + 1);
      const b = textBlock(ctx, label, colW - 64, {
        size: 26,
        weight: 700,
        lineHeight: 31,
        maxLines: rowH >= 70 ? 2 : 1,
        color: C.ink,
      });
      drawText(ctx, b, x + 56, y + (rowH - b.height) / 2);
    }),
  );
};

const equation: Template = (ctx, v, A) => {
  const w = Math.min(A.w, 1000);
  const expr = fitBlock(ctx, v.expression ?? "", w - 80, [60, 52, 44, 38], 2, {
    weight: 500,
    family: "display",
    color: C.ink,
    align: "center",
  });
  const cardH = expr.height + 84;
  const explanation = v.explanation
    ? textBlock(ctx, v.explanation, Math.min(A.w, 920), {
        size: 28,
        weight: 600,
        lineHeight: 36,
        maxLines: 3,
        color: C.inkSoft,
        align: "center",
      })
    : null;
  const total = cardH + (explanation ? 28 + explanation.height : 0);
  const y = A.y + (A.h - total) / 2;
  const cx = A.x + A.w / 2;
  card(ctx, { x: cx - w / 2, y, w, h: cardH }, 28, C.cream);
  drawText(ctx, expr, cx, y + 42);
  if (explanation) drawText(ctx, explanation, cx, y + cardH + 28);
};

/** The picture described in words, in a framed card (the lesson has no real image). */
const description: Template = (ctx, v, A) => {
  const w = Math.min(A.w, 800);
  const text = textBlock(ctx, v.altText ?? "", w - 96, {
    size: 28,
    weight: 600,
    lineHeight: 37,
    maxLines: 5,
    color: C.inkSoft,
    align: "center",
  });
  const icon = 84;
  const h = 44 + icon + 26 + text.height + 44;
  const cx = A.x + A.w / 2;
  const x = cx - w / 2;
  const y = A.y + (A.h - h) / 2;
  card(ctx, { x, y, w, h }, 28, C.cream);
  roundRect(ctx, x + 14, y + 14, w - 28, h - 28, 18);
  ctx.strokeStyle = "rgba(154, 106, 67, 0.35)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // A small framed landscape: sun over two hills.
  const fw = icon * 1.4;
  const fx = cx - fw / 2;
  const fy = y + 44;
  roundRect(ctx, fx, fy, fw, icon, 10);
  ctx.fillStyle = C.parchment;
  ctx.fill();
  ctx.save();
  ctx.clip();
  circle(ctx, fx + fw * 0.72, fy + icon * 0.32, icon * 0.13, C.lamp);
  ctx.fillStyle = C.sage;
  ctx.beginPath();
  ctx.moveTo(fx, fy + icon);
  ctx.lineTo(fx + fw * 0.34, fy + icon * 0.45);
  ctx.lineTo(fx + fw * 0.62, fy + icon);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = C.sageDark;
  ctx.beginPath();
  ctx.moveTo(fx + fw * 0.4, fy + icon);
  ctx.lineTo(fx + fw * 0.7, fy + icon * 0.6);
  ctx.lineTo(fx + fw, fy + icon);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  roundRect(ctx, fx, fy, fw, icon, 10);
  ctx.strokeStyle = C.wood;
  ctx.lineWidth = 5;
  ctx.stroke();

  drawText(ctx, text, cx, fy + icon + 26);
};

function fallbackCard(ctx: CanvasRenderingContext2D, v: Visual, A: Box) {
  const w = Math.min(A.w, 800);
  const text = textBlock(
    ctx,
    v.title ?? "This scene has no picture yet: follow along with the narration.",
    w - 96,
    { size: 30, lineHeight: 38, maxLines: 3, color: C.inkSoft, align: "center" },
  );
  const h = text.height + 80;
  const cx = A.x + A.w / 2;
  const y = A.y + (A.h - h) / 2;
  card(ctx, { x: cx - w / 2, y, w, h }, 28, C.cream);
  drawText(ctx, text, cx, y + 40);
}

const TEMPLATES: Record<string, Template> = {
  "concept/hub": conceptHub,
  "concept/grid": conceptGrid,
  "process/flow": processFlow,
  "process/cycle": processCycle,
  "process/timeline": processTimeline,
  "comparison/two-column": comparison,
  "diagram/labeled": labeledDiagram,
  "equation/equation": equation,
  "image/description": description,
};
