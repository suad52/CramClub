import { describe, expect, it } from "vitest";
import { FACIAL_HEAD_LIMITS } from "@ovr/shared";
import {
  type RawFace,
  OneEuroFilter,
  averageFaces,
  extractRawFace,
  headAnglesFromMatrix,
  toFacialParams,
} from "./mapping";

/** Column-major 4×4 from a 3×3 rotation given as rows. */
function columnMajor(r: number[][]): number[] {
  const m = new Array(16).fill(0);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row]![col]!;
  m[15] = 1;
  return m;
}
const rotY = (a: number) =>
  columnMajor([
    [Math.cos(a), 0, Math.sin(a)],
    [0, 1, 0],
    [-Math.sin(a), 0, Math.cos(a)],
  ]);
const rotX = (a: number) =>
  columnMajor([
    [1, 0, 0],
    [0, Math.cos(a), -Math.sin(a)],
    [0, Math.sin(a), Math.cos(a)],
  ]);
const rotZ = (a: number) =>
  columnMajor([
    [Math.cos(a), -Math.sin(a), 0],
    [Math.sin(a), Math.cos(a), 0],
    [0, 0, 1],
  ]);

const neutral: RawFace = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  blinkLeft: 0.1,
  blinkRight: 0.1,
  jawOpen: 0.05,
  smile: 0.1,
  browRaise: 0.1,
};

describe("headAnglesFromMatrix", () => {
  it("reads a straight-on face as zero", () => {
    const a = headAnglesFromMatrix(
      columnMajor([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]),
    )!;
    expect(a.yaw).toBeCloseTo(0);
    expect(a.pitch).toBeCloseTo(0);
    expect(a.roll).toBeCloseTo(0);
  });

  it("reads a turn toward the user's left as positive yaw", () => {
    expect(headAnglesFromMatrix(rotY(0.3))!.yaw).toBeCloseTo(0.3);
  });

  it("reads looking up as positive pitch", () => {
    // Rotating about X by a negative angle tips the nose up (+Y).
    const a = headAnglesFromMatrix(rotX(-0.2))!;
    expect(a.pitch).toBeCloseTo(0.2);
    expect(a.yaw).toBeCloseTo(0);
  });

  it("reads a tilt toward the user's left shoulder as positive roll", () => {
    expect(headAnglesFromMatrix(rotZ(-0.25))!.roll).toBeCloseTo(0.25);
  });

  it("rejects malformed matrices", () => {
    expect(headAnglesFromMatrix([1, 2, 3])).toBeNull();
    expect(headAnglesFromMatrix(new Array(16).fill(0))).toBeNull();
  });
});

describe("extractRawFace", () => {
  it("returns null when no face was found", () => {
    expect(extractRawFace([], undefined)).toBeNull();
    expect(extractRawFace(undefined, undefined)).toBeNull();
  });

  it("averages the two smile sides and takes the stronger brow signal", () => {
    const raw = extractRawFace(
      [
        { categoryName: "mouthSmileLeft", score: 0.6 },
        { categoryName: "mouthSmileRight", score: 0.4 },
        { categoryName: "browInnerUp", score: 0.2 },
        { categoryName: "browOuterUpLeft", score: 0.7 },
        { categoryName: "browOuterUpRight", score: 0.5 },
        { categoryName: "eyeBlinkLeft", score: 0.9 },
      ],
      rotY(0.1),
    )!;
    expect(raw.smile).toBeCloseTo(0.5);
    expect(raw.browRaise).toBeCloseTo(0.6);
    expect(raw.blinkLeft).toBeCloseTo(0.9);
    expect(raw.blinkRight).toBe(0);
    expect(raw.yaw).toBeCloseTo(0.1);
  });
});

describe("toFacialParams", () => {
  it("is all zeros for the resting face", () => {
    const p = toFacialParams(neutral, neutral, { mirror: false });
    expect(Object.values(p).every((v) => Math.abs(v) < 1e-9)).toBe(true);
  });

  it("measures expressions relative to the resting face and clamps to [0, 1]", () => {
    const p = toFacialParams(
      { ...neutral, blinkLeft: 0.95, smile: 0.1 + 0.55 / 2, jawOpen: 0 },
      neutral,
      { mirror: false },
    );
    expect(p.eyeBlinkLeft).toBe(1);
    expect(p.smile).toBeCloseTo(0.5);
    expect(p.jawOpen).toBe(0);
  });

  it("scales head angles by the shared limits and clamps them", () => {
    const p = toFacialParams({ ...neutral, yaw: FACIAL_HEAD_LIMITS.yaw / 2, pitch: 5 }, neutral, {
      mirror: false,
    });
    expect(p.headYaw).toBeCloseTo(0.5);
    expect(p.headPitch).toBe(1);
  });

  it("mirror mode flips turn and tilt and swaps the eyes", () => {
    const raw = { ...neutral, yaw: 0.3, roll: 0.1, blinkLeft: 0.9 };
    const normal = toFacialParams(raw, neutral, { mirror: false });
    const mirrored = toFacialParams(raw, neutral, { mirror: true });
    expect(mirrored.headYaw).toBeCloseTo(-normal.headYaw);
    expect(mirrored.headRoll).toBeCloseTo(-normal.headRoll);
    expect(mirrored.eyeBlinkRight).toBeCloseTo(normal.eyeBlinkLeft);
    expect(mirrored.eyeBlinkLeft).toBeCloseTo(normal.eyeBlinkRight);
  });

  it("averages calibration samples", () => {
    const avg = averageFaces([neutral, { ...neutral, yaw: 0.2, smile: 0.3 }]);
    expect(avg.yaw).toBeCloseTo(0.1);
    expect(avg.smile).toBeCloseTo(0.2);
  });
});

describe("OneEuroFilter", () => {
  it("settles on a constant value", () => {
    const f = new OneEuroFilter(1, 0.5);
    let v = 0;
    for (let i = 0; i < 120; i++) v = f.filter(1, i / 30);
    // First sample initialises the filter at 1 and it stays there.
    expect(v).toBeCloseTo(1);
  });

  it("damps jitter around a still value", () => {
    const f = new OneEuroFilter(1, 0.2);
    const out: number[] = [];
    for (let i = 0; i < 300; i++) out.push(f.filter(0.5 + (i % 2 ? 0.05 : -0.05), i / 30));
    const tail = out.slice(100);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(0.05);
  });

  it("follows a real move instead of lagging forever", () => {
    const f = new OneEuroFilter(1, 1.5);
    f.filter(0, 0);
    let v = 0;
    for (let i = 1; i <= 15; i++) v = f.filter(1, i / 30);
    expect(v).toBeGreaterThan(0.9);
  });
});
