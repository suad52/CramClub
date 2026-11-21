import { describe, expect, it } from "vitest";
import { clockOffset, isRunning, minutesLeft, msLeft, shouldWarn, timeLeftText } from "./time";
import { HOLD_MINUTES, WARN_MINUTES } from "./types";

const NOW = new Date("2026-11-21T15:00:00Z");
const MIN = 60_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("minutesLeft", () => {
  it("counts whole minutes, rounding up, and stops at 0", () => {
    expect(minutesLeft(at(HOLD_MINUTES * MIN), NOW)).toBe(60);
    expect(minutesLeft(at(59 * MIN + 30_000), NOW)).toBe(60);
    expect(minutesLeft(at(20_000), NOW)).toBe(1);
    expect(minutesLeft(at(0), NOW)).toBe(0);
    expect(minutesLeft(at(-5 * MIN), NOW)).toBe(0);
  });

  it("takes a Date or epoch ms for now, and copes with no time or a bad one", () => {
    expect(minutesLeft(new Date(NOW.getTime() + 10 * MIN), NOW.getTime())).toBe(10);
    expect(minutesLeft(null, NOW)).toBe(0);
    expect(minutesLeft(undefined, NOW)).toBe(0);
    expect(minutesLeft("not a time", NOW)).toBe(0);
    expect(msLeft(at(1234), NOW)).toBe(1234);
  });
});

describe("shouldWarn", () => {
  it("warns only in the last WARN_MINUTES, and not once it's over", () => {
    expect(WARN_MINUTES).toBe(5);
    expect(shouldWarn(at(30 * MIN), NOW)).toBe(false);
    expect(shouldWarn(at(5 * MIN + 1), NOW)).toBe(false);
    expect(shouldWarn(at(5 * MIN), NOW)).toBe(true);
    expect(shouldWarn(at(10_000), NOW)).toBe(true);
    expect(shouldWarn(at(0), NOW)).toBe(false);
    expect(shouldWarn(at(-MIN), NOW)).toBe(false);
    expect(shouldWarn(null, NOW)).toBe(false);
  });
});

describe("timeLeftText and isRunning", () => {
  it("reads calmly", () => {
    expect(timeLeftText(at(42 * MIN), NOW)).toBe("42 minutes");
    expect(timeLeftText(at(MIN), NOW)).toBe("1 minute");
    expect(timeLeftText(at(30_000), NOW)).toBe("less than a minute");
    expect(timeLeftText(at(-1), NOW)).toBe("no time");
    expect(isRunning(at(1), NOW)).toBe(true);
    expect(isRunning(at(0), NOW)).toBe(false);
  });
});

describe("clockOffset", () => {
  it("is how far this device is behind the server", () => {
    expect(clockOffset(at(90_000), NOW.getTime())).toBe(90_000);
    expect(clockOffset(at(-90_000), NOW.getTime())).toBe(-90_000);
    expect(clockOffset("garbage", NOW.getTime())).toBe(0);
  });
});
