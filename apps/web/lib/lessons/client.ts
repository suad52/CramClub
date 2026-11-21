"use client";

import { getJson, postJson } from "@/components/progress/api";
import type { LessonJobView } from "@/lib/jobs/types";
import type { Chunk, Lesson, LessonLength, Level } from "@/lib/learning-studio/schema";

/**
 * The browser's side of the cloud lessons API (contract in lib/jobs/types.ts). Same-origin
 * requests only: who's asking is the session cookie, never an id we send.
 */

/** GET /api/lessons/:id: the job, plus the lesson once it's ready. */
export type CloudLesson = LessonJobView & { lesson?: Lesson };

export interface NewCloudLesson {
  topic: string;
  level?: Level;
  length?: LessonLength;
  /** Build from this Librarian request's sources instead of new research. */
  taskId?: string;
}

export interface Health {
  ok: boolean;
  db: boolean;
  storage: boolean;
  worker: { lastSeenSecondsAgo: number | null };
}

export const listCloudLessons = () => getJson<{ jobs: LessonJobView[] }>("/api/lessons");
export const getCloudLesson = (id: string, signal?: AbortSignal) =>
  getJson<CloudLesson>(`/api/lessons/${encodeURIComponent(id)}`, signal);
export const makeCloudLesson = (input: NewCloudLesson) =>
  postJson<LessonJobView>("/api/lessons", input);
export const retryCloudLesson = (id: string) =>
  postJson<LessonJobView>(`/api/lessons/${encodeURIComponent(id)}/retry`, {});

/** The health check answers 503 with the same body when something is down: read it either way. */
export async function getHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store", signal });
    const body = (await res.json()) as Partial<Health>;
    if (typeof body.ok !== "boolean" || !body.worker) return null;
    return body as Health;
  } catch {
    return null;
  }
}

/** The worker beats every 15 s; three missed beats and it counts as offline. */
export const WORKER_ONLINE_SECONDS = 45;
export const workerOnline = (h: Health | null) =>
  h?.worker.lastSeenSecondsAgo != null && h.worker.lastSeenSecondsAgo <= WORKER_ONLINE_SECONDS;

/** Where a stored scene's narration is served (after the API's access check). */
export const sceneAudioUrl = (jobId: string, scene: number) =>
  `/api/lessons/${encodeURIComponent(jobId)}/audio/${scene}`;

/**
 * Stored narration by lesson scene index (0-based, as in lesson.scenes): what the player plays
 * instead of asking for new speech. Scenes without a stored clip are left out.
 */
export function storedAudio(job: LessonJobView): Record<number, string> {
  const out: Record<number, string> = {};
  for (const a of job.audio) out[a.scene] = sceneAudioUrl(job.id, a.scene);
  return out;
}

/**
 * Grounding for the player's AI teacher and source panel: page N = source N (the worker numbers
 * the research the same way when it writes the lesson).
 */
export function sourceChunks(job: LessonJobView): Chunk[] {
  return job.sources.map((s, i) => ({ page: i + 1, text: `${s.title}\n${s.url}` }));
}
