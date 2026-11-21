import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AWAY_GRACE_MS,
  DEFAULT_POMODORO_SETTINGS,
  POMODORO_LIMITS,
  type PomodoroSettings,
  type PomodoroState,
  awayPatch,
  backPatch,
  clampSetting,
  dayKey,
  finishNowPatch,
  formatClock,
  isFocusing,
  lengthShort,
  lengthWord,
  phaseMinutes,
  phaseProgress,
  quickTimingsPatch,
  remainingMs,
  settingsPatch,
  skipBreakPatch,
  startFocusPatch,
  tickPatch,
  todayCount,
  usePomodoro,
  voidPatch,
} from "./pomodoro";

/**
 * Node has no usable localStorage (without a file it's undefined), and the store persists through
 * it as soon as it's imported, so a Map-backed one goes in first.
 */
const storage = vi.hoisted(() => {
  const items = new Map<string, string>();
  const stub = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, String(value)),
    removeItem: (key: string) => void items.delete(key),
    clear: () => items.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true });
  return stub;
});

const SEC = 1000;
const MIN = 60_000;
/** 9 am local time, so day keys come out the same in every time zone. */
const T0 = new Date(2026, 10, 20, 9, 0).getTime();
const TODAY = "2026-11-20";
const END = T0 + 25 * MIN;

const GENTLE: PomodoroSettings = { ...DEFAULT_POMODORO_SETTINGS, strict: false };

const state = (patch: Partial<PomodoroState> = {}): PomodoroState => ({
  settings: DEFAULT_POMODORO_SETTINGS,
  savedSettings: null,
  phase: "idle",
  startedAt: null,
  endsAt: null,
  pausedRemaining: null,
  inSet: 0,
  today: { date: "", count: 0 },
  task: "",
  awaySince: null,
  interruptions: 0,
  notice: null,
  rings: 0,
  ...patch,
});

/** Applies a patch the way the store does. */
const step = (s: PomodoroState, patch: Partial<PomodoroState>): PomodoroState => ({
  ...s,
  ...patch,
});

/** A pomodoro started at `at` (T0 by default). */
const begin = (patch: Partial<PomodoroState> = {}, at = T0) => {
  const s = state(patch);
  return step(s, startFocusPatch(s, at));
};

/** A break of the given kind, started at `at` with the default lengths. */
const onBreak = (phase: "shortBreak" | "longBreak", inSet: number, at = T0) =>
  state({
    phase,
    inSet,
    startedAt: at,
    endsAt: at + (phase === "shortBreak" ? 5 : 15) * MIN,
  });

/** Moves the clock to the end of the current phase. */
const ring = (s: PomodoroState) => step(s, tickPatch(s, s.endsAt!));

describe("defaults", () => {
  it("follows the method: 25-minute pomodoros, 5 / 15-minute breaks, a long one every 4th", () => {
    expect(DEFAULT_POMODORO_SETTINGS).toEqual({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      strict: true,
      ticking: false,
      screenLock: true,
      fenwickShush: true,
    });
    expect(AWAY_GRACE_MS).toBe(10_000);
    expect(POMODORO_LIMITS.focusMinutes).toEqual([5, 90, 5]);
  });
});

