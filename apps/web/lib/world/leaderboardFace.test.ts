import { describe, expect, it } from "vitest";
import { type HallBoard, STALE_AFTER, nextHallBoard } from "@/lib/learning/hallBoards";
import type { Leaderboard, LeaderboardRow } from "@/lib/learning/types";
import { FACE_ROWS, formatDays, formatFocus, formatXp, leaderboardFace } from "./leaderboardFace";

const row = (rank: number, extra: Partial<LeaderboardRow> = {}): LeaderboardRow => ({
  rank,
  displayName: `Reader ${rank}`,
  xp: 1300 - rank * 10,
  focusMinutes: 300 - rank * 5,
  activeDays: 5,
  isMe: false,
  isDemo: false,
  ...extra,
});

const board = (rows: LeaderboardRow[], me: Leaderboard["me"] = null): HallBoard => ({
  status: "ready",
  failures: 0,
  board: {
    period: "week",
    by: "xp",
    from: "2026-11-16T05:00:00.000Z",
    to: "2026-11-23T05:00:00.000Z",
    rows,
    me,
    participants: rows.length,
    queryMs: 4,
  },
});

describe("leaderboard values", () => {
  it("reads focus time in hours and minutes", () => {
    expect(formatFocus(205)).toBe("3 h 25 m");
    expect(formatFocus(45)).toBe("45 m");
    expect(formatFocus(120)).toBe("2 h");
    expect(formatFocus(0)).toBe("0 m");
  });

  it("groups XP and counts days", () => {
    expect(formatXp(1240)).toBe("1,240 XP");
    expect(formatXp(35)).toBe("35 XP");
    expect(formatDays(5)).toBe("5 days");
    expect(formatDays(1)).toBe("1 day");
  });
});

describe("leaderboard face", () => {
  it("shows the top eight with the measure each board ranks by", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i + 1));
    const focus = leaderboardFace("focus", board(rows), "America/Toronto");
    expect(focus.title).toBe("Most time locked in");
    expect(focus.subtitle).toMatch(/^This week · Nov 16 – Nov 22$/);
    expect(focus.rows).toHaveLength(FACE_ROWS);
    expect(focus.rows[0]).toMatchObject({ rank: 1, name: "Reader 1", value: "4 h 55 m" });
    expect(focus.rows[0]!.detail).toBeNull();
    expect(focus.notice).toBeNull();

    const xp = leaderboardFace("xp", board(rows));
    expect(xp.title).toBe("Top learners");
    expect(xp.rows[1]).toMatchObject({ value: "1,280 XP", detail: "5 days" });
  });

  it("tags demo learners instead of spelling it out, and marks your row", () => {
    const face = leaderboardFace(
      "focus",
      board([row(1, { displayName: "Demo · Mei", isDemo: true }), row(2, { isMe: true })], {
        rank: 2,
        xp: 1280,
        focusMinutes: 290,
        optedIn: true,
      }),
    );
    expect(face.rows[0]).toMatchObject({ name: "Mei", isDemo: true, isMe: false });
    expect(face.rows[1]).toMatchObject({ isMe: true });
    // You're on the board, so the footer explains the ranking instead.
    expect(face.footer.you).toBe(false);
  });

  it("says where you stand when you're below the rows shown", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1));
    const ranked = { rank: 14, xp: 90, focusMinutes: 65, optedIn: true };
    expect(leaderboardFace("focus", board(rows, ranked)).footer).toEqual({
      text: "You: #14 · 1 h 5 m",
      you: true,
    });
    expect(leaderboardFace("xp", board(rows, ranked)).footer.text).toBe("You: #14 · 90 XP");
    const hidden = { rank: null, xp: 90, focusMinutes: 65, optedIn: false };
    expect(leaderboardFace("xp", board(rows, hidden)).footer.text).toBe(
      "You're hidden from leaderboards",
    );
    const fresh = { rank: null, xp: 0, focusMinutes: 0, optedIn: true };
    expect(leaderboardFace("focus", board(rows, fresh)).footer.text).toBe(
      "Finish a pomodoro to join the board",
    );
  });

  it("has a friendly empty state, and says when it's offline", () => {
    const empty = leaderboardFace("focus", board([]));
    expect(empty.rows).toEqual([]);
    expect(empty.notice).toEqual({
      tone: "empty",
      title: "No one yet this week.",
      body: "Finish a pomodoro to be first!",
    });
    expect(leaderboardFace("xp", { status: "offline" }).notice?.title).toBe("Leaderboard offline");
    expect(leaderboardFace("xp", { status: "loading" }).notice?.tone).toBe("loading");
  });
});

describe("hall board refreshes", () => {
  it("keeps the last rows through a blip, then goes offline", () => {
    const ready = board([row(1)]);
    const fresh = (ready as Extract<HallBoard, { status: "ready" }>).board;
    expect(nextHallBoard({ status: "loading" }, null)).toEqual({ status: "offline" });
    expect(nextHallBoard({ status: "offline" }, fresh)).toEqual(ready);
    let state = ready;
    for (let i = 1; i < STALE_AFTER; i++) {
      state = nextHallBoard(state, null);
      expect(state).toMatchObject({ status: "ready", failures: i });
    }
    expect(nextHallBoard(state, null)).toEqual({ status: "offline" });
  });
});
