import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import {
  LENGTHS,
  LEVELS,
  type Lesson,
  type LessonLength,
  LessonSchema,
  type Level,
} from "@/lib/learning-studio/schema";
import { type ObjectStorage, lessonKey, sceneAudioKey, storageDriver } from "@/lib/storage";
import {
  BUSY_JOB_STATUSES,
  JOB_LEASE_SECONDS,
  type LessonAudioRef,
  type LessonJobStatus,
  type LessonJobView,
  MAX_JOB_ATTEMPTS,
  WORKER_HEARTBEAT_SECONDS,
} from "./types";

/**
 * The lesson-job queue on Postgres (table lesson_jobs, migration 0009). The API side enqueues and
 * reads; the worker side claims, checkpoints and finishes. Every statement is tagged with a
 * comment naming it (the unit tests' stand-in database dispatches on it).
 *
 * Claims: `FOR UPDATE SKIP LOCKED`, so two workers never take the same job, plus a lease
 * (lease_until) the worker keeps extending. A job whose lease runs out (the worker died) is
 * claimable again, until it has used MAX_JOB_ATTEMPTS. Each claim writes a fresh token into
 * locked_by, and every worker write is fenced on it: a worker that lost its lease can't overwrite
 * the job's new owner.
 *
 * Reads: the owner, or a member of a Study Circle the lesson was shared to (a circle_items row of
 * kind 'lesson' whose payload has `lessonJobId`). Owner ids and storage keys never leave this file
 * in a view.
 */

type Sql = postgres.Sql;

export const JOB_LIMITS = {
  /** Jobs one learner may have queued or running at once. */
  activePerOwner: 3,
  /** Jobs one learner may start in any 24 hours. */
  perDay: 20,
  topicLength: 200,
} as const;

/** Circle items that share a lesson job carry its id under this payload key. */
export const SHARED_JOB_KEY = "lessonJobId";

export type JobOutcome<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; code: string; message: string };

const fail = (status: number, code: string, message: string): JobOutcome<never> => ({
  ok: false,
  status,
  code,
  message,
});

export const NewLessonJobSchema = z.object({
  topic: z.string().trim().min(3).max(JOB_LIMITS.topicLength),
  level: z.enum(LEVELS).optional(),
  length: z.enum(LENGTHS).optional(),
  taskId: z.uuid().optional(),
});
export type NewLessonJob = z.infer<typeof NewLessonJobSchema>;

/** A research source as the job keeps it: what Gemini reads, trimmed. */
export interface CheckpointSource {
  title: string;
  url: string;
  domain: string;
  text: string;
  snippetOnly?: boolean;
}

/** Work a job has finished, so a retry resumes instead of redoing (and re-paying for) it. */
export interface JobCheckpoint {
  research?: { from: "tinyfish" | "librarian"; sources: CheckpointSource[] };
  /** The stored lesson document's key, once Gemini's lesson is saved. */
  lesson?: string;
  /** Narration clips already stored (scene = 0-based index into lesson.scenes). */
  recorded?: LessonAudioRef[];
  /** Where this job's files were written. */
  storage?: "vultr" | "local";
}

/** A lesson_jobs row (the columns this module reads). */
export interface JobRow {
  id: string;
  owner_id: string;
  topic: string;
  level: string;
  length: string;
  task_id: string | null;
  status: LessonJobStatus;
  progress: string | null;
  attempts: number;
  checkpoint: JobCheckpoint;
  title: string | null;
  summary: string | null;
  scene_count: number | null;
  audio: LessonAudioRef[];
  sources: { title: string; url: string }[];
  error_message: string | null;
  error_retryable: boolean;
  created_at: Date;
  completed_at: Date | null;
}

/** What the worker holds after a claim. `token` fences every write it makes. */
export interface ClaimedJob {
  id: string;
  ownerId: string;
  topic: string;
  level: Level;
  length: LessonLength;
  taskId: string | null;
  status: LessonJobStatus;
  attempts: number;
  checkpoint: JobCheckpoint;
  token: string;
}

