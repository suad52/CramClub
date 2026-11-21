import { describe, expect, it } from "vitest";
import {
  SESSION_EARLY_GRACE_S,
  SESSION_LATE_LIMIT_S,
  clampPresence,
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

describe("clampPresence", () => {
  it("keeps an honest reading as it is", () => {
    expect(clampPresence({ cameraSeconds: 1500, seenSeconds: 1320 }, 1500)).toEqual({
      cameraSeconds: 1500,
      seenSeconds: 1320,
      clamped: false,
    });
    expect(clampPresence({ cameraSeconds: 0, seenSeconds: 0 }, 1500)).toEqual({
      cameraSeconds: 0,
      seenSeconds: 0,
      clamped: false,
    });
  });

  it("is nothing at all when the browser reported nothing (camera off is normal)", () => {
    expect(clampPresence(undefined, 1500)).toBeNull();
    expect(clampPresence(null, 1500)).toBeNull();
  });

  it("cuts camera time to the credited session, and seen time to camera time, and says so", () => {
    // A pomodoro paused in gentle mode ran longer than it's credited for.
    expect(clampPresence({ cameraSeconds: 1900, seenSeconds: 1800 }, 1500)).toEqual({
      cameraSeconds: 1500,
      seenSeconds: 1500,
      clamped: true,
    });
    // Seen can never be more than the camera was on.
    expect(clampPresence({ cameraSeconds: 600, seenSeconds: 900 }, 1500)).toEqual({
      cameraSeconds: 600,
      seenSeconds: 600,
      clamped: true,
    });
  });

  it("only ever stores whole, non-negative seconds", () => {
    expect(clampPresence({ cameraSeconds: 100.9, seenSeconds: -4 }, 1500)).toEqual({
      cameraSeconds: 100,
      seenSeconds: 0,
      clamped: true,
    });
    expect(clampPresence({ cameraSeconds: Number.NaN, seenSeconds: 5 }, 1500)).toMatchObject({
      cameraSeconds: 0,
      seenSeconds: 0,
      clamped: true,
    });
    // Dropping a fraction of a second isn't "clamping".
    expect(clampPresence({ cameraSeconds: 100.9, seenSeconds: 50.2 }, 1500)).toEqual({
      cameraSeconds: 100,
      seenSeconds: 50,
      clamped: false,
    });
  });
});

describe("streaks", () => {
  it("counts consecutive days, current through today or yesterday", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18"];
    expect(streaks(days, "2026-11-18")).toEqual({
      current: 3,
      longest: 3,
      restDays: [],
      studyToday: false,
    });
    expect(streaks(days, "2026-11-19")).toMatchObject({ current: 3, studyToday: false });
  });

  it("keeps a streak through one missed day (a rest day), counting only the active days", () => {
    const days = ["2026-11-14", "2026-11-15", "2026-11-17", "2026-11-18", "2026-11-19"];
    expect(streaks(days, "2026-11-20")).toEqual({
      current: 5,
      longest: 5,
      restDays: ["2026-11-16"],
      // The rest day this week is used: missing today would end it.
      studyToday: true,
    });
    expect(streaks(days, "2026-11-19")).toMatchObject({ current: 5, restDays: ["2026-11-16"] });
  });

  it("allows one rest day in any 7 days, and never two missed days in a row", () => {
    // Missed the 12th and the 15th: the second rest day falls within 7 days of the first.
    const close = ["2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14", "2026-11-16"];
    expect(streaks(close, "2026-11-16")).toEqual({
      current: 1,
      longest: 4,
      restDays: [],
      studyToday: false,
    });
    // A week apart is fine: missed the 12th and the 19th.
    const apart = [
      ...["2026-11-10", "2026-11-11", "2026-11-13", "2026-11-14", "2026-11-15"],
      ...["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-20"],
    ];
    expect(streaks(apart, "2026-11-20")).toMatchObject({
      current: 9,
      restDays: ["2026-11-12", "2026-11-19"],
    });
    // Two missed days end the streak whatever the rest days.
    expect(streaks(["2026-11-10", "2026-11-11", "2026-11-14"], "2026-11-14")).toMatchObject({
      current: 1,
      longest: 2,
    });
  });

  it("keeps a streak alive over a missed yesterday, if today can still save it", () => {
    const days = ["2026-11-16", "2026-11-17", "2026-11-18"];
    expect(streaks(days, "2026-11-20")).toEqual({
      current: 3,
      longest: 3,
      restDays: ["2026-11-19"],
      studyToday: true,
    });
    expect(streaks(days, "2026-11-21")).toMatchObject({ current: 0, longest: 3, restDays: [] });
    // Not when this week's rest day is already used.
    const rested = ["2026-11-15", "2026-11-17", "2026-11-18"];
    expect(streaks(rested, "2026-11-20")).toMatchObject({ current: 0, longest: 3 });
  });

  it("handles duplicates, month boundaries and no activity", () => {
    expect(streaks(["2026-10-31", "2026-11-01", "2026-11-01"], "2026-11-01")).toMatchObject({
      current: 2,
      longest: 2,
    });
    expect(streaks(["2026-10-30", "2026-11-01"], "2026-11-01")).toMatchObject({
      current: 2,
      restDays: ["2026-10-31"],
    });
    expect(streaks([], "2026-11-20")).toEqual({
      current: 0,
      longest: 0,
      restDays: [],
      studyToday: false,
    });
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
