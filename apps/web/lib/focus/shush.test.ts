import { describe, expect, it } from "vitest";
import {
  SHUSH_AFTER_MS,
  SHUSH_GAP_MS,
  SHUSH_MAX_PER_POMODORO,
  type ShushContext,
  afterShush,
  freshLimiter,
  mayShush,
  rearm,
  shouldShushDrift,
} from "./shush";

const OK: ShushContext = { focusing: true, enabled: true, busy: false };
const T0 = 5_000_000;

describe("mayShush", () => {
  it("only during a pomodoro's focus, with the feature on, when she isn't busy", () => {
    const l = freshLimiter();
    expect(mayShush(l, T0, OK)).toBe(true);
    expect(mayShush(l, T0, { ...OK, focusing: false })).toBe(false);
    expect(mayShush(l, T0, { ...OK, enabled: false })).toBe(false);
    expect(mayShush(l, T0, { ...OK, busy: true })).toBe(false);
  });

  it("at most once every 90 seconds", () => {
    const l = afterShush(freshLimiter(), T0, "back");
    expect(SHUSH_GAP_MS).toBe(90_000);
    expect(mayShush(l, T0 + SHUSH_GAP_MS - 1, OK)).toBe(false);
    expect(mayShush(l, T0 + SHUSH_GAP_MS, OK)).toBe(true);
  });

  it("at most three times a pomodoro, and a new pomodoro starts fresh", () => {
    let l = freshLimiter();
    let now = T0;
    for (let i = 0; i < SHUSH_MAX_PER_POMODORO; i++) {
      expect(mayShush(l, now, OK)).toBe(true);
      l = afterShush(l, now, "back");
      now += SHUSH_GAP_MS;
    }
    expect(SHUSH_MAX_PER_POMODORO).toBe(3);
    expect(mayShush(l, now + 10 * SHUSH_GAP_MS, OK)).toBe(false);
    expect(mayShush(freshLimiter(), now, OK)).toBe(true);
  });
});

describe("shouldShushDrift", () => {
  it("after about 8 seconds missing or turned away, not before", () => {
    const l = freshLimiter();
    expect(SHUSH_AFTER_MS).toBe(8000);
    expect(shouldShushDrift(l, SHUSH_AFTER_MS - 1, T0, OK)).toBe(false);
    expect(shouldShushDrift(l, SHUSH_AFTER_MS, T0, OK)).toBe(true);
    expect(shouldShushDrift(l, 60_000, T0, { ...OK, enabled: false })).toBe(false);
  });

  it("once per drift: not again until the face has come back", () => {
    let l = afterShush(freshLimiter(), T0, "drifted");
    expect(l.armed).toBe(false);
    const later = T0 + 5 * SHUSH_GAP_MS;
    expect(shouldShushDrift(l, 60_000, later, OK)).toBe(false);
    l = rearm(l);
    expect(shouldShushDrift(l, SHUSH_AFTER_MS, later, OK)).toBe(true);
  });

  it("a shush for coming back doesn't use up the drift", () => {
    const l = afterShush(freshLimiter(), T0, "back");
    expect(l.armed).toBe(true);
    expect(shouldShushDrift(l, SHUSH_AFTER_MS, T0 + SHUSH_GAP_MS, OK)).toBe(true);
  });
});