describe("helpers", () => {
  it("dayKey is the local calendar day", () => {
    expect(dayKey(T0)).toBe(TODAY);
    expect(dayKey(new Date(2026, 0, 5, 0, 0).getTime())).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31, 23, 59).getTime())).toBe("2026-12-31");
  });

  it("clampSetting rounds to the step and keeps within the limits", () => {
    expect(clampSetting("focusMinutes", 27)).toBe(25);
    expect(clampSetting("focusMinutes", 27.5)).toBe(30);
    expect(clampSetting("focusMinutes", 3)).toBe(5);
    expect(clampSetting("focusMinutes", 200)).toBe(90);
    expect(clampSetting("focusMinutes", -10)).toBe(5);
    expect(clampSetting("shortBreakMinutes", 2.4)).toBe(2);
    expect(clampSetting("shortBreakMinutes", 0)).toBe(1);
    expect(clampSetting("longBreakMinutes", 8)).toBe(10);
    expect(clampSetting("longBreakEvery", 9)).toBe(8);
  });

  it("clampSetting falls back to the default for values that aren't numbers", () => {
    expect(clampSetting("focusMinutes", NaN)).toBe(25);
    expect(clampSetting("shortBreakMinutes", Infinity)).toBe(5);
    expect(clampSetting("longBreakMinutes", -Infinity)).toBe(15);
    expect(clampSetting("longBreakEvery", NaN)).toBe(4);
  });

  it("phaseMinutes: idle shows a pomodoro's length", () => {
    const settings = { ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 40 };
    expect(phaseMinutes(settings, "idle")).toBe(40);
    expect(phaseMinutes(settings, "focus")).toBe(40);
    expect(phaseMinutes(settings, "shortBreak")).toBe(5);
    expect(phaseMinutes(settings, "longBreak")).toBe(15);
  });

  it("formatClock shows minutes:seconds, rounding up so 0:00 means time's up", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(25 * MIN - 1)).toBe("25:00");
    expect(formatClock(24 * MIN + 59 * SEC)).toBe("24:59");
    expect(formatClock(61 * SEC)).toBe("1:01");
    expect(formatClock(59 * SEC + 1)).toBe("1:00");
    expect(formatClock(59 * SEC)).toBe("0:59");
    expect(formatClock(9 * SEC)).toBe("0:09");
    expect(formatClock(1)).toBe("0:01");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(90 * MIN)).toBe("90:00");
  });

  it("remainingMs: idle shows a whole pomodoro at the configured length", () => {
    expect(remainingMs(state(), T0)).toBe(25 * MIN);
    const settings = { ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 50 };
    expect(remainingMs(state({ settings }), T0)).toBe(50 * MIN);
  });

  it("remainingMs counts down to zero and never below", () => {
    const s = begin();
    expect(remainingMs(s, T0)).toBe(25 * MIN);
    expect(remainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(remainingMs(s, END)).toBe(0);
    expect(remainingMs(s, END + 5 * MIN)).toBe(0);
  });

  it("remainingMs: a stopped clock shows what was left, whatever the time", () => {
    const s = { ...begin(), pausedRemaining: 7 * MIN };
    expect(remainingMs(s, T0)).toBe(7 * MIN);
    expect(remainingMs(s, T0 + 60 * MIN)).toBe(7 * MIN);
  });

  it("phaseProgress goes 0 to 1 across the phase and stays in range", () => {
    expect(phaseProgress(state(), T0)).toBe(0);
    const s = begin();
    expect(phaseProgress(s, T0)).toBe(0);
    expect(phaseProgress(s, T0 + 12.5 * MIN)).toBe(0.5);
    expect(phaseProgress(s, END)).toBe(1);
    expect(phaseProgress(s, END + 10 * MIN)).toBe(1);
    expect(phaseProgress(s, T0 - MIN)).toBe(0);
    expect(phaseProgress(onBreak("shortBreak", 1), T0 + 2.5 * MIN)).toBe(0.5);
    expect(phaseProgress(onBreak("longBreak", 4), T0 + 7.5 * MIN)).toBe(0.5);
  });

  it("isFocusing is true only while a pomodoro runs", () => {
    expect(isFocusing({ phase: "focus" })).toBe(true);
    expect(isFocusing({ phase: "idle" })).toBe(false);
    expect(isFocusing({ phase: "shortBreak" })).toBe(false);
    expect(isFocusing({ phase: "longBreak" })).toBe(false);
  });

  it("todayCount only counts today's tally", () => {
    expect(todayCount({ today: { date: TODAY, count: 3 } }, T0)).toBe(3);
    expect(
      todayCount({ today: { date: TODAY, count: 3 } }, new Date(2026, 10, 21, 9).getTime()),
    ).toBe(0);
    expect(todayCount({ today: { date: "", count: 0 } }, T0)).toBe(0);
  });
});

describe("starting a pomodoro", () => {
  it("winds up a whole pomodoro of the configured length", () => {
    const settings = { ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 30 };
    expect(startFocusPatch(state({ settings }), T0)).toEqual({
      phase: "focus",
      startedAt: T0,
      endsAt: T0 + 30 * MIN,
      pausedRemaining: null,
      awaySince: null,
      interruptions: 0,
      notice: null,
    });
  });

  it("clears the last pomodoro's interruptions and notice, keeping the set, tally and task", () => {
    const before = state({
      interruptions: 2,
      notice: { kind: "voided", reason: "left-tab", awayMs: 12 * SEC, at: T0 - MIN },
      inSet: 2,
      today: { date: TODAY, count: 5 },
      task: "Essay intro",
      rings: 4,
    });
    const s = step(before, startFocusPatch(before, T0));
    expect(s).toMatchObject({
      phase: "focus",
      interruptions: 0,
      notice: null,
      inSet: 2,
      today: { date: TODAY, count: 5 },
      task: "Essay intro",
      rings: 4,
    });
  });

  it("does nothing while a pomodoro runs (it can't be restarted)", () => {
    expect(startFocusPatch(begin(), T0 + 5 * MIN)).toEqual({});
  });

  it("can cut a short break short; the set carries on", () => {
    const s = step(onBreak("shortBreak", 1), startFocusPatch(onBreak("shortBreak", 1), T0 + MIN));
    expect(s).toMatchObject({ phase: "focus", inSet: 1, startedAt: T0 + MIN });
    expect(ring(s).notice).toMatchObject({ kind: "focusDone", count: 2, breakPhase: "shortBreak" });
  });

  // Otherwise the set would never close: the card would show "5 of 4" and the next long break
  // would only come after the 8th.
  it("cutting a long break short closes the set, like skipping it", () => {
    const s = step(onBreak("longBreak", 4), startFocusPatch(onBreak("longBreak", 4), T0 + MIN));
    expect(s.inSet).toBe(0);
  });
});