/** The worker's write didn't land: its lease ran out and the job moved on without it. */
export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lost the lease on lesson job ${jobId}`);
    this.name = "LeaseLostError";
  }
}

const isBusy = (s: LessonJobStatus) => BUSY_JOB_STATUSES.includes(s);
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

/* ---- Views ---- */

export function jobView(
  row: JobRow,
  currentDriver: "vultr" | "local" = storageDriver() === "local" ? "local" : "vultr",
): LessonJobView {
  const checkpoint = row.checkpoint ?? {};
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    busy: isBusy(row.status),
    progress: row.progress,
    title: row.title,
    summary: row.summary,
    sceneCount: row.scene_count,
    // While narration is being recorded, the clips stored so far.
    audio: row.status === "completed" ? (row.audio ?? []) : (checkpoint.recorded ?? []),
    sources: (row.sources ?? []).map((s) => ({ title: s.title, url: s.url })),
    error:
      row.status === "failed"
        ? {
            message: row.error_message ?? "Something went wrong.",
            retryable: row.error_retryable,
          }
        : null,
    attempts: row.attempts,
    createdAt: iso(row.created_at)!,
    completedAt: iso(row.completed_at),
    storage: checkpoint.storage ?? currentDriver,
  };
}

/* ---- API side ---- */

export async function enqueueLessonJob(
  sql: Sql,
  ownerId: string,
  input: unknown,
): Promise<JobOutcome<LessonJobView>> {
  const parsed = NewLessonJobSchema.safeParse(input);
  if (!parsed.success)
    return fail(
      400,
      "bad_request",
      `Give a topic of 3 to ${JOB_LIMITS.topicLength} characters (level and length are optional).`,
    );
  const { topic, taskId = null } = parsed.data;
  const level = parsed.data.level ?? "high-school";
  const length = parsed.data.length ?? "short";
  const out = await sql.begin(async (tx) => {
    // One enqueue per learner at a time, so the limits below can't be raced past.
    const [me] = await tx`/* jobs:lock-owner */
      SELECT user_id FROM learners WHERE user_id = ${ownerId} FOR UPDATE`;
    if (!me) return fail(404, "not_found", "No such learner.");
    // The same request again (a double click, a resend) gets the job already under way.
    const [same] = await tx<JobRow[]>`/* jobs:find-active */
      SELECT * FROM lesson_jobs
      WHERE owner_id = ${ownerId} AND status NOT IN ('completed', 'failed')
        AND lower(topic) = lower(${topic}) AND level = ${level} AND length = ${length}
        AND task_id IS NOT DISTINCT FROM ${taskId}::uuid
      ORDER BY created_at DESC LIMIT 1`;
    if (same) return { ok: true as const, status: 202, body: jobView(same) };
    const [counts] = await tx<{ active: number; today: number }[]>`/* jobs:counts */
      SELECT count(*) FILTER (WHERE status NOT IN ('completed', 'failed'))::int AS active,
        count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS today
      FROM lesson_jobs WHERE owner_id = ${ownerId}`;
    if ((counts?.active ?? 0) >= JOB_LIMITS.activePerOwner)
      return fail(
        429,
        "too_many_active",
        `You already have ${JOB_LIMITS.activePerOwner} lessons in the works. Wait for one to finish.`,
      );
    if ((counts?.today ?? 0) >= JOB_LIMITS.perDay)
      return fail(
        429,
        "daily_limit",
        `That's ${JOB_LIMITS.perDay} lessons in a day, the limit. Try again tomorrow.`,
      );
    if (taskId) {
      const [task] = await tx<{ sources: number }[]>`/* jobs:task-sources */
        SELECT (SELECT count(*)::int FROM research_sources s
          WHERE s.task_id = t.id AND s.user_id = ${ownerId}) AS sources
        FROM librarian_tasks t WHERE t.id = ${taskId} AND t.user_id = ${ownerId}`;
      if (!task) return fail(404, "not_found", "No such Librarian request.");
      if (!task.sources)
        return fail(409, "conflict", "That Librarian request has no sources to build from yet.");
    }
    const [row] = await tx<JobRow[]>`/* jobs:insert */
      INSERT INTO lesson_jobs (id, owner_id, topic, level, length, task_id)
      VALUES (${randomUUID()}, ${ownerId}, ${topic}, ${level}, ${length}, ${taskId})
      RETURNING *`;
    return { ok: true as const, status: 202, body: jobView(row!) };
  });
  return out as JobOutcome<LessonJobView>;
}

