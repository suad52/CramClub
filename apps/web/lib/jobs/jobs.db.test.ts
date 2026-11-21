import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LeaseLostError,
  claimLessonJob,
  completeJob,
  enqueueLessonJob,
  extendLease,
  failJob,
  getLessonJob,
  releaseJob,
  retryLessonJob,
  updateJob,
  workerBeat,
  workerStatus,
} from "./server";
import { MAX_JOB_ATTEMPTS } from "./types";

/**
 * The queue's SQL against the real database (Tiger Data): SKIP LOCKED claims, leases, fencing,
 * backoff, reaping and circle sharing. Opt in, because it writes:
 *   JOBS_DB_TEST=1 pnpm --filter @ovr/web exec vitest run lib/jobs/jobs.db.test.ts
 * It makes throwaway learners and deletes them (their jobs cascade). It refuses to run while
 * anyone else's jobs are waiting, so it can never claim a real student's lesson.
 */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = new URL("../../.env.local", import.meta.url);
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  return line
    ? line
        .slice("DATABASE_URL=".length)
        .trim()
        .replace(/^"(.*)"$/, "$1")
    : "";
}

const enabled = process.env.JOBS_DB_TEST === "1" && !!databaseUrl();

describe.skipIf(!enabled)("lesson jobs on the real database", { timeout: 60_000 }, () => {
  let sql: postgres.Sql;
  const ada = randomUUID();
  const ben = randomUUID();
  const circle = randomUUID();
  const worker = `jobs-db-test-${randomUUID().slice(0, 6)}`;

  async function enqueue(owner: string, topic: string) {
    const out = await enqueueLessonJob(sql, owner, { topic });
    if (!out.ok) throw new Error(`${out.status} ${out.code}`);
    return out.body.id;
  }

  beforeAll(async () => {
    sql = postgres(databaseUrl(), { max: 4, onnotice: () => {} });
    const [others] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM lesson_jobs
      WHERE status NOT IN ('completed', 'failed')`;
    if (others!.n) throw new Error(`${others!.n} real lesson jobs are waiting; not claiming`);
    await sql`INSERT INTO learners (user_id, display_name, leaderboard_opt_in)
      VALUES (${ada}, 'Jobs test A', false), (${ben}, 'Jobs test B', false)`;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM study_circles WHERE id = ${circle}`;
    await sql`DELETE FROM learners WHERE user_id IN (${ada}, ${ben})`;
    await sql`DELETE FROM worker_heartbeats WHERE worker_id = ${worker}`;
    await sql.end();
  }, 60_000);

  it("enqueues once per request and two workers never claim the same job", async () => {
    const a = await enqueue(ada, "Jobs test: modular arithmetic");
    expect(await enqueue(ada, "jobs TEST: Modular arithmetic")).toBe(a);
    const b = await enqueue(ben, "Jobs test: photosynthesis");
    const [one, two] = await Promise.all([
      claimLessonJob(sql, `${worker}-1`),
      claimLessonJob(sql, `${worker}-2`),
    ]);
    expect(new Set([one?.id, two?.id])).toEqual(new Set([a, b]));
    expect(await claimLessonJob(sql, worker)).toBeNull();

    // A's worker finishes; B's dies (its lease runs out) and another worker takes over.
    const jobA = one!.id === a ? one! : two!;
    const jobB = one!.id === b ? one! : two!;
    await updateJob(sql, jobA, {
      status: "saving",
      progress: "Checking files",
      checkpoint: { lesson: `lessons/${a}/lesson.json`, storage: "local" },
      sources: [{ title: "T", url: "https://example.edu" }],
      title: "Modular arithmetic",
      summary: "Clock maths",
      sceneCount: 2,
    });
    await completeJob(sql, jobA, { audio: [{ scene: 0, duration: 4.2 }], progress: "Saved" });
    const done = (await getLessonJob(sql, ada, a))!.view;
    expect(done).toMatchObject({
      status: "completed",
      title: "Modular arithmetic",
      sceneCount: 2,
      audio: [{ scene: 0, duration: 4.2 }],
      sources: [{ title: "T", url: "https://example.edu" }],
      storage: "local",
    });

    await sql`UPDATE lesson_jobs SET lease_until = now() - interval '1 second' WHERE id = ${b}`;
    const again = await claimLessonJob(sql, worker);
    expect(again).toMatchObject({ id: b, attempts: 2 });
    await expect(updateJob(sql, jobB, { progress: "stale" })).rejects.toBeInstanceOf(
      LeaseLostError,
    );
    expect(await extendLease(sql, again!)).toBe(true);

    // Retryable failure: back in the queue with a backoff, not claimable yet.
    expect(await failJob(sql, again!, { message: "Gemini is busy", retryable: true })).toBe(
      "requeued",
    );
    expect(await claimLessonJob(sql, worker)).toBeNull();
    await sql`UPDATE lesson_jobs SET run_after = now() WHERE id = ${b}`;
    const third = await claimLessonJob(sql, worker);
    expect(third?.attempts).toBe(MAX_JOB_ATTEMPTS);
    // It dies on its last attempt: the next claim fails it rather than picking it again.
    await sql`UPDATE lesson_jobs SET lease_until = now() - interval '1 second' WHERE id = ${b}`;
    expect(await claimLessonJob(sql, worker)).toBeNull();
    expect((await getLessonJob(sql, ben, b))!.view).toMatchObject({
      status: "failed",
      error: { retryable: true },
    });
    expect(await retryLessonJob(sql, ada, b)).toMatchObject({ ok: false, status: 404 });
    expect(await retryLessonJob(sql, ben, b)).toMatchObject({ ok: true, body: { attempts: 0 } });

    // Shutdown hands it back without spending the attempt.
    const fourth = (await claimLessonJob(sql, worker))!;
    expect(await releaseJob(sql, fourth)).toBe(true);
    const [row] = await sql`SELECT status, attempts, lease_until FROM lesson_jobs WHERE id = ${b}`;
    expect(row).toMatchObject({ status: "queued", attempts: 0, lease_until: null });
    await sql`UPDATE lesson_jobs SET status = 'failed' WHERE id = ${b}`;
  });

  it("lets circle members read a shared lesson job, and nobody else", async () => {
    const id = await enqueue(ada, "Jobs test: cell biology");
    expect(await getLessonJob(sql, ben, id)).toBeNull();
    await sql`INSERT INTO study_circles (id, name, owner_id) VALUES (${circle}, 'Jobs test', ${ada})`;
    await sql`INSERT INTO circle_members (circle_id, learner_id, role)
      VALUES (${circle}, ${ada}, 'owner'), (${circle}, ${ben}, 'viewer')`;
    await sql`INSERT INTO circle_items (id, circle_id, kind, title, payload, added_by)
      VALUES (${randomUUID()}, ${circle}, 'lesson', 'Cells', ${sql.json({ lessonJobId: id })}, ${ada})`;
    expect((await getLessonJob(sql, ben, id))?.isOwner).toBe(false);
    await sql`DELETE FROM circle_members WHERE circle_id = ${circle} AND learner_id = ${ben}`;
    expect(await getLessonJob(sql, ben, id)).toBeNull();
    await sql`UPDATE lesson_jobs SET status = 'failed' WHERE id = ${id}`;
  });

  it("records the worker heartbeat", async () => {
    await workerBeat(sql, worker);
    const status = await workerStatus(sql);
    expect(status.online).toBe(true);
    expect(status.lastSeenSecondsAgo).toBeLessThanOrEqual(2);
  });
});