describe("the clock", () => {
  it("does nothing while idle", () => {
    expect(tickPatch(state(), T0)).toEqual({});
  });

  it("does nothing before the bell", () => {
    expect(tickPatch(begin(), END - 1)).toEqual({});
  });

  it("rings at the end of a pomodoro and starts a short break by itself", () => {
    expect(tickPatch(begin(), END)).toEqual({
      phase: "shortBreak",
      startedAt: END,
      endsAt: END + 5 * MIN,
      pausedRemaining: null,
      awaySince: null,
      inSet: 1,
      today: { date: TODAY, count: 1 },
      notice: { kind: "focusDone", count: 1, breakPhase: "shortBreak", at: END },
      rings: 1,
    });
  });

  it("a late tick (a slowed-down tab) still rings; the break starts from then", () => {
    const late = END + 3 * SEC;
    expect(tickPatch(begin(), late)).toMatchObject({
      phase: "shortBreak",
      startedAt: late,
      endsAt: late + 5 * MIN,
      notice: { kind: "focusDone", at: late },
    });
  });

  it("adds to today's tally", () => {
    const s = ring(begin({ today: { date: TODAY, count: 3 } }));
    expect(s.today).toEqual({ date: TODAY, count: 4 });
    expect(todayCount(s, END)).toBe(4);
  });

  it("starts today's tally again on a new day", () => {
    const s = ring(begin({ today: { date: "2026-11-19", count: 7 } }));
    expect(s.today).toEqual({ date: TODAY, count: 1 });
  });

  it("a pomodoro that rings after midnight counts for the new day", () => {
    const lateNight = new Date(2026, 10, 20, 23, 50).getTime();
    const s = ring(begin({ today: { date: TODAY, count: 6 } }, lateNight));
    expect(s.today).toEqual({ date: "2026-11-21", count: 1 });
  });

  it("every fourth pomodoro earns a long break", () => {
    const s = ring(begin({ inSet: 3 }));
    expect(s).toMatchObject({
      phase: "longBreak",
      endsAt: END + 15 * MIN,
      inSet: 4,
      notice: { kind: "focusDone", count: 4, breakPhase: "longBreak" },
    });
  });

  it("the long break comes after longBreakEvery pomodoros", () => {
    const settings = { ...DEFAULT_POMODORO_SETTINGS, longBreakEvery: 2, longBreakMinutes: 20 };
    expect(ring(begin({ settings })).phase).toBe("shortBreak");
    const s = ring(begin({ settings, inSet: 1 }));
    expect(s).toMatchObject({ phase: "longBreak", endsAt: END + 20 * MIN, inSet: 2 });
  });

  it("lowering the interval mid-set still ends the set with the next pomodoro", () => {
    const settings = { ...DEFAULT_POMODORO_SETTINGS, longBreakEvery: 2 };
    expect(ring(begin({ settings, inSet: 3 }))).toMatchObject({ phase: "longBreak", inSet: 4 });
  });

  it("a short break rings back to idle and keeps the set going", () => {
    const b = onBreak("shortBreak", 2);
    expect(tickPatch(b, T0 + 5 * MIN - 1)).toEqual({});
    expect(tickPatch(b, T0 + 5 * MIN)).toEqual({
      phase: "idle",
      startedAt: null,
      endsAt: null,
      pausedRemaining: null,
      awaySince: null,
      inSet: 2,
      notice: { kind: "breakDone", skipped: false, at: T0 + 5 * MIN },
      rings: 1,
    });
  });

  it("a long break closes the set", () => {
    expect(ring(onBreak("longBreak", 4))).toMatchObject({ phase: "idle", inSet: 0, rings: 1 });
  });

  it("a whole set: four pomodoros, three short breaks, then a long one", () => {
    let s = state();
    let now = T0;
    const breaks: string[] = [];
    for (let i = 0; i < 4; i++) {
      s = step(s, startFocusPatch(s, now));
      now = s.endsAt!;
      s = step(s, tickPatch(s, now));
      breaks.push(s.phase);
      now = s.endsAt!;
      s = step(s, tickPatch(s, now));
    }
    expect(breaks).toEqual(["shortBreak", "shortBreak", "shortBreak", "longBreak"]);
    expect(s).toMatchObject({
      phase: "idle",
      inSet: 0,
      rings: 8,
      today: { date: TODAY, count: 4 },
    });
    expect(now).toBe(T0 + (4 * 25 + 3 * 5 + 15) * MIN);
  });
});