/** The learner's own jobs, newest first. */
export async function listLessonJobs(sql: Sql, ownerId: string, limit = 50) {
  const rows = await sql<JobRow[]>`/* jobs:list */
    SELECT * FROM lesson_jobs WHERE owner_id = ${ownerId}
    ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(100, limit))}`;
  return rows.map((r) => jobView(r));
}

/** A job the viewer may read (owner, or member of a circle it was shared to), or null. */
export async function readableJob(sql: Sql, viewerId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await sql<(JobRow & { is_owner: boolean })[]>`/* jobs:readable */
    SELECT j.*, (j.owner_id = ${viewerId}) AS is_owner FROM lesson_jobs j
    WHERE j.id = ${id} AND (j.owner_id = ${viewerId} OR EXISTS (
      SELECT 1 FROM circle_items i
      JOIN circle_members m ON m.circle_id = i.circle_id AND m.learner_id = ${viewerId}
      WHERE i.kind = 'lesson' AND i.payload->>'lessonJobId' = j.id::text))`;
  return row ?? null;
}

export async function getLessonJob(sql: Sql, viewerId: string, id: string) {
  const row = await readableJob(sql, viewerId, id);
  return row ? { view: jobView(row), isOwner: row.is_owner, row } : null;
}

/** The stored lesson document, validated again on the way out (null if not written yet). */
export async function loadLesson(storage: ObjectStorage, jobId: string): Promise<Lesson | null> {
  const bytes = await storage.get(lessonKey(jobId));
  if (!bytes) return null;
  try {
    const parsed = LessonSchema.safeParse(JSON.parse(Buffer.from(bytes).toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The storage key of a narration clip the viewer may play, or null (no access, not recorded). */
export async function sceneAudio(sql: Sql, viewerId: string, id: string, scene: number) {
  if (!Number.isInteger(scene) || scene < 0 || scene > 20) return null;
  const row = await readableJob(sql, viewerId, id);
  if (!row) return null;
  const view = jobView(row);
  return view.audio.some((a) => a.scene === scene) ? { key: sceneAudioKey(id, scene), view } : null;
}

/** The owner retries a failed job: it resumes from its checkpoint with a fresh attempt budget. */
export async function retryLessonJob(
  sql: Sql,
  ownerId: string,
  id: string,
): Promise<JobOutcome<LessonJobView>> {
  if (!z.uuid().safeParse(id).success) return fail(404, "not_found", "No such lesson.");
  const [row] = await sql<JobRow[]>`/* jobs:retry */
    UPDATE lesson_jobs SET status = 'queued', attempts = 0, run_after = now(), progress = NULL,
      error_message = NULL, error_retryable = false, locked_by = NULL, locked_at = NULL,
      lease_until = NULL, updated_at = now()
    WHERE id = ${id} AND owner_id = ${ownerId} AND status = 'failed'
    RETURNING *`;
  if (row) return { ok: true, status: 202, body: jobView(row) };
  const [exists] = await sql<{ status: LessonJobStatus }[]>`/* jobs:owned-status */
    SELECT status FROM lesson_jobs WHERE id = ${id} AND owner_id = ${ownerId}`;
  if (!exists) return fail(404, "not_found", "No such lesson.");
  return fail(409, "conflict", "Only a lesson that failed can be retried.");
}

/** For /api/health: how long since any worker checked in (null: never). */
export async function workerStatus(sql: Sql) {
  const [r] = await sql<{ ago: number | null }[]>`/* worker:last-seen */
    SELECT extract(epoch FROM now() - max(seen_at))::float8 AS ago FROM worker_heartbeats`;
  const ago = r?.ago ?? null;
  return {
    lastSeenSecondsAgo: ago === null ? null : Math.max(0, Math.round(ago)),
    online: ago !== null && ago <= WORKER_HEARTBEAT_SECONDS * 3,
  };
}

/* ---- Worker side ---- */

/** Seconds before a failed attempt is tried again: 20 s, 40 s, 80 s … (5 min at most). */
export const retryDelaySeconds = (attempt: number) =>
  Math.min(300, 20 * 2 ** Math.max(0, attempt - 1));

const toClaim = (r: JobRow & { locked_by: string }): ClaimedJob => ({
  id: r.id,
  ownerId: r.owner_id,
  topic: r.topic,
  level: (LEVELS as readonly string[]).includes(r.level) ? (r.level as Level) : "high-school",
  length: (LENGTHS as readonly string[]).includes(r.length) ? (r.length as LessonLength) : "short",
  taskId: r.task_id,
  status: r.status,
  attempts: r.attempts,
  checkpoint: r.checkpoint ?? {},
  token: r.locked_by,
});

/**
 * Takes the next runnable job: queued and due, or abandoned by a dead worker (lease expired).
 * Abandoned jobs that have used every attempt are failed first, so they aren't picked forever.
 */
export async function claimLessonJob(sql: Sql, workerId: string): Promise<ClaimedJob | null> {
  await sql`/* jobs:reap */
    UPDATE lesson_jobs SET status = 'failed', progress = NULL, locked_by = NULL, locked_at = NULL,
      lease_until = NULL, error_retryable = true, updated_at = now(),
      error_message = 'The library''s worker stopped while making this lesson, more than once. Retry to pick up where it left off.'
    WHERE status NOT IN ('completed', 'failed') AND lease_until < now()
      AND attempts >= ${MAX_JOB_ATTEMPTS}`;
  const token = `${workerId}#${randomUUID().slice(0, 8)}`;
  const [row] = await sql<(JobRow & { locked_by: string })[]>`/* jobs:claim */
    UPDATE lesson_jobs j SET attempts = j.attempts + 1, locked_by = ${token}, locked_at = now(),
      lease_until = now() + make_interval(secs => ${JOB_LEASE_SECONDS}), updated_at = now()
    FROM (
      SELECT id FROM lesson_jobs
      WHERE status NOT IN ('completed', 'failed') AND run_after <= now()
        AND (lease_until IS NULL OR lease_until < now()) AND attempts < ${MAX_JOB_ATTEMPTS}
      ORDER BY run_after, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ) next
    WHERE j.id = next.id
    RETURNING j.*`;
  return row ? toClaim(row) : null;
}

/** Keeps the claim alive. False when it's gone (the job was reclaimed, finished or deleted). */
export async function extendLease(sql: Sql, job: ClaimedJob): Promise<boolean> {
  const rows = await sql`/* jobs:extend */
    UPDATE lesson_jobs SET lease_until = now() + make_interval(secs => ${JOB_LEASE_SECONDS})
    WHERE id = ${job.id} AND locked_by = ${job.token} AND status NOT IN ('completed', 'failed')
    RETURNING id`;
  return rows.length > 0;
}

export interface JobPatch {
  status?: LessonJobStatus;
  progress?: string;
  /** Merged into the stored checkpoint (top-level keys replace). */
  checkpoint?: JobCheckpoint;
  title?: string;
  summary?: string;
  sceneCount?: number;
  sources?: { title: string; url: string }[];
}

/**
 * Postgres refuses NUL characters in text and jsonb, and lone UTF-16 surrogates in jsonb ("unsupported
 * Unicode escape sequence"). Web pages TinyFish reads sometimes contain both, so everything the
 * worker saves goes through these first.
 */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function pgText(value: string): string;
export function pgText(value: string | null | undefined): string | null;
export function pgText(value: string | null | undefined) {
  return value == null ? null : value.replace(/\u0000/g, "").replace(LONE_SURROGATE, "\uFFFD");
}
export function pgJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "string" ? pgText(v) : v)));
}

