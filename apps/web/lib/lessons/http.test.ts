import { describe, expect, it } from "vitest";
import { estimateCaptions, fitCaptions } from "@/lib/learning-studio/text";
import { parseRange, sceneParam } from "./http";

describe("parseRange", () => {
  it("serves the whole file without a usable Range header", () => {
    expect(parseRange(null, 1000)).toBeNull();
    expect(parseRange("", 1000)).toBeNull();
    expect(parseRange("items=0-5", 1000)).toBeNull();
    expect(parseRange("bytes=-", 1000)).toBeNull();
  });

  it("reads open, closed and suffix ranges, clamped to the file", () => {
    expect(parseRange("bytes=0-", 1000)).toEqual({ start: 0, end: 999 });
    expect(parseRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(parseRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
    expect(parseRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
    expect(parseRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
    // Only the first of several ranges is served.
    expect(parseRange("bytes=0-9, 20-29", 1000)).toEqual({ start: 0, end: 9 });
  });

  it("refuses ranges outside the file", () => {
    expect(parseRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=500-100", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });
});

describe("sceneParam", () => {
  it("accepts small whole numbers only", () => {
    expect(sceneParam("0")).toBe(0);
    expect(sceneParam("12")).toBe(12);
    expect(sceneParam(undefined)).toBeNull();
    expect(sceneParam("-1")).toBeNull();
    expect(sceneParam("1.5")).toBeNull();
    expect(sceneParam("1e3")).toBeNull();
    expect(sceneParam("../x")).toBeNull();
    expect(sceneParam("12345")).toBeNull();
  });
});

describe("fitCaptions", () => {
  it("stretches estimated captions to a stored clip's real length, keeping each share", () => {
    const est = estimateCaptions("A short one. Then a rather longer second sentence follows.");
    const fitted = fitCaptions(est, 10_000);
    expect(fitted).toHaveLength(2);
    expect(fitted[0]!.startMs).toBe(0);
    expect(fitted.at(-1)!.endMs).toBe(10_000);
    const share = (c: { startMs: number; endMs: number }[]) =>
      (c[0]!.endMs - c[0]!.startMs) / c.at(-1)!.endMs;
    expect(share(fitted)).toBeCloseTo(share(est), 2);
  });

  it("leaves captions alone when the length isn't known", () => {
    const est = estimateCaptions("One. Two.");
    expect(fitCaptions(est, Number.NaN)).toEqual(est);
    expect(fitCaptions(est, 0)).toEqual(est);
    expect(fitCaptions([], 5000)).toEqual([]);
  });
});