describe("skipping a break", () => {
  it("ends a short break early without ringing; the set carries on", () => {
    expect(skipBreakPatch(onBreak("shortBreak", 2), T0 + MIN)).toEqual({
      phase: "idle",
      startedAt: null,
      endsAt: null,
      pausedRemaining: null,
      awaySince: null,
      inSet: 2,
      notice: { kind: "breakDone", skipped: true, at: T0 + MIN },
    });
  });

  it("skipping a long break closes the set", () => {
    expect(skipBreakPatch(onBreak("longBreak", 4), T0 + MIN)).toMatchObject({ inSet: 0 });
  });

  it("does nothing outside a break", () => {
    expect(skipBreakPatch(state(), T0)).toEqual({});
    expect(skipBreakPatch(begin(), T0 + MIN)).toEqual({});
  });
});

describe("strict mode: leaving the tab", () => {
  const LEFT = T0 + 5 * MIN;
  const away = () => step(begin(), awayPatch(begin(), LEFT));

  it("notes when you left; leaving again doesn't move it", () => {
    expect(awayPatch(begin(), LEFT)).toEqual({ awaySince: LEFT });
    expect(awayPatch(away(), LEFT + 3 * SEC)).toEqual({});
  });

  it("only matters during a pomodoro", () => {
    expect(awayPatch(state(), T0)).toEqual({});
    expect(awayPatch(onBreak("shortBreak", 1), T0 + MIN)).toEqual({});
    expect(awayPatch(onBreak("longBreak", 4), T0 + MIN)).toEqual({});
  });

  it("the clock keeps running while you're away", () => {
    const s = away();
    expect(s.pausedRemaining).toBeNull();
    expect(remainingMs(s, LEFT + 5 * SEC)).toBe(20 * MIN - 5 * SEC);
  });

  it("back within the grace period: a warning and an interruption, and it still counts", () => {
    const patch = backPatch(away(), LEFT + 4 * SEC);
    expect(patch).toEqual({
      awaySince: null,
      interruptions: 1,
      notice: { kind: "warned", awayMs: 4 * SEC, at: LEFT + 4 * SEC },
    });
    const s = step(away(), patch);
    expect(s).toMatchObject({ phase: "focus", startedAt: T0, endsAt: END });
    expect(ring(s)).toMatchObject({ phase: "shortBreak", inSet: 1, today: { count: 1 } });
  });

  it("back after exactly the grace period still counts", () => {
    expect(backPatch(away(), LEFT + AWAY_GRACE_MS).notice).toMatchObject({ kind: "warned" });
  });

  it("back after longer than the grace period: the pomodoro is void", () => {
    const back = LEFT + AWAY_GRACE_MS + 1;
    const patch = backPatch(away(), back);
    expect(patch).toEqual({
      phase: "idle",
      startedAt: null,
      endsAt: null,
      pausedRemaining: null,
      awaySince: null,
      interruptions: 1,
      notice: { kind: "voided", reason: "left-tab", awayMs: AWAY_GRACE_MS + 1, at: back },
    });
    const s = step(away(), patch);
    expect(s).toMatchObject({ inSet: 0, today: { date: "", count: 0 }, rings: 0 });
  });

  it("a tick while you're still away voids it once the grace period runs out", () => {
    let s = away();
    expect(tickPatch(s, LEFT + AWAY_GRACE_MS)).toEqual({});
    s = step(s, tickPatch(s, LEFT + AWAY_GRACE_MS + 1));
    expect(s).toMatchObject({
      phase: "idle",
      interruptions: 1,
      notice: { kind: "voided", reason: "left-tab", awayMs: AWAY_GRACE_MS + 1 },
    });
    // Coming back later changes nothing: the voided card is still there to show.
    expect(backPatch(s, LEFT + 2 * MIN)).toEqual({});
  });

  it("slips add up as interruptions, and the pomodoro still rings", () => {
    let s = begin();
    for (const at of [T0 + MIN, T0 + 10 * MIN]) {
      s = step(s, awayPatch(s, at));
      s = step(s, backPatch(s, at + 3 * SEC));
    }
    expect(s).toMatchObject({ phase: "focus", interruptions: 2, endsAt: END });
    expect(ring(s).notice).toMatchObject({ kind: "focusDone", count: 1 });
  });

  it("coming back without having left does nothing", () => {
    expect(backPatch(begin(), T0 + MIN)).toEqual({});
  });

  it("a leftover away mark outside a pomodoro is just cleared", () => {
    expect(backPatch({ ...onBreak("shortBreak", 1), awaySince: T0 }, T0 + MIN)).toEqual({
      awaySince: null,
    });
  });

  // Time away is counted up to the bell: a tab whose timers were frozen (phones, sleeping laptops)
  // mustn't void a pomodoro that had already finished.
  it("a pomodoro that rang 3 s after you left counts, even if the tab wakes late", () => {
    let s = step(begin(), awayPatch(begin(), END - 3 * SEC));
    s = step(s, tickPatch(s, END + 20 * SEC));
    expect(s.phase).toBe("shortBreak");
  });

  it("...and the same when coming back is what wakes it", () => {
    let s = step(begin(), awayPatch(begin(), END - 3 * SEC));
    s = step(s, backPatch(s, END + 20 * SEC));
    s = step(s, tickPatch(s, END + 20 * SEC));
    expect(s.phase).toBe("shortBreak");
  });
});

