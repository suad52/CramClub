import { getStroke } from "perfect-freehand";
import { BOARD_H, BOARD_W, type BoardItem, type Rect, type StrokeItem } from "./types";

/** SVG path for a perfect-freehand outline (from the library's README). */
function pathFromOutline(points: number[][]): string {
  if (points.length === 0) return "";
  const d: (string | number)[] = ["M", points[0]![0]!, points[0]![1]!, "Q"];
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    d.push(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
  }
  d.push("Z");
  return d.join(" ");
}

const pathCache = new WeakMap<StrokeItem, Path2D>();

/** Pressure-sensitive outline of a stroke, cached per (immutable) stroke. */
export function strokePath(item: StrokeItem, live = false): Path2D {
  const cached = live ? undefined : pathCache.get(item);
  if (cached) return cached;
  const outline = getStroke(item.points, {
    size: item.size,
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: !item.pressure,
    last: !live,
  });
  const path = new Path2D(pathFromOutline(outline));
  if (!live) pathCache.set(item, path);
  return path;
}

/** The handwriting font for AI answers, loaded by next/font in the root layout. */
export function handFont(): string {
  if (typeof document === "undefined") return "cursive";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-caveat").trim();
  return v ? `${v}, cursive` : "cursive";
}

/**
 * Browsers only download a web font once something asks for it, and a canvas doesn't redraw by
 * itself when it arrives. Call this and redraw when it resolves.
 */
export function loadHandFont(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  return document.fonts.load(`48px ${handFont()}`).then(
    () => undefined,
    () => undefined,
  );
}

/** Loads AI answer images once and tells the board to redraw when they arrive. */
export class ImageCache {
  private readonly images = new Map<string, HTMLImageElement>();
  constructor(private readonly onLoad: () => void) {}

  get(src: string): HTMLImageElement | null {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.onLoad();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  /** Resolves once every image used by `items` is decoded (for snapshots). */
  async ready(items: readonly BoardItem[]): Promise<void> {
    await Promise.all(
      items.map(async (i) => {
        if (i.kind !== "image") return;
        this.get(i.src);
        await this.images
          .get(i.src)!
          .decode()
          .catch(() => {});
      }),
    );
  }
}

/** Draws items onto a context already scaled to board units. */
export function drawItems(
  ctx: CanvasRenderingContext2D,
  items: readonly BoardItem[],
  images: ImageCache,
) {
  for (const item of items) {
    if (item.kind === "stroke") {
      ctx.fillStyle = item.color;
      ctx.fill(strokePath(item));
    } else if (item.kind === "image") {
      const img = images.get(item.src);
      if (img) ctx.drawImage(img, item.x, item.y, item.w, item.h);
    } else {
      ctx.fillStyle = item.color;
      ctx.font = `${Math.round(item.lineHeight * 0.92)}px ${handFont()}`;
      ctx.textBaseline = "alphabetic";
      item.lines.forEach((line, i) => {
        ctx.fillText(
          line,
          item.x + item.lineHeight * 0.2,
          item.y + item.lineHeight * (0.95 + i * 1.2),
          item.w,
        );
      });
    }
  }
}

/**
 * Renders a region of the board onto a canvas of the given pixel size, on a white background.
 * Used for "Ask AI" snapshots and for the 3D whiteboard texture.
 */
export function renderRegion(
  ctx: CanvasRenderingContext2D,
  items: readonly BoardItem[],
  images: ImageCache,
  region: Rect = { x: 0, y: 0, w: BOARD_W, h: BOARD_H },
  pixelWidth = ctx.canvas.width,
  pixelHeight = ctx.canvas.height,
) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  const s = pixelWidth / region.w;
  ctx.setTransform(
    s,
    0,
    0,
    pixelHeight / region.h,
    -region.x * s,
    (-region.y * pixelHeight) / region.h,
  );
  drawItems(ctx, items, images);
  ctx.restore();
}
