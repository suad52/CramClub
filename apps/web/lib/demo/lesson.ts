"use client";

import { create } from "zustand";
import { asApiError } from "@/components/progress/api";
import { lessonBoardId } from "@/lib/game/actions";
import type { LessonJobView } from "@/lib/jobs/types";
import { useBoardLessons } from "@/lib/learning-studio/boardLessons";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";
import { getCloudLesson, makeCloudLesson, sourceChunks } from "@/lib/lessons/client";
import { showToast } from "@/lib/tables/client";
import { SAVED_LESSON, SAVED_LESSON_NOTES, SAVED_LESSON_SOURCE } from "./fixtures";
import { DEMO_LESSON_TOPIC, fallbackDue } from "./settings";

/*
 * The demo controls' "Start a background lesson": a real cloud lesson (POST /api/lessons: the
 * worker on the Vultr server researches, writes, checks and records it), followed here every few
 * seconds. Making one needs a sign-in and takes minutes, so if it can't start, fails, or isn't
 * done within DEMO_FALLBACK_MS, the saved example lesson is offered beside it, clearly marked,
 * while the real one carries on. Either plays on your table's rolling board.
 */

export type DemoLessonState =
  | { kind: "idle" }
  | { kind: "starting"; since: number }
  | { kind: "making"; since: number; job: LessonJobView }
  | { kind: "ready"; job: LessonJobView; lesson: Lesson; chunks: Chunk[] }
  | { kind: "unavailable"; message: string; job: LessonJobView | null };

export const useDemoLesson = create<DemoLessonState>(() => ({ kind: "idle" }));

const POLL_MS = 4000;
let poll: ReturnType<typeof setInterval> | null = null;
/** Bumped on stop: answers for an older run are ignored. */
let run = 0;

function stopPolling() {
  if (poll) clearInterval(poll);
  poll = null;
}

/** Plays a lesson on the board at your table (or the one you're standing at), joined. */
export function playOnBoard(lesson: Lesson, chunks: Chunk[], sourceId: string) {
  const boardId = lessonBoardId();
  if (!boardId) {
    showToast("Sit at a table with a rolling whiteboard to play the lesson there.");
    return false;
  }
  const boards = useBoardLessons.getState();
  boards.start(boardId, { sourceId, lesson, chunks });
  boards.join(boardId);
  return true;
}

export function playSavedLesson() {
  return playOnBoard(SAVED_LESSON, SAVED_LESSON_NOTES, SAVED_LESSON_SOURCE);
}

export function playReadyLesson() {
  const s = useDemoLesson.getState();
  if (s.kind === "ready") playOnBoard(s.lesson, s.chunks, `cloud:${s.job.id}`);
}

async function check(id: string, mine: number) {
  try {
    const job = await getCloudLesson(id);
    if (mine !== run) return;
    if (job.status === "completed" && job.lesson) {
      stopPolling();
      useDemoLesson.setState({ kind: "ready", job, lesson: job.lesson, chunks: sourceChunks(job) });
      return;
    }
    if (job.status === "failed") {
      stopPolling();
      useDemoLesson.setState({
        kind: "unavailable",
        message: job.error?.message ?? "The cloud lesson didn't finish.",
        job,
      });
      return;
    }
    const s = useDemoLesson.getState();
    useDemoLesson.setState({
      kind: "making",
      since: s.kind === "making" ? s.since : Date.now(),
      job,
    });
  } catch {
    // A blip: the next look tries again (the saved example shows once it's been long enough).
  }
}

/** Whether the saved example should be offered beside a lesson still on its way. */
export const lessonSlow = (s: DemoLessonState, now: number) =>
  (s.kind === "starting" || s.kind === "making") && fallbackDue(s.since, now);

/** Starts a real background lesson on the demo topic. */
export async function startDemoLesson() {
  const s = useDemoLesson.getState();
  if (s.kind === "starting" || s.kind === "making") return;
  stopPolling();
  const mine = ++run;
  const since = Date.now();
  useDemoLesson.setState({ kind: "starting", since });
  try {
    const job = await makeCloudLesson({
      topic: DEMO_LESSON_TOPIC,
      level: "high-school",
      length: "short",
    });
    if (mine !== run) return;
    useDemoLesson.setState({ kind: "making", since, job });
    poll = setInterval(() => void check(job.id, mine), POLL_MS);
  } catch (err) {
    if (mine !== run) return;
    const e = asApiError(err);
    useDemoLesson.setState({
      kind: "unavailable",
      message:
        e.status === 401 || e.code === "sign_in_required"
          ? "Making your own cloud lesson needs a sign-in."
          : e.message,
      job: null,
    });
  }
}

/** Forgets the demo's lesson (the library closing, or demo mode off). */
export function resetDemoLesson() {
  run += 1;
  stopPolling();
  useDemoLesson.setState({ kind: "idle" }, true);
}
