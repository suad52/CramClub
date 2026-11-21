import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import {
  DAILY_CAPS,
  LIBRARY_TIME_ZONE as TZ,
  type PresenceReport,
  XP,
  clampPresence,
  cleanDisplayName,
  minLessonSeconds,
  subjectSlug,
  validateSessionEnd,
} from "../rules";

/**
 * Writes validated learning activity. Every reward goes through xp_ledger, whose unique
 * (user, reason, activity) key makes it idempotent: a repeated completion finds its ledger row
 * taken and earns nothing. Each write is one transaction, so an event and its XP land together.
 *
 * A finished pomodoro may carry `presence` ({ cameraSeconds, seenSeconds }, from the student's
 * own opt-in face tracking). It is clamped to the server-validated length (rules.ts
 * clampPresence), stored on the study_session_completed event (camera_seconds, seen_seconds; the
 * database re-checks seen <= camera <= duration) and, when it had to be cut down, flagged in the
 * event's metadata. A missing or malformed presence is simply dropped: it never costs the session
 * its focus time or XP, and nothing ranks by it.
 */

type Sql = postgres.Sql;
type Tx = postgres.TransactionSql;
export type Result = { status: number; body: Record<string, unknown> };

const lessonId = z.string().regex(/^[a-z0-9-]{4,64}$/);

const seconds = z.number().min(0).max(Number.MAX_SAFE_INTEGER);
/** The optional presence reading: anything malformed becomes "not reported", never a 400. */
export const PresenceBody = z
  .object({ cameraSeconds: seconds, seenSeconds: seconds })
  .optional()
  .catch(undefined);

/** Request bodies, by action. Anything else in a body is ignored. */
export const Bodies = {
  profile: z.object({
    displayName: z.string().max(64).optional(),
    leaderboardOptIn: z.boolean().optional(),
  }),
  "session-start": z.object({ plannedMinutes: z.number().int().min(1).max(90) }),
  "session-complete": z.object({ sessionId: z.uuid(), presence: PresenceBody }),
  "session-abandon": z.object({ sessionId: z.uuid() }),
  "lesson-start": z.object({
    lessonId,
    title: z.string().trim().min(1).max(100),
    subject: z.string().trim().min(1).max(60),
    sceneCount: z.number().int().min(1).max(20),
    /** Knowledge check id (the scene's id) → index of the right option. */
    answerKey: z.record(z.string().min(1).max(40), z.number().int().min(0).max(4)),
  }),
  "lesson-complete": z.object({ lessonId }),
  quiz: z.object({
    lessonId,
    quizId: z.string().min(1).max(40),
    picked: z.number().int().min(0).max(4),
  }),
};
export type Action = keyof typeof Bodies;

const ok = (body: Record<string, unknown> = {}): Result => ({
  status: 200,
  body: { ok: true, ...body },
});
const refuse = (status: number, code: string, message: string): Result => ({
  status,
  body: { error: { code, message } },
});

interface NewEvent {
  eventId?: string;
  userId: string;
  type:
    | "study_session_started"
    | "study_session_completed"
    | "lesson_started"
    | "lesson_completed"
    | "quiz_completed";
  subjectId?: string | null;
  lessonId?: string | null;
  quizId?: string | null;
  activityId?: string | null;
  durationSeconds?: number | null;
  score?: number | null;
  xp?: number;
  /** Completed pomodoros only: the clamped presence reading. */
  presence?: { cameraSeconds: number; seenSeconds: number } | null;
  metadata?: Record<string, unknown>;
}

function insertEvent(tx: Tx, e: NewEvent) {
  return tx`INSERT INTO learning_events
    (event_id, user_id, event_type, subject_id, lesson_id, quiz_id, activity_id,
     duration_seconds, score, xp_delta, camera_seconds, seen_seconds, metadata)
    VALUES (${e.eventId ?? randomUUID()}, ${e.userId}, ${e.type}, ${e.subjectId ?? null},
      ${e.lessonId ?? null}, ${e.quizId ?? null}, ${e.activityId ?? null},
      ${e.durationSeconds ?? null}, ${e.score ?? null}, ${e.xp ?? 0},
      ${e.presence?.cameraSeconds ?? null}, ${e.presence?.seenSeconds ?? null},
      ${tx.json((e.metadata ?? {}) as postgres.JSONValue)})`;
}

/** Claims the reward for an activity. False if it was already claimed (nothing is written). */
async function award(
  tx: Tx,
  userId: string,
  reason: string,
  activityKey: string,
  xp: number,
  eventId: string,
) {
  const rows =
    await tx`INSERT INTO xp_ledger (user_id, event_id, reason, activity_key, xp_delta, period_key)
    VALUES (${userId}, ${eventId}, ${reason}, ${activityKey}, ${xp},
      to_char(now() AT TIME ZONE ${TZ}, 'IYYY-"W"IW'))
    ON CONFLICT (user_id, reason, activity_key) DO NOTHING
    RETURNING ledger_id`;
  return rows.length > 0;
}

