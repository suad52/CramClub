import { describe, expect, it } from "vitest";
import {
  CEIL_DB,
  FLOOR_DB,
  HEARD_LEVEL,
  HEARD_MS,
  levelFromRms,
  litBars,
  nextHeardMs,
  peakRms,
  rmsOf,
  smoothLevel,
} from "./meter";

const dbToRms = (db: number) => 10 ** (db / 20);

describe("rmsOf", () => {
  it("is 0 for silence or no samples, and the amplitude over √2 for a sine", () => {
    expect(rmsOf([])).toBe(0);
    expect(rmsOf(new Float32Array(256))).toBe(0);
    const sine = Array.from({ length: 1000 }, (_, i) => 0.5 * Math.sin((i / 1000) * Math.PI * 20));
    expect(rmsOf(sine)).toBeCloseTo(0.5 / Math.SQRT2, 3);
  });
});

describe("peakRms", () => {
  it("finds a short beep in a long quiet window at full strength", () => {
    // A 20 ms beep (Chrome's fake microphone) somewhere in ~170 ms of silence, at 48 kHz.
    const buf = new Float32Array(8192);
    for (let i = 4000; i < 4960; i++) buf[i] = 0.5 * Math.sin(i * 0.05);
    expect(rmsOf(buf)).toBeLessThan(0.15);
    expect(peakRms(buf)).toBeGreaterThan(0.3);
    expect(levelFromRms(peakRms(buf))).toBeGreaterThanOrEqual(HEARD_LEVEL);
  });

  it("is 0 for silence or no samples, and the RMS for a steady sound", () => {
    expect(peakRms([])).toBe(0);
    expect(peakRms(new Float32Array(2048))).toBe(0);
    const sine = Array.from({ length: 4096 }, (_, i) => 0.5 * Math.sin((i / 64) * Math.PI * 2));
    expect(peakRms(sine)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });
});

describe("levelFromRms", () => {
  it("maps the decibel range onto 0 … 1 and clamps outside it", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(Number.NaN)).toBe(0);
    expect(levelFromRms(dbToRms(FLOOR_DB - 10))).toBe(0);
    expect(levelFromRms(dbToRms(CEIL_DB + 3))).toBe(1);
    expect(levelFromRms(dbToRms((FLOOR_DB + CEIL_DB) / 2))).toBeCloseTo(0.5, 5);
  });

  it("hears quiet speech but not a quiet room", () => {
    expect(levelFromRms(dbToRms(-30))).toBeGreaterThanOrEqual(HEARD_LEVEL);
    expect(levelFromRms(dbToRms(-50))).toBeLessThan(HEARD_LEVEL);
  });
});

describe("smoothLevel", () => {
  it("jumps up at once and falls back over a few frames", () => {
    expect(smoothLevel(0.2, 0.9, 16)).toBe(0.9);
    const once = smoothLevel(0.9, 0, 16);
    expect(once).toBeLessThan(0.9);
    expect(once).toBeGreaterThan(0.7);
    expect(smoothLevel(0.9, 0, 1000)).toBe(0);
  });
});

describe("nextHeardMs", () => {
  it("adds loud frames only, capping a long frame", () => {
    expect(nextHeardMs(0, HEARD_LEVEL, 16)).toBe(16);
    expect(nextHeardMs(50, HEARD_LEVEL - 0.01, 16)).toBe(50);
    expect(nextHeardMs(0, 1, 5000)).toBe(100);
    expect(nextHeardMs(0, 1, -5)).toBe(0);
    expect(nextHeardMs(0, 1, 5000, 170)).toBe(170);
  });

  it("needs the voice to stay up a little while, not one click", () => {
    let ms = 0;
    ms = nextHeardMs(ms, 1, 16);
    expect(ms).toBeLessThan(HEARD_MS);
    for (let i = 0; i < 20; i++) ms = nextHeardMs(ms, 0.8, 16);
    expect(ms).toBeGreaterThanOrEqual(HEARD_MS);
  });
});

describe("litBars", () => {
  it("lights a share of the bars, clamped", () => {
    expect(litBars(0, 12)).toBe(0);
    expect(litBars(0.5, 12)).toBe(6);
    expect(litBars(2, 12)).toBe(12);
    expect(litBars(-1, 12)).toBe(0);
  });
});
