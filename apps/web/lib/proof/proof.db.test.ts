import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeSession } from "@/lib/learning/server/pipeline";
import { integrityCheck, tigerFacts } from "./server";

/**
 * Verified focus and the /proof report's SQL against the real database (Tiger Data). Opt in,
 * because it writes one throwaway learner (hidden from leaderboards) and deletes everything it
 * made at the end:
 *   PROOF_DB_TEST=1 pnpm --filter @ovr/web exec vitest run lib/proof/proof.db.test.ts
 * It checks that the database itself refuses an impossible presence reading, that a completed
 * pomodoro stores the clamped one, that the integrity check sees no drift after that write, and
 * that every catalog query the page makes runs on this TimescaleDB.
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

const enabled = process.env.PROOF_DB_TEST === "1" && !!databaseUrl();

describe.skipIf(!enabled)("verified focus on the real database", { timeout: 60_000 }, () => {
  let sql: postgres.Sql;
  const learner = randomUUID();

  beforeAll(async () => {
    sql = postgres(databaseUrl(), { max: 4, onnotice: () => {} });
    await sql`INSERT INTO learners (user_id, display_name, leaderboard_opt_in)
      VALUES (${learner}, 'Proof test', false)`;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM learning_events WHERE user_id = ${learner}`;
    await sql`DELETE FROM learners WHERE user_id = ${learner}`;
    await sql.end();
  }, 60_000);

  it("refuses an impossible reading in the database itself", async () => {
    const bad = (camera: number, seen: number, type = "study_session_completed") =>
      sql`INSERT INTO learning_events (event_id, user_id, event_type, duration_seconds,
          camera_seconds, seen_seconds)
        VALUES (${randomUUID()}, ${learner}, ${type}, 1500, ${camera}, ${seen})`;
    for (const attempt of [bad(600, 900), bad(1800, 100), bad(10, 5, "lesson_completed")])
      await expect(attempt).rejects.toMatchObject({ code: "23514" });
  });

  it("stores a pomodoro's clamped reading, and the aggregates agree with the raw rows", async () => {
    const sessionId = randomUUID();
    await sql`
      INSERT INTO study_sessions (session_id, user_id, session_type, planned_seconds, started_at)
      VALUES (${sessionId}, ${learner}, 'pomodoro', 1500, now() - interval '25 minutes')`;
    const done = await completeSession(sql, learner, sessionId, {
      cameraSeconds: 1700,
      seenSeconds: 1200,
    });
    expect(done.status).toBe(200);
    const [row] = await sql`SELECT camera_seconds, seen_seconds, metadata FROM learning_events
      WHERE user_id = ${learner} AND event_type = 'study_session_completed'`;
    expect(row).toMatchObject({
      camera_seconds: 1500,
      seen_seconds: 1200,
      metadata: {
        presence: { clamped: true, reported: { cameraSeconds: 1700, seenSeconds: 1200 } },
      },
    });
    const [daily] = await sql`SELECT seen_seconds::int AS seen FROM focus_presence_daily
      WHERE user_id = ${learner}`;
    expect(daily?.seen).toBe(1200);
    const [weekly] = await sql`SELECT seen_seconds::int AS seen FROM focus_presence_weekly
      WHERE user_id = ${learner}`;
    expect(weekly?.seen).toBe(1200);

    const report = await integrityCheck(sql);
    expect(report.checks.map((c) => c.id)).toEqual(["daily", "presence", "ledger"]);
    expect(report.days).toHaveLength(7);
    for (const c of report.checks)
      expect({ id: c.id, drifted: c.drifted }).toEqual({ id: c.id, drifted: 0 });
  });

  it("reads every Tiger fact the /proof page shows", async () => {
    const t = await tigerFacts(sql);
    expect(t.hypertable).toMatchObject({ name: "learning_events" });
    expect(t.hypertable!.chunks).toBeGreaterThan(0);
    const names = t.aggregates.map((a) => a.name);
    expect(names).toEqual(
      expect.arrayContaining(["learning_daily", "focus_presence_daily", "focus_presence_weekly"]),
    );
    expect(t.aggregates.find((a) => a.name === "focus_presence_weekly")).toMatchObject({
      builtOn: "focus_presence_daily",
      hierarchical: true,
      realTime: true,
    });
    expect(t.aggregates.every((a) => a.refresh !== null)).toBe(true);
    expect(t.verifiedWeeks).toHaveLength(6);
    expect(t.guarantees.every((g) => g.present)).toBe(true);
    expect(t.integrity).not.toBeNull();
  });
});
