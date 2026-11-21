/**
 * "Ms. Fenwick keeps you honest", the rules (pure; lib/focus/watch.ts applies them and she says
 * the line). During a pomodoro's focus phase she shushes the student, kindly and by first name:
 *
 * - "drifted": their OWN face tracking is on and their face has been missing or turned away for
 *   SHUSH_AFTER_MS without a break. Once per drift: she waits for the face to come back before
 *   she'll shush for drifting again (no shushing an empty chair every 90 s).
 * - "back": they came back to the tab after a near miss (the pomodoro's "warned" notice).
 *
 * Never during breaks, never while the student has the feature turned off (the Pomodoro
 * setting `fenwickShush`), never while she's busy talking with someone, at most once per
 * SHUSH_GAP_MS and SHUSH_MAX_PER_POMODORO times a pomodoro.
 */

export type ShushReason = "drifted" | "back";

/** Missing or turned away this long, continuously, earns a shush. */
export const SHUSH_AFTER_MS = 8000;
/** At most one shush in this long. */
export const SHUSH_GAP_MS = 90_000;
/** And at most this many in one pomodoro. */
export const SHUSH_MAX_PER_POMODORO = 3;

export interface ShushLimiter {
  /** When she last shushed (ms), -Infinity if she hasn't this pomodoro. */
  lastAt: number;
  /** Shushes this pomodoro. */
  count: number;
  /** A drift can earn a shush (false after one, until the face is seen again). */
  armed: boolean;
}

/** A new pomodoro: a clean slate. */
export function freshLimiter(): ShushLimiter {
  return { lastAt: -Infinity, count: 0, armed: true };
}

export interface ShushContext {
  /** The pomodoro is in its focus phase. */
  focusing: boolean;
  /** The student has the feature on. */
  enabled: boolean;
  /** She's in a conversation or already saying something. */
  busy: boolean;
}

/** Whether she may shush at all right now (whatever the reason). */
export function mayShush(l: ShushLimiter, now: number, ctx: ShushContext) {
  return (
    ctx.focusing &&
    ctx.enabled &&
    !ctx.busy &&
    l.count < SHUSH_MAX_PER_POMODORO &&
    now - l.lastAt >= SHUSH_GAP_MS
  );
}

/** Whether a drift of `missing` ms earns a shush now. */
export function shouldShushDrift(l: ShushLimiter, missing: number, now: number, ctx: ShushContext) {
  return l.armed && missing >= SHUSH_AFTER_MS && mayShush(l, now, ctx);
}

/** She shushed. */
export function afterShush(l: ShushLimiter, now: number, reason: ShushReason): ShushLimiter {
  return { lastAt: now, count: l.count + 1, armed: reason === "drifted" ? false : l.armed };
}

/** The face was seen again: the next drift may earn a shush. */
export function rearm(l: ShushLimiter): ShushLimiter {
  return l.armed ? l : { ...l, armed: true };
}
