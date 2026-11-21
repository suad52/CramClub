/**
 * Learning analytics rules, kept free of the database so they can be tested and shown to
 * students as-is: what earns XP, the daily caps, how a focus session is validated, and how
 * streaks are counted. The server applies them; the browser only displays them.
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
 * Current and longest streaks from the days with learning activity ("YYYY-MM-DD", library
 * time). A streak is still current if its last day is today or yesterday (today isn't over).
 */
export function streaks(activeDays: readonly string[], today: string) {
  const days = [...new Set(activeDays)].sort();
  const toNum = (d: string) =>
    Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;
  let longest = 0;
  let run = 0;
  let prev = NaN;
  for (const d of days) {
    const n = toNum(d);
    run = n - prev === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }
  const last = days.length ? toNum(days[days.length - 1]!) : NaN;
  const current = toNum(today) - last <= 1 ? run : 0;
  return { current, longest };
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
