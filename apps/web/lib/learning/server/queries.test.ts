import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import { leaderboard } from "./queries";

/**
 * A stand-in for the postgres.js tag: it records each query's text and bound values and answers
 * with canned rows (the ranking itself happens in SQL; db/smoke.mjs checks it on a real database).
 */
function fakeSql(ranked: Record<string, unknown>[], mine: Record<string, unknown>[] = []) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$");
    calls.push({ text, values });
    if (text.includes("row_number()")) return Promise.resolve(ranked);
    if (text.includes("FROM learners l LEFT JOIN learning_daily")) return Promise.resolve(mine);
    return Promise.resolve([
      { start: new Date("2026-11-16T05:00:00Z"), stop: new Date("2026-11-23T05:00:00Z") },
    ]);
  }) as unknown as postgres.Sql;
  return { sql, calls, ranking: () => calls.find((c) => c.text.includes("row_number()"))! };
}

const row = (n: number, extra: Record<string, unknown> = {}) => ({
  rank: n,
  user_id: `user-${n}`,
  display_name: `Reader ${n}`,
  is_demo: false,
  xp: 1000 - n,
  focus: 60 * (100 - n),
  days: 3,
  ...extra,
});

describe("leaderboard", () => {
  it("ranks by XP unless asked for focus time", async () => {
    const xp = fakeSql([row(1)]);
    const board = await leaderboard(xp.sql, null, "week");
    expect(board.by).toBe("xp");
    expect(xp.ranking().values).toContain("xp");
    expect(xp.ranking().values).not.toContain("focus");

    const focus = fakeSql([row(1)]);
    expect((await leaderboard(focus.sql, null, "week", "focus")).by).toBe("focus");
    const q = focus.ranking();
    expect(q.values).toContain("focus");
    // Both the order and who's on the board follow the chosen measure (as bound values).
    expect(q.text).toMatch(/ORDER BY CASE WHEN \$ = 'focus' THEN t\.focus ELSE t\.xp END DESC/);
    expect(q.text).toMatch(/WHERE CASE WHEN \$ = 'focus' THEN t\.focus ELSE t\.xp END > 0/);
    expect(q.text).toContain("l.leaderboard_opt_in");
  });

  it("sends the top 25 without user ids, marking your own row", async () => {
    const ranked = Array.from({ length: 30 }, (_, i) => row(i + 1));
    const { sql } = fakeSql(ranked, [{ leaderboard_opt_in: true, xp: 997, focus: 97 * 60 + 20 }]);
    const board = await leaderboard(sql, "user-3", "week", "focus");
    expect(board.rows).toHaveLength(25);
    expect(board.participants).toBe(30);
    expect(board.rows[2]).toEqual({
      rank: 3,
      displayName: "Reader 3",
      xp: 997,
      focusMinutes: 97,
      activeDays: 3,
      isMe: true,
      isDemo: false,
    });
    expect(board.rows.filter((r) => r.isMe)).toHaveLength(1);
    expect(board.me).toEqual({ rank: 3, xp: 997, focusMinutes: 97, optedIn: true });
    expect(JSON.stringify(board)).not.toContain("user-");
    expect(board.from).toBe("2026-11-16T05:00:00.000Z");
  });

  it("still tells an opted-out or unranked learner their own totals", async () => {
    const { sql } = fakeSql([row(1)], [{ leaderboard_opt_in: false, xp: 40, focus: 1500 }]);
    const board = await leaderboard(sql, "someone-else", "month", "focus");
    expect(board.rows.some((r) => r.isMe)).toBe(false);
    expect(board.me).toEqual({ rank: null, xp: 40, focusMinutes: 25, optedIn: false });
    expect(board.period).toBe("month");
  });
});
