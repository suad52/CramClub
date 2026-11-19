/**
 * Image helpers for AI handwriting: picking an aspect ratio the image model supports, and
 * pulling just the new ink out of the model's output so it can sit on the board transparently.
 * Pure functions on raw RGBA arrays, so they're unit-testable without a browser.
 */

export const SUPPORTED_RATIOS = [
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
] as const;
export type AspectRatio = (typeof SUPPORTED_RATIOS)[number];

const ratioValue = (r: AspectRatio) => {
  const [a, b] = r.split(":").map(Number);
  return a! / b!;
};

/** The supported ratio that needs the least padding to hold a w×h image (never cropping). */
export function chooseAspectRatio(
  w: number,
  h: number,
): { ratio: AspectRatio; width: number; height: number } {
  let best: { ratio: AspectRatio; width: number; height: number } | null = null;
  for (const ratio of SUPPORTED_RATIOS) {
    const v = ratioValue(ratio);
    // Grow one side so the image fits exactly inside the padded canvas.
    const width = Math.max(w, Math.round(h * v));
    const height = Math.max(h, Math.round(width / v));
    if (!best || width * height < best.width * best.height) best = { ratio, width, height };
  }
  return best!;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [45, 36, 32];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Turns dark pixels inside `area` into ink of the given colour on a transparent background;
 * everything else becomes fully transparent. Darkness is measured by the strongest channel drop
 * from white, so coloured ink (blue, red) counts as ink while off-white paper doesn't.
 */
export function extractInk(
  img: RgbaImage,
  area: { x: number; y: number; w: number; h: number },
  inkHex: string,
): Uint8ClampedArray<ArrayBuffer> {
  const [ir, ig, ib] = hexToRgb(inkHex);
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  const x0 = Math.max(0, Math.floor(area.x));
  const y0 = Math.max(0, Math.floor(area.y));
  const x1 = Math.min(img.width, Math.ceil(area.x + area.w));
  const y1 = Math.min(img.height, Math.ceil(area.y + area.h));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const darkness = 255 - Math.min(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!);
      const alpha = Math.max(0, Math.min(1, (darkness - 45) / 110));
      if (alpha <= 0) continue;
      out[i] = ir;
      out[i + 1] = ig;
      out[i + 2] = ib;
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/** Fraction of pixels in `area` that ended up as ink: used to detect "the model wrote nothing". */
export function inkCoverage(
  ink: Uint8ClampedArray,
  width: number,
  area: { x: number; y: number; w: number; h: number },
): number {
  let count = 0;
  let total = 0;
  for (let y = Math.floor(area.y); y < Math.ceil(area.y + area.h); y++) {
    for (let x = Math.floor(area.x); x < Math.ceil(area.x + area.w); x++) {
      total++;
      if (ink[(y * width + x) * 4 + 3]! > 64) count++;
    }
  }
  return total === 0 ? 0 : count / total;
}