describe("gentle mode: the timer waits", () => {
  const LEFT = T0 + 10 * MIN;
  const RETURN = LEFT + 3 * MIN;
  const away = () => {
    const s = begin({ settings: GENTLE });
    return step(s, awayPatch(s, LEFT));
  };

  it("leaving stops the clock with what was left", () => {
    expect(awayPatch(begin({ settings: GENTLE }), LEFT)).toEqual({
      awaySince: LEFT,
      pausedRemaining: 15 * MIN,
    });
    const s = away();
    expect(remainingMs(s, LEFT + 60 * MIN)).toBe(15 * MIN);
    expect(phaseProgress(s, LEFT + 60 * MIN)).toBeCloseTo(0.4);
  });

  it("while away it never rings and never voids", () => {
    expect(tickPatch(away(), END)).toEqual({});
    expect(tickPatch(away(), LEFT + 2 * 60 * MIN)).toEqual({});
  });

  it("coming back restarts the clock with what was left", () => {
    expect(backPatch(away(), RETURN)).toEqual({
      awaySince: null,
      pausedRemaining: null,
      endsAt: RETURN + 15 * MIN,
      startedAt: RETURN + 15 * MIN - 25 * MIN,
      interruptions: 1,
      notice: { kind: "paused", awayMs: 3 * MIN, at: RETURN },
    });
  });

  it("progress carries on from where it stopped, and it rings later by the time away", () => {
    const before = phaseProgress(begin({ settings: GENTLE }), LEFT);
    const s = step(away(), backPatch(away(), RETURN));
    expect(phaseProgress(s, RETURN)).toBe(before);
    expect(remainingMs(s, RETURN)).toBe(15 * MIN);
    expect(tickPatch(s, END)).toEqual({});
    expect(ring(s)).toMatchObject({ phase: "shortBreak", startedAt: END + 3 * MIN });
  });

  it("a long time away still doesn't void it", () => {
    const s = step(away(), backPatch(away(), LEFT + 2 * 60 * MIN));
    expect(s).toMatchObject({ phase: "focus", notice: { kind: "paused" } });
    expect(remainingMs(s, LEFT + 2 * 60 * MIN)).toBe(15 * MIN);
  });

  it("breaks don't wait", () => {
    const b = { ...onBreak("shortBreak", 1), settings: GENTLE };
    expect(awayPatch(b, T0 + MIN)).toEqual({});
  });
});

describe("abandoning a pomodoro", () => {
  const running = () =>
    begin({ inSet: 2, today: { date: TODAY, count: 2 }, rings: 4, task: "Problem set" });

  it("leaving the table voids it: it doesn't count", () => {
    const at = T0 + 20 * MIN;
    const patch = voidPatch(step(running(), { interruptions: 1 }), "left-table", at);
    expect(patch).toEqual({
      phase: "idle",
      startedAt: null,
      endsAt: null,
      pausedRemaining: null,
      awaySince: null,
      interruptions: 1,
      notice: { kind: "voided", reason: "left-table", awayMs: 0, at },
    });
    expect(step(running(), patch)).toMatchObject({
      inSet: 2,
      today: { date: TODAY, count: 2 },
      rings: 4,
      task: "Problem set",
    });
  });

  it("leaving the library voids it too", () => {
    expect(voidPatch(running(), "left-library", T0 + MIN).notice).toEqual({
      kind: "voided",
      reason: "left-library",
      awayMs: 0,
      at: T0 + MIN,
    });
  });

  it("there's nothing to abandon outside a pomodoro (a break carries on)", () => {
    expect(voidPatch(state(), "left-table", T0)).toEqual({});
    expect(voidPatch(onBreak("shortBreak", 1), "left-table", T0 + MIN)).toEqual({});
    expect(voidPatch(onBreak("longBreak", 4), "left-library", T0 + MIN)).toEqual({});
  });
});

