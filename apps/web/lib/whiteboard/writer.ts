import type { Point } from "./types";
import type { WrittenStroke } from "./strokeFont";

/**
 * Timing for "writing out" an answer: each stroke gets a start time and duration based on its
 * length, with short pen-up pauses between strokes, longer ones between words and lines, so it
 * reads like someone writing rather than a progress bar.
 */

export interface ScheduledStroke {
  points: Point[];
  start: number;
  end: number;
  /** Cumulative path length at each point, for partial drawing. */
  lengths: number[];
}

export interface WritingSchedule {
  strokes: ScheduledStroke[];
  duration: number;
}

const PAUSE = { stroke: 0.035, word: 0.11, line: 0.25 };

function cumulative(points: readonly Point[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    out.push(out[i - 1]! + Math.hypot(bx - ax, by - ay));
  }
  return out;
}

/**
 * @param lineHeight board units; natural speed is about 10 line-heights of ink per second.
 * @param limits total writing time is kept between these (seconds), speeding up long answers.
 */
export function scheduleWriting(
  strokes: readonly WrittenStroke[],
  lineHeight: number,
  limits: { min: number; max: number } = { min: 1.5, max: 9 },
): WritingSchedule {
  const lengths = strokes.map((s) => cumulative(s.points));
  const ink = lengths.reduce((sum, l) => sum + (l[l.length - 1] ?? 0), 0);
  let pauses = 0;
  strokes.forEach((s, i) => {
    if (i === 0) return;
    pauses +=
      s.line !== strokes[i - 1]!.line ? PAUSE.line : s.wordStart ? PAUSE.word : PAUSE.stroke;
  });
  const natural = ink / (lineHeight * 10) + pauses;
  // Speed everything up (ink and pauses alike) when a long answer would take too long.
  const k =
    natural > limits.max
      ? limits.max / natural
      : natural < limits.min && natural > 0
        ? limits.min / natural
        : 1;
  const speed = (lineHeight * 10) / k;
  let t = 0;
  const scheduled = strokes.map((s, i) => {
    if (i > 0) {
      const prev = strokes[i - 1]!;
      t += (s.line !== prev.line ? PAUSE.line : s.wordStart ? PAUSE.word : PAUSE.stroke) * k;
    }
    const len = lengths[i]![lengths[i]!.length - 1] ?? 0;
    const start = t;
    t += len / speed;
    return { points: s.points, start, end: t, lengths: lengths[i]! };
  });
  return { strokes: scheduled, duration: t };
}

export interface WritingFrame {
  /** Strokes fully written by time t. */
  done: number;
  /** Points of the stroke being written right now (empty between strokes). */
  partial: Point[];
  /** Where the pen tip is, if it's on the board. */
  tip: [number, number] | null;
}

/** What's on the board `t` seconds into the writing. */
export function frameAt(schedule: WritingSchedule, t: number): WritingFrame {
  const { strokes } = schedule;
  let done = 0;
  while (done < strokes.length && strokes[done]!.end <= t) done++;
  const current = strokes[done];
  if (!current || t < current.start) {
    const last = strokes[done - 1]?.points.at(-1);
    return { done, partial: [], tip: last && done < strokes.length ? [last[0], last[1]] : null };
  }
  const total = current.lengths[current.lengths.length - 1] ?? 0;
  const span = current.end - current.start;
  const reach = span > 0 ? ((t - current.start) / span) * total : total;
  let n = 1;
  while (n < current.points.length && current.lengths[n]! <= reach) n++;
  const partial = current.points.slice(0, Math.max(1, n));
  const tip = partial[partial.length - 1]!;
  return { done, partial, tip: [tip[0], tip[1]] };
}
