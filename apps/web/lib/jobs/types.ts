/**
 * The Living Library's background work: the contract between the API (enqueue + status), the
 * worker (apps/web/worker, a separate process on the Vultr server) and the UI.
 *
 * Queue: a Postgres table (`lesson_jobs`, the existing Tiger database), claimed with
 * `FOR UPDATE SKIP LOCKED`, so no extra queue service is needed. Each step saves a checkpoint, so a
 * retried job resumes where it stopped and never regenerates (or re-pays for) finished work.
 *
 * Files: narration MP3s and the lesson document go to object storage (Vultr Object Storage, S3
 * compatible; a local-disk driver in development) under deterministic keys; the database keeps
 * only keys and metadata. See lib/storage/types.ts.
 *
 * Endpoints (same-origin; identity from the verified Auth0 session / learner cookie):
 *   POST /api/lessons                { topic, level?, length?, taskId? } → 202 LessonJobView
 *        (taskId: build from that Librarian request's sources instead of new research)
 *   GET  /api/lessons                → { jobs: LessonJobView[] }            (mine, newest first)
 *   GET  /api/lessons/:id            → LessonJobView & { lesson?: Lesson }  (owner, or a member of
 *        a Study Circle it was shared to)
 *   POST /api/lessons/:id/retry      → LessonJobView                        (owner, failed only)
 *   GET  /api/lessons/:id/audio/:scene → 302 to a short-lived signed URL (or a stream in dev),
 *        after the same access check
 *   GET  /api/health                 → { ok, db, storage, worker: { lastSeenSecondsAgo } }
 */

export const LESSON_JOB_STATUSES = [
  "queued",
  "researching",
  "generating_lesson",
  "generating_audio",
  "saving",
  "completed",
  "failed",
] as const;
export type LessonJobStatus = (typeof LESSON_JOB_STATUSES)[number];

export const BUSY_JOB_STATUSES: readonly LessonJobStatus[] = [
  "queued",
  "researching",
  "generating_lesson",
  "generating_audio",
  "saving",
];

/** Human labels (truthful: what is actually happening). */
export const JOB_STATUS_LABELS: Record<LessonJobStatus, string> = {
  queued: "Waiting for the library's worker",
  researching: "TinyFish is researching the topic",
  generating_lesson: "Gemini is writing the lesson and quiz",
  generating_audio: "ElevenLabs is recording the narration",
  saving: "Saving to the library's cloud storage",
  completed: "Ready",
  failed: "Something went wrong",
};

/** Attempts before a job stays failed (each attempt resumes from its last checkpoint). */
export const MAX_JOB_ATTEMPTS = 3;
/** A worker that hasn't touched a running job for this long is presumed dead; the job is retried. */
export const JOB_LEASE_SECONDS = 180;
/** The worker writes a heartbeat this often; the API treats it as offline after 3 missed beats. */
export const WORKER_HEARTBEAT_SECONDS = 15;

/** One stored narration clip. */
export interface LessonAudioRef {
  scene: number;
  /** Seconds, when known. */
  duration: number | null;
}

/** A lesson job as its owner sees it (no storage keys, no owner ids). */
export interface LessonJobView {
  id: string;
  topic: string;
  status: LessonJobStatus;
  busy: boolean;
  /** Short truthful progress note, e.g. "Recorded 3 of 6 scenes". */
  progress: string | null;
  title: string | null;
  summary: string | null;
  sceneCount: number | null;
  audio: LessonAudioRef[];
  sources: { title: string; url: string }[];
  error: { message: string; retryable: boolean } | null;
  attempts: number;
  createdAt: string;
  completedAt: string | null;
  /** Where the files live ("vultr" in production, "local" in development). */
  storage: "vultr" | "local";
}