describe("settings", () => {
  const change = (c: Partial<PomodoroSettings>, s = state()) => settingsPatch(s, c).settings!;

  it("rounds to the step and keeps within the limits", () => {
    expect(change({ focusMinutes: 27 }).focusMinutes).toBe(25);
    expect(change({ focusMinutes: 28 }).focusMinutes).toBe(30);
    expect(change({ focusMinutes: 0 }).focusMinutes).toBe(5);
    expect(change({ focusMinutes: 200 }).focusMinutes).toBe(90);
    expect(change({ shortBreakMinutes: 2.4 }).shortBreakMinutes).toBe(2);
    expect(change({ shortBreakMinutes: 20 }).shortBreakMinutes).toBe(15);
    expect(change({ longBreakMinutes: 7 }).longBreakMinutes).toBe(5);
    expect(change({ longBreakMinutes: 50 }).longBreakMinutes).toBe(45);
    expect(change({ longBreakEvery: 1 }).longBreakEvery).toBe(2);
    expect(change({ longBreakEvery: 3.6 }).longBreakEvery).toBe(4);
  });

  it("values that aren't numbers fall back to the defaults", () => {
    const custom = { ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 40, shortBreakMinutes: 8 };
    const s = state({ settings: custom });
    expect(change({ focusMinutes: NaN }, s).focusMinutes).toBe(25);
    expect(change({ shortBreakMinutes: Infinity }, s).shortBreakMinutes).toBe(5);
    expect(change({ focusMinutes: "45" as unknown as number }, s).focusMinutes).toBe(25);
  });

  it("leaves out what isn't being changed", () => {
    const custom = { ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 40, strict: false };
    const s = state({ settings: custom });
    expect(change({}, s)).toEqual(custom);
    expect(change({ focusMinutes: undefined, strict: undefined }, s)).toEqual(custom);
  });

  it("switches the toggles, and ignores toggles that aren't true or false", () => {
    expect(change({ strict: false, ticking: true, screenLock: false })).toMatchObject({
      strict: false,
      ticking: true,
      screenLock: false,
    });
    expect(change({ strict: "no" as unknown as boolean }).strict).toBe(true);
  });

  it("a running pomodoro keeps its length and its strictness; the rest can change", () => {
    expect(
      change(
        {
          focusMinutes: 50,
          strict: false,
          shortBreakMinutes: 10,
          longBreakMinutes: 20,
          longBreakEvery: 3,
          ticking: true,
          screenLock: false,
          fenwickShush: false,
        },
        begin(),
      ),
    ).toEqual({
      focusMinutes: 25,
      strict: true,
      shortBreakMinutes: 10,
      longBreakMinutes: 20,
      longBreakEvery: 3,
      ticking: true,
      screenLock: false,
      fenwickShush: false,
    });
    // Strictness can't be switched on half way through either.
    expect(change({ strict: true }, begin({ settings: GENTLE })).strict).toBe(false);
  });

  it("the next pomodoro's length can change while idle or on a break", () => {
    const idle = step(state(), settingsPatch(state(), { focusMinutes: 50 }));
    expect(remainingMs(idle, T0)).toBe(50 * MIN);
    expect(formatClock(remainingMs(idle, T0))).toBe("50:00");
    expect(change({ focusMinutes: 45 }, onBreak("shortBreak", 1)).focusMinutes).toBe(45);
  });

  it("makes new settings without touching the old ones", () => {
    const s = state();
    settingsPatch(s, { focusMinutes: 50, strict: false });
    expect(s.settings).toBe(DEFAULT_POMODORO_SETTINGS);
    expect(DEFAULT_POMODORO_SETTINGS).toMatchObject({ focusMinutes: 25, strict: true });
  });

  // Progress is measured against the running phase's own length, not the setting, which may have
  // changed since it started.
  it("a break's progress follows the break that's running after its length changes", () => {
    let s = onBreak("shortBreak", 1);
    s = step(s, settingsPatch(s, { shortBreakMinutes: 10 }));
    expect(remainingMs(s, T0)).toBe(5 * MIN);
    expect(phaseProgress(s, T0)).toBe(0);
  });
});

