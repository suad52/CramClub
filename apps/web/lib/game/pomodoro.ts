"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * The table timer: the Pomodoro method (Francesco Cirillo) for anyone sitting at a table.
 *
 * 1. Pick a task. 2. Focus for one pomodoro (25 minutes by default). 3. When it rings, take a
 * short break (5 minutes). 4. Every fourth pomodoro earns a long break (15 minutes).
 *
 * A pomodoro is indivisible: it can't be paused, and one that's interrupted doesn't count. So
 * while a pomodoro runs you stay at the table (standing up means abandoning it) and in this tab.
 * Browsers can't stop someone switching tabs, so leaving is detected instead: in strict mode
 * (the default) a pomodoro you leave for longer than {@link AWAY_GRACE_MS} is void; a shorter
 * slip counts as an interruption. In gentle mode the timer just waits for you.
 *
 * Every transition takes `now` (ms) so the rules are testable without real time. The state is
 * plain data, ready to be shared with other players once multiplayer exists.
 */

export type PomodoroPhase = "idle" | "focus" | "shortBreak" | "longBreak";

export interface PomodoroSettings {
  /** Length of one pomodoro. */
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** A long break after this many pomodoros. */
  longBreakEvery: number;
  /** Leaving the tab for longer than the grace period voids the pomodoro (off: it waits). */
  strict: boolean;
  /** A soft mechanical tick while a pomodoro runs. */
  ticking: boolean;
  /** Go full screen while a pomodoro runs (where the browser allows it). */
  screenLock: boolean;
}

export const DEFAULT_POMODORO_SETTINGS: PomodoroSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  strict: true,
  ticking: false,
  screenLock: true,
};

/** [min, max, step] for each adjustable number. */
export const POMODORO_LIMITS = {
  focusMinutes: [5, 90, 5],
  shortBreakMinutes: [1, 15, 1],
  longBreakMinutes: [5, 45, 5],
  longBreakEvery: [2, 8, 1],
} as const satisfies Record<string, readonly [number, number, number]>;

/** How long you can be away from the tab before a strict pomodoro is void. */
export const AWAY_GRACE_MS = 10_000;
/** Shorter trips out of the tab (a permission bubble, the switch to full screen) don't count. */
export const BLIP_MS = 500;
/**
 * The page checks on you a few times a second while you're in the tab; a gap this long between
 * checks means it wasn't running at all (the computer slept, or the browser froze the tab).
 */
export const STALL_MS = 5_000;

const MINUTE = 60_000;

export type PomodoroNotice =
  /** The pomodoro didn't count. */
  | {
      kind: "voided";
      reason: "left-tab" | "left-table" | "left-library";
      awayMs: number;
      at: number;
    }
  /** You came back within the grace period (strict) - it still counts, but it was close. */
  | { kind: "warned"; awayMs: number; at: number }
  /** Gentle mode: the pomodoro waited while you were away. */
  | { kind: "paused"; awayMs: number; at: number }
  /** A pomodoro rang; a break has started. */
  | { kind: "focusDone"; count: number; breakPhase: "shortBreak" | "longBreak"; at: number }
  /** A break rang (or was skipped); ready for the next pomodoro. */
  | { kind: "breakDone"; skipped: boolean; at: number };

export interface PomodoroState {
  settings: PomodoroSettings;
  phase: PomodoroPhase;
  /** When the current phase started and ends (ms since epoch); null while idle. */
  startedAt: number | null;
  endsAt: number | null;
  /** Gentle mode while away: the time that was left when you left (the clock is stopped). */
  pausedRemaining: number | null;
  /** Pomodoros finished in the current set (back to 0 after a long break). */
  inSet: number;
  /** Pomodoros finished today, kept across visits. */
  today: { date: string; count: number };
  /** What you're working on (step 1 of the method). */
  task: string;
  /** When you left the tab during this pomodoro, or null while you're here. */
  awaySince: number | null;
  /** Interruptions (tab leaves) during this pomodoro. */
  interruptions: number;
  /** The latest thing to tell the player; cleared when they dismiss it. */
  notice: PomodoroNotice | null;
  /** Bumped whenever a phase ends by ringing (the timer on the table rings and shakes). */
  rings: number;
}

