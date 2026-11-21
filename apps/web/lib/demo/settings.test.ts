import { describe, expect, it } from "vitest";
import { SEATS } from "@ovr/shared";
import { SESSION_EARLY_GRACE_S, validateSessionEnd } from "@/lib/learning/rules";
import {
  HOLD_MINUTES,
  MIN_HOLD_MINUTES,
  type TableStatus,
  WARN_MINUTES,
  holdMinutesFor,
} from "@/lib/tables/types";
import { SAVED_ANSWER, SAVED_LESSON } from "./fixtures";
import {
  DEMO_BUDDY,
  DEMO_COMPANION_MIN_MS,
  DEMO_FALLBACK_MS,
  DEMO_HOLD_MINUTES,
  DEMO_REAL_FINISH_MS,
  DEMO_TIMINGS,
  DEMO_WARN_MINUTES,
  REAL_FINISH_IS_SAFE,
  buddySeatFor,
  demoFlagFrom,
  fallbackDue,
  finishKind,
  holdMinutes,
  holdNoun,
  holdText,
  pickDemoSeat,
  secondsUntilReal,
  warnMinutes,
} from "./settings";

const SEC = 1000;
const MIN = 60_000;
const seat = (id: string) => SEATS.find((s) => s.id === id)!;
const free = (tableId: string): TableStatus => ({
  tableId,
  held: false,
  visibility: null,
  holderName: null,
  endsAt: null,
  canSit: true,
  mine: false,
  access: "free",
  circleName: null,
});

describe("demo timings", () => {
  it("are quick, but a pomodoro the server will still take (whole minutes, at least 1)", () => {
    expect(Number.isInteger(DEMO_TIMINGS.focusMinutes)).toBe(true);
    expect(DEMO_TIMINGS.focusMinutes).toBeGreaterThanOrEqual(1);
    // Shorter than any pomodoro the timer's own settings allow (5 minutes at the least).
    expect(DEMO_TIMINGS.focusMinutes).toBeLessThan(5);
    expect(DEMO_TIMINGS.shortBreakMinutes * 60).toBe(15);
    expect(DEMO_TIMINGS.longBreakEvery).toBe(2);
    expect(DEMO_TIMINGS.longBreakMinutes).toBeGreaterThan(DEMO_TIMINGS.shortBreakMinutes);
  });

  it("count someone nearby within the 1-minute pomodoro", () => {
    expect(DEMO_COMPANION_MIN_MS).toBeLessThan(DEMO_TIMINGS.focusMinutes * MIN);
  });
});

describe("demo table holds", () => {
  it("are shorter than a normal hold, never longer, with the warning before the end", () => {
    expect(DEMO_HOLD_MINUTES).toBeLessThan(HOLD_MINUTES);
    expect(DEMO_HOLD_MINUTES).toBeGreaterThanOrEqual(MIN_HOLD_MINUTES);
    expect(holdMinutesFor(DEMO_HOLD_MINUTES)).toBe(DEMO_HOLD_MINUTES);
    expect(DEMO_WARN_MINUTES).toBeLessThan(DEMO_HOLD_MINUTES);
    expect(holdMinutes(true)).toBe(DEMO_HOLD_MINUTES);
    expect(holdMinutes(false)).toBe(HOLD_MINUTES);
    expect(warnMinutes(true)).toBe(DEMO_WARN_MINUTES);
    expect(warnMinutes(false)).toBe(WARN_MINUTES);
  });

  it("a claim can only ever shorten a hold", () => {
    expect(holdMinutesFor(undefined)).toBe(HOLD_MINUTES);
    expect(holdMinutesFor(HOLD_MINUTES * 10)).toBe(HOLD_MINUTES);
    expect(holdMinutesFor(-5)).toBe(MIN_HOLD_MINUTES);
    expect(holdMinutesFor(2.7)).toBe(2);
    expect(holdMinutesFor("3")).toBe(HOLD_MINUTES);
    expect(holdMinutesFor(Number.POSITIVE_INFINITY)).toBe(HOLD_MINUTES);
  });

  it("words the length", () => {
    expect(holdText(60)).toBe("1 hour");
    expect(holdText(120)).toBe("2 hours");
    expect(holdText(90)).toBe("90 minutes");
    expect(holdText(3)).toBe("3 minutes");
    expect(holdText(1)).toBe("1 minute");
    expect(holdNoun(60)).toBe("hour");
    expect(holdNoun(3)).toBe("3 minutes");
  });
});

describe("demoFlagFrom", () => {
  it("reads ?demo=1 and ?demo=0, and nothing else", () => {
    expect(demoFlagFrom("?demo=1")).toBe(true);
    expect(demoFlagFrom("?demo")).toBe(true);
    expect(demoFlagFrom("?x=2&demo=TRUE")).toBe(true);
    expect(demoFlagFrom("?demo=0")).toBe(false);
    expect(demoFlagFrom("demo=off")).toBe(false);
    expect(demoFlagFrom("")).toBeNull();
    expect(demoFlagFrom("?demo=maybe")).toBeNull();
  });
});