/** The judge demo's timings (lib/demo/settings.ts has the real ones; these are the same shape). */
const QUICK = {
  focusMinutes: 1,
  shortBreakMinutes: 0.25,
  longBreakMinutes: 0.5,
  longBreakEvery: 2,
};

describe("quick timings (the judge demo)", () => {
  it("swaps the lengths in and keeps the student's own aside, then puts them back", () => {
    const own = { ...DEFAULT_POMODORO_SETTINGS, focusMinutes: 50, ticking: true };
    const s = step(state({ settings: own }), quickTimingsPatch(state({ settings: own }), QUICK));
    expect(s.settings).toEqual({ ...own, ...QUICK });
    expect(s.savedSettings).toEqual(own);
    // Turning them on twice keeps the student's own, not the quick ones.
    expect(step(s, quickTimingsPatch(s, QUICK)).savedSettings).toEqual(own);
    const back = step(s, quickTimingsPatch(s, null));
    expect(back).toMatchObject({ settings: own, savedSettings: null });
    expect(quickTimingsPatch(back, null)).toEqual({});
  });

  it("runs a 1-minute pomodoro, a 15-second break and a long break after 2", () => {
    let s = step(state(), quickTimingsPatch(state(), QUICK));
    s = step(s, startFocusPatch(s, T0));
    expect(s.endsAt).toBe(T0 + MIN);
    s = ring(s);
    expect(s).toMatchObject({ phase: "shortBreak", endsAt: T0 + MIN + 15 * SEC });
    s = ring(s);
    s = step(s, startFocusPatch(s, s.endsAt!));
    s = ring(s);
    expect(s.phase).toBe("longBreak");
    expect(s.endsAt! - s.startedAt!).toBe(30 * SEC);
  });

  it("keeps the quick lengths fixed, but a switch flipped is the student's own after", () => {
    const s = step(state(), quickTimingsPatch(state(), QUICK));
    const changed = step(s, settingsPatch(s, { focusMinutes: 30, ticking: true }));
    expect(changed.settings).toMatchObject({ focusMinutes: 1, ticking: true });
    expect(changed.savedSettings).toMatchObject({ focusMinutes: 25, ticking: true });
  });

  it("words its lengths for people", () => {
    expect(lengthWord(5)).toBe("5-minute");
    expect(lengthWord(0.25)).toBe("15-second");
    expect(lengthShort(25)).toBe("25 min");
    expect(lengthShort(0.5)).toBe("30 s");
  });
});

describe("finishing a pomodoro now (the judge demo)", () => {
  it("rings it for real: a break, the set and today's tally move on", () => {
    const s = begin();
    const done = step(s, finishNowPatch(s, END - 5 * SEC, false));
    expect(done).toMatchObject({
      phase: "shortBreak",
      inSet: 1,
      today: { date: TODAY, count: 1 },
      notice: { kind: "focusDone", count: 1, at: END - 5 * SEC },
    });
    expect(done.notice).not.toHaveProperty("preview");
  });

  it("a preview is only shown: marked, and today's tally is left alone", () => {
    const s = begin({ today: { date: TODAY, count: 2 } });
    const done = step(s, finishNowPatch(s, T0 + MIN, true));
    expect(done).toMatchObject({
      phase: "shortBreak",
      today: { date: TODAY, count: 2 },
      notice: { kind: "focusDone", preview: true },
    });
  });

  it("does nothing outside a pomodoro, and finishes even one you'd stepped away from", () => {
    expect(finishNowPatch(state(), T0, false)).toEqual({});
    expect(finishNowPatch(onBreak("shortBreak", 1), T0, true)).toEqual({});
    const away = begin();
    const left = step(away, awayPatch(away, T0 + MIN));
    expect(finishNowPatch(left, T0 + 2 * MIN, true)).toMatchObject({ phase: "shortBreak" });
  });
});