/** Local calendar day, e.g. "2026-11-20". */
export function dayKey(now: number) {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function clampSetting<K extends keyof typeof POMODORO_LIMITS>(key: K, value: number) {
  const [min, max, step] = POMODORO_LIMITS[key];
  if (!Number.isFinite(value)) return DEFAULT_POMODORO_SETTINGS[key];
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

export function phaseMinutes(settings: PomodoroSettings, phase: PomodoroPhase) {
  if (phase === "focus" || phase === "idle") return settings.focusMinutes;
  return phase === "shortBreak" ? settings.shortBreakMinutes : settings.longBreakMinutes;
}

/** Time left in the current phase (ms). Idle shows a whole pomodoro. */
export function remainingMs(s: PomodoroState, now: number) {
  if (s.phase === "idle") return s.settings.focusMinutes * MINUTE;
  if (s.pausedRemaining !== null) return s.pausedRemaining;
  return Math.max(0, (s.endsAt ?? now) - now);
}

/** How far through the current phase, 0–1 (0 while idle). */
export function phaseProgress(s: PomodoroState, now: number) {
  if (s.phase === "idle" || s.startedAt === null || s.endsAt === null) return 0;
  // The running phase's own length: the settings may have changed since it started.
  const total = s.endsAt - s.startedAt;
  if (!(total > 0)) return 1;
  return Math.min(1, Math.max(0, 1 - remainingMs(s, now) / total));
}

/** "24:59" style. */
export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** A pomodoro is running: you can't leave the table or the tab without voiding it. */
export const isFocusing = (s: Pick<PomodoroState, "phase">) => s.phase === "focus";

type Patch = Partial<PomodoroState>;

/* ---- Pure transitions: (state, now) -> patch. The store below applies them. ---- */

export function startFocusPatch(s: PomodoroState, now: number): Patch {
  if (s.phase === "focus") return {};
  return {
    // Cutting a long break short still closes the set, as skipping it does.
    ...(s.phase === "longBreak" ? { inSet: 0 } : {}),
    phase: "focus",
    startedAt: now,
    endsAt: now + s.settings.focusMinutes * MINUTE,
    pausedRemaining: null,
    awaySince: null,
    interruptions: 0,
    notice: null,
  };
}

function startBreakPatch(s: PomodoroState, phase: "shortBreak" | "longBreak", now: number): Patch {
  return {
    phase,
    startedAt: now,
    endsAt: now + phaseMinutes(s.settings, phase) * MINUTE,
    pausedRemaining: null,
    awaySince: null,
  };
}

function idlePatch(): Patch {
  return { phase: "idle", startedAt: null, endsAt: null, pausedRemaining: null, awaySince: null };
}

/**
 * How long a strict pomodoro has been left, counted up to its bell: once it has rung it's done,
 * however late a sleeping tab notices.
 */
function strictAwayMs(s: PomodoroState, now: number) {
  return Math.min(now, s.endsAt ?? now) - (s.awaySince ?? now);
}

/** Moves the clock on: ends a phase that has run out, and voids a strict pomodoro left too long. */
export function tickPatch(s: PomodoroState, now: number): Patch {
  if (s.phase === "idle") return {};
  if (s.phase === "focus" && s.awaySince !== null && s.settings.strict) {
    const awayMs = strictAwayMs(s, now);
    if (awayMs > AWAY_GRACE_MS) return voidPatch(s, "left-tab", now, awayMs);
  }
  if (s.pausedRemaining !== null || s.endsAt === null || now < s.endsAt) return {};
  if (s.phase === "focus") {
    const inSet = s.inSet + 1;
    const date = dayKey(now);
    const count = (s.today.date === date ? s.today.count : 0) + 1;
    // At least (not exactly) the interval, so lowering it mid-set still ends the set.
    const breakPhase = inSet >= s.settings.longBreakEvery ? "longBreak" : "shortBreak";
    return {
      ...startBreakPatch(s, breakPhase, now),
      inSet,
      today: { date, count },
      notice: { kind: "focusDone", count: inSet, breakPhase, at: now },
      rings: s.rings + 1,
    };
  }
  // A break rang. A long break closes the set.
  return {
    ...idlePatch(),
    inSet: s.phase === "longBreak" ? 0 : s.inSet,
    notice: { kind: "breakDone", skipped: false, at: now },
    rings: s.rings + 1,
  };
}

export function voidPatch(
  s: PomodoroState,
  reason: "left-tab" | "left-table" | "left-library",
  now: number,
  awayMs = 0,
): Patch {
  if (s.phase !== "focus") return {};
  return {
    ...idlePatch(),
    interruptions: s.interruptions + (reason === "left-tab" ? 1 : 0),
    notice: { kind: "voided", reason, awayMs, at: now },
  };
}

/** You left the tab (or the window lost focus). Only matters during a pomodoro. */
export function awayPatch(s: PomodoroState, now: number): Patch {
  if (s.phase !== "focus" || s.awaySince !== null) return {};
  if (s.settings.strict) return { awaySince: now };
  return { awaySince: now, pausedRemaining: remainingMs(s, now) };
}

/** What the page has seen of you between its checks (it reports leaving with `away`). */
export interface PresenceLog {
  /** When it saw you leave the tab, or null while you're here. */
  leftAt: number | null;
  /** That leave has been reported. */
  reported: boolean;
  /** Its last check. */
  checkedAt: number;
  /** When it last asked "Leave site?": the page stops while that's up, but you're still here. */
  askedAt: number;
}

/**
 * When a leave the timer hasn't been told about began, if it has to be told before the clock
 * moves on (null if not): one the page saw start just before its timers stopped (a closed lid), or
 * a stretch it didn't run at all. Otherwise a pomodoro the computer slept through would ring as
 * done.
 */
export function missedAwaySince(log: PresenceLog, now: number): number | null {
  if (log.reported) return null;
  if (log.leftAt !== null && now - log.leftAt >= BLIP_MS) return log.leftAt;
  if (now - log.checkedAt > STALL_MS && log.askedAt < log.checkedAt) return log.checkedAt;
  return null;
}

/** You're back in the tab. */
export function backPatch(s: PomodoroState, now: number): Patch {
  if (s.awaySince === null) return {};
  const awayMs = now - s.awaySince;
  if (s.phase !== "focus") return { awaySince: null };
  if (s.settings.strict) {
    const strictMs = strictAwayMs(s, now);
    if (strictMs > AWAY_GRACE_MS) return voidPatch(s, "left-tab", now, strictMs);
    return {
      awaySince: null,
      interruptions: s.interruptions + 1,
      notice: { kind: "warned", awayMs: strictMs, at: now },
    };
  }
  const left = s.pausedRemaining ?? remainingMs(s, now);
  return {
    awaySince: null,
    pausedRemaining: null,
    // The clock restarts with what was left; the start moves so progress stays right.
    endsAt: now + left,
    startedAt: now + left - s.settings.focusMinutes * MINUTE,
    interruptions: s.interruptions + 1,
    notice: { kind: "paused", awayMs, at: now },
  };
}

/** Ends a break early: ready for the next pomodoro. */
export function skipBreakPatch(s: PomodoroState, now: number): Patch {
  if (s.phase !== "shortBreak" && s.phase !== "longBreak") return {};
  return {
    ...idlePatch(),
    inSet: s.phase === "longBreak" ? 0 : s.inSet,
    notice: { kind: "breakDone", skipped: true, at: now },
  };
}

export function settingsPatch(s: PomodoroState, change: Partial<PomodoroSettings>): Patch {
  const next = { ...s.settings };
  for (const key of Object.keys(change) as (keyof PomodoroSettings)[]) {
    const value = change[key];
    if (value === undefined) continue;
    if (key in POMODORO_LIMITS) {
      const k = key as keyof typeof POMODORO_LIMITS;
      // A running pomodoro keeps the length it started with.
      if (k === "focusMinutes" && s.phase === "focus") continue;
      next[k] = clampSetting(k, value as number);
    } else if (typeof value === "boolean") {
      // Strictness can't be relaxed in the middle of a pomodoro.
      if (key === "strict" && s.phase === "focus") continue;
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return { settings: next };
}

export interface PomodoroStore extends PomodoroState {
  startFocus: (now?: number) => void;
  tick: (now?: number) => void;
  away: (now?: number) => void;
  back: (now?: number) => void;
  /** Abandons a running pomodoro (it doesn't count). */
  abandon: (reason: "left-table" | "left-library", now?: number) => void;
  skipBreak: (now?: number) => void;
  setTask: (task: string) => void;
  updateSettings: (change: Partial<PomodoroSettings>) => void;
  dismissNotice: () => void;
}

const INITIAL_STATE: PomodoroState = {
  settings: DEFAULT_POMODORO_SETTINGS,
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
};

export const usePomodoro = create<PomodoroStore>()(
  persist(
    (set, get) => {
      const apply = (fn: (s: PomodoroState, now: number) => Patch, now = Date.now()) => {
        const patch = fn(get(), now);
        if (Object.keys(patch).length > 0) set(patch);
      };
      return {
        ...INITIAL_STATE,
        startFocus: (now) => apply(startFocusPatch, now),
        tick: (now) => apply(tickPatch, now),
        away: (now) => apply(awayPatch, now),
        back: (now) => apply(backPatch, now),
        abandon: (reason, now) => apply((s, t) => voidPatch(s, reason, t), now),
        skipBreak: (now) => apply(skipBreakPatch, now),
        setTask: (task) => set({ task: task.slice(0, 80) }),
        updateSettings: (change) => set(settingsPatch(get(), change)),
        dismissNotice: () => set({ notice: null }),
      };
    },
    {
      name: "ovr.pomodoro",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Preferences and today's tally survive a visit; a running pomodoro never does (leaving the
      // page is leaving the tab).
      partialize: (s) => ({ settings: s.settings, today: s.today, task: s.task }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PomodoroState>;
        const settings = { ...DEFAULT_POMODORO_SETTINGS, ...p.settings };
        for (const k of Object.keys(POMODORO_LIMITS) as (keyof typeof POMODORO_LIMITS)[])
          settings[k] = clampSetting(k, settings[k]);
        return {
          ...current,
          settings,
          today: p.today && typeof p.today.count === "number" ? p.today : current.today,
          task: typeof p.task === "string" ? p.task.slice(0, 80) : "",
        };
      },
    },
  ),
);

/** Today's finished pomodoros (0 if the saved tally is from another day). */
export function todayCount(s: Pick<PomodoroState, "today">, now: number) {
  return s.today.date === dayKey(now) ? s.today.count : 0;
}