/** Whether today's XP-earning activities of this kind have reached the daily cap. */
async function capReached(tx: Tx, userId: string, reason: string, cap: number) {
  const [row] = await tx`SELECT count(*)::int AS n FROM xp_ledger
    WHERE user_id = ${userId} AND reason = ${reason} AND xp_delta > 0
      AND created_at >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`;
  return (row?.n as number) >= cap;
}

export function updateProfile(sql: Sql, userId: string, body: z.infer<(typeof Bodies)["profile"]>) {
  const name = body.displayName === undefined ? null : cleanDisplayName(body.displayName) || null;
  return sql`UPDATE learners SET
      display_name = coalesce(${name}, display_name),
      leaderboard_opt_in = coalesce(${body.leaderboardOptIn ?? null}, leaderboard_opt_in),
      updated_at = now()
    WHERE user_id = ${userId}`.then(() => ok());
}

/** A pomodoro started: the server stamps the start. Any session left running is abandoned. */
export function startSession(sql: Sql, userId: string, plannedMinutes: number) {
  return sql.begin(async (tx): Promise<Result> => {
    await tx`UPDATE study_sessions SET status = 'abandoned', ended_at = now()
      WHERE user_id = ${userId} AND status = 'active'`;
    const sessionId = randomUUID();
    await tx`INSERT INTO study_sessions (session_id, user_id, session_type, planned_seconds)
      VALUES (${sessionId}, ${userId}, 'pomodoro', ${plannedMinutes * 60})`;
    await insertEvent(tx, { userId, type: "study_session_started", activityId: sessionId });
    return ok({ sessionId });
  });
}

/**
 * A pomodoro rang. Counted only if the server's own clock agrees it ran its length. Its presence
 * reading, if any, is clamped to that length and stored with it (see the header).
 */
export function completeSession(
  sql: Sql,
  userId: string,
  sessionId: string,
  report?: PresenceReport | null,
) {
  return sql.begin(async (tx): Promise<Result> => {
    const [s] = await tx`SELECT started_at, planned_seconds, status, now() AS now
      FROM study_sessions WHERE session_id = ${sessionId} AND user_id = ${userId} FOR UPDATE`;
    if (!s) return refuse(404, "not_found", "No such focus session.");
    if (s.status !== "active") return ok({ duplicate: true, xp: 0 });
    const verdict = validateSessionEnd(
      s.started_at as Date,
      s.now as Date,
      s.planned_seconds as number,
    );
    if (!verdict.ok) {
      await tx`UPDATE study_sessions SET status = 'rejected', ended_at = now()
        WHERE session_id = ${sessionId}`;
      return refuse(422, "rejected", `That session can't count (${verdict.reason}).`);
    }
    const eventId = randomUUID();
    const xp = (await capReached(tx, userId, "session", DAILY_CAPS.sessions))
      ? 0
      : XP.sessionCompleted;
    const presence = clampPresence(report, verdict.durationSeconds);
    await award(tx, userId, "session", sessionId, xp, eventId);
    await tx`UPDATE study_sessions SET status = 'completed', ended_at = now(),
        duration_seconds = ${verdict.durationSeconds}, validated_at = now()
      WHERE session_id = ${sessionId}`;
    await insertEvent(tx, {
      eventId,
      userId,
      type: "study_session_completed",
      activityId: sessionId,
      durationSeconds: verdict.durationSeconds,
      xp,
      presence,
      metadata: presenceMetadata(report, presence),
    });
    return ok({
      xp,
      durationSeconds: verdict.durationSeconds,
      presence: presence
        ? {
            cameraSeconds: presence.cameraSeconds,
            seenSeconds: presence.seenSeconds,
            verifiedMinutes: Math.round(presence.seenSeconds / 60),
            clamped: presence.clamped,
          }
        : null,
    });
  });
}

/**
 * What the event's metadata keeps about a presence reading: only when the server had to clamp it,
 * the numbers the browser actually sent (so a suspicious client is visible in the record).
 */
export function presenceMetadata(
  report: PresenceReport | null | undefined,
  kept: ReturnType<typeof clampPresence>,
): Record<string, unknown> {
  if (!report || !kept?.clamped) return {};
  return {
    presence: {
      clamped: true,
      reported: { cameraSeconds: report.cameraSeconds, seenSeconds: report.seenSeconds },
    },
  };
}

/** A pomodoro was given up (left the table, the tab, or the library): no time, no XP. */
export function abandonSession(sql: Sql, userId: string, sessionId: string) {
  return sql`UPDATE study_sessions SET status = 'abandoned', ended_at = now()
    WHERE session_id = ${sessionId} AND user_id = ${userId} AND status = 'active'`.then(() => ok());
}

