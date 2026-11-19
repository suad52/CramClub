import { describe, expect, it } from "vitest";
import { chooseAspectRatio, extractInk, hexToRgb, inkCoverage } from "./ink";

function image(width: number, height: number, fill: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...fill, 255], i * 4);
  return { data, width, height };
}

describe("chooseAspectRatio", () => {
  it("never crops and picks the tightest supported ratio", () => {
    for (const [w, h] of [
      [800, 600],
      [1000, 300],
      [300, 900],
      [512, 512],
    ] as const) {
      const fit = chooseAspectRatio(w, h);
      expect(fit.width).toBeGreaterThanOrEqual(w);
      expect(fit.height).toBeGreaterThanOrEqual(h);
      const [a, b] = fit.ratio.split(":").map(Number);
      expect(fit.width / fit.height).toBeCloseTo(a! / b!, 1);
    }
    expect(chooseAspectRatio(800, 600).ratio).toBe("4:3");
    expect(chooseAspectRatio(512, 512).ratio).toBe("1:1");
  });
});

describe("extractInk", () => {
  it("turns dark pixels inside the area into the pen colour and drops paper", () => {
    const img = image(4, 1, [255, 255, 255]);
    img.data.set([20, 20, 20, 255], 0); // dark ink, inside
    img.data.set([245, 243, 240, 255], 4); // off-white paper, inside
    img.data.set([30, 90, 170, 255], 8); // blue ink, inside
    img.data.set([10, 10, 10, 255], 12); // dark but outside the area
    const out = extractInk(img, { x: 0, y: 0, w: 3, h: 1 }, "#c0392b");
    expect(Array.from(out.slice(0, 4))).toEqual([192, 57, 43, 255]);
    expect(out[7]).toBe(0);
    expect(out[11]).toBeGreaterThan(200);
    expect(out[15]).toBe(0);
  });

  it("measures coverage so blank results can be rejected", () => {
    const blank = extractInk(
      image(10, 10, [255, 255, 255]),
      { x: 0, y: 0, w: 10, h: 10 },
      "#000000",
    );
    expect(inkCoverage(blank, 10, { x: 0, y: 0, w: 10, h: 10 })).toBe(0);
    const dark = extractInk(image(10, 10, [0, 0, 0]), { x: 0, y: 0, w: 10, h: 10 }, "#000000");
    expect(inkCoverage(dark, 10, { x: 0, y: 0, w: 10, h: 10 })).toBe(1);
  });

  it("parses hex colours and falls back to ink for bad input", () => {
    expect(hexToRgb("#2f6fb3")).toEqual([47, 111, 179]);
    expect(hexToRgb("blue")).toEqual([45, 36, 32]);
  });
});