/** One fenced write from the worker (also extends the lease). Throws LeaseLostError. */
export async function updateJob(sql: Sql, job: ClaimedJob, patch: JobPatch): Promise<void> {
  const rows = await sql`/* jobs:update */
    UPDATE lesson_jobs SET
      status = coalesce(${patch.status ?? null}::text, status),
      progress = coalesce(${pgText(patch.progress?.slice(0, 300))}::text, progress),
      checkpoint = checkpoint || ${sql.json(pgJson(patch.checkpoint ?? {}) as never)}::jsonb,
      title = coalesce(${pgText(patch.title)}::text, title),
      summary = coalesce(${pgText(patch.summary)}::text, summary),
      scene_count = coalesce(${patch.sceneCount ?? null}::int, scene_count),
      sources = coalesce(${patch.sources ? sql.json(pgJson(patch.sources)) : null}::jsonb, sources),
      lease_until = now() + make_interval(secs => ${JOB_LEASE_SECONDS}), updated_at = now()
    WHERE id = ${job.id} AND locked_by = ${job.token} AND status NOT IN ('completed', 'failed')
    RETURNING id`;
  if (!rows.length) throw new LeaseLostError(job.id);
  if (patch.status) job.status = patch.status;
  if (patch.checkpoint) job.checkpoint = { ...job.checkpoint, ...patch.checkpoint };
}

