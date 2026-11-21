import type { TimelineEntry } from "@/lib/learning/types";

/** Display helpers for the progress dashboard. Pure, so they can be tested without a browser. */

const NUMBER = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export const formatNumber = (n: number) => NUMBER.format(n);

/** "3h 42m", "45m", "2h": whole minutes, rounded. */
export function formatMinutes(total: number) {
  const m = Math.max(0, Math.round(total));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Seconds as "40s" under a minute, otherwise like formatMinutes. */
export function formatSeconds(total: number) {
  if (total < 59.5) return `${Math.max(0, Math.round(total))}s`;
  return formatMinutes(total / 60);
}

/** "1 lesson", "3 lessons". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** n ÷ d, or null when there is nothing to divide by. */
export function ratio(n: number, d: number) {
  return d > 0 ? n / d : null;
}

export const formatPercent = (r: number) => `${Math.round(r * 100)}%`;

/** Axis tick labels: in full under 10,000, compact (10K) from there. */
export function formatTick(n: number, top: number) {
  return top >= 10_000 ? COMPACT.format(n) : formatNumber(n);
}

/** A calendar day ("YYYY-MM-DD", no time zone) as midnight UTC, so formatting never shifts it. */
export function parseDay(day: string) {
  return new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)));
}

export function formatDay(
  day: string,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
) {
  return parseDay(day).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

/** "Nov 16 – Nov 22" for a period whose end is exclusive (or "now"). */
export function formatRange(fromIso: string, toIso: string, timeZone?: string) {
  const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone };
  const from = new Date(fromIso);
  const to = new Date(Math.max(from.getTime(), new Date(toIso).getTime() - 1));
  const a = from.toLocaleDateString(undefined, options);
  const b = to.toLocaleDateString(undefined, options);
  return a === b ? a : `${a} – ${b}`;
}

/** The viewer's own calendar day for a moment, "YYYY-MM-DD". */
export function localDayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface DayGroup {
  key: string;
  date: Date;
  entries: TimelineEntry[];
}

/** Timeline entries (newest first) grouped by the viewer's calendar day, order kept. */
export function groupByDay(entries: readonly TimelineEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = localDayKey(date);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, date, entries: [entry] });
  }
  return groups;
}

/** "Today", "Yesterday", or "Wednesday, November 18" (with the year when it isn't this one). */
export function dayHeading(date: Date, now: Date) {
  const key = localDayKey(date);
  if (key === localDayKey(now)) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === localDayKey(yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/**
 * A y-axis for counts: a clean step (1, 2 or 5 × 10ⁿ, never below 1) giving about `target`
 * intervals, the top tick at or above `max`, and every tick from 0.
 */
export function niceScale(max: number, target = 3) {
  if (!(max > 0)) return { step: 1, top: 1, ticks: [0, 1] };
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return scaleWithStep(
    max,
    Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag),
  );
}

/** Like niceScale, for minutes: steps of 5, 10, 15, 30 or 60 minutes, or nice numbers of hours. */
export function niceMinutesScale(max: number, target = 3) {
  if (!(max > 0)) return { step: 15, top: 15, ticks: [0, 15] };
  const step = [5, 10, 15, 30, 60].find((s) => max / s <= target);
  if (step) return scaleWithStep(max, step);
  const hours = niceScale(max / 60, target);
  return scaleWithStep(max, hours.step * 60);
}

function scaleWithStep(max: number, step: number) {
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
  return { step, top, ticks };
}

/** A short minutes label for an axis: "30m", "1h", "1.5h". */
export function formatMinutesTick(m: number) {
  return m < 60 ? `${m}m` : `${Number((m / 60).toFixed(1))}h`;
}

/** "12 ms", "<1 ms". */
export function formatMs(ms: number) {
  return ms < 1 ? "<1 ms" : `${formatNumber(Math.round(ms))} ms`;
}

/** An hour of the day (0–23) as "3 PM", in the viewer's clock style. */
export function formatHour(hour: number) {
  return new Date(Date.UTC(2000, 0, 1, hour)).toLocaleTimeString(undefined, {
    hour: "numeric",
    timeZone: "UTC",
  });
}

/** "3:42 PM", in the viewer's time zone. */
export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** "Nov 18", in the viewer's time zone. */
export function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Change from last period to this one. */
export function delta(now: number, before: number) {
  const diff = now - before;
  return { diff, direction: diff > 0 ? "up" : diff < 0 ? "down" : "same" } as const;
}

/** What a timeline entry was, for people. */
export function entryKind(type: TimelineEntry["type"]) {
  return type === "study_session_completed"
    ? "Study session"
    : type === "lesson_completed"
      ? "Lesson"
      : "Quiz";
}

/** The entry's headline: the lesson for lessons and quizzes, the pomodoro for sessions. */
export function entryTitle(e: TimelineEntry) {
  if (e.type === "study_session_completed") return "Pomodoro";
  return e.lessonTitle ?? (e.type === "quiz_completed" ? "Knowledge check" : "A lesson");
}

/** Quiz scores are 100 (right on the first try) or 0; anything else shows as a percentage. */
export function entryScore(e: TimelineEntry) {
  if (e.score === null) return null;
  if (e.type === "quiz_completed" && e.score >= 100) return "Right first try";
  if (e.type === "quiz_completed" && e.score <= 0) return "Not first try";
  return `${Math.round(e.score)}%`;
}
