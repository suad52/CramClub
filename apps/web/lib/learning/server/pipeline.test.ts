import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { Bodies, completeSession, presenceMetadata } from "./pipeline";

const SESSION = "6f1c3c5e-6f7a-4a43-9c8e-3f0a1b2c3d4e";

describe("session-complete body", () => {
  const parse = (body: unknown) => Bodies["session-complete"].safeParse(body);

  it("takes an optional presence reading", () => {
    expect(parse({ sessionId: SESSION }).data).toEqual({ sessionId: SESSION });
    expect(
      parse({ sessionId: SESSION, presence: { cameraSeconds: 1500, seenSeconds: 1320 } }).data,
    ).toEqual({ sessionId: SESSION, presence: { cameraSeconds: 1500, seenSeconds: 1320 } });
  });

  it("drops a malformed reading instead of refusing the pomodoro", () => {
    for (const presence of [
      { cameraSeconds: -1, seenSeconds: 0 },
      { cameraSeconds: "lots", seenSeconds: 0 },
      { seenSeconds: 10 },
      "yes",
    ]) {
      const r = parse({ sessionId: SESSION, presence });
      expect(r.success).toBe(true);
      expect(r.data?.presence).toBeUndefined();
    }
    expect(parse({ presence: { cameraSeconds: 1, seenSeconds: 1 } }).success).toBe(false);
  });

  it("flags only a reading the server had to cut down, keeping what was sent", () => {
    expect(presenceMetadata(undefined, null)).toEqual({});
    const honest = { cameraSeconds: 1500, seenSeconds: 1400 };
    expect(presenceMetadata(honest, { ...honest, clamped: false })).toEqual({});
    const greedy = { cameraSeconds: 9000, seenSeconds: 9000 };
    expect(
      presenceMetadata(greedy, { cameraSeconds: 1500, seenSeconds: 1500, clamped: true }),
    ).toEqual({ presence: { clamped: true, reported: greedy } });
  });
});

/**
 * A stand-in transaction for one completed pomodoro: a session started 25 minutes ago, under the
 * daily cap. It records the learning_events insert so the stored reading can be checked.
 */
function fakeSql() {
  const inserted: unknown[][] = [];
  const now = new Date("2026-11-21T15:25:00Z");
  const tx = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$");
    if (text.includes("FROM study_sessions"))
      return Promise.resolve([
        {
          started_at: new Date(now.getTime() - 1500_000),
          planned_seconds: 1500,
          status: "active",
          now,
        },
      ]);
    if (text.includes("count(*)::int AS n FROM xp_ledger")) return Promise.resolve([{ n: 0 }]);
    if (text.includes("INSERT INTO xp_ledger")) return Promise.resolve([{ ledger_id: 1 }]);
    if (text.includes("INSERT INTO learning_events")) inserted.push(values);
    return Promise.resolve([]);
  }) as unknown as postgres.TransactionSql;
  (tx as unknown as { json: (v: unknown) => unknown }).json = (v) => ({ json: v });
  const sql = { begin: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as postgres.Sql;
  return { sql, inserted };
}

describe("completeSession with presence", () => {
  it("stores the clamped reading on the event and returns verified minutes", async () => {
    const { sql, inserted } = fakeSql();
    const res = await completeSession(sql, "user-1", SESSION, {
      cameraSeconds: 1800,
      seenSeconds: 1320,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      xp: 10,
      durationSeconds: 1500,
      presence: { cameraSeconds: 1500, seenSeconds: 1320, verifiedMinutes: 22, clamped: true },
    });
    const values = inserted[0]!;
    // ..., duration_seconds, score, xp_delta, camera_seconds, seen_seconds, metadata
    expect(values.slice(-6)).toEqual([
      1500,
      null,
      10,
      1500,
      1320,
      {
        json: { presence: { clamped: true, reported: { cameraSeconds: 1800, seenSeconds: 1320 } } },
      },
    ]);
  });

  it("counts a pomodoro without a camera exactly as before", async () => {
    const { sql, inserted } = fakeSql();
    const res = await completeSession(sql, "user-1", SESSION);
    expect(res.body).toMatchObject({ xp: 10, durationSeconds: 1500, presence: null });
    expect(inserted[0]!.slice(-3)).toEqual([null, null, { json: {} }]);
  });
});