describe("the store", () => {
  const store = () => usePomodoro.getState();

  beforeEach(() => {
    usePomodoro.setState(usePomodoro.getInitialState(), true);
    storage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle with the default settings, showing 25:00", () => {
    expect(store()).toMatchObject({ phase: "idle", inSet: 0, notice: null, rings: 0 });
    expect(store().settings).toEqual(DEFAULT_POMODORO_SETTINGS);
    expect(formatClock(remainingMs(store(), T0))).toBe("25:00");
  });

  it("runs a pomodoro into a break", () => {
    store().startFocus(T0);
    expect(isFocusing(store())).toBe(true);
    store().tick(END);
    expect(store()).toMatchObject({ phase: "shortBreak", inSet: 1, rings: 1 });
    expect(todayCount(store(), END)).toBe(1);
  });

  it("uses the real clock when no time is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    store().startFocus();
    expect(store()).toMatchObject({ startedAt: T0, endsAt: END });
  });

  it("transitions that change nothing don't wake listeners", () => {
    const listener = vi.fn();
    const unsubscribe = usePomodoro.subscribe(listener);
    store().tick(T0);
    store().away(T0);
    store().back(T0);
    store().skipBreak(T0);
    store().abandon("left-table", T0);
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });

  it("strict: away for too long voids the pomodoro", () => {
    store().startFocus(T0);
    store().away(T0 + MIN);
    store().back(T0 + MIN + 30 * SEC);
    expect(store()).toMatchObject({
      phase: "idle",
      notice: { kind: "voided", reason: "left-tab", awayMs: 30 * SEC },
    });
  });

  it("abandon voids the pomodoro and dismissNotice clears the card", () => {
    store().startFocus(T0);
    store().abandon("left-table", T0 + MIN);
    expect(store()).toMatchObject({
      phase: "idle",
      notice: { kind: "voided", reason: "left-table" },
    });
    store().dismissNotice();
    expect(store().notice).toBeNull();
  });

  it("skipBreak ends a break", () => {
    store().startFocus(T0);
    store().tick(END);
    store().skipBreak(END + MIN);
    expect(store()).toMatchObject({ phase: "idle", notice: { kind: "breakDone", skipped: true } });
  });

  it("keeps the task to 80 characters", () => {
    store().setTask("Essay intro");
    expect(store().task).toBe("Essay intro");
    store().setTask("x".repeat(100));
    expect(store().task).toHaveLength(80);
  });

  it("updateSettings rounds and clamps, and can't change a running pomodoro's length", () => {
    store().updateSettings({ focusMinutes: 33 });
    expect(store().settings.focusMinutes).toBe(35);
    store().startFocus(T0);
    store().updateSettings({ focusMinutes: 50 });
    expect(store().settings.focusMinutes).toBe(35);
    expect(store().endsAt).toBe(T0 + 35 * MIN);
  });

  it("saves only the settings, today's tally and the task", () => {
    store().setTask("Read chapter 3");
    store().startFocus(T0);
    store().tick(END);
    const saved = JSON.parse(storage.getItem("ovr.pomodoro")!);
    expect(saved.version).toBe(1);
    expect(Object.keys(saved.state).sort()).toEqual(["settings", "task", "today"]);
    expect(saved.state.today).toEqual({ date: TODAY, count: 1 });
    expect(saved.state.task).toBe("Read chapter 3");
  });

  it("restores saved preferences safely, and never a running pomodoro", async () => {
    storage.setItem(
      "ovr.pomodoro",
      JSON.stringify({
        state: {
          settings: {
            focusMinutes: 200,
            shortBreakMinutes: "x",
            longBreakMinutes: 7,
            strict: false,
            fenwickShush: "sure",
          },
          today: { date: TODAY, count: 3 },
          task: "y".repeat(100),
          phase: "focus",
          startedAt: T0,
          endsAt: END,
        },
        version: 1,
      }),
    );
    await usePomodoro.persist.rehydrate();
    expect(store().settings).toEqual({
      ...DEFAULT_POMODORO_SETTINGS,
      focusMinutes: 90,
      shortBreakMinutes: 5,
      longBreakMinutes: 5,
      strict: false,
    });
    expect(store().today).toEqual({ date: TODAY, count: 3 });
    expect(store().task).toHaveLength(80);
    expect(store()).toMatchObject({ phase: "idle", startedAt: null, endsAt: null });
  });

  it("never saves the demo's quick timings: the student's own are saved and come back", () => {
    store().updateSettings({ focusMinutes: 40 });
    store().setQuickTimings(QUICK);
    expect(store().settings.focusMinutes).toBe(1);
    store().startFocus(T0);
    expect(store().endsAt).toBe(T0 + MIN);
    store().finishNow(true, T0 + 10 * SEC);
    expect(store().notice).toMatchObject({ kind: "focusDone", preview: true });
    const saved = JSON.parse(storage.getItem("ovr.pomodoro")!);
    expect(saved.state.settings.focusMinutes).toBe(40);
    expect(saved.state.today.count).toBe(0);
    store().setQuickTimings(null);
    expect(store().settings.focusMinutes).toBe(40);
    expect(store().savedSettings).toBeNull();
  });

  it("ignores a broken saved tally", async () => {
    storage.setItem(
      "ovr.pomodoro",
      JSON.stringify({ state: { today: { date: TODAY, count: "3" } }, version: 1 }),
    );
    await usePomodoro.persist.rehydrate();
    expect(store().today).toEqual({ date: "", count: 0 });
    expect(store().settings).toEqual(DEFAULT_POMODORO_SETTINGS);
  });
});