export async function completeJob(
  sql: Sql,
  job: ClaimedJob,
  result: { audio: LessonAudioRef[]; progress: string },
): Promise<void> {
  const rows = await sql`/* jobs:complete */
    UPDATE lesson_jobs SET status = 'completed', progress = ${pgText(result.progress.slice(0, 300))},
      audio = ${sql.json(result.audio as never)}::jsonb,
      checkpoint = checkpoint || ${sql.json({ recorded: result.audio } as never)}::jsonb,
      error_message = NULL, error_retryable = false, completed_at = now(), updated_at = now(),
      locked_by = NULL, locked_at = NULL, lease_until = NULL
    WHERE id = ${job.id} AND locked_by = ${job.token} AND status NOT IN ('completed', 'failed')
    RETURNING id`;
  if (!rows.length) throw new LeaseLostError(job.id);
  job.status = "completed";
}

/**
 * A failed attempt. Retryable failures go back in the queue after a backoff while attempts
 * remain (the checkpoint keeps finished work); the rest fail for good, with a message that is
 * safe to show (never a provider's raw error).
 */
export async function failJob(
  sql: Sql,
  job: ClaimedJob,
  error: { message: string; retryable: boolean },
): Promise<"requeued" | "failed"> {
  const requeue = error.retryable && job.attempts < MAX_JOB_ATTEMPTS;
  const delay = retryDelaySeconds(job.attempts);
  const message = error.message.slice(0, 500);
  const rows = await sql`/* jobs:fail */
    UPDATE lesson_jobs SET status = ${requeue ? "queued" : "failed"},
      progress = ${requeue ? `Trying again in ${delay} s: ${message}`.slice(0, 300) : null},
      run_after = now() + make_interval(secs => ${requeue ? delay : 0}),
      error_message = ${message}, error_retryable = ${error.retryable}, updated_at = now(),
      locked_by = NULL, locked_at = NULL, lease_until = NULL
    WHERE id = ${job.id} AND locked_by = ${job.token} AND status NOT IN ('completed', 'failed')
    RETURNING id`;
  if (!rows.length) throw new LeaseLostError(job.id);
  job.status = requeue ? "queued" : "failed";
  return requeue ? "requeued" : "failed";
}

/** The worker is shutting down mid-job: hand it back without spending an attempt. */
export async function releaseJob(sql: Sql, job: ClaimedJob): Promise<boolean> {
  const rows = await sql`/* jobs:release */
    UPDATE lesson_jobs SET status = 'queued', attempts = greatest(attempts - 1, 0),
      progress = 'The worker restarted. It will pick this up where it left off.',
      run_after = now(), locked_by = NULL, locked_at = NULL, lease_until = NULL, updated_at = now()
    WHERE id = ${job.id} AND locked_by = ${job.token} AND status NOT IN ('completed', 'failed')
    RETURNING id`;
  return rows.length > 0;
}

/** The worker's heartbeat row (GET /api/health reads the newest). */
export async function workerBeat(sql: Sql, workerId: string): Promise<void> {
  await sql`/* worker:beat */
    INSERT INTO worker_heartbeats (worker_id, seen_at) VALUES (${workerId}, now())
    ON CONFLICT (worker_id) DO UPDATE SET seen_at = now()`;
}
