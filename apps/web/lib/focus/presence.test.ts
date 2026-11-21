import { describe, expect, it } from "vitest";
import type { FacialParams } from "@ovr/shared";
import {
  FACING,
  MAX_STEP_MS,
  type PresenceLook,
  type PresenceTally,
  addLook,
  cameraCounts,
  emptyTally,
  faceSeen,
  missingMs,
  presencePayload,
  seenPercent,
} from "./presence";

const face = (headYaw = 0, headPitch = 0): FacialParams => ({
  headYaw,
  headPitch,
  headRoll: 0,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  jawOpen: 0,
  smile: 0,
  browRaise: 0,
});

const T0 = 1_000_000;

/** Looks once a second for `seconds`, all seeing the same thing. */
function run(t: PresenceTally, from: number, seconds: number, look: Omit<PresenceLook, "at">) {
  let out = t;
  for (let i = 1; i <= seconds; i++) out = addLook(out, { ...look, at: from + i * 1000 });
  return out;
}

const start = () => addLook(emptyTally(), { at: T0, counting: false, camera: false, seen: false });
const ON = { counting: true, camera: true, seen: true };

describe("cameraCounts", () => {
  it("counts the camera as on only once it's past calibrating", () => {
    expect(cameraCounts("tracking")).toBe(true);
    expect(cameraCounts("no-face")).toBe(true);
    for (const s of ["off", "starting", "calibrating", "error"] as const)
      expect(cameraCounts(s)).toBe(false);
  });
});

describe("faceSeen", () => {
  it("needs a face", () => {
    expect(faceSeen(null)).toBe(false);
    expect(faceSeen(undefined)).toBe(false);
    expect(faceSeen(face())).toBe(true);
  });

  it("allows a sensible turn to either side, but not turning away", () => {
    expect(faceSeen(face(0.5))).toBe(true);
    expect(faceSeen(face(-0.5))).toBe(true);
    expect(faceSeen(face(FACING.yaw))).toBe(false);
    expect(faceSeen(face(-1))).toBe(false);
  });

  it("always allows looking down at the page, but not up at the ceiling", () => {
    expect(faceSeen(face(0, -1))).toBe(true);
    expect(faceSeen(face(0, 0.5))).toBe(true);
    expect(faceSeen(face(0, FACING.up))).toBe(false);
    expect(faceSeen(face(0, 1))).toBe(false);
  });

  it("ignores garbage numbers", () => {
    expect(faceSeen(face(Number.NaN))).toBe(false);
    expect(faceSeen(face(0, Number.POSITIVE_INFINITY))).toBe(false);
  });
});

describe("addLook", () => {
  it("credits each second with what that look saw", () => {
    let t = run(start(), T0, 10, ON);
    t = run(t, T0 + 10_000, 5, { counting: true, camera: true, seen: false });
    t = run(t, T0 + 15_000, 5, { counting: true, camera: false, seen: false });
    expect(t.cameraMs).toBe(15_000);
    expect(t.seenMs).toBe(10_000);
  });

  it("the first look credits nothing", () => {
    const t = addLook(emptyTally(), { at: T0, ...ON });
    expect(t.cameraMs).toBe(0);
    expect(t.lastAt).toBe(T0);
  });

  it("credits nothing while not counting (away, paused), and doesn't save it up", () => {
    let t = run(start(), T0, 5, { counting: false, camera: true, seen: true });
    expect(t.cameraMs).toBe(0);
    t = addLook(t, { at: T0 + 6000, ...ON });
    expect(t.cameraMs).toBe(1000);
  });

  it("never sees a face with the camera off", () => {
    const t = run(start(), T0, 5, { counting: true, camera: false, seen: true });
    expect(t.seenMs).toBe(0);
    expect(t.seenNow).toBe(false);
  });

  it("caps a long gap (a frozen tab) and never credits time going backwards", () => {
    let t = addLook(start(), { at: T0 + 60_000, ...ON });
    expect(t.cameraMs).toBe(MAX_STEP_MS);
    t = addLook(t, { at: T0 + 30_000, ...ON });
    expect(t.cameraMs).toBe(MAX_STEP_MS);
    expect(t.lastAt).toBe(T0 + 60_000);
  });

  it("times how long the face has been missing, and resets when it's back or the camera's off", () => {
    let t = run(start(), T0, 3, ON);
    expect(missingMs(t, T0 + 3000)).toBe(0);
    t = run(t, T0 + 3000, 4, { counting: true, camera: true, seen: false });
    expect(t.missingSince).toBe(T0 + 4000);
    expect(missingMs(t, T0 + 12_000)).toBe(8000);
    expect(missingMs(addLook(t, { at: T0 + 8000, ...ON }), T0 + 9000)).toBe(0);
    expect(
      addLook(t, { at: T0 + 8000, counting: true, camera: false, seen: false }).missingSince,
    ).toBeNull();
    // Leaving the tab isn't drifting off (the pomodoro has its own rules for that).
    expect(
      addLook(t, { at: T0 + 8000, counting: false, camera: true, seen: false }).missingSince,
    ).toBeNull();
  });
});

describe("presencePayload", () => {
  it("is left out when the camera was never on", () => {
    expect(presencePayload(run(start(), T0, 30, { ...ON, camera: false }), 1500)).toBeUndefined();
    expect(presencePayload(emptyTally(), 1500)).toBeUndefined();
  });

  it("sends whole seconds, seen never more than camera, capped at the pomodoro's length", () => {
    const t = { ...emptyTally(), cameraMs: 12_900, seenMs: 9_999 };
    expect(presencePayload(t, 1500)).toEqual({ cameraSeconds: 12, seenSeconds: 9 });
    const long = { ...emptyTally(), cameraMs: 2_000_000, seenMs: 2_000_000 };
    expect(presencePayload(long, 1500)).toEqual({ cameraSeconds: 1500, seenSeconds: 1500 });
    const odd = { ...emptyTally(), cameraMs: 5000, seenMs: 9000 };
    expect(presencePayload(odd, 1500)).toEqual({ cameraSeconds: 5, seenSeconds: 5 });
    expect(presencePayload(long, Number.NaN)).toBeUndefined();
  });

  it("a whole 25-minute pomodoro looked at once a second adds up to its length", () => {
    const t = run(start(), T0, 25 * 60, ON);
    expect(presencePayload(t, 25 * 60)).toEqual({ cameraSeconds: 1500, seenSeconds: 1500 });
  });
});

describe("seenPercent", () => {
  it("is null with the camera off and a whole percentage otherwise", () => {
    expect(seenPercent({ cameraMs: 0, seenMs: 0 })).toBeNull();
    expect(seenPercent({ cameraMs: 999, seenMs: 999 })).toBeNull();
    expect(seenPercent({ cameraMs: 100_000, seenMs: 92_400 })).toBe(92);
    expect(seenPercent({ cameraMs: 1000, seenMs: 5000 })).toBe(100);
  });
});