describe("finishing a demo pomodoro now", () => {
  const T0 = 1_000_000;
  const running = { phase: "focus", startedAt: T0, endsAt: T0 + MIN, pausedRemaining: null };

  it("is a preview until the last seconds, then real", () => {
    expect(finishKind(running, T0 + 5 * SEC)).toBe("preview");
    expect(finishKind(running, T0 + MIN - DEMO_REAL_FINISH_MS - 1)).toBe("preview");
    expect(finishKind(running, T0 + MIN - DEMO_REAL_FINISH_MS)).toBe("real");
    expect(finishKind({ ...running, phase: "shortBreak" }, T0)).toBeNull();
    expect(finishKind({ ...running, endsAt: null }, T0)).toBeNull();
    expect(secondsUntilReal(running, T0 + 5 * SEC)).toBe(45);
    expect(secondsUntilReal(running, T0 + 55 * SEC)).toBe(0);
  });

  it("only rings for real when the server's own check would pass", () => {
    expect(REAL_FINISH_IS_SAFE).toBe(true);
    expect(DEMO_REAL_FINISH_MS).toBeLessThan(SESSION_EARLY_GRACE_S * SEC);
    // Finishing as early as "real" allows, by the server's clock, still counts.
    const verdict = validateSessionEnd(
      new Date(T0),
      new Date(T0 + MIN - DEMO_REAL_FINISH_MS),
      DEMO_TIMINGS.focusMinutes * 60,
    );
    expect(verdict).toEqual({ ok: true, durationSeconds: 60 });
    // A preview's moment would be refused, which is why it's abandoned instead.
    const early = validateSessionEnd(new Date(T0), new Date(T0 + 5 * SEC), 60);
    expect(early).toEqual({ ok: false, reason: "too-early" });
  });
});

describe("where the demo seats you", () => {
  it("picks a table nobody is at, preferring ones with a lesson board, with Theo across", () => {
    const pick = pickDemoSeat(SEATS, { taken: new Set(), preferred: new Set(["hall-t03"]) });
    expect(pick).toEqual({
      tableId: "hall-t03",
      seatId: "hall-t03-c1",
      buddySeatId: "hall-t03-c4",
    });
    // No preference: the first table in plan order.
    expect(pickDemoSeat(SEATS, { taken: new Set() })?.tableId).toBe("hall-t01");
  });

  it("skips tables with someone at them, held tables, tried tables and one-seat desks", () => {
    const pick = pickDemoSeat(SEATS, {
      taken: new Set(["hall-t01-c6"]),
      statuses: [
        { ...free("hall-t02"), held: true, holderName: "Ada", canSit: true },
        { ...free("hall-t03"), canSit: false },
        free("hall-t05"),
      ],
      skip: new Set(["hall-t04"]),
    });
    expect(pick?.tableId).toBe("hall-t05");
    const desks = SEATS.filter((s) => s.tableId?.startsWith("gallery-desk"));
    expect(pickDemoSeat(desks, { taken: new Set() })).toBeNull();
    expect(pickDemoSeat(SEATS, { taken: new Set(SEATS.map((s) => s.id)) })).toBeNull();
  });

  it("seats Theo facing you across the table, else beside you, never in a taken seat", () => {
    expect(buddySeatFor(seat("hall-t07-c2"), SEATS, new Set())?.id).toBe("hall-t07-c5");
    expect(buddySeatFor(seat("hall-t07-c2"), SEATS, new Set(["hall-t07-c5"]))?.id).toMatch(
      /^hall-t07-c[46]$/,
    );
    const across = new Set(["hall-t07-c4", "hall-t07-c5", "hall-t07-c6"]);
    expect(buddySeatFor(seat("hall-t07-c2"), SEATS, across)?.id).toMatch(/^hall-t07-c[13]$/);
    const full = new Set(SEATS.filter((s) => s.tableId === "hall-t07").map((s) => s.id));
    expect(buddySeatFor(seat("hall-t07-c2"), SEATS, full)).toBeNull();
    expect(buddySeatFor(seat("gallery-desk-1-c1"), SEATS, new Set())).toBeNull();
    expect(buddySeatFor(null, SEATS, new Set())).toBeNull();
  });
});

describe("the saved examples", () => {
  it("wait about 25 s before stepping in", () => {
    expect(DEMO_FALLBACK_MS).toBe(25_000);
    expect(fallbackDue(null, 10 * MIN)).toBe(false);
    expect(fallbackDue(0, DEMO_FALLBACK_MS - 1)).toBe(false);
    expect(fallbackDue(0, DEMO_FALLBACK_MS)).toBe(true);
  });

  it("are marked as saved, and only link to web pages", () => {
    expect(SAVED_LESSON.title).toMatch(/^Saved example: /);
    expect(SAVED_LESSON.scenes.length).toBeGreaterThan(0);
    for (const s of SAVED_ANSWER.sources) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(new URL(s.url).hostname).toBe(s.domain);
    }
  });

  it("Theo is labelled a demo, and his id can't be a real player's", () => {
    expect(DEMO_BUDDY.name).toMatch(/\(demo\)$/);
    expect(DEMO_BUDDY.id).toContain(":");
  });
});