/**
 * A lesson started. Its first registration is kept: the answer key can't be rewritten later
 * (say, after seeing the answers).
 */
export function startLesson(sql: Sql, userId: string, b: z.infer<(typeof Bodies)["lesson-start"]>) {
  return sql.begin(async (tx): Promise<Result> => {
    const subjectId = subjectSlug(b.subject);
    await tx`INSERT INTO subjects (subject_id, name) VALUES (${subjectId}, ${b.subject.slice(0, 60)})
      ON CONFLICT DO NOTHING`;
    const fresh =
      await tx`INSERT INTO lessons (user_id, lesson_id, subject_id, title, scene_count, answer_key)
      VALUES (${userId}, ${b.lessonId}, ${subjectId}, ${b.title}, ${b.sceneCount}, ${tx.json(b.answerKey)})
      ON CONFLICT DO NOTHING RETURNING lesson_id`;
    if (fresh.length === 0) {
      await tx`UPDATE learning_progress SET last_activity_at = now(), updated_at = now()
        WHERE user_id = ${userId} AND lesson_id = ${b.lessonId}`;
      return ok({ known: true });
    }
    await tx`INSERT INTO learning_progress (user_id, lesson_id, subject_id, quizzes_total)
      VALUES (${userId}, ${b.lessonId}, ${subjectId}, ${Object.keys(b.answerKey).length})`;
    await insertEvent(tx, {
      userId,
      type: "lesson_started",
      subjectId,
      lessonId: b.lessonId,
      activityId: b.lessonId,
    });
    return ok({ known: false });
  });
}

/** Every scene of a lesson played through. XP once per lesson, and not impossibly fast. */
export function completeLesson(sql: Sql, userId: string, id: string) {
  return sql.begin(async (tx): Promise<Result> => {
    const [l] = await tx`SELECT subject_id, scene_count,
        extract(epoch FROM now() - first_started_at)::float AS age
      FROM lessons WHERE user_id = ${userId} AND lesson_id = ${id}`;
    if (!l) return refuse(404, "not_found", "Start the lesson first.");
    if ((l.age as number) < minLessonSeconds(l.scene_count as number))
      return refuse(422, "rejected", "That was quicker than the lesson can be played.");
    await tx`UPDATE learning_progress SET completion_status = 'completed',
        completed_count = completed_count + 1, last_activity_at = now(), updated_at = now()
      WHERE user_id = ${userId} AND lesson_id = ${id}`;
    const eventId = randomUUID();
    const xp = (await capReached(tx, userId, "lesson", DAILY_CAPS.lessons))
      ? 0
      : XP.lessonCompleted;
    if (!(await award(tx, userId, "lesson", id, xp, eventId)))
      return ok({ duplicate: true, xp: 0 });
    await insertEvent(tx, {
      eventId,
      userId,
      type: "lesson_completed",
      subjectId: l.subject_id as string,
      lessonId: id,
      activityId: id,
      xp,
    });
    return ok({ xp });
  });
}

/**
 * A knowledge check answered, graded here against the key the lesson registered. Only the
 * first answer counts (afterwards the right answer has been shown).
 */
export function answerQuiz(sql: Sql, userId: string, b: z.infer<(typeof Bodies)["quiz"]>) {
  return sql.begin(async (tx): Promise<Result> => {
    const [l] = await tx`SELECT subject_id, answer_key FROM lessons
      WHERE user_id = ${userId} AND lesson_id = ${b.lessonId}`;
    if (!l) return refuse(404, "not_found", "Start the lesson first.");
    const key = (l.answer_key as Record<string, number>)[b.quizId];
    if (typeof key !== "number") return refuse(422, "rejected", "That question isn't graded.");
    const activity = `${b.lessonId}:${b.quizId}`;
    const correct = b.picked === key;
    const eventId = randomUUID();
    const capped = await capReached(tx, userId, "quiz", DAILY_CAPS.quizzes);
    const base = capped ? 0 : XP.quizCompleted;
    const bonus = capped || !correct ? 0 : XP.quizPassed;
    if (!(await award(tx, userId, "quiz", activity, base, eventId)))
      return ok({ duplicate: true, correct, xp: 0 });
    if (bonus) await award(tx, userId, "quiz_passed", activity, bonus, eventId);
    await tx`UPDATE learning_progress SET quizzes_answered = quizzes_answered + 1,
        quizzes_first_try = quizzes_first_try + ${correct ? 1 : 0},
        last_activity_at = now(), updated_at = now()
      WHERE user_id = ${userId} AND lesson_id = ${b.lessonId}`;
    await insertEvent(tx, {
      eventId,
      userId,
      type: "quiz_completed",
      subjectId: l.subject_id as string,
      lessonId: b.lessonId,
      quizId: b.quizId,
      activityId: activity,
      score: correct ? 100 : 0,
      xp: base + bonus,
    });
    return ok({ correct, xp: base + bonus });
  });
}
