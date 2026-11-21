import { describe, expect, it } from "vitest";
import {
  SESSION_EARLY_GRACE_S,
  SESSION_LATE_LIMIT_S,
  minLessonSeconds,
  streaks,
  subjectSlug,
  validateSessionEnd,
} from "./rules";

const at = (s: number) => new Date(Date.UTC(2026, 10, 20, 15, 0, s));

describe("validateSessionEnd", () => {
  it("credits exactly the planned length when the pomodoro ran its course", () => {
    expect(validateSessionEnd(at(0), at(1500), 1500)).toEqual({ ok: true, durationSeconds: 1500 });
  });

  it("allows a little clock/network leeway, but no earlier", () => {
    expect(validateSessionEnd(at(0), at(1500 - SESSION_EARLY_GRACE_S), 1500).ok).toBe(true);
    expect(validateSessionEnd(at(0), at(1500 - SESSION_EARLY_GRACE_S - 1), 1500)).toEqual({
      ok: false,
      reason: "too-early",
    });
  });

  it("never credits more than planned, and refuses a session reported far too late", () => {
    expect(validateSessionEnd(at(0), at(1500 + 600), 1500)).toEqual({
      ok: true,
      durationSeconds: 1500,
    });
    expect(validateSessionEnd(at(0), at(1500 + SESSION_LATE_LIMIT_S + 1), 1500)).toEqual({
      ok: false,
      reason: "too-late",
    });
  });
});

describe("streaks", () => {
  it("counts consecutive days, current through today or yesterday", () => {
    const days = ["2026-11-14", "2026-11-15", "2026-11-17", "2026-11-18", "2026-11-19"];
    expect(streaks(days, "2026-11-20")).toEqual({ current: 3, longest: 3 });
    expect(streaks(days, "2026-11-19")).toEqual({ current: 3, longest: 3 });
    expect(streaks(days, "2026-11-21")).toEqual({ current: 0, longest: 3 });
  });

  it("handles duplicates, month boundaries and no activity", () => {
    expect(streaks(["2026-10-31", "2026-11-01", "2026-11-01"], "2026-11-01")).toEqual({
      current: 2,
      longest: 2,
    });
    expect(streaks([], "2026-11-20")).toEqual({ current: 0, longest: 0 });
  });
});

describe("helpers", () => {
  it("won't accept a lesson finished faster than it can be played", () => {
    expect(minLessonSeconds(3)).toBe(60);
    expect(minLessonSeconds(20)).toBe(180);
  });

  it("makes stable subject ids", () => {
    expect(subjectSlug("Cell Biology")).toBe("cell-biology");
    expect(subjectSlug("  Économie & Société! ")).toBe("economie-societe");
    expect(subjectSlug("???")).toBe("general");
  });
});
