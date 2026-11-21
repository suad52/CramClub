/**
 * Learning analytics rules, kept free of the database so they can be tested and shown to
 * students as-is: what earns XP, the daily caps, how a focus session is validated, how the
 * optional "seen at the desk" reading is clamped, and how streaks are counted (with rest days).
 * The server applies them; the browser only displays them.
 */

/** XP for each verified activity. Starting values, meant to be tuned. */
export const XP = {
  /** A completed pomodoro (a validated focus session). */
  sessionCompleted: 10,
  /** Finishing every scene of a lesson, once per lesson. */
  lessonCompleted: 25,
  /** Answering a lesson's knowledge check, once per question. */
  quizCompleted: 10,
  /** Extra for getting it right on the first try (later tries can't: the answer was shown). */
  quizPassed: 15,
  /** Ticking off an activity in a study plan the Librarian made, once per activity. */
  planItemCompleted: 10,
} as const;

/** How many of each activity can earn XP per day; more still count, for 0 XP. */
export const DAILY_CAPS = {
  sessions: 12,
  lessons: 10,
  quizzes: 40,
  planItems: 12,
} as const;

/** The library's time zone: days, weeks and streaks follow its midnight. */
export const LIBRARY_TIME_ZONE = "America/Toronto";

/** Leeway for clock and network delays when a pomodoro reports it has rung (s). */
export const SESSION_EARLY_GRACE_S = 20;
/** How late a finished pomodoro may report in (pauses in gentle mode, a slept tab) (s). */
export const SESSION_LATE_LIMIT_S = 30 * 60;

/** Community charts hide any group smaller than this, so no one can be singled out. */
export const MIN_GROUP = 3;

export type SessionVerdict =
  { ok: true; durationSeconds: number } | { ok: false; reason: "too-early" | "too-late" };

/**
 * Whether a focus session that started at `startedAt` (server time) can count as completed at
 * `now`. It counts the planned length, never more: time paused or spent away isn't focus.
 */
export function validateSessionEnd(
  startedAt: Date,
  now: Date,
  plannedSeconds: number,
): SessionVerdict {
  const elapsed = (now.getTime() - startedAt.getTime()) / 1000;
  if (elapsed < plannedSeconds - SESSION_EARLY_GRACE_S) return { ok: false, reason: "too-early" };
  if (elapsed > plannedSeconds + SESSION_LATE_LIMIT_S) return { ok: false, reason: "too-late" };
  return { ok: true, durationSeconds: plannedSeconds };
}

/** The shortest believable time to go through a lesson (s): no skipping straight to the end. */
export function minLessonSeconds(sceneCount: number) {
  return Math.min(180, sceneCount * 20);
}

/**
 * What the browser may report with a finished pomodoro, from the student's own opt-in face
 * tracking (POST /api/learning/session-complete `presence`): seconds the camera was on, and
 * seconds a face was actually seen roughly facing the screen. Optional: no camera is normal.
 */
export interface PresenceReport {
  cameraSeconds: number;
  seenSeconds: number;
}

/** A presence reading as stored on the event (learning_events.camera_seconds / seen_seconds). */
export interface PresenceReading extends PresenceReport {
  /**
   * The browser's numbers had to be cut down to fit the session (a trust flag, kept on the
   * event). Dropping a fraction of a second doesn't count.
   */
  clamped: boolean;
}

/**
 * The reading the server keeps for a session credited `durationSeconds`: whole seconds, never
 * negative, camera time no longer than the session, seen time no longer than camera time. Null
 * when nothing was reported. Never a reason to refuse the session itself.
 */
export function clampPresence(
  report: PresenceReport | null | undefined,
  durationSeconds: number,
): PresenceReading | null {
  if (!report) return null;
  const whole = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
  const limit = whole(durationSeconds);
  const camera = Math.min(whole(report.cameraSeconds), limit);
  const seen = Math.min(whole(report.seenSeconds), camera);
  return {
    cameraSeconds: camera,
    seenSeconds: seen,
    clamped: camera !== Math.floor(report.cameraSeconds) || seen !== Math.floor(report.seenSeconds),
  };
}

/** Any 7 days in a row may hold at most one rest day: a missed day that doesn't end a streak. */
export const REST_DAY_EVERY = 7;

export interface Streaks {
  /** Days with learning activity in the current streak (rest days keep it going, not count). */
  current: number;
  longest: number;
  /**
   * The missed days the current streak was kept through, oldest first ("YYYY-MM-DD"). Yesterday
   * appears here when it was missed and today has no activity yet: the rest day is in use.
   */
  restDays: string[];
  /** The current streak ends unless there is activity today (no rest day is free for today). */
  studyToday: boolean;
}

/**
 * Current and longest streaks from the days with learning activity ("YYYY-MM-DD", library time).
 * Forgiving: one missed day between two active days is a rest day and doesn't break the streak,
 * as long as no other rest day fell in the 7 days before it. Two missed days in a row always do.
 * A streak is still current if its last day is today or yesterday (today isn't over), or the day
 * before yesterday when yesterday can be its rest day.
 */
export function streaks(activeDays: readonly string[], today: string): Streaks {
  const days = [...new Set(activeDays)].sort();
  const toNum = (d: string) =>
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  const toDay = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
  const restFree = (day: number, lastRest: number) => day - lastRest >= REST_DAY_EVERY;
  let longest = 0;
  let run = 0;
  let prev = NaN;
  let lastRest = -Infinity;
  let rests: number[] = [];
  for (const d of days) {
    const n = toNum(d);
    if (n - prev === 1) run += 1;
    else if (n - prev === 2 && restFree(n - 1, lastRest)) {
      run += 1;
      lastRest = n - 1;
      rests.push(n - 1);
    } else {
      run = 1;
      rests = [];
    }
    longest = Math.max(longest, run);
    prev = n;
  }
  const t = toNum(today);
  const since = t - prev;
  if (!(since <= 1) && !(since === 2 && restFree(t - 1, lastRest)))
    return { current: 0, longest, restDays: [], studyToday: false };
  if (since === 2) rests = [...rests, t - 1];
  const studyToday = since === 2 || (since === 1 && !restFree(t, lastRest));
  return { current: run, longest, restDays: rests.map(toDay), studyToday };
}

/** A stable, URL-safe id for a subject name ("Cell Biology" → "cell-biology"). */
export function subjectSlug(name: string) {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "general";
}

/** Clean, short public name for the leaderboard. */
export function cleanDisplayName(name: string) {
  return name.replace(/\s+/g, " ").trim().slice(0, 32);
}
