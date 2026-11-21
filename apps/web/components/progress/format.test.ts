import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "@/lib/learning/types";
import {
  delta,
  entryScore,
  formatMinutes,
  formatMinutesTick,
  formatSeconds,
  groupByDay,
  niceMinutesScale,
  niceScale,
  ratio,
} from "./format";

const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
  id: "e",
  type: "quiz_completed",
  at: new Date(2026, 10, 20, 15, 0).toISOString(),
  subject: null,
  lessonTitle: null,
  lessonId: null,
  durationSeconds: null,
  score: null,
  xp: 0,
  ...over,
});

describe("formatMinutes", () => {
  it("shows hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(222)).toBe("3h 42m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(59.6)).toBe("1h");
  });

  it("formats seconds, minutes on axes", () => {
    expect(formatSeconds(40)).toBe("40s");
    expect(formatSeconds(1500)).toBe("25m");
    expect(formatMinutesTick(30)).toBe("30m");
    expect(formatMinutesTick(90)).toBe("1.5h");
  });
});

describe("axis scales", () => {
  it("picks clean count steps that cover the max", () => {
    expect(niceScale(0)).toEqual({ step: 1, top: 1, ticks: [0, 1] });
    expect(niceScale(2).ticks).toEqual([0, 1, 2]);
    const s = niceScale(140);
    expect(s.step).toBe(50);
    expect(s.top).toBeGreaterThanOrEqual(140);
    expect(s.ticks[0]).toBe(0);
  });

  it("steps minutes in quarter hours and hours", () => {
    expect(niceMinutesScale(40).step).toBe(15);
    expect(niceMinutesScale(170).step).toBe(60);
    expect(niceMinutesScale(500).step % 60).toBe(0);
  });
});

describe("timeline", () => {
  it("groups by calendar day, newest first, keeping order", () => {
    const groups = groupByDay([
      entry({ id: "a", at: new Date(2026, 10, 20, 18).toISOString() }),
      entry({ id: "b", at: new Date(2026, 10, 20, 9).toISOString() }),
      entry({ id: "c", at: new Date(2026, 10, 18, 22).toISOString() }),
    ]);
    expect(groups.map((g) => [g.key, g.entries.map((e) => e.id)])).toEqual([
      ["2026-11-20", ["a", "b"]],
      ["2026-11-18", ["c"]],
    ]);
  });

  it("reads quiz scores as first-try results", () => {
    expect(entryScore(entry({ score: 100 }))).toBe("Right first try");
    expect(entryScore(entry({ score: 0 }))).toBe("Not first try");
    expect(entryScore(entry({ score: null }))).toBeNull();
  });
});

describe("comparisons", () => {
  it("compares weeks and avoids dividing by zero", () => {
    expect(delta(5, 3)).toEqual({ diff: 2, direction: "up" });
    expect(delta(1, 4).direction).toBe("down");
    expect(delta(2, 2).direction).toBe("same");
    expect(ratio(3, 0)).toBeNull();
    expect(ratio(3, 4)).toBe(0.75);
  });
});
